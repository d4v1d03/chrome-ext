import { StorageAgent } from './storage/agent.js';

// ── State ─────────────────────────────────────────────────────────────────────

let settings = {
  privateKey: '',
  network: 'calibration',
  backendUrl: '',
  backendApiKey: '',
};
let saveMode = 'full';       // 'full' | 'ai_summary' | 'agentic'
let currentView = 'main';
let isArchiving = false;
let currentTabInfo = null;
let lastJobId = null;        // track last completed job for Hypercert generation

const MODE_INFO = {
  full:      'Captures the complete HTML and stores it to decentralized storage.',
  ai_summary:'AI extracts key content and stores a compressed, searchable summary.',
  agentic:   '4-agent pipeline: Extract → Validate → Score → Hypercert. Full RAG indexing.',
};

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  loadCurrentPage();
  loadArchiveHistory();
  initSettingsView();
  initModeSelector();
  bindEvents();
  bindSearchEvents();
  updateMainView();
});

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['privateKey', 'network', 'backendUrl', 'backendApiKey'],
      (result) => {
        settings = {
          privateKey:    result.privateKey    || '',
          network:       result.network       || 'calibration',
          backendUrl:    result.backendUrl    || '',
          backendApiKey: result.backendApiKey || '',
        };
        resolve();
      }
    );
  });
}

async function saveSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        privateKey:    settings.privateKey,
        network:       settings.network,
        backendUrl:    settings.backendUrl,
        backendApiKey: settings.backendApiKey,
      },
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

    try {
      chrome.tabs.sendMessage(tab.id, { action: 'extractPage' }, (response) => {
        if (chrome.runtime.lastError || !response?.success) return;
        const sizeKB = Math.round(response.htmlSize / 1024);
        $('page-size').textContent = `HTML ~${sizeKB}KB`;
      });
    } catch (_) {
      // Content script not ready — will be called during archive
    }
  } catch (_) {
    $('page-title').textContent = 'Unable to access page';
  }
}

// ── Archive History ───────────────────────────────────────────────────────────

async function loadArchiveHistory() {
  const response = await msgBackground({ action: 'getArchives' });
  renderArchiveList(response?.archives || []);
}

function renderArchiveList(archives) {
  const list = $('archive-list');
  $('archive-count').textContent = archives.length;

  if (!archives.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🗄</div>
        No archives yet. Click the button above!
      </div>`;
    return;
  }

  list.innerHTML = archives
    .map((item) => {
      const m = item.mode || 'full';
      const modeClass = m === 'ai_summary' ? 'ai' : m === 'agentic' ? 'agentic' : 'full';
      const modeLabel = m === 'ai_summary' ? 'AI' : m === 'agentic' ? '⚡ Agentic' : 'Full';
      const icon      = m === 'agentic' ? '🧠' : m === 'ai_summary' ? '🤖' : '📄';
      const cid     = item.pieceCid || item.cid || '';
      const isMock  = cid.startsWith('mock-cid-');
      const jobId   = item.jobId || item.job_id || '';
      const viewUrl = isMock
        ? (jobId && settings.backendUrl
            ? `${settings.backendUrl.replace(/\/$/,'')}/api/view/${jobId}`
            : item.url || '#')
        : `https://ipfs.io/ipfs/${cid}`;
      const viewTitle = isMock
        ? (jobId && settings.backendUrl ? 'View saved content' : 'Open original page')
        : 'View on IPFS';
      const cidLabel  = isMock ? (item.url ? truncate(item.url, 26) : truncate(cid, 26)) : truncate(cid, 26);
      return `
    <div class="archive-item">
      <div class="archive-item-icon">${icon}</div>
      <div class="archive-item-info">
        <div class="archive-item-title" title="${escHtml(item.title)}">
          ${escHtml(truncate(item.title, 32))}
          <span class="mode-badge ${modeClass}">${modeLabel}</span>
        </div>
        <div class="archive-item-cid" title="${escHtml(cid)}">${cidLabel}</div>
      </div>
      <div class="archive-item-actions">
        <button class="btn-icon-xs copy-cid-btn" title="Copy CID" data-cid="${escHtml(cid)}">⧉</button>
        <a class="btn-icon-xs" title="${escHtml(viewTitle)}" href="${escHtml(viewUrl)}" target="_blank">↗</a>
      </div>
    </div>`;
    })
    .join('');

  list.querySelectorAll('.copy-cid-btn').forEach((btn) => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.cid));
  });
}

