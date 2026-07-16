import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    type: {
      type: String,
      enum: ['production', 'qc', 'dispatch', 'maintenance', 'planning', 'other'],
      required: true,
      index: true,
    },
    leader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', index: true },
    description: { type: String },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

teamSchema.index({ plantId: 1, slug: 1 }, { unique: true });

export const Team = mongoose.model('Team', teamSchema);
