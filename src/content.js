/**
 * Content script — injected into all pages.
 * Listens for 'extractPage' messages from the popup and responds
 * with the current page's content (URL, title, HTML, text, timestamp).
 */

const MAX_HTML_BYTES = 200 * 1024;  // 200 KB
const MAX_TEXT_BYTES = 50 * 1024;   // 50 KB

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== 'extractPage') return;

  try {
    const html = document.documentElement.outerHTML;
    const text = document.body ? document.body.innerText : '';

    sendResponse({
      url: window.location.href,
      title: document.title || window.location.hostname,
      html: html.length > MAX_HTML_BYTES
        ? html.slice(0, MAX_HTML_BYTES) + '\n<!-- [FilArchive: HTML truncated] -->'
        : html,
      text: text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) : text,
      timestamp: Date.now(),
      htmlSize: html.length,
      success: true,
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }

  // Return true to keep message channel open for async sendResponse
  return true;
});
