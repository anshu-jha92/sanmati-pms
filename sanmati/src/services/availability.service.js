import mongoose from 'mongoose';
import { BOM } from '../models/ERP.js';
import { InventoryItem } from '../models/Inventory.js';
import { Machine } from '../models/Machine.js';
import { User } from '../models/User.js';
import { JobOrder, STAGES } from '../models/JobOrder.js';
import { SalesOrder } from '../models/SalesOrder.js';

/**
 * Availability & Smart Suggestions service.
 *
 * For a given SalesOrder line (or any {sku, qty} pair), compute:
 *   - BOM-derived material requirements
 *   - Which materials are sufficient / short / missing
 *   - Which machines per stage are currently free
 *   - Which operators on each stage's team are currently not assigned to an active job
 *
 * This is what the Planning screen uses to render "You can start this order" or
 * "Buy X kg of Y before starting" type suggestions.
 */

/* ====== Availability check for a single (sku, qty) ====== */

export async function checkAvailability({ sku, qty, plantId }) {
  const plant = plantId ? new mongoose.Types.ObjectId(plantId) : null;

  // 1. Find the latest active BOM for this SKU
  const bom = await BOM.findOne({ productSku: sku.toUpperCase(), active: true })
    .sort({ version: -1 })
    .lean();

  const materials = [];
  let allMaterialsOk = true;
  let anyMaterialMissing = false;

  if (bom?.components?.length) {
    for (const comp of bom.components) {
      // qty needed for this job = (per-unit) × (plannedQty) × (1 + scrap%)
      const scrap = comp.scrapPct || 0;
      const needed = comp.qtyPerUnit * qty * (1 + scrap / 100);
      const skuUpper = String(comp.sku).toUpperCase();

      // Try plant-scoped lookup first; if not found, fall back to global SKU
      // lookup. This prevents false "not found" results when data was created
      // with mismatched plantIds — common during seeding/migration.
      let item = null;
      if (plant) {
        item = await InventoryItem.findOne({ sku: skuUpper, plantId: plant }).lean();
      }
      if (!item) {
        item = await InventoryItem.findOne({ sku: skuUpper }).lean();
      }

      const onHand = item ? item.onHand - (item.reserved || 0) : 0;
      const sufficient = onHand >= needed;

      materials.push({
        sku: comp.sku,
        name: comp.name || item?.name || comp.sku,
        neededQty: round2(needed),
        uom: comp.uom || item?.uom || 'kg',
        onHand: round2(onHand),
        reorderLevel: item?.reorderLevel ?? 0,
        shortfall: sufficient ? 0 : round2(needed - onHand),
        sufficient,
        itemExists: !!item,
      });

      if (!sufficient) allMaterialsOk = false;
      if (!item) anyMaterialMissing = true;
    }
  }

  // 2. For each stage, find idle machines (plant-scoped, falls back to all)
  const machinesByStage = {};
  let machines = [];
  if (plant) {
    machines = await Machine.find({ active: true, plantId: plant })
      .select('code name stage currentStatus')
      .lean();
  }
  if (machines.length === 0) {
    machines = await Machine.find({ active: true })
      .select('code name stage currentStatus')
      .lean();
  }

  for (const stage of STAGES) {
    const stageMachines = machines.filter((m) => m.stage === stage);
    const free = stageMachines.filter(
      (m) => m.currentStatus?.state === 'idle' || m.currentStatus?.state === 'offline'
    );
    machinesByStage[stage] = {
      total: stageMachines.length,
      free: free.length,
      freeMachines: free.map((m) => ({ id: m._id, code: m.code, name: m.name, state: m.currentStatus?.state })),
      busyMachines: stageMachines
        .filter((m) => m.currentStatus?.state === 'running')
        .map((m) => ({ id: m._id, code: m.code, name: m.name })),
    };
  }

  // 3. Find free operators per stage-related team
  // We use team.type ~ stage where possible; otherwise fall back to any active users.
  // Active assignment = user is the operatorId of an in-progress StageExecution.
  const busyOperatorIds = new Set();
  const activeJobs = await JobOrder.find({
    status: 'in_progress',
    ...(plant ? { plantId: plant } : {}),
  })
    .select('stages.operatorId stages.status')
    .lean();
  for (const job of activeJobs) {
    for (const st of job.stages || []) {
      if (st.status === 'in_progress' && st.operatorId) busyOperatorIds.add(String(st.operatorId));
    }
  }

  const operators = await User.find({
    status: 'active',
    ...(plant ? { plantId: plant } : {}),
  })
    .select('employeeCode name shift assignedMachines teams')
    .populate('teams', 'type name')
    .lean();

  const freeOperators = operators
    .filter((o) => !busyOperatorIds.has(String(o._id)))
    .slice(0, 20)
    .map((o) => ({
      id: o._id,
      employeeCode: o.employeeCode,
      name: o.name,
      shift: o.shift,
      teams: (o.teams || []).map((t) => t.name),
    }));

  // 4. Compose recommendation
  let recommendation = {
    canStart: allMaterialsOk && !anyMaterialMissing,
    blockers: [],
    hints: [],
  };

  if (anyMaterialMissing) {
    recommendation.blockers.push(
      `${materials.filter((m) => !m.itemExists).length} BOM component(s) not found in inventory master`
    );
  }
  for (const m of materials) {
    if (!m.sufficient && m.itemExists) {
      recommendation.blockers.push(
        `Short on ${m.name}: need ${m.neededQty} ${m.uom}, have ${m.onHand} ${m.uom} (shortfall ${m.shortfall} ${m.uom})`
      );
    }
    if (m.sufficient && m.reorderLevel && m.onHand - m.neededQty < m.reorderLevel) {
      recommendation.hints.push(`After this job, ${m.name} will drop below reorder level (${m.reorderLevel})`);
    }
  }

  // First stage machine availability hint
  const firstStage = STAGES[0];
  if (machinesByStage[firstStage]?.free === 0) {
    recommendation.hints.push(`No free ${firstStage} machine right now — will queue`);
  }

  return {
    bom: bom ? { externalId: bom.externalId, version: bom.version } : null,
    materials,
    machinesByStage,
    freeOperators,
    recommendation,
  };
}

