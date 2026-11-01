# Voice commands

Say "add eggs and milk to the M&S list" into the companion app's widget and the items land on
that list. The phone turns speech into text; the server works out what the text means and adds
the items.

```
 phone ── "add eggs and milk to marks and spencer" ──▶ POST /api/voice
                                                        │
                        Claude Haiku: which list? which items?  (or the rules backup)
                                                        │
          ◀── "Added Eggs and Milk to M&S – Bangor" ────┘  items on the list, synced as usual
```

## Setting it up

1. **Give the server an API key.** Create one at <https://console.anthropic.com>, then put it in
   the `.env` next to `docker-compose.prod.yml` and recreate the container:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   Each command costs a tiny fraction of a penny; ten a day is pennies a month. Without a key,
   voice still works using the backup parser described below.

2. **Create a token for the device.** Settings → **Devices** → name it (e.g. *Pixel 6*) → *Add
   device*. Copy the token into the companion app straight away: it is shown once, and the server
   keeps only a hash of it. A lost token can't be recovered. Remove the device and add it again.

3. **Pair the device.** For the Android companion app, [companion-app/README.md](../companion-app/README.md)
   walks through installing it, pairing and adding the widget. Under the hood each command is:

   ```bash
   curl -X POST https://hub.aaronhanna.uk/api/voice \
     -H "Authorization: Bearer hub_..." \
     -H "Content-Type: application/json" \
     -d '{"text": "add eggs and milk to the M&S list"}'
   ```

   ```json
   {
     "action": "add",
     "list": { "id": 3, "name": "M&S – Bangor" },
     "added": ["Eggs", "Milk"],
     "alreadyOnList": [],
     "parsedBy": "model",
     "message": "Added Eggs and Milk to M&S – Bangor"
   }
   ```

   On the LAN, `http://<server-ip>:8090/api/voice` works the same way.

## What it understands

- **Which list:** by meaning, so "M&S", "marks and spencer" and "marks and sparks" all find
  *M&S – Bangor*. No list named, or "the shopping list", means the **main** list (the one marked
  *Main* on the Shopping screen). A list that doesn't exist also goes to the main list. Voice
  never creates a list.
- **Which items:** "eggs and milk" is two items; "fish and chips" is one. Quantities stay
  ("6 eggs"); filler goes ("can you add some…").
- **Items already on the list** aren't added twice; the reply says they were already there.
- **Adding only, for now.** Removing by voice may come later; the reply's `action` field is
  there so it can.

## The backup parser

When the model can't be reached (no key, no internet, a 10-second timeout, or an answer that
doesn't fit), a simple set of rules takes over so a command is never lost. It understands
*"add X to Y"* and matches *Y* only when every word of it is in exactly one list's name. It
**never splits items**, so "eggs and milk" lands as a single entry *Eggs and milk*. That's why
its replies end in *(simple parser — check it)* and report `"parsedBy": "rules"`.

The server logs `[voice] model parser failed, using the rules backup: …` with the reason each
time it falls back.

## Security

- A token works for `/api/voice` and `/api/device` **only**. The second is the companion app's:
  it reads the shopping lists (names, items, shop locations), tags or clears a list's shop, and
  ticks items off when you tap Got it after leaving a shop.
  A token can't reach anything else — logs, people, photos, settings — and it can't create or
  remove devices; managing devices needs a signed-in browser.
- A wrong or revoked token gets a `401`, even on the LAN with auth off. A device set up wrong
  fails loudly instead of appearing to work.
- **Over the WAN**, Authelia sits in front of the app and a phone widget can't log in to it. When
  the companion app needs to reach the hub from outside, add an Authelia bypass for those two
  paths (`/api/voice` and `/api/device`), and make sure `AUTH_ENABLED=true` (the production default). The app's own token check is
  then what protects it. With auth off, a request with *no* token would also be let through.

### The Authelia bypass

A `location` beside the site's `location /`, without its `auth_request`. nginx checks a regex
location before `location /`, so these two paths skip Authelia and nothing else does
(`docker/nginx.prod.conf` has it too):

```nginx
location ~ ^/api/(voice|device)(/|$) {
    proxy_pass http://192.168.1.3:8090;   # the same upstream as location /
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Connection "";
}
```

Use `(/|$)`, not a prefix: `location /api/device` would also match `/api/device-tokens`, which
creates tokens and must stay behind Authelia.

To check it, from anywhere:

```bash
curl -si https://hub.aaronhanna.uk/api/voice/status | head -1   # 401 from the hub: bypassed
curl -si https://hub.aaronhanna.uk/api/device-tokens | head -1  # 302 to auth.aaronhanna.uk: still gated
```

A `302` on the first means the new location isn't being used. A Cloudflare challenge page means
Cloudflare's bot protection is stopping non-browser requests and needs a skip rule for the same
paths.

## Checking it works: `npm run voice:check`

A manual check against the real model. It costs money (well under a penny a run), so it is
**not** a test: nothing in `npm test`, coverage or CI runs it. Run it after setting up a key,
changing the prompt in `server/src/lib/voiceModel.ts`, or changing `VOICE_MODEL`.

It reads `ANTHROPIC_API_KEY` from the shell or from the repo-root `.env`, the file the dev
`docker compose` also reads, so one line sets up both.

```bash
npm run voice:check
```

That sends about a dozen phrases ("eggs and milk", "fish and chips", "sains brees", a shop name
inside an item, a command with nothing to add) and prints each answer, pass or fail, its
latency, and what the run cost. It exits non-zero if any phrase fails.

Add `--server` and a device token to also send one command through a running server, which
proves the *server* has the key (`"parsedBy": "model"`):

```bash
npm run voice:check -- --server http://localhost:3000 --token hub_...
```

That really adds *Voice check* to the main list, so tick it off afterwards.
