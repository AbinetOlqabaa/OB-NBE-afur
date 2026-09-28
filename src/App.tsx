import { useEffect, useState } from 'react';
import { Activity, Server, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

interface HealthData {
  status: string;
  timestamp: string;
  uptime: number;
  kernel: {
    name: string;
    version: string;
    state: string;
  };
  environment: string;
}

export default function App() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data: HealthData = await res.json();
      setLatency(Math.round(performance.now() - start));
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to backend server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-6 antialiased font-mono">
      <main className="w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl space-y-6">
        <header className="border-b border-neutral-800 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Server className="w-5 h-5 text-emerald-400" />
              <h1 className="font-semibold text-lg text-neutral-100">
                OB/NBE Reporting Application
              </h1>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">
              Kernel v1.0.0
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Technical Landing Environment & Runtime Kernel
          </p>
        </header>

        <section className="space-y-4">
          <div className="flex items-start space-x-3 bg-neutral-950/60 p-3.5 rounded border border-neutral-800">
            {error ? (
              <AlertCircle className="w-5 h-5 text-rose-400 mt-0.5 shrink-0" />
            ) : health ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <Activity className="w-5 h-5 text-amber-400 mt-0.5 shrink-0 animate-spin" />
            )}
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-neutral-200">
                {loading
                  ? 'Verifying system health...'
                  : error
                  ? 'System Status: Degraded'
                  : 'System Status: Operational & Ready'}
              </div>
              <p className="text-neutral-400">
                {error
                  ? error
                  : 'Kernel runtime is active. Ready to receive authoritative application import.'}
              </p>
            </div>
          </div>

          <div className="bg-neutral-950 p-4 rounded border border-neutral-800 space-y-2 text-xs">
            <div className="text-neutral-400 uppercase tracking-wider text-[10px] pb-1 border-b border-neutral-850">
              Runtime Telemetry
            </div>
            <div className="flex justify-between py-1 border-b border-neutral-900">
              <span className="text-neutral-500">Backend Server:</span>
              <span className="text-neutral-200 font-medium">Node.js / Express</span>
            </div>
            <div className="flex justify-between py-1 border-b border-neutral-900">
              <span className="text-neutral-500">Frontend Engine:</span>
              <span className="text-neutral-200 font-medium">React 19 / Vite</span>
            </div>
            <div className="flex justify-between py-1 border-b border-neutral-900">
              <span className="text-neutral-500">API Endpoint (/api/health):</span>
              <span className={error ? 'text-rose-400' : 'text-emerald-400'}>
                {error ? 'Unreachable' : '200 OK'} {latency !== null && `(${latency}ms)`}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-neutral-900">
              <span className="text-neutral-500">Environment:</span>
              <span className="text-neutral-300">{health?.environment ?? 'development'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-neutral-900">
              <span className="text-neutral-500">Uptime:</span>
              <span className="text-neutral-300">
                {health?.uptime !== undefined ? `${Math.floor(health.uptime)}s` : '—'}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">Kernel State:</span>
              <span className="text-amber-300">{health?.kernel?.state ?? 'READY_FOR_IMPORT'}</span>
            </div>
          </div>
        </section>

        <footer className="pt-2 flex items-center justify-between border-t border-neutral-850 text-xs">
          <div className="text-neutral-500 text-[11px]">
            Awaiting imported application source
          </div>
          <button
            onClick={checkHealth}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Check Health</span>
          </button>
        </footer>
      </main>
    </div>
  );
}
