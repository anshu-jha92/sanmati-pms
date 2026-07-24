import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(__dirname, '../../.env'),
  resolve(__dirname, '../../../.env'),
  resolve(process.cwd(), '.env'),
];

for (const p of candidates) {
  if (existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

const mongoUri = z
  .string()
  .min(1, 'MONGODB_URI is required')
  .refine(
    (v) => /^mongodb(\+srv)?:\/\/[^\s/]+/i.test(v),
    'MONGODB_URI must start with "mongodb://" or "mongodb+srv://" and include a host. Example:\n' +
      '  Local:  mongodb://localhost:27017/production_automation\n' +
      '  Atlas:  mongodb+srv://USER:PASS@cluster0.XXXXX.mongodb.net/production_automation?retryWrites=true&w=majority'
  );

const redisUri = z
  .string()
  .min(1, 'REDIS_URL is required')
  .refine(
    (v) => /^rediss?:\/\//i.test(v),
    'REDIS_URL must start with "redis://" or "rediss://". Example: redis://localhost:6379'
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('*'),

  MONGODB_URI: mongoUri,
  MONGODB_POOL_SIZE: z.coerce.number().default(20),

  REDIS_URL: redisUri,
  REDIS_KEY_PREFIX: z.string().default('pa:'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  IOT_RATE_LIMIT_RPS: z.coerce.number().default(100),
  IOT_MAX_PAYLOAD_BYTES: z.coerce.number().default(262144),

  // External system integration API (for pushing sales/purchase orders from ERP).
  // When set it is the sole credential on those endpoints, so require real entropy.
  INTEGRATION_API_KEY: z.string().min(16, 'INTEGRATION_API_KEY must be a long random value').optional(),

  // Run background workers inside the API process (single-service deploy).
  // Set to 'false' only if you run a dedicated `npm run worker` process.
  WORKERS_INLINE: z.string().default('true'),

  WORKER_CONCURRENCY_TELEMETRY: z.coerce.number().default(8),
  WORKER_CONCURRENCY_OEE: z.coerce.number().default(2),
  WORKER_CONCURRENCY_SYNC: z.coerce.number().default(2),

  // Optional: create a super-admin user automatically on boot. Provide
  // ADMIN_CREATE_ON_BOOT=true and set ADMIN_EMAIL and ADMIN_PASSWORD.
  ADMIN_CREATE_ON_BOOT: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().optional(),
  ADMIN_EMPLOYEE_CODE: z.string().optional(),
  ADMIN_PHONE: z.string().optional(),
}).superRefine((val, ctx) => {
  // In production, refuse a wildcard CORS origin. Combined with credentials:true
  // it reflects any origin (CWE-942); require an explicit allow-list instead.
  if (val.NODE_ENV === 'production' && val.CORS_ORIGIN.trim() === '*') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGIN'],
      message: 'CORS_ORIGIN must be an explicit origin (e.g. https://your-domain) in production, not "*".',
    });
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('\n❌ Invalid environment configuration:\n');
  for (const [key, errs] of Object.entries(parsed.error.flatten().fieldErrors)) {
    // eslint-disable-next-line no-console
    console.error(`  ${key}:\n    ${errs.join('\n    ')}\n`);
  }
  // eslint-disable-next-line no-console
  console.error('Tip: copy sanmati/.env.example to sanmati/.env and fill in valid values.\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