// ── Mode Selector ─────────────────────────────────────────────────────────────

function initModeSelector() {
  updateModeUI();
}

function updateModeUI() {
  $('pill-full').classList.toggle('active',    saveMode === 'full');
  $('pill-ai').classList.toggle('active',      saveMode === 'ai_summary');
  $('pill-agentic').classList.toggle('active', saveMode === 'agentic');
  $('mode-info-text').textContent = MODE_INFO[saveMode];

  const needsBackend = (saveMode === 'ai_summary' || saveMode === 'agentic') && !settings.backendUrl;
  $('mode-warn').classList.toggle('visible', needsBackend);
  $('btn-archive').disabled = isArchiving || (!settings.privateKey && !settings.backendUrl) || needsBackend;
}

// ── Settings View ─────────────────────────────────────────────────────────────

function initSettingsView() {
  $('input-private-key').value   = settings.privateKey;
  $('input-backend-url').value   = settings.backendUrl;
  $('input-backend-api-key').value = settings.backendApiKey;
  setNetworkSelection(settings.network);
  updateWalletInfo();
}

function setNetworkSelection(network) {
  ['calibration', 'mainnet'].forEach((net) => {
    $(`net-${net}`)?.classList.toggle('selected', net === network);
  });
}

function updateWalletInfo() {
  const pk = $('input-private-key').value.trim();
  const walletSection = $('wallet-info-section');
  const faucetLinks   = $('faucet-links');

  if (pk && pk.startsWith('0x') && pk.length >= 64) {
    try {
      const agent = new StorageAgent(pk, settings.network);
      const addr  = agent.getAddress();
      $('wallet-address').textContent = truncateAddr(addr);
      $('wallet-network').textContent =
        settings.network === 'calibration' ? 'Filecoin Calibration' : 'Filecoin Mainnet';
      walletSection.style.display = 'block';
      faucetLinks.style.display   = settings.network === 'calibration' ? 'flex' : 'none';
    } catch (_) {
      walletSection.style.display = 'none';
    }
  } else {
    walletSection.style.display = 'none';
  }
}

// ── Event Binding ─────────────────────────────────────────────────────────────

function bindEvents() {
  $('btn-settings').addEventListener('click', () => showView('settings'));
  $('btn-go-setup').addEventListener('click', () => showView('settings'));
  $('btn-archive').addEventListener('click', onArchiveClick);

  $('btn-copy-cid').addEventListener('click', () =>
    copyToClipboard($('result-cid').textContent)
  );

  $('btn-back').addEventListener('click', () => {
    showView('main');
    updateMainView();
  });

  // Mode pills
  $('pill-full').addEventListener('click', () => {
    saveMode = 'full';
    updateModeUI();
  });
  $('pill-ai').addEventListener('click', () => {
    saveMode = 'ai_summary';
    updateModeUI();
  });
  $('pill-agentic').addEventListener('click', () => {
    saveMode = 'agentic';
    updateModeUI();
  });

  // Impact Claim button
  $('btn-generate-impact').addEventListener('click', onGenerateImpact);

  // Link in mode-warn
  document.addEventListener('click', (e) => {
    if (e.target.id === 'link-to-settings-mode') {
      e.preventDefault();
      showView('settings');
    }
  });

  // Network opts
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

  $('input-private-key').addEventListener('input', updateWalletInfo);

  // Save settings
  $('btn-save-settings').addEventListener('click', async () => {
    const pk = $('input-private-key').value.trim();
    if (pk && !pk.startsWith('0x')) {
      showSaveFeedback('Private key must start with 0x', 'error');
      return;
    }

    settings.privateKey    = pk;
    settings.backendUrl    = $('input-backend-url').value.trim();
    settings.backendApiKey = $('input-backend-api-key').value.trim();

    await saveSettings();
    showSaveFeedback('✓ Settings saved!', 'success');
    setTimeout(() => { showView('main'); updateMainView(); }, 800);
  });
}

