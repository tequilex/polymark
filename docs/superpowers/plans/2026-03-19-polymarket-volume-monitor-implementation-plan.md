# Polymarket Volume Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js service that monitors Polymarket markets every 60 seconds, detects abnormal hourly volume spikes, stores alerts in SQLite, resolves closed markets, and exposes REST API for a future React frontend.

**Architecture:** A single TypeScript Node process runs two responsibilities: worker loop (collector/analyzer/resolver) and Fastify API server. Data is persisted in SQLite with WAL mode. The worker is resilient to API failures with retries and bounded concurrency.

**Tech Stack:** Node.js 22, TypeScript, Fastify, better-sqlite3, zod, pino, Vitest, nock.

---

## Scope Guard

- This plan implements **backend only** (worker + DB + API).
- React UI is explicitly out of scope.
- Design source of truth: `docs/superpowers/specs/2026-03-19-polymarket-volume-monitor-design.md`.

## File Structure Map

### Create
- `package.json`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- `src/index.ts`
- `src/config.ts`
- `src/logger.ts`
- `src/types.ts`
- `src/utils/time.ts`
- `src/utils/retry.ts`
- `src/db/client.ts`
- `src/db/migrate.ts`
- `src/db/schema.ts`
- `src/db/repositories/volumeHistoryRepo.ts`
- `src/db/repositories/alertsRepo.ts`
- `src/polymarket/gammaClient.ts`
- `src/polymarket/clobClient.ts`
- `src/worker/aggregator.ts`
- `src/worker/analyzer.ts`
- `src/worker/alerter.ts`
- `src/worker/resolver.ts`
- `src/worker/iteration.ts`
- `src/worker/loop.ts`
- `src/api/server.ts`
- `src/api/routes.ts`
- `tests/unit/analyzer.test.ts`
- `tests/unit/aggregator.test.ts`
- `tests/unit/alerter.test.ts`
- `tests/unit/resolver.test.ts`
- `tests/unit/retry.test.ts`
- `tests/integration/api.test.ts`
- `tests/integration/iteration.test.ts`
- `tests/helpers/testDb.ts`
- `README.md`

### Modify
- `docs/superpowers/specs/2026-03-19-polymarket-volume-monitor-design.md` (only if implementation reveals hard contradictions)

---

### Task 1: Bootstrap TypeScript Service Skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/index.ts`, `src/config.ts`, `src/logger.ts`, `src/types.ts`
- Test: `tests/unit/retry.test.ts` (placeholder runner sanity)

- [ ] **Step 1: Write failing test (test runner sanity)**
```ts
import { describe, it, expect } from 'vitest';

describe('test bootstrap', () => {
  it('runs vitest', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify toolchain state**
Run: `npm test`
Expected: FAIL (before dependencies/scripts exist).

- [ ] **Step 3: Add minimal project setup**
```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 4: Re-run tests**
Run: `npm install && npm test`
Expected: PASS with 1 test.

- [ ] **Step 5: Commit**
```bash
git add package.json tsconfig.json .gitignore .env.example src/index.ts src/config.ts src/logger.ts src/types.ts tests/unit/retry.test.ts
git commit -m "chore: bootstrap node typescript service"
```

### Task 2: Implement SQLite Schema and Migration Layer

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `tests/helpers/testDb.ts`
- Test: `tests/integration/iteration.test.ts` (DB schema initialization case)

- [ ] **Step 1: Write failing DB initialization test**
```ts
it('creates required tables', () => {
  const db = createTestDb();
  runMigrations(db);
  expect(listTables(db)).toContain('volume_history');
  expect(listTables(db)).toContain('alerts');
});
```

- [ ] **Step 2: Run targeted test**
Run: `npm test -- tests/integration/iteration.test.ts`
Expected: FAIL (`runMigrations` missing).

- [ ] **Step 3: Implement schema + migration**
```ts
export function runMigrations(db: Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);
}
```

- [ ] **Step 4: Re-run targeted test**
Run: `npm test -- tests/integration/iteration.test.ts`
Expected: PASS for table creation.

- [ ] **Step 5: Commit**
```bash
git add src/db/schema.ts src/db/client.ts src/db/migrate.ts tests/helpers/testDb.ts tests/integration/iteration.test.ts
git commit -m "feat: add sqlite schema and migration layer"
```

### Task 3: Add Resilient HTTP Utility and Polymarket Clients

