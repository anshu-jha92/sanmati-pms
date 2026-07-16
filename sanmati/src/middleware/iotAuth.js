import { ApiError, asyncHandler } from '../utils/http.js';
import { Machine, hashApiKey } from '../models/Machine.js';

/**
 * IoT authentication — three ways to identify the machine, one way to prove you are it.
 *
 * Machine identity (pick ONE, in order of precedence):
 *   1. URL param :code       e.g. POST /iot/v1/machines/PR-01/data
 *   2. Body field machineId  e.g. {"machineId":"PR-01","state":"running",...}
 *   3. Header X-Machine-Code
 *
 * Authentication (REQUIRED):
 *   Header: X-API-Key: <key>         (cleartext key shown at create/rotate)
 *
 * Body field names accepted for machine code: machineId, machineCode, machine_code, code.
 *
 * The resolved machine is attached as req.iot = { machine }.
 * A small in-memory cache (30s TTL) avoids a DB hit on every packet.
 */

const cache = new Map(); // code -> { machine, expires }
const TTL_MS = 30_000;

function getCached(code) {
  const hit = cache.get(code);
  if (!hit) return null;
  if (hit.expires < Date.now()) { cache.delete(code); return null; }
  return hit.machine;
}
function setCached(code, machine) {
  cache.set(code, { machine, expires: Date.now() + TTL_MS });
}

function resolveMachineCode(req) {
  // 1. URL param
  if (req.params?.code) return String(req.params.code).toUpperCase().trim();

  // 2. Body — check several conventional names
  const body = req.body || {};
  const fromBody = body.machineId || body.machineCode || body.machine_code || body.code;
  if (fromBody) return String(fromBody).toUpperCase().trim();

  // 3. Header
  const fromHeader = req.header('x-machine-code');
  if (fromHeader) return String(fromHeader).toUpperCase().trim();

  return null;
}

export const iotAuth = asyncHandler(async (req, _res, next) => {
  const code = resolveMachineCode(req);
  const apiKey = req.header('x-api-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '');

  if (!code) {
    throw ApiError.unauthorized(
      'Machine code missing. Provide it as URL :code, body field "machineId", or header X-Machine-Code.',
      { code: 'E_IOT_CODE' }
    );
  }
  if (!apiKey) {
    throw ApiError.unauthorized('Missing X-API-Key header', { code: 'E_IOT_KEY' });
  }

  let machine = getCached(code);
  if (!machine) {
    machine = await Machine.findOne({ code, active: true })
      .select('+apiKeyHash code plantId stage idealCycleTimeSec targetOutputPerHour rateLimitRps')
      .lean();
    if (!machine) {
      throw ApiError.unauthorized(`Unknown or inactive machine: ${code}`, { code: 'E_IOT_MACHINE' });
    }
  }

  // Constant-time-ish compare
  const providedHash = hashApiKey(apiKey);
  if (providedHash.length !== machine.apiKeyHash.length) {
    throw ApiError.unauthorized('Invalid API key', { code: 'E_IOT_KEY_INVALID' });
  }
  let diff = 0;
  for (let i = 0; i < providedHash.length; i++) {
    diff |= providedHash.charCodeAt(i) ^ machine.apiKeyHash.charCodeAt(i);
  }
  if (diff !== 0) throw ApiError.unauthorized('Invalid API key', { code: 'E_IOT_KEY_INVALID' });

  setCached(code, machine);
  req.iot = { machine };
  next();
});
