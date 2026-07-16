import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search, Printer, Magnet, Flame, Scissors, Package2,
  ChevronDown, ChevronUp, CheckCircle2, Play, Clock, AlertTriangle, User, QrCode, ArrowRight,
} from 'lucide-react';
import clsx from 'clsx';
import { jobApi } from '../api/endpoints.js';
import { useSocket } from '../hooks/useSocket.js';
import { authStore } from '../context/authStore.js';

/* ─── Stage definitions (icons, labels in the trail) ─── */
const STAGE_META = {
  printing:   { label: 'Printing',   icon: '🖨️', short: 'PRINTI' },
  inspection: { label: 'Inspection', icon: '🔍', short: 'INSPEC' },
  lamination: { label: 'Lamination', icon: '🧲', short: 'LAMINA' },
  hot_room:   { label: 'Hot Room',   icon: '🔥', short: 'HOTRO' },
  slitting:   { label: 'Slitting',   icon: '✂️', short: 'SLITTI' },
  cutting:    { label: 'Cutting',    icon: '🗂️', short: 'CUTTIN' },
  packaging:  { label: 'Packaging',  icon: '📦', short: 'PACKAG' },
};

/**
 * Given the full stages[] array, compute the delta added/lost at each step.
 */
function buildTrail(stages) {
  const trail = [];
  let prevWeight = stages?.[0]?.weightInKg || 0;
  for (const s of stages || []) {
    const wIn = s.weightInKg || 0;
    const wOut = s.weightOutKg || 0;
    let delta = 0;
    if (s.status === 'completed') {
      delta = wOut - wIn;
    }
    trail.push({
      stage: s.stage,
      status: s.status,
      weightIn: wIn,
      weightOut: wOut || wIn,  // fallback for not-yet-done
      delta,
      addedKg: (s.materialsAdded || []).reduce((sum, m) => sum + (m.qty || 0), 0),
    });
    prevWeight = wOut || wIn;
  }
  return trail;
}

