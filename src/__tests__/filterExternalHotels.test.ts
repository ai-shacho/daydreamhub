import { describe, it, expect } from 'vitest';
import { filterExternalHotels, buildPartnerSets } from '../lib/filterExternalHotels';

const PARTNERS = [
  { name: 'The Pantip Hotel Ladprao Bangkok', phone: '+66 2 622 3225' },
  { name: 'S Box Sukhumvit Hotel Sha Extra', phone: '+66 83 616 9854' },
  { name: '185surawong Residence Standard', phone: '+66 2 236 7777' },
];

const EXTERNAL_CANDIDATES = [
  { name: 'Pullman Bangkok King Power', phone: '+66 2 680 9999' },
  { name: 'Centara Grand', phone: '+66 2 100 1234' },
  { name: 'The Pantip Hotel Ladprao Bangkok', phone: '+66 2 622 3225' }, // 自社と同名・同電話
  { name: 'Novotel Bangkok', phone: '+66 2 209 8888' },
  { name: 'S Box Sukhumvit Hotel Sha Extra', phone: '+66 83 616 9854' }, // 自社と同名・同電話
  { name: 'Ibis Bangkok', phone: '+66 2 659 2888' },
];

describe('filterExternalHotels', () => {
  it('自社ホテルと同名の候補を除外する', () => {
    const result = filterExternalHotels(EXTERNAL_CANDIDATES, PARTNERS);
    const names = result.map(h => h.name);
    expect(names).not.toContain('The Pantip Hotel Ladprao Bangkok');
    expect(names).not.toContain('S Box Sukhumvit Hotel Sha Extra');
  });

  it('自社ホテルと同じ電話番号の候補を除外する', () => {
    const candidates = [
      { name: 'Different Name But Same Phone', phone: '+66 2 622 3225' }, // 自社と同電話
      { name: 'Totally External Hotel', phone: '+66 2 999 0000' },
    ];
    const result = filterExternalHotels(candidates, PARTNERS);
    expect(result.map(h => h.name)).not.toContain('Different Name But Same Phone');
    expect(result.map(h => h.name)).toContain('Totally External Hotel');
  });

  it('純粋な外部ホテルは残す', () => {
    const result = filterExternalHotels(EXTERNAL_CANDIDATES, PARTNERS);
    const names = result.map(h => h.name);
    expect(names).toContain('Pullman Bangkok King Power');
    expect(names).toContain('Centara Grand');
    expect(names).toContain('Novotel Bangkok');
  });

  it('max 件数を超えない', () => {
    const result = filterExternalHotels(EXTERNAL_CANDIDATES, PARTNERS, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('提携ホテルが0件でも全候補を返す（最大 max 件）', () => {
    const result = filterExternalHotels(EXTERNAL_CANDIDATES, [], 5);
    expect(result.length).toBe(5);
  });

  it('電話番号のスペース有無を正規化して比較する', () => {
    const candidates = [
      { name: 'Hotel Spaced Phone', phone: '+66 2 622 3225' },   // スペースあり（自社と同じ）
      { name: 'Hotel Compact Phone', phone: '+6626223225' },      // スペースなし（自社と同じ）
    ];
    const result = filterExternalHotels(candidates, PARTNERS);
    expect(result).toHaveLength(0);
  });

  it('重複する名前の候補を1件だけ返す', () => {
    const candidates = [
      { name: 'Hotel Alpha', phone: '+1 111 111 1111' },
      { name: 'Hotel Alpha', phone: '+1 222 222 2222' }, // 名前重複
    ];
    const result = filterExternalHotels(candidates, []);
    expect(result.filter(h => h.name === 'Hotel Alpha')).toHaveLength(1);
  });
});

describe('buildPartnerSets', () => {
  it('名前セットを正しく生成する（先頭20文字で比較）', () => {
    const { names } = buildPartnerSets(PARTNERS);
    // 'The Pantip Hotel Ladprao Bangkok'.toLowerCase().slice(0, 20) === 'the pantip hotel ladr'... 実際は20文字
    expect(names.has('the pantip hotel lad')).toBe(true);
    expect(names.has('s box sukhumvit hote')).toBe(true);
  });

  it('電話番号セットからスペースを除去して生成する', () => {
    const { phones } = buildPartnerSets(PARTNERS);
    expect(phones.has('+6626223225')).toBe(true);
    expect(phones.has('+66836169854')).toBe(true);
  });
});
