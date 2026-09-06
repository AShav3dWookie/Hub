# WAN security — running Logger on the open internet

Logger is normally a trusted-LAN app with auth off. This doc covers exposing it at
`hub.aaronhanna.uk` behind a reverse proxy, and how to test the login flow first.

## Topology

```
 Browser
   │  HTTPS
   ▼
 Cloudflare            DNS, TLS to the browser, WAF, caching
   │  HTTPS (origin pull / tunnel)
   ▼
 nginx (home server)   LAN TLS, routing, OPTIONAL Authelia auth_request
   │  HTTP  + X-Forwarded-Proto: https
   ▼
 Authelia (optional)   SSO portal / 2FA — enforced at nginx, not in the app
   │
   ▼
 app container :3000   Express: its own password login + a signed session cookie
```

## Two independent auth layers — by design

- **Authelia** (optional, at nginx) gates the whole site at the edge.
- **The app's own password** (`AUTH_ENABLED=true`) gates the app itself.

They share no state. The app **does not** read Authelia's `Remote-User` / `Remote-Groups`
headers and does no SSO. Reasons:

- Defense in depth — a misconfigured `auth_request` still leaves the app password in the way.
- The app stays usable on the LAN (auth off) without standing up Authelia.
- One user, so there is no identity to map — Authelia is purely "is this person allowed in".

You authenticate twice on a fresh device (Authelia, then the app), then neither for a long time
(see *Staying logged in*).

## What the app needs to be proxy-ready

Only two things, both already wired:

| Env var | Prod value | Why |
| --- | --- | --- |
| `TRUST_PROXY` | `1` | So `X-Forwarded-Proto: https` from nginx is honoured — `req.secure` becomes true and the session cookie gets the `Secure` flag. One proxy hop = `1`. Defaults to `1` automatically when `AUTH_ENABLED=true`, so this is really just documentation. |
| `COOKIE_SECURE` | *unset* | Leave it unset. The cookie's `Secure` flag is then derived per request from `req.protocol`. Forcing `COOKIE_SECURE=true` on a request the cookie library sees as plain HTTP makes it **silently drop the cookie** — login appears to work then bounces straight back to `/login`. |

nginx must send `proxy_set_header X-Forwarded-Proto https;` — see
[`docker/nginx.prod.conf`](../docker/nginx.prod.conf) for a complete reference `server {}`,
including a commented-out Authelia `auth_request` block and Cloudflare real-IP block.

## Production `.env`

```dotenv
AUTH_ENABLED=true
AUTH_PASSWORD_HASH=$2b$12$...        # from: npm run auth:hash -- 'your password'
SESSION_SECRET=...                    # from: openssl rand -base64 48   (>= 32 chars, not a placeholder)
TRUST_PROXY=1
# COOKIE_SECURE  -> leave unset
# SESSION_MAX_AGE_DAYS=90            -> optional, this is the default
```

### The startup guard

With `AUTH_ENABLED=true` the server **refuses to boot** (before opening the port) if:

- `SESSION_SECRET` is a known placeholder (`change-me-in-production`, `dev-insecure-secret-change-me`, …), or
- `SESSION_SECRET` is shorter than 32 characters, or
- `AUTH_PASSWORD_HASH` is empty.

It also **warns** (but starts) if `TRUST_PROXY` is off or `COOKIE_SECURE=false` while auth is on.

⚠️ **Consequence:** `docker compose up` with `AUTH_ENABLED=true` and no real `SESSION_SECRET`
in `.env` will crash-loop. That is intentional — fix `.env`, don't work around it.

## Changing the password

The login password lives in the **database** (`app_settings`, key `auth.password_hash`) as soon as
you change it. `AUTH_PASSWORD_HASH` in `.env` is only the value used while no password has ever
been set — once a database value exists it always wins and the env hash is never consulted again.
Keep a valid hash in `.env` regardless: the startup guard still requires one.

**In the app:** Settings → **Password** (the section only appears when auth is on). Enter the
current password, the new one twice. Your session stays signed in. Other devices keep their
sessions until those cookies expire — changing the password does not sign them out.

**From the server** — the way back in after a forgotten password:

```bash
docker compose exec app node dist/scripts/setPassword.js 'the new password'
```

It writes the new hash straight to the database and takes effect on the **next login** — no
restart, no container rebuild. Locally against a native checkout, `npm run auth:set-password --
'the new password'` does the same thing (honours `DB_PATH`).