// ── Main View State ───────────────────────────────────────────────────────────

function updateMainView() {
  const hasKey     = Boolean(settings.privateKey);
  const hasBackend = Boolean(settings.backendUrl);
  const ready      = hasKey || hasBackend;

  $('setup-banner').classList.toggle('visible', !ready);
  $('btn-archive').disabled = !ready || isArchiving;

  if (ready && !isArchiving) {
    $('btn-archive-label').textContent = 'Archive This Page';
    $('btn-archive-icon').textContent  = '📦';
    $('btn-archive').classList.remove('loading');
  }
  updateModeUI();
}

// ── Semantic Search ───────────────────────────────────────────────────────────

function bindSearchEvents() {
  const input = $('search-input');
  if (!input) return;

  let debounceTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) {
      $('search-results-list').classList.remove('visible');
      $('search-results-list').innerHTML = '';
      return;
    }
    debounceTimer = setTimeout(() => runSearch(q), 500);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      $('search-results-list').classList.remove('visible');
    }
  });
}

async function runSearch(q) {
  if (!settings.backendUrl) return;

  const list = $('search-results-list');
  list.innerHTML = '<div class="search-result-item" style="color:#475569">Searching…</div>';
  list.classList.add('visible');

  try {
    const headers = {};
    if (settings.backendApiKey) headers['X-API-Key'] = settings.backendApiKey;
    const base = settings.backendUrl.replace(/\/$/, '');
    const resp = await fetch(
      `${base}/api/search?q=${encodeURIComponent(q)}&top_k=5`,
      { headers }
    );

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.results?.length) {
      list.innerHTML = '<div class="search-result-item" style="color:#475569">No results found.</div>';
      return;
    }

    list.innerHTML = data.results.map((r) => {
      const score = Math.round((r.score || 0) * 100);
      const snippet = r.summary_snippet ? escHtml(truncate(r.summary_snippet, 80)) : '';
      return `
        <div class="search-result-item">
          <div class="sr-title">
            ${escHtml(truncate(r.title || r.url || 'Untitled', 48))}
            <span class="sr-score">${score}%</span>
          </div>
          ${snippet ? `<div class="sr-meta">${snippet}</div>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="search-result-item" style="color:#ef4444">Error: ${escHtml(err.message)}</div>`;
  }
}

// ── Archive Dispatcher ────────────────────────────────────────────────────────

async function onArchiveClick() {
  if (isArchiving) return;
  if (saveMode === 'agentic' || saveMode === 'ai_summary') {
    await runBackendSave();
  } else if (settings.backendUrl) {
    await runBackendSave();
  } else {
    await runDirectFilecoin();
  }
}

// ── Backend Save Flow ─────────────────────────────────────────────────────────

async function runBackendSave() {
  if (isArchiving) return;

  isArchiving = true;
  setBtnLoading(true);
  hideAll(['error-section', 'success-section']);
  showBackendProgress(true);
  setBProgress(10);

  try {
    // Step 1: Extract page
    setBStep('send', 'active');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Cannot access the current tab');

    const pageData = await extractPage(tab.id);
    setBStep('send', 'done');
    setBProgress(25);

    // Step 2: Send to backend
    setBStep('process', 'active');
    $('bstep-process-label').textContent =
      saveMode === 'ai_summary' ? 'AI analyzing…' : 'Processing…';

    const sendResp = await msgBackground({
      action: 'saveToBackend',
      mode:   saveMode,
      page:   pageData,
    });

    if (sendResp?.error) throw new Error(sendResp.error);
    if (!sendResp?.job_id) throw new Error('Backend did not return a job ID');

    // Step 3: Poll until done
    setBProgress(35);
    const result = await pollBackendStatus(sendResp.job_id);

    setBStep('process', 'done');
    setBStep('store', 'done');
    setBProgress(100);

    // Attach job_id to result so success panel can use it for Hypercert
    result.job_id = sendResp.job_id;

    // Save to local history
    await msgBackground({
      action:  'saveArchive',
      archive: {
        pieceCid:  result.cid,
        cid:       result.cid,
        jobId:     sendResp.job_id || '',
        job_id:    sendResp.job_id || '',
        url:       pageData.url,
        title:     pageData.title,
        timestamp: Date.now(),
        mode:      saveMode,
        network:   'backend',
        job_id:    sendResp.job_id,
      },
    });

    // Show success
    showBackendProgress(false);
    setBStep('done', 'done');
    showSuccessBackend(result);
    await loadArchiveHistory();
  } catch (err) {
    showBackendProgress(false);
    showError(err);
  } finally {
    isArchiving = false;
    setBtnLoading(false);
  }
}

async function pollBackendStatus(jobId) {
  const STEP_TO_LABEL = {
    packaging:          'Packaging…',
    encrypting:         'Encrypting…',
    encrypting_final:   'Encrypting final archive…',
    storing:            'Storing to Filecoin…',
    ai_extraction:      'AI analyzing…',
    embedding:          'Generating embeddings…',
    agent_extracting:   '🔬 Extracting structured data…',
    agent_rag_lookup:   '🔍 RAG lookup…',
    agent_validating:   '✅ Validating credibility…',
    agent_scoring:      '📊 Scoring impact…',
    agent_generating:   '🌱 Generating Hypercert…',
  };

  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const resp = await msgBackground({ action: 'getJobStatus', jobId });
    if (resp?.error) throw new Error(resp.error);

    const { status, step, error } = resp || {};

    if (status === 'complete') return resp;
    if (status === 'failed')   throw new Error(error || 'Backend processing failed');

    if (step) {
      const label = STEP_TO_LABEL[step];
      if (label) $('bstep-process-label').textContent = label;

      if (step === 'storing' || step === 'encrypting') {
        setBStep('process', 'done');
        setBStep('store', 'active');
        setBProgress(75);
      } else {
        setBProgress(50);
      }
    }
  }
  throw new Error('Timed out waiting for backend (>3 min)');
}

function showSuccessBackend(result) {
  const cid    = result.cid || '';
  const isMock = cid.startsWith('mock-cid-');
  const jobId  = result.job_id || lastJobId || '';
  $('result-cid').textContent = isMock ? (result.url || cid) : cid;
  if (isMock && jobId && settings.backendUrl) {
    $('btn-view-archive').href  = `${settings.backendUrl.replace(/\/$/,'')}/api/view/${jobId}`;
    $('btn-view-archive').title = 'View saved content';
  } else if (isMock && result.url) {
    $('btn-view-archive').href  = result.url;
    $('btn-view-archive').title = 'Open original page';
  } else {
    $('btn-view-archive').href  = `https://ipfs.io/ipfs/${cid}`;
    $('btn-view-archive').title = 'View on IPFS';
  }

  const MODE_TITLES = {
    full:      'Page Archived!',
    ai_summary:'AI Summary Archived!',
    agentic:   'Agentic Archive Complete!',
  };
  $('success-title').textContent = MODE_TITLES[result.mode] || 'Page Archived!';

  // AI Summary section
  const summarySection = $('ai-summary-section');
  if (result.summary) {
    renderAISummary(result.summary, result.key_points, result.topics);
    summarySection.classList.add('visible');
  } else {
    summarySection.classList.remove('visible');
  }

  // Agentic scores panel
  const scoresPanel = $('scores-panel');
  if (result.scores) {
    renderScores(result.scores);
    scoresPanel.classList.add('visible');
  } else {
    scoresPanel.classList.remove('visible');
  }

  // Impact type tag
  if (result.impact_type) {
    $('impact-type-tag').textContent = result.impact_type.replace(/_/g, ' ');
    $('impact-type-row').style.display = 'flex';
  } else {
    $('impact-type-row').style.display = 'none';
  }

  // Show Hypercert button when backend is connected (any mode can generate claims)
  const hcPanel = $('hypercert-panel');
  if (settings.backendUrl && result.job_id) {
    lastJobId = result.job_id;
    hcPanel.classList.add('visible');
    $('hypercert-result').classList.remove('visible');
    $('btn-generate-impact').disabled = false;
    $('btn-generate-impact').textContent = '🌱 Generate Impact Claim';
  } else {
    hcPanel.classList.remove('visible');
  }

  $('success-section').classList.add('visible');
}

function renderAISummary(summary, keyPoints, topics) {
  // summary can be a dict (ai_summary mode) or a plain string (agentic mode passes string)
  const summaryText = typeof summary === 'string'
    ? summary
    : (summary?.summary || '');
  $('ai-summary-text').textContent = summaryText;

  const pts = $('ai-key-points');
  const ptList = keyPoints || summary?.key_points || [];
  pts.innerHTML = ptList
    .slice(0, 6)
    .map((p) => `<div class="ai-key-point">${escHtml(p)}</div>`)
    .join('');

  const tags = $('ai-topics');
  const tagList = topics || summary?.topics || [];
  tags.innerHTML = tagList
    .map((t) => `<span class="ai-topic-tag">${escHtml(t)}</span>`)
    .join('');
}

function renderScores(scores) {
  const fields = [
    ['sc-impact',      scores.impact],
    ['sc-confidence',  scores.confidence],
    ['sc-novelty',     scores.novelty],
    ['sc-credibility', scores.credibility],
  ];
  fields.forEach(([id, val]) => {
    const el = $(id);
    if (!el) return;
    el.textContent = val != null ? val : '–';
    el.className   = 'score-val';
    if (val != null) {
      if (val >= 70)      el.classList.add('high');
      else if (val >= 40) el.classList.add('medium');
      else                el.classList.add('low');
    }
  });
}

// ── Impact Claim / Hypercert ──────────────────────────────────────────────────

async function onGenerateImpact() {
  if (!lastJobId || !settings.backendUrl) return;

  const btn = $('btn-generate-impact');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';

  // Grab the current tab's URL + title to send as page metadata
  let tabUrl = '', tabTitle = '', tabText = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabUrl   = tab?.url   || '';
    tabTitle = tab?.title || '';
  } catch (_) { /* popup may not have tab access in some cases */ }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.backendApiKey) headers['X-API-Key'] = settings.backendApiKey;

    const base   = settings.backendUrl.replace(/\/$/, '');
    const params = new URLSearchParams();
    if (tabUrl)   params.set('page_url',   tabUrl);
    if (tabTitle) params.set('page_title', tabTitle);

    const resp = await fetch(`${base}/api/hypercert/${lastJobId}?${params}`, {
      method: 'POST',
      headers,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    renderHypercert(data);
    btn.textContent = '✓ Impact Claim Ready';
  } catch (err) {
    btn.disabled = false;

    // Auto-retry with ?mock=true if AI quota / auth errors are detected
    const errMsg = err.message || '';
    if (errMsg.includes('429') || errMsg.includes('insufficient_quota') ||
        errMsg.includes('401') || errMsg.includes('invalid_api_key')) {
      btn.textContent = '⏳ Using Demo Mode…';
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (settings.backendApiKey) headers['X-API-Key'] = settings.backendApiKey;
        const base   = settings.backendUrl.replace(/\/$/, '');
        const params = new URLSearchParams({ mock: 'true' });
        if (tabUrl)   params.set('page_url',   tabUrl);
        if (tabTitle) params.set('page_title', tabTitle);

        const resp2 = await fetch(`${base}/api/hypercert/${lastJobId}?${params}`, {
          method: 'POST', headers,
        });
        if (resp2.ok) {
          const data2 = await resp2.json();
          renderHypercert(data2);
          btn.textContent = '✓ Demo Claim Ready';
          return;
        }
      } catch (_) { /* fall through to normal error display */ }
    }

    btn.textContent = '✕ Failed — see details below';

    const resultEl = $('hypercert-result');
    resultEl.classList.add('visible');
    resultEl.innerHTML = `
      <div style="color:#ef4444;font-size:11px;font-weight:700;margin-bottom:6px">
        ✕ Hypercert generation failed
      </div>
      <div style="font-size:10px;color:#94a3b8;line-height:1.5;word-break:break-word;
                  max-height:120px;overflow-y:auto;background:rgba(0,0,0,0.3);
                  border-radius:5px;padding:8px;">
        ${escHtml(errMsg)}
      </div>
      <div style="font-size:10px;color:#475569;margin-top:6px">
        Tip: Check your uvicorn terminal for the full traceback.
      </div>`;

    setTimeout(() => {
      btn.disabled    = false;
      btn.textContent = '🌱 Retry Impact Claim';
    }, 4000);
  }
}

