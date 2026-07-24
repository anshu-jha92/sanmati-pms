import mongoose from 'mongoose';
import { env, isProd } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', !isProd);

export async function connectDatabase() {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err: err.message }, 'MongoDB error'));

  // Retry the INITIAL connect with backoff so a slow-starting DB on a fresh
  // deploy / VPS reboot self-heals instead of crash-looping under pm2.
  // (mongoose auto-reconnects on its own for drops AFTER a successful connect.)
  const MAX_ATTEMPTS = 8;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(env.MONGODB_URI, {
        maxPoolSize: env.MONGODB_POOL_SIZE,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
      });
      break;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        const delay = Math.min(attempt * 2000, 30_000);
        logger.warn(
          { attempt, maxAttempts: MAX_ATTEMPTS, retryInMs: delay, err: err.message },
          'MongoDB connect failed — retrying'
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    const redacted = env.MONGODB_URI.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
    // eslint-disable-next-line no-console
    console.error('\n❌ MongoDB connection failed.');
    // eslint-disable-next-line no-console
    console.error(`   URI (password hidden): ${redacted}`);
    // eslint-disable-next-line no-console
    console.error(`   Error: ${err.message}\n`);

    if (/ENOTFOUND|querySrv/i.test(err.message)) {
      // eslint-disable-next-line no-console
      console.error(
        '   → The hostname in your MONGODB_URI cannot be resolved.\n' +
          '   → If using Atlas, it should look like:\n' +
          '       mongodb+srv://USER:PASS@cluster0.XXXXX.mongodb.net/production_automation\n' +
          '   → If using a local install: mongodb://localhost:27017/production_automation\n'
      );
    } else if (/ECONNREFUSED/i.test(err.message)) {
      // eslint-disable-next-line no-console
      console.error(
        '   → MongoDB is not accepting connections on that host/port.\n' +
          '   → Start MongoDB, or check the host:port in MONGODB_URI.\n'
      );
    } else if (/Authentication failed/i.test(err.message)) {
      // eslint-disable-next-line no-console
      console.error(
        '   → Authentication failed. Check the user/password in MONGODB_URI.\n' +
          '   → In Atlas, also check the IP allow-list for this machine.\n'
      );
    }
      process.exit(1);
    }
  }

  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
