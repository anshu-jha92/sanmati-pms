import { cacheClient } from '../config/redis.js';
import { logger } from '../config/logger.js';

/**
 * Cache-aside service with:
 *  - JSON serialisation
 *  - Per-tag invalidation (tags are sets containing cache keys; deleting a tag deletes all its keys)
 *  - getOrSet with inline loader
 *  - Small negative-cache for not-found results (optional)
 */

class CacheService {
  async get(key) {
    try {
      const v = await cacheClient.get(key);
      return v ? JSON.parse(v) : null;
    } catch (err) {
      logger.warn({ err, key }, 'cache get failed');
      return null;
    }
  }

  async set(key, value, ttlSec = 300, tags = []) {
    try {
      const s = JSON.stringify(value);
      const multi = cacheClient.multi().set(key, s, 'EX', ttlSec);
      for (const tag of tags) {
        multi.sadd(`tag:${tag}`, key);
        multi.expire(`tag:${tag}`, Math.max(ttlSec, 3600));
      }
      await multi.exec();
    } catch (err) {
      logger.warn({ err, key }, 'cache set failed');
    }
  }

  async del(...keys) {
    if (!keys.length) return;
    try {
      await cacheClient.del(...keys);
    } catch (err) {
      logger.warn({ err, keys }, 'cache del failed');
    }
  }

  async invalidateTag(tag) {
    try {
      const keys = await cacheClient.smembers(`tag:${tag}`);
      if (keys.length) await cacheClient.del(...keys);
      await cacheClient.del(`tag:${tag}`);
    } catch (err) {
      logger.warn({ err, tag }, 'cache tag invalidate failed');
    }
  }

  async getOrSet(key, ttlSec, loader, tags = []) {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const fresh = await loader();
    if (fresh !== undefined) await this.set(key, fresh, ttlSec, tags);
    return fresh;
  }
}

export const cacheService = new CacheService();
