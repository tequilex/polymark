import { describe, expect, it } from 'vitest';

import {
  calculateMultiplier,
  calculateSpikeAmount,
  isBaselineReady,
  shouldAlert,
} from '../../src/worker/analyzer';

describe('analyzer', () => {
  it('marks baseline ready only when at least 24 points are present', () => {
    expect(isBaselineReady(23)).toBe(false);
    expect(isBaselineReady(24)).toBe(true);
  });

  it('triggers alert when volume is >5x baseline and >300', () => {
    expect(
      shouldAlert({
        currentHourVolume: 1200,
        baselineAvg: 200,
        multiplierThreshold: 5,
        minVolumeThreshold: 300,
      })
    ).toBe(true);
  });

  it('does not trigger when exactly 5x (strict > 5x)', () => {
    expect(
      shouldAlert({
        currentHourVolume: 1000,
        baselineAvg: 200,
        multiplierThreshold: 5,
        minVolumeThreshold: 300,
      })
    ).toBe(false);
  });

  it('does not trigger when volume <= 300', () => {
    expect(
      shouldAlert({
        currentHourVolume: 300,
        baselineAvg: 10,
        multiplierThreshold: 5,
        minVolumeThreshold: 300,
      })
    ).toBe(false);
  });

  it('calculates multiplier and spike amount', () => {
    expect(calculateMultiplier(900, 300)).toBe(3);
    expect(calculateMultiplier(100, 0)).toBe(0);
    expect(calculateSpikeAmount(900, 300)).toBe(600);
  });
});
