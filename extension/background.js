// background.js — MV3 service worker.
//
// Handles the CSV download trigger, AND the "open birthdays tab, wait for
// it to load, tell content.js to start" orchestration. That orchestration
// used to live in popup.js, but Chrome closes/destroys the popup's JS
// context the instant a newly-created tab steals focus — which happens
// immediately on chrome.tabs.create(). Everything after tab creation
// (waiting for the load event, then sendMessage) was silently getting
// killed mid-flight: the tab would open but nothing would ever happen
// after that. Moving it here fixes it, since the service worker isn't
// tied to the popup's lifetime.
//
// The main extraction/scroll-delay loop still lives in content.js, not
// here — service workers get evicted after ~30s idle, which would break
// that longer-running loop.
//
// Also handles the UI itself. popup.html is no longer a default_popup
// (a toolbar action-bubble): those close the instant focus moves to
// another tab, which is exactly what happens when the birthdays tab
// opens — there's no way to keep an action-bubble open through that.
// Instead, clicking the toolbar icon (chrome.action.onClicked) opens
// popup.html in its own small real window via chrome.windows.create,
// which persists independently of tab focus. The window is refocused
// automatically once the birthdays tab finishes loading, so it's back
// on top right as extraction starts.
const BIRTHDAYS_URL = 'https://www.facebook.com/events/birthdays/';
const BIRTHDAYS_URL_MATCH = 'facebook.com/events/birthdays';
const TAB_LOAD_TIMEOUT_MS = 30000;
const PROGRESS_WINDOW_WIDTH = 380;
const PROGRESS_WINDOW_HEIGHT = 392;

let progressWindowId = null;

async function openProgressWindow() {
  if (progressWindowId !== null) {
    try {
      await chrome.windows.update(progressWindowId, { focused: true });
      return;
    } catch {
      progressWindowId = null; // window was closed by the user; recreate below
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: PROGRESS_WINDOW_WIDTH,
    height: PROGRESS_WINDOW_HEIGHT,
    focused: true,
  });
  progressWindowId = win.id;
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === progressWindowId) progressWindowId = null;
});

chrome.action.onClicked.addListener(() => {
  openProgressWindow();
});

async function logProgress(text) {
  console.log('[fbbday:bg]', text);
  const { fbbday_log = [] } = await chrome.storage.local.get('fbbday_log');
  fbbday_log.push(text);
  await chrome.storage.local.set({ fbbday_log });
  chrome.runtime.sendMessage({ type: 'PROGRESS', text }).catch(() => {});
}

// Resolves once `tabId` finishes loading the birthdays page (not an
// intermediate about:blank/redirect hop — status:'complete' can fire for
// those too, so the tab's current url is checked as well).
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab did not finish loading in time'));
    }, TAB_LOAD_TIMEOUT_MS);

    function listener(id, info, updatedTab) {
      if (id !== tabId || info.status !== 'complete') return;
      if (!updatedTab.url || !updatedTab.url.includes(BIRTHDAYS_URL_MATCH)) return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tabId);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// If the tab the user was actually looking at (the active tab in the
// most recently focused normal browser window — deliberately excludes
// our own popup-type progress window, which is what's focused at the
// moment Extract gets clicked) is already the birthdays page, returns
// its id. Otherwise null.
async function findActiveBirthdaysTab() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'], populate: true });
  const activeTab = win && win.tabs && win.tabs.find((t) => t.active);
  if (activeTab && activeTab.url && activeTab.url.includes(BIRTHDAYS_URL_MATCH)) {
    return activeTab.id;
  }
  return null;
}

// Reuses the current tab (refreshed, for a clean run) if it's already on
// the birthdays page; otherwise opens a new tab. Either way, resolves
// once that tab has finished (re)loading.
async function getOrOpenBirthdaysTab() {
  const existingTabId = await findActiveBirthdaysTab();
  if (existingTabId !== null) {
    await logProgress('Already on the birthdays page — refreshing...');
    await chrome.tabs.reload(existingTabId);
    return waitForTabLoad(existingTabId);
  }

  await logProgress('Opening birthdays page in a new tab...');
  const tab = await new Promise((resolve, reject) => {
    chrome.tabs.create({ url: BIRTHDAYS_URL }, (t) => {
      if (!t || chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError?.message || 'could not open tab'));
        return;
      }
      resolve(t);
    });
  });
  return waitForTabLoad(tab.id);
}

async function handleOpenAndStart() {
  try {
    const tabId = await getOrOpenBirthdaysTab();

    if (progressWindowId !== null) {
      chrome.windows.update(progressWindowId, { focused: true }).catch(() => {});
    }

    await logProgress('Tab loaded, starting extraction...');
    await chrome.tabs.sendMessage(tabId, { type: 'START' });
  } catch (e) {
    await logProgress('ERROR: ' + e.message);
    chrome.runtime.sendMessage({ type: 'ERROR', text: e.message }).catch(() => {});
    await chrome.storage.local.set({ fbbday_running: false });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'DOWNLOAD_CSV') {
    const url = 'data:text/csv;charset=utf-8,' + encodeURIComponent(msg.csv);
    chrome.downloads.download({
      url,
      filename: msg.filename || 'fb-birthdays.csv',
      saveAs: false,
    });
  } else if (msg.type === 'OPEN_AND_START') {
    handleOpenAndStart();
  }
});
