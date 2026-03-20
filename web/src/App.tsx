import { useEffect, useMemo, useState } from 'react';

import { getAlerts, getHealth, getMarketVolume, getSummary } from './api';
import type {
  AlertDto,
  AlertStatusFilter,
  HealthDto,
  SummaryDto,
  VolumePointDto,
} from './types';
import { formatRatio, formatUnixTime, formatUsd } from './utils';

type View = 'dashboard' | 'alerts' | 'market';
type ThemeMode = 'dark' | 'light';

interface NavItem {
  id: View;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'market', label: 'Market' },
];

const THEME_STORAGE_KEY = 'pm_monitor_theme';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }

  return 'dark';
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>('dashboard');
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());
  const [focusMarketId, setFocusMarketId] = useState('');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRefreshTick((value) => value + 1);
      setLastUpdatedAt(Date.now());
    }, 60_000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  function handleManualRefresh(): void {
    setRefreshTick((value) => value + 1);
    setLastUpdatedAt(Date.now());
  }

  function toggleTheme(): void {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-block">
          <p className="brand-kicker">Polymarket</p>
          <h1 className="brand-title">Volume Monitor</h1>
        </div>

        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === view ? 'nav-link active' : 'nav-link'}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-meta">
          <span>Theme</span>
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
          </button>
          <span>Auto refresh</span>
          <strong>60s</strong>
          <span>Last update</span>
          <strong>{new Date(lastUpdatedAt).toLocaleTimeString()}</strong>
        </div>
      </aside>

      <main className="app-content">
        <header className="topbar">
          <h2 className="page-title">{getPageTitle(view)}</h2>
          <button type="button" className="refresh-button" onClick={handleManualRefresh}>
            Refresh now
          </button>
        </header>

        {view === 'dashboard' ? (
          <DashboardPage
            refreshTick={refreshTick}
            onOpenMarket={(marketId) => {
              setFocusMarketId(marketId);
              setView('market');
            }}
          />
        ) : null}

        {view === 'alerts' ? (
          <AlertsPage
            refreshTick={refreshTick}
            onOpenMarket={(marketId) => {
              setFocusMarketId(marketId);
              setView('market');
            }}
          />
        ) : null}

        {view === 'market' ? (
          <MarketPage
            refreshTick={refreshTick}
            initialMarketId={focusMarketId}
            onOpenAlerts={() => setView('alerts')}
          />
        ) : null}
      </main>
    </div>
  );
}

interface DashboardPageProps {
  refreshTick: number;
  onOpenMarket: (marketId: string) => void;
}

