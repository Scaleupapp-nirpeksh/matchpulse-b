module.exports = {
  apps: [
    {
      name: 'matchpulse',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/ubuntu/logs/matchpulse-error.log',
      out_file: '/home/ubuntu/logs/matchpulse-out.log',
      log_file: '/home/ubuntu/logs/matchpulse-combined.log',
      time: true,
    },
  ],
};
