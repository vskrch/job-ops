---
id: deploy-existing-server
title: Deploy to an Existing Server
description: Deploy JobOps to a remote Linux host that already runs other services — isolated Docker deployment, additive firewall changes, and public exposure via a Cloudflare Tunnel subdomain.
sidebar_position: 2
---

Most guides assume a fresh droplet. This one is for the opposite case: **a server you already use** (home lab, mini PC, shared box) where JobOps must coexist with running services without touching them.

## What it is

A step-by-step recipe to deploy JobOps as a single isolated Docker Compose service on an existing Debian/Ubuntu host:

- App listens on a **non-conflicting port** (example: `3005`)
- All state persists in a bind-mounted data directory (`/opt/job-ops/data`)
- Firewall changes are **additive only** (one new allow rule)
- Optional: expose the app on its own **subdomain** through an existing Cloudflare Tunnel — no open inbound ports, TLS terminated at Cloudflare's edge

## Why it exists

`deploy.sh` targets fresh Ubuntu VMs: it installs Nginx, rewrites the default site, configures swap, and assumes port 80 is free. On a box that already serves other apps, those steps are destructive. This guide replaces them with a minimal-footprint path validated on a live multi-service host.

## How to use it

Set your own values once:

```bash
export HOST_USER=admin            # SSH user on the target server
export HOST=10.0.0.73             # server address
export APP_DIR=/opt/job-ops       # install location on the server
export APP_PORT=3005              # free port on the server -> container 3001
```

### Prerequisites

- SSH key access to the server: `ssh-copy-id $HOST_USER@$HOST`
- Docker Engine + Compose v2 on the server (check: `docker compose version`)
- The server needs outbound internet for base images and dependency downloads
- Sudo on the server (directory creation, tunnel restart)

### 1) Pick a port that conflicts with nothing

List what is already listening **before** choosing:

```bash
ssh $HOST_USER@$HOST 'ss -tlnp'
```

Pick any free port (this guide uses `3005`). Do not reuse ports claimed by other services, and do not reuse ports another service "owns" in the firewall even if nothing currently listens on them.

### 2) Create the app directory

```bash
ssh $HOST_USER@$HOST "sudo mkdir -p $APP_DIR/data && sudo chown -R \$(id -u):\$(id -g) $APP_DIR"
```

The `data/` sub-directory holds the SQLite database and generated PDFs. After the first image build, fix its ownership to match the container user (JobOps runs as non-root `appuser`, usually uid 997):

```bash
ssh $HOST_USER@$HOST "sudo docker run --rm --entrypoint sh ghcr.io/dakheera47/job-ops:latest -c 'id -u appuser' && sudo chown -R 997:997 $APP_DIR/data"
```

### 3) Sync the codebase

If `rsync` is missing on the server, a tar pipe works with zero extra packages:

```bash
tar -czf - \
  --exclude='.git' --exclude='node_modules' --exclude='./data' \
  --exclude='.env' --exclude='.DS_Store' --exclude='*.log' \
  --exclude='orchestrator/dist' --exclude='docs-site/build' \
  --exclude='docs-site/.docusaurus' \
  . | ssh $HOST_USER@$HOST "tar -xzf - -C $APP_DIR"
```

### 4) Provision `.env`

Stream your local `.env` values to the server without printing secrets, then override deployment-specific keys:

```bash
{
  grep -vE '^(SESSION_SECRET|NODE_ENV|PORT|JOBOPS_PUBLIC_BASE_URL|DATA_DIR|ALLOW_NO_AUTH)=' .env
  printf '\nSESSION_SECRET=%s\nNODE_ENV=production\nPORT=3001\nALLOW_NO_AUTH=true\n' \
    "$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
} | ssh $HOST_USER@$HOST "cat > $APP_DIR/.env && chmod 600 $APP_DIR/.env"
```

Defaults applied here:

| Key | Value | Meaning |
|---|---|---|
| `PORT` | `3001` | In-container listen port (mapped to `$APP_PORT` by Compose) |
| `NODE_ENV` | `production` | Enables production hardening |
| `ALLOW_NO_AUTH` | `true` | Required acknowledgement when no auth provider is set |
| `JOBOPS_PUBLIC_BASE_URL` | *(set later)* | Public URL used for tracer links |

If `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` are present, all write actions require Basic Auth — recommended whenever the app is reachable beyond localhost.

### 5) Build and start (job-ops only)

```bash
ssh $HOST_USER@$HOST "cd $APP_DIR && sudo docker compose up -d --build job-ops"
```

Notes:

- Building on the server keeps the native architecture correct and uses your exact checkout.
- Start only the `job-ops` service. The optional `crawl4ai` sidecar stays off unless you explicitly start it.
- First build downloads Node/Python deps, Playwright Firefox, Camoufox binaries and Tectonic — expect 10–20 minutes once; subsequent builds are incremental.

