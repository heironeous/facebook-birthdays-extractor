# FB Birthday Extractor — Chrome Extension

Goal: Manifest V3 Chrome extension. Popup button "Extract as CSV" opens
https://www.facebook.com/events/birthdays/ in a new tab, then
intercepts Facebook's own GraphQL network responses (which carry the
exact JSON shape needed) as they arrive, while scrolling the page to
the bottom and waiting a fixed 10s between scrolls to trigger each next
batch — deduped via a name+birthdate hashmap — then downloads a CSV
formatted for Google Calendar import (all-day birthday reminders).
Vanilla JS only, zero external deps (Docker debian slim 12, no
Node/npm needed to build or run — load unpacked in Chrome).

## Status: CSV extraction confirmed working live. Progress-window UI just added, needs live check.

## Files
- [x] manifest.json — MV3 config, permissions, two content scripts (see
      below). No `default_popup` on `action` anymore — see UI note below.
- [x] popup.html / popup.css — UI: Extract button, Stop button, live log.
      No longer a toolbar action-bubble — opened as its own small
      `chrome.windows.create` window instead (see below).
- [x] popup.js — sends `OPEN_AND_START` to background.js and returns
      immediately (does NOT do tab creation itself — see bug note below)
- [x] network-interceptor.js — **new**, injected into the page's own JS
      world (`"world": "MAIN"`) at `document_start`, i.e. before
      Facebook's bundle runs. Patches `window.fetch` and
      `XMLHttpRequest` to catch every `/api/graphql/` response and
      forward its raw text to `content.js` via `postMessage` — passive
      only, never alters/blocks the real request
- [x] content.js — registers the `postMessage` listener as the very
      first thing it does (also `document_start`, so nothing sent by
      the interceptor before content.js finishes loading is missed);
      merges GraphQL captures AND a per-round `<script>`-tag rescan
      (kept as a redundant second source) into one Map keyed by
      name+birthdate; drives the scroll loop (10s fixed delay); sends
      CSV to background
- [x] background.js — service worker, receives final CSV and triggers
      chrome.downloads.download, owns the tab-open/wait-for-load/
      send-START orchestration (moved here from popup.js — see bug note
      below), AND now owns the progress-window lifecycle
      (`chrome.action.onClicked` → `openProgressWindow()`, refocused
      once the birthdays tab finishes loading)
- [x] icons/ — placeholder solid-color icons (16/48/128), generated with a
      zero-dependency raw PNG encoder (stdlib zlib/struct only)
- [x] sample/sample-birthdays-page.html — real saved copy of the logged-in
      Birthdays page (from an earlier, now-abandoned DOM-scraping
      approach — kept for reference, no longer load-bearing)

All files syntax-checked (`node --check`), manifest JSON-validated.
`ENTRY_RE`/`extractBirthdaysFromText()` re-verified against both the
user-provided sample JSON object and a simulated multi-line GraphQL
streaming response envelope — correctly extracts name/day/month/year
from either shape, dedupes on repeat.

## Strategy (current — sixth iteration: network interception)

Why this is better than the `<script>`-tag scan alone: GraphQL response
bodies are the exact same JSON *before* Facebook serializes/renders
anything, so nothing is lost to however the page happens to embed (or
not embed) data into `<script>` tags post-render. Flow:

1. **Popup opens a new tab** to the birthdays URL
   (`popup.js:openBirthdaysTab()`) instead of requiring the user to
   already be on that page. This matters: `network-interceptor.js` only
   catches requests made *after* it's patched `fetch`/XHR, so opening a
   fresh tab guarantees no GraphQL call fires before interception is in
   place. Reusing an already-loaded tab would miss everything fetched
   during that tab's original page load.
2. **`network-interceptor.js`** (MAIN world, `document_start`) patches
   `fetch`/`XMLHttpRequest`. For any request whose URL matches
   `/\/api\/graphql\//`, it clones the response, reads the text, and
   does `window.postMessage({source:'fbbday-network', text}, origin)`.
   Idempotency-guarded (`window.__fbbdayNetworkPatched`) in case of
   re-injection. Purely observational — always returns/behaves exactly
   as the unpatched call would.
3. **`content.js`** (isolated world, also `document_start`) registers a
   `window.addEventListener('message', ...)` as its first statement,
   filtering on `event.source === window` and
   `data.source === 'fbbday-network'`. Every matching capture runs
   through the same `extractBirthdaysFromText()` used for the
   `<script>`-tag scan, merging into the shared module-scope `collected`
   Map.
