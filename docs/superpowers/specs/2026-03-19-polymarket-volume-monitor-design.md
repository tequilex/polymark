# Polymarket Volume Monitor - Design Spec

- Дата: 2026-03-19
- Статус: Draft (validated with user)
- Цель: детектировать аномальные всплески объемов на Polymarket и сохранять сигналы для последующего анализа и вывода на React-фронт.

## 1. Контекст и цель

Нужен backend-сервис на Node.js, работающий 24/7 на VPS, который:
- опрашивает Polymarket API,
- считает почасовой объем рынка,
- сравнивает с базовым уровнем за 7 дней,
- фиксирует алерты при резком всплеске,
- периодически резолвит исходы закрытых рынков и считает P&L по сохраненному snapshot.

React-фронт будет во 2 этапе. На 1 этапе реализуются монитор, БД и API для чтения данных.

## 2. Scope

### In scope (этап 1)
- Worker мониторинга (60с цикл).
- SQLite-хранилище (`polymarket.db`).
- API для фронта:
  - `GET /api/health`
  - `GET /api/alerts`
  - `GET /api/alerts/:id`
  - `GET /api/markets/:id/volume`
  - `GET /api/stats/summary`
- Resolver закрытых рынков каждые 10 итераций.
- Устойчивость к ошибкам API (retry/backoff/timeout, без падения процесса).

### Out of scope (этап 1)
- UI/React-реализация.
- Торговое исполнение/автотрейдинг.
- Учет комиссий и проскальзывания в P&L.
- Миграция на Postgres/Kafka и горизонтальное масштабирование.

## 3. Функциональные требования

1. Каждые 60 секунд запрашивать топ-100 активных рынков с `https://gamma-api.polymarket.com/markets`.
2. Для каждого рынка запрашивать трейды с `https://clob.polymarket.com/trades`.
3. Считать почасовой объем по трейдам в UTC.
4. Сравнивать текущий час с базовым средним за 7 дней.
5. Если `current_hour_volume > baseline_avg * 5` и `current_hour_volume > 300`, создавать алерт.
6. Не создавать повторный алерт по рынку чаще чем раз в 6 часов.
7. Каждые 10 итераций проверять закрытые рынки, резолвить `OPEN`-алерты, сохранять итог и P&L.
8. Любые ошибки внешних API не должны останавливать процесс.
9. Код должен содержать комментарии на русском языке (требование к реализации).

## 4. Нефункциональные требования

- Режим работы: 24/7 на VPS.
- Время: все вычисления и timestamp в UTC.
- Наблюдаемость: структурированные JSON-логи.
- Простота деплоя: один процесс (API + worker) как MVP.
- Конфигурируемость через `.env`.

## 5. Выбранный стек

- Runtime: `Node.js 22 LTS`
- Язык: `TypeScript`
- HTTP server: `Fastify`
- HTTP client: встроенный `fetch` (`undici`)
- DB: `SQLite` + `better-sqlite3`
- Logging: `pino`
- Validation: `zod`
- Process manager на VPS: `systemd` или `pm2`

Почему так:
- минимальная операционная сложность для MVP,
- низкий time-to-market,
- быстрый переход к фронту благодаря простому REST API.

## 6. Архитектура компонентов

Один процесс, разделенный на модули:

- `src/worker/collector.ts` — загрузка рынков и трейдов из API.
- `src/worker/aggregator.ts` — расчет почасовых объемов в UTC.
- `src/worker/analyzer.ts` — baseline и trigger-логика аномалии.
- `src/worker/alerter.ts` — cooldown-проверка и запись алертов.
- `src/worker/resolver.ts` — резолв `OPEN`-алертов по закрытым рынкам, расчет P&L.
- `src/worker/loop.ts` — оркестрация 60-секундного цикла и шага резолва на 10-й итерации.
- `src/db/schema.ts` / `src/db/client.ts` — схема и доступ к SQLite.
- `src/api/routes/*.ts` — REST endpoints для фронта.
- `src/config.ts` — чтение и валидация `.env`.
- `src/logger.ts` — единый логгер.

## 7. Модель данных (SQLite)

Файл БД: `polymarket.db`

### 7.1 Таблица `volume_history`

```sql
CREATE TABLE IF NOT EXISTS volume_history (
  market_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL, -- unix seconds, start of UTC hour
  hourly_volume REAL NOT NULL,
  PRIMARY KEY (market_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_volume_history_timestamp
  ON volume_history(timestamp);

CREATE INDEX IF NOT EXISTS idx_volume_history_market
  ON volume_history(market_id);
```

### 7.2 Таблица `alerts`

```sql
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  question TEXT NOT NULL,
  spike_amount REAL NOT NULL,
  baseline_avg REAL NOT NULL,
  multiplier REAL NOT NULL,
  price_yes_at_alert REAL,
  price_no_at_alert REAL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  final_outcome TEXT, -- YES | NO | UNRESOLVED
  pnl_if_yes REAL,
  pnl_if_no REAL,
  status TEXT NOT NULL DEFAULT 'OPEN' -- OPEN | RESOLVED | ERROR
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_created
  ON alerts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_market_created
  ON alerts(market_id, created_at DESC);
```

## 8. Детализация алгоритмов

### 8.1 Итерация мониторинга (каждые 60 секунд)

1. Получить топ-100 активных рынков.
2. По каждому рынку получить трейды (с ограничением конкурентности запросов).
3. Из трейдов вычислить объем текущего UTC-часа.
4. Upsert текущий бакет в `volume_history`.
5. Рассчитать baseline: средний `hourly_volume` по завершенным часовым бакетам за последние 7 суток.
6. Рассчитать `multiplier = current / baseline` (если baseline == 0, алерт не создавать до появления исторической базы).
   Дополнительно: baseline считается валидным только при наличии минимум 24 завершенных часовых бакетов за последние 7 дней; до этого алерты не генерируются.
