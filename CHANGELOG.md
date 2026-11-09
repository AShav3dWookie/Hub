# Changelog

Notable changes to Logger, newest first. Versions are the tags `npm run release` pushes, each of
which publishes `ghcr.io/ashav3dwookie/hub` — see [docs/deployment.md](docs/deployment.md).

## [Unreleased]

### Changed

- **Voice no longer guesses without Claude.** The backup rules parser is gone. With no
  `ANTHROPIC_API_KEY`, or when Claude can't be reached, a voice command is refused with the
  reason and nothing is saved. The backup took anything starting "add" as shopping, so
  "add an appointment for a haircut on the 24th" went on the list word for word.
- The companion app shows that reason instead of "The hub had a problem (503)", and Test
  connection says when the hub has no key. Older app versions still work and show the generic
  message.

## [1.5.0] — 2026-11-07

### Added

- **The hub keeps a log** ([docs/logs.md](docs/logs.md)) of what it did and why: each voice
  command (what it heard, whether the model or the backup rules understood it, what it saved, and
  why the model failed when it did), a startup line with the version and whether voice uses the
  model, server errors, and reminders sent. Kept 14 days, and it survives the container being
  recreated.
- **Logs-only tokens.** Settings → Devices can now make a token that reads the log and nothing
  else; the phone's token can't read it. `npm run hub:logs` prints the log on a PC with one.

### Upgrading

- A database migration adds the log table and a token type column; it runs by itself on start.
  Existing phone tokens keep working unchanged.

## [1.4.0] — 2026-11-02

### Added

- **Voice does more than shopping.** "Dentist next Tuesday at 3" adds an appointment; hang-outs and
  meals out can name the people there; "Mum's birthday is 4 March" adds an important date. The
  phone shows what was saved, with **Undo** for five minutes.
- **A time of day on appointments.** Shown on Home, in the calendar and on the entry. A timed
  appointment is reminded an hour before instead of at 9am, still with the 9pm notice the night
  before.
- **The installed app picks up a new release** when you come back to it, without being closed
  first. It waits while you're in the middle of a form.

### Changed

- Without the model, voice only takes commands that are clearly shopping ("add … to …"); anything
  else answers *I need the model for that* instead of landing on the shopping list.

## [1.3.0] — 2026-11-01

### Added

- **Shopping lists.** A main *Shopping* list plus one per shop, under a new Shopping tab. They work
  offline like everything else and sync between devices.
- **A second row in the tab bar.** Swipe up on the bar to reach Shopping, without squeezing a sixth
  tab into the first row.
- **Voice entry** ([docs/voice.md](docs/voice.md)). "Add milk and eggs to Sainsbury's" puts the
  items on the right list. Claude Haiku reads the sentence when `ANTHROPIC_API_KEY` is set, and a
  built-in rules parser takes over if it isn't or the call fails, so a command is never lost.
- **Device tokens.** Settings → Devices creates a token for a phone, which can add by voice and
  read and tick off shopping lists, and nothing else. Tokens can be revoked there too.
- **The Android companion app** ([companion-app/README.md](companion-app/README.md)). A home-screen
  mic widget for voice entry. It also has shop reminders:
  - Tag a list to a shop from the phone. Arriving there asks *Are you at …?*, and Yes shows the
    list, even with no signal.
  - Leaving a shop you said Yes to lists what's still on it, each item with *Got it* and *Still
    need*. Got it ticks the item off the hub, and waits for a connection if there isn't one.
- **Reaching it over the WAN.** The phone's two paths can skip Authelia while the rest of the site
  stays behind it. The nginx block is in [docs/voice.md](docs/voice.md).

## [1.2.0] — 2026-09-19

### Fixed

- **A lost sign-in no longer strands the app.** When a device's session ended, the app kept showing
  your data from its own saved copy while nothing actually reached the server — Settings reported
  the server as unreachable, new entries never synced, and there was no way back to the login
  screen. The app was reading its own cached "signed in" answer, so it could never notice. Logging
  out was the obvious escape, and it did nothing, because that needs the server too. An incognito
  window, having none of that saved, worked perfectly — which is what made it look like a server
  problem.
  - Any request the server turns away now returns you to the login screen, whichever part of the
    app made it, and the app remembers that across a restart.
  - **Log out always works**, whether or not the server answers, and no longer hangs on a request
    that never comes back.
  - A device already stuck fixes itself on this version — no need to clear site data, so anything
    waiting in the outbox survives.
  - Opening the app offline is unchanged: a server you simply can't reach still shows your saved
    data and does not sign you out. Only an actual refusal does.

