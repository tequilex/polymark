import {
  listOpenAlerts,
  resolveAlert,
  type AlertOutcome,
} from '../db/repositories/alertsRepo';
import type { SQLiteDatabase } from '../db/client';

interface MarketResolution {
  id: string;
  [key: string]: unknown;
}

interface GammaResolverClient {
  getMarketById(marketId: string): Promise<MarketResolution | null>;
}

export interface ResolverContext {
  db: SQLiteDatabase;
  gammaClient: GammaResolverClient;
  nowSec?: number;
}

function isClosedMarket(market: MarketResolution): boolean {
  if (market.closed === true) {
    return true;
  }

  if (market.active === false) {
    return true;
  }

  const status = String(market.status ?? market.state ?? '').toLowerCase();
  return status === 'closed' || status === 'resolved' || status === 'finalized';
}

function normalizeOutcome(rawValue: unknown): AlertOutcome {
  const value = String(rawValue ?? '').toUpperCase();

  if (value === 'YES' || value === 'TRUE') {
    return 'YES';
  }

  if (value === 'NO' || value === 'FALSE') {
    return 'NO';
  }

  if (value === 'UNRESOLVED') {
    return 'UNRESOLVED';
  }

  return null;
}

function extractOutcome(market: MarketResolution): AlertOutcome {
  return (
    normalizeOutcome(market.outcome) ??
    normalizeOutcome(market.finalOutcome) ??
    normalizeOutcome(market.winner) ??
    normalizeOutcome(market.winningSide)
  );
}

function calculatePnl(
  finalOutcome: AlertOutcome,
  priceYesAtAlert: number | null,
  priceNoAtAlert: number | null
): { pnlIfYes: number | null; pnlIfNo: number | null } {
  const yesValue = finalOutcome === 'YES' ? 1 : 0;
  const noValue = finalOutcome === 'NO' ? 1 : 0;

  return {
    pnlIfYes:
      priceYesAtAlert === null ? null : yesValue - Number(priceYesAtAlert),
    pnlIfNo: priceNoAtAlert === null ? null : noValue - Number(priceNoAtAlert),
  };
}

export async function resolveOpenAlerts(
  context: ResolverContext
): Promise<number> {
  const nowSec = context.nowSec ?? Math.floor(Date.now() / 1000);
  const openAlerts = listOpenAlerts(context.db);

  let resolvedCount = 0;

  for (const alert of openAlerts) {
    try {
      const market = await context.gammaClient.getMarketById(alert.marketId);
      if (!market || !isClosedMarket(market)) {
        continue;
      }

      const outcome = extractOutcome(market);
      if (outcome === 'YES' || outcome === 'NO') {
        const pnl = calculatePnl(
          outcome,
          alert.priceYesAtAlert,
          alert.priceNoAtAlert
        );

        resolveAlert(context.db, {
          id: alert.id,
          resolvedAt: nowSec,
          finalOutcome: outcome,
          pnlIfYes: pnl.pnlIfYes,
          pnlIfNo: pnl.pnlIfNo,
          status: 'RESOLVED',
        });

        resolvedCount += 1;
      }
      // Outcome невалиден/неизвестен: оставляем OPEN и пробуем снова позже.
    } catch (_error) {
      // Ошибка по одному рынку не должна останавливать резолв остальных.
    }
  }

  return resolvedCount;
}
