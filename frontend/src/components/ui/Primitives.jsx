import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

export function Card({ title, actions, children, className, bodyClass }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="card-header">
          <h3 className="text-sm font-semibold text-ink-700">{title}</h3>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('card-body', bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, intent = 'default' }) {
  const intentClasses = {
    default: 'text-ink-900',
    good: 'text-green-600',
    warn: 'text-amber-600',
    bad: 'text-red-600',
  }[intent];
  return (
    <div className="rounded-xl bg-white ring-1 ring-ink-200/70 p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider font-medium text-ink-500">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', intentClasses)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

const STATE_CLASS = {
  running: 'pill-green',
  idle: 'pill-amber',
  maintenance: 'pill-purple',
  down: 'pill-red',
  offline: 'pill-gray',
};

export function StatePill({ state }) {
  const cls = STATE_CLASS[state] || 'pill-gray';
  return (
    <span className={cls}>
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: {
            running: '#16a34a',
            idle: '#eab308',
            maintenance: '#8b5cf6',
            down: '#ef4444',
            offline: '#6b7280',
          }[state] || '#6b7280',
        }}
      />
      {state || 'unknown'}
    </span>
  );
}

export function StatusPill({ status }) {
  const map = {
    planned: 'pill-gray',
    released: 'pill-blue',
    in_progress: 'pill-blue',
    pending: 'pill-gray',
    completed: 'pill-green',
    paused: 'pill-amber',
    on_hold: 'pill-amber',
    rework: 'pill-purple',
    cancelled: 'pill-red',
    pass: 'pill-green',
    reject: 'pill-red',
    hold: 'pill-amber',
    active: 'pill-green',
    inactive: 'pill-gray',
    packed: 'pill-blue',
    loaded: 'pill-blue',
    dispatched: 'pill-purple',
    delivered: 'pill-green',
  };
  return <span className={map[status] || 'pill-gray'}>{status?.replace(/_/g, ' ') || '—'}</span>;
}

export function Spinner({ className }) {
  return <Loader2 className={clsx('animate-spin', className)} />;
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 py-10 justify-center text-ink-500 text-sm">
      <Spinner className="h-4 w-4" /> {label}
    </div>
  );
}

export function Empty({ title = 'Nothing here yet', sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="text-ink-600 font-medium">{title}</div>
      {sub && <div className="text-sm text-ink-500 mt-1">{sub}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-lg bg-red-50 ring-1 ring-red-200 px-3 py-2 text-sm text-red-700 whitespace-pre-line">
      {message}
    </div>
  );
}
