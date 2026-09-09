const extractBtn = document.getElementById('extractBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

function appendLog(line) {
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function setRunning(running) {
  extractBtn.disabled = running;
  stopBtn.disabled = !running;
  statusEl.textContent = running ? 'Running...' : 'Idle.';
}

async function resyncFromStorage() {
  const { fbbday_running, fbbday_log } = await chrome.storage.local.get([
    'fbbday_running',
    'fbbday_log',
  ]);
  if (Array.isArray(fbbday_log)) {
    logEl.textContent = fbbday_log.join('\n') + (fbbday_log.length ? '\n' : '');
    logEl.scrollTop = logEl.scrollHeight;
  }
  setRunning(!!fbbday_running);
}

extractBtn.addEventListener('click', async () => {
  logEl.textContent = '';
  await chrome.storage.local.set({ fbbday_stop: false, fbbday_log: [], fbbday_running: true });
  setRunning(true);
  // Hand off to background.js: it opens the tab, waits for it to load,
  // and sends START to the content script. Doing that here in the popup
  // doesn't work — Chrome tears down the popup's JS context the instant
  // the newly-created tab steals focus, killing everything after
  // chrome.tabs.create() before it can run.
  chrome.runtime.sendMessage({ type: 'OPEN_AND_START' }).catch((e) => {
    appendLog('ERROR: ' + e.message);
    setRunning(false);
  });
});

stopBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ fbbday_stop: true });
  appendLog('Stop requested, will halt after current wait...');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'PROGRESS') {
    appendLog(msg.text);
  } else if (msg.type === 'DONE') {
    appendLog(`Done. ${msg.count} birthdays extracted. CSV downloaded.`);
    setRunning(false);
  } else if (msg.type === 'ERROR') {
    appendLog('ERROR: ' + msg.text);
    setRunning(false);
  } else if (msg.type === 'STOPPED') {
    appendLog('Stopped.');
    setRunning(false);
  }
});

resyncFromStorage();
