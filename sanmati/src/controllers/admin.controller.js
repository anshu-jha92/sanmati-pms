import { z } from 'zod';
import argon2 from 'argon2';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { Team } from '../models/Team.js';
import { MODULES, ACTIONS } from '../models/Permission.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';
import { cacheService } from '../services/cache.service.js';

/* ====== Roles ====== */

const rolePermsSchema = z.array(
  z.object({
    module: z.enum(MODULES),
    actions: z.array(z.enum(ACTIONS)).min(1),
  })
);
const roleSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  description: z.string().optional(),
  permissions: rolePermsSchema.default([]),
});

export const listRoles = asyncHandler(async (_req, res) => {
  const roles = await Role.find().sort({ name: 1 }).lean();
  res.json(ok(roles));
});

export const createRole = asyncHandler(async (req, res) => {
  const payload = roleSchema.parse(req.body);
  const role = await Role.create(payload);
  await cacheService.invalidateTag('roles');
  res.status(201).json(ok(role));
});

export const updateRole = asyncHandler(async (req, res) => {
  const payload = roleSchema.partial().parse(req.body);
  const role = await Role.findById(req.params.id);
  if (!role) throw ApiError.notFound('Role not found');
  // The System Admin role is locked — its access is managed on boot, not here.
  if (role.isSystem) {
    throw ApiError.forbidden('The System Admin role is locked and cannot be edited.', { code: 'E_ROLE_SYSTEM' });
  }
  // An admin cannot change their own role's permissions (prevents self-lockout).
  if ((req.user?.roleSlugs || []).includes(role.slug)) {
    throw ApiError.forbidden('You cannot edit your own role — ask another admin to change it.', { code: 'E_ROLE_SELF' });
  }
  Object.assign(role, payload);
  await role.save();
  await cacheService.invalidateTag('roles');
  res.json(ok(role));
});

export const deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.id);
  if (!role) throw ApiError.notFound('Role not found');
  if (role.isSystem) throw ApiError.forbidden('Cannot delete a system role', { code: 'E_ROLE_SYSTEM' });
  if ((req.user?.roleSlugs || []).includes(role.slug)) {
    throw ApiError.forbidden('You cannot delete your own role.', { code: 'E_ROLE_SELF' });
  }
  const inUse = await User.countDocuments({ roles: role._id });
  if (inUse > 0) throw ApiError.conflict(`Role is assigned to ${inUse} user(s) — reassign them first.`, { code: 'E_ROLE_IN_USE' });
  await role.deleteOne();
  await cacheService.invalidateTag('roles');
  res.json(ok({ success: true }));
});

export const listModules = asyncHandler(async (_req, res) => {
  res.json(ok({ modules: MODULES, actions: ACTIONS }));
});

/* ====== Users / Employees ====== */

const userSchema = z.object({
  employeeCode: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8).optional(),
  roles: z.array(z.string()).default([]),
  teams: z.array(z.string()).default([]),
  assignedMachines: z.array(z.string()).default([]),
  plantId: z.string().nullish(),
  shift: z.enum(['A', 'B', 'C', 'General']).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

const listUsersQuery = z.object({
  q: z.string().optional(),
  teamId: z.string().optional(),
  roleId: z.string().optional(),
  plantId: z.string().nullish(),
  status: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const listUsers = asyncHandler(async (req, res) => {
  const q = listUsersQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);
  const filter = {};
  if (q.teamId) filter.teams = q.teamId;
  if (q.roleId) filter.roles = q.roleId;
  if (q.plantId) filter.plantId = q.plantId;
  if (q.status) filter.status = q.status;
  if (q.q) filter.$text = { $search: q.q };

  const [items, total] = await Promise.all([
    User.find(filter).select('-passwordHash').populate('roles', 'name slug').populate('teams', 'name').sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

export const createUser = asyncHandler(async (req, res) => {
  const payload = userSchema.parse(req.body);
  if (!payload.password) throw ApiError.badRequest('Password required for new users');
  const passwordHash = await argon2.hash(payload.password, { type: argon2.argon2id });
  const user = await User.create({ ...payload, passwordHash });
  res.status(201).json(ok(user.toSafeJSON()));
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (String(user._id) === req.user.id) {
    throw ApiError.badRequest('You cannot delete your own account.', { code: 'E_SELF' });
  }
  await user.deleteOne();
  res.json(ok({ success: true }));
});

export const updateUser = asyncHandler(async (req, res) => {
  const payload = userSchema.partial().parse(req.body);
  const user = await User.findById(req.params.id).select('+passwordHash');
  if (!user) throw ApiError.notFound('User not found');
  if (payload.password) {
    user.passwordHash = await argon2.hash(payload.password, { type: argon2.argon2id });
    user.tokenVersion += 1;
  }
  delete payload.password;
  Object.assign(user, payload);
  await user.save();
  await cacheService.del(`auth:user:${user._id}:v${user.tokenVersion - 1}`);
  res.json(ok(user.toSafeJSON()));
});

/* ====== Teams ====== */

const teamSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  type: z.enum(['production', 'qc', 'dispatch', 'maintenance', 'planning', 'other']),
  leader: z.string().optional(),
  plantId: z.string().nullish(),
  description: z.string().optional(),
});

export const listTeams = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.plantId) filter.plantId = req.query.plantId;
  const teams = await Team.find(filter).populate('leader', 'name employeeCode').lean();
  res.json(ok(teams));
});

export const createTeam = asyncHandler(async (req, res) => {
  const payload = teamSchema.parse(req.body);
  const team = await Team.create(payload);
  res.status(201).json(ok(team));
});

export const updateTeam = asyncHandler(async (req, res) => {
  const payload = teamSchema.partial().parse(req.body);
  const team = await Team.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true });
  if (!team) throw ApiError.notFound('Team not found');
  res.json(ok(team));
});