function DashboardPage(props: DashboardPageProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [summary, setSummary] = useState<SummaryDto | null>(null);
  const [alerts, setAlerts] = useState<AlertDto[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError('');

      try {
        const [nextHealth, nextSummary, nextAlerts] = await Promise.all([
          getHealth(),
          getSummary(),
          getAlerts({ limit: 10 }),
        ]);

        if (cancelled) {
          return;
        }

        setHealth(nextHealth);
        setSummary(nextSummary);
        setAlerts(nextAlerts.items);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : 'Failed to load dashboard'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [props.refreshTick]);

  return (
    <section className="page-section">
      {loading ? <StatusBox label="Loading dashboard..." /> : null}
      {!loading && error ? <StatusBox label={error} kind="error" /> : null}

      {!loading && !error ? (
        <>
          <div className="metric-grid">
            <MetricCard label="Service status" value={health?.status ?? '—'} />
            <MetricCard label="Errors 24h" value={String(health?.iterationErrors24h ?? '—')} />
            <MetricCard
              label="Open alerts"
              value={String(summary?.openAlerts ?? 0)}
              accent="teal"
            />
            <MetricCard
              label="Avg multiplier 24h"
              value={formatRatio(summary?.avgMultiplier24h ?? 0)}
            />
            <MetricCard
              label="Max spike 24h"
              value={formatUsd(summary?.maxSpike24h ?? 0)}
              accent="orange"
            />
          </div>

          <h3 className="section-title">Latest alerts</h3>
          {alerts.length === 0 ? (
            <StatusBox label="No alerts yet." />
          ) : (
            <AlertsTable alerts={alerts} onOpenMarket={props.onOpenMarket} />
          )}
        </>
      ) : null}
    </section>
  );
}

interface AlertsPageProps {
  refreshTick: number;
  onOpenMarket: (marketId: string) => void;
}

function AlertsPage(props: AlertsPageProps): JSX.Element {
  const [status, setStatus] = useState<AlertStatusFilter>('ALL');
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState<AlertDto[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError('');

      try {
        const response = await getAlerts({
          status,
          limit,
        });
        if (cancelled) {
          return;
        }

        setAlerts(response.items);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load alerts');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [props.refreshTick, status, limit]);

  return (
    <section className="page-section">
      <div className="toolbar-row">
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as AlertStatusFilter)}>
            <option value="ALL">All</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ERROR">Error</option>
          </select>
        </label>

        <label className="field">
          <span>Rows</span>
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={10}>10</option>
            <option value={30}>30</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>

      {loading ? <StatusBox label="Loading alerts..." /> : null}
      {!loading && error ? <StatusBox label={error} kind="error" /> : null}
      {!loading && !error && alerts.length === 0 ? <StatusBox label="No alerts found." /> : null}
      {!loading && !error && alerts.length > 0 ? (
        <AlertsTable alerts={alerts} onOpenMarket={props.onOpenMarket} />
      ) : null}
    </section>
  );
}

interface MarketPageProps {
  refreshTick: number;
  initialMarketId: string;
  onOpenAlerts: () => void;
}

function MarketPage(props: MarketPageProps): JSX.Element {
  const [marketIdInput, setMarketIdInput] = useState(props.initialMarketId);
  const [activeMarketId, setActiveMarketId] = useState(props.initialMarketId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [points, setPoints] = useState<VolumePointDto[]>([]);

  useEffect(() => {
    setMarketIdInput(props.initialMarketId);
    setActiveMarketId(props.initialMarketId);
  }, [props.initialMarketId]);

  useEffect(() => {
    if (!activeMarketId) {
      setPoints([]);
      return;
    }

    let cancelled = false;
    const nowSec = Math.floor(Date.now() / 1000);

    async function load(): Promise<void> {
      setLoading(true);
      setError('');

      try {
        const response = await getMarketVolume(activeMarketId, {
          from: nowSec - 24 * 3600,
          to: nowSec,
        });
        if (cancelled) {
          return;
        }

        setPoints(response);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : 'Failed to load market volume'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeMarketId, props.refreshTick]);

  const bars = useMemo(() => {
    const maxValue = points.reduce((acc, point) => Math.max(acc, point.hourlyVolume), 0);
    return points.map((point) => {
      const widthPercent = maxValue > 0 ? (point.hourlyVolume / maxValue) * 100 : 0;
      return {
        ...point,
        widthPercent,
      };
    });
  }, [points]);

  return (
    <section className="page-section">
      <div className="toolbar-row">
        <label className="field grow">
          <span>Market ID</span>
          <input
            type="text"
            value={marketIdInput}
            placeholder="e.g. 553879"
            onChange={(event) => setMarketIdInput(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="action-button"
          onClick={() => setActiveMarketId(marketIdInput.trim())}
        >
          Load
        </button>
        <button type="button" className="ghost-button" onClick={props.onOpenAlerts}>
          Back to alerts
        </button>
      </div>

      {!activeMarketId ? <StatusBox label="Enter market id to load hourly volume." /> : null}
      {loading ? <StatusBox label="Loading market volume..." /> : null}
      {!loading && error ? <StatusBox label={error} kind="error" /> : null}

      {!loading && !error && activeMarketId && bars.length === 0 ? (
        <StatusBox label="No hourly volume points for this market yet." />
      ) : null}

      {!loading && !error && bars.length > 0 ? (
        <div className="bars-panel">
          {bars.map((point) => (
            <div key={`${point.timestamp}-${point.marketId}`} className="bar-row">
              <span className="bar-time">{formatUnixTime(point.timestamp)}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${point.widthPercent}%` }} />
              </div>
              <span className="bar-value">{formatUsd(point.hourlyVolume)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface AlertsTableProps {
  alerts: AlertDto[];
  onOpenMarket: (marketId: string) => void;
}

function AlertsTable(props: AlertsTableProps): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="alerts-table">
        <thead>
          <tr>
            <th>Market</th>
            <th>Question</th>
            <th>Multiplier</th>
            <th>Spike</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {props.alerts.map((alert) => (
            <tr key={alert.id}>
              <td>
                <button
                  type="button"
                  className="table-link"
                  onClick={() => props.onOpenMarket(alert.marketId)}
                >
                  {alert.marketId}
                </button>
              </td>
              <td title={alert.question}>{alert.question}</td>
              <td>{formatRatio(alert.multiplier)}</td>
              <td>{formatUsd(alert.spikeAmount)}</td>
              <td>
                <span className={`status-pill ${alert.status.toLowerCase()}`}>{alert.status}</span>
              </td>
              <td>{formatUnixTime(alert.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  accent?: 'teal' | 'orange';
}

function MetricCard(props: MetricCardProps): JSX.Element {
  return (
    <article className={`metric-card ${props.accent ?? ''}`.trim()}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

interface StatusBoxProps {
  label: string;
  kind?: 'error';
}

function StatusBox(props: StatusBoxProps): JSX.Element {
  return <div className={props.kind === 'error' ? 'status-box error' : 'status-box'}>{props.label}</div>;
}

function getPageTitle(view: View): string {
  if (view === 'dashboard') {
    return 'System Dashboard';
  }

  if (view === 'alerts') {
    return 'Alert Feed';
  }

  return 'Market Volume';
}
