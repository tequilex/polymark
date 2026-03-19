export function toUnixSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  // Значения больше 10^12 трактуем как миллисекунды.
  if (Math.abs(value) >= 1_000_000_000_000) {
    return Math.floor(value / 1000);
  }

  return Math.floor(value);
}

export function startOfUtcHour(tsSec: number): number {
  return tsSec - (tsSec % 3600);
}