**Files:**
- Create: `src/utils/retry.ts`, `src/polymarket/gammaClient.ts`, `src/polymarket/clobClient.ts`
- Test: `tests/unit/retry.test.ts`

- [ ] **Step 1: Write failing retry/backoff tests**
```ts
it('retries on 429 and then succeeds', async () => {
  const result = await withRetry(fn429Then200, { retries: 3 });
  expect(result).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run targeted test**
Run: `npm test -- tests/unit/retry.test.ts`
Expected: FAIL (`withRetry` missing).

- [ ] **Step 3: Implement retry utility and clients**
```ts
export async function withRetry<T>(fn: () => Promise<T>, cfg: RetryConfig): Promise<T> {
  // retries for network/429/5xx with exponential backoff + jitter
}
```

- [ ] **Step 4: Re-run targeted test**
Run: `npm test -- tests/unit/retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/retry.ts src/polymarket/gammaClient.ts src/polymarket/clobClient.ts tests/unit/retry.test.ts
git commit -m "feat: add resilient polymarket api clients"
```

### Task 4: Implement Hourly Aggregation Logic (UTC)

**Files:**
- Create: `src/utils/time.ts`, `src/worker/aggregator.ts`
- Test: `tests/unit/aggregator.test.ts`

- [ ] **Step 1: Write failing aggregation tests**
```ts
it('aggregates trades into current UTC hour volume', () => {
  const volume = calculateCurrentHourVolume(trades, now);
  expect(volume).toBe(425.5);
});
```

- [ ] **Step 2: Run targeted tests**
Run: `npm test -- tests/unit/aggregator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement UTC bucket logic**
```ts
export function startOfUtcHour(tsSec: number): number {
  return tsSec - (tsSec % 3600);
}
```

- [ ] **Step 4: Re-run targeted tests**
Run: `npm test -- tests/unit/aggregator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/time.ts src/worker/aggregator.ts tests/unit/aggregator.test.ts
git commit -m "feat: implement utc hourly volume aggregation"
```

### Task 5: Implement Baseline and Alert Trigger Rules

**Files:**
- Create: `src/worker/analyzer.ts`, `src/worker/alerter.ts`, `src/db/repositories/volumeHistoryRepo.ts`, `src/db/repositories/alertsRepo.ts`
- Test: `tests/unit/analyzer.test.ts`, `tests/unit/alerter.test.ts`

- [ ] **Step 1: Write failing analyzer/alerter tests**
```ts
it('triggers alert when volume is >5x baseline and >300', () => {
  expect(shouldAlert({ current: 1200, baseline: 200 })).toBe(true);
});

it('blocks repeat alert within 6h cooldown', () => {
  expect(canCreateAlert(lastAlertAt, now, 6)).toBe(false);
});
```

- [ ] **Step 2: Run targeted tests**
Run: `npm test -- tests/unit/analyzer.test.ts tests/unit/alerter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement baseline + cooldown logic**
```ts
export function isBaselineReady(points: number): boolean {
  return points >= 24;
}
```

- [ ] **Step 4: Re-run targeted tests**
Run: `npm test -- tests/unit/analyzer.test.ts tests/unit/alerter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/worker/analyzer.ts src/worker/alerter.ts src/db/repositories/volumeHistoryRepo.ts src/db/repositories/alertsRepo.ts tests/unit/analyzer.test.ts tests/unit/alerter.test.ts
git commit -m "feat: add baseline analysis and alert cooldown logic"
```

### Task 6: Implement Iteration Orchestrator (60s Tick)

**Files:**
- Create: `src/worker/iteration.ts`
- Test: `tests/integration/iteration.test.ts`

- [ ] **Step 1: Write failing iteration integration test**
```ts
it('stores hourly volume and creates alert when thresholds match', async () => {
  await runMonitorIteration(ctx);
  expect(countAlerts(db)).toBe(1);
});
```

- [ ] **Step 2: Run targeted integration test**
Run: `npm test -- tests/integration/iteration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement orchestration**
```ts
export async function runMonitorIteration(ctx: IterationContext): Promise<IterationStats> {
  // fetch markets -> fetch trades -> aggregate -> upsert -> analyze -> create alerts
}
```

