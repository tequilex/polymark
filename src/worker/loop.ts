import type { IterationStats } from './iteration';

interface LoopLogger {
  info?: (meta: Record<string, unknown>, message?: string) => void;
  warn?: (meta: Record<string, unknown>, message?: string) => void;
}

export interface LoopContext {
  runIteration: () => Promise<IterationStats>;
  resolveAlerts: () => Promise<number>;
  resolveEveryNIterations: number;
  logger?: LoopLogger;
  nowSec?: () => number;
  onIterationSuccess?: (timestampSec: number, stats: IterationStats) => void;
  onIterationError?: (timestampSec: number, error: unknown) => void;
}

export interface StartMonitorLoopContext extends LoopContext {
  pollIntervalSec: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface MonitorLoopHandle {
  stop: () => void;
  done: Promise<void>;
}

const DEFAULT_POLL_INTERVAL_SEC = 60;

function defaultNowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getResolveEvery(resolveEveryNIterations: number): number {
  if (!Number.isFinite(resolveEveryNIterations)) {
    return 10;
  }

  return Math.max(1, Math.floor(resolveEveryNIterations));
}

async function runSingleTick(
  context: LoopContext,
  iterationNumber: number
): Promise<void> {
  const nowSec = context.nowSec ?? defaultNowSec;

  try {
    const stats = await context.runIteration();
    context.onIterationSuccess?.(nowSec(), stats);
  } catch (error) {
    context.onIterationError?.(nowSec(), error);
    context.logger?.warn?.(
      {
        err: error,
        iteration: iterationNumber,
      },
      'monitor iteration failed'
    );
  }

  // Резолвер запускается периодически, независимо от результата конкретного тика.
  if (iterationNumber % getResolveEvery(context.resolveEveryNIterations) !== 0) {
    return;
  }

  try {
    const resolved = await context.resolveAlerts();
    context.logger?.info?.(
      {
        iteration: iterationNumber,
        resolved,
      },
      'monitor resolver completed'
    );
  } catch (error) {
    context.onIterationError?.(nowSec(), error);
    context.logger?.warn?.(
      {
        err: error,
        iteration: iterationNumber,
      },
      'monitor resolver failed'
    );
  }
}

export async function runLoopTicks(
  context: LoopContext,
  ticks: number
): Promise<void> {
  const totalTicks = Math.max(0, Math.floor(ticks));

  for (let tick = 1; tick <= totalTicks; tick += 1) {
    await runSingleTick(context, tick);
  }
}

export function startMonitorLoop(
  context: StartMonitorLoopContext
): MonitorLoopHandle {
  const sleep = context.sleepFn ?? defaultSleep;
  const pollIntervalSec = Number.isFinite(context.pollIntervalSec)
    ? Math.max(1, Math.floor(context.pollIntervalSec))
    : DEFAULT_POLL_INTERVAL_SEC;

  let stopped = false;
  let iterationNumber = 0;
  let releaseStopWait: (() => void) | null = null;

  const stopWait = new Promise<void>((resolve) => {
    releaseStopWait = resolve;
  });

  const done = (async () => {
    while (!stopped) {
      iterationNumber += 1;
      await runSingleTick(context, iterationNumber);

      if (stopped) {
        return;
      }

      // Остановка должна мгновенно прерывать ожидание паузы между тиками.
      await Promise.race([sleep(pollIntervalSec * 1000), stopWait]);
    }
  })();

  return {
    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;
      releaseStopWait?.();
    },
    done,
  };
}