function renderHypercert(data) {
  const hc   = data.hypercert || {};
  const work = hc.work || {};
  const imp  = hc.impact || {};
  const meta = hc.metadata || {};
  const sim  = data.simulation || {};
  const isMock = hc.mock === true;

  $('hc-work-title').textContent   = work.title || meta.name || '–';
  $('hc-impact-desc').textContent  = imp.description || '–';

  const contribs = (work.contributors || []).join(', ');
  $('hc-contributors').textContent = contribs || 'Unknown';

  const evidence = (meta.evidence || []).find(e => e.type === 'filecoin');
  $('hc-evidence-cid').textContent = evidence?.src || hc.job_id || '–';

  $('hc-sim-note').textContent = sim.message
    ? sim.message.slice(0, 120)
    : 'Simulation complete. Schema valid, not yet minted on-chain.';

  // Inject a "Demo Mode" badge if AI was not used
  const resultEl = $('hypercert-result');
  let mockBanner = resultEl.querySelector('.hc-demo-badge');
  if (isMock) {
    if (!mockBanner) {
      mockBanner = document.createElement('div');
      mockBanner.className = 'hc-demo-badge';
      mockBanner.style.cssText = `
        background: linear-gradient(90deg, #f59e0b, #d97706);
        color: #1c1917; font-size: 10px; font-weight: 700;
        padding: 3px 8px; border-radius: 4px; margin-bottom: 8px;
        display: inline-block; letter-spacing: 0.5px;`;
      resultEl.insertBefore(mockBanner, resultEl.firstChild);
    }
    const reason = hc.mock_reason ? ` — ${hc.mock_reason.slice(0, 80)}` : '';
    mockBanner.textContent = `⚡ DEMO MODE${reason}`;

    // Also show the AI scores that were deterministically generated
    if (hc.scores) renderScores(hc.scores);
    if (meta.impact_type) {
      const itEl = $('impact-type-value');
      if (itEl) itEl.textContent = meta.impact_type.replace(/_/g, ' ');
    }
  } else if (mockBanner) {
    mockBanner.remove();
  }

  resultEl.classList.add('visible');
}

