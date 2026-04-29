import { describe, it, expect } from 'vitest';
import { extractExternalHotels } from '../lib/extractExternalHotels';

// 実際の AI 応答フォーマット（Tbilisi ケース）
const TBILISI_RESPONSE = `I'll search for day-use hotels in Tbilisi for your 8-hour stay on April 23, 2026.

Based on your requirements (10:00–18:00, 1 guest), here are your options:

✅ Direct Booking (No Service Fee)

1. Eco-friendly Why Me Tbilisi — From $22
•📍 Tbilisi, Georgia
•⏰ 【10H】Daytime: $22 | 13:00–23:00 (closest match to your timeframe)
•Book Now

2. Boutique Hotel Manufactura — $50
•📍 Tbilisi, Georgia
•⏰ 【3H】Daytime: $50 | 14:00–17:00 (partial coverage)
•Book Now

3. Standard Room B Block – King Size Bed — $75
•📍 Tbilisi, Georgia
•⏰ 【10H】Daytime: $75 | 10:00–20:00 (covers your full 10:00–18:00 window)
•Book Now



🌟 Want More Options? (+$7 AI Call Fee)

4. NOBO - Hotel in old Tbilisi
•📍 27 Kote Afkhazi St, T'bilisi 0108, Georgia
•📞 +995 597 27 27 22 | ⭐5

5. Friendly Hotel By Art Nova
•📍 27 Davit Aghmashenebeli Ave, T'bilisi 0102, Georgia
•📞 +995 577 54 44 41 | ⭐4.9

6. TownHouse Tbilisi
•📍 Apt. N 41, N 114 Davit Aghmashenebeli Ave, T'bilisi, Georgia
•📞 +995 597 92 66 89 | ⭐4.9

7. Hilton Garden Inn Tbilisi Riverview
•📍 17 Ialbuzi St, T'bilisi 0149, Georgia
•📞 +995 32 200 99 77 | ⭐4.7

8. Paragraph Freedom Square, a Luxury Collection Hotel
•📍 7 Freedom Square, T'bilisi 0105, Georgia
•📞 +995 32 244 88 88 | ⭐4.7

Best match: Standard Room B Block covers your exact 10:00–18:00 window at $75 with direct booking.`;

// 自社ホテルのみの AI 応答（外部ホテルなし）
const INTERNAL_ONLY_RESPONSE = `Here are our partner hotels in Bangkok:

1. The Pantip Hotel Ladprao Bangkok — From $30
•📍 Bangkok, Thailand
•📞 +66 2 622 3225
•Book Now: /hotel/the-pantip-hotel-ladprao-bangkok

2. S Box Sukhumvit Hotel — From $40
•📍 Bangkok, Thailand
•📞 +66 83 616 9854
•Book Now: /hotel/s-box-sukhumvit-hotel`;

// 自社＋外部が混在する AI 応答
const MIXED_RESPONSE = `Here are options in Bangkok:

✅ Partner Hotels

1. The Pantip Hotel Ladprao — From $30
•📍 Bangkok, Thailand
•Book Now: /hotel/the-pantip-hotel-ladprao-bangkok
•📞 +66 2 622 3225

🌟 External Options (+$7)

2. Pullman Bangkok King Power
•📍 8, 2 Thanon Rang Nam, Bangkok, Thailand
•📞 +66 2 680 9999 | ⭐4`;

describe('extractExternalHotels', () => {
  describe('Tbilisi フォーマット（番号付きリスト + 📞行）', () => {
    it('外部ホテルを3件以上抽出する', () => {
      const result = extractExternalHotels(TBILISI_RESPONSE);
      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it('ホテル名が正しく抽出される', () => {
      const result = extractExternalHotels(TBILISI_RESPONSE);
      const names = result.map(h => h.name);
      expect(names).toContain('NOBO - Hotel in old Tbilisi');
      expect(names).toContain('Friendly Hotel By Art Nova');
      expect(names).toContain('TownHouse Tbilisi');
    });

    it('電話番号が正しく抽出される', () => {
      const result = extractExternalHotels(TBILISI_RESPONSE);
      const phones = result.map(h => h.phone);
      expect(phones).toContain('+995 597 27 27 22');
      expect(phones).toContain('+995 577 54 44 41');
      expect(phones).toContain('+995 597 92 66 89');
    });

    it('住所がホテル名として抽出されない', () => {
      const result = extractExternalHotels(TBILISI_RESPONSE);
      const names = result.map(h => h.name);
      for (const name of names) {
        expect(name).not.toMatch(/^\d+/); // 数字で始まる住所
        expect(name).not.toMatch(/\b(Street|St|Ave|Road|Rd)\b/i);
      }
    });
  });

  describe('自社ホテルの混入防止', () => {
    it('自社ホテル（/hotel/ リンクあり）は抽出しない', () => {
      const result = extractExternalHotels(INTERNAL_ONLY_RESPONSE);
      expect(result).toHaveLength(0);
    });

    it('自社ホテルの近くにある電話番号は除外される', () => {
      const result = extractExternalHotels(MIXED_RESPONSE);
      const phones = result.map(h => h.phone);
      // 自社ホテルの電話番号は含まれない
      expect(phones).not.toContain('+66 2 622 3225');
    });

    it('外部ホテルの電話番号は抽出される', () => {
      const result = extractExternalHotels(MIXED_RESPONSE);
      const phones = result.map(h => h.phone);
      expect(phones).toContain('+66 2 680 9999');
    });
  });

  describe('エッジケース', () => {
    it('空文字列で空配列を返す', () => {
      expect(extractExternalHotels('')).toHaveLength(0);
    });

    it('電話番号がない応答で空配列を返す', () => {
      expect(extractExternalHotels('Here are some hotels in Tokyo.')).toHaveLength(0);
    });

    it('同じ電話番号の重複を除去する', () => {
      const text = `4. Hotel Alpha\n•📞 +1 234 567 8900\n\n4. Hotel Alpha\n•📞 +1 234 567 8900`;
      const result = extractExternalHotels(text);
      expect(result.filter(h => h.phone === '+1 234 567 8900')).toHaveLength(1);
    });
  });
});