⚠️ `docker compose down -v` (and `npm run docker:auth:reset`) deletes the volume, so the database
— and with it the stored password — is recreated empty and the password reverts to the
`AUTH_PASSWORD_HASH` seed in the environment.

## Staying logged in

The app's session cookie is:

- **persistent** — it has an `Expires`, so it survives a browser/PWA restart;
- **sliding** — `Expires` moves forward on every day of activity;
- `HttpOnly`, `SameSite=Lax`, `Secure` (in prod), signed with `SESSION_SECRET`.

So a regular visitor re-enters the app password only after `SESSION_MAX_AGE_DAYS` (default 90)
of *not* visiting. Set Authelia's own `session` expiration / `remember_me` duration to match so
the two layers don't fall out of step.

**iOS quirk:** a site added to the Home Screen gets a *partitioned* cookie store, separate from
Safari. The installed icon may need its own one-time login even if Safari is already logged in.

## Testing the login flow locally first

`docker-compose.auth.yml` is a production-shaped rig with **auth on** and nginx in front
(`X-Forwarded-Proto: https`), so `Secure` cookies and `trust proxy` are genuinely exercised.

```bash
npm run docker:auth          # -> http://localhost:3300   (password: test-password)
npm run docker:auth:reset    # tear down + wipe when done
```

### Checklist

1. Visit `/` → redirected to `/login`; card + "Logger" heading; password field autofocused.
2. Wrong password → **"Incorrect password."** (red, announced), stays on `/login`.
3. `docker compose -f docker-compose.auth.yml stop app`, submit → **"Can't reach the server…"**
   (distinct message). `start app` again.
4. Correct password (`test-password`) → lands on `/`.
5. DevTools → Application → Cookies → `logger.sid`: **HttpOnly ✓, Secure ✓, SameSite=Lax ✓,
   Expires ≈ 90 days out ✓**; `logger.sid.sig` present.
6. Hard refresh, then close the tab and reopen `http://localhost:3300` → still logged in.
7. Incognito → open `http://localhost:3300/gallery` → redirected to `/login` → log in →
   land on **`/gallery`**, not `/`.
8. Header **"Log out"** → back to `/login`; cookie cleared; `/` redirects to `/login`.
9. `curl -i -X POST http://localhost:3300/api/auth/login -H 'content-type: application/json' -d '{"password":"test-password"}'`
   → `Set-Cookie: logger.sid=…; path=/; expires=…; samesite=lax; secure; httponly`.
10. Same `curl` with a wrong password → `401 {"error":"Invalid password"}`, no session `Set-Cookie`.
11. Settings → **Password**: a wrong current password → "Current password is incorrect."; mistyped
    confirmation → an inline error with no request sent; a valid change → "Password changed" toast,
    fields cleared, and you stay signed in.
12. Log out → `test-password` is now rejected and the new password works (the database value
    overrode the compose `AUTH_PASSWORD_HASH`, with no restart).
13. Recovery:
    `docker compose -f docker-compose.auth.yml exec app node dist/scripts/setPassword.js 'recovered-pw-456'`
    → log in with `recovered-pw-456`; the previous password is rejected.
14. `npm run docker:auth:reset && npm run docker:auth` → `test-password` works again (the volume
    was wiped, so the env seed is back in effect).

## Rollout checklist

1. `npm run auth:hash -- 'your password' | sed 's/\$/$$/g'` → `AUTH_PASSWORD_HASH`. The `$`
   doubling is required in a `.env` Compose reads — see [deployment.md](deployment.md).
2. `openssl rand -base64 48` → `SESSION_SECRET`. Fill in the prod `.env` (table above).
3. `npm run docker:auth` locally and run the checklist above.
4. Deploy the published image on the home server — `npm run release`, then
   `docker compose -f docker-compose.prod.yml pull && ... up -d`. Full instructions in
   [deployment.md](deployment.md); the server needs no checkout and builds nothing.
5. Add [`docker/nginx.prod.conf`](../docker/nginx.prod.conf)'s `server {}` to your host nginx,
   set the cert paths, confirm `proxy_pass` matches `HOST_PORT` (default 8090), `nginx -t`, reload.
6. Point Cloudflare DNS at the origin; confirm end-to-end over `https://hub.aaronhanna.uk`.
7. Optionally enable the Authelia `auth_request` block and align session durations.
