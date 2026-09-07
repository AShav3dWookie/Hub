# Deploying to the home server

The server runs a **published image**, not a checkout. CI builds it when you push a version tag,
and the server pulls it. Nothing is compiled on the server.

```
  npm run release -- minor        you, on your machine
        │  pushes tag v1.1.0
        ▼
  .github/workflows/release.yml   build + lint + test, then build the image
        │  pushes
        ▼
  ghcr.io/ashav3dwookie/hub       private package: 1.1.0, 1.1, latest
        │  docker compose pull
        ▼
  home server :8090  ◀── nginx :443 ◀── Cloudflare
```

- **Image:** `ghcr.io/ashav3dwookie/hub` (lowercase — GHCR requires it; the repo is `Hub`).
- **Package visibility:** private. Images pushed by `GITHUB_TOKEN` are private by default, so
  this needs no configuration.
- **Platform:** `linux/amd64` only.
- **Port:** `8090` on the host, from `HOST_PORT`. nginx proxies to `127.0.0.1:8090`.

## Cutting a release

From a clean `main` that is in sync with origin:

```bash
npm run release -- patch      # 1.0.0 -> 1.0.1
npm run release -- minor      # 1.0.0 -> 1.1.0
npm run release -- major      # 1.0.0 -> 2.0.0
npm run release -- 1.4.0      # explicit
```

It bumps all four `package.json` files plus `package-lock.json` to the same version, commits
`Release vX.Y.Z`, tags, and pushes. The tag is what triggers the build — it refuses to run from a
branch other than `main`, from a dirty tree, or when out of sync with origin.

The version is baked into the image: it shows on **Settings → App → Version** and comes back from
`GET /api/health`, so you can always tell what is actually running.

## One-time server setup

**1. A pull token.** GitHub → Settings → Developer settings → Personal access tokens → **Tokens
(classic)** → Generate new token, scope **`read:packages`** only. Classic, not fine-grained —
fine-grained tokens have never worked reliably for user-owned GHCR packages.

```bash
echo 'ghp_xxxxxxxxxxxx' | docker login ghcr.io -u AShav3dWookie --password-stdin
```

This writes `~/.docker/config.json` **for the user that runs it**. If a systemd unit runs compose
as root, log in as root too, or the pull fails there.

> **On TrueNAS SCALE**, anything outside `/mnt` is reset by a version upgrade, so `/root/.docker`
> may not survive one. Either re-run `docker login` after an upgrade, or set
> `DOCKER_CONFIG=/mnt/<pool>/apps/hub/.docker` before logging in — and then for every
> `docker compose` call too. Don't put the token in a shell profile, and don't automate the login
> via TrueNAS Init/Shutdown Scripts: those are stored in the config database, which ends up in
> config backups.

**2. Files.** Copy `docker-compose.prod.yml` and `.env.prod.example` to a directory on the server
(e.g. `/srv/hub`), then:

```bash
cp .env.prod.example .env
```

**3. Fill in `.env`.**

```bash
openssl rand -base64 48                               # -> SESSION_SECRET
npm run auth:hash -- 'your password' | sed 's/\$/$$/g'  # -> AUTH_PASSWORD_HASH
```

> ⚠️ **Every `$` in `AUTH_PASSWORD_HASH` must be doubled.** Compose interpolates `.env`, so a raw
> `$2b$12$iZOtv…` has `$iZOtv…` treated as an undefined variable and the salt is silently deleted.
> The app starts perfectly and every login fails with nothing in the logs. The `sed` above does
> the escaping; `SESSION_SECRET` from `openssl rand -base64` never contains `$`, so it is fine raw.

Set `IMAGE_TAG` to the version you just released. Check the port is free:
`ss -ltnp | grep ':8090'`.

