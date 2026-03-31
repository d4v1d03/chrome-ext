chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'extractPage') {
    try {
      const html = document.documentElement.outerHTML;
      const MAX_HTML = 200 * 1024;
      const truncated = html.length > MAX_HTML;
      sendResponse({
        success: true,
        url: window.location.href,
        title: document.title,
        html: truncated ? html.slice(0, MAX_HTML) + '<!-- truncated -->' : html,
        text: document.body?.innerText?.slice(0, 50 * 1024) || '',
        timestamp: new Date().toISOString(),
        htmlSize: html.length,
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
});

let fabShadow = null;
let currentMode = 'full';
let isSaving = false;

const MODE_DESCS = {
  full: 'Saves the full HTML page to decentralized storage.',
  ai_summary: 'AI extracts key content and saves a compressed summary.',
};

function injectSaveButton() {
  if (document.getElementById('pwm-fab-host')) return;

  const host = document.createElement('div');
  host.id = 'pwm-fab-host';
  host.style.cssText =
    'position:fixed;bottom:24px;right:24px;z-index:2147483647;font-size:0;';

  fabShadow = host.attachShadow({ mode: 'open' });

  fabShadow.innerHTML = `
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  #fab {
    width: 46px; height: 46px;
    background: linear-gradient(135deg, #0090ff 0%, #0060cc 100%);
    border: none; border-radius: 50%;
    color: #fff; font-size: 20px; cursor: pointer;
    box-shadow: 0 4px 18px rgba(0,144,255,0.45);
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s;
    outline: none; font-family: system-ui, sans-serif;
  }
  #fab:hover { transform: scale(1.1); box-shadow: 0 6px 22px rgba(0,144,255,0.55); }
  #fab.saving { background: linear-gradient(135deg, #0060aa, #004488); cursor: wait; }
  #fab.done   { background: linear-gradient(135deg, #22c55e, #16a34a); }
  #fab.error  { background: linear-gradient(135deg, #ef4444, #dc2626); }

  #panel {
    display: none;
    position: absolute; bottom: 56px; right: 0;
    width: 250px;
    background: #0d1018;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 14px; padding: 16px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.65);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    animation: fadeUp 0.17s ease;
  }
  #panel.open { display: block; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .p-title {
    font-size: 12px; font-weight: 700; color: #f1f5f9;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin-bottom: 12px; line-height: 1.4;
  }

  .mode-row {
    display: flex; gap: 4px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px; padding: 3px;
    margin-bottom: 8px;
  }
  .mode-btn {
    flex: 1; padding: 5px 4px;
    background: transparent; border: none; border-radius: 6px;
    font-size: 11px; font-weight: 600; color: #64748b;
    cursor: pointer; transition: all 0.15s; text-align: center;
  }
  .mode-btn.active { background: #0090ff; color: #fff; }
  .mode-btn:hover:not(.active) { color: #94a3b8; }

  .mode-desc {
    font-size: 10px; color: #475569; line-height: 1.45;
    margin-bottom: 12px; min-height: 28px;
  }

  #btn-do-save {
    width: 100%; padding: 9px;
    background: linear-gradient(135deg, #0090ff, #0060cc);
    border: none; border-radius: 8px;
    color: #fff; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: background 0.15s;
    font-family: inherit;
  }
  #btn-do-save:hover:not(:disabled) {
    background: linear-gradient(135deg, #00a0ff, #0070dd);
  }
  #btn-do-save:disabled { opacity: 0.5; cursor: wait; }

  #status {
    display: none; margin-top: 10px;
    font-size: 11px; line-height: 1.45; color: #64748b;
  }
  #status.show { display: block; }
  #status.ok   { color: #22c55e; }
  #status.err  { color: #ef4444; }

  .cid-mono {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 9px; color: #475569;
    word-break: break-all; margin-top: 4px;
  }
</style>

<div id="panel">
  <div class="p-title" id="p-title">Save This Page</div>
  <div class="mode-row">
    <button class="mode-btn active" id="m-full">📦 Full Save</button>
    <button class="mode-btn"        id="m-ai">🤖 AI Summary</button>
  </div>
  <div class="mode-desc" id="m-desc">${MODE_DESCS.full}</div>
  <button id="btn-do-save">Save Now</button>
  <div id="status"></div>
</div>

<button id="fab" title="Save to FilImpact">💾</button>
`;

  document.documentElement.appendChild(host);
  _bindFabEvents();
}

function _bindFabEvents() {
  const fab    = fabShadow.getElementById('fab');
  const panel  = fabShadow.getElementById('panel');
  const pTitle = fabShadow.getElementById('p-title');
  const mFull  = fabShadow.getElementById('m-full');
  const mAI    = fabShadow.getElementById('m-ai');
  const mDesc  = fabShadow.getElementById('m-desc');
  const btnSave = fabShadow.getElementById('btn-do-save');
  const status  = fabShadow.getElementById('status');

  pTitle.textContent = document.title || window.location.hostname;

  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });

  document.addEventListener('click', () => panel.classList.remove('open'), { capture: true });

  mFull.addEventListener('click', () => {
    currentMode = 'full';
    mFull.classList.add('active');
    mAI.classList.remove('active');
    mDesc.textContent = MODE_DESCS.full;
  });

  mAI.addEventListener('click', () => {
    currentMode = 'ai_summary';
    mAI.classList.add('active');
    mFull.classList.remove('active');
    mDesc.textContent = MODE_DESCS.ai_summary;
  });

  btnSave.addEventListener('click', () => {
    if (!isSaving) _doSave(fab, btnSave, status);
  });
}

