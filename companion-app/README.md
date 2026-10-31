# Hub companion app (Android)

A home-screen mic for the hub: tap it, say *"add eggs and milk to the M&S list"*, and the items
land on that shopping list. The phone does the listening (Android's own speech prompt), the hub
works out what you meant (see [`docs/voice.md`](../docs/voice.md)), and a one-line answer pops
up: *"Added Eggs and Milk to M&S – Bangor"*.

It needs Android 12 or later (a Pixel 6 is fine on any version it gets).

- [Install it](#installing-on-your-phone)
- [Pair it with the hub](#pairing-it-with-the-hub)
- [Add the widget](#adding-the-widget)
- [Check it works](#checking-it-works-on-the-phone)
- [Update it](#updating)
- [Build and test it yourself](#building-and-testing) · [Signing](#signing) · [Releases](#releases)

## Installing on your phone

1. **Get the APK.** On the phone, open the repo's
   [Releases](https://github.com/AShav3dWookie/Hub/releases) page, pick the newest release and
   tap `hub-companion-<version>.apk` under *Assets* to download it.
2. **Open the download** (from the notification, or Files → Downloads).
3. Android says the browser **isn't allowed to install unknown apps**. Tap **Settings**, turn on
   **Allow from this source**, and go back.
4. Tap **Install**. If Play Protect asks about an unrecognised app, choose **Install anyway** —
   it's yours, signed with your own key, and never went through the Play Store.
5. You can turn *Allow from this source* back off afterwards.

**From a computer instead:** with USB debugging on (Settings → About phone → tap *Build number*
seven times, then Settings → System → Developer options → *USB debugging*), plug the phone in and:

```bash
adb install -r companion-app/dist/hub-companion-<version>-release.apk
```

## Pairing it with the hub

1. **On the hub** (any browser, signed in): **Settings → Devices** → type a name such as
   *Pixel 6* → **Add device**. A token starting `hub_` appears **once** — leave it on screen.
2. **On the phone**, open the **Hub** app:
   - **Hub address** — the address you open the hub at. On the home Wi-Fi that's the server's
     LAN address and port, e.g. `http://192.168.1.20:8090`. (You can leave off `http://`.)
   - **Device token** — paste the `hub_…` token. Getting it across: copy it on the phone if you
     opened the hub there, or send it to yourself (e.g. a note or message to yourself).
3. Tap **Test connection**. You should see:
   *Connected as "Pixel 6". Voice commands will be understood by Claude.*
   - *…use the simple backup…* means the hub has no `ANTHROPIC_API_KEY`
     ([`docs/voice.md`](../docs/voice.md#setting-it-up)) — it works, but won't split
     "eggs and milk" into two items.
   - *didn't accept this phone's token* — it was mistyped or revoked; make a new one.
   - *Couldn't reach the hub* — check the address and that the phone is on the home Wi-Fi.
4. Back on the hub, tap **Done** so the token disappears.

A yellow warning under the address means it's plain `http://` somewhere other than your home
network: the token would cross the internet unencrypted. Until the hub has https, pair over the
LAN address; [`docs/voice.md`](../docs/voice.md#security) covers reaching it from outside.

## Adding the widget

Long-press an empty part of the home screen → **Widgets** → **Hub** → drag **Hub voice** to where
you want it. It's one tile: a mic on a dark circle.

Tap it, wait for *"What should I add?"*, and speak. The app doesn't need the microphone
permission itself — it's the phone's speech prompt doing the listening.

## Checking it works on the phone

The automated tests run the app's screens on a computer (see below); these are the bits only a
real phone can show. Worth going through after installing and after each update:

- [ ] **Test connection** shows *Connected as "…"* with the right parser.
- [ ] The widget's mic opens the speech prompt, and *"add eggs"* pops up *Added Eggs to Shopping*.
- [ ] The item is on the list in the hub app (Shopping tab) after it syncs.
- [ ] *"add bread to the M&S list"* lands on that list, not the main one.
- [ ] Backing out of the speech prompt adds nothing and shows nothing.
- [ ] On mobile data with the LAN address paired, a command says *Couldn't reach the hub*.
- [ ] Removing the device in the hub's Settings, then using the widget, says the token wasn't
      accepted.

## Updating

Install the new release's APK over the top, the same way as the first time. The pairing is kept.

That only works because every release is signed with the same key. If Android ever says the
package **conflicts with an existing package**, the APK was signed with a different key (a debug
build, say) — uninstall the old app first, then pair again.

---

## Building and testing

Everything runs in a container, so nothing Android needs installing — just Docker and Node
(from the repo root, on the host). The first run builds the image (JDK, Android SDK, Gradle;
a couple of GB) and downloads dependencies into Docker volumes; later runs reuse them.

| Command | What it does |
| --- | --- |
| `npm run companion:test` | Unit tests and Robolectric tests (the real screens and widget code, on the JVM) |
| `npm run companion:contract` | Builds the hub from this repo, runs it in a container, and checks the app's API client against it |
| `npm run companion:build` | Builds the APK into `companion-app/dist/` — signed release if [signing](#signing) is set up, debug otherwise |

The contract test starts the hub with no `ANTHROPIC_API_KEY` (never the repo's `.env`), so it
uses the free rules parser and is part of the regression suite; it fails if the hub ever says it
would use the model. Checking the real model is the separate, manual `npm run voice:check`.

There are no emulator tests: an emulator needs hardware virtualisation inside Docker, which
Docker Desktop on Windows can't reliably give it. The phone checklist above covers that gap.

Versions are pinned in two places: `docker/Dockerfile` (Android platform, build-tools, Gradle)
and `app/build.gradle.kts` (AGP, libraries). The app's version is the repo's — `package.json`,
bumped by `npm run release`.

## Signing

Android only installs an update signed with the same key as the app already on the phone. So
the app has one release key, made once, kept **outside the repo**, and used for every release.

**Make it once** (needs a JDK's `keytool`; the build image has one):

```bash
mkdir -p ~/keys
docker run --rm -it -v ~/keys:/keys hub-companion-builder \
  keytool -genkeypair -v -keystore /keys/hub-companion.jks -alias hub-companion \
    -keyalg RSA -keysize 4096 -validity 10000
```

It asks for a password and a name; remember the password. **Back the `.jks` file and its password
up somewhere safe** (a password manager takes file attachments). Lose them, and the next release
can't update the installed app — you'd have to uninstall and pair again.

**Build a signed APK locally:**

```bash
export COMPANION_KEYSTORE=~/keys/hub-companion.jks
export COMPANION_KEYSTORE_PASSWORD='…'  COMPANION_KEY_ALIAS=hub-companion  COMPANION_KEY_PASSWORD='…'
npm run companion:build
```

(`keytool` uses the store password for the key too unless you gave it a different one.)

## Releases

`npm run release -- patch` (see the repo's `CLAUDE.md`) tags a version; the release workflow
then builds the signed APK in the same container and attaches it to the GitHub release as
`hub-companion-<version>.apk`, alongside publishing the server image.

For that, the repository needs four **Actions secrets** (GitHub → Settings → Secrets and
variables → Actions → *New repository secret*):

| Secret | Value |
| --- | --- |
| `COMPANION_KEYSTORE_BASE64` | the `.jks` file, base64-encoded: `base64 -w0 ~/keys/hub-companion.jks` |
| `COMPANION_KEYSTORE_PASSWORD` | the store password |
| `COMPANION_KEY_ALIAS` | `hub-companion` |
| `COMPANION_KEY_PASSWORD` | the key password (the store password, unless you set another) |

Without them the release still publishes the server image; it just skips the APK and says so.