## Deploy

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl -s localhost:8090/api/health      # {"status":"ok","version":"1.1.0"}
```

Then verify the hash survived — this must show **single** dollars:

```bash
docker exec hub-app-1 printenv AUTH_PASSWORD_HASH
```

## Deploying through Portainer instead

Paste `docker-compose.prod.yml` into **Stacks → Add stack → Web editor** and set the same
variables in the stack's **Environment variables** fields rather than a `.env` file. The compose
file uses `${VAR}` substitution precisely so both routes work.

- **Registry auth:** Portainer → **Settings → Registries → Add registry → Custom registry**, URL
  `ghcr.io`, username `AShav3dWookie`, password the PAT. Portainer keeps it in its own database on
  a pool, so a TrueNAS upgrade doesn't lose it. Portainer CE has historically been inconsistent
  about applying registry credentials to *compose stacks*; if the pull fails `unauthorized`, also
  do the host `docker login` above.
- **`AUTH_PASSWORD_HASH` still needs `$$`.** Portainer's variables feed compose substitution just
  like a `.env` file does, so the escaping rule is identical.
- **Upgrading** is *Pull and redeploy*, after changing `IMAGE_TAG` in the stack's variables.

Whichever route you use, verify with `docker exec hub-app-1 printenv AUTH_PASSWORD_HASH` (single
dollars) and `curl -s localhost:8090/api/health` (the version you expect).

> **Fail-closed by design:** with no configuration at all, `AUTH_ENABLED` defaults to `true` and
> `SESSION_SECRET` to the placeholder, which the startup guard rejects — so a misconfigured stack
> crash-loops with a clear error rather than serving the app with no password.

## Upgrade

Set the new `IMAGE_TAG` in `.env` (or the stack's variables), then the same two commands.
`curl /api/health` confirms the new version is live.

## Rollback

Set `IMAGE_TAG` to the previous version and run the same two commands. The old image is still in
the registry and probably still in the local Docker cache, so this takes seconds.

## Data

The SQLite database and the uploaded photos both live at `/app/data` in the container. Where that
is on the host depends on `DATA_DIR`:

- **`DATA_DIR` set to an absolute path** → a bind mount. **Prefer this if you back the server up.**
  Point it at its own dataset (`/mnt/<pool>/apps/hub/data`) and snapshots, replication and
  cloud-sync tasks can target exactly this app's data. It is also just a normal directory, so
  seeding and restoring are file copies.
- **`DATA_DIR` unset** → the named volume `hub-data`, which lives under the Docker root. Fine, but
  backing it up means either reaching into Docker's internals or capturing the whole Docker root
  alongside every image layer.

Either way the data is untouched by `pull` and `up -d`; only an explicit `down -v` removes a named
volume, and nothing in the deploy flow removes a bind-mounted directory.

> **SQLite runs in WAL mode**, so `logger.db`, `logger.db-wal` and `logger.db-shm` are one unit and
> must be captured at the same instant. A **ZFS snapshot is atomic and safe** — restoring from one
> looks like a power cut, which SQLite recovers from cleanly. A plain `rsync`/cloud-sync of a live
> database is **not** atomic and can copy the db and its WAL from different moments. If you sync
> rather than snapshot, sync *from* a snapshot (`.zfs/snapshot/…`), or stop the container first.
>
> (The `SQLITE_IOERR_SHMOPEN` warning in CLAUDE.md is about Docker Desktop's Windows↔Linux
> filesystem shim. A native Linux bind mount onto ZFS is not affected.)

**Seed it from an existing database:**

```bash
docker compose -f docker-compose.prod.yml stop app
docker run --rm -v hub-data:/data -v "$PWD":/backup alpine \
  sh -c 'cp /backup/logger.db* /data/ && cp -r /backup/photos /data/ 2>/dev/null || true'
docker compose -f docker-compose.prod.yml start app
```

Copy the `-wal` and `-shm` files too (the glob above does), or checkpoint the database first.

**Back it up** — the same thing in reverse:

```bash
docker run --rm -v hub-data:/data -v "$PWD":/backup alpine \
  sh -c 'cp -r /data/. /backup/hub-backup/'
```

## The network path

Cloudflare terminates TLS for `hub.aaronhanna.uk` and forwards to your nginx, which proxies to
`127.0.0.1:8090`. Cloudflare never talks to the app directly, so the app's port is purely an
nginx-to-app detail. See [`docker/nginx.prod.conf`](../docker/nginx.prod.conf) for the vhost and
[wan-security.md](wan-security.md) for the auth layers.

> **The published port bypasses nginx.** `http://<lan-ip>:8090` reaches the app directly, so it
> also bypasses Authelia. The app's own password (`AUTH_ENABLED=true`) is the only thing guarding
> that path — which is why it defaults to on here. To close it entirely, allow 8090 only from
> localhost with a firewall rule; nginx will still reach it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Workflow fails pushing the image, `403 denied` | Repo → Settings → Actions → General → Workflow permissions is read-only. The job declares `packages: write`, but that setting can still block it. |
| `docker compose pull` → `unauthorized` | Not logged in, or logged in as a different user than the one running compose. Re-run `docker login ghcr.io`. Also check the PAT has not expired. |
| Login always fails, no errors in the logs | `AUTH_PASSWORD_HASH` lost its `$`. Run the `printenv` check above. |
| Container restarts in a loop, `SESSION_SECRET` in the logs | The startup guard, working as intended — set a real secret. |
| Release build fails at `npm ci` with a lockfile error | `package-lock.json` is out of step with the `package.json` files. `npm install`, commit, re-tag. |
| Settings shows `dev` after a deploy | Running an image built outside the release workflow. |
