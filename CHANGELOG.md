# Changelog

Notable changes to Logger, newest first. Versions are the tags `npm run release` pushes, each of
which publishes `ghcr.io/ashav3dwookie/hub` — see [docs/deployment.md](docs/deployment.md).

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
