import mongoose from 'mongoose';
import { MODULES, ACTIONS } from './Permission.js';

const rolePermissionSchema = new mongoose.Schema(
  {
    module: { type: String, enum: MODULES, required: true },
    actions: [{ type: String, enum: ACTIONS }],
  },
  { _id: false }
);

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    // `unique: true` already creates an index on slug. No separate schema.index() needed.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String },
    isSystem: { type: Boolean, default: false },
    permissions: [rolePermissionSchema],
  },
  { timestamps: true }
);

roleSchema.methods.permissionSet = function permissionSet() {
  const set = new Set();
  for (const p of this.permissions) {
    for (const a of p.actions) set.add(`${p.module}:${a}`);
  }
  return set;
};

export const Role = mongoose.model('Role', roleSchema);