### 6) Open the firewall port (additive only)

```bash
ssh $HOST_USER@$HOST "sudo ufw allow $APP_PORT/tcp comment 'job-ops'"
```

Never delete or reorder existing rules. If `ufw` is inactive, skip this step.

### 7) Verify

```bash
curl http://$HOST:$APP_PORT/health   # {"status":"ok",...}
curl http://$HOST:$APP_PORT/ready    # {"status":"ready",...}
curl -o /dev/null -w '%{http_code}\n' http://$HOST:$APP_PORT/   # 200 (dashboard)
```

Confirm neighbours are untouched: re-run their health endpoints and compare with a pre-deploy baseline.

## Expose via Cloudflare Tunnel subdomain (optional)

If the host already runs a locally-managed `cloudflared` tunnel, give JobOps its own hostname instead of opening ports to the internet.

1. **Add an ingress rule** above the catch-all in `/etc/cloudflared/config.yml`:

   ```yaml
   ingress:
     - hostname: jobs.example.com        # new
       service: http://127.0.0.1:3005    # new — points at APP_PORT
     # ...existing rules stay unchanged...
     - service: http_status:404
   ```

   Validate YAML before restarting — a malformed file takes the whole tunnel down:

   ```bash
   python3 -c "import yaml;yaml.safe_load(open('/etc/cloudflared/config.yml'))"
   ```

2. **Create the DNS record** from the server (uses the tunnel cert already in `/etc/cloudflared`):

   ```bash
   sudo cloudflared tunnel route dns <TUNNEL-UUID> jobs.example.com
   ```

3. **Restart the tunnel** — this briefly (2–5 s) interrupts *all* hostnames on that tunnel, including unrelated services:

   ```bash
   sudo systemctl restart cloudflared && systemctl is-active cloudflared
   ```

4. **Point the app at its public URL** so tracer links resolve:

   ```bash
   ssh $HOST_USER@$HOST "sudo sed -i \
     's|^JOBOPS_PUBLIC_BASE_URL=.*|JOBOPS_PUBLIC_BASE_URL=https://jobs.example.com|' \
     $APP_DIR/.env && cd $APP_DIR && sudo docker compose up -d job-ops"
   ```

Exposure model after this step: HTTPS at the edge, writes still gated by Basic Auth, **reads are public**. Put a Cloudflare Access policy in front of the hostname if reads must be private too.

## Updating to the latest code

```bash
# from your local checkout
tar -czf - --exclude='.git' --exclude='node_modules' --exclude='./data' --exclude='.env' . \
  | ssh $HOST_USER@$HOST "tar -xzf - -C $APP_DIR"
ssh $HOST_USER@$HOST "cd $APP_DIR && sudo docker compose up -d --build job-ops"
```

Migrations run automatically at container start.

## Day-2 operations cheat sheet

```bash
ssh $HOST_USER@$HOST
sudo docker logs -f job-ops                                          # tail logs (structured JSON)
sudo docker compose -f $APP_DIR/docker-compose.yml restart job-ops    # restart
sudo docker compose -f $APP_DIR/docker-compose.yml pull && \
  sudo docker compose -f $APP_DIR/docker-compose.yml up -d job-ops    # upgrade prebuilt image
cp -r $APP_DIR/data /backup/location/                                 # cold backup (stop app first)
```

## Common problems

- **`can't set distinct values on 'pids_limit' and 'deploy.resources.limits.pids'`** — newer Docker Compose treats these as aliases. Remove the top-level `pids_limit:` line from `docker-compose.yml` (the `deploy.resources` block already covers it).
- **`failed to solve: lstat /extractors/<name>: no such file or directory`** — the Dockerfile references an extractor workspace missing from your checkout. Delete the corresponding `COPY extractors/<name>` lines from the Dockerfile.
- **Docusaurus build fails with broken links during image build** — set `onBrokenLinks: "warn"` in `docs-site/docusaurus.config.ts`.
- **Bind-mount permission errors on startup** — the container runs as uid 997 (`appuser`); `chown -R 997:997 <data dir>`.
- **New hostname resolves elsewhere but not on your machine** — negative DNS caching. Verify with `dig @1.1.1.1 <hostname>` and bypass locally with `curl --resolve <hostname>:443:<edge-ip>`; caches expire within minutes.
- **Health check fails right after `up -d`** — migrations run before the server binds; wait ~15 s before probing `/health`.

## Related pages

- [Self-Hosting (Docker Compose)](/docs/next/getting-started/self-hosting)
- [Database Backups](/docs/next/getting-started/database-backups)
- [Configuration Reference](/docs/next/getting-started/self-hosting#persistent-data)
- [Troubleshooting](/docs/next/troubleshooting/common-problems)
