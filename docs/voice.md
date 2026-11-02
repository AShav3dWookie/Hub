# Voice commands

Say "add eggs and milk to the M&S list" into the companion app's widget and the items land on
that list; say "dentist next Tuesday at 3" and it lands in the diary as an appointment. The phone
turns speech into text; the server works out what the text means and saves it.

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
     "action": "add_to_list",
     "list": { "id": 3, "name": "M&S – Bangor" },
     "added": ["Eggs", "Milk"],
     "alreadyOnList": [],
     "parsedBy": "model",
     "message": "Added Eggs and Milk to M&S – Bangor"
   }
   ```

   On the LAN, `http://<server-ip>:8090/api/voice` works the same way. Every reply has
   `action` (which kind of thing was done), `message` and `parsedBy`; the rest is that action's
   own detail. A device only needs `message`.

## How it works: actions and rules

The server turns a command into exactly one **action**, and the action does the writing.

- **Actions are code** (`server/src/voice/`): what voice *can* do. Each one is a module with an
  input schema, checks against the real data, a call into the same services the app's own forms
  use, and its reply. Today there is one, `add_to_list`.
- **Rules are text** (`server/src/voice/rules.md`): *when and how* each action is used, in plain
  English — what counts as a shopping item, how lists are matched, list nicknames. The model
  reads them with every command. Rules only steer between actions; they can't add a new one.

So teaching voice a new way of saying something means editing the rules (and adding lines to
the phrase table in `npm run voice:check`); a new *kind* of write means a new action module.
Rules ship with a release, like code.

## What it understands

- **Which list:** by meaning, so "M&S", "marks and spencer" and "marks and sparks" all find
  *M&S – Bangor*. No list named, or "the shopping list", means the **main** list (the one marked
  *Main* on the Shopping screen). A list that doesn't exist also goes to the main list. Voice
  never creates a list.
- **Which items:** "eggs and milk" is two items; "fish and chips" is one. Quantities stay
  ("6 eggs"); filler goes ("can you add some…").
- **Items already on the list** aren't added twice; the reply says they were already there.
- **Adding only, for now.** Removing by voice may come later as another action.

### Appointments

"Dentist next Tuesday at 3", "haircut on the 14th", "MOT tomorrow at half 9" become appointments
(`create_log`), with the reply saying exactly what was saved: *Added Dentist, Tue 10 Nov 15:00*.

- **Dates** are worked out where the hub is (`NOTIFY_TIMEZONE`). The model is given today and
  the next five weeks day by day, and returns an exact date. "Friday" or "this Friday" is the
  first one coming; **"next Friday" is Friday of next week**; "the 14th" is the next 14th.
- **Times** without am/pm are daytime: "at 3" is 15:00, "at 9" is 09:00. No time said means an
  untimed appointment.
- An appointment in the past, a date that doesn't exist, or a time that isn't one is refused
  (422) and nothing is saved.
- New appointments auto-delete once they've passed, like the form's default, unless you say to
  keep it.
- Every loggable category goes through the same action, its fields taken from the category
  configuration; the rules decide which ones voice is used for.

### What it won't do

Questions ("what's on tomorrow?"), removing or changing things, and anything else no action
covers get a 422: *I can't do that by voice (answering questions).* Nothing is saved.

## The backup parser

When the model can't be reached (no key, no internet, a 10-second timeout, or an answer that
doesn't fit), a simple set of rules takes over so a shopping command is never lost. It understands
*"add X to Y"* and matches *Y* only when every word of it is in exactly one list's name. It only
takes a command that starts "add" or "put", or ends by naming a list; anything else (an
appointment) answers *I need the model for that* rather than landing on the shopping list. It
**never splits items**, so "eggs and milk" lands as a single entry *Eggs and milk*. That's why
its replies end in *(simple parser — check it)* and report `"parsedBy": "rules"`.

The server logs `[voice] model parser failed, using the rules backup: …` with the reason each
time it falls back.

## Security

- **Create only.** Through `/api/voice` a token can add list items and diary entries (an
  appointment, a log). It can't change or delete anything there.
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
changing `server/src/voice/rules.md`, an action, the prompt in `server/src/lib/voiceModel.ts`,
or `VOICE_MODEL`.

It reads `ANTHROPIC_API_KEY` from the shell or from the repo-root `.env`, the file the dev
`docker compose` also reads, so one line sets up both.

```bash
npm run voice:check
```

That runs the **phrase table**: each phrase ("eggs and milk", "fish and chips", "sains brees", a
shop name inside an item, a command with nothing to add) with the action and fields it should
come back as. It prints each answer, pass or fail, its latency, and what the run cost, and exits
non-zero if any phrase fails. It is the regression net for the rules: every rule gets lines in
it, so a rule that quietly breaks another shows up here.

Add `--server` and a device token to also send one command through a running server, which
proves the *server* has the key (`"parsedBy": "model"`):

```bash
npm run voice:check -- --server http://localhost:3000 --token hub_...
```

That really adds *Voice check* to the main list, so tick it off afterwards.
