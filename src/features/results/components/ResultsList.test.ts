import { describe, expect, it } from 'vitest';
import { getSectionOrder } from '../resultSections';

describe('getSectionOrder', () => {
  it('keeps the order of the highest-ranked result in each section', () => {
    const grouped = new Map<string, unknown[]>([
      ['games', [{ score: 900 }]],
      ['applications', [{ score: 300 }, { score: 290 }]],
      ['results', [{ score: 200 }]],
    ]);

    expect(getSectionOrder(grouped)).toEqual(['games', 'applications', 'results']);
  });
});
