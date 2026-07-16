import mongoose from 'mongoose';

/**
 * Tenant-like entity. Every production-related document carries plantId
 * so we can cleanly scope queries when we add multi-plant support.
 */
const plantSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    timezone: { type: String, default: 'Asia/Kolkata' },
    shiftConfig: {
      A: { start: { type: String, default: '06:00' }, end: { type: String, default: '14:00' } },
      B: { start: { type: String, default: '14:00' }, end: { type: String, default: '22:00' } },
      C: { start: { type: String, default: '22:00' }, end: { type: String, default: '06:00' } },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Plant = mongoose.model('Plant', plantSchema);