/* ====== Suggestions feed — top N insights for the dashboard ====== */

export async function getDashboardSuggestions({ plantId, limit = 8 } = {}) {
  const plant = plantId ? new mongoose.Types.ObjectId(plantId) : null;
  const suggestions = [];

  // 1. High-priority sales orders still in 'new' state
  const pendingHigh = await SalesOrder.find({
    ...(plant ? { plantId: plant } : {}),
    status: { $in: ['new', 'planning'] },
    priority: 'high',
  })
    .sort({ dueDate: 1 })
    .limit(3)
    .lean();

  for (const so of pendingHigh) {
    const lineCount = so.lines?.length || 0;
    suggestions.push({
      kind: 'urgent',
      icon: '🔴',
      title: `HIGH priority SO ${so.orderNumber} (${so.customer}) not planned`,
      desc: `${lineCount} line(s), due ${so.dueDate ? new Date(so.dueDate).toDateString() : 'TBD'}`,
      action: { label: 'Plan now', href: `/orders?salesOrderId=${so._id}` },
    });
  }

  // 2. Idle machines while there are orders waiting
  const idleMachines = await Machine.find({
    ...(plant ? { plantId: plant } : {}),
    active: true,
    'currentStatus.state': 'idle',
  })
    .select('code name stage')
    .limit(5)
    .lean();

  if (idleMachines.length > 0) {
    const waitingJobs = await JobOrder.countDocuments({
      ...(plant ? { plantId: plant } : {}),
      status: { $in: ['planned', 'released'] },
    });
    if (waitingJobs > 0) {
      for (const m of idleMachines.slice(0, 2)) {
        suggestions.push({
          kind: 'opportunity',
          icon: '🟢',
          title: `${m.code} (${m.stage}) is now FREE`,
          desc: `${waitingJobs} order(s) waiting. Assign to clear the queue.`,
          action: { label: 'Assign job', href: `/machines/${m._id}` },
        });
      }
    }
  }

  // 3. Low-stock materials
  const lowStock = await InventoryItem.aggregate([
    { $match: { ...(plant ? { plantId: plant } : {}), active: true, reorderLevel: { $gt: 0 } } },
    { $match: { $expr: { $lt: ['$onHand', '$reorderLevel'] } } },
    { $limit: 3 },
  ]);
  for (const i of lowStock) {
    suggestions.push({
      kind: 'warning',
      icon: '🟡',
      title: `${i.name} below reorder level`,
      desc: `Only ${i.onHand} ${i.uom || 'kg'} left (min ${i.reorderLevel}). Raise a PO.`,
      action: { label: 'View inventory', href: '/inventory' },
    });
  }

  return suggestions.slice(0, limit);
}

/* ====== Alerts feed ====== */

export async function getDashboardAlerts({ plantId, limit = 6 } = {}) {
  const plant = plantId ? new mongoose.Types.ObjectId(plantId) : null;
  const alerts = [];

  // Critical: out-of-stock materials currently holding back a job
  const heldJobs = await JobOrder.find({
    ...(plant ? { plantId: plant } : {}),
    status: 'qc_hold',
  })
    .select('orderNumber jobNumber product')
    .limit(3)
    .lean();
  for (const j of heldJobs) {
    alerts.push({
      severity: 'crit',
      icon: '🔴',
      title: `${j.orderNumber} on QC hold`,
      desc: `${j.product.name} — awaiting QC decision`,
      at: new Date(),
    });
  }

  // Warning: machines running below 70% of target
  const underperformers = await Machine.find({
    ...(plant ? { plantId: plant } : {}),
    active: true,
    'currentStatus.state': 'running',
  })
    .select('code name stage currentStatus targetOutputPerHour')
    .limit(3)
    .lean();
  // (Full perf calc would query MachineData; for now we flag by convention)

  return alerts.slice(0, limit);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
