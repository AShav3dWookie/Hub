# Hub companion app (Android)

A home-screen mic for the hub: tap it, say *"add eggs and milk to the M&S list"*, and the items
land on that shopping list. The phone does the listening (Android's own speech prompt), the hub
works out what you meant ([`docs/voice.md`](../docs/voice.md)), and a one-line answer pops up:
*"Added Eggs and Milk to M&S – Bangor"*. Android 12 or later (a Pixel 6 is fine).

Everything below is a single command, run from the repo root in **Git Bash or WSL2**. Each
reads its settings from environment variables, and falls back to the repo-root `.env` for any
that aren't set — so the usual way is to put them in `.env` once.

## Commands

| Command | Does |
| --- | --- |
| `npm run companion:keygen` | Creates the release signing key, once |
| `npm run companion:install` | Builds the signed APK and installs it on the phone (also updates it) |
| `npm run companion:pair` | Creates a device token on the hub and sends it to the app; tap **Pair** on the phone |
| `npm run companion:secrets` | Gives GitHub Actions the signing key, so releases attach the APK |
| `npm run companion:build` | Just builds the APK into `companion-app/dist/` |
| `npm run companion:test` | Unit and Robolectric tests (the real screens and widget code, on the JVM) |
| `npm run companion:contract` | The app's API client against a hub container built from this repo |

The first command to run builds the build container (JDK, Android SDK, Gradle; a couple of GB,
once). Nothing Android is installed on your machine. Two host tools are needed: **Docker**, and
**adb** (Android platform-tools) on the PATH for `install` and `pair` — a container can't reach
the phone over USB on Docker Desktop.

## Settings

| Variable | Used by | Default |
| --- | --- | --- |
| `COMPANION_KEYSTORE_PASSWORD` | keygen, install, build, secrets | — required for a signed APK; at least 6 characters |
| `COMPANION_KEYSTORE` | keygen, install, build, secrets | `~/.hub-companion/release.jks` |
| `COMPANION_KEY_ALIAS` | keygen, install, build, secrets | `hub-companion` |
| `COMPANION_KEY_PASSWORD` | keygen, install, build, secrets | same as `COMPANION_KEYSTORE_PASSWORD` |
| `COMPANION_HUB_URL` | pair | — required: the hub address **the phone** will use, e.g. `http://192.168.1.4:3000` |
| `COMPANION_HUB_PASSWORD` | pair | — only if the hub has auth on |
| `COMPANION_DEVICE_NAME` | pair | the phone's model, e.g. *Pixel 6* |
| `COMPANION_ADB_DEVICE` | install, pair | — the `ip:port` from Wireless debugging, if not using USB |
| `COMPANION_ADB_PAIR`, `COMPANION_ADB_PAIR_CODE` | install | — first-time wireless pairing only (see below) |

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
it, wait for *"What should I add?"*, and speak. The app needs no microphone permission — it's
the phone's own speech prompt that listens.

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
- No emulator tests: an emulator needs hardware virtualisation inside Docker, which Docker
  Desktop on Windows can't reliably give it. The phone checklist covers that gap.
