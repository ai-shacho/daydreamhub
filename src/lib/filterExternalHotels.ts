export interface PartnerHotel {
  name?: string;
  phone?: string;
  tel?: string;
  telephone?: string;
}

export interface ExternalCandidate {
  name?: string;
  hotel_name?: string;
  phone?: string;
  hotel_phone?: string;
}

export function buildPartnerSets(partners: PartnerHotel[]) {
  const names = new Set<string>(
    partners.map(h => (h.name || '').toLowerCase().slice(0, 20)).filter(Boolean)
  );
  const phones = new Set<string>(
    partners.flatMap(h =>
      [h.phone, h.tel, h.telephone].filter(Boolean).map(p => (p as string).replace(/\s/g, ''))
    )
  );
  return { names, phones };
}

export function isPartnerDuplicate(
  h: ExternalCandidate,
  partnerNames: Set<string>,
  partnerPhones: Set<string>
): boolean {
  const key = (h.name || '').toLowerCase().slice(0, 20);
  const phone = (h.phone || '').replace(/\s/g, '');
  return partnerNames.has(key) || (!!phone && partnerPhones.has(phone));
}

export function filterExternalHotels(
  candidates: ExternalCandidate[],
  partners: PartnerHotel[],
  max = 5
): ExternalCandidate[] {
  const { names, phones } = buildPartnerSets(partners);
  const seen = new Set<string>();
  const result: ExternalCandidate[] = [];

  for (const h of candidates) {
    if (result.length >= max) break;
    const key = (h.hotel_name || h.name || '').toLowerCase().slice(0, 20);
    const phone = (h.hotel_phone || h.phone || '').replace(/\s/g, '');
    if (names.has(key) || (!!phone && phones.has(phone))) continue;
    if (!seen.has(key)) { seen.add(key); result.push(h); }
  }

  return result;
}
