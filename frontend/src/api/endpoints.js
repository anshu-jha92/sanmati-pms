import { api } from './client.js';

export const authApi = {
  login: (email, password) => {
    const encodeBase64 = (str) => {
      try {
        return btoa(unescape(encodeURIComponent(str)));
      } catch {
        return btoa(str);
      }
    };
    return api.post('/api/v1/auth/login', {
      email: encodeBase64(email),
      password: encodeBase64(password),
      isEncoded: true,
    });
  },
  logout: (refreshToken) => api.post('/api/v1/auth/logout', { refreshToken }),
  me: () => api.get('/api/v1/auth/me'),
  updateProfile: (body) => api.patch('/api/v1/auth/profile', body),
};

export const dashboardApi = {
  overview: (plantId) => api.get('/api/v1/dashboard/overview', { plantId }),
  suggestions: (plantId) => api.get('/api/v1/dashboard/suggestions', { plantId }),
  alerts: (plantId) => api.get('/api/v1/dashboard/alerts', { plantId }),
};

// Legacy production orders (kept for compatibility)
export const productionApi = {
  list: (params) => api.get('/api/v1/production/orders', params),
  get: (id) => api.get(`/api/v1/production/orders/${id}`),
  create: (body) => api.post('/api/v1/production/orders', body),
  transitionStage: (id, stage, body) =>
    api.post(`/api/v1/production/orders/${id}/stages/${stage}/transition`, body),
};

export const salesOrderApi = {
  list: (params) => api.get('/api/v1/sales-orders', params),
  get: (id) => api.get(`/api/v1/sales-orders/${id}`),
  create: (body) => api.post('/api/v1/sales-orders', body),
  availability: (id) => api.get(`/api/v1/sales-orders/${id}/availability`),
  delete: (id) => api.del(`/api/v1/sales-orders/${id}`),
};

export const purchaseOrderApi = {
  list: (params) => api.get('/api/v1/purchase-orders', params),
  get: (id) => api.get(`/api/v1/purchase-orders/${id}`),
  create: (body) => api.post('/api/v1/purchase-orders', body),
  suggestions: (plantId) => api.get('/api/v1/purchase-orders/suggestions', { plantId }),
  delete: (id) => api.del(`/api/v1/purchase-orders/${id}`),
};

export const jobApi = {
  list: (params) => api.get('/api/v1/jobs', params),
  get: (id) => api.get(`/api/v1/jobs/${id}`),
  create: (body) => api.post('/api/v1/jobs', body),
  delete: (id) => api.del(`/api/v1/jobs/${id}`),
  myJobs: () => api.get('/api/v1/jobs/my-jobs'),
  schedule: (id, body) => api.post(`/api/v1/jobs/${id}/schedule`, body),
  release: (id) => api.post(`/api/v1/jobs/${id}/release`),
  assignStage: (id, stageId, body) =>
    api.post(`/api/v1/jobs/${id}/stages/${stageId}/assign`, body),
  startStage: (id, stageId, body) =>
    api.post(`/api/v1/jobs/${id}/stages/${stageId}/start`, body),
  confirmMaterials: (id, stageId) =>
    api.post(`/api/v1/jobs/${id}/stages/${stageId}/confirm-materials`),
  completeStage: (id, stageId, body) =>
    api.post(`/api/v1/jobs/${id}/stages/${stageId}/complete`, body),
};

export const notificationApi = {
  list: () => api.get('/api/v1/notifications'),
  count: () => api.get('/api/v1/notifications/count'),
  dismiss: (id) => api.post(`/api/v1/notifications/${id}/dismiss`),
  resolve: (id) => api.post(`/api/v1/notifications/${id}/resolve`),
};

export const availabilityApi = {
  check: (body) => api.post('/api/v1/availability/check', body),
};

export const machineApi = {
  list: (params) => api.get('/api/v1/machines', params),
  live: (plantId) => api.get('/api/v1/machines/live', { plantId }),
  get: (id) => api.get(`/api/v1/machines/${id}`),
  create: (body) => api.post('/api/v1/machines', body),
  update: (id, body) => api.patch(`/api/v1/machines/${id}`, body),
  updateAssignment: (id, body) => api.patch(`/api/v1/machines/${id}/assignment`, body),
  rotateKey: (id) => api.post(`/api/v1/machines/${id}/rotate-key`),
  telemetry: (id, params) => api.get(`/api/v1/machines/${id}/telemetry`, params),
  iotHistory: (id, params) => api.get(`/api/v1/machines/${id}/iot-history`, params),
  oee: (id, params) => api.get(`/api/v1/machines/${id}/oee`, params),
  statusHistory: (id, params) => api.get(`/api/v1/machines/${id}/status-history`, params),
};

