import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, X, ArrowRight, Check, AlertTriangle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { notificationApi, jobApi, adminApi } from '../api/endpoints.js';
import { useSocket } from '../hooks/useSocket.js';
import { authStore } from '../context/authStore.js';

const SEVERITY_COLORS = {
  info:    'bg-brand-500/10 text-brand-600 border-brand-500/20',
  success: 'bg-state-running/10 text-state-running border-state-running/20',
  warning: 'bg-state-idle/10 text-state-idle border-state-idle/20',
  urgent:  'bg-state-down/10 text-state-down border-state-down/20',
};

export function NotificationBell() {
  const qc = useQueryClient();
  const user = authStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: async () => (await notificationApi.list()).data,
    refetchInterval: 30_000,
  });

  // Live socket — refresh list when a new notification arrives
  useSocket(
    '/ops',
    {
      'notification:new': () => qc.invalidateQueries({ queryKey: ['notifications'] }),
      'notification:resolved': () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    },
    [user?.plantId],
    (s) => user?.plantId && s.emit('subscribe:plant', user.plantId)
  );

  // Close on outside click
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const notifications = list.data || [];
  const count = notifications.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'relative h-8 w-8 grid place-items-center rounded-md border hover:bg-ink-100',
          count > 0 ? 'bg-state-down/10 border-state-down/30' : 'bg-ink-50 border-ink-200'
        )}
      >
        <Bell className={clsx('h-4 w-4', count > 0 ? 'text-state-down' : 'text-ink-600')} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] grid place-items-center rounded-full bg-state-down text-white text-[9px] font-bold px-1">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[calc(100vw-1.5rem)] sm:w-[420px] max-h-[600px] overflow-hidden bg-white rounded-xl shadow-2xl border border-ink-200 z-50 flex flex-col">
          <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between">
            <div className="font-bold text-[14px] text-ink-900">Notifications</div>
            <span className="text-[11px] text-ink-400">{count} pending</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {list.isLoading ? (
              <div className="text-center py-10 text-[12px] text-ink-400">Loading…</div>
            ) : count === 0 ? (
              <div className="text-center py-12 text-[12px]">
                <div className="text-[32px] mb-2">✅</div>
                <div className="font-bold text-ink-700">All caught up!</div>
                <div className="text-ink-400 mt-1">No pending notifications.</div>
              </div>
            ) : (
              <div className="divide-y divide-ink-100">
                {notifications.map((n) => (
                  <NotificationItem
                    key={n._id}
                    notif={n}
                    onChanged={() => qc.invalidateQueries({ queryKey: ['notifications'] })}
                    onClose={() => setOpen(false)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({ notif, onChanged, onClose }) {
  const [showAssign, setShowAssign] = useState(false);
  const sevCls = SEVERITY_COLORS[notif.severity || 'info'];
  const ago = timeAgo(notif.createdAt);

  const dismissMut = useMutation({
    mutationFn: async () => (await notificationApi.dismiss(notif._id)).data,
    onSuccess: onChanged,
  });

  return (
    <div className={clsx('p-3 hover:bg-ink-50 transition-colors')}>
      <div className="flex items-start gap-2">
        <div className={clsx('w-1 self-stretch rounded-full',
          notif.severity === 'urgent' ? 'bg-state-down' :
          notif.severity === 'warning' ? 'bg-state-idle' :
          notif.severity === 'success' ? 'bg-state-running' :
          'bg-brand-500'
        )} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="font-bold text-[12.5px] text-ink-900 leading-tight">{notif.title}</div>
            <button
              onClick={() => dismissMut.mutate()}
              className="shrink-0 h-5 w-5 rounded-md text-ink-400 hover:bg-ink-100 grid place-items-center"
              title="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="text-[11px] text-ink-600 mt-0.5">{notif.message}</div>
          <div className="text-[10px] text-ink-400 mt-1">{ago}</div>

          {notif.kind === 'stage_complete_assign_next' && !showAssign && (
            <button
              onClick={() => setShowAssign(true)}
              className="mt-2 inline-flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-md"
            >
              <ArrowRight className="h-3 w-3" /> Assign Next Operator
            </button>
          )}

          {showAssign && notif.kind === 'stage_complete_assign_next' && (
            <AssignNextOperatorPanel
              notif={notif}
              onCancel={() => setShowAssign(false)}
              onDone={() => { setShowAssign(false); onChanged(); onClose?.(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AssignNextOperatorPanel({ notif, onCancel, onDone }) {
  const [operatorId, setOperatorId] = useState('');
  const [error, setError] = useState('');

  const operators = useQuery({
    queryKey: ['operators-for-notif'],
    queryFn: async () => (await adminApi.listUsers()).data,
  });

  const assignMut = useMutation({
    mutationFn: async () => {
      // Assign operator to the next stage
      await jobApi.assignStage(notif.payload.jobOrderId, notif.payload.nextStageId, {
        operatorId,
      });
      // Resolve the notification
      await notificationApi.resolve(notif._id);
      return { ok: true };
    },
    onSuccess: onDone,
    onError: (e) => setError(e.message || 'Could not assign'),
  });

  return (
    <div className="mt-2 rounded-lg border border-brand-500/20 bg-brand-50 p-3 space-y-2">
      <div className="text-[10.5px] text-brand-700 font-bold uppercase tracking-wider">
        {notif.payload.jobOrderNumber} → {notif.payload.nextStage?.replace(/_/g, ' ')}
      </div>
      <select
        className="input !py-1.5 text-[12px]"
        value={operatorId}
        onChange={(e) => setOperatorId(e.target.value)}
      >
        <option value="">— Select operator —</option>
        {(operators.data || []).map((o) => (
          <option key={o._id} value={o._id}>{o.name} ({o.employeeCode || o.email})</option>
        ))}
      </select>
      {error && (
        <div className="text-[11px] text-state-down flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {error}
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onCancel()}
          className="flex-1 btn-secondary btn-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => operatorId && assignMut.mutate()}
          disabled={!operatorId || assignMut.isPending}
          className={clsx(
            'flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 text-[11.5px] font-bold rounded-md',
            operatorId && !assignMut.isPending ? 'bg-state-running text-white hover:brightness-95' : 'bg-ink-200 text-ink-400 cursor-not-allowed'
          )}
        >
          {assignMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Assign
        </button>
      </div>
    </div>
  );
}

function timeAgo(date) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
