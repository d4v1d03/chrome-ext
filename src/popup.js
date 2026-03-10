import { StorageAgent } from './storage/agent.js';

// ── State ─────────────────────────────────────────────────────────────────────

let settings = { privateKey: '', network: 'calibration' };
let currentView = 'main';
let isArchiving = false;
let currentTabInfo = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  loadCurrentPage();
  loadArchiveHistory();
  initSettingsView();
  bindEvents();
  updateMainView();
});

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['privateKey', 'network'], (result) => {
      settings = {
        privateKey: result.privateKey || '',
        network: result.network || 'calibration',
      };
      resolve();
    });
  });
}

async function saveSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { privateKey: settings.privateKey, network: settings.network },
      resolve
    );
  });
}

// ── Current Page Info ─────────────────────────────────────────────────────────

async function loadCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentTabInfo = { title: tab.title || tab.url, url: tab.url };

    $('page-title').textContent = tab.title || tab.url;
    $('page-url').textContent = formatUrl(tab.url);
    $('page-time').textContent = new Date().toLocaleTimeString();
    $('page-size').textContent = 'HTML ~?KB';

    // Try to get more info from content script
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'extractPage' }, (response) => {
        if (chrome.runtime.lastError || !response?.success) return;
        const sizeKB = Math.round(response.htmlSize / 1024);
        $('page-size').textContent = `HTML ~${sizeKB}KB`;
      });
    } catch (_) {
      // Content script not ready yet — that's OK, we'll call it during archive
    }
  } catch (err) {
    $('page-title').textContent = 'Unable to access page';
  }
}

// ── Archive History ───────────────────────────────────────────────────────────

async function loadArchiveHistory() {
  const response = await msgBackground({ action: 'getArchives' });
  const archives = response?.archives || [];
  renderArchiveList(archives);
}

