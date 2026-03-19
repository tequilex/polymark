import { HttpStatusError, withRetry } from '../utils/retry';

export interface GammaMarket {
  id: string;
  question: string;
  [key: string]: unknown;
}

export interface GammaClientOptions {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  baseDelayMs: number;
  jitter: boolean;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://gamma-api.polymarket.com';

function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

function getVolumeScore(item: Record<string, unknown>): number {
  return (
    toFiniteNumber(item.volume24hr) ||
    toFiniteNumber(item.oneDayVolume) ||
    toFiniteNumber(item.volumeNum) ||
    toFiniteNumber(item.volume)
  );
}

export class GammaClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: Partial<GammaClientOptions> = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  async getTopActiveMarkets(limit: number): Promise<GammaMarket[]> {
    const params = new URLSearchParams({
      limit: String(limit),
      active: 'true',
      closed: 'false',
    });

    const payload = await this.requestJson(`/markets?${params.toString()}`);
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => {
        const id = String(item.id ?? item.marketId ?? item.conditionId ?? '');
        const question = String(item.question ?? item.title ?? '');

        return {
          ...item,
          id,
          question,
        };
      })
      .filter((item) => item.id.length > 0)
      .sort((left, right) => getVolumeScore(right) - getVolumeScore(left))
      .slice(0, limit);
  }

  private async requestJson(path: string): Promise<unknown> {
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    const retries = this.options.retries ?? 3;
    const baseDelayMs = this.options.baseDelayMs ?? 250;
    const jitter = this.options.jitter ?? true;

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await this.fetchFn(`${this.baseUrl}${path}`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
            },
          });

          if (!response.ok) {
            const body = await response.text();
            throw new HttpStatusError(
              response.status,
              `Gamma API request failed with status ${response.status}`,
              body
            );
          }

          return await response.json();
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        retries,
        baseDelayMs,
        jitter,
      }
    );
  }
}
