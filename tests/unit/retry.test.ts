import { describe, expect, it } from 'vitest';

import { HttpStatusError, withRetry } from '../../src/utils/retry';

describe('withRetry', () => {
  it('retries on 429 and eventually succeeds', async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new HttpStatusError(429, 'rate limited');
        }

        return { ok: true };
      },
      {
        retries: 3,
        baseDelayMs: 0,
        jitter: false,
      }
    );

    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  it('retries on 500 and fails after max attempts', async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new HttpStatusError(500, 'server error');
        },
        {
          retries: 2,
          baseDelayMs: 0,
          jitter: false,
        }
      )
    ).rejects.toThrow('server error');

    expect(attempts).toBe(3);
  });

  it('does not retry on non-retryable status', async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new HttpStatusError(400, 'bad request');
        },
        {
          retries: 5,
          baseDelayMs: 0,
          jitter: false,
        }
      )
    ).rejects.toThrow('bad request');

    expect(attempts).toBe(1);
  });

  it('retries on network error and eventually succeeds', async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new TypeError('fetch failed');
        }

        return 'ok';
      },
      {
        retries: 2,
        baseDelayMs: 0,
        jitter: false,
      }
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});
