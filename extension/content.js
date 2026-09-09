// content.js — runs on https://www.facebook.com/events/birthdays/
//
// Two sources feed the same regex/dedup logic:
//
// 1. Facebook's own GraphQL responses. network-interceptor.js (injected
//    into the page's own JS world, MAIN, at document_start — before
//    Facebook's bundle runs) patches fetch/XHR and forwards every
//    /api/graphql/ response's raw text here via postMessage. This is the
//    primary source: the exact same JSON the page itself just fetched,
//    before it's even rendered.
// 2. The page's <script> tags, scanned each scroll round as before —
//    kept as a second, redundant source in case a response is ever
//    missed by the network layer.
//
// Both feed into a single Map keyed by name+birthdate
// (day/month/year), so merging either source is a safe no-op for
// already-seen friends. Registering the postMessage listener is the
// very first thing this file does (document_start, synchronous) so no
// capture sent by network-interceptor.js is ever missed while this
// script is still finishing setup.
//
// Sample entry (as given, confirmed working):
//   {"node":{"__typename":"User","id":"709791869",...,"name":"Nil Kolsal",
//   ...,"birthdate":{"day":17,"month":9,"year":null},...}}
//
// Scroll loop: extract, scroll to bottom, wait a fixed 10s for the next
// batch to load (both the network capture and the <script> rescan pick
// it up), repeat, until page height is stable for 2 rounds running.
const ENTRY_RE =
  /"__typename":"User","id":"(\d+)"[\s\S]{0,400}?"name":"((?:\\.|[^"\\])*)"[\s\S]{0,2000}?"birthdate":\{"day":(\d+),"month":(\d+),"year":(null|\d+)\}/g;

const SCROLL_DELAY_MS = 10000;
const SCROLL_STABLE_ROUNDS_REQUIRED = 2;
const MAX_SCROLL_ROUNDS = 120;

// Module-scope so the postMessage listener (registered immediately,
// below) and the scroll loop (started later, on START) both write into
// the same Map regardless of which one sees a given friend first.
let collected = new Map();
let running = false;

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'fbbday-network' || typeof data.text !== 'string') return;
  const added = extractBirthdaysFromText(data.text, collected);
  if (added > 0) {
    log(`GraphQL capture: +${added} new (total ${collected.size} unique birthdays).`);
  }
});

async function sleepInterruptible(ms) {
  const step = 1000;
  let waited = 0;
  while (waited < ms) {
    if (await isStopRequested()) return false;
    const chunk = Math.min(step, ms - waited);
    await new Promise((r) => setTimeout(r, chunk));
    waited += chunk;
  }
  return true;
}

async function isStopRequested() {
  const { fbbday_stop } = await chrome.storage.local.get('fbbday_stop');
  return !!fbbday_stop;
}

async function log(text) {
  console.log('[fbbday]', text);
  const { fbbday_log = [] } = await chrome.storage.local.get('fbbday_log');
  fbbday_log.push(text);
  await chrome.storage.local.set({ fbbday_log });
  chrome.runtime.sendMessage({ type: 'PROGRESS', text }).catch(() => {});
}

