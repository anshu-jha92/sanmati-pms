import mongoose from 'mongoose';
import { Plant } from '../models/Plant.js';
import { ApiError } from './http.js';

/**
 * Resolve a usable plantId (as an ObjectId) for create/write endpoints:
 *   explicit value → the caller's own plant → the first plant in the DB.
 *
 * Admin users frequently have no plantId, and the frontend sends `plantId: null`
 * for them. A null must fall back to the single/first plant instead of failing
 * validation — otherwise every create form breaks with "plantId: Expected string,
 * received null". Also guards against a non-existent / malformed id.
 */
export async function resolvePlantId(rawPlantId, userPlantId) {
  if (rawPlantId && mongoose.isValidObjectId(rawPlantId)) {
    const exists = await Plant.findById(rawPlantId).lean();
    if (exists) return exists._id;
  }
  if (userPlantId && mongoose.isValidObjectId(userPlantId)) {
    return new mongoose.Types.ObjectId(userPlantId);
  }
  const fallback = await Plant.findOne().sort({ createdAt: 1 }).lean();
  if (fallback) return fallback._id;
  throw ApiError.badRequest(
    'No valid plant found. Seed a plant first, or pass a real plantId.',
    { code: 'E_NO_PLANT' }
  );
}
