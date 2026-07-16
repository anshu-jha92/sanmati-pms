import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { require as can, requireAny } from '../middleware/rbac.js';
import { authLimiter, apiLimiter } from '../middleware/rateLimiter.js';

import * as auth from '../controllers/auth.controller.js';
import * as production from '../controllers/production.controller.js';
import * as machines from '../controllers/machine.controller.js';
import * as dashboard from '../controllers/dashboard.controller.js';
import * as admin from '../controllers/admin.controller.js';
import * as ops from '../controllers/ops.controller.js';
import * as integrations from '../controllers/integration.controller.js';
import * as inventory from '../controllers/inventory.controller.js';
import * as workflow from '../controllers/workflow.controller.js';
import * as po from '../controllers/purchaseOrder.controller.js';
import * as bom from '../controllers/bom.controller.js';
import * as materialIssue from '../controllers/materialIssue.controller.js';

export function buildRouter() {
  const root = Router();

  // ════════════════════ AUTH ════════════════════
  const authRouter = Router();
  authRouter.post('/login', authLimiter, auth.login);
  authRouter.post('/refresh', authLimiter, auth.refresh);
  authRouter.post('/logout', authenticate, auth.logout);
  authRouter.post('/logout-all', authenticate, auth.logoutAll);
  authRouter.get('/me', authenticate, auth.me);
  root.use('/auth', authRouter);

  // ════════════════════ DEBUG (PUBLIC — no auth) ════════════════════
  // Diagnostic endpoints for troubleshooting. Safe to expose because they only
  // return read-only state. Remove these routes in production.
  root.get('/inventory/debug', inventory.debugInventory);

  // Everything else requires auth + general API rate limit
  const api = Router();
  api.use(apiLimiter, authenticate);

  // ════════════════════ DASHBOARD ════════════════════
  api.get('/dashboard/overview', can('reports', 'view'), dashboard.overview);
  api.get('/dashboard/suggestions', workflow.dashboardSuggestions);
  api.get('/dashboard/alerts', workflow.dashboardAlerts);

  // ════════════════════ SALES ORDERS (new) ════════════════════
  api.get('/sales-orders', can('sales_orders', 'view'), workflow.listSalesOrders);
  api.post('/sales-orders', can('sales_orders', 'create'), workflow.createSalesOrder);
  api.get('/sales-orders/:id', can('sales_orders', 'view'), workflow.getSalesOrder);
  api.get('/sales-orders/:id/availability', can('sales_orders', 'view'), workflow.salesOrderAvailability);

  // ════════════════════ JOB ORDERS (new) ════════════════════
  api.get('/jobs/my-jobs', workflow.myJobs); // operator sees their own — any authenticated user
  api.get('/jobs', can('production', 'view'), workflow.listJobOrders);
  api.post('/jobs', can('production', 'create'), workflow.createJobOrder);
  api.get('/jobs/:id', can('production', 'view'), workflow.getJobOrder);
  api.post('/jobs/:id/schedule', can('production', 'update'), workflow.scheduleJob);
  api.post('/jobs/:id/release', can('production', 'update'), workflow.releaseJob);
  api.post('/jobs/:id/stages/:stageId/start', can('production', 'execute'), workflow.startStage);
  api.post('/jobs/:id/stages/:stageId/complete', can('production', 'execute'), workflow.completeStage);

  // Ad-hoc availability
  api.post('/availability/check', can('production', 'view'), workflow.adHocAvailability);

  // ════════════════════ PURCHASE ORDERS (simplified: create = receive) ════════════════════
  api.get('/purchase-orders', can('purchase_orders', 'view'), po.listPurchaseOrders);
  api.get('/purchase-orders/suggestions', can('purchase_orders', 'view'), po.autoReorderSuggestions);
  api.get('/purchase-orders/:id', can('purchase_orders', 'view'), po.getPurchaseOrder);
  api.post('/purchase-orders', can('purchase_orders', 'create'), po.createPurchaseOrder);

  // ════════════════════ BOM (ERP-pushed, read-only from UI) ════════════════════
  api.get('/bom', can('inventory', 'view'), bom.listBoms);
  api.get('/bom/:idOrSku', can('inventory', 'view'), bom.getBom);
  api.get('/bom/:sku/requirements', can('inventory', 'view'), bom.calculateRequirements);

  // ════════════════════ MATERIAL ISSUES (WIP tracking) ════════════════════
  // Store manager issues materials to operators → tracks WIP → deducts inventory
  api.get('/material-issues',           can('inventory', 'view'),   materialIssue.listIssues);
  api.get('/material-issues/wip',       can('inventory', 'view'),   materialIssue.currentWIP);
  api.get('/material-issues/:id',       can('inventory', 'view'),   materialIssue.getIssue);
  api.post('/material-issues',          can('inventory', 'create'), materialIssue.issueMaterial);
  api.post('/material-issues/:id/consume', can('inventory', 'update'), materialIssue.reportConsumption);
  api.post('/material-issues/:id/cancel',  can('inventory', 'update'), materialIssue.cancelIssue);

  // ════════════════════ PRODUCTION ORDERS (legacy) ════════════════════
  api.get('/production/orders', can('production', 'view'), production.list);
  api.get('/production/orders/:id', can('production', 'view'), production.getOne);
  api.post('/production/orders', can('production', 'create'), production.create);
  api.post('/production/orders/:id/stages/:stage/transition', can('production', 'update'), production.transitionStage);

  // ════════════════════ MACHINES ════════════════════
  api.get('/machines', can('machines', 'view'), machines.list);
  api.get('/machines/live', can('machines', 'view'), machines.liveStatusSummary);
  api.get('/machines/:id', can('machines', 'view'), machines.getOne);
  api.post('/machines', can('machines', 'create'), machines.create);
  api.patch('/machines/:id', can('machines', 'update'), machines.update);
  api.post('/machines/:id/rotate-key', can('machines', 'update'), machines.rotateMachineApiKey);
  api.get('/machines/:id/telemetry', can('machine_data', 'view'), machines.telemetry);
  api.get('/machines/:id/oee', can('reports', 'view'), machines.oeeHistory);
  api.get('/machines/:id/status-history', can('machines', 'view'), machines.statusHistory);

  // ════════════════════ QC ════════════════════
  api.get('/qc/checks', can('qc', 'view'), ops.listQc);
  api.post('/qc/checks', can('qc', 'create'), ops.createQc);

  // ════════════════════ INVENTORY (enhanced) ════════════════════
  // Use the new inventory.controller if it exists, otherwise fall back to ops
  api.get('/inventory/items', can('inventory', 'view'), inventory.listInventory || ops.listInventory);
  api.get('/inventory/items/:sku/summary',   can('inventory', 'view'), inventory.itemSummary);
  api.get('/inventory/items/:sku/movements', can('inventory', 'view'), inventory.itemMovements);
  api.get('/inventory/items/:sku/wip',       can('inventory', 'view'), inventory.itemWIP);
  api.get('/inventory/low-stock', can('inventory', 'view'), inventory.lowStockAlerts);
  api.post('/inventory/items', can('inventory', 'create'), inventory.createInventoryItem);
  api.patch('/inventory/items/:id', can('inventory', 'update'), inventory.updateInventoryItem);
  api.post('/inventory/movements', can('inventory', 'create'), inventory.recordMovement || ops.recordMovement);
  api.post('/inventory/sync', can('inventory', 'update'), inventory.triggerErpSync);

  // ════════════════════ DISPATCH ════════════════════
  api.get('/dispatch', can('dispatch', 'view'), ops.listDispatches);
  api.post('/dispatch', can('dispatch', 'create'), ops.createDispatch);
  api.post('/dispatch/:id/transition', can('dispatch', 'update'), ops.transitionDispatch);

  // ════════════════════ API INTEGRATIONS ════════════════════
  api.get('/integrations', can('integrations', 'view'), integrations.list);
  api.get('/integrations/:id', can('integrations', 'view'), integrations.getOne);
  api.post('/integrations', can('integrations', 'create'), integrations.create);
  api.patch('/integrations/:id', can('integrations', 'update'), integrations.update);
  api.delete('/integrations/:id', can('integrations', 'delete'), integrations.remove);
  api.post('/integrations/:id/test', can('integrations', 'update'), integrations.test);
  api.post('/integrations/:id/sync', can('integrations', 'update'), integrations.triggerSync);
  api.post('/integrations/:id/run-now', can('integrations', 'update'), integrations.runNow);

  // ════════════════════ ADMIN: ROLES ════════════════════
  api.get('/roles/modules', requireAny(['roles', 'view']), admin.listModules);
  api.get('/roles', can('roles', 'view'), admin.listRoles);
  api.post('/roles', can('roles', 'create'), admin.createRole);
  api.patch('/roles/:id', can('roles', 'update'), admin.updateRole);
  api.delete('/roles/:id', can('roles', 'delete'), admin.deleteRole);

  // ════════════════════ ADMIN: USERS / EMPLOYEES ════════════════════
  api.get('/users', can('employees', 'view'), admin.listUsers);
  api.post('/users', can('employees', 'create'), admin.createUser);
  api.patch('/users/:id', can('employees', 'update'), admin.updateUser);

  // ════════════════════ ADMIN: TEAMS ════════════════════
  api.get('/teams', can('teams', 'view'), admin.listTeams);
  api.post('/teams', can('teams', 'create'), admin.createTeam);
  api.patch('/teams/:id', can('teams', 'update'), admin.updateTeam);

  root.use('/', api);
  return root;
}
