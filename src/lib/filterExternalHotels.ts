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
  lat?: number | null;
  lng?: number | null;
  /** Set by sortByProximity when a distance could be worked out. */
  distance_km?: number;
}

export interface Coords { lat: number; lng: number }

/**
 * Beyond this, "nearest to you" stops meaning anything. Someone in Tokyo asking
 * about Bangkok is 4,600km from every candidate; ordering those by distance
 * from Tokyo produces an order that looks considered and is arbitrary. Past the
 * cut-off the original ranking is kept instead.
 */
const NEAR_ENOUGH_KM = 150;

/** Great-circle distance in km. */
export function distanceKm(a: Coords, b: Coords): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Put the candidates closest to the guest first, so the three offered for a
 * call are the three they could actually walk to.
 *
 * Returns the list untouched when there is no position, when no candidate has
 * coordinates, or when the guest is nowhere near them — see NEAR_ENOUGH_KM.
 * Candidates without coordinates keep their relative order and go last: an
 * unknown distance is not a short one.
 */
export function sortByProximity<T extends ExternalCandidate>(
  candidates: T[],
  near?: Coords | null
): T[] {
  if (!near || !Number.isFinite(near.lat) || !Number.isFinite(near.lng)) return candidates;

  const withDistance = candidates.map((h, i) => {
    const hasCoords = Number.isFinite(h.lat as number) && Number.isFinite(h.lng as number);
    return {
      h,
      i,
      km: hasCoords ? distanceKm(near, { lat: h.lat as number, lng: h.lng as number }) : null,
    };
  });

  const measured = withDistance.filter((x) => x.km !== null);
  if (measured.length === 0) return candidates;

  // Judge on the closest candidate: if even that one is far away, the guest is
  // asking about somewhere else and proximity is not what they meant.
  const closest = Math.min(...measured.map((x) => x.km as number));
  if (closest > NEAR_ENOUGH_KM) return candidates;

  return withDistance
    .sort((a, b) => {
      if (a.km === null && b.km === null) return a.i - b.i;
      if (a.km === null) return 1;
      if (b.km === null) return -1;
      return (a.km as number) - (b.km as number) || a.i - b.i;
    })
    .map(({ h, km }) => (km === null ? h : { ...h, distance_km: Math.round(km * 10) / 10 }));
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