function decodeJsonString(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

// Runs ENTRY_RE against arbitrary text (a GraphQL response body, or the
// concatenation of every <script> tag) and merges newly-found friends
// into `map` (keyed by name+birthdate, so re-feeding already-seen text
// is a no-op). Returns how many new entries this call added.
function extractBirthdaysFromText(text, map) {
  let added = 0;
  let m;
  ENTRY_RE.lastIndex = 0;
  while ((m = ENTRY_RE.exec(text))) {
    const [, , rawName, day, month, yearRaw] = m;
    const name = decodeJsonString(rawName);
    const year = yearRaw === 'null' ? null : Number(yearRaw);
    const key = `${name}|${month}|${day}|${year}`;
    if (map.has(key)) continue;
    map.set(key, { name, day: Number(day), month: Number(month), year });
    added++;
  }
  return added;
}

function extractFromScriptTagsInto(map) {
  let combined = '';
  for (const s of document.querySelectorAll('script')) {
    combined += s.textContent + '\n';
  }
  return extractBirthdaysFromText(combined, map);
}

// Extracts before every scroll, then scrolls to the bottom and waits a
// fixed 10s for the next batch to load, until document height stops
// growing for SCROLL_STABLE_ROUNDS_REQUIRED consecutive rounds.
// Returns { stopped }. Results accumulate in the module-scope `collected`
// map (also fed continuously by the postMessage listener above).
async function scrollUntilComplete() {
  let stableRounds = 0;
  let lastHeight = -1;
  let round = 0;

  while (stableRounds < SCROLL_STABLE_ROUNDS_REQUIRED && round < MAX_SCROLL_ROUNDS) {
    if (await isStopRequested()) return { stopped: true };
    round++;

    const added = extractFromScriptTagsInto(collected);
    await log(`Round ${round}: +${added} new from page data (total ${collected.size} unique birthdays).`);

    window.scrollTo(0, document.body.scrollHeight);
    await log(`  waiting ${SCROLL_DELAY_MS / 1000}s for the page to load more...`);
    const ok = await sleepInterruptible(SCROLL_DELAY_MS);
    if (!ok) return { stopped: true };

    const height = document.body.scrollHeight;
    if (height === lastHeight) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastHeight = height;
    }
  }

  // Final pass to catch anything that loaded during the last scroll.
  extractFromScriptTagsInto(collected);

  if (round >= MAX_SCROLL_ROUNDS) {
    await log(`Hit the ${MAX_SCROLL_ROUNDS}-round scroll cap — stopping.`);
  } else {
    await log(`Bottom of page reached after ${round} scroll(s) — nothing more to load.`);
  }
  return { stopped: false };
}

// Google Calendar's CSV importer uses the legacy Outlook column layout:
// Subject,Start Date,Start Time,End Date,End Time,All Day Event,
// Description,Location,Private. When Facebook exposes the birth year,
// that's used directly as the real birth date; otherwise (the common
// case — Facebook hides it by default) each row falls back to the *next
// upcoming occurrence* of that month/day (today or later), since that's
// the date Google Calendar needs for a one-time all-day import. Note:
// this format has no recurrence field, so imported events do NOT
// auto-repeat next year; re-run the export annually, or set "Repeat
// yearly" by hand on each event after import.
function pad2(n) {
  return String(n).padStart(2, '0');
}

function birthdayMMDDYYYY(month, day, year) {
  if (year) return `${pad2(month)}/${pad2(day)}/${year}`;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let y = now.getFullYear();
  if (new Date(y, month - 1, day) < today) y++;
  return `${pad2(month)}/${pad2(day)}/${y}`;
}

function toCsv(rows) {
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const header = 'Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private';
  const lines = [header];
  for (const { name, month, day, year } of rows) {
    const date = birthdayMMDDYYYY(month, day, year);
    const subject = `${name}'s Birthday`;
    lines.push(
      [escape(subject), date, '', date, '', 'True', '', '', 'False'].join(',')
    );
  }
  return lines.join('\r\n');
}

async function runExtraction() {
  if (running) return;
  running = true;
  collected = new Map();
  try {
    await log('Extracting birthdays from GraphQL responses while scrolling...');
    const { stopped } = await scrollUntilComplete();
    if (stopped) {
      await log('Stopped by user.');
      chrome.runtime.sendMessage({ type: 'STOPPED' }).catch(() => {});
      await chrome.storage.local.set({ fbbday_running: false });
      return;
    }

    const rows = Array.from(collected.values());
    await log(`Extraction complete: ${rows.length} unique birthdays.`);

    const csv = toCsv(rows);
    await chrome.storage.local.set({ fbbday_running: false });
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_CSV',
      csv,
      filename: `fb-birthdays-${new Date().toISOString().slice(0, 10)}.csv`,
    }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'DONE', count: rows.length }).catch(() => {});
  } catch (e) {
    await log('ERROR: ' + e.message);
    await chrome.storage.local.set({ fbbday_running: false });
    chrome.runtime.sendMessage({ type: 'ERROR', text: e.message }).catch(() => {});
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'START') {
    runExtraction();
  }
});
