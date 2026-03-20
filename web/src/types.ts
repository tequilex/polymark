export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  lastSuccessfulIterationAt: number | null;
  iterationErrors24h: number;
  db: 'ok' | 'error';
}

export interface SummaryDto {
  openAlerts: number;
  resolvedAlerts: number;
  avgMultiplier24h: number;
  maxSpike24h: number;
}

export interface AlertDto {
  id: number;
  marketId: string;
  question: string;
  spikeAmount: number;
  baselineAvg: number;
  multiplier: number;
  priceYesAtAlert: number | null;
  priceNoAtAlert: number | null;
  createdAt: number;
  resolvedAt: number | null;
  finalOutcome: 'YES' | 'NO' | 'UNRESOLVED' | null;
  pnlIfYes: number | null;
  pnlIfNo: number | null;
  status: 'OPEN' | 'RESOLVED' | 'ERROR';
}

export interface AlertsResponseDto {
  items: AlertDto[];
}

export interface VolumePointDto {
  marketId: string;
  timestamp: number;
  hourlyVolume: number;
}

export type AlertStatusFilter = 'ALL' | 'OPEN' | 'RESOLVED' | 'ERROR';
