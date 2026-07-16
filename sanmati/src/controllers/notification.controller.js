import { z } from 'zod';
import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { socketService } from '../services/socket.service.js';

/* ═══ LIST UNRESOLVED NOTIFICATIONS for current user ═══
 * Returns notifications where:
 *   - resolved = false
 *   - user not in dismissedBy
 *   - plantId matches user's plant
 */
export const listNotifications = asyncHandler(async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const filter = {
    resolved: false,
    dismissedBy: { $ne: userId },
  };
  if (req.user.plantId) filter.plantId = new mongoose.Types.ObjectId(req.user.plantId);

  const list = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json(ok(list));
});

/* ═══ COUNT UNREAD ═══ */
export const countNotifications = asyncHandler(async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const filter = {
    resolved: false,
    dismissedBy: { $ne: userId },
  };
  if (req.user.plantId) filter.plantId = new mongoose.Types.ObjectId(req.user.plantId);

  const count = await Notification.countDocuments(filter);
  res.json(ok({ count }));
});

/* ═══ DISMISS — hide from current user (does not resolve for others) ═══ */
export const dismissNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const notif = await Notification.findById(id);
  if (!notif) throw ApiError.notFound('Notification not found');

  await Notification.updateOne(
    { _id: id },
    { $addToSet: { dismissedBy: new mongoose.Types.ObjectId(req.user.id) } }
  );
  res.json(ok({ dismissed: true }));
});

/* ═══ RESOLVE — mark as handled (everyone stops seeing it) ═══ */
export const resolveNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const notif = await Notification.findByIdAndUpdate(
    id,
    {
      $set: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: new mongoose.Types.ObjectId(req.user.id),
      },
    },
    { new: true }
  );
  if (!notif) throw ApiError.notFound('Notification not found');

  if (notif.plantId) {
    socketService.emitNotification(String(notif.plantId), 'notification:resolved', { id: String(notif._id) });
  }
  res.json(ok(notif));
});
