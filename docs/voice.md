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

3. **Point the device at the hub.** The companion app (#4) sends each command as:

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

- A token works for `/api/voice` **only**. It can't read your lists, and it can't create or remove
  devices; managing devices needs a signed-in browser.
- A wrong or revoked token gets a `401`, even on the LAN with auth off. A device set up wrong
  fails loudly instead of appearing to work.
- **Over the WAN**, Authelia sits in front of the app and a phone widget can't log in to it. When
  the companion app needs to reach `/api/voice` from outside, add an Authelia bypass for that one
  path, and make sure `AUTH_ENABLED=true` (the production default). The app's own token check is
  then what protects it. With auth off, a request with *no* token would also be let through.

## Checking the prompt

`server/src/lib/voiceModel.live.test.ts` runs a handful of real phrases against the real model.
It is skipped unless a key is set, so it never runs in CI:

```bash
cd server && ANTHROPIC_API_KEY=sk-ant-... npx vitest run voiceModel.live
```

Run it after changing the prompt in `voiceModel.ts` or `VOICE_MODEL`. It costs well under a penny.
