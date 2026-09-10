# Feature: Export to ICS

Add an "Export as ICS" option alongside the existing CSV export. CSV path stays untouched.

- [x] popup.html: add `icsBtn` button next to `extractBtn` ("Extract as ICS")
- [x] popup.js: wire `icsBtn` click to send `OPEN_AND_START` with `format: 'ics'` (CSV path keeps sending `format: 'csv'`, default)
- [x] background.js: `handleOpenAndStart` forwards `format` to the `START` message sent to content.js
- [x] background.js: handle new `DOWNLOAD_ICS` message — build `data:text/calendar` URL and trigger `chrome.downloads.download` with `.ics` filename
- [x] content.js: add `toIcs(rows)` — builds a valid RFC 5545 VCALENDAR/VEVENT block per birthday
  - [x] `VALUE=DATE` all-day events (DTSTART/DTEND, DTEND = next day)
  - [x] `RRULE:FREQ=YEARLY` when `settings.repeatForever` is on (real recurrence, unlike the CSV note-only workaround)
  - [x] fold/escape text fields per RFC 5545 (commas, semicolons, newlines)
  - [x] stable UID per event (name + birthdate based)
- [x] content.js: `runExtraction(format)` branches to `toCsv`/`toIcs` and sends `DOWNLOAD_CSV`/`DOWNLOAD_ICS` accordingly; scroll/collection logic untouched
- [x] popup.js: DONE message text mentions the right file type downloaded
- [ ] Manual smoke test: verify generated .ics opens/imports cleanly (e.g. Google Calendar) with correct all-day dates and yearly recurrence — not run yet (needs live Facebook page/browser)
