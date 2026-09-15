# Push notifications

The app sends reminders for everything the home screen's "What's on" lists: important dates
(birthdays, anniversaries…), and Hang Outs and Appointments logged ahead of time.

| When | What |
| --- | --- |
| **9pm** the day before | "Tomorrow" — everything happening tomorrow |
| **9am** on the day | "Today" — everything happening today |
| **9am**, 7 days before | "In a week" — important dates whose tag contains *birthday* |

Several things in one slot arrive as **one** notification. At 9am, "Today" and "In a week" share
a notification. Times are in `NOTIFY_TIMEZONE` (default `Europe/London`), so they follow BST/GMT.

## Turning it on

Settings → **Notifications** → *Turn on notifications*, on each device you want reminders on. Then
*Send test notification* to confirm the whole path works.

- **iPhone / iPad:** only the installed app can receive push (iOS 16.4+). Add it to the Home
  Screen first and turn notifications on from inside it. Settings says so if you're in Safari.
- **Android:** Chrome works installed or in the browser.
- **Use `https://hub.aaronhanna.uk`**, not `http://<lan-ip>:8090`. Browsers only expose push in a
  secure context (https or `localhost`). A device subscribed once over https receives reminders
  wherever it is. Notifications are per origin, so tapping one opens the https site.

## How it works

```
 scheduler (in the app, every minute)
   │  "which slots are open right now, and what haven't I announced?"
   │  encrypts one summary per slot to each device's keys
   ▼
 push service (Google FCM / Apple / Mozilla)  ◀── outbound HTTPS only
   │
   ▼
 phone → service worker `push` event → notification
```

- **Outbound only.** Nothing reaches `hub.aaronhanna.uk` to deliver a notification. Cloudflare,
  nginx and Authelia are not involved and need no configuration. The container needs outbound
  HTTPS.
- **Keys.** The server's VAPID key pair is generated on first boot and stored in the database
  (`app_settings`). Wiping the volume makes a new pair and forgets every device. Each device
  notices the new key the next time the app is opened and re-subscribes by itself; until then it
  gets nothing.
- **Devices** live in `push_subscriptions`. The app re-sends its subscription on every launch, and
  a device the push service reports gone (404/410) is deleted — except in its first 5 minutes.
  Google's service has been seen answering 410 to the very first send to a seconds-old
  subscription and accepting the next, so a brand-new device is retried rather than dropped.
  Each removal logs `[push] removing N subscription(s)`.
- **Never twice.** Each announced item is recorded per slot in `notification_deliveries`.
- **Late, same day only.** If the server was down at 9pm or you add something for tomorrow at
  10pm, the evening slot still sends until midnight, and the morning slots until midday. Anything
  already announced isn't repeated; a late item gets its own short notification.
  - A notification also expires at the end of its slot, so a phone that was switched off all
    morning won't announce "Today" at 6pm.
- **Offline-created items** notify once they've synced, because the server does the scheduling.
- **Birthdays** are matched by tag, case-insensitively: "Birthday", "30th birthday" and so on.
  Other important dates get the 9pm and 9am reminders only.

## Configuration

| Env var | Default | |
| --- | --- | --- |
| `NOTIFY_TIMEZONE` | `Europe/London` | IANA zone the slot times are in. An unknown zone stops the server at boot. |
| `VAPID_SUBJECT` | `https://hub.aaronhanna.uk` | Contact push services associate with the key: `mailto:` or `https://`. Apple rejects `localhost`. |

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No *Turn on* button, "Needs a secure connection" | You're on the LAN IP over http. Open the https address. |
| "Needs the installed app" | iOS in Safari. Add to Home Screen, open it from there. |
| "Blocked" | Permission was denied. Re-allow in the browser's / OS's site notification settings. |
| Test says the subscription expired | The push service dropped it (reinstall, cleared data). The button flips back to *Turn on notifications* — press it. |
| Test says "try again in a moment" right after turning it on | Google's service can refuse a seconds-old subscription; the server already retried once after 2s. Try again. |
| Test succeeds but no notification appears | The push service accepted it, which is all the server can see. Check the OS notification settings / focus mode for the installed app. |
| Test works, reminders don't arrive | Is the item planned ahead? A log created on or after its own date is history, not a reminder. Is the phone's OS-level notification permission / focus mode on? |
| Reminder at the wrong hour | `NOTIFY_TIMEZONE`. `docker exec hub-app-1 printenv NOTIFY_TIMEZONE`. |
| Nothing at all, any device | Container can't reach the internet (`[push] send failed` in the logs), or the database was recreated (new keys) — open the app once on each device. |

Inspect the state directly:

```bash
docker exec hub-app-1 sh -c "node -e \"const D=require('better-sqlite3');const d=new D('/app/data/logger.db');console.log(d.prepare('select id,label,created_at,last_success_at from push_subscriptions').all(),d.prepare('select * from notification_deliveries order by sent_at desc limit 20').all())\""
```
