import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Hash of the refresh token (sha256 hex). Lookups go through this field.
    tokenHash: { type: String, required: true, index: true },
    family: { type: String, required: true, index: true }, // rotation family id
    userAgent: { type: String },
    ip: { type: String },
    // `expiresAt` gets a TTL index below — do NOT add `index: true` here or Mongoose
    // will see two index definitions on the same path and warn.
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: String },
  },
  { timestamps: true }
);

// TTL: MongoDB auto-removes docs once expiresAt is in the past.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
