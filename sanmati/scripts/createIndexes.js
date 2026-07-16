import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';

// Import models so their schemas are registered
import '../src/models/Plant.js';
import '../src/models/User.js';
import '../src/models/Role.js';
import '../src/models/Permission.js';
import '../src/models/Team.js';
import '../src/models/Machine.js';
import '../src/models/MachineStatus.js';
import '../src/models/MachineData.js';
import '../src/models/ProductionOrder.js';
import '../src/models/QualityCheck.js';
import '../src/models/Inventory.js';
import '../src/models/ERP.js';
import '../src/models/Dispatch.js';
import '../src/models/OEERollup.js';
import '../src/models/RefreshToken.js';
import '../src/models/AuditLog.js';
import '../src/models/ApiIntegration.js';

import mongoose from 'mongoose';

async function main() {
  await connectDatabase();
  for (const [name, model] of Object.entries(mongoose.models)) {
    logger.info({ model: name }, 'ensuring indexes');
    await model.syncIndexes();
  }
  logger.info('indexes synced');
  await disconnectDatabase();
}

main().catch((err) => {
  logger.fatal({ err }, 'index creation failed');
  process.exit(1);
});
