// Shared hotel-category tag handling. DB values arrive in many variants
// ('early_check-in', 'transit_use', 'for work', 'couple' …) — normalize first
// so every tag resolves to one canonical key for colors and i18n labels.
import { t } from './i18n';

const CATEGORY_ALIASES: Record<string, string> = {
  early_check_in: 'early_checkin',
  transit_use: 'transit',
  couple: 'for_couple',
  couples: 'for_couple',
  for_work: 'workspace',
  work: 'workspace',
  remote_work: 'workspace',
  day_use: 'daycation',
  dayuse: 'daycation',
  personal: 'personal_time',
};

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  workspace: 'search.workspace',
  luxury: 'search.luxury',
  transit: 'search.transit',
  for_couple: 'search.for_couple',
  daycation: 'search.daycation',
  personal_time: 'search.personal_time',
  early_checkin: 'search.early_checkin',
};

const CATEGORY_COLORS: Record<string, string> = {
  workspace: 'bg-blue-100 text-blue-700',
  luxury: 'bg-purple-100 text-purple-700',
  transit: 'bg-green-100 text-green-700',
  for_couple: 'bg-pink-100 text-pink-700',
  daycation: 'bg-yellow-100 text-yellow-700',
  personal_time: 'bg-orange-100 text-orange-700',
  early_checkin: 'bg-teal-100 text-teal-700',
};

export function normalizeCategory(c: unknown): string {
  const n = String(c || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  return CATEGORY_ALIASES[n] || n;
}

export function categoryColor(c: unknown): string {
  return CATEGORY_COLORS[normalizeCategory(c)] || 'bg-gray-100 text-gray-700';
}

export function categoryLabel(c: unknown, locale: string): string {
  const key = CATEGORY_LABEL_KEYS[normalizeCategory(c)];
  if (key) return t(key, locale);
  return String(c || '').replace(/_/g, ' ');
}