// ── Direct Filecoin Flow (existing) ──────────────────────────────────────────

async function runDirectFilecoin() {
  if (isArchiving || !settings.privateKey) return;

  isArchiving = true;
  setBtnLoading(true);
  hideAll(['error-section', 'success-section']);
  showProgress(true);
  setProgress(5);

  try {
    // Step 1: Extract
    setStep('extract', 'active');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Cannot access the current tab');

    const pageData = await extractPage(tab.id);
    setStep('extract', 'done');
    setProgress(20);

    // Step 2: Package
    setStep('package', 'active');
    const archivePayload = {
      metadata: {
        url:        pageData.url,
        title:      pageData.title,
        timestamp:  pageData.timestamp,
        archivedAt: new Date(pageData.timestamp).toISOString(),
        version:    '1.0',
        source:     'filimpact-chrome-extension',
      },
      content: { html: pageData.html, text: pageData.text },
    };

    const bytes  = new TextEncoder().encode(JSON.stringify(archivePayload));
    const sizeKB = Math.round(bytes.length / 1024);
    $('step-upload-label').textContent = `Uploading to Filecoin (${sizeKB}KB)`;

    setStep('package', 'done');
    setProgress(35);

    // Step 3: Balance
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
    let lastPct = 50;

    const pieceCid = await agent.store(
      bytes,
      { url: pageData.url, title: pageData.title, timestamp: pageData.timestamp },
      {
        onProgress: (uploaded, total) => {
          if (total > 0) {
            const pct = 50 + Math.round((uploaded / total) * 25);
            if (pct > lastPct) {
              lastPct = pct;
              setProgress(pct);
              $('step-upload-label').textContent =
                `Uploading… ${Math.round((uploaded / total) * 100)}%`;
            }
          }
        },
        onStored: () => {
          setProgress(80);
          setStep('upload', 'done');
          setStep('confirm', 'active');
        },
        onPiecesConfirmed: () => setProgress(95),
      }
    );

    // Step 5: Confirmed
    setStep('confirm', 'done');
    setProgress(100);

    await msgBackground({
      action: 'saveArchive',
      archive: {
        pieceCid,
        cid:       pieceCid,
        url:       pageData.url,
        title:     pageData.title,
        timestamp: Date.now(),
        network:   settings.network,
        mode:      'full',
        sizeKB,
      },
    });

    showProgress(false);
    $('success-title').textContent = 'Page Archived!';
    $('ai-summary-section').classList.remove('visible');
    $('scores-panel').classList.remove('visible');
    $('impact-type-row').style.display = 'none';
    $('hypercert-panel').classList.remove('visible');
    showSuccess(pieceCid);
    await loadArchiveHistory();
  } catch (err) {
    showProgress(false);
    showError(err);
  } finally {
    isArchiving = false;
    setBtnLoading(false);
  }
}