- [ ] **Step 4: Re-run targeted integration test**
Run: `npm test -- tests/integration/iteration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/worker/iteration.ts tests/integration/iteration.test.ts
git commit -m "feat: add monitor iteration orchestration"
```

### Task 7: Implement Resolver and P&L Calculation

**Files:**
- Create: `src/worker/resolver.ts`
- Test: `tests/unit/resolver.test.ts`

- [ ] **Step 1: Write failing resolver tests**
```ts
it('resolves open alert and calculates pnl fields for YES outcome', async () => {
  await resolveOpenAlerts(ctx);
  expect(alert.status).toBe('RESOLVED');
  expect(alert.pnl_if_yes).toBeCloseTo(1 - alert.price_yes_at_alert);
});
```

- [ ] **Step 2: Run targeted tests**
Run: `npm test -- tests/unit/resolver.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement resolver logic**
```ts
export async function resolveOpenAlerts(ctx: ResolverContext): Promise<number> {
  // every N iterations, check closed markets and fill final_outcome + pnl
}
```

- [ ] **Step 4: Re-run targeted tests**
Run: `npm test -- tests/unit/resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/worker/resolver.ts tests/unit/resolver.test.ts
git commit -m "feat: add alert resolver and pnl calculation"
```

### Task 8: Build Fastify API Endpoints for Frontend

**Files:**
- Create: `src/api/routes.ts`, `src/api/server.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/api.test.ts`

- [ ] **Step 1: Write failing API tests**
```ts
it('returns alerts list with pagination', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/alerts?limit=10' });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run targeted API tests**
Run: `npm test -- tests/integration/api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement routes and validation**
```ts
app.get('/api/health', handler);
app.get('/api/alerts', handler);
app.get('/api/alerts/:id', handler);
app.get('/api/markets/:id/volume', handler);
app.get('/api/stats/summary', handler);
```

- [ ] **Step 4: Re-run targeted API tests**
Run: `npm test -- tests/integration/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/api/routes.ts src/api/server.ts src/index.ts tests/integration/api.test.ts
git commit -m "feat: expose monitor data via fastify api"
```

### Task 9: Implement Worker Loop and Service Startup

**Files:**
- Create: `src/worker/loop.ts`
- Modify: `src/index.ts`, `src/config.ts`
- Test: `tests/integration/iteration.test.ts`

- [ ] **Step 1: Write failing loop test (resolver every 10 ticks)**
```ts
it('runs resolver every 10 iterations', async () => {
  await runLoopTicks(ctx, 10);
  expect(resolveCalls).toBe(1);
});
```

- [ ] **Step 2: Run targeted integration test**
Run: `npm test -- tests/integration/iteration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement loop scheduler**
```ts
setInterval(async () => {
  await runMonitorIteration(ctx);
  if (iteration % 10 === 0) await resolveOpenAlerts(ctx);
}, pollIntervalMs);
```

- [ ] **Step 4: Re-run targeted tests**
Run: `npm test -- tests/integration/iteration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/worker/loop.ts src/index.ts src/config.ts tests/integration/iteration.test.ts
git commit -m "feat: add 60s monitor loop with periodic resolver"
```

### Task 10: Final Verification, Docs, and VPS Runbook

**Files:**
- Create: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Write failing docs check step**
Run: `npm run build`
Expected: FAIL if any unresolved types/imports remain.

- [ ] **Step 2: Fix remaining type/build issues**
Implement minimal fixes until `npm run build` succeeds.

- [ ] **Step 3: Run full verification suite**
Run: `npm test && npm run build`
Expected: all PASS.

- [ ] **Step 4: Document operations**
Add runbook for:
- `.env` setup
- local start
- VPS start via `pm2`/`systemd`
- DB file location and backup advice

- [ ] **Step 5: Commit**
```bash
git add README.md .env.example
# add any final touched files from fixes
git commit -m "docs: add setup, verification, and vps runbook"
```

---

## Verification Checklist (Before Claiming Done)

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `GET /api/health` returns `status` and `lastSuccessfulIterationAt`.
- [ ] Cooldown behavior confirmed by test (no duplicate alert in <6h).
- [ ] Resolver behavior confirmed by test (fills `resolved_at`, `final_outcome`, `pnl_if_yes`, `pnl_if_no`).
- [ ] All code comments added where non-obvious, in Russian.

## Suggested Execution Mode

- Recommended: `superpowers:subagent-driven-development` for task-by-task implementation and review.
