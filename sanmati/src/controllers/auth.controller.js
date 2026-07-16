import argon2 from 'argon2';
import { z } from 'zod';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken, randomId } from '../utils/tokens.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { cacheService } from '../services/cache.service.js';
import { env } from '../config/env.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

// Parse JWT TTL like "7d" / "15m" into milliseconds for cookie/expiry math
function ttlToMs(ttl) {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
  return n * unit;
}

async function issueTokens(user, { userAgent, ip, family }) {
  const accessToken = signAccessToken({
    sub: String(user._id),
    tv: user.tokenVersion || 0,
    plant: user.plantId ? String(user.plantId) : null,
  });
  const fam = family || randomId(12);
  const refreshToken = signRefreshToken({ sub: String(user._id), fam });
  const expiresAt = new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL));

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    family: fam,
    userAgent,
    ip,
    expiresAt,
  });

  return { accessToken, refreshToken, expiresAt };
}

export const login = asyncHandler(async (req, res) => {
  let body = req.body;
  if (body && body.isEncoded) {
    body = {
      email: Buffer.from(body.email, 'base64').toString('utf8'),
      password: Buffer.from(body.password, 'base64').toString('utf8'),
    };
  }
  const { email, password } = loginSchema.parse(body);
  // Constant-time-ish: always run hash verification even on unknown user
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash').lean();

  const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$00000000000000000000000000000000$00000000000000000000000000000000';
  const stored = user?.passwordHash || dummyHash;
  let valid = false;
  try {
    valid = await argon2.verify(stored, password);
  } catch {
    valid = false;
  }

  if (!user || user.status !== 'active' || !valid) {
    throw ApiError.unauthorized('Invalid credentials', { code: 'E_AUTH' });
  }

  const tokens = await issueTokens(user, {
    userAgent: req.get('user-agent'),
    ip: req.ip,
  });

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  res.json(
    ok({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        employeeCode: user.employeeCode,
      },
    })
  );
});

/**
 * Refresh token rotation with reuse detection:
 *   - Verify JWT
 *   - Look up stored hash; if not found OR already revoked, assume compromise → revoke entire family
 *   - Otherwise mark current token revoked, issue new pair in same family
 */
export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid refresh token', { code: 'E_REFRESH' });
  }

  const hash = hashToken(refreshToken);
  const record = await RefreshToken.findOne({ tokenHash: hash });

  if (!record) {
    // Possible reuse: revoke the entire family if we can find it
    await RefreshToken.updateMany({ family: decoded.fam, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw ApiError.unauthorized('Refresh token reuse detected', { code: 'E_REFRESH_REUSE' });
  }

  if (record.revokedAt) {
    // Reuse of already-revoked token — nuke entire family
    await RefreshToken.updateMany({ family: record.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw ApiError.unauthorized('Refresh token revoked', { code: 'E_REFRESH_REVOKED' });
  }
  if (record.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token expired', { code: 'E_REFRESH_EXPIRED' });
  }

  const user = await User.findById(record.userId).lean();
  if (!user || user.status !== 'active') throw ApiError.unauthorized('Inactive user');

  // Rotate
  const tokens = await issueTokens(user, {
    userAgent: req.get('user-agent'),
    ip: req.ip,
    family: record.family,
  });

  await RefreshToken.updateOne(
    { _id: record._id },
    { $set: { revokedAt: new Date(), replacedBy: hashToken(tokens.refreshToken) } }
  );

  res.json(
    ok({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    })
  );
});

export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  const hash = hashToken(refreshToken);
  await RefreshToken.updateOne({ tokenHash: hash, revokedAt: null }, { $set: { revokedAt: new Date() } });
  res.json(ok({ success: true }));
});

export const logoutAll = asyncHandler(async (req, res) => {
  await RefreshToken.updateMany({ userId: req.user.id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  // Bump tokenVersion — invalidates all access tokens in Redis cache after TTL
  await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  await cacheService.del(`auth:user:${req.user.id}:v${(req.user.tokenVersion ?? 0)}`);
  res.json(ok({ success: true }));
});

export const me = asyncHandler(async (req, res) => {
  res.json(ok(req.user));
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  avatar: z.string().nullish(),               // data URL / URL, or null to remove
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
}).refine((d) => !d.newPassword || d.currentPassword, {
  message: 'Current password is required to set a new password',
  path: ['currentPassword'],
});

/**
 * Self-service profile update — name, email, photo and password. Operates on the
 * authenticated user only (req.user.id), never an arbitrary id. Changing the
 * password requires the current password. The 60s principal cache is invalidated
 * so /auth/me reflects the change immediately.
 */
export const updateProfile = asyncHandler(async (req, res) => {
  const payload = updateProfileSchema.parse(req.body);
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) throw ApiError.notFound('User not found');

  if (payload.email && payload.email.toLowerCase() !== user.email) {
    const taken = await User.findOne({ email: payload.email.toLowerCase(), _id: { $ne: user._id } }).lean();
    if (taken) throw ApiError.conflict('That email is already in use', { code: 'E_DUPLICATE' });
    user.email = payload.email.toLowerCase();
  }
  if (payload.name) user.name = payload.name;
  if (payload.avatar !== undefined) user.avatar = payload.avatar || undefined;

  if (payload.newPassword) {
    const valid = await argon2.verify(user.passwordHash, payload.currentPassword || '');
    if (!valid) throw ApiError.badRequest('Current password is incorrect', { code: 'E_BAD_PASSWORD' });
    user.passwordHash = await argon2.hash(payload.newPassword, { type: argon2.argon2id });
  }

  await user.save();
  // Drop the cached principal so the next /auth/me returns fresh name/email/avatar.
  await cacheService.del(`auth:user:${user._id}:v${user.tokenVersion ?? 0}`);

  res.json(ok({
    id: String(user._id),
    name: user.name,
    email: user.email,
    avatar: user.avatar || null,
    employeeCode: user.employeeCode,
  }));
});
