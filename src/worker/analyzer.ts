export interface ShouldAlertParams {
  currentHourVolume: number;
  baselineAvg: number;
  multiplierThreshold: number;
  minVolumeThreshold: number;
}

export function isBaselineReady(points: number): boolean {
  return points >= 24;
}

export function calculateMultiplier(
  currentHourVolume: number,
  baselineAvg: number
): number {
  if (baselineAvg <= 0) {
    return 0;
  }

  return currentHourVolume / baselineAvg;
}

export function calculateSpikeAmount(
  currentHourVolume: number,
  baselineAvg: number
): number {
  return currentHourVolume - baselineAvg;
}

export function shouldAlert(params: ShouldAlertParams): boolean {
  if (params.currentHourVolume <= params.minVolumeThreshold) {
    return false;
  }

  const multiplier = calculateMultiplier(
    params.currentHourVolume,
    params.baselineAvg
  );

  return multiplier > params.multiplierThreshold;
}
