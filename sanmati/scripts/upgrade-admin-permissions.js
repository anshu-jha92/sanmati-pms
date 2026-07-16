/**
 * Upgrade the System Admin role to have full permissions on ALL current modules.
 *
 * Run this ONCE when you add new modules to the system (like we did with
 * sales_orders and purchase_orders).
 *
 * Usage:
 *   cd backend
 *   node scripts/upgrade-admin-permissions.js
 */

import mongoose from 'mongoose';
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { Role } from '../src/models/Role.js';
import { User } from '../src/models/User.js';
import { MODULES, ACTIONS } from '../src/models/Permission.js';

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(env.MONGODB_URI);
  console.log('✓ Connected');

  console.log('\nCurrent MODULES:', MODULES.join(', '));
  console.log('Current ACTIONS:', ACTIONS.join(', '));

  // Build full-access permission list (admin gets everything)
  const fullPermissions = MODULES.map((module) => ({
    module,
    actions: ACTIONS,
  }));

  // 1. Update the System Admin role
  let adminRole = await Role.findOne({ slug: 'system-admin' });
  if (!adminRole) {
    console.log('\n⚠ No "system-admin" role found. Creating it…');
    adminRole = await Role.create({
      name: 'System Admin',
      slug: 'system-admin',
      description: 'Full access — auto-generated',
      isSystem: true,
      permissions: fullPermissions,
    });
  } else {
    console.log(`\nFound System Admin role (id: ${adminRole._id})`);
    console.log(`  Existing modules: ${adminRole.permissions.map((p) => p.module).join(', ') || '(none)'}`);
    adminRole.permissions = fullPermissions;
    await adminRole.save();
  }

  console.log('✓ System Admin role now has FULL permissions on:');
  console.log(`   ${MODULES.join(', ')}`);

  // 2. Bump tokenVersion on all admin users to force re-login/cache refresh
  // (Redis cache holds the old permission set for 60s, but safer to invalidate)
  const adminUsers = await User.find({ roles: adminRole._id });
  console.log(`\nFound ${adminUsers.length} user(s) with admin role`);

  for (const user of adminUsers) {
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    console.log(`  ✓ Invalidated session cache for ${user.email}`);
  }

  console.log('\n🎉 Done!');
  console.log('\nNEXT STEPS:');
  console.log('   1. Admin users must LOG OUT and LOG IN again to get the new permissions.');
  console.log('   2. Then the "New Sales Order" button will work.');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
