module.exports = {
  apps: [
    {
      name:        'payroll-bridge',
      script:      'server.js',
      cwd:         __dirname,

      // Restart policy
      autorestart:  true,
      watch:        false,
      max_restarts: 10,
      restart_delay: 5000,   // wait 5 s between restarts

      // Log files (relative to cwd)
      out_file:   './logs/out.log',
      error_file: './logs/err.log',
      merge_logs:  true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Cap log file size so they don't grow unbounded
      max_size:    '10M',

      // Keep the bridge running on system boot
      // (run `pm2 startup` once, then `pm2 save` to persist)
      instance_var: 'INSTANCE_ID',

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
