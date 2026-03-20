# Polymarket Volume Monitor

Backend-сервис на Node.js + TypeScript для мониторинга аномальных объёмов на Polymarket.

## Что делает сервис

- Каждые 60 секунд берёт топ активных рынков с Gamma API.
- По каждому рынку забирает трейды из Polymarket Data API.
- Считает объём текущего UTC-часа.
- Сравнивает с baseline (среднее за последние 7 дней, минимум 24 полных часа).
- Создаёт алерт, если объём > `5x baseline` и > `$300`.
- Не создаёт повторный алерт по рынку чаще, чем раз в 6 часов.
- Каждые 10 итераций пытается резолвить `OPEN` алерты и считает P&L.
- Отдаёт REST API для фронта.

## Технологии

- Node.js 22
- TypeScript
- Fastify
- better-sqlite3 (SQLite)
- pino
- zod
- vitest

## Быстрый старт (локально)

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
npm run build
npm run dev
```

Сервис поднимает HTTP API на `PORT` (по умолчанию `8080`) и сразу запускает worker loop.

## Переменные окружения

Пример в `.env.example`:

- `NODE_ENV` — окружение (`production`/`development`)
- `LOG_LEVEL` — уровень логов pino
- `POLL_INTERVAL_SEC` — интервал тика worker
- `TOP_MARKETS_LIMIT` — количество рынков на итерацию
- `ALERT_MULTIPLIER` — порог мультипликатора
- `ALERT_MIN_VOLUME` — минимальный объём для алерта
- `ALERT_COOLDOWN_HOURS` — cooldown повторного алерта
- `BASELINE_DAYS` — окно baseline
- `RESOLVE_EVERY_N_ITERATIONS` — частота запуска резолвера
- `REQUEST_TIMEOUT_MS` — timeout внешних запросов
- `REQUEST_RETRIES` — retries внешних запросов
- `REQUEST_CONCURRENCY` — конкурентность запросов трейдов (`2` по умолчанию для снижения 429)
- `DB_PATH` — путь до `polymarket.db`
- `PORT` — порт API
- `CORS_ORIGIN` — разрешённый origin фронта

## API

- `GET /api/health`
- `GET /api/alerts?status=&market_id=&from=&to=&limit=&offset=`
- `GET /api/alerts/:id`
- `GET /api/markets/:id/volume?from=&to=`
- `GET /api/stats/summary`

## Запуск на VPS

### Вариант 1: systemd (рекомендуется)

1. Скопировать проект на VPS.
2. Установить зависимости и собрать:

```bash
npm install
npm run build
```

3. Создать `.env` рядом с `package.json`.
4. Создать unit-файл `/etc/systemd/system/polymarket-monitor.service`:

```ini
[Unit]
Description=Polymarket Volume Monitor
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/polymarket-monitor
EnvironmentFile=/opt/polymarket-monitor/.env
ExecStart=/usr/bin/node /opt/polymarket-monitor/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

5. Включить сервис:

```bash
sudo systemctl daemon-reload
sudo systemctl enable polymarket-monitor
sudo systemctl start polymarket-monitor
sudo systemctl status polymarket-monitor
```

Логи:

```bash
journalctl -u polymarket-monitor -f
```

### Вариант 2: PM2

```bash
npm install
npm run build
pm2 start dist/index.js --name polymarket-monitor
pm2 save
pm2 startup
```

## SQLite и бэкапы

По умолчанию БД: `./polymarket.db`.

Минимальный nightly backup:

```bash
mkdir -p backups
sqlite3 polymarket.db ".backup './backups/polymarket-$(date +%F).db'"
```

Рекомендуется чистить старые бэкапы по retention-политике (например, 14-30 дней).

## Проверка перед деплоем

```bash
npm test
npm run typecheck
npm run build
```