async function _doSave(fab, btnSave, statusEl) {
  isSaving = true;
  btnSave.disabled = true;
  btnSave.textContent = 'Saving…';
  fab.classList.add('saving');
  _setStatus(statusEl, '⏳ Sending to backend…', '');

  try {
    const pageData = _extractPageData();

    const resp = await _msgBackground({
      action: 'saveToBackend',
      mode: currentMode,
      page: pageData,
    });

    if (resp?.error) throw new Error(resp.error);
    if (!resp?.job_id) throw new Error('Backend did not return a job ID');

    _setStatus(statusEl, `⏳ Queued (${resp.job_id.slice(0, 8)}…)`, '');

    const result = await _pollUntilDone(resp.job_id, statusEl);

    fab.classList.remove('saving');
    fab.classList.add('done');
    statusEl.innerHTML =
      `✓ Saved!<div class="cid-mono">${result.cid || ''}</div>`;
    statusEl.className = 'show ok';
    btnSave.textContent = 'Saved ✓';

    setTimeout(() => {
      fab.classList.remove('done');
      btnSave.textContent = 'Save Now';
      btnSave.disabled = false;
      isSaving = false;
    }, 4000);
  } catch (err) {
    fab.classList.remove('saving');
    fab.classList.add('error');
    _setStatus(statusEl, `✕ ${err.message}`, 'err');
    btnSave.textContent = 'Retry';
    btnSave.disabled = false;
    isSaving = false;
    setTimeout(() => fab.classList.remove('error'), 3000);
  }
}

async function _pollUntilDone(jobId, statusEl) {
  const STEP_LABELS = {
    packaging:    '⏳ Packaging…',
    encrypting:   '🔒 Encrypting…',
    storing:      '☁ Storing…',
    ai_extraction:'🤖 AI analyzing…',
    embedding:    '🔗 Generating embeddings…',
  };

  for (let i = 0; i < 90; i++) {
    await _sleep(2000);

    const resp = await _msgBackground({ action: 'getJobStatus', jobId });
    if (resp?.error) throw new Error(resp.error);

    const { status, step, cid, error } = resp || {};

    if (status === 'complete') return resp;
    if (status === 'failed') throw new Error(error || 'Processing failed');
    if (step) _setStatus(statusEl, STEP_LABELS[step] || `⏳ ${step}…`, '');
  }
  throw new Error('Timed out waiting for backend');
}

function _extractPageData() {
  const MAX_HTML = 200 * 1024;
  const html = document.documentElement.outerHTML;
  return {
    url: window.location.href,
    title: document.title,
    html: html.length > MAX_HTML ? html.slice(0, MAX_HTML) + '<!-- truncated -->' : html,
    text: (document.body?.innerText || '').slice(0, 50 * 1024),
    timestamp: new Date().toISOString(),
    html_size: html.length,
  };
}

function _setStatus(el, text, cls) {
  el.textContent = text;
  el.className = 'show' + (cls ? ` ${cls}` : '');
}

function _msgBackground(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Inject after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSaveButton);
} else {
  injectSaveButton();
}
