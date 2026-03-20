export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }

  return `$${value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })}`;
}

export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }

  return `${value.toFixed(2)}x`;
}

export function formatUnixTime(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) {
    return '—';
  }

  const date = new Date(value * 1000);
  return date.toLocaleString();
}
