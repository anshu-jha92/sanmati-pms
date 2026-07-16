import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Calendar, CalendarClock, AlertTriangle, Play, Clock, Package,
  ChevronLeft, ChevronRight, X, Save, Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import { jobApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';

/* ════════════════════════════════════════════════════════════════════════
 * Scheduling Page — set/update plannedStart for each Job Order
 *
 * Three views:
 *   • Unscheduled   — jobs with no plannedStart yet (need date assignment)
 *   • This Week     — jobs scheduled to start in the next 7 days
 *   • Calendar      — week view with jobs plotted on each day
 * ══════════════════════════════════════════════════════════════════════ */

const PRIORITY = {
  high:   { dot: 'bg-state-down',    text: 'text-state-down',    border: 'border-state-down/30' },
  medium: { dot: 'bg-state-idle',    text: 'text-state-idle',    border: 'border-state-idle/30' },
  normal: { dot: 'bg-state-running', text: 'text-state-running', border: 'border-state-running/30' },
};

const STATUS_PILL = {
  draft: 'chip-gray',
  planned: 'chip-blue',
  released: 'chip-green',
  in_progress: 'chip-blue',
  paused: 'chip-yellow',
  qc_hold: 'chip-yellow',
  completed: 'chip-green',
  cancelled: 'chip-red',
};

export function SchedulingPage() {
  const user = authStore((s) => s.user);
  const qc = useQueryClient();
  const [view, setView] = useState('unscheduled');
  const [scheduleJob, setScheduleJob] = useState(null);  // job being scheduled
  const [weekOffset, setWeekOffset] = useState(0);

  const query = useQuery({
    queryKey: ['scheduling-jobs', user?.plantId],
    queryFn: async () => (await jobApi.list({
      plantId: user?.plantId,
      limit: 200,
      // Get jobs that aren't completed yet
      status: undefined,  // backend will return all
    })).data,
    refetchInterval: 30_000,
  });

  const allJobs = useMemo(
    () => (query.data || []).filter((j) => !['completed', 'cancelled'].includes(j.status)),
    [query.data]
  );

  // Categorize jobs
  const { unscheduled, thisWeek, byDay } = useMemo(() => {
    const unscheduled = [];
    const thisWeek = [];
    const byDay = {};
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + (weekOffset * 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    for (const job of allJobs) {
      if (!job.plannedStart) {
        unscheduled.push(job);
      } else {
        const start = new Date(job.plannedStart);
        const dayKey = start.toISOString().slice(0, 10);
        if (!byDay[dayKey]) byDay[dayKey] = [];
        byDay[dayKey].push(job);

        if (start >= weekStart && start < weekEnd) {
          thisWeek.push(job);
        }
      }
    }

    return { unscheduled, thisWeek, byDay };
  }, [allJobs, weekOffset]);

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-[17px] font-bold text-ink-900">Production Scheduling</h2>
        <p className="text-[12.5px] text-ink-500">
          Assign start dates to job orders. Once a date is set, jobs become available for operators to pick up.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          accent={unscheduled.length > 0 ? 'red' : 'green'}
          label="Unscheduled"
          value={unscheduled.length}
          subtitle={unscheduled.length > 0 ? 'Need start dates' : 'All planned'}
        />
        <StatCard accent="blue" label="This Week" value={thisWeek.length} />
        <StatCard accent="green" label="In Progress" value={allJobs.filter((j) => j.status === 'in_progress').length} />
        <StatCard accent="yellow" label="On Hold" value={allJobs.filter((j) => ['paused', 'qc_hold'].includes(j.status)).length} />
      </section>

      <div className="flex items-center gap-1 border-b border-ink-100">
        {[
          { key: 'unscheduled', label: 'Unscheduled', count: unscheduled.length, urgent: unscheduled.length > 0 },
          { key: 'thisWeek', label: 'This Week', count: thisWeek.length },
          { key: 'calendar', label: 'Calendar' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={clsx(
              'px-4 py-2 text-[12.5px] font-semibold border-b-2 -mb-px transition-colors',
              view === t.key ? 'text-brand-600 border-brand-500' : 'text-ink-500 border-transparent hover:text-ink-700'
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={clsx(
                'ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] px-1.5 py-0.5 min-w-[18px]',
                t.urgent ? 'bg-state-down text-white' : 'bg-ink-100 text-ink-600'
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="text-center py-10 text-[12.5px] text-ink-400">Loading…</div>
      ) : view === 'unscheduled' ? (
        <UnscheduledView jobs={unscheduled} onSchedule={setScheduleJob} />
      ) : view === 'thisWeek' ? (
        <ThisWeekView jobs={thisWeek} onSchedule={setScheduleJob} />
      ) : (
        <CalendarView byDay={byDay} weekOffset={weekOffset} setWeekOffset={setWeekOffset} onSchedule={setScheduleJob} />
      )}

      {scheduleJob && (
        <ScheduleModal
          job={scheduleJob}
          onClose={() => setScheduleJob(null)}
          onSaved={() => {
            setScheduleJob(null);
            qc.invalidateQueries({ queryKey: ['scheduling-jobs'] });
            qc.invalidateQueries({ queryKey: ['jobs'] });
          }}
        />
      )}
    </div>
  );
}

function StatCard({ accent, label, value, subtitle }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="sc-label">{label}</div>
      <div className="sc-val">{value}</div>
      {subtitle && <div className="sc-meta">{subtitle}</div>}
    </div>
  );
}

/* ════════════ UNSCHEDULED ════════════ */
function UnscheduledView({ jobs, onSchedule }) {
  if (jobs.length === 0) {
    return (
      <div className="panel text-center py-12">
        <Calendar className="h-10 w-10 mx-auto text-state-running mb-2" />
        <div className="font-bold text-[14px] text-ink-900">All jobs are scheduled!</div>
        <div className="text-[12px] text-ink-500 mt-1">No jobs are waiting for a start date.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border-2 border-state-down/20 bg-state-down/5 p-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-state-down" />
        <div className="text-[12px] text-state-down font-semibold">
          {jobs.length} job{jobs.length !== 1 ? 's' : ''} need{jobs.length === 1 ? 's' : ''} a start date.
        </div>
      </div>
      {jobs.map((job) => (
        <UnscheduledRow key={job._id} job={job} onSchedule={onSchedule} />
      ))}
    </div>
  );
}

function UnscheduledRow({ job, onSchedule }) {
  const priority = PRIORITY[job.priority || 'normal'];
  const daysToDue = job.dueDate ? Math.ceil((new Date(job.dueDate) - new Date()) / 86400000) : null;

  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={clsx('h-10 w-1.5 rounded-full', priority.dot)} />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-[13px] font-bold text-brand-600">{job.orderNumber}</span>
          <span className="text-[10.5px] text-ink-400 font-mono">{job.jobNumber}</span>
          <span className={`${STATUS_PILL[job.status]} text-[10px] capitalize`}>{job.status}</span>
        </div>
        <div className="font-bold text-[13.5px] text-ink-900">{job.product?.name}</div>
        <div className="text-[11.5px] text-ink-500 flex items-center gap-3 mt-1">
          <span><Package className="h-3 w-3 inline" /> {job.plannedQty} {job.uom}</span>
          {job.customer && <span>· {job.customer}</span>}
          {daysToDue !== null && (
            <span className={clsx(
              daysToDue < 0 ? 'text-state-down font-bold' :
              daysToDue <= 3 ? 'text-state-idle font-bold' :
              'text-ink-500'
            )}>
              · Due in {daysToDue} day{daysToDue !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
      <button onClick={() => onSchedule(job)} className="btn-primary">
        <Calendar className="h-4 w-4" /> Set Start Date
      </button>
    </div>
  );
}

/* ════════════ THIS WEEK ════════════ */
function ThisWeekView({ jobs, onSchedule }) {
  if (jobs.length === 0) {
    return (
      <div className="panel text-center py-12">
        <CalendarClock className="h-10 w-10 mx-auto text-ink-300 mb-2" />
        <div className="font-bold text-[14px] text-ink-900">No jobs scheduled this week</div>
        <div className="text-[12px] text-ink-500 mt-1">Schedule unscheduled jobs to get started.</div>
      </div>
    );
  }

  // Sort by plannedStart
  const sorted = [...jobs].sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));

  return (
    <div className="space-y-2">
      {sorted.map((job) => (
        <ScheduledRow key={job._id} job={job} onSchedule={onSchedule} />
      ))}
    </div>
  );
}

function ScheduledRow({ job, onSchedule }) {
  const priority = PRIORITY[job.priority || 'normal'];
  const start = new Date(job.plannedStart);
  const dayName = start.toLocaleDateString('en-IN', { weekday: 'short' });
  const dayNum = start.getDate();
  const dayMonth = start.toLocaleDateString('en-IN', { month: 'short' });
  const timeStr = start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const isToday = start.toDateString() === new Date().toDateString();
  const isPast = start < new Date() && job.status !== 'in_progress';

  return (
    <div className={clsx(
      'card p-4 flex items-center gap-4',
      isToday && 'border-2 border-brand-500/50',
      isPast && job.status === 'planned' && 'border-2 border-state-idle/40'
    )}>
      {/* Date block */}
      <div className={clsx(
        'flex flex-col items-center justify-center rounded-lg w-16 h-16 shrink-0',
        isToday ? 'bg-brand-500 text-white' : 'bg-ink-50 text-ink-700'
      )}>
        <div className="text-[10px] font-semibold uppercase">{dayName}</div>
        <div className="text-[20px] font-bold leading-none">{dayNum}</div>
        <div className="text-[9px] uppercase">{dayMonth}</div>
      </div>

      <div className={clsx('h-12 w-1 rounded-full', priority.dot)} />

      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-[13px] font-bold text-brand-600">{job.orderNumber}</span>
          <span className={`${STATUS_PILL[job.status]} text-[10px] capitalize`}>{job.status}</span>
          {isToday && <span className="chip-blue text-[10px] font-bold">TODAY</span>}
          {isPast && job.status === 'planned' && <span className="chip-yellow text-[10px] font-bold">OVERDUE</span>}
        </div>
        <div className="font-bold text-[13.5px] text-ink-900">{job.product?.name}</div>
        <div className="text-[11.5px] text-ink-500 flex items-center gap-2 mt-1">
          <Clock className="h-3 w-3" /> {timeStr}
          <span>·</span>
          <span>{job.plannedQty} {job.uom}</span>
          {job.customer && <span>· {job.customer}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <button onClick={() => onSchedule(job)} className="btn-secondary btn-sm">
          <Calendar className="h-3.5 w-3.5" /> Edit
        </button>
        {job.status === 'planned' && (
          <Link to={`/tracking?orderNumber=${job.orderNumber}`} className="btn-primary btn-sm">
            <Play className="h-3.5 w-3.5" /> Start
          </Link>
        )}
      </div>
    </div>
  );
}

/* ════════════ CALENDAR ════════════ */
function CalendarView({ byDay, weekOffset, setWeekOffset, onSchedule }) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + (weekOffset * 7));
  weekStart.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setWeekOffset(weekOffset - 1)} className="btn-secondary btn-sm">
          <ChevronLeft className="h-4 w-4" /> Prev week
        </button>
        <div className="font-bold text-[13px] text-ink-900">
          {weekStart.toLocaleDateString('en-IN', { month: 'long', day: 'numeric' })} —
          {' '}{days[6].toLocaleDateString('en-IN', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
        <button onClick={() => setWeekOffset(weekOffset + 1)} className="btn-secondary btn-sm">
          Next week <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-x-auto">
      <div className="grid grid-cols-7 gap-2 min-w-[640px]">
        {days.map((d) => {
          const key = d.toISOString().slice(0, 10);
          const dayJobs = byDay[key] || [];
          const isToday = d.toDateString() === new Date().toDateString();
          return (
            <div
              key={key}
              className={clsx(
                'rounded-lg border min-h-[180px] p-2',
                isToday ? 'border-brand-500 bg-brand-50/30' : 'border-ink-200 bg-white'
              )}
            >
              <div className="flex items-baseline justify-between mb-2">
                <div className={clsx('text-[10px] font-semibold uppercase', isToday ? 'text-brand-600' : 'text-ink-500')}>
                  {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                </div>
                <div className={clsx('text-[15px] font-bold', isToday ? 'text-brand-600' : 'text-ink-700')}>
                  {d.getDate()}
                </div>
              </div>
              <div className="space-y-1">
                {dayJobs.length === 0 ? (
                  <div className="text-[10px] text-ink-300 text-center py-4">No jobs</div>
                ) : dayJobs.map((job) => {
                  const priority = PRIORITY[job.priority || 'normal'];
                  return (
                    <button
                      key={job._id}
                      onClick={() => onSchedule(job)}
                      className={clsx(
                        'w-full text-left rounded p-1.5 border text-[10px] hover:shadow-sm transition-shadow',
                        priority.border, 'bg-white'
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <span className={clsx('w-1.5 h-1.5 rounded-full', priority.dot)} />
                        <span className="font-mono font-bold text-brand-600 truncate">{job.orderNumber}</span>
                      </div>
                      <div className="font-semibold text-ink-700 truncate mt-0.5">{job.product?.name}</div>
                      <div className="text-ink-400 mt-0.5">{job.plannedQty} {job.uom}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

/* ════════════ SCHEDULE MODAL ════════════ */
function ScheduleModal({ job, onClose, onSaved }) {
  const [form, setForm] = useState({
    plannedStart: job.plannedStart ? new Date(job.plannedStart).toISOString().slice(0, 16) : '',
    plannedEnd: job.plannedEnd ? new Date(job.plannedEnd).toISOString().slice(0, 16) : '',
    dueDate: job.dueDate ? new Date(job.dueDate).toISOString().slice(0, 10) : '',
    priority: job.priority || 'normal',
  });
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: async () => {
      const body = {};
      if (form.plannedStart) body.plannedStart = new Date(form.plannedStart).toISOString();
      if (form.plannedEnd) body.plannedEnd = new Date(form.plannedEnd).toISOString();
      if (form.dueDate) body.dueDate = new Date(form.dueDate).toISOString();
      if (form.priority) body.priority = form.priority;
      return (await jobApi.schedule(job._id, body)).data;
    },
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  const releaseMut = useMutation({
    mutationFn: async () => (await jobApi.release(job._id)).data,
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  // Suggest a default end date based on plannedStart + estimated duration
  function suggestEndDate() {
    if (!form.plannedStart) return;
    const start = new Date(form.plannedStart);
    // Rough estimate: 1 day per 100 kg
    const days = Math.max(1, Math.ceil((job.plannedQty || 100) / 100));
    const end = new Date(start);
    end.setDate(start.getDate() + days);
    setForm({ ...form, plannedEnd: end.toISOString().slice(0, 16) });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Schedule Job</div>
            <h2 className="text-[17px] font-bold text-ink-900 font-mono">{job.orderNumber}</h2>
            <div className="text-[12.5px] text-ink-700 mt-0.5">{job.product?.name}</div>
            <div className="text-[11.5px] text-ink-500">
              {job.plannedQty} {job.uom} {job.customer && `· ${job.customer}`}
            </div>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">When will you start? *</label>
            <input
              type="datetime-local" required
              className="input"
              value={form.plannedStart}
              onChange={(e) => setForm({ ...form, plannedStart: e.target.value })}
            />
            <div className="text-[10.5px] text-ink-500 mt-1">
              Pick the date and time when production should begin.
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label !mb-0">Expected completion</label>
              <button type="button" onClick={suggestEndDate} className="text-[10px] text-brand-600 font-semibold hover:underline">
                Auto-estimate
              </button>
            </div>
            <input
              type="datetime-local"
              className="input"
              value={form.plannedEnd}
              onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Due Date (customer)</label>
              <input
                type="date"
                className="input"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Priority</label>
              <select
                className="input"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="normal">Normal</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/30 p-3 text-[12px] text-state-down">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex justify-between items-center gap-2">
          <div>
            {['draft', 'planned'].includes(job.status) && (
              <button
                type="button"
                onClick={() => releaseMut.mutate()}
                disabled={releaseMut.isPending}
                className="btn-secondary text-state-running"
                title="Release job to operators (skip scheduling and start now)"
              >
                {releaseMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Release Now
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={mut.isPending}>
              {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Schedule
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
