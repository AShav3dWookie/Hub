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

## Rollout checklist

1. `npm run auth:hash -- 'your password'` → `AUTH_PASSWORD_HASH`.
2. `openssl rand -base64 48` → `SESSION_SECRET`. Fill in the prod `.env` (table above).
3. `npm run docker:auth` locally and run the checklist above.
4. `docker compose up -d --build` on the home server with the real `.env`.
5. Add [`docker/nginx.prod.conf`](../docker/nginx.prod.conf)'s `server {}` to your host nginx,
   set the cert paths and `proxy_pass` target, `nginx -t`, reload.
6. Point Cloudflare DNS at the origin; confirm end-to-end over `https://hub.aaronhanna.uk`.
7. Optionally enable the Authelia `auth_request` block and align session durations.
