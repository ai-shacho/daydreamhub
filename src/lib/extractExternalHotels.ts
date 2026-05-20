function isAddressLike(s: string): boolean {
  return /^\d+\s*[,\s]/.test(s);
}

export interface ExternalHotel {
  name: string;
  phone: string;
}

export function extractExternalHotels(text: string): ExternalHotel[] {
  const hotels: ExternalHotel[] = [];
  if (!text) return hotels;
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf('/hotel/') !== -1) continue;

    const phoneMatch =
      line.match(/📞\s*([\+\d][\d\s\-\(\)\.]{6,20})/) ||
      line.match(/(\+\d[\d\s\-\(\)\.]{6,20})/);
    if (!phoneMatch) continue;

    // 電話番号の前後1行以内に /hotel/ リンクがあれば自社ホテル扱いで除外
    let nearPartner = false;
    for (let k = Math.max(0, i - 1); k <= Math.min(lines.length - 1, i + 1); k++) {
      if (lines[k].indexOf('/hotel/') !== -1) { nearPartner = true; break; }
    }
    if (nearPartner) continue;

    const phone = phoneMatch[1].trim();
    let name = '';

    for (let j = i; j >= Math.max(0, i - 8); j--) {
      const checkLine = lines[j];
      if (checkLine.indexOf('/hotel/') !== -1) break;
      if (checkLine.indexOf('📍') !== -1) continue;
      if (checkLine.indexOf('📞') !== -1 && j !== i) continue;
      const stripped = checkLine.replace(/^\s*[-•]\s*/, '').trim();
      if (!stripped) continue;

      // 1. 太字パターン **Name**
      let m = checkLine.match(/\*\*([^*]{2,80})\*\*/);
      if (m) {
        const c = m[1].trim();
        if (c.length >= 2 && !isAddressLike(c)) { name = c; break; }
      }

      // 2. 番号付きリスト "4. NOBO - Hotel in old Tbilisi"（値段・評価が続いても可）
      m = checkLine.match(/^\s*\d+\.\s+(.+?)(?:\s*[|｜]|\s*[⭐★]|\s*📍|\s*📞|\s*\+|$)/);
      if (m) {
        const c = m[1].replace(/\s*-+\s*From\s+\$[\d.,]+.*$/i, '').replace(/\s*[|｜].*$/, '').replace(/\s*[⭐★].*$/, '').trim();
        if (c.length >= 2 && !isAddressLike(c)) { name = c; break; }
      }

      // 3. bullet "- Name" / "• Name"
      m = checkLine.match(/^\s*[-•]\s+([^📍📞|｜⭐★]{2,80}?)\s*(?:[|｜⭐★]|$)/);
      if (m) {
        const c = m[1].trim();
        if (c.length >= 2 && !isAddressLike(c)) { name = c; break; }
      }

      // 4. 装飾なしの平文行 "Here We Go Bangkok | ⭐4.7"
      m = checkLine.match(/^\s*([A-Za-z][^|｜⭐★📍📞\n]{1,80}?)\s*(?:[|｜⭐★]|$)/);
      if (m) {
        const c = m[1].trim();
        if (c.length >= 2 && !isAddressLike(c)) { name = c; break; }
      }
    }

    if (!name || name.length < 2) continue;
    // 重複チェック（電話番号で重複判定。同一番号は1件のみ）
    if (!hotels.some(h => h.phone === phone)) {
      hotels.push({ name, phone });
    }
  }

  return hotels;
}
