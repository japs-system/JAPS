# Deploying JAPS to EC2 (Amazon Linux 2023, PM2 + Nginx, no domain yet)

Architecture: a single EC2 instance runs Nginx on 80/443, which serves the
Angular production build as static files **and** reverse-proxies `/api/*` to
the Express backend, which PM2 keeps alive on `127.0.0.1:3000`. Same origin
for frontend and backend means no CORS complexity and no hardcoded
IP/domain baked into the client build.

Since Let's Encrypt only issues certs for domain names, not bare IPs, this
uses [sslip.io](https://sslip.io) — a free service that turns your Elastic
IP into a real, publicly-resolvable hostname (e.g. `3-25-100-42.sslip.io`
resolves to `3.25.100.42`), which lets certbot issue a genuine
browser-trusted cert with zero cost and no domain purchase. When you buy a
real domain later, point it at the Elastic IP and re-run `setup-ssl.sh`
with the new domain — one command, no other changes needed.

## Prerequisites

- An EC2 instance running **Amazon Linux 2023**, with an **Elastic IP**
  associated.
- Security Group inbound rules: **TCP 80**, **TCP 443**, and **TCP 22** (SSH)
  open. This is an AWS console/CLI step — not something these scripts touch.
- **Postgres reachable from this instance.** These scripts don't provision a
  database. If you plan to run Postgres on this same box, install it
  separately first (or ask for a script that adds that); if you're using a
  managed service (RDS, etc.), just have its endpoint/credentials ready.
- Your GitHub repo URL for `git clone`.

## One-time setup

SSH into the instance, then:

```bash
git clone <your-repo-url> japs   # or scp the repo over if it's private without deploy-key access set up
cd japs
sudo ./deploy/setup-ec2.sh
```

This installs Node.js 20, nginx, certbot (+nginx plugin), git, and PM2;
enables nginx; registers PM2 to relaunch on reboot; and sets up a daily
cron job for certbot renewal.

## Configure the app

```bash
cp server/.env.production.example server/.env
nano server/.env   # fill in real DB credentials, JWT_SECRET, OWNER_CREATION_SECRET, mailer settings
```

Leave `DB_SYNC_MODE` unset (defaults to `alter` — safe). See the comments in
that file for what NOT to do here (never persist `DB_SYNC_MODE=force`).

## First deploy

```bash
./deploy/deploy.sh
```

This pulls the code (already present from the clone, but keeps `deploy.sh`
idempotent for future runs), installs server + client deps, builds the
Angular client for production, and starts the backend under PM2
(`pm2 startOrReload`), then reloads nginx.

## Wire up Nginx + get a real HTTPS cert

```bash
sudo ./deploy/render-nginx-config.sh <your-elastic-ip>
sudo ./deploy/setup-ssl.sh <your-elastic-ip> <your-email>
```

The first command installs the HTTP-only Nginx config for
`<ip-with-dashes>.sslip.io`. The second gets the cert — certbot's nginx
plugin rewrites the config in place to add the HTTPS block and redirect.

After this, update `server/.env`'s `CLIENT_URL` to the printed
`https://<ip-with-dashes>.sslip.io` URL and restart the backend:

```bash
pm2 restart japs-server
```

Visit `https://<ip-with-dashes>.sslip.io` — you should see the login page
over a real, trusted HTTPS connection.

## Bootstrapping the first owner account

Same as local dev: run `tools/owner-creator/create_owner.py` — point it at
the production database (it reads `server/.env` for connection details), or
run it from your own machine with a temporary `.env` pointed at the
production DB if you'd rather not put Python/tkinter on the server.

## Subsequent deploys

```bash
./deploy/deploy.sh          # deploys the `main` branch
./deploy/deploy.sh some-branch   # or a specific branch
```

Zero-downtime for the backend (`pm2 startOrReload`); the client rebuild
briefly serves stale static files until the build finishes (Nginx doesn't
need a restart for that — it reads files fresh off disk on each request).

## Moving to a real domain later

1. Point your domain's A record at the Elastic IP.
2. `sudo ./deploy/render-nginx-config.sh <elastic-ip>` again if you want, or
   hand-edit `/etc/nginx/conf.d/japs.conf`'s `server_name` to the new domain.
3. `sudo ./deploy/setup-ssl.sh` — but pass the real domain this time instead
   of deriving one from the IP (edit the script call, or run
   `certbot --nginx -d yourdomain.com` directly).
4. Update `CLIENT_URL` in `server/.env`, `pm2 restart japs-server`.

## Files in this directory

| File | Purpose |
|---|---|
| `setup-ec2.sh` | One-time provisioning (Node, nginx, certbot, PM2). Run once as root. |
| `deploy.sh` | Repeatable deploy (git pull, build, PM2 reload). Run as ec2-user. |
| `nginx.japs.conf` | Nginx config template (HTTP-only starting point). |
| `render-nginx-config.sh` | Substitutes placeholders into `nginx.japs.conf` and installs it. Run as root. |
| `setup-ssl.sh` | Runs certbot for the sslip.io hostname. Run once as root. |
| `../server/ecosystem.config.js` | PM2 process definition for the backend. |
| `../server/.env.production.example` | Template for `server/.env` in production. |