4. **Scroll loop** (`scrollUntilComplete()`) is otherwise unchanged from
   the previous iteration: extract from `<script>` tags, scroll to
   bottom, wait fixed 10s (interruptible), repeat until height stable
   for 2 rounds (cap `MAX_SCROLL_ROUNDS`=120). The scrolling itself is
   still what triggers Facebook to actually issue the paginated GraphQL
   requests — the interceptor is purely a tap on the wire, not a
   replacement for triggering the fetches.
5. Dedup key stays `name|month|day|year`, unchanged from prior
   iteration — both sources merge into it without conflict.

## Bug fixed: "tab opens, nothing happens after that"

Reported symptom: clicking Extract opened the new tab but no
scrolling/extraction/log output ever followed. Root cause: the
tab-creation + wait-for-load + `sendMessage(START)` sequence was living
in `popup.js`'s click handler. Chrome tears down a popup's JS context
the instant a *newly-created* tab steals focus — which happens
essentially synchronously inside `chrome.tabs.create()` (new tabs are
active by default). So `chrome.tabs.create()` itself would complete
(the tab visibly opens), but every `await` after it — waiting on
`chrome.tabs.onUpdated`, then `chrome.tabs.sendMessage(tabId, {type:
'START'})` — was silently killed mid-flight along with the rest of the
popup's execution context. Nothing downstream ever ran, and there was
no error to show because the code that would have caught/logged an
error was itself part of what got killed.

Fix: moved the whole `openBirthdaysTab()` + `sendMessage(START)`
sequence into `background.js` (`handleOpenAndStart()`), triggered by a
`{type:'OPEN_AND_START'}` message from the popup. The service worker
isn't tied to the popup's lifetime, so it keeps running after the popup
closes. `popup.js`'s click handler now just fires that message and
returns — it no longer awaits anything tab-related itself.

Also hardened `openBirthdaysTab()` while touching it: the
`chrome.tabs.onUpdated` listener now checks `updatedTab.url` starts
with the target URL, not just `status === 'complete'` — status can hit
`'complete'` for an intermediate `about:blank`/redirect hop before the
real navigation to the birthdays page happens, which would have
resolved (and sent START) too early.

**Confirmed fixed live** — user reports CSV extraction now works
end-to-end.

## Feature: keep the progress UI visible after the birthdays tab opens

Follow-up request once the above was confirmed working: the toolbar
action-bubble (`default_popup`) closes the instant the newly-opened
birthdays tab takes focus — that's not a bug, it's how Chrome
action-bubbles work by design, there's no API to keep one open through
a focus change. So there's no way to satisfy "let me watch progress
after the tab opens" while still using a `default_popup`.

Fix: removed `default_popup` from `manifest.json`'s `action` entirely.
Clicking the toolbar icon now fires `chrome.action.onClicked`
(`background.js`), which opens `popup.html` in its own small real
window via `chrome.windows.create({type:'popup', ...})` instead — a
window is independent of tab focus, so it just goes behind the
birthdays tab rather than closing. `background.js` tracks
`progressWindowId`; a second icon click refocuses the existing window
instead of creating a duplicate, and `chrome.windows.onRemoved` clears
the tracked id if the user closes it manually. Once the birthdays tab
finishes loading (`getOrOpenBirthdaysTab()` resolves, right before
`sendMessage(START)`), `handleOpenAndStart()` explicitly refocuses the
progress window, so it pops back in front right as extraction starts —
directly matching "see the extension screen opened after the new tab
is opened."

`popup.html`/`popup.js`/`popup.css` are unchanged — same UI, same
`chrome.storage`/`chrome.runtime` calls work identically whether the
page is shown as an action-bubble or as standalone window content.

## Feature: reuse the current tab if it's already the birthdays page

Follow-up: instead of always opening a new tab, check first whether the
tab the user was actually looking at (before the progress window took
focus) is already the birthdays page — if so, refresh it and extract
from there; only fall back to opening a new tab otherwise.

