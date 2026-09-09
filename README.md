# FB Birthday Extractor

Chrome extension that scrapes your Facebook friends' birthdays from
[facebook.com/events/birthdays/](https://www.facebook.com/events/birthdays/)
and exports them as a CSV ready to import into Google Calendar as
all-day birthday reminders.

No build step, no npm packages, no external services — vanilla
HTML/CSS/JS loaded directly into Chrome as an unpacked extension.

## Why

Facebook's own birthday reminders are only visible inside Facebook.
This extracts the same data to a CSV you can import into Google
Calendar (or anywhere else that reads CSV/Outlook-format calendar
imports).

## How it works

1. Click **Extract as CSV** in the popup. If the tab you had open before
   clicking the extension icon is already the Birthdays page, that tab
   gets refreshed and reused; otherwise it opens the Birthdays page in a
   **new tab**. Either way, by the time extraction starts it's a fresh
   page load — that matters, see below.
2. A script injected into that tab's own JS context patches
   `fetch`/`XMLHttpRequest` before Facebook's page code even runs, so it
   catches every GraphQL network response Facebook's own app makes —
   including your friends' exact birthdates — the moment each one
   arrives. Opening a fresh tab guarantees nothing fires before this
   patch is in place.
3. In parallel, the page is scrolled to the bottom and waits 10 seconds
   for the next batch to load, repeating (extract, scroll, wait) until
   the page height holds steady for two scrolls in a row. As a backup,
   it also re-scans the page's `<script>` tags each round, since the
   same birthday data happens to be embedded there too.
4. Each friend is deduped by name + birthdate as they're found — from
   either source — so nothing produces duplicate rows.
5. It builds a CSV from the deduped set and triggers a download.

Everything runs in your own logged-in browser tab — no credentials
beyond your own logged-in session, no external API calls. It only
observes network traffic Facebook's own page already generates; it
never modifies or blocks a request.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**, select the `extension/` directory.

## Use

1. Log into Facebook.
2. Click the extension icon — this opens a small standalone window (not
   a toolbar popup) with Extract/Stop buttons and a log panel.
3. Click **Extract as CSV**. If you were already on the Birthdays page,
   that tab gets refreshed and reused; otherwise a new tab opens for
   you — no need to navigate there yourself first. That tab briefly
   takes focus; the extension window pops back in front once it's done
   loading, so you can keep watching progress.
4. Watch the log panel for progress — running count of unique birthdays
   found so far, updated on every GraphQL capture and every scroll round.
5. Click **Stop** at any point to halt cleanly.
6. When done, a CSV downloads automatically.

The extension window stays open independently of whatever tab has
focus — click the toolbar icon again any time to bring it back.

## CSV format

Columns match the legacy Outlook format Google Calendar's importer
expects:

```
Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private
"Jane Doe's Birthday",09/12/2026,,09/12/2026,,True,,,False
```

- **Subject**: `<Name>'s Birthday`
- **Start Date / End Date**: the real birth date when Facebook exposes
  the year, otherwise the *next upcoming occurrence* of that birthday
  (today or later) — Facebook hides the year for most friends.
- **All Day Event**: always `True`.

Import at [Google Calendar settings → Import & export](https://calendar.google.com/calendar/r/settings/export).

**Limitation:** this CSV format has no recurrence field, so imported
events do not auto-repeat next year. Either re-run the export annually,
or set "Repeat yearly" by hand on each event after import.

## Project layout

```
extension/
  manifest.json         MV3 config, permissions, content script registration
  popup.html/css/js     Extract/Stop buttons, live progress log; opened
                         as a standalone window, not a toolbar popup
  background.js         service worker: opens the popup.html window on
                         icon click, opens the birthdays page in a new
                         tab, waits for it to load, starts extraction,
                         handles the CSV download trigger
  network-interceptor.js injected into the page's own JS context;
                         patches fetch/XHR to capture GraphQL responses
  content.js             runs on the Birthdays page: receives GraphQL
                         captures, scroll-to-bottom loop, CSV generation
  icons/                 toolbar icons
  sample/                saved copy of a real Birthdays page, kept for
                         reference from an earlier DOM-scraping approach
```

## Permissions

- `storage` — persists progress/log so the popup can reopen mid-run.
- `downloads` — saves the generated CSV.
- `scripting` — required by Manifest V3 for the content script.
- `host_permissions` on `facebook.com` only — the extension does
  nothing on any other site.

## Known limitations

- `ENTRY_RE` in `content.js` is calibrated against a real sample JSON
  object, but Facebook's internal data shape can change. If extraction
  finds 0 (or far fewer than expected) birthdays, re-inspect a live
  GraphQL response or the page's `<script>` tags and update `ENTRY_RE`.
- The network interceptor requires `"world": "MAIN"` content script
  support (Chrome/Chromium 111+). On an older browser it silently won't
  inject, leaving only the `<script>`-tag fallback source.
- Birth year is only used when Facebook actually exposes it; otherwise
  exported dates are "next occurrence," not the true birth date.
- See `TODO.md` for open verification items and implementation notes.
