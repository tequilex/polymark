import { HttpStatusError, withRetry } from '../utils/retry';

export interface ClobTrade {
  [key: string]: unknown;
}

export interface ClobClientOptions {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  baseDelayMs: number;
  jitter: boolean;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://clob.polymarket.com';

export class ClobClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: Partial<ClobClientOptions> = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  async getTradesByMarket(marketId: string, limit = 500): Promise<ClobTrade[]> {
    const params = new URLSearchParams({
      market: marketId,
      limit: String(limit),
    });

    const payload = await this.requestJson(`/trades?${params.toString()}`);
    if (Array.isArray(payload)) {
      return payload;
    }

    if (
      payload &&
      typeof payload === 'object' &&
      Array.isArray((payload as { data?: unknown }).data)
    ) {
      return (payload as { data: ClobTrade[] }).data;
    }

    return [];
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
              `CLOB API request failed with status ${response.status}`,
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
