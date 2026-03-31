const MAX_HISTORY = 50;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['archives'], (result) => {
    if (!result.archives) chrome.storage.local.set({ archives: [] });
  });
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case 'saveArchive':
      handleSaveArchive(request, sendResponse);
      return true;

    case 'getArchives':
      chrome.storage.local.get(['archives'], (r) =>
        sendResponse({ archives: r.archives || [] })
      );
      return true;

    case 'clearArchives':
      chrome.storage.local.set({ archives: [] }, () =>
        sendResponse({ success: true })
      );
      return true;

    case 'saveToBackend':
      handleBackendSave(request, sendResponse);
      return true;

    case 'getJobStatus':
      handleGetJobStatus(request.jobId, sendResponse);
      return true;

    default:
      break;
  }
});


function handleSaveArchive(request, sendResponse) {
  chrome.storage.local.get(['archives'], (result) => {
    const archives = Array.isArray(result.archives) ? result.archives : [];
    archives.unshift(request.archive);
    if (archives.length > MAX_HISTORY) archives.length = MAX_HISTORY;
    chrome.storage.local.set({ archives }, () => sendResponse({ success: true }));
  });
}


function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['privateKey', 'network', 'backendUrl', 'backendApiKey'],
      resolve
    );
  });
}

function backendHeaders(apiKey) {
  const h = { 'Content-Type': 'application/json' };
  if (apiKey) h['X-API-Key'] = apiKey;
  return h;
}

async function handleBackendSave(request, sendResponse) {
  try {
    const s = await getSettings();
    const base = (s.backendUrl || 'http://localhost:8000').replace(/\/$/, '');
    const resp = await fetch(`${base}/api/save`, {
      method: 'POST',
      headers: backendHeaders(s.backendApiKey),
      body: JSON.stringify({ mode: request.mode, page: request.page }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
      sendResponse({ error: err.detail || `HTTP ${resp.status}` });
      return;
    }
    sendResponse(await resp.json());
  } catch (err) {
    sendResponse({ error: err.message || 'Failed to reach backend' });
  }
}

async function handleGetJobStatus(jobId, sendResponse) {
  try {
    const s = await getSettings();
    const base = (s.backendUrl || 'http://localhost:8000').replace(/\/$/, '');
    const resp = await fetch(`${base}/api/status/${jobId}`, {
      headers: backendHeaders(s.backendApiKey),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
      sendResponse({ error: err.detail || `HTTP ${resp.status}` });
      return;
    }
    sendResponse(await resp.json());
  } catch (err) {
    sendResponse({ error: err.message || 'Failed to reach backend' });
  }
}
