import { describe, expect, it } from 'vitest';

import { ClobClient } from '../../src/polymarket/clobClient';
import { GammaClient } from '../../src/polymarket/gammaClient';

describe('GammaClient', () => {
  it('requests active markets and returns them sorted by volume desc', async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      calls.push(String(input));

      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: 'm-1', question: 'A', volume24hr: '20' },
          { id: 'm-2', question: 'B', volume24hr: '100' },
          { id: 'm-3', title: 'C', volume: 50 },
        ],
      } as Response;
    };

    const client = new GammaClient({
      fetchFn,
      retries: 0,
      jitter: false,
      baseDelayMs: 0,
      timeoutMs: 1000,
    });

    const markets = await client.getTopActiveMarkets(2);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/markets?');
    expect(calls[0]).toContain('active=true');
    expect(calls[0]).toContain('closed=false');
    expect(calls[0]).toContain('limit=2');
    expect(markets.map((market) => market.id)).toEqual(['m-2', 'm-3']);
    expect(markets[1]?.question).toBe('C');
  });
});

describe('ClobClient', () => {
  it('extracts trades from data envelope', async () => {
    const fetchFn: typeof fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 't-1' }, { id: 't-2' }],
        }),
      } as Response;
    };

    const client = new ClobClient({
      fetchFn,
      retries: 0,
      jitter: false,
      baseDelayMs: 0,
      timeoutMs: 1000,
    });

    const trades = await client.getTradesByMarket('market-1');
    expect(trades).toHaveLength(2);
  });

  it('returns empty array for unknown payload shape', async () => {
    const fetchFn: typeof fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ foo: 'bar' }),
      } as Response;
    };

    const client = new ClobClient({
      fetchFn,
      retries: 0,
      jitter: false,
      baseDelayMs: 0,
      timeoutMs: 1000,
    });

    const trades = await client.getTradesByMarket('market-1');
    expect(trades).toEqual([]);
  });
});

describe('GammaClient market details', () => {
  it('fetches a market by id', async () => {
    const calls: string[] = [];

    const fetchFn: typeof fetch = async (input) => {
      calls.push(String(input));

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'm-10',
          question: 'Will it happen?',
          closed: true,
        }),
      } as Response;
    };

    const client = new GammaClient({
      fetchFn,
      retries: 0,
      jitter: false,
      baseDelayMs: 0,
      timeoutMs: 1000,
    });

    const market = await client.getMarketById('m-10');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/markets/m-10');
    expect(market?.id).toBe('m-10');
    expect(market?.question).toBe('Will it happen?');
  });
});