`findActiveBirthdaysTab()` in `background.js` uses
`chrome.windows.getLastFocused({windowTypes:['normal']})` rather than
`chrome.tabs.query({active:true, currentWindow:true})` — the latter
would find the currently-focused window, which at the moment Extract is
clicked is our own `type:'popup'` progress window, not a real browser
tab at all. Restricting to `windowTypes:['normal']` deliberately skips
past our own window to the actual browser window/tab the user had open.
If that active tab's URL contains `facebook.com/events/birthdays`,
`getOrOpenBirthdaysTab()` calls `chrome.tabs.reload()` on it (a clean
run — re-injects both content scripts fresh, including
`network-interceptor.js`'s fetch/XHR patch) and waits for it via the
same `waitForTabLoad()` used for the new-tab path. Otherwise, falls
back to the existing `chrome.tabs.create()` flow unchanged.

No new permission needed: `url` on a tab already matching
`host_permissions` (`facebook.com/*`) is visible without the `"tabs"`
permission; for tabs on *other* sites the `url` field comes back
scrubbed/undefined regardless, which safely fails the `.includes(...)`
check and correctly falls through to the new-tab path.

## Remaining work — needs a live, logged-in smoke test (cannot verify from here)
- [ ] Confirm `chrome.windows.getLastFocused({windowTypes:['normal']})`
      actually returns the tab the user had open before clicking the
      extension icon, not something unexpected (e.g. if they'd closed
      all normal windows and only had the progress window open).
- [ ] Confirm reloading an already-open birthdays tab correctly resets
      state (fresh `collected` Map in content.js, fresh
      `network-interceptor.js` patch) rather than somehow reusing stale
      state from before the reload.
- [ ] Confirm the progress-window behavior above live: icon click opens
      a window, Extract click opens/reuses the birthdays tab, and the
      window pops back to front once that tab finishes loading. Not
      observed directly (no browser here) — reasoned from documented
      `chrome.windows`/`chrome.action.onClicked` behavior.
- [ ] Window sizing (380x560) is a guess at fitting the existing
      popup.html content plus window chrome (title bar) — may need
      tweaking once seen live.
- [ ] Confirm the GraphQL endpoint path actually matches
      `/api/graphql/` on the live site — if Facebook uses a different
      path (or query-string-only routing) for this specific query,
      `GRAPHQL_URL_RE` in `network-interceptor.js` needs adjusting.
- [ ] Confirm `"world": "MAIN"` content scripts are supported by the
      Brave version in use — this is a Chrome 111+ manifest V3 feature;
      unverified here which Brave/Chromium version is actually running.
      If unsupported, the interceptor silently won't inject and only
      the `<script>`-tag fallback source will work.
- [ ] Confirm Facebook's birthday GraphQL response actually contains
      the same `birthdate`/`__typename":"User"` shape as the
      `<script>`-tag-embedded version — assumed identical since it's
      the data source for that embed, not independently confirmed.
- [ ] Confirm the tab-open/reload flow doesn't race: `background.js`
      waits for `chrome.tabs.onUpdated` status `complete` (via
      `waitForTabLoad()`) before sending START, which should be well
      after `document_start` content scripts have registered — but
      unverified live.
- [ ] Confirm 10s is actually enough for each batch to finish loading.
- [ ] Confirm CSV downloads correctly via chrome.downloads.
- [ ] Confirm Stop button halts the scroll loop cleanly mid-run.
- [ ] Two different friends sharing both name and exact birthdate
      collide under the name+birthdate key — accepted per explicit
      dedup-key instruction, not a bug.

## CSV format (Google Calendar import)

Legacy Outlook-style columns Google Calendar's CSV importer expects:
`Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private`.
Each row: `Subject = "<Name>'s Birthday"`, Start Date = End Date =
the real birth date in `MM/DD/YYYY` when the JSON exposes a year,
otherwise the next upcoming occurrence of that month/day (today or
later — most Facebook birthdates come through with `year: null`),
`All Day Event = True`, Start/End Time/Description/Location blank,
`Private = False`.

Known limitation: this format has no recurrence field, so imported
events do NOT auto-repeat yearly in Google Calendar. Re-run the export
annually, or set "Repeat yearly" by hand per event after import.

## Design notes (for continuation)
- Extraction loop lives in `content.js` (page context), NOT the MV3
  service worker — service workers get evicted after ~30s idle. Content
  script survives as long as the tab/SPA route stays on facebook.com.
- Progress persisted to `chrome.storage.local` incrementally so popup
  can reopen mid-run and resync (popup UI is ephemeral, extraction is
  not).
- Stop is a flag in `chrome.storage.local` (`fbbday_stop`), polled by
  content script once per round via `isStopRequested()`.
- Dedup key is `name|month|day|year`, per explicit instruction — see
  the collision caveat above.
- `chrome.tabs.create`/`chrome.tabs.onUpdated` don't require the
  `"tabs"` permission here since we already have host_permissions on
  `facebook.com` covering the created tab's URL — kept the permission
  footprint unchanged from before this change.
