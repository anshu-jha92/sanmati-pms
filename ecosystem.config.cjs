// PM2 process config for the Sanmati PMS backend.
// The backend serves the API and (with WORKERS_INLINE=true, the default) also
// runs the background workers in the same process, so ONE app covers everything.
//
// Deploy on the server:
//   cd /path/to/sanmati-ready
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup     # persist across reboots
//
// Env comes from sanmati/.env (loaded by src/config/env.js). Logs go to logs/.
module.exports = {
  apps: [
    {
      name: 'sanmati-api',
      script: 'sanmati/src/server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' },
      out_file: 'logs/sanmati-api.out.log',
      error_file: 'logs/sanmati-api.err.log',
      time: true,
    },

    // OPTIONAL — run workers in their own process instead of inline (for scale):
    //   1. set WORKERS_INLINE=false in sanmati/.env
    //   2. uncomment this block and `pm2 restart ecosystem.config.cjs`
    // {
    //   name: 'sanmati-worker',
    //   script: 'sanmati/src/workers/index.js',
    //   cwd: __dirname,
    //   exec_mode: 'fork',
    //   instances: 1,
    //   autorestart: true,
    //   max_restarts: 10,
    //   restart_delay: 3000,
    //   env: { NODE_ENV: 'production' },
    //   time: true,
    // },
  ],
};
