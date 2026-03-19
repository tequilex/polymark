import { describe, expect, it } from 'vitest';

import { calculateCurrentHourVolume, startOfUtcHour } from '../../src/worker/aggregator';

describe('startOfUtcHour', () => {
  it('returns hour boundary for unix seconds', () => {
    expect(startOfUtcHour(1_710_000_123)).toBe(1_710_000_000);
  });
});

describe('calculateCurrentHourVolume', () => {
  it('aggregates only trades from current UTC hour', () => {
    const now = 1_710_000_999;

    const trades = [
      { timestamp: 1_710_000_010, size: 10, price: 0.4 },
      { timestamp: 1_710_000_050, notional: 120 },
      { timestamp: 1_710_000_400, usdVolume: 30 },
      { timestamp: 1_709_999_999, usdVolume: 500 },
      { timestamp: 1_710_003_600, usdVolume: 200 },
    ];

    expect(calculateCurrentHourVolume(trades, now)).toBeCloseTo(154);
  });

  it('supports millisecond timestamps', () => {
    const now = 1_710_000_999;

    const trades = [
      { timestamp: 1_710_000_100_000, usdVolume: 12 },
      { timestamp: 1_709_999_999_000, usdVolume: 50 },
    ];

    expect(calculateCurrentHourVolume(trades, now)).toBe(12);
  });

  it('ignores trades that are later than now within the same hour', () => {
    const now = 1_710_000_120;

    const trades = [
      { timestamp: 1_710_000_100, usdVolume: 20 },
      { timestamp: 1_710_000_120, usdVolume: 5 },
      { timestamp: 1_710_000_900, usdVolume: 300 },
    ];

    expect(calculateCurrentHourVolume(trades, now)).toBe(20);
  });

  it('returns zero for malformed trades', () => {
    const now = 1_710_000_999;

    const trades = [
      { foo: 'bar' },
      { timestamp: 'not-a-number', amount: 'x' },
    ];

    expect(calculateCurrentHourVolume(trades, now)).toBe(0);
  });
});
