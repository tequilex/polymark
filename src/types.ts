export type ServiceStatus = 'ok' | 'degraded';

export interface AppHealth {
  status: ServiceStatus;
  lastSuccessfulIterationAt: number | null;
  iterationErrors24h: number;
  db: 'ok' | 'error';
}
