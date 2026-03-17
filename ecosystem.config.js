module.exports = {
  apps: [{
    name: 'flowbars',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      ADMIN_IP: '176.74.94.221',
      JWT_SECRET: 'CHANGE-THIS-SECRET-IN-PRODUCTION-USE-LONG-RANDOM-STRING'
    }
  }]
};
