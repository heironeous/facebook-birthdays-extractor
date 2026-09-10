# Feature: User Preferences

Add a settings panel to the popup, persisted in `chrome.storage.local`, covering:

1. **Repeat forever** — toggle. CSV format in use (legacy Outlook layout) has no
   recurrence column, so "repeat forever" can't be a real RRULE — when enabled,
   append a note to each row's Description column instructing the user to set
   yearly recurrence after import.
2. **Unknown birth year fallback** — radio: `next_birthday` (current behavior:
   next upcoming month/day occurrence) | `next_year` (always current year + 1) |
   `custom` (user-supplied fixed year, e.g. 1900).
3. **Scroll wait seconds** — number input, replaces hardcoded `SCROLL_DELAY_MS`
   (currently 10s).

Storage key: `fbbday_settings` = `{ repeatForever, unknownYearMode, unknownYearCustomValue, scrollWaitSeconds }`.
Defaults match current hardcoded behavior (repeatForever: false, unknownYearMode: 'next_birthday', scrollWaitSeconds: 10).

## Tasks

- [x] Add settings UI to `popup.html` (gear/toggle to reveal panel: repeat-forever checkbox, unknown-year radio group + custom year input, scroll-wait-seconds number input, Save button or auto-save on change)
- [x] Style new settings panel in `popup.css`
- [x] `popup.js`: load `fbbday_settings` from storage on open, populate fields, defaults if unset
- [x] `popup.js`: persist settings to `chrome.storage.local` on change (debounced or on-blur)
- [x] `content.js`: read `fbbday_settings` at start of `runExtraction`, use `scrollWaitSeconds` instead of hardcoded `SCROLL_DELAY_MS`
- [x] `content.js`: `birthdayMMDDYYYY` — implement `next_birthday` / `next_year` / `custom` modes for missing birth year
- [x] `content.js`: `toCsv` — when `repeatForever` on, add recurrence note to Description column
- [x] Manual test: open popup, change each setting, close/reopen popup, verify values persisted
- [ ] Manual test: run extraction with each unknown-year mode, verify CSV dates match expected mode (custom confirmed; next_birthday/next_year still untested)
- [x] Manual test: run extraction with custom scroll wait, verify log shows new wait time
- [x] Manual test: repeat-forever on, verify Description column has the note (CSV export confirmed; Google Calendar import not yet tested)
- [x] `popup.html`/`popup.css`: add window `<title>`, make `#log` flex to fill window height
