import { startOfUtcHour, toUnixSeconds } from '../utils/time';

interface TradeLike {
  [key: string]: unknown;
}

function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

function getTradeTimestampSec(trade: TradeLike): number {
  const raw =
    toFiniteNumber(trade.timestamp) ||
    toFiniteNumber(trade.time) ||
    toFiniteNumber(trade.createdAt) ||
    toFiniteNumber(trade.created_at);

  return toUnixSeconds(raw);
}

function getTradeUsdVolume(trade: TradeLike): number {
  const directUsd =
    toFiniteNumber(trade.usdVolume) ||
    toFiniteNumber(trade.usd_volume) ||
    toFiniteNumber(trade.amountUsd) ||
    toFiniteNumber(trade.notional);

  if (directUsd > 0) {
    return directUsd;
  }

  const amount =
    toFiniteNumber(trade.amount) ||
    toFiniteNumber(trade.size) ||
    toFiniteNumber(trade.quantity);

  const price = toFiniteNumber(trade.price);
  const multiplied = amount * price;

  return multiplied > 0 ? multiplied : 0;
}

export function calculateCurrentHourVolume(
  trades: unknown[],
  nowSec: number
): number {
  const nowHourStart = startOfUtcHour(nowSec);

  return trades
    .filter((trade): trade is TradeLike => typeof trade === 'object' && trade !== null)
    .reduce((sum, trade) => {
      const tsSec = getTradeTimestampSec(trade);
      if (!Number.isFinite(tsSec)) {
        return sum;
      }

      if (tsSec < nowHourStart || tsSec > nowSec) {
        return sum;
      }

      return sum + getTradeUsdVolume(trade);
    }, 0);
}

export { startOfUtcHour };
