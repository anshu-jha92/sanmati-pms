import mongoose from 'mongoose';

export const MODULES = [
  'dashboard',
  'production',
  'sales_orders',
  'purchase_orders',
  'machines',
  'qc',
  'inventory',
  'dispatch',
  'integrations',
  'employees',
  'teams',
  'roles',
  'reports',
  'settings',
];

export const ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'execute',
  'approve',
  'admin',
];

const permissionSchema = new mongoose.Schema(
  {
    module: { type: String, enum: MODULES, required: true },
    actions: [{ type: String, enum: ACTIONS }],
  },
  { _id: false }
);

export const Permission = permissionSchema;
