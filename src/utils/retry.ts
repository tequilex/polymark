export interface RetryConfig {
  retries: number;
  baseDelayMs: number;
  jitter: boolean;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  sleepFn?: (ms: number) => Promise<void>;
}

export class HttpStatusError extends Error {
  public readonly status: number;
  public readonly body?: string;

  constructor(status: number, message: string, body?: string) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
    this.body = body;
  }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isLikelyNetworkTypeError(error: TypeError): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('econn') ||
    message.includes('timed out')
  );
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return isRetryableHttpStatus(error.status);
  }

  if (error instanceof TypeError) {
    return isLikelyNetworkTypeError(error);
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  return false;
}

function getDelayMs(attempt: number, baseDelayMs: number, jitter: boolean): number {
  const exponential = baseDelayMs * 2 ** attempt;
  if (!jitter) {
    return exponential;
  }

  return exponential + Math.floor(Math.random() * (baseDelayMs + 1));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof HttpStatusError) || error.status !== 429) {
    return null;
  }

  if (typeof error.body !== 'string' || error.body.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(error.body) as { retry_after?: unknown };
    const retryAfter =
      typeof parsed.retry_after === 'string'
        ? Number(parsed.retry_after)
        : parsed.retry_after;

    if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter)) {
      return null;
    }

    if (retryAfter <= 0) {
      return null;
    }

    return Math.ceil(retryAfter * 1000);
  } catch {
    return null;
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const shouldRetry = config.shouldRetry ?? isRetryableError;
  const sleepFn = config.sleepFn ?? sleep;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= config.retries || !shouldRetry(error)) {
        throw error;
      }

      const defaultDelayMs = getDelayMs(
        attempt,
        config.baseDelayMs,
        config.jitter
      );
      const retryAfterMs = getRetryAfterMs(error);
      const delayMs =
        retryAfterMs === null ? defaultDelayMs : Math.max(defaultDelayMs, retryAfterMs);
      config.onRetry?.(attempt + 1, error, delayMs);
      await sleepFn(delayMs);
      attempt += 1;
    }
  }
}
