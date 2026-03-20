import type {
  AlertsResponseDto,
  AlertStatusFilter,
  HealthDto,
  SummaryDto,
  VolumePointDto,
  ApiErrorPayload,
} from './types';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'
).replace(/\/+$/, '');

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(`${API_BASE_URL}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    const message = payload?.error?.message ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function getHealth(): Promise<HealthDto> {
  return fetchJson<HealthDto>(buildUrl('/api/health'));
}

export async function getSummary(): Promise<SummaryDto> {
  return fetchJson<SummaryDto>(buildUrl('/api/stats/summary'));
}

export async function getAlerts(params?: {
  status?: AlertStatusFilter;
  limit?: number;
  from?: number;
  to?: number;
  marketId?: string;
}): Promise<AlertsResponseDto> {
  const status = params?.status && params.status !== 'ALL' ? params.status : undefined;

  return fetchJson<AlertsResponseDto>(
    buildUrl('/api/alerts', {
      status,
      limit: params?.limit,
      from: params?.from,
      to: params?.to,
      market_id: params?.marketId,
    })
  );
}

export async function getMarketVolume(
  marketId: string,
  params?: {
    from?: number;
    to?: number;
  }
): Promise<VolumePointDto[]> {
  return fetchJson<VolumePointDto[]>(
    buildUrl(`/api/markets/${encodeURIComponent(marketId)}/volume`, {
      from: params?.from,
      to: params?.to,
    })
  );
}
