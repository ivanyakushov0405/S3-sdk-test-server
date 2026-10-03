module.exports = {
  apps: [
    {
      name: 'api-server',
      script: './src/server.js',
      instances: 3,
      exec_mode: 'cluster',
      watch: false,
      autorestart: true,
      max_memory_restart: '1500M',
    },
    {
      name: 'cron-jobs-worker',
      script: './src/workers/cronjobsWorker.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
    },
  ],
};