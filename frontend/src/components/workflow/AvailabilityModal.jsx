import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check, AlertTriangle, XCircle, Factory, User, Package, Zap, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { salesOrderApi, jobApi } from '../../api/endpoints.js';
import { authStore } from '../../context/authStore.js';

const STAGE_LABELS = {
  printing: '🖨️ Printing',
  inspection: '🔍 Inspection',
  lamination: '🧲 Lamination',
  hot_room: '🔥 Hot Room',
  slitting: '✂️ Slitting',
  cutting: '🗂️ Cutting',
  packaging: '📦 Packaging',
};

/**
 * Shows full availability analysis for a SalesOrder, with one-click planning options:
 *   - "Schedule for later"  — creates Job with plannedStart in future
 *   - "Plan"                — creates Job with status=planned
 *   - "Make Job Order"      — creates Job with status=planned, auto-assigns machine
 *   - "Start Now"           — creates Job + immediately starts first stage (Instant Production)
 */
export function AvailabilityModal({ salesOrderId, onClose }) {
  const user = authStore((s) => s.user);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [selectedRoll, setSelectedRoll] = useState(''); // "input roll weight" entered by planner
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['sales-orders', salesOrderId, 'availability'],
    queryFn: async () => (await salesOrderApi.availability(salesOrderId)).data,
    enabled: !!salesOrderId,
  });

  const create = useMutation({
    mutationFn: async ({ line, mode }) => {
      const payload = {
        salesOrderId,
        salesOrderLineId: line.lineId,
        customer: query.data?.salesOrder?.customer,
        product: { sku: line.sku, name: line.productName },
        plannedQty: line.qty,
        uom: line.uom,
        inputRollWeightKg: selectedRoll ? Number(selectedRoll) : line.qty,
        inputRollDescription: selectedRoll ? `1 Roll · ${selectedRoll} KG` : undefined,
        priority: 'normal',
        plantId: user?.plantId,
      };
      const { data } = await jobApi.create(payload);
      return { job: data, mode };
    },
    onSuccess: ({ job, mode }) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      if (mode === 'start') {
        nav(`/tracking?orderNumber=${job.orderNumber}`);
      } else {
        nav(`/orders?highlight=${job._id}`);
      }
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const so = query.data?.salesOrder;
  const lines = query.data?.lines || [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="max-w-5xl mx-auto bg-white rounded-2xl shadow-2xl my-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] text-ink-400 uppercase">Availability Check</div>
            <h2 className="text-[16px] font-bold text-ink-900 mt-0.5">
              {so?.orderNumber} — {so?.customer}
            </h2>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {query.isLoading ? (
            <div className="py-10 text-center text-[12.5px] text-ink-400">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              Checking materials, machines, operators…
            </div>
          ) : (
            lines.map((line, idx) => (
              <LineAnalysis
                key={idx}
                line={line}
                selectedRoll={selectedRoll}
                onSelectRoll={setSelectedRoll}
                onAction={(mode) => { setError(''); create.mutate({ line, mode }); }}
                creating={create.isPending}
              />
            ))
          )}

          {error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/20 px-3 py-2 text-[12.5px] text-state-down">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LineAnalysis({ line, selectedRoll, onSelectRoll, onAction, creating }) {
  const { materials, machinesByStage, freeOperators, recommendation } = line;
  const canStart = recommendation?.canStart;
  const blockers = recommendation?.blockers || [];
  const hints = recommendation?.hints || [];

  return (
    <div className="border border-ink-200 rounded-xl overflow-hidden">
      {/* Line header */}
      <div className="px-4 py-3 bg-gradient-to-r from-brand-500 to-brand-600 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] opacity-90 uppercase tracking-wider">Line Item</div>
            <div className="font-bold text-[15px]">{line.productName}</div>
            <div className="text-[12px] opacity-90">
              SKU: <span className="font-mono">{line.sku}</span> · Qty: <span className="font-bold">{line.qty} {line.uom || 'kg'}</span>
            </div>
          </div>
          <div className={clsx(
            'rounded-full px-3 py-1 text-[11px] font-bold flex items-center gap-1.5',
            canStart ? 'bg-state-running text-white' : 'bg-state-down text-white'
          )}>
            {canStart ? <><Check className="h-3.5 w-3.5" /> Ready to produce</> : <><AlertTriangle className="h-3.5 w-3.5" /> Blocked</>}
          </div>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ═══ MATERIALS ═══ */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Package className="h-3.5 w-3.5 text-brand-500" />
            <div className="text-[11px] font-bold text-ink-700 uppercase tracking-wider">Raw Materials</div>
          </div>
          {materials?.length === 0 ? (
            <div className="text-[11.5px] text-ink-400">
              No BOM found for this SKU. Configure a BOM via the Integrations module.
            </div>
          ) : (
            <div className="space-y-1.5">
              {materials.map((m) => (
                <div
                  key={m.sku}
                  className={clsx(
                    'flex items-center gap-2 px-2.5 py-2 rounded-md border text-[11.5px]',
                    m.sufficient ? 'bg-state-running/5 border-state-running/20' : 'bg-state-down/5 border-state-down/30'
                  )}
                >
                  {m.sufficient ? (
                    <Check className="h-3.5 w-3.5 text-state-running shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-state-down shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink-900 truncate">{m.name}</div>
                    <div className="text-[10.5px] text-ink-500 tabular-nums">
                      need {m.neededQty} / have {m.onHand} {m.uom}
                      {!m.sufficient && (
                        <span className="text-state-down font-bold ml-1">
                          · short {m.shortfall} {m.uom}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ MACHINES ═══ */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Factory className="h-3.5 w-3.5 text-brand-500" />
            <div className="text-[11px] font-bold text-ink-700 uppercase tracking-wider">Free Machines</div>
          </div>
          <div className="space-y-1">
            {Object.entries(machinesByStage || {}).map(([stage, info]) => (
              <div key={stage} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ink-50 border border-ink-100 text-[11px]">
                <span className="text-ink-600 flex-1 capitalize">{STAGE_LABELS[stage] || stage}</span>
                <span className={clsx(
                  'font-bold tabular-nums',
                  info.free === 0 ? 'text-state-down' : 'text-state-running'
                )}>
                  {info.free} / {info.total} free
                </span>
                {info.freeMachines?.[0] && (
                  <span className="font-mono text-[10px] text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">
                    {info.freeMachines[0].code}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ═══ OPERATORS ═══ */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <User className="h-3.5 w-3.5 text-brand-500" />
            <div className="text-[11px] font-bold text-ink-700 uppercase tracking-wider">
              Free Operators ({freeOperators?.length || 0})
            </div>
          </div>
          <div className="max-h-[180px] overflow-y-auto space-y-1">
            {(freeOperators || []).slice(0, 8).map((op) => (
              <div key={op.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ink-50 border border-ink-100 text-[11px]">
                <div className="h-6 w-6 rounded-full bg-brand-500/10 text-brand-600 text-[10px] font-bold grid place-items-center shrink-0">
                  {(op.name?.[0] || '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink-900 truncate">{op.name}</div>
                  <div className="text-[10px] text-ink-400 truncate">
                    {op.employeeCode}{op.shift ? ` · Shift ${op.shift}` : ''}
                  </div>
                </div>
              </div>
            ))}
            {(freeOperators || []).length === 0 && (
              <div className="text-[11px] text-ink-400 py-2">No free operators at this moment.</div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Summary & actions ═══ */}
      {(blockers.length > 0 || hints.length > 0) && (
        <div className="px-4 py-3 bg-ink-50 border-t border-ink-100 space-y-1.5">
          {blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-[11.5px] text-state-down">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {b}
            </div>
          ))}
          {hints.map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-[11.5px] text-state-idle">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {h}
            </div>
          ))}
        </div>
      )}

      {/* ═══ Input roll + action buttons ═══ */}
      <div className="px-4 py-3 border-t border-ink-100 bg-white">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="label">Input roll weight (kg) — optional</label>
            <input
              type="number"
              step="0.1"
              placeholder={`default ${line.qty} kg`}
              value={selectedRoll}
              onChange={(e) => onSelectRoll(e.target.value)}
              className="input py-1.5 text-[12.5px] w-32"
            />
            <div className="text-[10.5px] text-ink-400 mt-1">
              e.g. put a 90 kg roll in for a 100 kg order — extra 10 kg gets added via materials at lamination.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary btn-sm"
              disabled={creating}
              onClick={() => onAction('schedule')}
            >
              Schedule
            </button>
            <button
              className="btn-secondary btn-sm"
              disabled={creating}
              onClick={() => onAction('plan')}
            >
              Plan
            </button>
            <button
              className="btn-primary btn-sm"
              disabled={creating}
              onClick={() => onAction('makeJob')}
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Make Job Order
            </button>
            <button
              className={clsx(
                'btn-sm inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold',
                canStart
                  ? 'bg-state-running text-white hover:brightness-95'
                  : 'bg-ink-200 text-ink-400 cursor-not-allowed'
              )}
              disabled={!canStart || creating}
              onClick={() => canStart && onAction('start')}
              title={!canStart ? 'Resolve blockers first' : ''}
            >
              <Zap className="h-3.5 w-3.5" /> Start Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
