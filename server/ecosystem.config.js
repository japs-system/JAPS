// PM2 process definition for the JAPS backend.
// index.js already calls dotenv.config() itself, so PM2 doesn't need to
// inject env vars separately — it just needs `cwd` set so `server/.env` is
// found relative to the process's working directory.
module.exports = {
  apps: [
    {
      name: "japs-server",
      script: "./index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "300M",
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
