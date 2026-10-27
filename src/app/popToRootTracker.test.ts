import { describe, expect, it } from 'vitest';
import { PopToRootTracker } from './popToRootTracker';

function clock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

describe('PopToRootTracker', () => {
  it('does nothing for a window that was never hidden', () => {
    const t = new PopToRootTracker(clock().now);
    expect(t.consumeShown('immediate')).toBe(false);
  });

  it('keeps the state while the hidden time stays below the delay', () => {
    const c = clock();
    const t = new PopToRootTracker(c.now);
    t.markHidden();
    c.advance(29_000);
    expect(t.consumeShown('30s')).toBe(false);
  });

  it('pops to root once the delay elapsed, then forgets the hide', () => {
    const c = clock();
    const t = new PopToRootTracker(c.now);
    t.markHidden();
    c.advance(31_000);
    expect(t.consumeShown('30s')).toBe(true);
    expect(t.consumeShown('30s')).toBe(false);
  });

  it('never pops with the "never" delay', () => {
    const c = clock();
    const t = new PopToRootTracker(c.now);
    t.markHidden();
    c.advance(24 * 3_600_000);
    expect(t.consumeShown('never')).toBe(false);
  });

  it('resets on every reopening with the immediate delay', () => {
    const c = clock();
    const t = new PopToRootTracker(c.now);
    t.markHidden();
    expect(t.consumeShown('immediate')).toBe(true);
    t.markHidden();
    c.advance(1);
    expect(t.consumeShown('immediate')).toBe(true);
  });

  it('keeps the earliest hide mark when several signals arrive', () => {
    const c = clock();
    const t = new PopToRootTracker(c.now);
    t.markHidden();
    c.advance(40_000);
    t.markHidden();
    expect(t.consumeShown('30s')).toBe(true);
  });

  it('cancels a pending hide', () => {
    const c = clock();
    const t = new PopToRootTracker(c.now);
    t.markHidden();
    c.advance(120_000);
    t.cancel();
    expect(t.consumeShown('30s')).toBe(false);
  });
});