## [1.1.0] — 2026-09-16

### Added

- **Push notifications for upcoming dates** ([docs/notifications.md](docs/notifications.md)).
  Reminders for everything the home screen's "What's on" lists — important dates, and hang-outs and
  appointments logged ahead of time:
  - 9pm the evening before ("Tomorrow"), 9am on the day ("Today"), and 9am a week before any
    important date tagged as a birthday. Everything due in one slot arrives as a single
    notification.
  - A slot missed while the server was down, or something added after it fired, still goes out —
    the evening one until midnight, the morning one until midday — and nothing is announced twice.
  - Turned on per device in Settings, with a *Send test notification* button and a plain-English
    explanation when a device can't have them (iOS needs the installed app; http needs https).
  - Delivery is outbound only, so no reverse-proxy, Cloudflare or Authelia change is needed.
  - `NOTIFY_TIMEZONE` (default `Europe/London`) times the reminders; `VAPID_SUBJECT` identifies the
    server to push services. VAPID keys are generated once into the database.

### Fixed

- A brand-new push subscription is no longer dropped when the push service briefly reports it gone —
  seen live from FCM, which can refuse a seconds-old subscription and accept the next send. A device
  is trusted for its first five minutes, and the *Send test notification* button retries once by
  itself.
- A device the server has genuinely forgotten now returns Settings to *Turn on notifications*
  instead of showing it as on.

## [1.0.0] — 2026-09-08

The first release meant for the home server.

### Added

- **Mobile-first UI overhaul.** The app is used as an installed PWA on a phone, so the unprefixed
  layout is now the phone: a five-tab bar with a sticky header, a two-pane calendar that fills the
  screen, phone-width search filters, real 44px tap targets, a type ramp one notch above stock, and
  safe-area padding for the notch and home indicator. `e2e/mobile-layout.spec.ts` enforces it.
- Post-creation editing moved behind a header pencil, so editing is deliberate.
- Photos show which album(s) they belong to, alongside their event.
- The production data directory can be a bind mount (`DATA_DIR`), so backups can target one dataset.
- CI builds and smoke-tests the Docker image.

### Fixed

- Creating a person on mobile silently discarded the entry.
- A log is re-synced when its photos change, so other devices see them.
- The Docker image shipped without a dependency npm had nested rather than hoisted.
- The production compose file works under Portainer, and fails closed rather than exposing the app.
- `qs` pinned to 6.16.0 to clear the production advisories.

## [0.1.1] — 2026-09-07

Everything up to the first tagged build: the app itself.

### Added

- **The core app.** Movies, TV, eating out, books, games, hang-outs and appointments, logged against
  deduplicated entities, with people as first-class taggable entities, freeform notes, and important
  dates that recur annually.
- **Home, search and calendar.** A home screen of what's coming up, search with filters, and a
  calendar of past and planned events.
- **Photos, albums and video.** Photo attachments with thumbnails, a paged gallery, albums, and mp4
  video with an ffmpeg-generated poster frame.
- **Offline-first PWA.** Installs to a phone, opens with no network, reads from a local replica, and
  queues writes in an outbox that syncs through a server change feed. Thumbnails are kept offline;
  Settings shows sync state, pending changes and cache size.
- **WAN security.** An optional password login with a signed, sliding session cookie, a database-backed
  password changeable from Settings or the command line, reverse-proxy awareness, and a startup guard
  that refuses to run on a placeholder secret. See [docs/wan-security.md](docs/wan-security.md).
- **Deployment.** A published image on GHCR with the version baked in and reported by `/api/health`,
  production and test compose files, and a release script.
- **The test suites.** Shared rules, server, client and a parity suite that proves the server and the
  offline client answer every read identically — plus enforced coverage thresholds and a dev container.
