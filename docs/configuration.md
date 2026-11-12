# Configuration

Every setting the hub reads, in one place. The hub takes them from its environment; it never
reads a `.env` file itself. Compose fills them in from the `.env` next to the compose file you run:

| Running | Settings come from | Example file |
| --- | --- | --- |
| The home server (`deploy/compose.yml`) | `.env` beside it on the server, or Portainer's stack variables | [`deploy/.env.example`](../deploy/.env.example) |
| Dev container (`docker compose up` at the repo root) | the repo-root `.env` | [`.env.example`](../.env.example) |
| `npm run dev:server` | your shell, e.g. `DB_PATH=./test-env/logger.db npm run dev:server` | none |

The repo-root `.env` also holds settings for the repo's own scripts (companion app, `hub:logs`,
`voice:check`). Those are listed in [`.env.example`](../.env.example), not here.

> ⚠️ **Compose interpolates every `.env` it reads**, so a `$` must be written `$$`. That matters for
> `AUTH_PASSWORD_HASH`, which is full of them: a raw bcrypt hash loses its salt, the app starts
> fine, and every login fails with nothing in the logs.
> `npm run auth:hash -- 'pw' | sed 's/\$/$$/g'` prints the escaped form.

## Server and storage

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port the app listens on inside its container. The compose files map a host port to it: `PORT` in the dev `.env`, `HOST_PORT` on the server. |
| `DB_PATH` | `./data/logger.db` | The SQLite file. Every compose file sets it to `/app/data/logger.db`, the mounted data folder. |
| `PHOTOS_DIR` | `<folder of DB_PATH>/photos` | Uploaded photos, videos and their thumbnails. The default keeps them on the database's volume, so one mount covers both. |
| `FFMPEG_PATH` | `ffmpeg` | Decodes a poster frame from uploaded videos. Without it, uploads still work but get a placeholder poster. The image installs it. |
| `NODE_ENV` | `development` | The compose files for the server and the rigs set `production`. |

## Login

See [wan-security.md](wan-security.md) for the whole picture.

| Variable | Default | What it does |
| --- | --- | --- |
| `AUTH_ENABLED` | `false` (`true` in `deploy/compose.yml`) | Require a password. Off is for a trusted LAN only. |
| `AUTH_PASSWORD_HASH` | — | bcrypt hash of the password, from `npm run auth:hash -- 'pw'`. Required when auth is on, and only a **first-run** value: once the password is changed in Settings or with `auth:set-password`, the database's copy wins. Keep a valid hash here anyway, because the server refuses to start without one. |
| `SESSION_SECRET` | a dev placeholder | Signs the session cookie. With auth on, the server refuses to start on a known placeholder or anything under 32 characters. `openssl rand -base64 48`. |
| `TRUST_PROXY` | `1` with auth on, otherwise off | How Express treats `X-Forwarded-*`. `1` means one reverse proxy (nginx) in front, so `X-Forwarded-Proto` is honoured and the cookie is marked `Secure`. |
| `COOKIE_SECURE` | unset | **Leave it unset.** The `Secure` flag is then worked out per request, which is right for both plain-HTTP LAN use and HTTPS through the proxy. Forcing `true` on a request seen as HTTP makes the cookie silently vanish. |
| `SESSION_MAX_AGE_DAYS` | `90` | How long you can be away before logging in again. The expiry slides forward as you use the app. |

## Notifications

See [notifications.md](notifications.md).

| Variable | Default | What it does |
| --- | --- | --- |
| `NOTIFY_TIMEZONE` | `Europe/London` | The IANA zone reminders are timed in (9pm the day before, 9am on the day). Follows BST/GMT by itself. The server refuses to start on a zone it doesn't recognise. |
| `VAPID_SUBJECT` | `https://hub.aaronhanna.uk` | How push services can contact this server: a `mailto:` address or an `https://` URL. |

## Voice

See [voice.md](voice.md).

| Variable | Default | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Lets the hub understand voice commands. Without it, every voice command is refused and the startup line in the hub's log says `voice: off`. |
| `VOICE_MODEL` | `claude-haiku-5-5` | The model voice asks, so a newer one needs no release. |
| `ANTHROPIC_BASE_URL` | the real API | For tests only: the e2e and contract suites point it at `scripts/fakeVoiceModel.mjs`. |

## Set by the image

`APP_VERSION` is baked in when the image is built from a release tag and returned by
`GET /api/health`. Don't set it yourself.
