import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Play, Pause, CheckCircle2, Plus, Trash2, Loader2, Scale, Factory, User, Package, Activity,
  ChevronRight, ArrowRight, AlertCircle, ArrowLeft, Settings, LogOut,
  ShoppingCart, X, Truck, Clock, Send,
} from 'lucide-react';
import clsx from 'clsx';
import { jobApi, machineApi, authApi, materialRequestApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { useSocket, closeAllSockets } from '../hooks/useSocket.js';

/**
 * OPERATOR SCREEN — intentionally big, simple, minimal text.
 *
 * Design goals:
 *   - Large tap targets (≥48px)
 *   - Colored status at-a-glance (green = go, blue = active, orange = do QC, red = issue)
 *   - Minimal reading; icons + numbers
 *   - One operator action per card ("Start", "Finish & Send Next")
 *   - Live IoT data flows in automatically via socket for the in-progress stage
 */

const STAGE_META = {
  printing:   { label: 'Printing',   icon: '🖨️', color: '#1a6bff' },
  inspection: { label: 'Inspection', icon: '🔍', color: '#0891b2' },
  lamination: { label: 'Lamination', icon: '🧲', color: '#7c3aed' },
  hot_room:   { label: 'Hot Room',   icon: '🔥', color: '#ea580c' },
  slitting:   { label: 'Slitting',   icon: '✂️', color: '#d97706' },
  cutting:    { label: 'Cutting',    icon: '🗂️', color: '#059669' },
  packaging:  { label: 'Packaging',  icon: '📦', color: '#0050d9' },
};

export function OperatorHomePage() {
  const user = authStore((s) => s.user);
  const refreshToken = authStore((s) => s.refreshToken);
  const nav = useNavigate();
  const [activeJob, setActiveJob] = useState(null);

  const jobs = useQuery({
    queryKey: ['my-jobs', user?.id],
    queryFn: async () => (await jobApi.myJobs()).data,
    refetchInterval: 15_000,
  });

  // Detect if this user has admin permissions — show "Admin View" only for them
  const perms = user?.permissions || [];
  const isAdminUser = perms.some((p) =>
    /^(production|inventory|sales_orders|purchase_orders|users|roles|teams|reports):(view|create|update|delete)$/.test(p)
  );

  const handleLogout = async () => {
    try { if (refreshToken) await authApi.logout(refreshToken); } catch { /* ignore */ }
    closeAllSockets();
    authStore.getState().clear();
    nav('/login', { replace: true });
  };

  if (activeJob) {
    return <OperatorStageRunner job={activeJob} onClose={() => setActiveJob(null)} />;
  }

  return (
    <div className="min-h-screen p-5 max-w-[1100px] mx-auto space-y-5">
      {/* Greeting */}
      <div className="panel bg-gradient-to-br from-brand-500 to-brand-700 text-white border-0 relative">
        {/* Top-right action buttons */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {isAdminUser && (
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-md backdrop-blur-sm"
              title="Switch back to Admin / Manager view"
            >
              <Settings className="h-3 w-3" /> Admin View
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-md backdrop-blur-sm"
            title="Sign out"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-white/20 grid place-items-center text-[22px] font-bold">
            {(user?.name?.[0] || '?').toUpperCase()}
          </div>
          <div>
            <div className="text-[12px] opacity-90">Welcome back,</div>
            <h1 className="text-[22px] font-bold leading-tight">{user?.name}</h1>
            <div className="text-[11px] opacity-80 mt-0.5">
              {user?.employeeCode} {user?.shift && `· Shift ${user.shift}`}
            </div>
          </div>
        </div>
      </div>

      {/* My jobs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[16px] font-bold text-ink-900">My Jobs</h2>
          {(() => {
            const all = jobs.data || [];
            const active = all.filter(j => j.myStage && ['ready', 'in_progress'].includes(j.myStage.status));
            const done = all.length - active.length;
            return (
              <div className="flex items-center gap-2">
                {active.length > 0 && (
                  <div className="text-[11px] text-brand-600 bg-brand-500/10 font-bold px-2.5 py-1 rounded-full">
                    {active.length} active
                  </div>
                )}
                {done > 0 && (
                  <div className="text-[11px] text-state-running bg-state-running/10 font-bold px-2.5 py-1 rounded-full">
                    {done} done
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {jobs.isLoading ? (
          <div className="text-center py-10 text-[12.5px] text-ink-400">Loading your jobs…</div>
        ) : (jobs.data || []).length === 0 ? (
          <div className="panel text-center py-12">
            <div className="text-[40px] mb-2">☕</div>
            <div className="font-bold text-[16px] text-ink-700">No jobs assigned to you right now</div>
            <div className="text-[12px] text-ink-500 mt-1 max-w-md mx-auto">
              You are signed in as <strong>{user?.name}</strong>. Jobs will appear here once a manager assigns them to you in Planning &amp; Scheduling.
            </div>
            {isAdminUser && (
              <div className="mt-4 text-[11.5px] text-ink-500">
                <Link to="/planning" className="text-brand-600 font-semibold hover:underline">
                  Go to Planning & Scheduling →
                </Link>
                {' '}to assign jobs.
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {(jobs.data || []).map((j) => (
              <OperatorJobCard key={j._id} job={j} onOpen={() => setActiveJob(j)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Job card in the "My Jobs" list ─── */
function OperatorJobCard({ job, onOpen }) {
  const stage = job.myStage;
  const meta = STAGE_META[stage?.stage] || {};
  const isActive = stage?.status === 'in_progress';
  const isReady = stage?.status === 'ready';
  const isStageDone = stage?.status === 'completed';
  const isPending = stage?.status === 'pending';
  const jobDone = job.jobCompleted || job.status === 'completed';

  // For completed stages, show what they finished + weight
  const weightDisplay = isStageDone
    ? (stage?.weightOutKg ?? '—')
    : (stage?.weightInKg || job.inputRollWeightKg || '—');
  const weightLabel = isStageDone ? 'Weight Out' : 'Weight In';

  return (
    <button
      onClick={onOpen}
      disabled={isPending}
      className={clsx(
        'w-full text-left card overflow-hidden transition',
        isActive && 'ring-2 ring-brand-500/40',
        (isStageDone || jobDone) && 'opacity-80',
        isPending && 'opacity-60 cursor-not-allowed',
        !isPending && !jobDone && !isStageDone && 'hover:-translate-y-px hover:shadow-cardHov'
      )}
    >
      <div className="flex items-stretch">
        {/* Stage icon block */}
        <div
          className="w-[80px] shrink-0 grid place-items-center text-[34px]"
          style={{ background: `${meta.color || '#94a3b8'}10`, borderRight: `2px solid ${meta.color || '#94a3b8'}30` }}
        >
          {meta.icon || '✓'}
        </div>

        {/* Details */}
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="font-mono text-[13px] font-bold text-brand-600">{job.orderNumber}</div>
              <div className="font-bold text-[16px] text-ink-900 leading-tight">{job.product?.name}</div>
              <div className="text-[11px] text-ink-500 mt-0.5">{job.customer}</div>
            </div>
            {job.priority === 'high' && !jobDone && (
              <span className="bg-state-down/10 text-state-down text-[9.5px] font-bold px-2 py-1 rounded-full border border-state-down/20">
                ● HIGH PRIORITY
              </span>
            )}
            {jobDone && (
              <span className="bg-state-running/10 text-state-running text-[9.5px] font-bold px-2 py-1 rounded-full border border-state-running/20">
                ✓ JOB COMPLETE
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] min-w-0">
              <div>
                <div className="text-[9.5px] uppercase text-ink-400 font-bold tracking-wider">Stage</div>
                <div className="font-bold text-ink-900 capitalize">{meta.label || stage?.stage?.replace(/_/g, ' ') || '—'}</div>
              </div>
              <div>
                <div className="text-[9.5px] uppercase text-ink-400 font-bold tracking-wider">{weightLabel}</div>
                <div className="font-bold text-ink-900 tabular-nums">{weightDisplay} kg</div>
              </div>
              <div>
                <div className="text-[9.5px] uppercase text-ink-400 font-bold tracking-wider">Order Qty</div>
                <div className="font-bold text-ink-900 tabular-nums">{job.plannedQty} kg</div>
              </div>
            </div>

            {/* Primary action pill */}
            {isActive ? (
              <div className="flex items-center gap-1.5 text-brand-600 font-bold text-[13px]">
                <span className="inline-block h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
                IN PROGRESS <ChevronRight className="h-4 w-4" />
              </div>
            ) : isReady ? (
              <div className="flex items-center gap-1.5 text-state-running font-bold text-[13px]">
                TAP TO START <ChevronRight className="h-4 w-4" />
              </div>
            ) : isStageDone ? (
              <div className="flex items-center gap-1.5 text-state-running font-bold text-[13px]">
                ✓ COMPLETED <ChevronRight className="h-4 w-4" />
              </div>
            ) : isPending ? (
              <div className="flex items-center gap-1.5 text-state-idle font-bold text-[12px]">
                ⏳ WAITING
                {job.blockedBy && (
                  <span className="text-[10px] text-ink-500 capitalize ml-1">
                    — {job.blockedBy.stage?.replace(/_/g, ' ')} {job.blockedBy.status?.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * OPERATOR STAGE RUNNER — the "I'm working on this job right now" screen
 * ══════════════════════════════════════════════════════════════════════ */
function OperatorStageRunner({ job, onClose }) {
  const qc = useQueryClient();
  const [showFinish, setShowFinish] = useState(false);
  const [liveData, setLiveData] = useState({}); // machineId → {speed, temp, ...}
  const user = authStore((s) => s.user);

  const stage = job.myStage;
  const meta = STAGE_META[stage?.stage] || {};

  // Re-fetch the full job (stage could change from below — e.g. someone else
  // started it from another tab, or auto-progress on stage-complete fired).
  // We DON'T pass initialData here — we always want the freshest server state
  // so isActive accurately reflects whether the stage is already running.
  const freshJob = useQuery({
    queryKey: ['job', job._id],
    queryFn: async () => (await jobApi.get(job._id)).data,
    refetchInterval: 10_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // While the fresh fetch is loading, fall back to the prop. After fetch
  // arrives, freshJob.data wins.
  const currentJob = freshJob.data || job;
  const currentStage = currentJob.stages?.find((s) => String(s._id) === String(stage?._id)) || stage;

  // IMPORTANT: isActive must reflect the FRESH stage status (not the stale
  // myStage we received as a prop). Otherwise the runner shows the "Start"
  // screen for a stage that the backend already considers in_progress —
  // and tapping START PRODUCTION returns "Stage already in progress".
  const isActive = currentStage?.status === 'in_progress';

  // Live IoT when machine is assigned + stage is in_progress
  useSocket(
    '/ops',
    {
      'machine:events': (events) => {
        if (!currentStage?.machineId) return;
        const machineIdStr = String(currentStage.machineId?._id || currentStage.machineId);
        const relevant = events.filter((e) => String(e.machineId) === machineIdStr);
        if (!relevant.length) return;
        const latest = relevant[relevant.length - 1];
        setLiveData((prev) => ({
          ...prev,
          [machineIdStr]: {
            speed: latest.speed ?? prev[machineIdStr]?.speed,
            units: latest.unitsProduced ?? prev[machineIdStr]?.units,
            metrics: latest.metrics || prev[machineIdStr]?.metrics || {},
            at: latest.timestamp,
          },
        }));
      },
    },
    [currentStage?.machineId],
    (s) => {
      const machineIdStr = currentStage?.machineId?._id || currentStage?.machineId;
      if (machineIdStr) s.emit('subscribe:machine', String(machineIdStr));
    }
  );

  // START stage
  const startMut = useMutation({
    mutationFn: async ({ machineId, weightInKg }) =>
      (await jobApi.startStage(job._id, stage._id, {
        machineId,
        operatorId: user.id,
        weightInKg: Number(weightInKg) || stage.weightInKg || currentJob.inputRollWeightKg || 0,
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', job._id] });
      qc.invalidateQueries({ queryKey: ['my-jobs'] });
    },
    onError: () => {
      // Most likely the stage was started from another tab/operator.
      // Pull the latest job state so the UI reconciles automatically —
      // the user will see "in progress" view and can hit Finish directly.
      qc.invalidateQueries({ queryKey: ['job', job._id] });
      qc.invalidateQueries({ queryKey: ['my-jobs'] });
      freshJob.refetch();
    },
  });

  const machineIdStr = currentStage?.machineId?._id || currentStage?.machineId;
  const live = machineIdStr ? liveData[String(machineIdStr)] : null;

  return (
    <div className="space-y-5">
      <button
        onClick={onClose}
        className="text-[12px] text-ink-500 hover:text-ink-900 flex items-center gap-1"
      >
        ← Back to My Jobs
      </button>

      {/* Hero — job header with stage */}
      <div
        className="rounded-xl text-white p-5 shadow-card"
        style={{ background: `linear-gradient(135deg, ${meta.color}, #0050d9)` }}
      >
        <div className="text-[10.5px] uppercase tracking-wider opacity-90 mb-1">
          Stage · {meta.label}
        </div>
        <div className="flex items-start gap-3">
          <div className="text-[48px] leading-none">{meta.icon}</div>
          <div className="flex-1">
            <div className="font-mono text-[12px] opacity-90">{currentJob.orderNumber} · {currentJob.jobNumber}</div>
            <h1 className="text-[24px] font-bold leading-tight">{currentJob.product?.name}</h1>
            <div className="text-[12px] opacity-90">{currentJob.customer}</div>
          </div>
          {currentJob.priority === 'high' && (
            <div className="text-[10px] font-bold bg-white/20 px-2.5 py-1 rounded-full">
              HIGH PRIORITY
            </div>
          )}
        </div>
      </div>

      {currentStage?.status === 'completed' ? (
        currentStage.stage === 'inspection' ? (
          /* ─── INSPECTION COMPLETED VIEW — show QC report ─── */
          <InspectionCompletedView stage={currentStage} job={currentJob} />
        ) : (
          /* ─── REGULAR STAGE COMPLETED VIEW — show yield ─── */
          <div className="panel">
            <div className="text-center py-6">
              <div className="text-[60px] mb-2">✓</div>
              <div className="font-bold text-[20px] text-state-running">Stage Completed</div>
              <div className="text-[12.5px] text-ink-500 mt-1">
                You finished this stage{' '}
                {currentStage.completedAt
                  ? new Date(currentStage.completedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                  : ''}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <InfoTile icon={Scale} label="Weight In" value={`${currentStage.weightInKg || 0} kg`} color="#1a6bff" />
              <InfoTile icon={Scale} label="Weight Out" value={`${currentStage.weightOutKg || 0} kg`} color="#059669" />
              <InfoTile icon={Factory} label="Machine" value={currentStage.machineId?.code || '—'} color="#7c3aed" />
              <InfoTile
                icon={Activity}
                label="Yield"
                value={
                  currentStage.weightInKg
                    ? `${Math.round((currentStage.weightOutKg / currentStage.weightInKg) * 100)}%`
                    : '—'
                }
                color="#ea580c"
              />
            </div>
            {currentStage.operatorRemarks && (
              <div className="mt-4 rounded-md bg-ink-50 p-3 text-[12px]">
                <div className="text-[10px] uppercase font-bold text-ink-400 tracking-wider mb-1">Your remarks</div>
                <div className="text-ink-700">{currentStage.operatorRemarks}</div>
              </div>
            )}
            <div className="mt-4 text-center text-[11.5px] text-ink-500">
              {currentJob.status === 'completed'
                ? '🎉 The entire job is complete and ready for dispatch.'
                : 'The next stage operator will pick up from here.'}
            </div>
          </div>
        )
      ) : !isActive ? (
        /* ─── START FLOW ─── */
        currentStage?.stage === 'inspection' ? (
          // Inspection has no materials — go straight to start panel
          <StartPanel stage={currentStage} job={currentJob} onStart={startMut.mutate} pending={startMut.isPending} error={startMut.error} />
        ) : !currentStage?.materialsConfirmedAt ? (
          // Material gate: must request → wait for issue → confirm receipt
          // before the Start panel becomes visible. This enforces the
          // operator → inventory → operator handshake.
          <MaterialGateScreen
            job={currentJob}
            stage={currentStage}
            onConfirmed={() => freshJob.refetch()}
          />
        ) : (
          // Materials confirmed → show normal start panel
          <StartPanel stage={currentStage} job={currentJob} onStart={startMut.mutate} pending={startMut.isPending} error={startMut.error} />
        )
      ) : currentStage?.stage === 'inspection' ? (
        /* ─── INSPECTION RUNNING FLOW — checklist inline, no machine/live data ─── */
        <InspectionRunner
          job={currentJob}
          stage={currentStage}
          user={user}
          onDone={onClose}
        />
      ) : (
        /* ─── RUNNING FLOW (other stages) ─── */
        <>
          {/* Info grid — big numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InfoTile icon={Scale} label="Weight In" value={`${currentStage.weightInKg || 0} kg`} color="#1a6bff" />
            <InfoTile icon={Factory} label="Machine" value={currentStage.machineId?.code || '—'} color="#7c3aed" />
            <InfoTile icon={User} label="Operator" value={user?.name?.split(' ')[0] || '—'} color="#059669" />
            <InfoTile
              icon={Activity}
              label="Live Speed"
              value={live?.speed ? `${Math.round(live.speed)}` : 'waiting…'}
              color="#ea580c"
              pulse={!!live?.speed}
            />
          </div>

          {/* Material requisition panel */}
          <MaterialRequestPanel job={currentJob} stage={currentStage} />

          {/* Live IoT panel */}
          {live && Object.keys(live.metrics || {}).length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Activity className="h-4 w-4 text-state-running" />
                  Live Machine Data
                  <span className="pulse-dot" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(live.metrics || {}).slice(0, 8).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-ink-50 border border-ink-200 p-3 text-center">
                    <div className="text-[9.5px] uppercase text-ink-400 font-bold tracking-wider">{k}</div>
                    <div className="text-[16px] font-bold text-ink-900 tabular-nums mt-0.5">{String(v)}</div>
                  </div>
                ))}
                {live.units !== undefined && (
                  <div className="rounded-lg bg-brand-50 border border-brand-500/20 p-3 text-center">
                    <div className="text-[9.5px] uppercase text-brand-600 font-bold tracking-wider">Units made</div>
                    <div className="text-[16px] font-bold text-brand-600 tabular-nums mt-0.5">{live.units}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Big Finish button */}
          <button
            onClick={() => setShowFinish(true)}
            className="w-full rounded-xl bg-state-running text-white text-[18px] font-bold py-5 shadow-lg hover:brightness-95 active:scale-[0.99] transition flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="h-6 w-6" />
            FINISH STAGE & SEND TO NEXT
          </button>
        </>
      )}

      {showFinish && currentStage?.stage !== 'inspection' && (
        <FinishStageModal
          job={currentJob}
          stage={currentStage}
          onClose={() => setShowFinish(false)}
          onDone={() => {
            setShowFinish(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * INSPECTION RUNNER — full-page inline checklist (no modal, no live IoT)
 *
 * Inspection is a manual QC stage. Operator sees:
 *   - Top stat strip: Weight In, Operator, Approved Qty, Defect Count
 *   - Quality checklist with Pass/Fail toggles per parameter
 *   - Final verdict picker (Pass / Rework / Fail / Hold)
 *   - Remarks textarea
 *   - One submit button at the bottom
 *
 * No live machine data, no separate finish modal.
 * ══════════════════════════════════════════════════════════════════════ */
function InspectionRunner({ job, stage, user, onDone }) {
  const qc = useQueryClient();
  const [approvedQty, setApprovedQty] = useState('');
  const [defectCount, setDefectCount] = useState('0');
  const [checklist, setChecklist] = useState(DEFAULT_INSPECTION_CHECKLIST);
  const [qcDecision, setQcDecision] = useState('');
  const [remarks, setRemarks] = useState('');

  const submitMut = useMutation({
    mutationFn: async () => (await jobApi.completeStage(job._id, stage._id, {
      // For inspection: weightOut = weightIn (no material change), unless operator entered something
      weightOutKg: stage.weightInKg || 0,
      qcChecklist: checklist.filter((c) => c.result),
      qcDecision: qcDecision || undefined,
      qcSampleSize: approvedQty ? Number(approvedQty) : undefined,
      qcDefectCount: defectCount ? Number(defectCount) : 0,
      qcRemarks: remarks || undefined,
      operatorRemarks: remarks || undefined,
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', job._id] });
      qc.invalidateQueries({ queryKey: ['my-jobs'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      onDone();
    },
  });

  const updateItem = (i, patch) => {
    setChecklist(checklist.map((c, ci) => ci === i ? { ...c, ...patch } : c));
  };

  const passCount = checklist.filter((c) => c.result === 'pass').length;
  const failCount = checklist.filter((c) => c.result === 'fail').length;
  const naCount = checklist.filter((c) => c.result === 'na').length;
  const checkedCount = passCount + failCount + naCount;
  const allChecked = checkedCount === checklist.length;
  const isQcBlocked = ['fail', 'rework', 'hold'].includes(qcDecision);
  const canSubmit = qcDecision && allChecked && !submitMut.isPending;

  return (
    <>
      {/* Top stat strip — same look as production but with QC-relevant fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <InfoTile icon={Scale} label="Weight In" value={`${stage.weightInKg || 0} kg`} color="#1a6bff" />
        <InfoTile icon={User} label="Inspector" value={user?.name?.split(' ')[0] || '—'} color="#059669" />
        <div className="rounded-xl bg-white border-2 p-3.5" style={{ borderColor: '#7c3aed30' }}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" style={{ color: '#7c3aed' }} />
            <div className="text-[9.5px] uppercase font-bold tracking-wider text-ink-400">Approved Quantity (pcs)</div>
          </div>
          <input
            type="number" min="0"
            value={approvedQty}
            onChange={(e) => setApprovedQty(e.target.value)}
            placeholder="0"
            className="mt-1 w-full text-[18px] font-bold tabular-nums bg-transparent focus:outline-none text-ink-900"
          />
        </div>
        <div className="rounded-xl bg-white border-2 p-3.5" style={{ borderColor: '#ea580c30' }}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" style={{ color: '#ea580c' }} />
            <div className="text-[9.5px] uppercase font-bold tracking-wider text-ink-400">Defect Count</div>
          </div>
          <input
            type="number" min="0"
            value={defectCount}
            onChange={(e) => setDefectCount(e.target.value)}
            placeholder="0"
            className="mt-1 w-full text-[18px] font-bold tabular-nums bg-transparent focus:outline-none text-ink-900"
          />
        </div>
      </div>

      {/* Quality Checklist */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <CheckCircle2 className="h-4 w-4 text-brand-500" />
            Quality Checklist
          </div>
          <div className="text-[10.5px]">
            <span className="text-state-running font-bold">{passCount} pass</span>
            {' · '}
            <span className="text-state-down font-bold">{failCount} fail</span>
            {' · '}
            <span className="text-ink-400">{naCount} n/a</span>
            {' · '}
            <span className="text-ink-700 font-bold">{checkedCount}/{checklist.length}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          {checklist.map((item, i) => (
            <div key={i} className="rounded-lg border border-ink-100 bg-white">
              <div className="px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-ink-900 flex-1">
                  {item.parameter}
                </div>
                <div className="flex gap-1">
                  {[
                    { v: 'pass', label: '✓ Pass', cls: 'bg-state-running/10 text-state-running border-state-running/40' },
                    { v: 'fail', label: '✗ Fail', cls: 'bg-state-down/10 text-state-down border-state-down/40' },
                    { v: 'na',   label: 'N/A',   cls: 'bg-ink-100 text-ink-500 border-ink-200' },
                  ].map((b) => (
                    <button
                      key={b.v}
                      type="button"
                      onClick={() => updateItem(i, { result: b.v })}
                      className={clsx(
                        'px-2.5 py-1 rounded-md border text-[11px] font-bold transition',
                        item.result === b.v ? `${b.cls} ring-2 ring-offset-1 ring-current/30` : 'bg-white text-ink-500 border-ink-200 hover:border-ink-300'
                      )}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              {item.result === 'fail' && (
                <input
                  placeholder="Why failed? (e.g. color off-shade, smudge on edge)"
                  value={item.remarks}
                  onChange={(e) => updateItem(i, { remarks: e.target.value })}
                  className="w-full px-3 py-1.5 text-[11.5px] border-t border-state-down/20 bg-state-down/5 focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Final Verdict */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Final Verdict <span className="text-state-down">*</span></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { v: 'pass',   label: '✓ Pass',   desc: 'Send to next stage', cls: 'bg-state-running/10 text-state-running border-state-running/40' },
            { v: 'rework', label: '🔄 Rework', desc: 'Send back for fix',  cls: 'bg-state-idle/10 text-state-idle border-state-idle/40' },
            { v: 'fail',   label: '✗ Fail',   desc: 'Reject batch',       cls: 'bg-state-down/10 text-state-down border-state-down/40' },
            { v: 'hold',   label: '⏸ Hold',   desc: 'Need supervisor',    cls: 'bg-brand-500/10 text-brand-700 border-brand-500/40' },
          ].map((b) => (
            <button
              key={b.v}
              type="button"
              onClick={() => setQcDecision(b.v)}
              className={clsx(
                'rounded-lg border-2 p-3 text-left transition',
                qcDecision === b.v ? `${b.cls} ring-2 ring-offset-1 ring-current/30` : 'bg-white border-ink-200 hover:border-ink-300'
              )}
            >
              <div className="font-bold text-[13px]">{b.label}</div>
              <div className="text-[10.5px] opacity-80 mt-0.5">{b.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Remarks */}
      <div>
        <div className="label !text-[12px]">Remarks / Action Required</div>
        <textarea
          rows="2"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Describe any defects found and corrective action…"
          className="input text-[13px]"
        />
      </div>

      {/* QC blocked banner */}
      {isQcBlocked && (
        <div className="rounded-xl border-2 border-state-down/30 bg-state-down/5 p-4 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-state-down shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-[13px] text-state-down">
              QC verdict: {qcDecision.toUpperCase()} — job will go on hold
            </div>
            <div className="text-[11px] text-ink-600 mt-0.5">
              The next stage won't start. Supervisor will be notified to review and decide next action.
            </div>
          </div>
        </div>
      )}

      {submitMut.error && (
        <div className="rounded-lg bg-state-down/5 border border-state-down/20 p-3 text-[12px] text-state-down">
          {submitMut.error.message}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={() => submitMut.mutate()}
        disabled={!canSubmit}
        className={clsx(
          'w-full rounded-xl text-white text-[18px] font-bold py-5 shadow-lg transition flex items-center justify-center gap-2',
          canSubmit
            ? (isQcBlocked ? 'bg-state-down hover:brightness-95' : 'bg-state-running hover:brightness-95 active:scale-[0.99]')
            : 'bg-ink-300 cursor-not-allowed'
        )}
      >
        {submitMut.isPending ? <Loader2 className="h-6 w-6 animate-spin" /> : <CheckCircle2 className="h-6 w-6" />}
        {isQcBlocked
          ? `SUBMIT VERDICT — ${qcDecision.toUpperCase()}`
          : qcDecision === 'pass'
            ? 'APPROVE & SEND TO NEXT STAGE'
            : 'PICK A VERDICT TO CONTINUE'}
      </button>
      {!canSubmit && !submitMut.isPending && (
        <div className="text-[11px] text-ink-500 text-center">
          {!allChecked
            ? `${checklist.length - checkedCount} parameter${checklist.length - checkedCount === 1 ? '' : 's'} still need a decision`
            : !qcDecision
              ? 'Pick a final verdict to continue'
              : ''}
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * INSPECTION COMPLETED VIEW
 *
 * After the inspector submits, this is what they see when they re-open the
 * job. Shows the report they filed:
 *   - Verdict pill (Pass / Rework / Fail / Hold)
 *   - Approved Quantity + Defect Count
 *   - Per-parameter pass/fail with their failure remarks
 *   - Their action remarks
 *
 * Read-only — the form is locked once submitted.
 * ══════════════════════════════════════════════════════════════════════ */
function InspectionCompletedView({ stage, job }) {
  const qcResult = stage.qcResult || {};
  const checklist = qcResult.checklist || [];
  const decision = qcResult.decision || 'pending';

  const passCount = checklist.filter((c) => c.result === 'pass').length;
  const failCount = checklist.filter((c) => c.result === 'fail').length;
  const naCount = checklist.filter((c) => c.result === 'na').length;

  // Verdict styling
  const verdictMeta = {
    pass:    { label: '✓ PASS',   bg: 'bg-state-running/10',   text: 'text-state-running',   border: 'border-state-running/40', emoji: '✓' },
    rework:  { label: '🔄 REWORK', bg: 'bg-state-idle/10',     text: 'text-state-idle',      border: 'border-state-idle/40',    emoji: '🔄' },
    fail:    { label: '✗ FAIL',   bg: 'bg-state-down/10',     text: 'text-state-down',      border: 'border-state-down/40',    emoji: '✗' },
    hold:    { label: '⏸ HOLD',   bg: 'bg-brand-500/10',      text: 'text-brand-700',       border: 'border-brand-500/40',     emoji: '⏸' },
    pending: { label: '— PENDING', bg: 'bg-ink-100',           text: 'text-ink-500',         border: 'border-ink-200',          emoji: '—' },
  };
  const v = verdictMeta[decision] || verdictMeta.pending;

  return (
    <>
      {/* Verdict header */}
      <div className={clsx('rounded-2xl border-2 p-5', v.bg, v.border)}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10.5px] uppercase font-bold tracking-wider text-ink-500">Inspection Verdict</div>
            <div className={clsx('text-[28px] font-bold mt-0.5', v.text)}>{v.label}</div>
            <div className="text-[11.5px] text-ink-500 mt-1">
              Submitted{' '}
              {stage.completedAt
                ? new Date(stage.completedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : '—'}
            </div>
          </div>
          <div className={clsx('text-[80px] leading-none opacity-30', v.text)}>{v.emoji}</div>
        </div>
      </div>

      {/* Quick stats — what they recorded */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <InfoTile icon={Scale} label="Roll Weight" value={`${stage.weightInKg || 0} kg`} color="#1a6bff" />
        <InfoTile icon={CheckCircle2} label="Approved Qty" value={`${qcResult.sampleSize ?? '—'} pcs`} color="#059669" />
        <InfoTile icon={AlertCircle} label="Defects Found" value={`${qcResult.defectCount ?? 0} pcs`} color="#ea580c" />
        <InfoTile
          icon={Activity}
          label="Pass Rate"
          value={(() => {
            const total = passCount + failCount;
            return total > 0 ? `${Math.round((passCount / total) * 100)}%` : '—';
          })()}
          color="#7c3aed"
        />
      </div>

      {/* Checklist — read-only with what they marked */}
      {checklist.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <CheckCircle2 className="h-4 w-4 text-brand-500" />
              Quality Checklist Report
            </div>
            <div className="text-[10.5px]">
              <span className="text-state-running font-bold">{passCount} pass</span>
              {' · '}
              <span className="text-state-down font-bold">{failCount} fail</span>
              {' · '}
              <span className="text-ink-400">{naCount} n/a</span>
            </div>
          </div>
          <div className="space-y-1.5">
            {checklist.map((item, i) => {
              const meta = item.result === 'pass'
                ? { cls: 'bg-state-running/10 text-state-running border-state-running/40', label: '✓ Pass' }
                : item.result === 'fail'
                  ? { cls: 'bg-state-down/10 text-state-down border-state-down/40', label: '✗ Fail' }
                  : { cls: 'bg-ink-100 text-ink-500 border-ink-200', label: 'N/A' };
              return (
                <div key={i} className="rounded-lg border border-ink-100 bg-white">
                  <div className="px-3 py-2.5 flex items-center justify-between gap-3">
                    <div className="text-[13px] font-semibold text-ink-900 flex-1">
                      {item.parameter}
                    </div>
                    <div className={clsx('px-2.5 py-1 rounded-md border text-[11px] font-bold', meta.cls)}>
                      {meta.label}
                    </div>
                  </div>
                  {item.result === 'fail' && item.remarks && (
                    <div className="px-3 py-1.5 text-[11.5px] border-t border-state-down/20 bg-state-down/5 text-state-down">
                      <strong>Reason:</strong> {item.remarks}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inspector remarks */}
      {(qcResult.remarks || stage.operatorRemarks) && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Remarks / Action Required</div>
          </div>
          <div className="text-[12.5px] text-ink-700 whitespace-pre-line">
            {qcResult.remarks || stage.operatorRemarks}
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="text-center text-[11.5px] text-ink-500 py-2">
        {decision === 'pass'
          ? '✓ Batch approved — sent to next stage.'
          : decision === 'rework'
            ? '🔄 Job is on hold for rework. Supervisor has been notified.'
            : decision === 'fail'
              ? '✗ Batch rejected. Supervisor has been notified.'
              : decision === 'hold'
                ? '⏸ Job on hold pending supervisor decision.'
                : 'Awaiting supervisor review.'}
      </div>
    </>
  );
}

/* ─── Start panel (pick machine, enter weight, tap Start) ─── */
function StartPanel({ stage, job, onStart, pending, error }) {
  const user = authStore((s) => s.user);
  const isInspection = stage.stage === 'inspection';
  const [selectedMachineId, setSelectedMachineId] = useState(
    stage.machineId?._id || stage.machineId || ''
  );

  // Default weight: prev stage's weightOut, then stage's pre-set weightIn, then job inputRoll
  const idx = (job.stages || []).findIndex((s) => String(s._id) === String(stage._id));
  const prevStage = idx > 0 ? job.stages[idx - 1] : null;
  const defaultWeight = prevStage?.weightOutKg
    || stage.weightInKg
    || job.inputRollWeightKg
    || '';

  const [weightIn, setWeightIn] = useState(defaultWeight ? String(defaultWeight) : '');

  // Only show machines for this stage that are idle
  const machines = useQuery({
    queryKey: ['machines', 'live', user?.plantId],
    queryFn: async () => (await machineApi.live(user?.plantId)).data,
    // Inspection doesn't need machines, skip the query
    enabled: !isInspection,
  });

  const candidates = (machines.data || []).filter(
    (m) => m.stage === stage.stage && ['idle', 'offline'].includes(m.currentStatus?.state)
  );

  // Inspection: only requires weight + start. Other stages: require machine too.
  const canStart = isInspection
    ? Number(weightIn) > 0 && !pending
    : selectedMachineId && Number(weightIn) > 0 && !pending;

  const handleStart = () => {
    if (!canStart) return;
    onStart({
      ...(isInspection ? {} : { machineId: selectedMachineId }),
      weightInKg: Number(weightIn),
    });
  };

  return (
    <div className="panel">
      <h2 className="text-[17px] font-bold text-ink-900 mb-3">
        {isInspection ? 'Ready to inspect?' : 'Ready to start?'}
      </h2>

      {/* Inspection note */}
      {isInspection && (
        <div className="mb-4 rounded-lg bg-state-idle/5 border border-state-idle/20 p-3 text-[12px] text-ink-700">
          <div className="font-bold mb-1">📋 Manual Inspection</div>
          This is a quality check stage. After starting, you'll see a checklist of parameters
          to verify on each sample. Pass/Fail per parameter, then submit a final verdict.
        </div>
      )}

      {/* Step 1: Weight input — BIG, REQUIRED */}
      <div className="mb-4 rounded-xl bg-brand-50 border-2 border-brand-500/30 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Scale className="h-5 w-5 text-brand-600" />
          <div className="text-[13px] font-bold text-brand-700">
            {isInspection ? 'Step 1 — Confirm Roll Weight (received)' : 'Step 1 — Enter Input Roll Weight'}
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <input
            type="number" step="0.1" min="0"
            placeholder={prevStage ? String(prevStage.weightOutKg || 0) : '0.0'}
            className="flex-1 text-[28px] font-bold tabular-nums px-4 py-3 rounded-lg border-2 border-brand-500/30 bg-white text-ink-900 focus:outline-none focus:border-brand-500"
            value={weightIn}
            onChange={(e) => setWeightIn(e.target.value)}
          />
          <span className="text-[18px] font-bold text-brand-600">kg</span>
        </div>
        {prevStage && prevStage.weightOutKg && (
          <div className="text-[11px] text-brand-600/80 mt-2">
            <CheckCircle2 className="h-3 w-3 inline" /> Previous stage finished with <strong>{prevStage.weightOutKg} kg</strong>. You can confirm or correct above.
          </div>
        )}
      </div>

      {/* Step 2: Pick machine — skipped for inspection */}
      {!isInspection && (
        <>
          <div className="label">Step 2 — Pick your machine</div>
          {candidates.length === 0 ? (
            <div className="rounded-lg bg-state-idle/5 border border-state-idle/20 p-3 text-[12.5px] text-state-idle flex items-center gap-2 mb-3">
              <AlertCircle className="h-4 w-4" />
              No free machine in this stage. Ask supervisor to release one.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
              {candidates.map((m) => (
                <button
                  key={m._id}
                  onClick={() => setSelectedMachineId(m._id)}
                  className={clsx(
                    'rounded-lg border-2 p-3 text-left transition',
                    selectedMachineId === m._id
                      ? 'border-brand-500 bg-brand-50 shadow-card'
                      : 'border-ink-200 hover:border-brand-500/50'
                  )}
                >
                  <div className="font-mono text-[11px] font-bold text-ink-400">{m.code}</div>
                  <div className="font-bold text-[13px] text-ink-900">{m.name}</div>
                  <div className="text-[10px] text-state-running font-bold uppercase tracking-wider mt-1">
                    ✓ Free
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <div className="rounded-lg bg-state-down/5 border border-state-down/20 p-3 text-[12px] text-state-down mb-3">
          {error.message?.includes('already in progress')
            ? 'This stage was already started (perhaps from another tab or device). Refreshing now — tap Finish when ready.'
            : error.message?.includes('Cannot start')
              ? error.message
              : (error.message || 'Could not start. Try again.')}
        </div>
      )}

      <button
        onClick={handleStart}
        disabled={!canStart}
        className={clsx(
          'w-full rounded-xl text-white text-[18px] font-bold py-5 transition flex items-center justify-center gap-2',
          canStart
            ? 'bg-state-running hover:brightness-95 active:scale-[0.99] shadow-lg'
            : 'bg-ink-300 cursor-not-allowed'
        )}
      >
        {pending ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6 fill-current" />}
        {isInspection ? 'START INSPECTION' : 'START PRODUCTION'}
      </button>
      {!canStart && !pending && (
        <div className="text-[11px] text-ink-500 mt-2 text-center">
          {!Number(weightIn) ? 'Enter weight to continue' : (!isInspection && !selectedMachineId) ? 'Select a machine to continue' : ''}
        </div>
      )}
    </div>
  );
}

/* ─── Tile ─── */
function InfoTile({ icon: Icon, label, value, color, pulse }) {
  return (
    <div className="rounded-xl bg-white border-2 p-3.5 relative" style={{ borderColor: `${color}30` }}>
      {pulse && <span className="absolute top-2 right-2 h-2 w-2 rounded-full animate-pulse" style={{ background: color }} />}
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color }} />
        <div className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color }}>
          {label}
        </div>
      </div>
      <div className="text-[20px] font-bold text-ink-900 tabular-nums mt-1 leading-tight">{value}</div>
    </div>
  );
}

/* Default inspection parameters for printed pouch QC.
 * Operators can mark each as pass/fail/na and add per-parameter remarks. */
const DEFAULT_INSPECTION_CHECKLIST = [
  { parameter: 'Print Registration', result: '', remarks: '' },
  { parameter: 'Color Match (vs approved sample)', result: '', remarks: '' },
  { parameter: 'Text & Barcode Legibility', result: '', remarks: '' },
  { parameter: 'Logo Position & Alignment', result: '', remarks: '' },
  { parameter: 'Surface Finish (no smudges/scratches)', result: '', remarks: '' },
  { parameter: 'Edge Quality (clean cuts)', result: '', remarks: '' },
  { parameter: 'Roll Tension & Winding', result: '', remarks: '' },
  { parameter: 'Static / Dust', result: '', remarks: '' },
];

/* ─── Finish stage modal — add materials, record weight out, hand off ─── */
function FinishStageModal({ job, stage, onClose, onDone }) {
  const qc = useQueryClient();
  const isInspection = stage.stage === 'inspection';
  const [weightOut, setWeightOut] = useState('');
  const [rejectWeight, setRejectWeight] = useState('');
  const [materials, setMaterials] = useState([]);
  const [remarks, setRemarks] = useState('');

  // Inspection-specific state
  const [checklist, setChecklist] = useState(DEFAULT_INSPECTION_CHECKLIST);
  const [qcDecision, setQcDecision] = useState('');   // pass | fail | rework | hold
  const [qcSampleSize, setQcSampleSize] = useState('5');
  const [qcDefectCount, setQcDefectCount] = useState('0');

  // Next stage hand-off
  const idx = (job.stages || []).findIndex((s) => String(s._id) === String(stage._id));
  const nextStage = idx >= 0 ? job.stages[idx + 1] : null;
  const isLastStage = !nextStage;

  // 'supervisor' = notify admin (no auto assign), 'operator' = pre-assign chosen operator
  const [handoffMode, setHandoffMode] = useState('supervisor');
  const [nextOperatorId, setNextOperatorId] = useState('');

  // Load operators for assignment
  const operators = useQuery({
    queryKey: ['operators-for-handoff'],
    queryFn: async () => {
      const { adminApi } = await import('../api/endpoints.js');
      return (await adminApi.listUsers()).data;
    },
    enabled: !isLastStage,
  });

  const completeMut = useMutation({
    mutationFn: async () => (await jobApi.completeStage(job._id, stage._id, {
      weightOutKg: Number(weightOut),
      rejectWeightKg: rejectWeight ? Number(rejectWeight) : 0,
      materialsAdded: isInspection ? [] : materials.filter((m) => m.name && m.qty).map((m) => ({
        name: m.name,
        qty: Number(m.qty),
        uom: m.uom || 'kg',
        type: m.type || 'consumable',
      })),
      operatorRemarks: remarks || undefined,
      // Only send QC fields for inspection stage (or if user filled them)
      ...(isInspection || qcDecision ? {
        qcChecklist: checklist.filter((c) => c.result),
        qcDecision: qcDecision || undefined,
        qcSampleSize: qcSampleSize ? Number(qcSampleSize) : undefined,
        qcDefectCount: qcDefectCount ? Number(qcDefectCount) : undefined,
        qcRemarks: remarks || undefined,
      } : {}),
      // Only send assignNextOperatorId if user chose 'operator' mode
      // Block hand-off if QC failed
      assignNextOperatorId: (
        ['fail', 'rework', 'hold'].includes(qcDecision)
          ? undefined
          : (handoffMode === 'operator' && nextOperatorId) ? nextOperatorId : undefined
      ),
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', job._id] });
      qc.invalidateQueries({ queryKey: ['my-jobs'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      onDone();
    },
  });

  const updateChecklistItem = (i, patch) => {
    setChecklist(checklist.map((c, ci) => ci === i ? { ...c, ...patch } : c));
  };
  const passCount = checklist.filter((c) => c.result === 'pass').length;
  const failCount = checklist.filter((c) => c.result === 'fail').length;
  const naCount = checklist.filter((c) => c.result === 'na').length;
  const checkedCount = passCount + failCount + naCount;
  const allChecked = checkedCount === checklist.length;

  const addMaterialRow = () => {
    setMaterials([...materials, { name: '', qty: '', uom: 'kg', type: 'consumable' }]);
  };
  const updateMaterial = (idx, patch) => {
    setMaterials(materials.map((m, i) => i === idx ? { ...m, ...patch } : m));
  };
  const removeMaterial = (idx) => {
    setMaterials(materials.filter((_, i) => i !== idx));
  };

  const totalAdded = materials.reduce((sum, m) => sum + (Number(m.qty) || 0), 0);
  const expectedOut = (stage.weightInKg || 0) + totalAdded - (Number(rejectWeight) || 0);

  // For inspection: must have decision + all checklist items rated
  // For other stages: must have weight out
  const isQcBlocked = ['fail', 'rework', 'hold'].includes(qcDecision);
  const canSubmit = (
    weightOut &&
    !completeMut.isPending &&
    (isInspection ? (qcDecision && allChecked) : true) &&
    (isLastStage || isQcBlocked || handoffMode === 'supervisor' || (handoffMode === 'operator' && nextOperatorId))
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="max-w-2xl mx-auto bg-white rounded-2xl shadow-2xl my-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">
              {isInspection ? 'Finish Inspection' : 'Finish Stage'}
            </div>
            <h2 className="text-[17px] font-bold text-ink-900">
              {isInspection ? 'Quality Check & Final Verdict' : 'Record Weight Out & Materials'}
            </h2>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Weight in reference */}
          <div className="rounded-lg bg-ink-50 border border-ink-100 p-3 flex items-center justify-between">
            <div className="text-[11px] text-ink-500 uppercase font-bold tracking-wider">Weight In (from last stage)</div>
            <div className="text-[16px] font-bold text-brand-600 tabular-nums">{stage.weightInKg || 0} kg</div>
          </div>

          {/* ════════════════ INSPECTION MODE ════════════════ */}
          {isInspection ? (
            <>
              {/* Sample Size + Defect Count */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="label !text-[12px]">Sample Size (pcs checked)</div>
                  <input
                    type="number" min="1"
                    value={qcSampleSize}
                    onChange={(e) => setQcSampleSize(e.target.value)}
                    className="input py-2 text-[14px] tabular-nums"
                  />
                </div>
                <div>
                  <div className="label !text-[12px]">Defects Found</div>
                  <input
                    type="number" min="0"
                    value={qcDefectCount}
                    onChange={(e) => setQcDefectCount(e.target.value)}
                    className="input py-2 text-[14px] tabular-nums"
                  />
                </div>
              </div>

              {/* QC Checklist */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="label !text-[12px]">Inspection Checklist</div>
                  <div className="text-[10.5px] text-ink-500">
                    <span className="text-state-running font-bold">{passCount} pass</span>
                    {' · '}
                    <span className="text-state-down font-bold">{failCount} fail</span>
                    {' · '}
                    <span className="text-ink-400">{naCount} n/a</span>
                    {' · '}
                    <span className="text-ink-700">{checkedCount}/{checklist.length} checked</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {checklist.map((item, i) => (
                    <div key={i} className="rounded-lg border border-ink-100 bg-white">
                      <div className="px-3 py-2 flex items-center justify-between gap-3">
                        <div className="text-[12.5px] font-semibold text-ink-900 flex-1">
                          {item.parameter}
                        </div>
                        <div className="flex gap-1">
                          {[
                            { v: 'pass', label: '✓ Pass', cls: 'bg-state-running/10 text-state-running border-state-running/30' },
                            { v: 'fail', label: '✗ Fail', cls: 'bg-state-down/10 text-state-down border-state-down/30' },
                            { v: 'na',   label: 'N/A',   cls: 'bg-ink-100 text-ink-500 border-ink-200' },
                          ].map((b) => (
                            <button
                              key={b.v}
                              type="button"
                              onClick={() => updateChecklistItem(i, { result: b.v })}
                              className={clsx(
                                'px-2.5 py-1 rounded-md border text-[11px] font-bold transition',
                                item.result === b.v ? `${b.cls} ring-2 ring-offset-1 ring-current/40` : 'bg-white text-ink-500 border-ink-200 hover:border-ink-300'
                              )}
                            >
                              {b.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {item.result === 'fail' && (
                        <input
                          placeholder="Why failed? (e.g. color off-shade, smudge on edge)"
                          value={item.remarks}
                          onChange={(e) => updateChecklistItem(i, { remarks: e.target.value })}
                          className="w-full px-3 py-1.5 text-[11.5px] border-t border-state-down/20 bg-state-down/5 focus:outline-none"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Final Verdict */}
              <div>
                <div className="label !text-[12px]">Final Verdict <span className="text-state-down">*</span></div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { v: 'pass',   label: '✓ Pass', desc: 'Send to next stage', cls: 'bg-state-running/10 text-state-running border-state-running/30' },
                    { v: 'rework', label: '🔄 Rework', desc: 'Send back for fix', cls: 'bg-state-idle/10 text-state-idle border-state-idle/30' },
                    { v: 'fail',   label: '✗ Fail', desc: 'Reject batch', cls: 'bg-state-down/10 text-state-down border-state-down/30' },
                    { v: 'hold',   label: '⏸ Hold', desc: 'Need supervisor', cls: 'bg-brand-500/10 text-brand-700 border-brand-500/30' },
                  ].map((b) => (
                    <button
                      key={b.v}
                      type="button"
                      onClick={() => setQcDecision(b.v)}
                      className={clsx(
                        'rounded-lg border-2 p-2.5 text-left transition',
                        qcDecision === b.v ? `${b.cls} ring-2 ring-offset-1 ring-current/40` : 'bg-white border-ink-200 hover:border-ink-300'
                      )}
                    >
                      <div className="font-bold text-[12.5px]">{b.label}</div>
                      <div className="text-[10px] opacity-80 mt-0.5">{b.desc}</div>
                    </button>
                  ))}
                </div>
                {!qcDecision && (
                  <div className="text-[10.5px] text-state-down mt-1.5">Pick a verdict before finishing.</div>
                )}
              </div>
            </>
          ) : (
            /* ════════════════ NORMAL STAGE MODE ════════════════ */
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="label !text-[12px]">Materials added at this stage</div>
                <button
                  onClick={addMaterialRow}
                  className="btn-secondary btn-sm"
                >
                  <Plus className="h-3.5 w-3.5" /> Add material
                </button>
              </div>
              {materials.length === 0 && (
                <div className="text-[11px] text-ink-400 py-2">
                  No materials added? Skip — just tap Finish below.
                </div>
              )}
              {materials.map((m, idx) => (
                <div key={idx} className="grid grid-cols-[2fr_1fr_90px_32px] gap-2 mb-2 items-center">
                  <input
                    placeholder="Material name (e.g. Red Ink, LDPE Paper)"
                    value={m.name}
                    onChange={(e) => updateMaterial(idx, { name: e.target.value })}
                    className="input py-2 text-[13px]"
                  />
                  <input
                    type="number"
                    step="0.1"
                    placeholder="Qty"
                    value={m.qty}
                    onChange={(e) => updateMaterial(idx, { qty: e.target.value })}
                    className="input py-2 text-[13px] tabular-nums"
                  />
                  <select
                    value={m.uom}
                    onChange={(e) => updateMaterial(idx, { uom: e.target.value })}
                    className="input py-2 text-[13px]"
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="m">m</option>
                    <option value="pcs">pcs</option>
                  </select>
                  <button
                    onClick={() => removeMaterial(idx)}
                    className="h-9 w-9 rounded-md text-state-down hover:bg-state-down/5 grid place-items-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Weight out — big input */}
          <div>
            <div className="label !text-[12px]">Weight out (what comes off the machine)</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={weightOut}
                onChange={(e) => setWeightOut(e.target.value)}
                placeholder={`e.g. ${expectedOut.toFixed(1)}`}
                className="input !py-3 !text-[20px] !font-bold !text-brand-600 tabular-nums"
              />
              <span className="text-[16px] font-bold text-ink-500">kg</span>
            </div>
            {totalAdded > 0 && (
              <div className="text-[11px] text-ink-500 mt-1">
                Expected: {stage.weightInKg || 0} + {totalAdded} (added) - {Number(rejectWeight) || 0} (reject) = <strong>{expectedOut.toFixed(1)} kg</strong>
              </div>
            )}
          </div>

          {/* Reject weight */}
          <div>
            <div className="label !text-[12px]">Reject weight (optional)</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={rejectWeight}
                onChange={(e) => setRejectWeight(e.target.value)}
                placeholder="0"
                className="input py-2 text-[14px] tabular-nums w-32"
              />
              <span className="text-[12px] text-ink-500">kg</span>
            </div>
          </div>

          {/* Remarks */}
          <div>
            <div className="label !text-[12px]">Remarks (optional)</div>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows="2"
              placeholder="Anything supervisor should know?"
              className="input text-[13px]"
            />
          </div>

          {/* Hand-off section — only if not last stage AND not QC-blocked */}
          {!isLastStage && !isQcBlocked && (
            <div className="rounded-xl border-2 border-brand-500/20 bg-brand-50/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ArrowRight className="h-4 w-4 text-brand-600" />
                <div className="text-[13px] font-bold text-brand-700">
                  Hand off to next stage — <span className="capitalize">{nextStage.stage.replace(/_/g, ' ')}</span>
                </div>
              </div>
              <div className="text-[11px] text-brand-700/80 mb-3">
                Choose how to assign the next operator:
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setHandoffMode('supervisor')}
                  className={clsx(
                    'rounded-lg border-2 p-3 text-left transition',
                    handoffMode === 'supervisor'
                      ? 'border-brand-500 bg-white shadow-card'
                      : 'border-ink-200 bg-white hover:border-brand-500/50'
                  )}
                >
                  <div className="font-bold text-[12.5px] text-ink-900">📨 Notify Supervisor</div>
                  <div className="text-[10.5px] text-ink-500 mt-0.5">
                    Supervisor will assign next operator. Recommended if you're unsure who's available.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setHandoffMode('operator')}
                  className={clsx(
                    'rounded-lg border-2 p-3 text-left transition',
                    handoffMode === 'operator'
                      ? 'border-brand-500 bg-white shadow-card'
                      : 'border-ink-200 bg-white hover:border-brand-500/50'
                  )}
                >
                  <div className="font-bold text-[12.5px] text-ink-900">👤 Assign Directly</div>
                  <div className="text-[10.5px] text-ink-500 mt-0.5">
                    Pick the next operator yourself. Job lands in their My Jobs immediately.
                  </div>
                </button>
              </div>
              {handoffMode === 'operator' && (
                <div className="mt-3">
                  <div className="label !text-[11px]">Choose operator for {nextStage.stage.replace(/_/g, ' ')}</div>
                  <select
                    className="input"
                    value={nextOperatorId}
                    onChange={(e) => setNextOperatorId(e.target.value)}
                  >
                    <option value="">— Select operator —</option>
                    {(operators.data || []).map((o) => (
                      <option key={o._id} value={o._id}>{o.name} ({o.employeeCode || o.email})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {isLastStage && (
            <div className="rounded-xl border-2 border-state-running/30 bg-state-running/5 p-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-state-running shrink-0" />
              <div>
                <div className="font-bold text-[13px] text-state-running">This is the final stage</div>
                <div className="text-[11px] text-ink-600 mt-0.5">Once you finish, the job will be marked as completed.</div>
              </div>
            </div>
          )}

          {isQcBlocked && !isLastStage && (
            <div className="rounded-xl border-2 border-state-down/30 bg-state-down/5 p-4 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-state-down shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-[13px] text-state-down">
                  QC verdict: {qcDecision.toUpperCase()} — job will go on hold
                </div>
                <div className="text-[11px] text-ink-600 mt-0.5">
                  The next stage won't start. Supervisor will be notified to review and decide next action (rework, reprint, or scrap).
                </div>
              </div>
            </div>
          )}

          {completeMut.error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/20 p-3 text-[12px] text-state-down">
              {completeMut.error.message}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center py-3 text-[14px]">
            Cancel
          </button>
          <button
            onClick={() => completeMut.mutate()}
            disabled={!canSubmit}
            className={clsx(
              'flex-[2] rounded-lg text-white text-[16px] font-bold py-3 transition flex items-center justify-center gap-2',
              canSubmit
                ? (isQcBlocked ? 'bg-state-down hover:brightness-95' : 'bg-state-running hover:brightness-95 active:scale-[0.99]')
                : 'bg-ink-300 cursor-not-allowed'
            )}
          >
            {completeMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
            {isQcBlocked
              ? `SUBMIT VERDICT (${qcDecision.toUpperCase()})`
              : isLastStage
                ? 'FINISH JOB'
                : isInspection
                  ? 'PASS & SEND TO NEXT'
                  : handoffMode === 'operator' && nextOperatorId
                    ? 'FINISH & SEND TO OPERATOR'
                    : 'FINISH & NOTIFY SUPERVISOR'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * MATERIAL REQUEST PANEL
 *
 * Shown on the operator's stage runner. Lets them:
 *   - See materials needed for this stage (auto-pulled from BOM)
 *   - See pending requests they've already sent (status pills)
 *   - Submit a new request to the inventory team with one click
 *
 * The inventory team sees this in their Raw Materials dashboard.
 * ══════════════════════════════════════════════════════════════════════ */
function MaterialRequestPanel({ job, stage }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  // Existing requests for this job + stage
  const requests = useQuery({
    queryKey: ['material-requests', job._id],
    queryFn: async () => (await materialRequestApi.list({ jobOrderId: job._id })).data,
    refetchInterval: 15_000,
  });

  const stageRequests = (requests.data || []).filter(
    (r) => String(r.stageId) === String(stage._id)
  );
  const pendingCount = stageRequests.filter((r) => ['pending', 'partial'].includes(r.status)).length;
  const issuedCount = stageRequests.filter((r) => r.status === 'issued').length;

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <ShoppingCart className="h-4 w-4 text-brand-500" />
          Material Requests
          {pendingCount > 0 && (
            <span className="ml-2 bg-state-idle/10 text-state-idle text-[9.5px] font-bold px-2 py-0.5 rounded-full border border-state-idle/30">
              {pendingCount} PENDING
            </span>
          )}
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary btn-sm">
          <Plus className="h-3.5 w-3.5" /> Request Materials
        </button>
      </div>

      {stageRequests.length === 0 ? (
        <div className="text-center py-3 text-[12px] text-ink-500">
          No materials requested yet for this stage. Tap "Request Materials" to ask the store.
        </div>
      ) : (
        <div className="space-y-2">
          {stageRequests.map((r) => (
            <MaterialRequestCard key={r._id} request={r} />
          ))}
          {issuedCount > 0 && (
            <div className="text-[10.5px] text-state-running font-semibold text-center pt-1">
              ✓ {issuedCount} request{issuedCount !== 1 ? 's' : ''} fully issued
            </div>
          )}
        </div>
      )}

      {showForm && (
        <MaterialRequestFormModal
          job={job}
          stage={stage}
          onClose={() => setShowForm(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['material-requests', job._id] });
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}

function MaterialRequestCard({ request }) {
  const statusMeta = {
    pending:   { cls: 'bg-state-idle/10 text-state-idle border-state-idle/30',     label: '⏳ PENDING' },
    partial:   { cls: 'bg-state-idle/10 text-state-idle border-state-idle/30',     label: '◐ PARTIAL' },
    issued:    { cls: 'bg-state-running/10 text-state-running border-state-running/30', label: '✓ ISSUED' },
    rejected:  { cls: 'bg-state-down/10 text-state-down border-state-down/30',     label: '✗ REJECTED' },
    cancelled: { cls: 'bg-ink-100 text-ink-500 border-ink-200',                    label: 'CANCELLED' },
  }[request.status] || { cls: '', label: request.status };

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-ink-500">
          MR-{String(request._id).slice(-6).toUpperCase()} · {new Date(request.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
        </div>
        <span className={clsx('text-[9.5px] font-bold px-2 py-0.5 rounded-md border', statusMeta.cls)}>
          {statusMeta.label}
        </span>
      </div>
      <div className="space-y-1">
        {request.lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between text-[12px]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] text-ink-400">{l.sku}</span>
              <span className="text-ink-700">{l.name}</span>
            </div>
            <div className="tabular-nums text-ink-700">
              {l.qtyIssued > 0 && <span className="text-state-running font-semibold">{l.qtyIssued}</span>}
              {l.qtyIssued > 0 && l.qtyIssued < l.qtyRequested && <span className="text-ink-400"> / </span>}
              <span className={l.qtyIssued >= l.qtyRequested ? 'text-state-running font-semibold' : ''}>
                {l.qtyRequested}
              </span> {l.uom}
            </div>
          </div>
        ))}
      </div>
      {request.rejectionReason && (
        <div className="mt-2 text-[11px] text-state-down">
          <strong>Rejected:</strong> {request.rejectionReason}
        </div>
      )}
    </div>
  );
}

function MaterialRequestFormModal({ job, stage, onClose, onDone }) {
  const [priority, setPriority] = useState('normal');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);

  // Auto-pull suggested materials from BOM for this stage
  const suggestions = useQuery({
    queryKey: ['material-suggestions', job._id, stage._id],
    queryFn: async () => (await materialRequestApi.suggest({ jobOrderId: job._id, stageId: stage._id })).data,
  });

  // Initialize lines from suggestions when they load (only first time)
  const [initialised, setInitialised] = useState(false);
  useEffect(() => {
    if (initialised) return;
    if (suggestions.data && suggestions.data.length > 0) {
      setLines(suggestions.data.map((s) => ({
        sku: s.sku,
        name: s.name,
        qtyRequested: s.qtySuggested,
        uom: s.uom,
        itemId: s.itemId,
        currentAvailable: s.currentAvailable,
        fromBom: true,
        selected: true,
      })));
      setInitialised(true);
    }
  }, [suggestions.data, initialised]);

  const submitMut = useMutation({
    mutationFn: async () => {
      const selectedLines = lines
        .filter((l) => l.selected && l.qtyRequested > 0)
        .map((l) => ({
          sku: l.sku,
          name: l.name,
          qtyRequested: Number(l.qtyRequested),
          uom: l.uom,
          itemId: l.itemId,
          fromBom: !!l.fromBom,
        }));
      if (selectedLines.length === 0) {
        throw new Error('Select at least one material to request');
      }
      return (await materialRequestApi.create({
        jobOrderId: job._id,
        stageId: stage._id,
        priority,
        operatorNote: note || undefined,
        lines: selectedLines,
      })).data;
    },
    onSuccess: onDone,
  });

  const updateLine = (i, patch) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const removeLine = (i) => setLines(lines.filter((_, idx) => idx !== i));
  const addCustomLine = () => setLines([...lines, {
    sku: '',
    name: '',
    qtyRequested: 0,
    uom: 'kg',
    selected: true,
    fromBom: false,
  }]);

  const selectedCount = lines.filter((l) => l.selected && l.qtyRequested > 0).length;
  const canSubmit = selectedCount > 0 && lines.every(
    (l) => !l.selected || (l.sku.trim() && l.name.trim() && Number(l.qtyRequested) > 0)
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Request Materials</div>
            <h2 className="text-[17px] font-bold text-ink-900">
              {job.orderNumber} · {stage.stage?.replace(/_/g, ' ')}
            </h2>
            <div className="text-[11.5px] text-ink-500 mt-0.5">{job.product?.name}</div>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Priority */}
          <div>
            <div className="label !text-[12px]">Priority</div>
            <div className="flex gap-2">
              {[
                { v: 'normal', label: 'Normal',  cls: 'bg-state-running/10 text-state-running border-state-running/30' },
                { v: 'urgent', label: '🔥 Urgent', cls: 'bg-state-down/10 text-state-down border-state-down/30' },
              ].map((b) => (
                <button
                  key={b.v}
                  type="button"
                  onClick={() => setPriority(b.v)}
                  className={clsx(
                    'px-3 py-1.5 rounded-md border text-[12px] font-bold transition',
                    priority === b.v ? `${b.cls} ring-2 ring-offset-1 ring-current/30` : 'bg-white border-ink-200 hover:border-ink-300'
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Materials list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="label !text-[12px]">Materials Needed</div>
                {suggestions.data?.length > 0 && (
                  <div className="text-[10.5px] text-state-running font-semibold mt-0.5">
                    ✓ {suggestions.data.length} item{suggestions.data.length !== 1 ? 's' : ''} pulled from BOM for this stage
                  </div>
                )}
              </div>
              <button onClick={addCustomLine} className="btn-secondary btn-sm">
                <Plus className="h-3.5 w-3.5" /> Add custom item
              </button>
            </div>

            {suggestions.isLoading ? (
              <div className="text-center text-[11.5px] text-ink-400 py-4">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                Loading materials needed for this stage…
              </div>
            ) : lines.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-state-idle/30 bg-state-idle/5 p-5 text-center">
                <AlertCircle className="h-6 w-6 mx-auto text-state-idle mb-2" />
                <div className="font-bold text-[13px] text-ink-900">No BOM linked to this product</div>
                <div className="text-[11.5px] text-ink-600 mt-1 mb-3">
                  We couldn't find a Bill of Materials for <strong>{job.product?.sku || 'this product'}</strong>.
                  Either ask your manager to push a BOM via ERP, or add the materials manually below.
                </div>
                <button type="button" onClick={addCustomLine} className="btn-primary btn-sm">
                  <Plus className="h-3.5 w-3.5" /> Add Material Manually
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {lines.map((l, i) => (
                  <div key={i} className={clsx(
                    'rounded-lg border bg-white p-2.5',
                    l.selected ? 'border-brand-500/30' : 'border-ink-100'
                  )}>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={l.selected}
                        onChange={(e) => updateLine(i, { selected: e.target.checked })}
                        className="h-4 w-4 cursor-pointer"
                      />
                      {l.fromBom ? (
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10.5px] text-ink-400">{l.sku}</span>
                            <span className="text-[12.5px] font-semibold text-ink-900">{l.name}</span>
                            <span className="text-[9.5px] bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded font-bold">BOM</span>
                          </div>
                          <div className="text-[10.5px] text-ink-500 mt-0.5">
                            {l.currentAvailable !== undefined && (
                              <>Available: <strong>{l.currentAvailable} {l.uom}</strong></>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5 flex-1">
                          <input
                            placeholder="SKU"
                            value={l.sku}
                            onChange={(e) => updateLine(i, { sku: e.target.value.toUpperCase() })}
                            className="input py-1.5 text-[12px] font-mono"
                          />
                          <input
                            placeholder="Material name"
                            value={l.name}
                            onChange={(e) => updateLine(i, { name: e.target.value })}
                            className="input py-1.5 text-[12px]"
                          />
                        </div>
                      )}
                      <input
                        type="number" step="0.1" min="0"
                        value={l.qtyRequested}
                        onChange={(e) => updateLine(i, { qtyRequested: e.target.value })}
                        className="input py-1.5 text-[12.5px] tabular-nums w-24 text-right"
                        disabled={!l.selected}
                      />
                      <select
                        value={l.uom}
                        onChange={(e) => updateLine(i, { uom: e.target.value })}
                        className="input py-1.5 text-[12px] w-20"
                        disabled={!l.selected}
                      >
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                        <option value="m">m</option>
                        <option value="L">L</option>
                        <option value="pcs">pcs</option>
                      </select>
                      <button
                        onClick={() => removeLine(i)}
                        className="h-7 w-7 rounded-md text-state-down hover:bg-state-down/5 grid place-items-center"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {l.selected && l.currentAvailable !== undefined && Number(l.qtyRequested) > l.currentAvailable && (
                      <div className="mt-1 text-[10.5px] text-state-down">
                        ⚠ Requesting more than available stock ({l.currentAvailable} {l.uom})
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <div className="label !text-[12px]">Note for store (optional)</div>
            <textarea
              rows="2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Need by 2pm shift, batch number XXX preferred…"
              className="input text-[13px]"
            />
          </div>

          {submitMut.error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/20 p-3 text-[12px] text-state-down">
              {submitMut.error.message}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center py-3 text-[14px]">
            Cancel
          </button>
          <button
            onClick={() => submitMut.mutate()}
            disabled={!canSubmit || submitMut.isPending}
            className={clsx(
              'flex-[2] rounded-lg text-white text-[15px] font-bold py-3 transition flex items-center justify-center gap-2',
              canSubmit && !submitMut.isPending
                ? 'bg-brand-500 hover:brightness-95 active:scale-[0.99]'
                : 'bg-ink-300 cursor-not-allowed'
            )}
          >
            {submitMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            SEND REQUEST {selectedCount > 0 && `(${selectedCount} item${selectedCount !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * MATERIAL GATE SCREEN
 *
 * Shown when an operator opens a stage that requires raw materials.
 * Forces this sequence:
 *   1. Request materials (BOM-prefilled)
 *   2. Wait for inventory to issue
 *   3. Confirm receipt
 *   4. Then the Start panel unlocks
 *
 * Until step 3 is done, no machine selection or roll-weight input is shown.
 * This prevents the operator from starting production without first
 * obtaining the materials officially through inventory.
 * ══════════════════════════════════════════════════════════════════════ */
function MaterialGateScreen({ job, stage, onConfirmed }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  // All requests for this job + stage
  const requests = useQuery({
    queryKey: ['material-requests', job._id],
    queryFn: async () => (await materialRequestApi.list({ jobOrderId: job._id })).data,
    refetchInterval: 8_000,
  });
  const stageRequests = (requests.data || []).filter(
    (r) => String(r.stageId) === String(stage._id)
  );

  // Auto-open the request form on first visit if no requests have been made yet
  const hasAnyRequest = stageRequests.length > 0;

  // Step status: which of the 3 steps is currently active?
  const issuedRequests = stageRequests.filter((r) => ['issued', 'partial'].includes(r.status));
  const pendingRequests = stageRequests.filter((r) => ['pending', 'partial'].includes(r.status));
  const hasIssuedMaterials = issuedRequests.length > 0;

  let currentStep = 1;
  if (hasAnyRequest) currentStep = 2;
  if (hasIssuedMaterials && pendingRequests.length === 0) currentStep = 3;

  const confirmMut = useMutation({
    mutationFn: async () => (await jobApi.confirmMaterials(job._id, stage._id)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', job._id] });
      qc.invalidateQueries({ queryKey: ['my-jobs'] });
      onConfirmed?.();
    },
  });

  return (
    <>
      {/* Step indicator strip — 3 steps with progress */}
      <div className="panel">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-bold text-ink-900">Pre-Production Checklist</h2>
          <div className="text-[10.5px] text-ink-500">
            Step <strong>{currentStep}</strong> of 3
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <StepDot n={1} label="Request" active={currentStep === 1} done={currentStep > 1} />
          <div className={clsx('h-1 flex-1 rounded', currentStep > 1 ? 'bg-state-running' : 'bg-ink-100')} />
          <StepDot n={2} label="Issue" active={currentStep === 2} done={currentStep > 2} />
          <div className={clsx('h-1 flex-1 rounded', currentStep > 2 ? 'bg-state-running' : 'bg-ink-100')} />
          <StepDot n={3} label="Confirm" active={currentStep === 3} done={false} />
        </div>

        {/* Step 1 — Request */}
        {currentStep === 1 && (
          <div className="rounded-lg bg-brand-50 border border-brand-500/20 p-4 text-center">
            <ShoppingCart className="h-7 w-7 mx-auto text-brand-600 mb-2" />
            <div className="font-bold text-[14px] text-ink-900">Request raw materials first</div>
            <div className="text-[11.5px] text-ink-600 mt-1 mb-3">
              You can't start production until you've requested the materials needed for this stage.
              The inventory team will issue them to you.
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-brand-500 hover:brightness-95 text-white text-[14px] font-bold px-4 py-2.5 rounded-lg"
            >
              <Plus className="h-4 w-4" /> Request Materials
            </button>
          </div>
        )}

        {/* Step 2 — Waiting for inventory */}
        {currentStep === 2 && (
          <div className="rounded-lg bg-state-idle/5 border border-state-idle/20 p-4 text-center">
            <Clock className="h-7 w-7 mx-auto text-state-idle mb-2 animate-pulse" />
            <div className="font-bold text-[14px] text-ink-900">Waiting for store to issue materials</div>
            <div className="text-[11.5px] text-ink-600 mt-1">
              Your request has been sent. Once inventory issues the materials, you'll see them below
              and can confirm receipt.
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-brand-600 font-semibold hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add another request
            </button>
          </div>
        )}

        {/* Step 3 — Confirm receipt */}
        {currentStep === 3 && (
          <div className="rounded-lg bg-state-running/5 border border-state-running/30 p-4 text-center">
            <CheckCircle2 className="h-7 w-7 mx-auto text-state-running mb-2" />
            <div className="font-bold text-[14px] text-ink-900">Materials issued by store</div>
            <div className="text-[11.5px] text-ink-600 mt-1 mb-3">
              Verify all items below are physically on the machine, then confirm receipt to unlock production.
            </div>
            <button
              onClick={() => confirmMut.mutate()}
              disabled={confirmMut.isPending}
              className={clsx(
                'inline-flex items-center gap-2 text-white text-[14px] font-bold px-4 py-2.5 rounded-lg',
                confirmMut.isPending ? 'bg-ink-300 cursor-not-allowed' : 'bg-state-running hover:brightness-95'
              )}
            >
              {confirmMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              CONFIRM MATERIALS RECEIVED & UNLOCK PRODUCTION
            </button>
            {confirmMut.error && (
              <div className="text-[11px] text-state-down mt-2">{confirmMut.error.message}</div>
            )}
          </div>
        )}
      </div>

      {/* Materials issued so far */}
      {(stage.materialsAdded || []).length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Truck className="h-4 w-4 text-state-running" />
              Materials Issued for This Stage
            </div>
            <span className="text-[10.5px] text-ink-500">
              {(stage.materialsAdded || []).length} item{(stage.materialsAdded || []).length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1">
            {(stage.materialsAdded || []).map((m, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border border-ink-100 bg-white px-3 py-2">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-mono text-[10.5px] text-ink-400">{m.sku}</span>
                  <span className="text-ink-900 font-semibold">{m.name}</span>
                </div>
                <div className="text-[13px] font-bold tabular-nums text-state-running">
                  {m.qty} {m.uom || 'kg'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request history */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <ShoppingCart className="h-4 w-4 text-brand-500" />
            Material Request History
          </div>
          <button onClick={() => setShowForm(true)} className="btn-secondary btn-sm">
            <Plus className="h-3.5 w-3.5" /> New Request
          </button>
        </div>
        {stageRequests.length === 0 ? (
          <div className="text-center py-3 text-[12px] text-ink-500">
            No requests yet. Tap "New Request" to start.
          </div>
        ) : (
          <div className="space-y-2">
            {stageRequests.map((r) => (
              <MaterialRequestCard key={r._id} request={r} />
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <MaterialRequestFormModal
          job={job}
          stage={stage}
          onClose={() => setShowForm(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['material-requests', job._id] });
            setShowForm(false);
          }}
        />
      )}
    </>
  );
}

function StepDot({ n, label, active, done }) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className={clsx(
        'h-8 w-8 rounded-full grid place-items-center font-bold text-[12px] border-2 transition',
        done ? 'bg-state-running text-white border-state-running' :
        active ? 'bg-brand-500 text-white border-brand-500 ring-4 ring-brand-500/20' :
        'bg-white text-ink-400 border-ink-200'
      )}>
        {done ? '✓' : n}
      </div>
      <div className={clsx(
        'text-[10px] font-bold uppercase tracking-wider',
        done ? 'text-state-running' :
        active ? 'text-brand-600' :
        'text-ink-400'
      )}>
        {label}
      </div>
    </div>
  );
}
