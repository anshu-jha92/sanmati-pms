import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, CheckCircle2, XCircle, Loader2, Eye, FileText, Search, X, Printer } from 'lucide-react';
import clsx from 'clsx';
import { jobApi, qcApi, productionApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';

/**
 * QC Inspection page — matches the screenshot:
 *   - Action bar: + New QC Entry, QC Report, pending/failed count chips
 *   - Two-column: QC Queue table (left) + QC Summary today (right)
 *   - Click an item → opens the QC Inspection Form modal with 6-item checklist
 */

const STAGE_LABEL = {
  printing: 'Printing',
  inspection: 'Inspection',
  lamination: 'Lamination',
  hot_room: 'Hot Room',
  slitting: 'Slitting',
  cutting: 'Cutting',
  packaging: 'Packaging',
};

const QC_CHECKLIST = [
  { key: 'print_clarity', label: 'Print clarity & colour accuracy' },
  { key: 'lamination_adhesion', label: 'Lamination adhesion & uniformity' },
  { key: 'seal_strength', label: 'Seal strength test' },
  { key: 'bag_dimensions', label: 'Bag dimensions & size accuracy' },
  { key: 'surface_defects', label: 'Surface defects / contamination' },
  { key: 'weight_variance', label: 'Weight variance (max ±2%)' },
];

export function QCInspectionPage() {
  const user = authStore((s) => s.user);
  const qc = useQueryClient();
  const [entry, setEntry] = useState(null);   // null=closed | {} | { stage, orderNumber }
  const [showReport, setShowReport] = useState(false);

  // Pull jobs with any stage awaiting QC
  const jobs = useQuery({
    queryKey: ['jobs', 'qc', user?.plantId],
    queryFn: async () => (await jobApi.list({
      plantId: user?.plantId,
      limit: 200,
      sort: '-updatedAt',
    })).data,
    refetchInterval: 20_000,
  });

  // Flatten to QC queue rows
  const rows = useMemo(() => {
    const out = [];
    for (const job of jobs.data || []) {
      for (const stage of job.stages || []) {
        // Any stage that's completed but QC pending, or on hold / failed
        const qcDecision = stage.qcResult?.decision;
        const isRelevant =
          (stage.status === 'completed' && (!qcDecision || qcDecision === 'pending')) ||
          qcDecision === 'fail' ||
          qcDecision === 'hold' ||
          stage.status === 'qc_hold';
        if (!isRelevant) continue;
        out.push({
          key: `${job._id}_${stage._id}`,
          jobId: job._id,
          stageId: stage._id,
          orderNumber: job.orderNumber,
          jobNumber: job.jobNumber,
          productName: job.product?.name,
          stage: stage.stage,
          batch: `Batch-${String.fromCharCode(65 + ((job.orderNumber?.charCodeAt?.(3) || 0) % 3))}`,
          weight: stage.weightOutKg || stage.weightInKg,
          qcDecision: qcDecision || 'pending',
          stageStatus: stage.status,
        });
      }
    }
    return out.sort((a, b) => {
      // Put pending first, then fail, then pass
      const order = { pending: 0, hold: 1, fail: 2, pass: 3 };
      return (order[a.qcDecision] || 5) - (order[b.qcDecision] || 5);
    });
  }, [jobs.data]);

  // Recorded QC checks (the real QualityCheck store) drive today's summary.
  const checksQ = useQuery({
    queryKey: ['qc', 'checks', user?.plantId],
    queryFn: async () => (await qcApi.list({ plantId: user?.plantId, limit: 500 })).data,
    refetchInterval: 20_000,
  });
  const startOfDayMs = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const todayChecks = useMemo(
    () => (checksQ.data || []).filter((c) => c.checkedAt && new Date(c.checkedAt).getTime() >= startOfDayMs),
    [checksQ.data, startOfDayMs]
  );

  // Passed / Failed from the recorded checks; Pending from the awaiting-QC queue.
  const summary = useMemo(() => ({
    passed: todayChecks.filter((c) => c.decision === 'pass').length,
    failed: todayChecks.filter((c) => c.decision === 'reject').length,
    pending: rows.filter((r) => r.qcDecision === 'pending').length,
    total: todayChecks.length,
  }), [todayChecks, rows]);

  // Rejection rate = rejected units / sampled units across today's checks.
  const sampledTotal = todayChecks.reduce((n, c) => n + (c.sampledQty || 0), 0);
  const rejectedTotal = todayChecks.reduce((n, c) => n + (c.rejectedQty || 0), 0);
  const rejectionRate = sampledTotal > 0 ? ((rejectedTotal / sampledTotal) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-primary" onClick={() => setEntry({})}>
          <Plus className="h-4 w-4" /> New QC Entry
        </button>
        <button className="btn-secondary" onClick={() => setShowReport(true)}>
          <FileText className="h-4 w-4" /> QC Report
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="chip-yellow text-[10.5px] font-bold">{summary.pending} Pending</div>
          <div className="chip-red text-[10.5px] font-bold">{summary.failed} Failed Today</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ─── QC Queue ─── */}
        <div className="panel !p-0 overflow-hidden">
          <div className="panel-header !px-4 !py-3 !mb-0 !border-b border-ink-100">
            <div className="panel-title">
              <ShieldCheck className="h-4 w-4 text-brand-500" />
              QC Queue
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Order</th>
                  <th className="th">Stage</th>
                  <th className="th">Batch</th>
                  <th className="th text-right">Weight</th>
                  <th className="th">Status</th>
                  <th className="th">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {jobs.isLoading ? (
                  <tr><td colSpan={6} className="td text-center py-8 text-[12px] text-ink-400">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center py-8 text-[12px] text-ink-500">
                    No QC items in queue.
                  </td></tr>
                ) : rows.map((r) => (
                  <tr key={r.key} className="tr-hover">
                    <td className="td">
                      <span className="font-mono text-[11.5px] font-bold text-brand-600">{r.orderNumber}</span>
                    </td>
                    <td className="td text-[12px]">{STAGE_LABEL[r.stage]}</td>
                    <td className="td text-[11.5px]">{r.batch}</td>
                    <td className="td text-right">
                      <span className="font-bold text-[12px] text-state-running tabular-nums">
                        {r.weight || 0} kg
                      </span>
                    </td>
                    <td className="td">
                      {r.qcDecision === 'pending' && <span className="chip-yellow text-[10px]">⏳ Pending</span>}
                      {r.qcDecision === 'fail' && <span className="chip-red text-[10px]">✗ Failed</span>}
                      {r.qcDecision === 'pass' && <span className="chip-green text-[10px]">✓ Passed</span>}
                      {r.qcDecision === 'hold' && <span className="chip-yellow text-[10px]">⚠ Hold</span>}
                    </td>
                    <td className="td">
                      {r.qcDecision === 'pending' ? (
                        <button
                          onClick={() => setEntry({ stage: r.stage, orderNumber: r.orderNumber })}
                          className="rounded-md bg-brand-500 text-white text-[10.5px] font-semibold px-2.5 py-1 hover:bg-brand-600"
                        >
                          Inspect
                        </button>
                      ) : (
                        <button
                          onClick={() => setEntry({ stage: r.stage, orderNumber: r.orderNumber })}
                          className="rounded-md bg-ink-50 text-ink-600 border border-ink-200 text-[10.5px] font-semibold px-2.5 py-1 hover:bg-ink-100 inline-flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── QC Summary Today ─── */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              📊 QC Summary — Today
            </div>
          </div>
          <div className="space-y-2.5">
            <SummaryRow icon="✓" label="Passed" value={summary.passed} accent="green" />
            <SummaryRow icon="✗" label="Failed" value={summary.failed} accent="red" />
            <SummaryRow icon="⏳" label="Pending" value={summary.pending} accent="yellow" />
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-state-idle/5 border border-state-idle/20">
              <span className="text-[13px] font-semibold text-ink-700">Rejection Rate</span>
              <span className="text-[18px] font-bold text-state-idle tabular-nums">{rejectionRate}%</span>
            </div>
          </div>
        </div>
      </div>

      {entry && <QCEntryModal seed={entry} onClose={() => setEntry(null)} />}
      {showReport && (
        <QCReportModal onClose={() => setShowReport(false)} summary={summary} rejectionRate={rejectionRate} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * NEW QC ENTRY — log a quality check against a production order (correct schema)
 * ══════════════════════════════════════════════════════════════════════ */
const QC_STAGES = ['printing', 'inspection', 'lamination', 'slitting', 'cutting', 'packaging'];

function QCEntryModal({ seed, onClose }) {
  const qc = useQueryClient();
  const user = authStore((s) => s.user);
  // Jobs are what the app actually creates (Sales Orders → Plan & Schedule, or
  // Planning → Create Job). QC checks attach to one of these.
  const ordersQ = useQuery({
    queryKey: ['jobs', 'qc-entry', user?.plantId],
    queryFn: async () => (await jobApi.list({ plantId: user?.plantId, limit: 200, sort: '-updatedAt' })).data,
  });
  const orders = ordersQ.data || [];

  const [form, setForm] = useState({
    orderId: '',
    stage: (seed?.stage && QC_STAGES.includes(seed.stage)) ? seed.stage : 'printing',
    sampledQty: 10, rejectedQty: 0, reworkQty: 0, decision: 'pass', notes: '',
  });
  const [err, setErr] = useState('');

  // If opened from a queue row, preselect the matching production order.
  useEffect(() => {
    if (form.orderId || !seed?.orderNumber || !orders.length) return;
    const m = orders.find((o) => String(o.orderNumber) === String(seed.orderNumber));
    if (m) setForm((f) => ({ ...f, orderId: m._id }));
  }, [orders, seed, form.orderId]);

  const sampled = Number(form.sampledQty) || 0;
  const rejected = Number(form.rejectedQty) || 0;
  const rework = Number(form.reworkQty) || 0;
  const passed = Math.max(0, sampled - rejected - rework);
  const qtyOk = rejected + rework <= sampled;
  const canSubmit = form.orderId && sampled > 0 && qtyOk;

  const submit = useMutation({
    mutationFn: async () => (await qcApi.create({
      orderId: form.orderId,
      stage: form.stage,
      sampledQty: sampled,
      passedQty: passed,
      rejectedQty: rejected,
      reworkQty: rework,
      decision: form.decision,
      notes: form.notes || undefined,
      plantId: user?.plantId ?? undefined,
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['qc'] });
      onClose();
    },
    onError: (e) => setErr(e.message || 'Could not save QC entry'),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={submit.isPending ? undefined : onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); setErr(''); if (canSubmit) submit.mutate(); }}
        className="card w-full max-w-lg p-6 space-y-3 my-8"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-brand-500" /> New QC Entry</h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1"><X className="h-4 w-4" /></button>
        </div>

        <label className="block"><span className="label">Job / Order *</span>
          <select className="input" value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })} required>
            <option value="">{ordersQ.isLoading ? 'Loading jobs…' : orders.length ? 'Select a job…' : 'No jobs yet'}</option>
            {orders.map((o) => (
              <option key={o._id} value={o._id}>{o.orderNumber || o.jobNumber}{o.product?.name ? ` — ${o.product.name}` : ''}</option>
            ))}
          </select>
          {!ordersQ.isLoading && orders.length === 0 && (
            <div className="text-[10.5px] mt-1 text-ink-400">Pehle ek job banao — Sales Orders → “Plan &amp; Schedule”, ya Planning &amp; Scheduling → “Create Job (no SO)”. Fir wo yahan aa jayega.</div>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Stage</span>
            <select className="input capitalize" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {QC_STAGES.map((s) => <option key={s} value={s} className="capitalize">{STAGE_LABEL[s] || s}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Decision</span>
            <select className="input" value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })}>
              <option value="pass">Pass</option>
              <option value="reject">Reject</option>
              <option value="rework">Rework</option>
              <option value="hold">Hold</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className="label">Sampled qty *</span>
            <input type="number" min="1" className="input tabular-nums" value={form.sampledQty} onChange={(e) => setForm({ ...form, sampledQty: e.target.value })} /></label>
          <label className="block"><span className="label">Rejected</span>
            <input type="number" min="0" className="input tabular-nums" value={form.rejectedQty} onChange={(e) => setForm({ ...form, rejectedQty: e.target.value })} /></label>
          <label className="block"><span className="label">Rework</span>
            <input type="number" min="0" className="input tabular-nums" value={form.reworkQty} onChange={(e) => setForm({ ...form, reworkQty: e.target.value })} /></label>
        </div>
        <div className={`text-[11px] ${qtyOk ? 'text-ink-400' : 'text-state-down'}`}>
          {qtyOk ? `Passed (auto): ${passed} of ${sampled}` : 'Rejected + rework cannot exceed sampled qty'}
        </div>

        <label className="block"><span className="label">Notes</span>
          <textarea rows={2} className="input text-[12.5px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Defects found, corrective action…" /></label>

        {err && <div className="rounded-lg bg-state-down/5 border border-state-down/20 p-2.5 text-[12px] text-state-down">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submit.isPending}>Cancel</button>
          <button type="submit" disabled={!canSubmit || submit.isPending}
            className={clsx('btn-primary', (!canSubmit || submit.isPending) && '!bg-ink-200 !text-ink-400 cursor-not-allowed pointer-events-none')}>
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save QC entry
          </button>
        </div>
      </form>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * QC REPORT — printable summary of recorded quality checks
 * ══════════════════════════════════════════════════════════════════════ */
const DECISION_CHIP = {
  pass: 'chip-green', reject: 'chip-red', rework: 'chip-yellow', hold: 'chip-yellow', fail: 'chip-red',
};

function QCReportModal({ onClose, summary, rejectionRate }) {
  const user = authStore((s) => s.user);
  const checksQ = useQuery({
    queryKey: ['qc', 'report', user?.plantId],
    queryFn: async () => (await qcApi.list({ plantId: user?.plantId, limit: 200 })).data,
  });
  const checks = checksQ.data || [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-3xl p-0 my-8 overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><FileText className="h-5 w-5 text-brand-500" /> QC Report</h2>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Print</button>
            <button onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat label="Passed" value={summary.passed} accent="text-state-running" />
            <MiniStat label="Failed" value={summary.failed} accent="text-state-down" />
            <MiniStat label="Pending" value={summary.pending} accent="text-state-idle" />
            <MiniStat label="Rejection rate" value={`${rejectionRate}%`} accent="text-ink-900" />
          </div>

          <div className="overflow-x-auto border border-ink-100 rounded-lg">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Order</th><th className="th">Stage</th><th className="th text-right">Sampled</th>
                  <th className="th text-right">Rejected</th><th className="th">Decision</th><th className="th">Checked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {checksQ.isLoading ? (
                  <tr><td colSpan={6} className="td text-center py-8 text-[12px] text-ink-400">Loading…</td></tr>
                ) : checks.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center py-8 text-[12px] text-ink-500">No QC records yet.</td></tr>
                ) : checks.map((c) => (
                  <tr key={c._id} className="tr-hover">
                    <td className="td font-mono text-[11.5px] text-brand-600">{c.order?.orderNumber || c.orderId?.orderNumber || String(c.orderId || '').slice(-6)}</td>
                    <td className="td text-[12px] capitalize">{STAGE_LABEL[c.stage] || c.stage}</td>
                    <td className="td text-right tabular-nums">{c.sampledQty ?? '—'}</td>
                    <td className="td text-right tabular-nums">{c.rejectedQty ?? 0}</td>
                    <td className="td"><span className={`${DECISION_CHIP[c.decision] || 'chip-gray'} text-[10px] capitalize`}>{c.decision}</span></td>
                    <td className="td text-[11px] text-ink-500">{c.checkedAt ? new Date(c.checkedAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold">{label}</div>
      <div className={`text-[18px] font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function SummaryRow({ icon, label, value, accent }) {
  const colorMap = {
    green: 'bg-state-running/5 border-state-running/20 text-state-running',
    red: 'bg-state-down/5 border-state-down/20 text-state-down',
    yellow: 'bg-state-idle/5 border-state-idle/20 text-state-idle',
  };
  return (
    <div className={clsx('flex items-center justify-between px-3 py-2.5 rounded-lg border', colorMap[accent])}>
      <span className="text-[13px] font-semibold">
        {icon} {label}
      </span>
      <span className="text-[18px] font-bold tabular-nums">{value}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * QC INSPECTION FORM — modal with 6-item checklist (screenshot match)
 * ══════════════════════════════════════════════════════════════════════ */
function QCInspectionForm({ row, onClose }) {
  const qc = useQueryClient();
  const user = authStore((s) => s.user);
  const [operator, setOperator] = useState(user?.name || '');
  const [checklist, setChecklist] = useState({}); // key → 'pass' | 'fail'
  const [sampleSize, setSampleSize] = useState(10);
  const [defectCount, setDefectCount] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const submit = useMutation({
    mutationFn: async (decision) => {
      // Record QC via the existing qcApi + also update the stage by re-running completeStage
      // Simplest path: create a QualityCheck document
      return (await qcApi.create({
        orderNumber: row.orderNumber,
        jobId: row.jobId,
        stageId: row.stageId,
        stage: row.stage,
        inspectorName: operator,
        sampleSize: Number(sampleSize),
        defectCount: Number(defectCount),
        decision,
        checklist,
        remarks,
      })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const allAnswered = QC_CHECKLIST.every((item) => checklist[item.key]);
  const anyFailed = QC_CHECKLIST.some((item) => checklist[item.key] === 'fail');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="max-w-2xl mx-auto bg-white rounded-2xl shadow-2xl my-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-state-running/10 grid place-items-center">✅</div>
            <div>
              <div className="font-bold text-[15px] text-ink-900">QC Inspection Form</div>
              <div className="text-[11px] text-ink-500">
                {row.orderNumber} · {STAGE_LABEL[row.stage]}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Order + stage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label">Order No.</div>
              <input
                readOnly
                value={row.orderNumber}
                className="input font-mono font-bold bg-ink-50"
              />
            </div>
            <div>
              <div className="label">Stage</div>
              <input
                readOnly
                value={STAGE_LABEL[row.stage]}
                className="input bg-ink-50"
              />
            </div>
            <div>
              <div className="label">Batch Weight (kg)</div>
              <input
                readOnly
                value={row.weight || 0}
                className="input bg-ink-50 tabular-nums"
              />
            </div>
            <div>
              <div className="label">QC Operator</div>
              <input
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="QC operator name"
                className="input"
              />
            </div>
          </div>

          {/* Checklist */}
          <div>
            <div className="label mb-2">Quality Checklist</div>
            <div className="space-y-2">
              {QC_CHECKLIST.map((item) => (
                <div
                  key={item.key}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2.5 rounded-lg border transition',
                    checklist[item.key] === 'pass' && 'bg-state-running/5 border-state-running/30',
                    checklist[item.key] === 'fail' && 'bg-state-down/5 border-state-down/30',
                    !checklist[item.key] && 'bg-ink-50 border-ink-200'
                  )}
                >
                  <span className="flex-1 text-[12.5px] font-semibold text-ink-800">{item.label}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setChecklist({ ...checklist, [item.key]: 'pass' })}
                      className={clsx(
                        'rounded-md text-[10.5px] font-bold px-3 py-1 border transition',
                        checklist[item.key] === 'pass'
                          ? 'bg-state-running text-white border-state-running'
                          : 'bg-state-running/10 text-state-running border-state-running/20 hover:bg-state-running/20'
                      )}
                    >
                      Pass
                    </button>
                    <button
                      onClick={() => setChecklist({ ...checklist, [item.key]: 'fail' })}
                      className={clsx(
                        'rounded-md text-[10.5px] font-bold px-3 py-1 border transition',
                        checklist[item.key] === 'fail'
                          ? 'bg-state-down text-white border-state-down'
                          : 'bg-state-down/10 text-state-down border-state-down/20 hover:bg-state-down/20'
                      )}
                    >
                      Fail
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sample + defects */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label">Sample Size</div>
              <input
                type="number"
                value={sampleSize}
                onChange={(e) => setSampleSize(e.target.value)}
                className="input tabular-nums"
              />
            </div>
            <div>
              <div className="label">Defect Count</div>
              <input
                type="number"
                value={defectCount}
                onChange={(e) => setDefectCount(e.target.value)}
                className="input tabular-nums"
              />
            </div>
          </div>

          {/* Remarks */}
          <div>
            <div className="label">Remarks / Action Required</div>
            <textarea
              rows="3"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Describe any defects found and corrective action..."
              className="input text-[12.5px]"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/20 p-3 text-[12px] text-state-down">
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-ink-100 flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => submit.mutate('fail')}
            disabled={!allAnswered || submit.isPending}
            className="btn-danger"
          >
            <XCircle className="h-4 w-4" /> Mark as Failed
          </button>
          <button
            onClick={() => submit.mutate('pass')}
            disabled={!allAnswered || anyFailed || submit.isPending}
            className={clsx(
              'btn inline-flex items-center gap-2 px-3.5 py-2 text-[12.5px] font-semibold rounded-lg',
              allAnswered && !anyFailed && !submit.isPending
                ? 'bg-state-running text-white hover:brightness-95'
                : 'bg-ink-200 text-ink-400 cursor-not-allowed'
            )}
          >
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve & Pass
          </button>
        </div>
      </div>
    </div>
  );
}
