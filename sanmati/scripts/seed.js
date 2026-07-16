/**
 * Append this block to the end of backend/scripts/seed.js (before the final
 * `process.exit(0)` call). Or drop it in as a new scripts/seed-sanmati.js and run
 * with `node scripts/seed-sanmati.js`.
 *
 * Seeds Sanmati-specific demo data so the new workflow screens have something
 * to show on first run:
 *   - 3 BOMs (polybag, laminated pouch, zipper bag)
 *   - 6 inventory items (BOPP, LDPE, inks, adhesive, tape, carton)
 *   - 3 Sales Orders (high/medium/normal priority)
 *   - 2 JobOrders — one "draft/planned" and one already mid-flight (Lamination running)
 */

import mongoose from 'mongoose';
import { BOM } from '../src/models/ERP.js';
import { InventoryItem } from '../src/models/Inventory.js';
import { SalesOrder } from '../src/models/SalesOrder.js';
import { JobOrder, STAGES } from '../src/models/JobOrder.js';
import { Machine } from '../src/models/Machine.js';
import { User } from '../src/models/User.js';
import { Plant } from '../src/models/Plant.js';

export async function seedSanmatiWorkflowData({ logger }) {
  const plant = await Plant.findOne().lean();
  if (!plant) {
    logger.warn('No plant found — skipping Sanmati workflow seed');
    return;
  }
  const plantId = plant._id;

  // ─── Inventory items ─────────────────────────────────────
  const items = [
    { sku: 'BOPP-FILM-20',   name: 'BOPP Film 20micron', uom: 'kg', onHand: 3200, reserved: 0, reorderLevel: 500,  category: 'raw' },
    { sku: 'LDPE-PAPER',     name: 'LDPE Paper',         uom: 'kg', onHand: 900,  reserved: 0, reorderLevel: 200,  category: 'raw' },
    { sku: 'INK-RED',        name: 'Red Ink',            uom: 'kg', onHand: 80,   reserved: 0, reorderLevel: 20,   category: 'consumable' },
    { sku: 'INK-BLUE',       name: 'Blue Ink',           uom: 'kg', onHand: 65,   reserved: 0, reorderLevel: 20,   category: 'consumable' },
    { sku: 'INK-LAM',        name: 'Lamination Ink',     uom: 'kg', onHand: 12,   reserved: 0, reorderLevel: 50,   category: 'consumable' }, // ← LOW
    { sku: 'ADH-LAM',        name: 'Lamination Adhesive',uom: 'kg', onHand: 180,  reserved: 0, reorderLevel: 40,   category: 'consumable' },
    { sku: 'TAPE-SEAL',      name: 'Sealing Tape',       uom: 'kg', onHand: 22,   reserved: 0, reorderLevel: 5,    category: 'consumable' },
    { sku: 'CARTON-L',       name: 'Carton Box Large',   uom: 'pcs',onHand: 450,  reserved: 0, reorderLevel: 100,  category: 'packaging' },
  ];

  for (const it of items) {
    await InventoryItem.updateOne(
      { sku: it.sku, plantId },
      { $set: { ...it, plantId, active: true } },
      { upsert: true }
    );
  }
  logger.info(`Seeded ${items.length} inventory items`);

  // ─── BOMs ────────────────────────────────────────────────
  const boms = [
    {
      externalId: 'BOM-POLY-5KG-V2',
      version: '2.0',
      productSku: 'POLYBAG-5KG',
      productName: 'Printed Polybag 5kg',
      active: true,
      components: [
        { sku: 'BOPP-FILM-20', name: 'BOPP Film 20micron', qtyPerUnit: 1.00,  uom: 'kg', scrapPct: 2 },
        { sku: 'INK-RED',      name: 'Red Ink',            qtyPerUnit: 0.03,  uom: 'kg', scrapPct: 5 },
        { sku: 'INK-BLUE',     name: 'Blue Ink',           qtyPerUnit: 0.025, uom: 'kg', scrapPct: 5 },
        { sku: 'TAPE-SEAL',    name: 'Sealing Tape',       qtyPerUnit: 0.002, uom: 'kg', scrapPct: 0 },
      ],
    },
    {
      externalId: 'BOM-LAMPOUCH-V1',
      version: '1.0',
      productSku: 'LAMPOUCH-SNACK',
      productName: 'Laminated Snack Pack',
      active: true,
      components: [
        { sku: 'BOPP-FILM-20', name: 'BOPP Film',          qtyPerUnit: 1.00,  uom: 'kg', scrapPct: 2 },
        { sku: 'LDPE-PAPER',   name: 'LDPE Paper',         qtyPerUnit: 0.12,  uom: 'kg', scrapPct: 3 },
        { sku: 'INK-LAM',      name: 'Lamination Ink',     qtyPerUnit: 0.05,  uom: 'kg', scrapPct: 5 },
        { sku: 'ADH-LAM',      name: 'Lamination Adhesive',qtyPerUnit: 0.07,  uom: 'kg', scrapPct: 3 },
      ],
    },
    {
      externalId: 'BOM-ZIPPER-V1',
      version: '1.0',
      productSku: 'ZIPPER-LOCK',
      productName: 'Zipper Lock Bag',
      active: true,
      components: [
        { sku: 'BOPP-FILM-20', name: 'BOPP Film',          qtyPerUnit: 1.00,  uom: 'kg', scrapPct: 3 },
        { sku: 'INK-RED',      name: 'Red Ink',            qtyPerUnit: 0.02,  uom: 'kg', scrapPct: 5 },
      ],
    },
  ];
  for (const bom of boms) {
    await BOM.updateOne(
      { externalId: bom.externalId },
      { $set: bom },
      { upsert: true }
    );
  }
  logger.info(`Seeded ${boms.length} BOMs`);

  // ─── Sales Orders ────────────────────────────────────────
  const salesOrders = [
    {
      externalId: 'SO-EXT-7845',
      orderNumber: 'SO-7845',
      customer: 'Gupta Traders',
      priority: 'high',
      status: 'new',
      orderedAt: new Date(Date.now() - 2 * 86400000),
      dueDate: new Date(Date.now() + 5 * 86400000),
      plantId,
      currency: 'INR',
      totalValue: 125000,
      lines: [{
        sku: 'POLYBAG-5KG',
        productName: 'Printed Polybag 5kg',
        qty: 80,
        uom: 'kg',
        status: 'pending',
      }],
    },
    {
      externalId: 'SO-EXT-7846',
      orderNumber: 'SO-7846',
      customer: 'Sharma Foods',
      priority: 'medium',
      status: 'new',
      orderedAt: new Date(Date.now() - 1 * 86400000),
      dueDate: new Date(Date.now() + 7 * 86400000),
      plantId,
      totalValue: 180000,
      lines: [{
        sku: 'LAMPOUCH-SNACK',
        productName: 'Laminated Snack Pack',
        qty: 120,
        uom: 'kg',
        status: 'pending',
      }],
    },
    {
      externalId: 'SO-EXT-7847',
      orderNumber: 'SO-7847',
      customer: 'Aggarwal Pkg',
      priority: 'normal',
      status: 'new',
      orderedAt: new Date(Date.now() - 3 * 3600000),
      dueDate: new Date(Date.now() + 10 * 86400000),
      plantId,
      totalValue: 95000,
      lines: [{
        sku: 'ZIPPER-LOCK',
        productName: 'Zipper Lock Bag',
        qty: 95,
        uom: 'kg',
        status: 'pending',
      }],
    },
  ];
  for (const so of salesOrders) {
    await SalesOrder.updateOne(
      { externalId: so.externalId },
      { $set: so },
      { upsert: true }
    );
  }
  logger.info(`Seeded ${salesOrders.length} sales orders`);

  // ─── JobOrder — one in-flight demo job ───────────────────
  const printMachine = await Machine.findOne({ plantId, stage: 'printing' }).lean();
  const lamMachine = await Machine.findOne({ plantId, stage: 'lamination' }).lean();
  const operator = await User.findOne({ plantId }).lean();

  const existingDemo = await JobOrder.findOne({ orderNumber: 'PB-001' });
  if (!existingDemo) {
    const stages = STAGES.map((stage, idx) => ({
      stage,
      sequence: idx + 1,
      status: idx < 2 ? 'completed' : idx === 2 ? 'in_progress' : 'pending',
      machineId: idx === 0 ? printMachine?._id : idx === 2 ? lamMachine?._id : undefined,
      operatorId: idx < 3 ? operator?._id : undefined,
      startedAt: idx <= 2 ? new Date(Date.now() - (3 - idx) * 3600000) : undefined,
      completedAt: idx < 2 ? new Date(Date.now() - (2 - idx) * 3600000) : undefined,
      weightInKg: idx === 0 ? 90 : idx === 1 ? 90 : idx === 2 ? 90 : 0,
      weightOutKg: idx === 0 ? 90 : idx === 1 ? 90 : 0,
      durationSec: idx < 2 ? 3000 : undefined,
      materialsAdded: idx === 0 ? [
        { sku: 'BOPP-FILM-20', name: 'BOPP Film Roll', type: 'raw', qty: 90, uom: 'kg' },
        { sku: 'INK-RED', name: 'Red/Blue Ink', type: 'consumable', qty: 4.3, uom: 'kg' },
      ] : [],
      qcResult: idx < 2 ? { decision: 'pass' } : { decision: 'pending' },
      operatorRemarks: idx === 0 ? 'Print quality excellent. Registration perfect.' : undefined,
    }));

    await JobOrder.create({
      orderNumber: 'PB-001',
      jobNumber: 'JOB-7845',
      source: 'sales_order',
      customer: 'Gupta Traders',
      product: { sku: 'POLYBAG-5KG', name: 'Printed Polybag 5kg' },
      plannedQty: 80,
      uom: 'kg',
      inputRollDescription: '1 Roll · 90 KG BOPP Film',
      inputRollWeightKg: 90,
      priority: 'high',
      status: 'in_progress',
      plannedStart: new Date(Date.now() - 4 * 3600000),
      dueDate: new Date(Date.now() + 5 * 86400000),
      currentStageIndex: 2,
      currentWeightKg: 90,
      totalProducedKg: 180,
      stages,
      bomSnapshot: {
        externalId: 'BOM-POLY-5KG-V2',
        version: '2.0',
        components: boms[0].components,
      },
      plantId,
      actualStart: new Date(Date.now() - 4 * 3600000),
    });
    logger.info('Seeded demo JobOrder PB-001 (mid-flight)');
  }
}