function renderArchiveList(archives) {
  const list = $('archive-list');
  $('archive-count').textContent = archives.length;

  if (archives.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🗄</div>
        No archives yet. Click the button above!
      </div>`;
    return;
  }

  list.innerHTML = archives
    .map(
      (item) => `
    <div class="archive-item">
      <div class="archive-item-icon">📄</div>
      <div class="archive-item-info">
        <div class="archive-item-title" title="${escHtml(item.title)}">${escHtml(truncate(item.title, 40))}</div>
        <div class="archive-item-cid" title="${escHtml(item.pieceCid)}">${truncate(item.pieceCid, 28)}</div>
      </div>
      <div class="archive-item-actions">
        <button class="btn-icon-xs copy-cid-btn" title="Copy CID" data-cid="${escHtml(item.pieceCid)}">⧉</button>
        <a class="btn-icon-xs" title="View on IPFS" href="https://ipfs.io/ipfs/${escHtml(item.pieceCid)}" target="_blank">↗</a>
      </div>
    </div>`
    )
    .join('');

  // Bind copy buttons
  list.querySelectorAll('.copy-cid-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      copyToClipboard(btn.dataset.cid);
    });
  });
}

// ── Settings View ─────────────────────────────────────────────────────────────

function initSettingsView() {
  $('input-private-key').value = settings.privateKey;
  setNetworkSelection(settings.network);
  updateWalletInfo();
}

function setNetworkSelection(network) {
  ['calibration', 'mainnet'].forEach((net) => {
    const el = $(`net-${net}`);
    if (el) el.classList.toggle('selected', net === network);
  });
}

function updateWalletInfo() {
  const pk = $('input-private-key').value.trim();
  const walletSection = $('wallet-info-section');
  const faucetLinks = $('faucet-links');

  if (pk && pk.startsWith('0x') && pk.length >= 64) {
    try {
      // Derive address from private key without importing Synapse
      // We use the StorageAgent just to get address
      const agent = new StorageAgent(pk, settings.network);
      const addr = agent.getAddress();
      $('wallet-address').textContent = truncateAddr(addr);
      $('wallet-network').textContent =
        settings.network === 'calibration' ? 'Filecoin Calibration' : 'Filecoin Mainnet';
      walletSection.style.display = 'block';
      faucetLinks.style.display = settings.network === 'calibration' ? 'flex' : 'none';
    } catch (_) {
      walletSection.style.display = 'none';
    }
  } else {
    walletSection.style.display = 'none';
  }
}

// ── Event Binding ─────────────────────────────────────────────────────────────

function bindEvents() {
  // Header settings button
  $('btn-settings').addEventListener('click', () => showView('settings'));

  // Setup banner button
  $('btn-go-setup').addEventListener('click', () => showView('settings'));

  // Archive button
  $('btn-archive').addEventListener('click', runArchive);

  // Copy CID from success section
  $('btn-copy-cid').addEventListener('click', () => {
    copyToClipboard($('result-cid').textContent);
  });

  // Settings — back button
  $('btn-back').addEventListener('click', () => {
    showView('main');
    updateMainView();
  });

  // Settings — network selection
  $('net-calibration').addEventListener('click', () => {
    settings.network = 'calibration';
    setNetworkSelection('calibration');
    updateWalletInfo();
  });
  $('net-mainnet').addEventListener('click', () => {
    settings.network = 'mainnet';
    setNetworkSelection('mainnet');
    updateWalletInfo();
  });

  // Settings — private key input
  $('input-private-key').addEventListener('input', () => {
    updateWalletInfo();
  });

  // Settings — save
  $('btn-save-settings').addEventListener('click', async () => {
    const pk = $('input-private-key').value.trim();
    if (!pk) {
      showSaveFeedback('Private key cannot be empty', 'error');
      return;
    }
    if (!pk.startsWith('0x')) {
      showSaveFeedback('Key must start with 0x', 'error');
      return;
    }

    settings.privateKey = pk;
    await saveSettings();
    showSaveFeedback('✓ Settings saved!', 'success');

    setTimeout(() => {
      showView('main');
      updateMainView();
    }, 800);
  });
}

// ── Main View State ───────────────────────────────────────────────────────────

function updateMainView() {
  const hasKey = Boolean(settings.privateKey);
  $('setup-banner').classList.toggle('visible', !hasKey);
  $('btn-archive').disabled = !hasKey || isArchiving;

  if (hasKey && !isArchiving) {
    $('btn-archive-label').textContent = 'Archive This Page';
    $('btn-archive-icon').textContent = '📦';
    $('btn-archive').classList.remove('loading');
  }
}

// ── Archive Flow ──────────────────────────────────────────────────────────────

async function runArchive() {
  if (isArchiving || !settings.privateKey) return;

  isArchiving = true;
  $('btn-archive').disabled = true;
  $('btn-archive').classList.add('loading');
  $('btn-archive-label').textContent = 'Archiving...';
  $('btn-archive-icon').textContent = '⏳';

  hideAll(['error-section', 'success-section']);
  showProgress(true);
  setProgress(5);

  try {
    // Step 1: Extract page
    setStep('extract', 'active');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Cannot access the current tab');

    let pageData;
    try {
      pageData = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'extractPage' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!response?.success) {
            reject(new Error(response?.error || 'Content script failed'));
          } else {
            resolve(response);
          }
        });
      });
    } catch (_) {
      // Fallback: inject script programmatically
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageDataInline,
      });
      pageData = results[0]?.result;
      if (!pageData?.success) throw new Error('Could not extract page content');
    }

    setStep('extract', 'done');
    setProgress(20);

    // Step 2: Package archive
    setStep('package', 'active');
    const archivePayload = {
      metadata: {
        url: pageData.url,
        title: pageData.title,
        timestamp: pageData.timestamp,
        archivedAt: new Date(pageData.timestamp).toISOString(),
        version: '1.0',
        source: 'filarchive-chrome-extension',
      },
      content: {
        html: pageData.html,
        text: pageData.text,
      },
    };

    const jsonStr = JSON.stringify(archivePayload);
    const bytes = new TextEncoder().encode(jsonStr);
    const sizeKB = Math.round(bytes.length / 1024);
    $('step-upload-label').textContent = `Uploading to Filecoin (${sizeKB}KB)`;

    setStep('package', 'done');
    setProgress(35);

    // Step 3: Balance check / prepare
    setStep('balance', 'active');
    const agent = new StorageAgent(settings.privateKey, settings.network);

    try {
      await agent.prepare(bytes.length);
    } catch (prepErr) {
      const msg = prepErr?.message || String(prepErr);
      if (msg.toLowerCase().includes('insufficient') || msg.toLowerCase().includes('balance')) {
        throw new FundingError(msg, settings.network);
      }
      throw prepErr;
    }

    setStep('balance', 'done');
    setProgress(50);

    // Step 4: Upload
    setStep('upload', 'active');

    let lastProgress = 50;
    const pieceCid = await agent.store(
      bytes,
      {
        url: pageData.url,
        title: pageData.title,
        timestamp: pageData.timestamp,
      },
      {
        onProgress: (uploaded, total) => {
          if (total > 0) {
            const pct = 50 + Math.round((uploaded / total) * 25);
            if (pct > lastProgress) {
              lastProgress = pct;
              setProgress(pct);
              $('step-upload-label').textContent = `Uploading… ${Math.round((uploaded / total) * 100)}%`;
            }
          }
        },
        onStored: () => {
          setProgress(80);
          setStep('upload', 'done');
          setStep('confirm', 'active');
        },
        onPiecesConfirmed: () => {
          setProgress(95);
        },
      }
    );

    // Step 5: Confirmed
    setStep('confirm', 'done');
    setProgress(100);

    // Save to history
    await msgBackground({
      action: 'saveArchive',
      archive: {
        pieceCid,
        url: pageData.url,
        title: pageData.title,
        timestamp: Date.now(),
        network: settings.network,
        sizeKB,
      },
    });

    // Show success
    showProgress(false);
    showSuccess(pieceCid);
    await loadArchiveHistory();
  } catch (err) {
    showProgress(false);
    showError(err);
  } finally {
    isArchiving = false;
    $('btn-archive').disabled = false;
    $('btn-archive').classList.remove('loading');
    $('btn-archive-label').textContent = 'Archive This Page';
    $('btn-archive-icon').textContent = '📦';
  }
}

// Inline extractor function injected via chrome.scripting.executeScript
function extractPageDataInline() {
  const MAX_HTML = 200 * 1024;
  const MAX_TEXT = 50 * 1024;
  try {
    const html = document.documentElement.outerHTML;
    const text = document.body ? document.body.innerText : '';
    return {
      url: window.location.href,
      title: document.title || window.location.hostname,
      html: html.length > MAX_HTML ? html.slice(0, MAX_HTML) + '\n<!-- [truncated] -->' : html,
      text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text,
      timestamp: Date.now(),
      htmlSize: html.length,
      success: true,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

class FundingError extends Error {
  constructor(message, network) {
    super(message);
    this.name = 'FundingError';
    this.network = network;
  }
}

// ── UI Helpers ────────────────────────────────────────────────────────────────

function showView(name) {
  currentView = name;
  ['main', 'settings'].forEach((v) => {
    $(`view-${v}`).classList.toggle('active', v === name);
  });
  if (name === 'settings') initSettingsView();
}

function showProgress(visible) {
  $('progress-section').classList.toggle('visible', visible);
  if (visible) resetSteps();
}

function showSuccess(pieceCid) {
  $('result-cid').textContent = pieceCid;
  const viewLink = $('btn-view-archive');
  viewLink.href = `https://ipfs.io/ipfs/${pieceCid}`;
  $('success-section').classList.add('visible');
}

function showError(err) {
  const msg = err?.message || String(err);
  $('error-msg').textContent = msg;

  let hint = '';
  if (err instanceof FundingError || msg.toLowerCase().includes('balance') || msg.toLowerCase().includes('insufficient')) {
    if (err.network === 'calibration') {
      hint = `Need testnet tokens? <a href="https://faucet.calibnet.chainsafe-fil.io/" target="_blank">Get tFIL</a> · <a href="https://faucet.secured.finance/" target="_blank">Get tUSDFC</a>`;
    } else {
      hint = 'Deposit USDFC and ensure you have FIL for gas.';
    }
  } else if (msg.toLowerCase().includes('private key') || msg.toLowerCase().includes('0x')) {
    hint = `Check your private key in <a href="#" id="link-to-settings">Settings</a>.`;
  } else if (msg.toLowerCase().includes('connect') || msg.toLowerCase().includes('network')) {
    hint = 'Check your internet connection and try again.';
  }

  $('error-hint').innerHTML = hint;
  $('error-section').classList.add('visible');

  // Wire up "link-to-settings" if present
  const lts = document.getElementById('link-to-settings');
  if (lts) lts.addEventListener('click', (e) => { e.preventDefault(); showView('settings'); });
}

function hideAll(ids) {
  ids.forEach((id) => $(`${id}`).classList.remove('visible'));
}

function setStep(id, state) {
  const el = $(`step-${id}`);
  if (!el) return;
  el.classList.remove('active', 'done', 'error');
  if (state) el.classList.add(state);

  const icon = el.querySelector('.step-icon');
  if (!icon) return;

  if (state === 'active') {
    icon.innerHTML = '<div class="spinner"></div>';
  } else if (state === 'done') {
    icon.textContent = '✓';
  } else if (state === 'error') {
    icon.textContent = '✕';
  } else {
    icon.textContent = el.dataset.num || '';
  }
}

function resetSteps() {
  const nums = { extract: '1', package: '2', balance: '3', upload: '4', confirm: '5' };
  Object.entries(nums).forEach(([id, num]) => {
    const el = $(`step-${id}`);
    if (!el) return;
    el.dataset.num = num;
    el.classList.remove('active', 'done', 'error');
    const icon = el.querySelector('.step-icon');
    if (icon) icon.textContent = num;
  });
  setProgress(0);
}

function setProgress(pct) {
  $('progress-bar').style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function showSaveFeedback(msg, type) {
  const el = $('save-feedback');
  el.textContent = msg;
  el.style.color = type === 'error' ? '#ef4444' : '#22c55e';
  setTimeout(() => { el.textContent = ''; }, 3000);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    const toast = $('copied-toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function $(id) {
  return document.getElementById(id);
}

function msgBackground(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

function formatUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function truncateAddr(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
