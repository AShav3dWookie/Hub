# Hub companion app (Android)

A home-screen mic for the hub: tap it, say *"add eggs and milk to the M&S list"*, and the items
land on that shopping list. The phone does the listening (Android's own speech prompt), the hub
works out what you meant ([`docs/voice.md`](../docs/voice.md)), and a one-line answer pops up:
*"Added Eggs and Milk to M&S – Bangor"*. Say *"dentist next Tuesday at 3"* and it goes in the
diary instead, with a notification saying exactly what was saved: *"Added Dentist, Tue 10 Nov
15:00"*. Android 12 or later (a Pixel 6 is fine).

It also knows where your shops are. Tag a list's shop while standing in it, and after a minute
there the phone asks *"Are you at M&S – Bangor?"* — tap **Yes** and the list appears in the
notification, even with no signal inside. Walk out with things still on it and it asks what you
got, with **Got it** for each ([Shops](#shops)).

Everything below is a single command, run from the repo root in **Git Bash or WSL2**. Each
reads its settings from environment variables, and falls back to the repo-root `.env` for any
that aren't set — so the usual way is to put them in `.env` once.

## Commands

| Command | Does |
| --- | --- |
| `npm run companion:keygen` | Creates the release signing key, once |
| `npm run companion:install` | Builds the signed APK and installs it on the phone (also updates it) |
| `npm run companion:pair` | Creates a device token on the hub and sends it to the app; tap **Pair** on the phone |
| `npm run companion:arrive -- "<list>"` | Fakes the phone's GPS into that list's shop, to try *"Are you at …?"* at home |
| `npm run companion:leave -- "<list>"` | Fakes it out of that shop again, to try the leave reminder |
| `npm run companion:secrets` | Gives GitHub Actions the signing key, so releases attach the APK |
| `npm run companion:build` | Just builds the APK into `companion-app/dist/` |
| `npm run companion:test` | Unit and Robolectric tests (the real screens and widget code, on the JVM), then the release build's lint checks |
| `npm run companion:contract` | The app's API client against a hub container built from this repo |

The first command to run builds the build container (JDK, Android SDK, Gradle; a couple of GB,
once). Nothing Android is installed on your machine. Two host tools are needed: **Docker**, and
**adb** (Android platform-tools) on the PATH for `install`, `pair`, `arrive` and `leave` — a
container can't reach the phone over USB on Docker Desktop. `arrive` and `leave` also use
**node**, which the repo needs anyway.

## Settings

| Variable | Used by | Default |
| --- | --- | --- |
| `COMPANION_KEYSTORE_PASSWORD` | keygen, install, build, secrets | — required for a signed APK; at least 6 characters |
| `COMPANION_KEYSTORE` | keygen, install, build, secrets | `~/.hub-companion/release.jks` |
| `COMPANION_KEY_ALIAS` | keygen, install, build, secrets | `hub-companion` |
| `COMPANION_KEY_PASSWORD` | keygen, install, build, secrets | same as `COMPANION_KEYSTORE_PASSWORD` |
| `COMPANION_HUB_URL` | pair, arrive, leave | — required: the hub address **the phone** will use, e.g. `http://192.168.1.4:3000` |
| `COMPANION_HUB_PASSWORD` | pair, arrive, leave | — only if the hub has auth on |
| `COMPANION_DEVICE_NAME` | pair | the phone's model, e.g. *Pixel 6* |
| `COMPANION_ADB_DEVICE` | install, pair, arrive, leave | — the `ip:port` from Wireless debugging, if not using USB |
| `COMPANION_ADB_PAIR`, `COMPANION_ADB_PAIR_CODE` | install | — first-time wireless pairing only (see below) |
| `COMPANION_ARRIVE_SECONDS` | arrive, leave | `120` for arrive, `60` for leave — how long the fake position is kept up |

A typical `.env` (it's gitignored):

```bash
COMPANION_KEYSTORE_PASSWORD=choose-something-long
COMPANION_HUB_URL=http://192.168.1.4:3000
```

**Back up the key file and its password together.** Every release must be signed with the same
key, or Android refuses the update and you'd have to uninstall and pair again. `keygen` refuses
to overwrite an existing key for that reason. If you use both Git Bash and WSL2, point
`COMPANION_KEYSTORE` at the same file from both (their `~` differ).

## Getting it onto the phone

`companion:install` uses adb, which reaches the phone one of two ways. Either way, the phone
needs **Developer options** once: Settings → About phone → tap *Build number* seven times.

- **USB:** Settings → System → Developer options → **USB debugging** on, plug the phone in,
  accept the "Allow USB debugging?" prompt, then `npm run companion:install`.
- **Wireless:** Developer options → **Wireless debugging** on (same Wi-Fi as this machine).
  The first time, tap *Pair device with pairing code* and pass what it shows:

  ```bash
  COMPANION_ADB_PAIR=192.168.1.50:37123 COMPANION_ADB_PAIR_CODE=482913 \
    COMPANION_ADB_DEVICE=192.168.1.50:41235 npm run companion:install
  ```

  `COMPANION_ADB_DEVICE` is the *IP address & Port* at the top of the Wireless debugging screen.
  After the first time only that is needed — it can live in `.env`, though the port changes
  whenever wireless debugging is switched off and on.

Updating is the same command: it installs over the top and keeps the pairing.

## Pairing it with the hub

`npm run companion:pair` creates a device in the hub's **Settings → Devices** (named after the
phone), then opens the app with a pairing link. The app shows **Pair with this hub?** and the
address — it never applies a link without asking, since any app could send one. Tap **Pair**:
it saves and runs **Test connection**, which should say *Connected as "Pixel 6". Voice commands
will be understood by Claude.*

- *…use the simple backup…* — the hub has no `ANTHROPIC_API_KEY` ([`docs/voice.md`](../docs/voice.md)).
- *Couldn't reach the hub* — the phone can't get to `COMPANION_HUB_URL`: check it's on the same
  Wi-Fi, and that the address is this PC's LAN IP. `ipconfig` (Git Bash) or `ipconfig.exe`
  (WSL2) shows it under the Wi-Fi or Ethernet adapter. A VPN on the PC can block LAN access.

Pairing by hand works too: the app's screen takes the address and a token from the hub's
Settings → Devices. A yellow warning under the address means plain `http://` outside the home
network, where the token would travel unencrypted.

## Adding the widget

On the phone: long-press the home screen → **Widgets** → **Hub** → drag **Hub voice** out. Tap
it, wait for *"What do you need?"*, and speak. Shopping answers with a toast; anything else
answers with a notification (channel *Voice replies*) showing what was saved and what it heard,
with **Undo** for five minutes (queued like Got it if there's no signal), or a toast if
notifications are off. The notification goes by itself after those five minutes. The app needs no microphone permission — it's
the phone's own speech prompt that listens.

## Shops

Open the app → **Shops**. Each shopping list has **Tag here**: standing in the shop, tap it and
the phone's current position becomes that list's shop, at a 75 m radius. The hub keeps the tag
— its web app shows *Tagged to a shop* on the list, and is where the radius is changed (25–1000
m) or the tag cleared. **Clear** here does the same. A fix vaguer than 100 m isn't used; the
screen asks you to try again, nearer a door or window.

After **a minute** inside a tagged shop the phone asks *"Are you at …?"*. **Yes** swaps the
question for the list's items (the first six, then *+ N more*); tapping that opens the list in
the hub. (On Android 17 the browser needs its own *local network* permission to open a hub at a
LAN address — Settings → Apps → Firefox/Chrome → Permissions. The https address doesn't.) **No** just clears it — a false alarm, remembered so the leave reminder stays quiet.
It stays quiet for an empty list, and asks at most **once an hour** per shop, so GPS wobbling at
the edge can't nag.

**Leaving** a shop you said **Yes** to, with things still on its list, brings *"You left …"*:

- **Five things or fewer:** one notification each, grouped under that heading. **Got it** takes
  the item off the list on the hub; **Still need** just dismisses it.
- **More than five:** one notification. Tapping it opens a screen with a tick per item and
  **Done**: what's ticked comes off, the rest stays.

There's no reminder after **No**, or if the question was never answered, or once the visit
has already reminded (walking back past the door doesn't repeat it), or if you left more than
three hours after arriving. Anything ticked off in the hub's web app while you were in the shop
isn't listed, if the phone can reach the hub as you leave.

**Got it works with no signal.** The item comes off the app's copy at once, and the hub is told
as soon as it can be reached: Android retries in the background, and every refresh sends
anything still waiting first. Until the hub is on the internet that means once you're home.

- **No signal in the shop is fine.** The app keeps a copy of every list, refreshed each time it
  can reach the hub (opening Shops, an arrival, a Yes); the notification falls back to it.
- **Permissions:** precise location **all the time** (to notice a shop with the app closed) and
  notifications. `companion:install` grants them; otherwise Shops shows what's missing, one at a
  time, with a button for each. Android's own geofencing does the watching, so the battery cost
  is small.
- **After a reboot** the shops are watched again by themselves.
- A shop tagged or changed in the hub's web app reaches the phone the next time it refreshes —
  open Shops once to be sure.

### Trying it at home: `npm run companion:arrive` and `companion:leave`

```bash
npm run companion:arrive -- "Sainsbury's"
```

Looks the list up on the hub (`COMPANION_HUB_URL`, as for `pair`), tells the phone it's standing
in that shop, then has the app watch the shop afresh: it clears the tag on the hub and puts it
back exactly, opening Shops after each. The question should appear about a minute later. Real
GPS and the tag are both put back when it ends, Ctrl-C included. The list must be tagged and
have something on it, and a shop that asked within the last hour stays quiet — that's the
cooldown, not a fault.

Why the clear-and-restore: on a Pixel 6, Play Services reliably reacts to a faked position
inside a geofence it has just been given, but not to a faked walk out and back in of one it
already has (the phone lying still on a desk doesn't help). Real movement doesn't have that
problem, so a genuine arrival is tested by walking into a real shop — that works today, even
before the hub is reachable over the internet, since the question and list come from the
app's saved copy.

```bash
npm run companion:leave -- "Sainsbury's"
```

Does the same from 500 m beyond the shop's edge, so the re-added shop reports the phone has
left. Arrive first and tap **Yes**; *"You left …"* should then appear within a minute. Nothing
appears after a **No**, or if this visit has already reminded.

## Checking it on the phone

The automated tests run the app's code on a computer; these are the bits only a phone shows.
Worth a run after installing and after updates:

- [ ] **Test connection** shows *Connected as "…"* with the right parser.
- [ ] The widget's mic opens the speech prompt, and *"add eggs"* pops up *Added Eggs to Shopping*.
- [ ] The item is on the list in the hub app (Shopping tab) after it syncs.
- [ ] *"add bread to the M&S list"* lands on that list, not the main one.
- [ ] Backing out of the speech prompt adds nothing and shows nothing.
- [ ] Off the home Wi-Fi, a command says *Couldn't reach the hub*.
- [ ] Removing the device in the hub's Settings → Devices, then using the widget, says the token
      wasn't accepted.
- [ ] **Shops** lists the hub's lists; **Tag here** on one shows *Tagged · 75 m*, and the hub's
      web app shows it tagged too.
- [ ] `companion:arrive` on that list: *"Are you at …?"* appears with **Yes** and **No**.
- [ ] **Yes** shows the items; tapping them opens the list in the hub.
- [ ] Another `companion:arrive` within the hour shows nothing.
- [ ] After a restart of the phone, an arrival (once the hour's up) still asks.
- [ ] `companion:leave` after a **Yes**: *"You left …"* lists each item with **Got it** and
      **Still need**; Got it takes the item off the hub's list.
- [ ] With more than five items, the one notification opens the tick screen, and **Done** takes
      off just what was ticked.
- [ ] With Wi-Fi and data off, Got it still clears the item; it goes from the hub's list once
      the phone is back on the home Wi-Fi.
- [ ] In a real shop, after a minute: the question appears.
- [ ] Walking out of a real shop after a **Yes**: the leave reminder appears.

## Releases

`npm run release -- patch` tags a version; the release workflow then builds the signed APK in
the same container and attaches it to that GitHub release as `hub-companion-<version>.apk`. That
needs the signing key in the repo's Actions secrets — `npm run companion:secrets` puts it there
(it uses the GitHub CLI, `gh`, signed in to an account that can administer the repo). Without
them, a release still publishes the server image and skips the APK, saying so in its summary.

## How the build works

- `docker/Dockerfile` pins the toolchain (JDK 21, Android SDK platform 37, build-tools, Gradle
  9.8.2 — no Gradle wrapper; the image is the pin). `scripts/run.sh <gradle task>` rebuilds the
  image when that file changes and mounts the whole repo, so the app's version comes from the
  root `package.json`.
- The contract test starts the hub with no `ANTHROPIC_API_KEY` (never the repo's `.env`), so it
  uses the free rules parser and is part of the regression suite and CI; it fails if the hub
  ever says it would use the model. The real model is checked separately and by hand with
  `npm run voice:check`.
- Play Services isn't there on the JVM, so the tests swap the two calls into it for stand-ins:
  `Shops.watch` (registering geofences) and `ShopsActivity.locate` (the current position).
  Everything either side of them — what's watched, what's asked, what's sent — is tested.
- No emulator tests: an emulator needs hardware virtualisation inside Docker, which Docker
  Desktop on Windows can't reliably give it. The phone checklist covers that gap.