7. Проверить правила алерта и cooldown.
8. Если условия выполнены, записать алерт в `alerts`.

### 8.2 Правило алерта

Алерт создается только если одновременно:
- `current_hour_volume > baseline_avg * 5`
- `current_hour_volume > 300`
- по этому `market_id` нет алерта за последние 6 часов

Поля при создании:
- `spike_amount = current_hour_volume - baseline_avg`
- `multiplier = current_hour_volume / baseline_avg`
- цены `price_yes_at_alert` и `price_no_at_alert` (если доступны из данных рынка)

### 8.3 Резолв (каждые 10 итераций)

1. Выбрать `alerts` со статусом `OPEN`.
2. Проверить по API, закрыт ли соответствующий рынок и известен ли исход.
3. Если исход доступен:
   - `resolved_at = now_utc`
   - `final_outcome = YES | NO`
   - `status = RESOLVED`
   - рассчитать P&L для модели 1 контракта:
     - `pnl_if_yes = (final_outcome == YES ? 1 : 0) - price_yes_at_alert`
     - `pnl_if_no = (final_outcome == NO ? 1 : 0) - price_no_at_alert`
4. Если исход пока невалиден/недоступен, оставить `OPEN` и повторить на следующих циклах.

### 8.4 Идемпотентность агрегации и защита от дублей

- Для каждого рынка на каждом тике текущий час пересчитывается детерминированно как сумма всех трейдов в интервале `[hour_start_utc, now_utc)`.
- В `volume_history` используется upsert по ключу `(market_id, timestamp)`, поэтому запись часа обновляется, а не дублируется.
- Для baseline берутся только завершенные часы (`timestamp < current_hour_start`), чтобы исключить смещение из-за неполного текущего часа.

## 9. API контракт (для React этапа 2)

### `GET /api/health`
- Ответ:
  - `status: "ok" | "degraded"`
  - `lastSuccessfulIterationAt: number | null`
  - `iterationErrors24h: number`
  - `db: "ok" | "error"`

### `GET /api/alerts`
- Query:
  - `status?: OPEN|RESOLVED|ERROR`
  - `market_id?: string`
  - `from?: unix`
  - `to?: unix`
  - `limit?: number` (default 50, max 200)
  - `offset?: number`
- Сортировка: `created_at DESC`

### `GET /api/alerts/:id`
- Полная карточка алерта.

### `GET /api/markets/:id/volume`
- Query:
  - `from?: unix`
  - `to?: unix`
- Ответ: `[{ timestamp, hourly_volume }]`

### `GET /api/stats/summary`
- Ответ:
  - `openAlerts`
  - `resolvedAlerts`
  - `avgMultiplier24h`
  - `maxSpike24h`

### Ошибки API
Единый формат:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid query parameter",
    "details": {}
  }
}
```

## 10. Устойчивость и обработка ошибок

- Каждый внешний вызов: timeout 8-10s.
- Retry: до 3 попыток для network/429/5xx с exponential backoff + jitter.
- Лимит конкурентности запросов к `trades` (например 8 одновременно).
- Ошибка одного рынка не должна срывать итерацию целиком.
- Фатальная ошибка итерации: лог + пауза до следующего тика.

## 11. Конфигурация (`.env`)

- `POLL_INTERVAL_SEC=60`
- `TOP_MARKETS_LIMIT=100`
- `ALERT_MULTIPLIER=5`
- `ALERT_MIN_VOLUME=300`
- `ALERT_COOLDOWN_HOURS=6`
- `BASELINE_DAYS=7`
- `RESOLVE_EVERY_N_ITERATIONS=10`
- `REQUEST_TIMEOUT_MS=10000`
- `REQUEST_RETRIES=3`
- `REQUEST_CONCURRENCY=8`
- `DB_PATH=./polymarket.db`
- `PORT=8080`
- `CORS_ORIGIN=http://localhost:5173`

## 12. Логирование и эксплуатация на VPS

- Логи в JSON (`pino`) с ключами: `iteration`, `marketsProcessed`, `alertsCreated`, `errorsCount`.
- Health endpoint используется для внешнего мониторинга.
- Запуск через `systemd`/`pm2` с авто-рестартом.

## 13. Тестовая стратегия

### Unit
- baseline-расчет за 7 дней (UTC buckets).
- правила триггера (5x + >300).
- cooldown 6 часов.
- P&L формулы для YES/NO.

### Integration
- API-эндпоинты против тестовой SQLite.
- worker итерация с моками API.

### Resilience
- 429/500/timeout сценарии, проверка retry/backoff.
- проверка, что процесс не падает при частичных сбоях.

## 14. Риски и меры

- Риск: изменения схемы внешних API Polymarket.
  - Мера: адаптерный слой маппинга + защитный парсинг.
- Риск: rate limiting.
  - Мера: контролируемая конкурентность + retries.
- Риск: lock-конфликты SQLite при росте нагрузки.
  - Мера: `WAL`, `busy_timeout`, короткие транзакции.

## 15. Критерии приемки этапа 1

1. Сервис стабильно работает на VPS и переживает ошибки API без падения.
2. При искусственно повышенном объеме создаются алерты по правилам.
3. Повторные алерты в пределах 6 часов не создаются.
4. Закрытые рынки резолвятся, `final_outcome` и `pnl_*` заполняются.
5. API отдает данные, достаточные для React-интерфейса.
6. Все временные расчеты выполняются в UTC.
