/**
 * PM2 Ecosystem — Clawdia Broker Daemon
 *
 * Usage:
 *   pm2 start ecosystem.config.js           # Start production daemon
 *   pm2 restart clawdia-broker              # Restart after code change
 *   pm2 logs clawdia-broker                 # Follow logs
 *   pm2 monit                               # Resource monitor
 */

module.exports = {
  apps: [
    {
      name: "clawdia-broker",
      // Run the compiled daemon via node. Build first: pnpm build
      script: "packages/orchestrator/dist/daemon.js",
      cwd: "/root/clawdia-framework",
      user: "clawdia",

      // PM2 runtime options
      interpreter: "node",
      interpreter_args: "--enable-source-maps",

      // Environment
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        API_PORT: "3001",
        LOG_DIR: "/var/log/clawdia",
      },
      env_development: {
        NODE_ENV: "development",
        PORT: "3000",
        API_PORT: "3001",
        LOG_DIR: "/var/log/clawdia",
      },

      // Resource limits
      max_memory_restart: "512M",

      // Restart policy
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "30s",
      exp_backoff_restart_delay: 100,

      // Logging
      log_file: "/var/log/clawdia/pm2.log",
      error_file: "/var/log/clawdia/pm2-error.log",
      out_file: "/var/log/clawdia/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss UTC",

      // Watch & reload (disabled in production — use pm2 restart instead)
      watch: false,

      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: false,
      listen_timeout: 15000,

      // Source maps for better stack traces
      source_map_support: true,
    },
  ],
};
