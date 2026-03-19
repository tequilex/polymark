export interface RetryConfig {
  retries: number;
  baseDelayMs: number;
  jitter: boolean;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
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

export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return isRetryableHttpStatus(error.status);
  }

  if (error instanceof TypeError) {
    return true;
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

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const shouldRetry = config.shouldRetry ?? isRetryableError;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= config.retries || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = getDelayMs(attempt, config.baseDelayMs, config.jitter);
      config.onRetry?.(attempt + 1, error, delayMs);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
