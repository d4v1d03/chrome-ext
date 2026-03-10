/**
 * Background service worker.
 * Handles persistent archive history stored in chrome.storage.local.
 * The actual Synapse SDK upload runs in the popup context (not here)
 * to avoid MV3 service worker 30-second termination limits.
 */

const MAX_HISTORY = 50;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['archives'], (result) => {
    if (!result.archives) {
      chrome.storage.local.set({ archives: [] });
    }
  });
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case 'saveArchive': {
      chrome.storage.local.get(['archives'], (result) => {
        const archives = Array.isArray(result.archives) ? result.archives : [];
        archives.unshift(request.archive);
        // Keep only the most recent entries
        if (archives.length > MAX_HISTORY) archives.length = MAX_HISTORY;
        chrome.storage.local.set({ archives }, () => {
          sendResponse({ success: true });
        });
      });
      return true;
    }

    case 'getArchives': {
      chrome.storage.local.get(['archives'], (result) => {
        sendResponse({ archives: result.archives || [] });
      });
      return true;
    }

    case 'clearArchives': {
      chrome.storage.local.set({ archives: [] }, () => {
        sendResponse({ success: true });
      });
      return true;
    }

    default:
      break;
  }
});
