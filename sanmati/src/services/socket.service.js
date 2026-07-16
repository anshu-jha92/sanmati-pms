import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { pubClient, subClient } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { cacheService } from './cache.service.js';

/**
 * Socket.IO real-time layer.
 *
 * Namespaces:
 *   /ops    — operational dashboards (machine status, telemetry stream, OEE ticks)
 *   /orders — production order updates (stage transitions, completions)
 *   /alerts — alarms, QC decisions, dispatch events
 *
 * Rooms within /ops:
 *   plant:<plantId>            — all events for a plant (dashboards)
 *   machine:<machineId>        — per-machine drill-down pages
 *
 * Auth:
 *   Client connects with `auth: { token: <JWT access token> }` (or Authorization header during polling transport).
 *   Socket principals are cached briefly, mirroring the HTTP auth middleware.
 *
 * Redis adapter:
 *   Enables horizontal scaling of the API. All Node processes share the pub/sub channel
 *   so emits from any instance reach all connected clients.
 */

class SocketService {
  constructor() {
    this.io = null;
  }

  init(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
        credentials: true,
      },
      // Modest backpressure limits suitable for shop-floor dashboards
      pingInterval: 25_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 256 * 1024,
    });

    this.io.adapter(createAdapter(pubClient, subClient));

    // Attach auth middleware to each namespace we care about
    const ns = {
      ops: this.io.of('/ops'),
      orders: this.io.of('/orders'),
      alerts: this.io.of('/alerts'),
    };

    for (const [name, n] of Object.entries(ns)) {
      n.use(async (socket, next) => {
        try {
          const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.slice(7);
          if (!token) return next(new Error('unauthorized'));
          const decoded = verifyAccessToken(token);
          const cached = await cacheService.get(`auth:user:${decoded.sub}:v${decoded.tv ?? 0}`);
          const principal = cached || { id: decoded.sub, permissions: decoded.perm || [], plantId: decoded.plant };
          socket.data.principal = principal;
          next();
        } catch (err) {
          next(new Error('unauthorized'));
        }
      });

      n.on('connection', (socket) => {
        const p = socket.data.principal;
        logger.debug({ ns: name, user: p?.id }, 'socket connected');

        if (name === 'ops') {
          socket.on('subscribe:plant', (plantId) => {
            if (!isAllowedForPlant(p, plantId)) return;
            socket.join(`plant:${plantId}`);
          });
          socket.on('unsubscribe:plant', (plantId) => socket.leave(`plant:${plantId}`));
          socket.on('subscribe:machine', (machineId) => socket.join(`machine:${machineId}`));
          socket.on('unsubscribe:machine', (machineId) => socket.leave(`machine:${machineId}`));
        }
      });
    }

    this._ops = ns.ops;
    this._orders = ns.orders;
    this._alerts = ns.alerts;

    logger.info('Socket.IO initialised with Redis adapter');
    return this.io;
  }

  /** Emit a batch of raw machine events to plant + per-machine rooms. */
  emitMachineEvents(plantId, machineId, events) {
    if (!this._ops || !events?.length) return;
    // Coalesce into a single frame to avoid flooding clients during high-frequency ingestion.
    this._ops.to(`plant:${plantId}`).emit('machine:events', events);
    this._ops.to(`machine:${machineId}`).emit('machine:events', events);
  }

  /** Emit a derived machine status change (from worker). */
  emitMachineStatus(plantId, machineId, status) {
    if (!this._ops) return;
    this._ops.to(`plant:${plantId}`).to(`machine:${machineId}`).emit('machine:status', status);
  }

  /** Emit OEE tick (from worker hourly rollup). */
  emitOeeTick(plantId, machineId, rollup) {
    if (!this._ops) return;
    this._ops.to(`plant:${plantId}`).to(`machine:${machineId}`).emit('oee:tick', rollup);
  }

  /** Emit production order update. */
  emitOrderUpdate(plantId, order) {
    if (!this._orders) return;
    this._orders.to(`plant:${plantId}`).emit('order:update', order);
  }

  /** Emit a notification event to all clients in a plant. */
  emitNotification(plantId, event, payload) {
    if (!this._ops) return;
    this._ops.to(`plant:${plantId}`).emit(event, payload);
  }

  /** Emit alarm / alert. */
  emitAlert(plantId, alert) {
    if (!this._alerts) return;
    this._alerts.to(`plant:${plantId}`).emit('alert', alert);
  }

  async close() {
    if (this.io) await this.io.close();
  }
}

function isAllowedForPlant(principal, plantId) {
  if (!principal) return false;
  if (principal.permissions?.includes('*:*')) return true;
  if (!principal.plantId) return true; // no plant lock set
  return principal.plantId === String(plantId);
}

export const socketService = new SocketService();