export const downtimeApi = {
  summary: (params) => api.get('/api/v1/downtime/summary', params),
  intervals: (params) => api.get('/api/v1/downtime/intervals', params),
};

export const reportsApi = {
  summary: (params) => api.get('/api/v1/reports/summary', params),
};

export const qcApi = {
  list: (params) => api.get('/api/v1/qc/checks', params),
  create: (body) => api.post('/api/v1/qc/checks', body),
};

export const inventoryApi = {
  list: (params) => api.get('/api/v1/inventory/items', params),
  create: (body) => api.post('/api/v1/inventory/items', body),
  update: (id, body) => api.patch(`/api/v1/inventory/items/${id}`, body),
  recordMovement: (body) => api.post('/api/v1/inventory/movements', body),
  lowStock: () => api.get('/api/v1/inventory/low-stock'),
  sync: () => api.post('/api/v1/inventory/sync'),
  // Item tracking
  summary: (sku) => api.get(`/api/v1/inventory/items/${encodeURIComponent(sku)}/summary`),
  movements: (sku, params) => api.get(`/api/v1/inventory/items/${encodeURIComponent(sku)}/movements`, params),
  wip: (sku) => api.get(`/api/v1/inventory/items/${encodeURIComponent(sku)}/wip`),
};

export const bomApi = {
  list: (params) => api.get('/api/v1/bom', params),
  get: (idOrSku) => api.get(`/api/v1/bom/${idOrSku}`),
  requirements: (sku, qty) => api.get(`/api/v1/bom/${sku}/requirements`, { qty }),
  create: (body) => api.post('/api/v1/bom', body),
  update: (id, body) => api.patch(`/api/v1/bom/${id}`, body),
  remove: (id) => api.del(`/api/v1/bom/${id}`),
};

export const materialIssueApi = {
  list: (params) => api.get('/api/v1/material-issues', params),
  get: (id) => api.get(`/api/v1/material-issues/${id}`),
  wip: () => api.get('/api/v1/material-issues/wip'),
  issue: (body) => api.post('/api/v1/material-issues', body),
  consume: (id, body) => api.post(`/api/v1/material-issues/${id}/consume`, body),
  cancel: (id) => api.post(`/api/v1/material-issues/${id}/cancel`),
};

export const dispatchApi = {
  list: (params) => api.get('/api/v1/dispatch', params),
  create: (body) => api.post('/api/v1/dispatch', body),
  transition: (id, body) => api.post(`/api/v1/dispatch/${id}/transition`, body),
};

export const integrationApi = {
  list: () => api.get('/api/v1/integrations'),
  get: (id) => api.get(`/api/v1/integrations/${id}`),
  create: (body) => api.post('/api/v1/integrations', body),
  update: (id, body) => api.patch(`/api/v1/integrations/${id}`, body),
  remove: (id) => api.del(`/api/v1/integrations/${id}`),
  test: (id) => api.post(`/api/v1/integrations/${id}/test`),
  runNow: (id) => api.post(`/api/v1/integrations/${id}/run-now`),
  triggerSync: (id) => api.post(`/api/v1/integrations/${id}/sync`),
};

export const adminApi = {
  listRoles: () => api.get('/api/v1/roles'),
  listModules: () => api.get('/api/v1/roles/modules'),
  createRole: (body) => api.post('/api/v1/roles', body),
  updateRole: (id, body) => api.patch(`/api/v1/roles/${id}`, body),
  deleteRole: (id) => api.del(`/api/v1/roles/${id}`),
  listUsers: (params) => api.get('/api/v1/users', params),
  createUser: (body) => api.post('/api/v1/users', body),
  updateUser: (id, body) => api.patch(`/api/v1/users/${id}`, body),
  deleteUser: (id) => api.del(`/api/v1/users/${id}`),
  listTeams: (params) => api.get('/api/v1/teams', params),
  createTeam: (body) => api.post('/api/v1/teams', body),
  updateTeam: (id, body) => api.patch(`/api/v1/teams/${id}`, body),
};

export const materialRequestApi = {
  list: (params) => api.get('/api/v1/material-requests', params),
  get: (id) => api.get(`/api/v1/material-requests/${id}`),
  create: (body) => api.post('/api/v1/material-requests', body),
  suggest: (params) => api.get('/api/v1/material-requests/suggest', params),
  issue: (id, body) => api.post(`/api/v1/material-requests/${id}/issue`, body),
  reject: (id, body) => api.post(`/api/v1/material-requests/${id}/reject`, body),
  cancel: (id) => api.post(`/api/v1/material-requests/${id}/cancel`),
};