// ── Page Extraction ───────────────────────────────────────────────────────────

async function extractPage(tabId) {
  try {
    return await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'extractPage' }, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!resp?.success)      reject(new Error(resp?.error || 'Content script failed'));
        else                          resolve(resp);
      });
    });
  } catch (_) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageDataInline,
    });
    const data = results[0]?.result;
    if (!data?.success) throw new Error('Could not extract page content');
    return data;
  }
}

function extractPageDataInline() {
  const MAX_HTML = 200 * 1024;
  const MAX_TEXT = 50  * 1024;
  try {
    const html = document.documentElement.outerHTML;
    const text = document.body ? document.body.innerText : '';
    return {
      url:       window.location.href,
      title:     document.title || window.location.hostname,
      html:      html.length > MAX_HTML ? html.slice(0, MAX_HTML) + '\n<!-- [truncated] -->' : html,
      text:      text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text,
      timestamp: new Date().toISOString(),
      htmlSize:  html.length,
      html_size: html.length,
      success:   true,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Error Types ───────────────────────────────────────────────────────────────

class FundingError extends Error {
  constructor(message, network) {
    super(message);
    this.name    = 'FundingError';
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

function setBtnLoading(loading) {
  $('btn-archive').disabled = loading;
  $('btn-archive').classList.toggle('loading', loading);
  $('btn-archive-label').textContent = loading ? 'Archiving…' : 'Archive This Page';
  $('btn-archive-icon').textContent  = loading ? '⏳' : '📦';
}

function showProgress(visible) {
  $('progress-section').classList.toggle('visible', visible);
  $('backend-progress-section').classList.remove('visible');
  if (visible) resetSteps();
}

function showBackendProgress(visible) {
  $('backend-progress-section').classList.toggle('visible', visible);
  $('progress-section').classList.remove('visible');
  if (visible) resetBSteps();
}

function showSuccess(pieceCid) {
  const isMock = pieceCid.startsWith('mock-cid-');
  $('result-cid').textContent = pieceCid;
  $('btn-view-archive').href  = isMock ? '#' : `https://ipfs.io/ipfs/${pieceCid}`;
  if (isMock) $('btn-view-archive').style.display = 'none';
  $('success-section').classList.add('visible');
}

function showError(err) {
  const msg = err?.message || String(err);
  $('error-msg').textContent = msg;

  let hint = '';
  if (
    err instanceof FundingError ||
    msg.toLowerCase().includes('balance') ||
    msg.toLowerCase().includes('insufficient')
  ) {
    hint = err.network === 'calibration'
      ? `Need testnet tokens? <a href="https://faucet.calibnet.chainsafe-fil.io/" target="_blank">Get tFIL</a> · <a href="https://faucet.secured.finance/" target="_blank">Get tUSDFC</a>`
      : 'Deposit USDFC and ensure you have FIL for gas.';
  } else if (msg.toLowerCase().includes('private key') || msg.toLowerCase().includes('0x')) {
    hint = `Check your private key in <a href="#" id="link-to-settings">Settings</a>.`;
  } else if (msg.includes('backend') || msg.includes('fetch') || msg.includes('connect')) {
    hint = `Check your Backend URL in <a href="#" id="link-to-settings">Settings</a> and ensure the server is running.`;
  } else if (msg.toLowerCase().includes('network')) {
    hint = 'Check your internet connection and try again.';
  }

  $('error-hint').innerHTML = hint;
  $('error-section').classList.add('visible');

  const lts = document.getElementById('link-to-settings');
  if (lts) lts.addEventListener('click', (e) => { e.preventDefault(); showView('settings'); });
}

function hideAll(ids) {
  ids.forEach((id) => $(id).classList.remove('visible'));
}

// Direct Filecoin step helpers
function setStep(id, state) {
  const el   = $(`step-${id}`);
  if (!el) return;
  el.classList.remove('active', 'done', 'error');
  if (state) el.classList.add(state);

  const icon = el.querySelector('.step-icon');
  if (!icon) return;
  if (state === 'active')      icon.innerHTML = '<div class="spinner"></div>';
  else if (state === 'done')   icon.textContent = '✓';
  else if (state === 'error')  icon.textContent = '✕';
  else                         icon.textContent = el.dataset.num || '';
}

function resetSteps() {
  Object.entries({ extract: '1', package: '2', balance: '3', upload: '4', confirm: '5' })
    .forEach(([id, num]) => {
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
  $('progress-bar').style.width = `${clamp(pct)}%`;
}

// Backend step helpers
function setBStep(id, state) {
  const el   = $(`bstep-${id}`);
  if (!el) return;
  el.classList.remove('active', 'done', 'error');
  if (state) el.classList.add(state);

  const icon = el.querySelector('.step-icon');
  if (!icon) return;
  if (state === 'active')     icon.innerHTML = '<div class="spinner"></div>';
  else if (state === 'done')  icon.textContent = '✓';
  else if (state === 'error') icon.textContent = '✕';
  else                        icon.textContent = el.dataset.num || '';
}

function resetBSteps() {
  Object.entries({ send: '1', process: '2', store: '3', done: '4' })
    .forEach(([id, num]) => {
      const el = $(`bstep-${id}`);
      if (!el) return;
      el.dataset.num = num;
      el.classList.remove('active', 'done', 'error');
      const icon = el.querySelector('.step-icon');
      if (icon) icon.textContent = num;
    });
  setBProgress(0);
}

function setBProgress(pct) {
  $('backend-progress-bar').style.width = `${clamp(pct)}%`;
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

function $(id)   { return document.getElementById(id); }
function clamp(v) { return Math.min(100, Math.max(0, v)); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function msgBackground(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(resp);
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
