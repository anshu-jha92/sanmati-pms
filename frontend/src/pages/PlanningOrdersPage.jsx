import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Search, Package, ShoppingCart, Calendar, Play, MapPin, QrCode,
  AlertTriangle, Clock, Loader2, X, Save, ArrowRight, Sparkles,
  CalendarClock, ChevronLeft, ChevronRight, User as UserIcon, Settings as SettingsIcon,
  CheckCircle2, ChevronDown, ChevronUp, Factory, Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { jobApi, machineApi, adminApi, bomApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { useSocket } from '../hooks/useSocket.js';

/* ════════════════════════════════════════════════════════════════════════
 * Planning + Scheduling — single unified page with tabs
 *
 *   Tab 1: Suggestions   — pre-planned jobs ready to start
 *   Tab 2: Unscheduled   — jobs that need a start date
 *   Tab 3: Scheduled     — jobs with start dates (this week / calendar)
 *   Tab 4: All Jobs      — everything in card grid
 *
 * From any tab, a job can be opened in the Schedule & Assign modal where the
 * manager picks: start date, priority, AND per-stage operator + machine.
 * ══════════════════════════════════════════════════════════════════════ */

const STAGES_DEF = [
  { key: 'printing',   label: 'Printing' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'lamination', label: 'Lamination' },
  { key: 'hot_room',   label: 'Hot Room' },
  { key: 'slitting',   label: 'Slitting' },
  { key: 'cutting',    label: 'Cutting' },
  { key: 'packaging',  label: 'Packaging' },
];

const PRIORITY_PILL = {
  high:   { text: '● HIGH',   cls: 'bg-state-down/10 text-state-down border-state-down/20' },
  medium: { text: '● MEDIUM', cls: 'bg-state-idle/10 text-state-idle border-state-idle/20' },
  normal: { text: '● NORMAL', cls: 'bg-state-running/10 text-state-running border-state-running/20' },
};

const STATUS_BADGE = {
  draft:       { text: 'Draft',         cls: 'bg-ink-100 text-ink-600' },
  planned:     { text: 'Scheduled',     cls: 'bg-brand-50 text-brand-600' },
  released:    { text: 'Ready to Start',cls: 'bg-state-running/10 text-state-running' },
  in_progress: { text: 'In Progress',   cls: 'bg-brand-50 text-brand-600' },
  paused:      { text: 'Paused',        cls: 'bg-state-idle/10 text-state-idle' },
  qc_hold:     { text: 'QC Hold',       cls: 'bg-state-idle/10 text-state-idle' },
  completed:   { text: 'Completed',     cls: 'bg-state-running/10 text-state-running' },
  cancelled:   { text: 'Cancelled',     cls: 'bg-state-down/10 text-state-down' },
};

function currentStageName(job) {
  const active = job.stages?.find((s) => s.status === 'in_progress');
  if (active) return active.stage;
  const ready = job.stages?.find((s) => s.status === 'ready');
  if (ready) return ready.stage;
  const lastDone = [...(job.stages || [])].reverse().find((s) => s.status === 'completed');
  if (lastDone) return lastDone.stage;
  return 'not_started';
}

function progressPct(job) {
  if (!job.stages?.length) return 0;
  const done = job.stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  return Math.round((done / job.stages.length) * 100);
}

function priorityWeight(p) {
  return { high: 0, medium: 1, normal: 2 }[p || 'normal'];
}

export function PlanningOrdersPage() {
  const user = authStore((s) => s.user);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState('suggestions');
  const [scheduleJob, setScheduleJob] = useState(null);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  const query = useQuery({
    queryKey: ['jobs', 'planning', user?.plantId],
    queryFn: async () => (await jobApi.list({ plantId: user?.plantId, limit: 200, sort: '-createdAt' })).data,
    refetchInterval: 30_000,
  });

  useSocket(
    '/orders',
    { 'order:update': () => qc.invalidateQueries({ queryKey: ['jobs'] }) },
    [user?.plantId],
    (s) => user?.plantId && s.emit('subscribe:plant', user.plantId)
  );

  const allJobs = (query.data || []).filter((j) => !['completed', 'cancelled'].includes(j.status));

  // ─── Categorize jobs ───
  const buckets = useMemo(() => {
    const suggestions = [];   // planned/released with plannedStart
    const unscheduled = [];   // no plannedStart yet
    const scheduled = [];     // has plannedStart, any future status
    const inProgress = [];    // currently running
    const byDay = {};         // for calendar view

    for (const job of allJobs) {
      if (job.status === 'in_progress') {
        inProgress.push(job);
      } else if (!job.plannedStart) {
        unscheduled.push(job);
      } else {
        scheduled.push(job);
        if (['planned', 'released'].includes(job.status)) {
          suggestions.push(job);
        }
        const dayKey = new Date(job.plannedStart).toISOString().slice(0, 10);
        if (!byDay[dayKey]) byDay[dayKey] = [];
        byDay[dayKey].push(job);
      }
    }

    suggestions.sort((a, b) => {
      const pd = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (pd !== 0) return pd;
      return new Date(a.plannedStart) - new Date(b.plannedStart);
    });
    scheduled.sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));

    return { suggestions, unscheduled, scheduled, inProgress, byDay };
  }, [allJobs]);

  const releaseMut = useMutation({
    mutationFn: async (jobId) => (await jobApi.release(jobId)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (jobId) => (await jobApi.delete(jobId)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, normal: 0 };
    for (const j of allJobs) c[j.priority || 'normal']++;
    return c;
  }, [allJobs]);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-[17px] font-bold text-ink-900">Production Planning &amp; Scheduling</h2>
        <p className="text-[12.5px] text-ink-500">
          Plan jobs, set start dates, assign operators &amp; machines for each stage.
        </p>
      </header>

      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link to="/sales-orders" className="btn-primary">
          <Plus className="h-4 w-4" /> New Sales Order
        </Link>
        <button onClick={() => setShowCreateJob(true)} className="btn-secondary">
          <Plus className="h-4 w-4" /> Create Job (no SO)
        </button>
        <Link to="/sales-orders" className="btn-secondary">
          <Search className="h-4 w-4" /> Check Availability
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="chip-red text-[10.5px] font-bold">● {counts.high} High</div>
          <div className="chip-yellow text-[10.5px] font-bold">● {counts.medium} Medium</div>
          <div className="chip-green text-[10.5px] font-bold">● {counts.normal} Normal</div>
        </div>
      </div>

      {/* Stat strip */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard accent="yellow" label="Suggestions" value={buckets.suggestions.length}
          subtitle="Ready to start" />
        <StatCard accent={buckets.unscheduled.length > 0 ? 'red' : 'green'} label="Unscheduled"
          value={buckets.unscheduled.length} subtitle={buckets.unscheduled.length > 0 ? 'Need start dates' : 'All planned'} />
        <StatCard accent="blue" label="Scheduled" value={buckets.scheduled.length} />
        <StatCard accent="green" label="In Progress" value={buckets.inProgress.length} />
        <StatCard accent="gray" label="Total Active" value={allJobs.length} />
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-ink-100 overflow-x-auto">
        {[
          { key: 'suggestions', label: 'Suggestions',  count: buckets.suggestions.length, hot: buckets.suggestions.length > 0 },
          { key: 'unscheduled', label: 'Unscheduled', count: buckets.unscheduled.length, urgent: buckets.unscheduled.length > 0 },
          { key: 'scheduled',   label: 'Scheduled',   count: buckets.scheduled.length },
          { key: 'calendar',    label: 'Calendar' },
          { key: 'all',         label: 'All Jobs',    count: allJobs.length },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-2 text-[12.5px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors',
              tab === t.key ? 'text-brand-600 border-brand-500' : 'text-ink-500 border-transparent hover:text-ink-700'
            )}>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={clsx(
                'ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] px-1.5 py-0.5 min-w-[18px]',
                t.urgent ? 'bg-state-down text-white' :
                t.hot ? 'bg-state-idle text-white' :
                'bg-ink-100 text-ink-600'
              )}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* In-progress strip — shown on every tab except calendar */}
      {tab !== 'calendar' && buckets.inProgress.length > 0 && (
        <div className="rounded-xl border-2 border-brand-500/20 bg-brand-50/40 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Play className="h-4 w-4 text-brand-500" />
            <div className="font-bold text-[13px] text-ink-900">{buckets.inProgress.length} job{buckets.inProgress.length !== 1 ? 's' : ''} in progress</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {buckets.inProgress.slice(0, 6).map((job) => (
              <InProgressTile key={job._id} job={job} onOpen={() => nav(`/tracking?orderNumber=${job.orderNumber}`)} />
            ))}
          </div>
        </div>
      )}

      {query.isLoading ? (
        <div className="text-center py-10 text-[12.5px] text-ink-400">Loading orders…</div>
      ) : tab === 'suggestions' ? (
        <SuggestionsView
          suggestions={buckets.suggestions}
          onOpen={setScheduleJob}
          onStart={(j) => releaseMut.mutate(j._id)}
          onDelete={(j) => deleteMut.mutate(j._id)}
          isReleasing={releaseMut.isPending}
          isDeleting={deleteMut.isPending}
        />
      ) : tab === 'unscheduled' ? (
        <UnscheduledView
          jobs={buckets.unscheduled}
          onSchedule={setScheduleJob}
          onDelete={(j) => deleteMut.mutate(j._id)}
          isDeleting={deleteMut.isPending}
        />
      ) : tab === 'scheduled' ? (
        <ScheduledView jobs={buckets.scheduled} onSchedule={setScheduleJob} onTrack={(j) => nav(`/tracking?orderNumber=${j.orderNumber}`)} />
      ) : tab === 'calendar' ? (
        <CalendarView byDay={buckets.byDay} weekOffset={weekOffset} setWeekOffset={setWeekOffset} onSchedule={setScheduleJob} />
      ) : (
        <AllJobsView jobs={allJobs} onClick={(job) => nav(`/tracking?orderNumber=${job.orderNumber}`)} onSchedule={setScheduleJob} />
      )}

      {scheduleJob && (
        <ScheduleAssignModal
          job={scheduleJob}
          onClose={() => setScheduleJob(null)}
          onSaved={() => {
            setScheduleJob(null);
            qc.invalidateQueries({ queryKey: ['jobs'] });
          }}
        />
      )}

      {showCreateJob && (
        <CreateJobModal
          onClose={() => setShowCreateJob(false)}
          onCreated={(newJob) => {
            setShowCreateJob(false);
            qc.invalidateQueries({ queryKey: ['jobs'] });
            // Open the newly created job in the schedule modal so the
            // admin can immediately set start date + assign operators
            setScheduleJob(newJob);
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

function InProgressTile({ job, onOpen }) {
  return (
    <div onClick={onOpen}
      className="rounded-lg bg-white border border-ink-200 p-2.5 hover:border-brand-500 cursor-pointer">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="font-mono text-[12px] font-bold text-brand-600">{job.orderNumber}</span>
        <span className="chip-blue text-[10px] capitalize">{currentStageName(job).replace(/_/g, ' ')}</span>
      </div>
      <div className="text-[11.5px] font-semibold text-ink-700 truncate">{job.product?.name}</div>
      <div className="mt-1.5 h-1 bg-ink-100 rounded-full overflow-hidden">
        <div className="h-full bg-state-running" style={{ width: `${progressPct(job)}%` }} />
      </div>
    </div>
  );
}

/* ════════════ SUGGESTIONS VIEW ════════════ */
function SuggestionsView({ suggestions, onOpen, onStart, onDelete, isReleasing, isDeleting }) {
  if (suggestions.length === 0) {
    return (
      <div className="panel text-center py-12">
        <Sparkles className="h-10 w-10 mx-auto text-ink-300 mb-2" />
        <div className="font-bold text-[14px] text-ink-900">No suggestions right now</div>
        <div className="text-[12px] text-ink-500 mt-1">Schedule unscheduled jobs to see them here.</div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border-2 border-state-idle/30 bg-gradient-to-br from-state-idle/5 to-brand-500/5 p-4 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-state-idle" />
        <div className="font-bold text-[14px] text-ink-900">
          You have {suggestions.length} job{suggestions.length !== 1 ? 's' : ''} ready to start
        </div>
      </div>
      {suggestions.map((job) => (
        <SuggestionRow
          key={job._id}
          job={job}
          onOpen={onOpen}
          onStart={onStart}
          onDelete={onDelete}
          isReleasing={isReleasing}
          isDeleting={isDeleting}
        />
      ))}
    </div>
  );
}

function SuggestionRow({ job, onOpen, onStart, onDelete, isReleasing, isDeleting }) {
  const priority = PRIORITY_PILL[job.priority || 'normal'];
  const status = STATUS_BADGE[job.status];
  const start = job.plannedStart ? new Date(job.plannedStart) : null;
  const isToday = start && start.toDateString() === new Date().toDateString();
  const isPast = start && start < new Date();
  const daysUntil = start ? Math.ceil((start - new Date()) / 86400000) : null;

  // First stage assignment status
  const firstStage = job.stages?.[0];
  const hasOperator = firstStage?.operatorId;
  const hasMachine = firstStage?.machineId;

  return (
    <div className="rounded-lg bg-white border border-ink-200 p-3 flex items-center gap-3">
      {start && (
        <div className={clsx(
          'flex flex-col items-center justify-center rounded-lg w-14 h-14 shrink-0 text-center',
          isToday ? 'bg-brand-500 text-white' :
          isPast ? 'bg-state-down/10 text-state-down' :
          'bg-ink-50 text-ink-700'
        )}>
          <div className="text-[9px] font-semibold uppercase">{start.toLocaleDateString('en-IN', { weekday: 'short' })}</div>
          <div className="text-[18px] font-bold leading-none">{start.getDate()}</div>
          <div className="text-[8.5px] uppercase">{start.toLocaleDateString('en-IN', { month: 'short' })}</div>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="font-mono text-[12.5px] font-bold text-brand-600">{job.orderNumber}</span>
          <span className={clsx('text-[9.5px] font-bold px-1.5 py-0.5 rounded-full border', priority.cls)}>{priority.text}</span>
          <span className={clsx('text-[9.5px] font-bold px-1.5 py-0.5 rounded-md', status.cls)}>{status.text}</span>
          {isToday && <span className="chip-blue text-[9.5px] font-bold">TODAY</span>}
          {isPast && job.status === 'planned' && <span className="chip-yellow text-[9.5px] font-bold">OVERDUE</span>}
          {(!hasOperator || !hasMachine) && <span className="chip-yellow text-[9.5px] font-bold">UNASSIGNED</span>}
        </div>
        <div className="font-bold text-[13px] text-ink-900 truncate">{job.product?.name}</div>
        <div className="text-[11px] text-ink-500 flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="font-semibold">{job.plannedQty} {job.uom}</span>
          {job.customer && <span>· {job.customer}</span>}
          {start && (
            <span>
              · <Clock className="h-3 w-3 inline" /> {start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              {daysUntil !== null && daysUntil > 0 && ` (in ${daysUntil}d)`}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 shrink-0">
        <button onClick={() => onOpen(job)} className="btn-secondary btn-sm whitespace-nowrap">
          <SettingsIcon className="h-3.5 w-3.5" /> Edit
        </button>
        {job.status === 'planned' && (
          <button onClick={() => onStart(job)} disabled={isReleasing}
            className="btn-primary btn-sm whitespace-nowrap">
            {isReleasing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start Now
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => {
              if (window.confirm(`Delete job ${job.orderNumber}? This cannot be undone.`)) onDelete(job);
            }}
            disabled={isDeleting}
            className="btn-secondary btn-sm whitespace-nowrap !text-state-down hover:!bg-state-down/5"
            title="Delete this job"
          >
            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/* ════════════ UNSCHEDULED VIEW ════════════ */
function UnscheduledView({ jobs, onSchedule, onDelete, isDeleting }) {
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
        <UnscheduledRow key={job._id} job={job} onSchedule={onSchedule} onDelete={onDelete} isDeleting={isDeleting} />
      ))}
    </div>
  );
}

function UnscheduledRow({ job, onSchedule, onDelete, isDeleting }) {
  const priority = PRIORITY_PILL[job.priority || 'normal'];
  const daysToDue = job.dueDate ? Math.ceil((new Date(job.dueDate) - new Date()) / 86400000) : null;
  const handleDelete = () => {
    if (window.confirm(`Delete job ${job.orderNumber} (${job.product?.name})? This cannot be undone.`)) {
      onDelete(job);
    }
  };
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={clsx('h-10 w-1.5 rounded-full',
        priority.cls.includes('down') ? 'bg-state-down' :
        priority.cls.includes('idle') ? 'bg-state-idle' :
        'bg-state-running'
      )} />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-[13px] font-bold text-brand-600">{job.orderNumber}</span>
          <span className="text-[10.5px] text-ink-400 font-mono">{job.jobNumber}</span>
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
            )}>· Due in {daysToDue}d</span>
          )}
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="h-9 w-9 rounded-md text-state-down hover:bg-state-down/5 grid place-items-center"
        title="Delete this job"
      >
        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
      <button onClick={() => onSchedule(job)} className="btn-primary">
        <Calendar className="h-4 w-4" /> Schedule &amp; Assign
      </button>
    </div>
  );
}

/* ════════════ SCHEDULED VIEW ════════════ */
function ScheduledView({ jobs, onSchedule, onTrack }) {
  if (jobs.length === 0) {
    return (
      <div className="panel text-center py-12">
        <CalendarClock className="h-10 w-10 mx-auto text-ink-300 mb-2" />
        <div className="font-bold text-[14px] text-ink-900">No scheduled jobs</div>
        <div className="text-[12px] text-ink-500 mt-1">Schedule unscheduled jobs to see them here.</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <ScheduledRow key={job._id} job={job} onSchedule={onSchedule} onTrack={onTrack} />
      ))}
    </div>
  );
}

function ScheduledRow({ job, onSchedule, onTrack }) {
  const start = new Date(job.plannedStart);
  const dayName = start.toLocaleDateString('en-IN', { weekday: 'short' });
  const dayNum = start.getDate();
  const dayMonth = start.toLocaleDateString('en-IN', { month: 'short' });
  const timeStr = start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const isToday = start.toDateString() === new Date().toDateString();
  const isPast = start < new Date() && job.status !== 'in_progress';
  const status = STATUS_BADGE[job.status] || { text: job.status, cls: 'bg-ink-100 text-ink-600' };

  // Stage assignment summary
  const assignedStages = (job.stages || []).filter((s) => s.operatorId || s.machineId).length;
  const totalStages = (job.stages || []).length;

  return (
    <div className={clsx('card p-4 flex items-center gap-4',
      isToday && 'border-2 border-brand-500/50',
      isPast && job.status === 'planned' && 'border-2 border-state-idle/40'
    )}>
      <div className={clsx('flex flex-col items-center justify-center rounded-lg w-16 h-16 shrink-0',
        isToday ? 'bg-brand-500 text-white' : 'bg-ink-50 text-ink-700'
      )}>
        <div className="text-[10px] font-semibold uppercase">{dayName}</div>
        <div className="text-[20px] font-bold leading-none">{dayNum}</div>
        <div className="text-[9px] uppercase">{dayMonth}</div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-[13px] font-bold text-brand-600">{job.orderNumber}</span>
          <span className={`${status.cls} text-[10px] font-bold px-2 py-0.5 rounded-md capitalize`}>{status.text}</span>
          {isToday && <span className="chip-blue text-[10px] font-bold">TODAY</span>}
          {isPast && job.status === 'planned' && <span className="chip-yellow text-[10px] font-bold">OVERDUE</span>}
          <span className="text-[10px] text-ink-500">
            <UserIcon className="h-3 w-3 inline" /> {assignedStages}/{totalStages} stages assigned
          </span>
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
          <SettingsIcon className="h-3.5 w-3.5" /> Edit
        </button>
        <button onClick={() => onTrack(job)} className="btn-primary btn-sm">
          <MapPin className="h-3.5 w-3.5" /> Track
        </button>
      </div>
    </div>
  );
}

/* ════════════ CALENDAR VIEW ════════════ */
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
          <ChevronLeft className="h-4 w-4" /> Prev
        </button>
        <div className="font-bold text-[13px] text-ink-900">
          {weekStart.toLocaleDateString('en-IN', { month: 'long', day: 'numeric' })} —
          {' '}{days[6].toLocaleDateString('en-IN', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
        <button onClick={() => setWeekOffset(weekOffset + 1)} className="btn-secondary btn-sm">
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            const dayJobs = byDay[key] || [];
            const isToday = d.toDateString() === new Date().toDateString();
            return (
              <div key={key} className={clsx('rounded-lg border min-h-[180px] p-2',
                isToday ? 'border-brand-500 bg-brand-50/30' : 'border-ink-200 bg-white'
              )}>
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
                  ) : dayJobs.map((job) => (
                    <button key={job._id} onClick={() => onSchedule(job)}
                      className="w-full text-left rounded p-1.5 border border-ink-200 text-[10px] hover:shadow-sm bg-white">
                      <div className="font-mono font-bold text-brand-600 truncate">{job.orderNumber}</div>
                      <div className="font-semibold text-ink-700 truncate mt-0.5">{job.product?.name}</div>
                      <div className="text-ink-400 mt-0.5">{job.plannedQty} {job.uom}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════ ALL JOBS VIEW (cards) ════════════ */
function AllJobsView({ jobs, onClick, onSchedule }) {
  if (jobs.length === 0) {
    return (
      <div className="panel text-center py-12">
        <Package className="h-8 w-8 text-ink-300 mx-auto mb-2" />
        <div className="font-bold text-[14px] text-ink-700">No Job Orders yet</div>
        <Link to="/sales-orders" className="btn-primary mt-4 inline-flex">Open Sales Orders</Link>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {jobs.map((job) => (
        <JobCard key={job._id} job={job} onClick={() => onClick(job)} onSchedule={() => onSchedule(job)} />
      ))}
    </div>
  );
}

function JobCard({ job, onClick, onSchedule }) {
  const priorityColor = {
    high: 'linear-gradient(90deg,#b91c1c,#dc2626)',
    medium: 'linear-gradient(90deg,#b45309,#d97706)',
    normal: 'linear-gradient(90deg,#047857,#059669)',
  }[job.priority || 'normal'];

  const priority = PRIORITY_PILL[job.priority || 'normal'];
  const status = STATUS_BADGE[job.status] || { text: job.status, cls: 'bg-ink-100 text-ink-600' };
  const stage = currentStageName(job);
  const progress = progressPct(job);

  return (
    <div onClick={onClick}
      className="card overflow-hidden hover:-translate-y-px hover:shadow-cardHov transition-transform cursor-pointer">
      <div className="h-1" style={{ background: priorityColor }} />
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div>
            <div className="font-mono text-[13px] font-bold text-brand-600">{job.orderNumber}</div>
            <div className="text-[10.5px] text-ink-400 font-mono">{job.jobNumber}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={clsx('text-[9.5px] font-bold px-2 py-0.5 rounded-full border', priority.cls)}>{priority.text}</span>
            <span className={clsx('text-[9.5px] font-bold px-2 py-0.5 rounded-md', status.cls)}>{status.text}</span>
          </div>
        </div>
        <div className="mb-2">
          <div className="font-bold text-[13px] text-ink-900 leading-tight">{job.product?.name}</div>
          <div className="text-[11px] text-ink-500">{job.customer || '—'}</div>
        </div>
        <div className="mb-2.5">
          <div className="flex justify-between text-[10.5px] mb-0.5">
            <span className="text-ink-500 capitalize">
              {stage === 'not_started' ? 'Not Started' : stage.replace(/_/g, ' ')}
            </span>
            <span className="font-bold text-ink-700 tabular-nums">{progress}%</span>
          </div>
          <div className="h-1 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full" style={{ width: `${progress}%`, background: priorityColor }} />
          </div>
        </div>
        <div className="flex gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="flex-1 rounded-md border border-state-down/20 bg-state-down/5 text-state-down text-[10.5px] font-semibold py-1">
            <MapPin size={11} className="inline" /> Track
          </button>
          <button onClick={(e) => { e.stopPropagation(); onSchedule(); }}
            className="flex-1 rounded-md border border-brand-500/20 bg-brand-50 text-brand-600 text-[10.5px] font-semibold py-1">
            <SettingsIcon size={11} className="inline" /> Edit
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * SCHEDULE & ASSIGN MODAL
 *
 * Single modal that handles:
 *   • Setting plannedStart, plannedEnd, dueDate, priority
 *   • Assigning operator + machine for EACH stage
 *   • Releasing the job (start now)
 * ══════════════════════════════════════════════════════════════════════ */
function ScheduleAssignModal({ job, onClose, onSaved }) {
  const [form, setForm] = useState({
    plannedStart: job.plannedStart ? new Date(job.plannedStart).toISOString().slice(0, 16) : '',
    plannedEnd: job.plannedEnd ? new Date(job.plannedEnd).toISOString().slice(0, 16) : '',
    dueDate: job.dueDate ? new Date(job.dueDate).toISOString().slice(0, 10) : '',
    priority: job.priority || 'normal',
  });
  const [stageAssignments, setStageAssignments] = useState(
    (job.stages || []).map((s) => ({
      stageId: String(s._id),
      stage: s.stage,
      status: s.status,
      operatorId: s.operatorId ? (typeof s.operatorId === 'object' ? String(s.operatorId._id) : String(s.operatorId)) : '',
      machineId: s.machineId ? (typeof s.machineId === 'object' ? String(s.machineId._id) : String(s.machineId)) : '',
      plannedStart: s.plannedStart ? new Date(s.plannedStart).toISOString().slice(0, 16) : '',
    }))
  );
  const [error, setError] = useState('');
  const [expandStages, setExpandStages] = useState(true);

  // Load operators (users)
  const operatorsQuery = useQuery({
    queryKey: ['operators-dropdown'],
    queryFn: async () => (await adminApi.listUsers()).data,
  });
  // Load machines
  const machinesQuery = useQuery({
    queryKey: ['machines-dropdown'],
    queryFn: async () => (await machineApi.list({ limit: 100 })).data,
  });

  const operators = operatorsQuery.data || [];
  const machines = machinesQuery.data || [];

  // Save schedule (date/priority) AND assignments per stage
  const saveMut = useMutation({
    mutationFn: async () => {
      // 1. Update schedule
      const sched = {};
      if (form.plannedStart) sched.plannedStart = new Date(form.plannedStart).toISOString();
      if (form.plannedEnd) sched.plannedEnd = new Date(form.plannedEnd).toISOString();
      if (form.dueDate) sched.dueDate = new Date(form.dueDate).toISOString();
      if (form.priority) sched.priority = form.priority;
      await jobApi.schedule(job._id, sched);

      // 2. Update each stage that has changed assignments
      for (const sa of stageAssignments) {
        const orig = job.stages.find((s) => String(s._id) === sa.stageId);
        const origOpId = orig?.operatorId
          ? (typeof orig.operatorId === 'object' ? String(orig.operatorId._id) : String(orig.operatorId))
          : '';
        const origMachId = orig?.machineId
          ? (typeof orig.machineId === 'object' ? String(orig.machineId._id) : String(orig.machineId))
          : '';
        const origPlanned = orig?.plannedStart ? new Date(orig.plannedStart).toISOString().slice(0, 16) : '';

        const changed = sa.operatorId !== origOpId || sa.machineId !== origMachId || sa.plannedStart !== origPlanned;
        if (!changed) continue;

        const body = {};
        body.operatorId = sa.operatorId || null;
        body.machineId = sa.machineId || null;
        if (sa.plannedStart) body.plannedStart = new Date(sa.plannedStart).toISOString();

        await jobApi.assignStage(job._id, sa.stageId, body);
      }
      return { ok: true };
    },
    onSuccess: onSaved,
    onError: (e) => {
      if (e.code === 'E_VALIDATION' && e.details) {
        setError(e.details.map((d) => `${d.path}: ${d.message}`).join('; '));
      } else {
        setError(e.message);
      }
    },
  });

  const releaseMut = useMutation({
    mutationFn: async () => (await jobApi.release(job._id)).data,
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  const updateStage = (i, patch) =>
    setStageAssignments(stageAssignments.map((s, j) => i === j ? { ...s, ...patch } : s));

  function suggestEndDate() {
    if (!form.plannedStart) return;
    const start = new Date(form.plannedStart);
    const days = Math.max(1, Math.ceil((job.plannedQty || 100) / 100));
    const end = new Date(start);
    end.setDate(start.getDate() + days);
    setForm({ ...form, plannedEnd: end.toISOString().slice(0, 16) });
  }

  // Filter machines by stage
  const machinesByStage = useMemo(() => {
    const m = {};
    for (const machine of machines) {
      const key = machine.stage || 'any';
      if (!m[key]) m[key] = [];
      m[key].push(machine);
    }
    return m;
  }, [machines]);

  const allStagesAssigned = stageAssignments.every((s) => s.operatorId && s.machineId);
  const someAssigned = stageAssignments.some((s) => s.operatorId || s.machineId);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); setError(''); saveMut.mutate(); }}
        onClick={(e) => e.stopPropagation()}
        className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl my-4"
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Schedule &amp; Assign</div>
            <h2 className="text-[17px] font-bold text-ink-900 font-mono">{job.orderNumber}</h2>
            <div className="text-[12.5px] text-ink-700 mt-0.5">{job.product?.name}</div>
            <div className="text-[11.5px] text-ink-500">
              {job.plannedQty} {job.uom} {job.customer && `· ${job.customer}`}
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Date + priority section */}
          <div className="space-y-3">
            <div className="font-bold text-[13px] text-ink-900 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-brand-500" /> When will you start?
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Start Date &amp; Time *</label>
                <input
                  type="datetime-local" required
                  className="input"
                  value={form.plannedStart}
                  onChange={(e) => setForm({ ...form, plannedStart: e.target.value })}
                />
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
              <div>
                <label className="label">Due Date (customer)</label>
                <input
                  type="date" className="input"
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
          </div>

          {/* Stage assignments */}
          <div className="border-t border-ink-100 pt-4">
            <button type="button" onClick={() => setExpandStages(!expandStages)}
              className="w-full flex items-center justify-between mb-3">
              <div className="font-bold text-[13px] text-ink-900 flex items-center gap-2">
                <Factory className="h-4 w-4 text-brand-500" />
                Assign Operator &amp; Machine for Each Stage
                {allStagesAssigned ? (
                  <span className="chip-green text-[10px] font-bold">All Assigned</span>
                ) : someAssigned ? (
                  <span className="chip-yellow text-[10px] font-bold">Partial</span>
                ) : (
                  <span className="chip-gray text-[10px] font-bold">None Assigned</span>
                )}
              </div>
              {expandStages ? <ChevronUp className="h-4 w-4 text-ink-400" /> : <ChevronDown className="h-4 w-4 text-ink-400" />}
            </button>

            {expandStages && (
              <div className="space-y-2">
                <div className="text-[11px] text-ink-500">
                  When the operator opens the My Jobs screen, this job will appear under their assignments. They'll see exactly which stage they're handling and on which machine.
                </div>
                {stageAssignments.map((sa, idx) => {
                  const stageDef = STAGES_DEF.find((s) => s.key === sa.stage);
                  const stageMachines = [
                    ...(machinesByStage[sa.stage] || []),
                    ...(machinesByStage.any || []),
                  ];
                  const isCompleted = sa.status === 'completed' || sa.status === 'skipped';
                  return (
                    <div key={sa.stageId} className={clsx(
                      'rounded-lg border p-3 grid grid-cols-12 gap-2',
                      isCompleted ? 'border-ink-100 bg-ink-50 opacity-60' : 'border-ink-200 bg-white'
                    )}>
                      <div className="col-span-12 md:col-span-3 flex items-center gap-2">
                        <div className={clsx(
                          'w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold',
                          sa.status === 'completed' ? 'bg-state-running text-white' :
                          sa.status === 'in_progress' ? 'bg-brand-500 text-white' :
                          sa.status === 'ready' ? 'bg-state-idle/20 text-state-idle' :
                          'bg-ink-100 text-ink-500'
                        )}>{idx + 1}</div>
                        <div>
                          <div className="font-bold text-[12.5px] capitalize">{stageDef?.label || sa.stage}</div>
                          <div className="text-[9.5px] text-ink-500 capitalize">{sa.status.replace(/_/g, ' ')}</div>
                        </div>
                      </div>

                      <div className="col-span-12 md:col-span-4">
                        <label className="label !text-[10px]">Operator</label>
                        <select
                          className="input !py-1 text-[12px]"
                          value={sa.operatorId}
                          onChange={(e) => updateStage(idx, { operatorId: e.target.value })}
                          disabled={isCompleted}
                        >
                          <option value="">— Select operator —</option>
                          {operators.map((o) => (
                            <option key={o._id} value={o._id}>{o.name} ({o.employeeCode || o.email})</option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-12 md:col-span-4">
                        <label className="label !text-[10px]">Machine</label>
                        <select
                          className="input !py-1 text-[12px]"
                          value={sa.machineId}
                          onChange={(e) => updateStage(idx, { machineId: e.target.value })}
                          disabled={isCompleted}
                        >
                          <option value="">— Select machine —</option>
                          {stageMachines.map((m) => (
                            <option key={m._id} value={m._id}>{m.name} ({m.code})</option>
                          ))}
                        </select>
                        {stageMachines.length === 0 && (
                          <div className="text-[9.5px] text-state-down mt-0.5">No machines for this stage</div>
                        )}
                      </div>

                      <div className="col-span-12 md:col-span-1 flex items-end justify-end">
                        {sa.operatorId && sa.machineId && (
                          <CheckCircle2 className="h-5 w-5 text-state-running" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
              <button type="button" onClick={() => releaseMut.mutate()} disabled={releaseMut.isPending}
                className="btn-secondary text-state-running"
                title="Release job to operators (skip scheduling)">
                {releaseMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Release Now
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saveMut.isPending}>
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Schedule &amp; Assignments
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * CREATE JOB MODAL
 *
 * Lets admin create a Job Order without a Sales Order — useful for:
 *   - In-house production (e.g. samples, R&D batches)
 *   - Re-runs / rework
 *   - Stock builds without a customer order yet
 *
 * After creating, the admin is taken straight to the Schedule & Assign
 * modal to set start date and operators.
 * ══════════════════════════════════════════════════════════════════════ */
function CreateJobModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    customer: '',          // optional — can be in-house
    productSku: '',
    productName: '',
    plannedQty: '',
    uom: 'kg',
    priority: 'normal',
    dueDate: '',
    bomExternalId: '',     // optional — pre-fills from chosen BOM
  });
  const [err, setErr] = useState('');

  // Load BOMs to allow picking one — selected BOM auto-fills product details + bomSnapshot
  const boms = useQuery({
    queryKey: ['boms', 'active'],
    queryFn: async () => (await bomApi.list({ active: true, limit: 200 })).data,
  });

  const selectedBom = (boms.data || []).find((b) => b.externalId === form.bomExternalId);

  // Auto-fill product details when BOM is picked
  const handleBomChange = (extId) => {
    const bom = (boms.data || []).find((b) => b.externalId === extId);
    setForm((f) => ({
      ...f,
      bomExternalId: extId,
      productSku: bom?.productSku || f.productSku,
      productName: bom?.productName || f.productName,
    }));
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const body = {
        customer: form.customer || 'In-house',
        product: {
          sku: String(form.productSku).toUpperCase(),
          name: form.productName,
        },
        plannedQty: Number(form.plannedQty),
        uom: form.uom,
        priority: form.priority,
        dueDate: form.dueDate || undefined,
      };
      // Attach BOM snapshot if one was picked
      if (selectedBom) {
        body.bomSnapshot = {
          externalId: selectedBom.externalId,
          version: selectedBom.version,
          components: (selectedBom.components || []).map((c) => ({
            sku: c.sku,
            name: c.name,
            qtyPerUnit: c.qtyPerUnit,
            uom: c.uom,
            scrapPct: c.scrapPct,
            stages: c.stages,
          })),
        };
      }
      return (await jobApi.create(body)).data;
    },
    onSuccess: (job) => onCreated(job),
    onError: (e) => {
      if (Array.isArray(e.details) && e.details.length > 0) {
        setErr(`${e.message}:\n${e.details.map((d) => `• ${d.path}: ${d.message}`).join('\n')}`);
      } else {
        setErr(e.message || 'Could not create job');
      }
    },
  });

  const canSubmit = (
    form.productSku.trim() &&
    form.productName.trim() &&
    Number(form.plannedQty) > 0
  );

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (!canSubmit) return setErr('Fill all required fields');
    createMut.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Create Job Order</div>
            <h2 className="text-[17px] font-bold text-ink-900">New production job (no Sales Order)</h2>
            <div className="text-[11.5px] text-ink-500 mt-0.5">Use this for in-house production, rework, or stock builds.</div>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 grid place-items-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* BOM picker — optional but recommended */}
          <label className="block">
            <span className="label">Select BOM (optional but recommended)</span>
            <select
              className="input"
              value={form.bomExternalId}
              onChange={(e) => handleBomChange(e.target.value)}
            >
              <option value="">— No BOM (manual entry) —</option>
              {(boms.data || []).map((b) => (
                <option key={b._id} value={b.externalId}>
                  {b.productSku} · {b.productName} (v{b.version})
                </option>
              ))}
            </select>
            {selectedBom && (
              <div className="mt-1 text-[10.5px] text-state-running">
                ✓ {selectedBom.components?.length || 0} component(s) will be linked to this job
              </div>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Product SKU *</span>
              <input
                required
                className="input font-mono"
                value={form.productSku}
                onChange={(e) => setForm({ ...form, productSku: e.target.value.toUpperCase() })}
                placeholder="e.g. POUCH-NAMKIN-200G"
              />
            </label>
            <label className="block">
              <span className="label">Product Name *</span>
              <input
                required
                className="input"
                value={form.productName}
                onChange={(e) => setForm({ ...form, productName: e.target.value })}
                placeholder="e.g. Printed Namkin Pouch 200g"
              />
            </label>
            <label className="block">
              <span className="label">Customer</span>
              <input
                className="input"
                value={form.customer}
                onChange={(e) => setForm({ ...form, customer: e.target.value })}
                placeholder="In-house (default)"
              />
            </label>
            <label className="block">
              <span className="label">Priority</span>
              <select
                className="input"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="normal">Normal</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Quantity *</span>
              <div className="flex gap-2">
                <input
                  required type="number" min="1" step="1"
                  className="input flex-1 tabular-nums"
                  value={form.plannedQty}
                  onChange={(e) => setForm({ ...form, plannedQty: e.target.value })}
                />
                <select
                  className="input w-20"
                  value={form.uom}
                  onChange={(e) => setForm({ ...form, uom: e.target.value })}
                >
                  <option value="kg">kg</option>
                  <option value="pcs">pcs</option>
                  <option value="m">m</option>
                  <option value="rolls">rolls</option>
                </select>
              </div>
            </label>
            <label className="block">
              <span className="label">Due Date</span>
              <input
                type="date"
                className="input"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </label>
          </div>

          {err && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/20 p-3 text-[12px] text-state-down whitespace-pre-line">
              {err}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center py-3 text-[14px]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || createMut.isPending}
            className={clsx(
              'flex-[2] rounded-lg text-white text-[15px] font-bold py-3 transition flex items-center justify-center gap-2',
              canSubmit && !createMut.isPending
                ? 'bg-brand-500 hover:brightness-95 active:scale-[0.99]'
                : 'bg-ink-300 cursor-not-allowed'
            )}
          >
            {createMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            CREATE JOB & SCHEDULE
          </button>
        </div>
      </form>
    </div>
  );
}
