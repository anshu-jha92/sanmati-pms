import argon2 from 'argon2';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Role } from '../models/Role.js';
import { User } from '../models/User.js';
import { MODULES, ACTIONS } from '../models/Permission.js';

export async function createSuperAdminIfNeeded() {
  try {
    // Require explicit admin credentials in backend .env to proceed
    if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
      logger.debug('Admin bootstrap skipped: ADMIN_EMAIL or ADMIN_PASSWORD not set in environment');
      return null;
    }

    const email = env.ADMIN_EMAIL;
    const password = env.ADMIN_PASSWORD;
    const name = env.ADMIN_NAME || 'System Admin';
    const employeeCode = env.ADMIN_EMPLOYEE_CODE || 'ADMIN';
    const phone = env.ADMIN_PHONE || '';

    // 1) Ensure system-admin role exists with full permissions
    const fullPermissions = MODULES.map((module) => ({ module, actions: ACTIONS }));
    let adminRole = await Role.findOne({ slug: 'system-admin' });
    if (!adminRole) {
      adminRole = await Role.create({
        name: 'System Admin',
        slug: 'system-admin',
        description: 'Full access — auto-generated',
        isSystem: true,
        permissions: fullPermissions,
      });
      logger.info('Created System Admin role (auto-bootstrap)');
    } else {
      adminRole.permissions = fullPermissions;
      await adminRole.save();
      logger.info('Updated System Admin role permissions (auto-bootstrap)');
    }

    // 2) Create the user if not exists
    let user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (user) {
      logger.info(`Admin user already exists: ${email}`);
      return { email, password: '(existing)', created: false };
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    user = await User.create({
      employeeCode,
      name,
      email: email.toLowerCase(),
      phone,
      passwordHash,
      roles: [adminRole._id],
      status: 'active',
    });

    logger.info(`Created admin user: ${email}`);
    return { email, password, created: true };
  } catch (err) {
    logger.error({ err }, 'Failed to create super admin during bootstrap');
    return null;
  }
}

export default createSuperAdminIfNeeded;
