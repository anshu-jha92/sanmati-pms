import mongoose from 'mongoose';

/**
 * Unified Employee/User: every user is an employee. Shop-floor operators,
 * QC inspectors, supervisors, admins all live here. Role determines what
 * they can see/do; team and machine assignments determine what they work on.
 */

const userSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    // Profile photo — stored as a data URL (or remote URL). Optional.
    avatar: { type: String },

    passwordHash: { type: String, required: true, select: false },

    roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role', index: true }],
    teams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team', index: true }],
    // Machines this user may operate; used for operator-wise filtering.
    assignedMachines: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Machine', index: true }],

    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', index: true },
    shift: { type: String, enum: ['A', 'B', 'C', 'General'], default: 'General' },

    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active', index: true },

    lastLoginAt: { type: Date },
    // Used for refresh token rotation. When a refresh is used, we bump this.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.index({ name: 'text', email: 'text', employeeCode: 'text' });

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const obj = this.toObject({ virtuals: true });
  delete obj.passwordHash;
  delete obj.tokenVersion;
  return obj;
};

export const User = mongoose.model('User', userSchema);