export function OrderTrackingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const user = authStore((s) => s.user);
  const nav = useNavigate();

  const selectedOrder = searchParams.get('orderNumber') || '';
  const [searchInput, setSearchInput] = useState(selectedOrder);
  const [expandedStage, setExpandedStage] = useState(null);

  // Recent orders sidebar chips
  const recent = useQuery({
    queryKey: ['jobs', 'recent', user?.plantId],
    queryFn: async () => (await jobApi.list({ plantId: user?.plantId, limit: 5, sort: '-createdAt' })).data,
    refetchInterval: 60_000,
  });

  // The tracked order
  const job = useQuery({
    queryKey: ['jobs', 'track', selectedOrder],
    queryFn: async () => {
      const r = await jobApi.list({ q: selectedOrder, limit: 1 });
      return r.data?.[0] || null;
    },
    enabled: !!selectedOrder,
    refetchInterval: 20_000,
  });

  useSocket(
    '/orders',
    {
      'order:update': (o) => {
        if (o.orderNumber === selectedOrder) {
          qc.invalidateQueries({ queryKey: ['jobs', 'track', selectedOrder] });
        }
      },
    },
    [selectedOrder]
  );

  const onSearch = () => {
    if (searchInput.trim()) {
      setSearchParams({ orderNumber: searchInput.trim().toUpperCase() });
    }
  };

  const jobData = job.data;
  const trail = useMemo(() => buildTrail(jobData?.stages || []), [jobData]);

  // Rollup stats
  const rollup = useMemo(() => {
    if (!jobData) return null;
    const stages = jobData.stages || [];
    const done = stages.filter((s) => s.status === 'completed').length;
    const totalMats = stages.reduce(
      (sum, s) => sum + (s.materialsAdded || []).reduce((ss, m) => ss + (m.qty || 0), 0),
      0
    );
    const totalRejects = stages.reduce((sum, s) => sum + (s.rejectWeightKg || 0), 0);
    const current = stages.find((s) => s.status === 'in_progress');
    const currentWeight = current
      ? current.weightInKg
      : jobData.currentWeightKg || trail[trail.length - 1]?.weightOut || 0;
    const lastCompleted = [...stages].reverse().find((s) => s.status === 'completed');
    const inputWeight = jobData.inputRollWeightKg || stages[0]?.weightInKg || 0;

    return {
      stagesDone: done,
      stagesTotal: stages.length,
      percent: Math.round((done / stages.length) * 100),
      totalMats,
      totalRejects,
      currentWeight,
      inputWeight,
      finalWeight: jobData.status === 'completed' ? (lastCompleted?.weightOutKg || 0) : (jobData.plannedQty || 0),
    };
  }, [jobData, trail]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="panel !p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[11px] font-bold text-ink-500 uppercase tracking-wider pr-1">Order No.</div>
          <div className="relative flex-1 min-w-[280px]">
            <input
              className="input py-1.5 text-[12.5px]"
              placeholder="Enter PB-001 or JOB-7845…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            />
          </div>
          <button className="btn-primary btn-sm" onClick={onSearch}>
            <Search className="h-3.5 w-3.5" /> Track
          </button>
          {(recent.data || []).slice(0, 5).map((r) => (
            <button
              key={r._id}
              onClick={() => { setSearchInput(r.orderNumber); setSearchParams({ orderNumber: r.orderNumber }); }}
              className={clsx(
                'font-mono text-[11px] font-bold rounded-md px-2.5 py-1 border transition',
                selectedOrder === r.orderNumber
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-brand-600 border-ink-200 hover:bg-brand-50'
              )}
            >
              {r.orderNumber}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {!selectedOrder && (
        <div className="panel text-center py-16">
          <div className="text-[30px] mb-2">🎯</div>
          <div className="font-bold text-[16px] text-ink-900">Enter an Order or Job number above</div>
          <div className="text-[12px] text-ink-500 mt-1">
            Full stage-wise trail with weight, materials, operator and QC at every step
          </div>
        </div>
      )}

      {/* Loading */}
      {selectedOrder && job.isLoading && (
        <div className="panel text-center py-10 text-[12.5px] text-ink-400">Loading order…</div>
      )}

      {/* Not found */}
      {selectedOrder && !job.isLoading && !jobData && (
        <div className="panel text-center py-10">
          <AlertTriangle className="h-6 w-6 text-state-idle mx-auto mb-2" />
          <div className="font-bold text-ink-900">Order "{selectedOrder}" not found</div>
          <div className="text-[12px] text-ink-500 mt-1">
            Check the spelling — it might be PB-001 or JOB-7845 format.
          </div>
        </div>
      )}

      {/* Order trail */}
      {jobData && (
        <>
          {/* Hero header */}
          <div
            className="rounded-xl text-white p-5 shadow-card"
            style={{ background: 'linear-gradient(135deg, #1a6bff 0%, #0050d9 60%, #003689 100%)' }}
          >
            <div className="text-[10.5px] uppercase tracking-[0.12em] opacity-80 mb-1">
              Order Trail · {jobData.jobNumber}
            </div>
            <h1 className="text-[24px] font-bold leading-tight">
              {jobData.orderNumber} — {jobData.product?.name}
            </h1>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-4">
              <HeroField label="Customer" value={jobData.customer} />
              <HeroField
                label="Input Roll"
                value={(() => {
                  // Prefer the order-level inputRollWeightKg (set during planning).
                  // Falls back to whatever the operator entered for Stage 1's
                  // weight-in, since that's effectively the input roll.
                  const planned = jobData.inputRollWeightKg;
                  const stage1Weight = jobData.stages?.[0]?.weightInKg;
                  const weight = planned || stage1Weight || 0;
                  if (jobData.inputRollDescription) return jobData.inputRollDescription;
                  return weight > 0 ? `1 Roll · ${weight} KG` : '— Not yet recorded';
                })()}
              />
              <HeroField label="PO Qty" value={`${jobData.plannedQty} ${jobData.uom?.toUpperCase() || 'KG'}`} />
              <HeroField
                label="Due Date"
                value={jobData.dueDate ? new Date(jobData.dueDate).toDateString() : '—'}
              />
            </div>
          </div>

          {/* Rollup stats */}
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <RollupCard accent="blue" label="Stages Done" value={`${rollup.stagesDone}/${rollup.stagesTotal}`} meta={`${rollup.percent}% complete`} />
            <RollupCard accent="blue" label="Input Weight" value={`${rollup.inputWeight} kg`} meta="Initial roll" />
            <RollupCard accent="blue" label="Current Weight" value={`${rollup.currentWeight} kg`} meta="After last stage" />
            <RollupCard accent="red"  label="Reject Weight" value={`${rollup.totalRejects.toFixed(2)} kg`} meta="Cumulative" />
            <RollupCard accent="green" label="Final Weight" value={`${rollup.finalWeight} kg`} meta={jobData.status === 'completed' ? 'Dispatch ready' : 'Expected dispatch'} />
          </section>

          {/* Process flow bar */}
          <div className="panel !p-4">
            <div className="flex items-center justify-between overflow-x-auto pb-1">
              {trail.map((t, idx) => {
                const meta = STAGE_META[t.stage];
                const isDone = t.status === 'completed';
                const isActive = t.status === 'in_progress';
                const isPending = !isDone && !isActive;
                return (
                  <div key={t.stage} className="flex items-center shrink-0">
                    <div className="flex flex-col items-center gap-1 min-w-[72px]">
                      <div className={clsx(
                        'w-[42px] h-[42px] rounded-full grid place-items-center text-[17px] border-2 transition',
                        isDone && 'bg-state-running/10 border-state-running',
                        isActive && 'bg-brand-500/10 border-brand-500 ring-4 ring-brand-500/15',
                        isPending && 'bg-ink-100 border-ink-200 opacity-60'
                      )}>
                        {meta?.icon}
                      </div>
                      <div className={clsx(
                        'text-[9px] font-bold uppercase tracking-wider text-center',
                        isDone && 'text-state-running',
                        isActive && 'text-brand-600',
                        isPending && 'text-ink-400'
                      )}>
                        {meta?.short}
                      </div>
                      <div className={clsx(
                        'text-[10.5px] font-bold tabular-nums',
                        isDone ? 'text-state-running' : isActive ? 'text-brand-600' : 'text-ink-500'
                      )}>
                        {t.weightIn}kg
                      </div>
                    </div>
                    {idx < trail.length - 1 && (
                      <div className="w-10 flex flex-col items-center">
                        <div className="h-0.5 w-full bg-ink-200 relative">
                          <span className="absolute -right-1 -top-1.5 text-[8px] text-ink-400">▶</span>
                        </div>
                        <div className={clsx(
                          'text-[9px] font-bold mt-1 tabular-nums',
                          t.delta > 0 ? 'text-state-running' : t.delta < 0 ? 'text-state-down' : 'text-ink-300'
                        )}>
                          {t.delta > 0 && '+'}{t.delta !== 0 ? `${t.delta.toFixed(1)}kg` : '·'}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stage cards (expandable) */}
          <div className="space-y-2.5">
            {(jobData.stages || []).map((stage) => (
              <StageCard
                key={stage._id}
                stage={stage}
                expanded={expandedStage === String(stage._id)}
                onToggle={() => setExpandedStage(
                  expandedStage === String(stage._id) ? null : String(stage._id)
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HeroField({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">{label}</div>
      <div className="text-[14px] font-bold mt-0.5">{value || '—'}</div>
    </div>
  );
}

function RollupCard({ accent, label, value, meta }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="sc-label">{label}</div>
      <div className="sc-val" style={{ color: accent === 'red' ? '#dc2626' : accent === 'green' ? '#059669' : '#1a6bff' }}>
        {value}
      </div>
      <div className="sc-meta">{meta}</div>
    </div>
  );
}

function StageCard({ stage, expanded, onToggle }) {
  const meta = STAGE_META[stage.stage];
  const isDone = stage.status === 'completed';
  const isActive = stage.status === 'in_progress';
  const isPending = !isDone && !isActive;
  const isHold = stage.status === 'qc_hold' || stage.status === 'rework';

  // Card left-border color
  const borderClass = isDone
    ? 'border-l-state-running/30'
    : isActive
    ? 'border-l-brand-500'
    : isHold
    ? 'border-l-state-idle'
    : 'border-l-ink-200';

  return (
    <div className={clsx(
      'card overflow-hidden border-l-[3px] transition',
      borderClass,
      isPending && 'opacity-70'
    )}>
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        className={clsx(
          'w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-ink-50/40 transition',
          isActive && 'bg-brand-50/30'
        )}
      >
        <div className={clsx(
          'w-7 h-7 rounded-full grid place-items-center shrink-0 border',
          isDone && 'bg-state-running/10 text-state-running border-state-running/20',
          isActive && 'bg-brand-500/10 text-brand-600 border-brand-500/20',
          isHold && 'bg-state-idle/10 text-state-idle border-state-idle/20',
          isPending && 'bg-ink-100 text-ink-400 border-ink-200'
        )}>
          {isDone && <CheckCircle2 className="h-4 w-4" />}
          {isActive && <Play className="h-3.5 w-3.5 fill-current" />}
          {isHold && <AlertTriangle className="h-4 w-4" />}
          {isPending && <Clock className="h-4 w-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px]">{meta?.icon}</span>
            <span className="font-bold text-[13px] text-ink-900">
              Stage {stage.sequence}: {meta?.label}
            </span>
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-2 flex-wrap">
            {stage.startedAt && (
              <span className="tabular-nums">
                {new Date(stage.startedAt).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                {' → '}
                {stage.completedAt
                  ? new Date(stage.completedAt).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })
                  : '—'}
                {stage.durationSec && ` · ${Math.round(stage.durationSec / 60)} min`}
              </span>
            )}
            {stage.operatorId?.name && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" /> {stage.operatorId.name}
              </span>
            )}
            {stage.machineId?.code && (
              <span className="font-mono text-brand-600">⚙ {stage.machineId.code}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isDone && <span className="chip-green text-[10px]">✓ DONE</span>}
          {isActive && <span className="chip-blue text-[10px]">▶ ACTIVE</span>}
          {isHold && <span className="chip-yellow text-[10px]">⚠ HOLD</span>}
          {isPending && <span className="chip-gray text-[10px]">PENDING</span>}
          {stage.qcResult?.decision === 'pass' && <span className="chip-green text-[10px]">✓ QC Pass</span>}
          {stage.qcResult?.decision === 'fail' && <span className="chip-red text-[10px]">✗ QC Fail</span>}
          {(stage.weightInKg > 0 || stage.weightOutKg > 0) && (
            <div className="bg-ink-50 border border-ink-200 rounded-md px-2 py-1 text-right shrink-0">
              <div className="font-bold text-[13px] text-ink-900 tabular-nums">
                {isDone || isActive ? `${stage.weightOutKg || stage.weightInKg} kg` : `${stage.weightInKg} kg`}
              </div>
              <div className="text-[8.5px] text-ink-400 uppercase">{isDone ? 'OUT' : 'IN'}</div>
            </div>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-ink-400" /> : <ChevronDown className="h-4 w-4 text-ink-400" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-ink-100 bg-ink-50/30">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            {/* ─── Stage output ─── */}
            <div>
              <div className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wider mb-2">
                📦 Stage Output
              </div>
              <div className="space-y-1 text-[12px]">
                <Row label="Weight In" value={`${stage.weightInKg || 0} kg`} highlight />
                <Row label="Weight Out" value={`${stage.weightOutKg || 0} kg`} highlight />
                <Row label="Reject Count" value={stage.rejectCountPcs ? `${stage.rejectCountPcs} pcs` : '—'} danger={!!stage.rejectCountPcs} />
                <Row label="Reject Weight" value={stage.rejectWeightKg ? `${stage.rejectWeightKg} kg` : '—'} danger={!!stage.rejectWeightKg} />
                {stage.liveMetrics?.avgSpeed && (
                  <Row label="Machine Speed" value={`${Math.round(stage.liveMetrics.avgSpeed)}%`} />
                )}
                {stage.qcResult?.decision && (
                  <Row
                    label="QC Result"
                    value={stage.qcResult.decision}
                    highlight={stage.qcResult.decision === 'pass'}
                    danger={stage.qcResult.decision === 'fail'}
                  />
                )}
                {stage.operatorId?.name && <Row label="Operator" value={stage.operatorId.name} />}
                {stage.machineId?.code && <Row label="Machine" value={stage.machineId.code} />}
              </div>
            </div>

            {/* ─── Weight tracking visual ─── */}
            <div>
              <div className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wider mb-2">
                ⚖️ Weight Tracking
              </div>
              <WeightTrackingBar weightIn={stage.weightInKg || 0} weightOut={stage.weightOutKg || 0} />

              {stage.weightNote && (
                <>
                  <div className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wider mt-3 mb-1">
                    📝 Weight Note
                  </div>
                  <div className="rounded-md bg-white border border-ink-200 px-2.5 py-2 text-[11.5px] text-ink-700">
                    {stage.weightNote}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Materials added */}
          {(stage.materialsAdded || []).length > 0 && (
            <>
              <div className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wider mt-4 mb-2">
                🧪 Materials Added
              </div>
              <div className="flex flex-wrap gap-2">
                {stage.materialsAdded.map((mat, i) => (
                  <div
                    key={i}
                    className="inline-flex items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-1.5"
                  >
                    <span className="font-semibold text-[12px] text-ink-900">{mat.name}</span>
                    <span className="font-bold text-[12px] text-brand-600 tabular-nums">
                      {mat.qty} {mat.uom || 'kg'}
                    </span>
                    {mat.type && (
                      <span className={clsx(
                        'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                        mat.type === 'raw' ? 'bg-brand-50 text-brand-600' :
                        mat.type === 'consumable' ? 'bg-state-idle/10 text-state-idle' :
                        'bg-state-maintenance/10 text-state-maintenance'
                      )}>
                        {mat.type}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Operator remarks */}
          {stage.operatorRemarks && (
            <>
              <div className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wider mt-4 mb-1">
                💬 Operator Remarks
              </div>
              <div className="rounded-md bg-state-idle/5 border border-state-idle/20 px-3 py-2 text-[12px] text-ink-700 italic">
                "{stage.operatorRemarks}"
              </div>
            </>
          )}

          {/* Actions (if active) */}
          {isDone && (
            <div className="flex justify-center mt-4 pt-3 border-t border-ink-100">
              <button className="btn-ghost btn-sm text-brand-500">
                <QrCode className="h-3.5 w-3.5" /> Generate QR for this stage
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight, danger }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-ink-500">{label}</span>
      <span className={clsx(
        'font-semibold tabular-nums',
        highlight && 'text-brand-600',
        danger && 'text-state-down',
        !highlight && !danger && 'text-ink-900'
      )}>
        {value}
      </span>
    </div>
  );
}

function WeightTrackingBar({ weightIn, weightOut }) {
  const delta = weightOut - weightIn;
  const increase = delta > 0;
  const decrease = delta < 0;
  const stable = delta === 0;
  const label = stable ? '= Stable' : increase ? `+${delta.toFixed(1)} kg` : `${delta.toFixed(1)} kg`;
  const color = stable ? 'text-ink-500' : increase ? 'text-state-running' : 'text-state-down';

  return (
    <div className="rounded-md bg-white border border-ink-200 px-3.5 py-3">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="text-[9px] font-bold text-ink-400 uppercase tracking-wider">In</div>
          <div className="text-[18px] font-bold text-brand-600 tabular-nums">{weightIn} kg</div>
        </div>
        <div className="flex-1 flex flex-col items-center">
          <div className={clsx('text-[11px] font-bold', color)}>{label}</div>
          <div className="relative h-1 w-full bg-ink-100 rounded-full mt-1 mb-0.5">
            <div
              className="absolute top-0 h-full rounded-full bg-brand-500"
              style={{ left: 0, width: '100%' }}
            />
            <ArrowRight className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-brand-500" />
          </div>
        </div>
        <div className="flex-1 text-right">
          <div className="text-[9px] font-bold text-ink-400 uppercase tracking-wider">Out</div>
          <div className="text-[18px] font-bold text-brand-600 tabular-nums">{weightOut || weightIn} kg</div>
        </div>
      </div>
    </div>
  );
}
