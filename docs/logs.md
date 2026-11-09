# The hub's log

The hub keeps its own log of what it did and why, in its database, so it survives the container
being recreated (unlike `docker logs`) and can be read from the PC without logging in to the
server. Everything in it also still goes to the container's console.

## Reading it: `npm run hub:logs`

One-time setup:

1. In the app, **Settings → Devices**: name it (e.g. *Desktop PC*), choose **Logs only: read
   from a PC**, **Add device**, and copy the token. It is shown once.
2. Put it in the repo-root `.env` (the scripts parse it; they never `source` it):

   ```bash
   HUB_LOGS_TOKEN=hub_...
   # Optional — this is the default. A LAN address such as http://192.168.1.4:8090 works too.
   HUB_URL=https://hub.aaronhanna.uk
   ```

Then, from Git Bash or WSL2:

```bash
npm run hub:logs                              # the last 24 hours, newest last
npm run hub:logs -- --source voice --since 2h # what voice commands did
npm run hub:logs -- --level warn --since 3d   # warnings and errors only
npm run hub:logs -- --json --limit 50         # raw JSON, with every field
```

| Option | Meaning |
| --- | --- |
| `--since` | `30m`, `2h`, `3d` or an ISO time. Default `24h`. |
| `--source` | `server`, `http`, `voice` or `notifications`. |
| `--level` | `info`, `warn` or `error` — that level and worse. |
| `--limit` | The newest N entries (default 200, max 5000). |
| `--json` | The raw entries instead of one line each. |

Each line is `time (UTC)  LEVEL  source  message {detail}`:

```
2026-11-05T09:14:02Z INFO  server        Started 1.5.0 (voice: model claude-haiku-5-5) {...}
2026-11-05T09:20:41Z INFO  voice         "dentist next tuesday at 3" → create_log: Added Dentist, Tue 10 Nov 15:00 {...}
2026-11-05T09:22:10Z ERROR voice         "add eggs" → refused (503): Couldn't get through to Claude… {"modelError":"401 invalid x-api-key",...}
```

## What gets logged

| Source | Entries |
| --- | --- |
| `server` | Startup: version, auth on or off, whether voice uses the model (and which) or is off for want of a key, the time zone. **The first line to check when something behaves oddly.** |
| `voice` | Every command: the words heard, the action and input chosen, the reply or the refusal, the device, how long it took. When the model failed: `modelError` (and `modelAnswer` if its answer didn't fit). A refusal is a `warn`, except a 503 (no key, or Claude unreachable), which is an `error`. |
| `http` | A 500, with its stack. A refused device token (the path only, never the token), once per 10 minutes. |
| `notifications` | Each reminder sent and to how many devices; one no device accepted (once an hour while it retries); devices the push service reported gone. |

Kept for 14 days, and at most 10,000 entries.

## The logs token

A logs token can do one thing: `GET /api/device/logs`. It can't add to a list, send a voice
command or read anything else, and the phone's token can't read the logs (each gets a 403 at
the other's door). A signed-in browser can read `/api/device/logs` too.

The endpoint sits under `/api/device` so it passes Authelia through the same nginx `location`
as the companion app (`^/api/(voice|device)(/|$)`, see [voice.md](voice.md#the-authelia-bypass))
— no proxy change. The log holds what you said to the phone, so revoke a logs token you no
longer use (Settings → Devices → Remove).

`GET /api/device/logs?since=2h&level=warn&source=voice&limit=200&format=text|json`
