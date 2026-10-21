import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, RefreshCw, Server } from 'lucide-react';

const services = [
  ['core', 'Core finance', 'Java · PostgreSQL'],
  ['capture', 'Capture & automation', 'Python · MongoDB'],
  ['rates', 'Rates & realtime', 'Go · Redis'],
  ['analytics', 'Analytics', 'C# · ClickHouse'],
  ['notifications', 'Notifications', 'Node.js · Cassandra'],
] as const;
type Result = { id: string; healthy: boolean; latency: number };
export function PlatformStatus() {
  const [results, setResults] = useState<Result[]>([]);
  const [checked, setChecked] = useState('');
  const [profile, setProfile] = useState('unknown');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    const controller = new AbortController();
    async function check() {
      if (busy || document.hidden || !navigator.onLine) return;
      busy = true;
      try {
        try {
          const response = await fetch('/runtime.json', {
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
          });
          if (response.ok) {
            const value = await response.json();
            if (!disposed) setProfile(value.profile);
          }
        } catch {}
        const next = await Promise.all(
          services.map(async ([id]) => {
            const start = performance.now();
            try {
              const response = await fetch(`/platform/health/${id}`, {
                cache: 'no-store',
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
              });
              const body = await response.json();
              return {
                id,
                healthy: response.ok && ['up', 'UP'].includes(body.status),
                latency: Math.round(performance.now() - start),
              };
            } catch {
              return { id, healthy: false, latency: Math.round(performance.now() - start) };
            }
          }),
        );
        if (!disposed) {
          setResults(next);
          setChecked(new Date().toLocaleTimeString());
        }
      } finally {
        busy = false;
      }
    }
    void check();
    const interval = setInterval(() => void check(), 15000);
    const resume = () => void check();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [refresh]);
  return (
    <section className="panel platform-panel" aria-label="Live platform health">
      <div className="panel-header">
        <h2>
          <Activity size={18} /> Live service health
        </h2>
        <button className="button small" onClick={() => setRefresh((value) => value + 1)}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <p className="platform-help">
        Checks the running services through the API gateway and their actual database readiness.
        Finance entries are saved in your private PostgreSQL workspaces.
      </p>
      <div className="platform-services">
        {services.map(([id, title, stack]) => {
          const result = results.find((value) => value.id === id);
          return (
            <div className="platform-service" key={id}>
              <Server size={18} />
              <div>
                <strong>{title}</strong>
                <small>{stack}</small>
              </div>
              <span className={`platform-state ${result?.healthy ? 'healthy' : ''}`}>
                {!result ? 'Checking…' : result.healthy ? 'Ready' : 'Unavailable'}
              </span>
              <small>{result ? `${result.latency} ms` : '—'}</small>
            </div>
          );
        })}
      </div>
      <p className="platform-help" aria-live="polite">
        {checked
          ? `Last checked ${checked} · refreshes every 15 seconds`
          : 'Connecting to the local platform…'}
      </p>
      <p className="platform-help">
        {profile === 'daily'
          ? 'Daily mode: metrics and alerts are active. Log indexing and trace storage are paused to keep your desktop responsive.'
          : profile === 'full'
            ? 'Full mode: metrics, logs, traces and alerts are active.'
            : 'Runtime profile is being checked.'}
      </p>
      <div className="platform-links">
        {[
          ['Grafana dashboards', 'http://localhost:3000/d/ledgerline-overview'],
          ['Kibana logs', 'http://localhost:5601/app/dashboards#/view/ledgerline-logs'],
          ['Prometheus metrics', 'http://localhost:9090/targets'],
          ['Alertmanager', 'http://localhost:9093'],
          ['Email inbox', 'http://localhost:8025'],
        ].map(([label, url]) =>
          label === 'Kibana logs' && profile !== 'full' ? (
            <span className="button" aria-disabled="true" key={url}>
              {label} · {profile === 'daily' ? 'Paused in daily mode' : 'Status unavailable'}
            </span>
          ) : (
            <a className="button" href={url} target="_blank" rel="noreferrer" key={url}>
              {label}
              <ArrowUpRight size={15} />
            </a>
          ),
        )}
      </div>
    </section>
  );
}
