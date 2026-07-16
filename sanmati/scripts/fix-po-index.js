/**
 * Migration: fix PurchaseOrder.externalId index
 *
 * Older builds of the schema created a non-sparse index on externalId,
 * which means MongoDB treats every doc with `externalId: null` as
 * conflicting on the unique key. This script:
 *   1. Drops the old externalId index
 *   2. Sets externalId to undefined (unsetting the field) wherever it's null
 *   3. Recreates a proper sparse, non-unique index
 *
 * Run with:  node scripts/fix-po-index.js   (from backend/ folder)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load .env explicitly from the backend folder (works regardless of cwd)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment.');
  console.error('   Make sure backend/.env file exists and contains:');
  console.error('   MONGODB_URI=mongodb+srv://…');
  process.exit(1);
}

const { PurchaseOrder } = await import('../src/models/PurchaseOrder.js');

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(MONGODB_URI);
  console.log('✓ Connected.');

  const coll = PurchaseOrder.collection;

  const indexes = await coll.indexes();
  console.log('\nExisting indexes on purchaseorders:');
  for (const i of indexes) {
    console.log(`  ${i.name} ${JSON.stringify(i.key)} unique=${!!i.unique} sparse=${!!i.sparse}`);
  }

  for (const i of indexes) {
    if (i.key?.externalId && !i.sparse) {
      console.log(`\nDropping bad index "${i.name}" …`);
      try {
        await coll.dropIndex(i.name);
        console.log('✓ dropped');
      } catch (e) {
        console.log(`✗ could not drop: ${e.message}`);
      }
    }
  }

  const r = await coll.updateMany(
    { externalId: null },
    { $unset: { externalId: '' } }
  );
  console.log(`\n✓ Cleaned ${r.modifiedCount} POs that had externalId: null`);

  await PurchaseOrder.syncIndexes();
  console.log('\n✓ Indexes synchronized with current schema');

  const after = await coll.indexes();
  console.log('\nFinal indexes on purchaseorders:');
  for (const i of after) {
    console.log(`  ${i.name} ${JSON.stringify(i.key)} unique=${!!i.unique} sparse=${!!i.sparse}`);
  }

  console.log('\n✅ Done. You can now create POs without externalId.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
