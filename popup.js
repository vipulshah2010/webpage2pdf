// popup.js
// Handles the popup UI, settings, and triggers the capture

const SETTINGS_KEYS = ['hidePopups', 'includeBackground'];

// URL schemes that Chrome will not allow the debugger to attach to
const UNCAPTURABLE_PREFIXES = [
  'chrome://', 'chrome-extension://', 'edge://', 'about:',
  'data:', 'devtools://', 'view-source:',
];

let currentTabId = null;

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab) {
    currentTabId = tab.id;
    document.getElementById('pageTitle').textContent = tab.title || 'Untitled Page';
    document.getElementById('pageUrl').textContent = tab.url || '—';
    document.getElementById('filenameInput').value = displayFilename(tab.title);

    // Detect pages the debugger cannot attach to and disable capture immediately
    const blocked = UNCAPTURABLE_PREFIXES.some(p => (tab.url || '').startsWith(p));
    if (blocked) {
      showNotice('This page cannot be captured. Navigate to a regular webpage and try again.');
      document.getElementById('captureBtn').disabled = true;
    }
  } else {
    showNotice('No active tab found. Please close and reopen the extension.');
    document.getElementById('captureBtn').disabled = true;
  }

  // Restore persisted toggle states — storage may be unavailable, fall back to HTML defaults
  try {
    const saved = await chrome.storage.sync.get(SETTINGS_KEYS);
    SETTINGS_KEYS.forEach(key => {
      if (saved[key] !== undefined) {
        document.getElementById(key).checked = saved[key];
      }
    });
  } catch (_) {}

  // Persist each toggle as it changes
  SETTINGS_KEYS.forEach(key => {
    document.getElementById(key).addEventListener('change', e => {
      chrome.storage.sync.set({ [key]: e.target.checked });
    });
  });

  document.getElementById('captureBtn').addEventListener('click', startCapture);
});

function handleMessage(msg) {
  if (msg.type === 'PROGRESS') {
    updateProgress(msg.label, msg.pct);
  } else if (msg.type === 'DONE') {
    showSuccess(msg.downloadId);
  } else if (msg.type === 'ERROR') {
    showError(msg.message);
  }
}

async function startCapture() {
  if (!currentTabId) {
    showError('No active tab found. Please close and reopen the extension.');
    return;
  }

  const btn = document.getElementById('captureBtn');
  resetState();
  btn.disabled = true;
  btn.classList.add('loading');
  setBtnState('loading');
  showProgress();

  // Ensure exactly one listener is active for this capture session
  chrome.runtime.onMessage.removeListener(handleMessage);
  chrome.runtime.onMessage.addListener(handleMessage);

  const options = {
    hidePopups:        document.getElementById('hidePopups').checked,
    includeBackground: document.getElementById('includeBackground').checked,
    filename:          document.getElementById('filenameInput').value.trim() || undefined,
  };

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      tabId: currentTabId,
      options,
    });

    if (response && response.error) {
      showError(response.error);
    }
  } catch (err) {
    showError('Could not connect to the background service. Try reloading the extension.');
  }
}

// Toggle button states using pre-authored HTML spans — no innerHTML manipulation
function setBtnState(state) {
  const btn = document.getElementById('captureBtn');
  btn.querySelectorAll('.btn-state').forEach(el => {
    el.hidden = !el.classList.contains(`btn-${state}`);
  });
}

function resetState() {
  document.getElementById('successMsg').classList.remove('visible');
  document.getElementById('errorMsg').classList.remove('visible');
  document.getElementById('progressWrap').classList.remove('visible');
  document.getElementById('viewPdfBtn').hidden = true;
  const btn = document.getElementById('captureBtn');
  btn.classList.remove('loading');
}

function showNotice(msg) {
  document.getElementById('noticeText').textContent = msg;
  document.getElementById('noticeMsg').classList.add('visible');
}

function showProgress() {
  document.getElementById('progressWrap').classList.add('visible');
  updateProgress('Preparing page...', 0);
}

function updateProgress(label, pct) {
  document.getElementById('progressLabel').textContent = label;
  document.getElementById('progressPct').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;
}

function showSuccess(downloadId) {
  chrome.runtime.onMessage.removeListener(handleMessage);
  document.getElementById('progressWrap').classList.remove('visible');
  document.getElementById('successMsg').classList.add('visible');

  // Show the Open button only when we have a valid download ID
  const viewBtn = document.getElementById('viewPdfBtn');
  if (downloadId != null) {
    viewBtn.hidden = false;
    viewBtn.onclick = async () => {
      try {
        await chrome.downloads.open(downloadId);
      } catch (_) {
        showNotice('Could not open the file — it may have been moved or deleted.');
      }
    };
  }

  const btn = document.getElementById('captureBtn');
  btn.disabled = false;
  btn.classList.remove('loading');
  setBtnState('success');
}

function showError(msg) {
  chrome.runtime.onMessage.removeListener(handleMessage);
  document.getElementById('progressWrap').classList.remove('visible');
  document.getElementById('errorMsg').classList.add('visible');
  document.getElementById('errorText').textContent = msg;
  const btn = document.getElementById('captureBtn');
  btn.disabled = false;
  btn.classList.remove('loading');
  setBtnState('retry');
}

// Display version: strips only illegal chars, preserves spaces so the input
// looks natural. Background.js does the full sanitization (spaces → _) on save.
function displayFilename(name) {
  if (!name) return 'page2pdf-capture';
  return name
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .substring(0, 80) || 'page2pdf-capture';
}

// Keep for any future popup-side use that needs the full sanitization rules.
function sanitizeFilename(name) {
  if (!name) return 'page2pdf-capture';
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 80);
}
