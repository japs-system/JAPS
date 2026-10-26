export const environment = {
  production: true,
  // Relative — Nginx serves this build and reverse-proxies /api/* to the
  // PM2-managed backend on the same host/origin (see deploy/nginx.japs.conf).
  // Swapping the sslip.io hostname for a real domain later needs no rebuild.
  apiUrl: '',
};
