import {
  createAlert,
  getLastAlertCreatedAt,
} from '../db/repositories/alertsRepo';
import {
  getBaselineSnapshot,
  upsertVolumeHistory,
} from '../db/repositories/volumeHistoryRepo';
import type { SQLiteDatabase } from '../db/client';
import { calculateCurrentHourVolume } from './aggregator';
import {
  calculateMultiplier,
  calculateSpikeAmount,
  isBaselineReady,
  shouldAlert,
} from './analyzer';
import { canCreateAlert } from './alerter';
import { startOfUtcHour } from '../utils/time';

interface MarketLike {
  id: string;
  question?: string;
  [key: string]: unknown;
}

interface GammaLikeClient {
  getTopActiveMarkets(limit: number): Promise<MarketLike[]>;
}

interface ClobLikeClient {
  getTradesByMarket(
    marketId: string,
    limit?: number,
    offset?: number
  ): Promise<unknown[]>;
}

interface LoggerLike {
  warn?: (meta: Record<string, unknown>, message?: string) => void;
}

export interface IterationContext {
  db: SQLiteDatabase;
  gammaClient: GammaLikeClient;
  clobClient: ClobLikeClient;
  nowSec?: number;
  topMarketsLimit: number;
  baselineDays: number;
  alertMultiplier: number;
  alertMinVolume: number;
  alertCooldownHours: number;
  requestConcurrency: number;
  tradePageSize?: number;
  maxTradePages?: number;
  logger?: LoggerLike;
}

export interface IterationStats {
  marketsProcessed: number;
  alertsCreated: number;
  errorsCount: number;
}

function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

function extractPriceYes(market: MarketLike): number | null {
  const value =
    toFiniteNumber(market.yesPrice) ||
    toFiniteNumber(market.priceYes) ||
    toFiniteNumber(market.yes_price) ||
    toFiniteNumber(market.bestAskYes);

  return value > 0 ? value : null;
}

function extractPriceNo(market: MarketLike): number | null {
  const value =
    toFiniteNumber(market.noPrice) ||
    toFiniteNumber(market.priceNo) ||
    toFiniteNumber(market.no_price) ||
    toFiniteNumber(market.bestAskNo);

  return value > 0 ? value : null;
}

function getQuestion(market: MarketLike): string {
  return String(market.question ?? market.title ?? market.id);
}

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let index = 0;
  const workers = Array.from({
    length: Math.min(items.length, Math.max(1, concurrency)),
  }).map(async () => {
    while (true) {
      const currentIndex = index;
      index += 1;

      if (currentIndex >= items.length) {
        return;
      }

      await worker(items[currentIndex]);
    }
  });

  await Promise.all(workers);
}

async function fetchTradesWithPagination(
  client: ClobLikeClient,
  marketId: string,
  pageSize: number,
  maxPages: number
): Promise<{ trades: unknown[]; truncated: boolean }> {
  const trades: unknown[] = [];
  let offset = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const pageTrades = await client.getTradesByMarket(marketId, pageSize, offset);
    trades.push(...pageTrades);

    if (page === maxPages - 1 && pageTrades.length === pageSize) {
      truncated = true;
    }

    if (pageTrades.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return { trades, truncated };
}

export async function runMonitorIteration(
  context: IterationContext
): Promise<IterationStats> {
  const stats: IterationStats = {
    marketsProcessed: 0,
    alertsCreated: 0,
    errorsCount: 0,
  };

  const nowSec = context.nowSec ?? Math.floor(Date.now() / 1000);
  const currentHourStart = startOfUtcHour(nowSec);
  const baselineFrom = currentHourStart - context.baselineDays * 24 * 3600;
  const tradePageSize = context.tradePageSize ?? 500;
  const maxTradePages = context.maxTradePages ?? 10;

  let markets: MarketLike[] = [];
  try {
    markets = await context.gammaClient.getTopActiveMarkets(context.topMarketsLimit);
  } catch (error) {
    stats.errorsCount += 1;
    context.logger?.warn?.(
      {
        err: error,
      },
      'iteration markets fetch failed'
    );
    return stats;
  }

  await forEachWithConcurrency(
    markets,
    context.requestConcurrency,
    async (market) => {
      stats.marketsProcessed += 1;

      try {
        const paginated = await fetchTradesWithPagination(
          context.clobClient,
          market.id,
          tradePageSize,
          maxTradePages
        );
        if (paginated.truncated) {
          context.logger?.warn?.(
            {
              marketId: market.id,
              tradePageSize,
              maxTradePages,
            },
            'iteration trades truncated by pagination cap'
          );
        }

        const currentHourVolume = calculateCurrentHourVolume(
          paginated.trades,
          nowSec
        );

        upsertVolumeHistory(context.db, {
          marketId: market.id,
          timestamp: currentHourStart,
          hourlyVolume: currentHourVolume,
        });

        const baseline = getBaselineSnapshot(
          context.db,
          market.id,
          baselineFrom,
          currentHourStart
        );

        if (!isBaselineReady(baseline.points)) {
          return;
        }

        if (
          !shouldAlert({
            currentHourVolume,
            baselineAvg: baseline.average,
            multiplierThreshold: context.alertMultiplier,
            minVolumeThreshold: context.alertMinVolume,
          })
        ) {
          return;
        }

        const lastAlertAt = getLastAlertCreatedAt(context.db, market.id);
        if (
          !canCreateAlert(lastAlertAt, nowSec, context.alertCooldownHours)
        ) {
          return;
        }

        const multiplier = calculateMultiplier(
          currentHourVolume,
          baseline.average
        );
        const spikeAmount = calculateSpikeAmount(
          currentHourVolume,
          baseline.average
        );

        createAlert(context.db, {
          marketId: market.id,
          question: getQuestion(market),
          spikeAmount,
          baselineAvg: baseline.average,
          multiplier,
          priceYesAtAlert: extractPriceYes(market),
          priceNoAtAlert: extractPriceNo(market),
          createdAt: nowSec,
        });

        stats.alertsCreated += 1;
      } catch (error) {
        stats.errorsCount += 1;
        context.logger?.warn?.(
          {
            err: error,
            marketId: market.id,
          },
          'iteration market processing failed'
        );
      }
    }
  );

  return stats;
}
