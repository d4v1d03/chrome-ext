/**
 * FilImpact — ATProto sidecar
 *
 * Publishes a Hypercert to the AT Protocol as a set of linked records:
 *   org.hypercerts.claim.activity     — the core impact claim
 *   org.hypercerts.context.attachment — evidence (page URL + Filecoin CIDs)
 *   org.hypercerts.context.measurement — AI scores (impact, credibility, novelty)
 *   org.hypercerts.context.evaluation  — agentic evaluation summary
 *
 * Stdin:  JSON payload (see schema below)
 * Stdout: JSON with AT-URIs for all created records, or { error: "..." }
 *
 * Payload schema:
 * {
 *   pdsUrl:      string  (default: "https://bsky.social")
 *   identifier:  string  (handle or DID, e.g. "you.certified.app")
 *   password:    string  (app password from your PDS)
 *   hypercert:   object  (FilImpact hypercert object)
 *   scores:      { impact, credibility, novelty, confidence }
 *   evidenceCids: string[]
 *   pageUrl:     string
 *   pageTitle:   string
 * }
 */

import { AtpAgent } from '@atproto/api';

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    out({ error: `Invalid JSON: ${e.message}` });
    return;
  }

  const {
    pdsUrl     = 'https://bsky.social',
    identifier,
    password,
    hypercert  = {},
    scores     = {},
    evidenceCids = [],
    pageUrl    = '',
    pageTitle  = '',
  } = payload;

  if (!identifier || !password) {
    out({ error: 'identifier and password are required' });
    return;
  }

  const agent = new AtpAgent({ service: pdsUrl });
  try {
    await agent.login({ identifier, password });
  } catch (e) {
    out({ error: `PDS login failed: ${e.message}` });
    return;
  }

  const now  = new Date().toISOString();
  const year = new Date().getFullYear().toString();

  const work   = hypercert.work     || {};
  const meta   = hypercert.metadata || {};
  const topics = hypercert.topics   || [meta.impact_type || 'web-archive'];

  // ── 1. Activity Claim ───────────────────────────────────────────────────────

  let activityUri, activityCid;
  try {
    const r = await agent.com.atproto.repo.createRecord({
      repo: agent.session.did,
      collection: 'org.hypercerts.claim.activity',
      record: {
        $type:            'org.hypercerts.claim.activity',
        title:            (work.title || meta.name || pageTitle || 'Web Archive Impact Claim').slice(0, 256),
        shortDescription: (hypercert.summary || pageTitle || '').slice(0, 300),
        description:      (hypercert.summary || '').slice(0, 3000),
        workScope: {
          $type: 'org.hypercerts.claim.activity#workScopeString',
          scope: topics.slice(0, 5).join(', '),
        },
        startDate: `${year}-01-01T00:00:00Z`,
        endDate:   now,
        contributors: _contributors(work.contributors, agent.session.did),
        createdAt: now,
      },
    });
    activityUri = r.data.uri;
    activityCid = r.data.cid;
  } catch (e) {
    out({ error: `Failed to create activity claim: ${e.message}` });
    return;
  }

  const ref = { uri: activityUri, cid: activityCid };

  // ── 2. Attachments ──────────────────────────────────────────────────────────

  const attachmentUris = [];

  // Original page URL
  if (pageUrl) {
    try {
      const r = await agent.com.atproto.repo.createRecord({
        repo: agent.session.did,
        collection: 'org.hypercerts.context.attachment',
        record: {
          $type:            'org.hypercerts.context.attachment',
          subjects:         [ref],
          title:            `Source webpage: ${pageTitle || pageUrl}`.slice(0, 256),
          shortDescription: 'Original webpage archived by FilImpact.'.slice(0, 300),
          content:          [{ $type: 'org.hypercerts.defs#uri', uri: pageUrl }],
          createdAt: now,
        },
      });
      attachmentUris.push(r.data.uri);
    } catch (_) {}
  }

  // Filecoin CIDs (skip mock CIDs)
  for (const cid of evidenceCids) {
    if (!cid || cid.startsWith('mock-')) continue;
    try {
      const r = await agent.com.atproto.repo.createRecord({
        repo: agent.session.did,
        collection: 'org.hypercerts.context.attachment',
        record: {
          $type:            'org.hypercerts.context.attachment',
          subjects:         [ref],
          title:            'Filecoin encrypted archive',
          shortDescription: `Encrypted archive stored permanently on Filecoin. CID: ${cid}`.slice(0, 300),
          content:          [{ $type: 'org.hypercerts.defs#uri', uri: `ipfs://${cid}` }],
          createdAt: now,
        },
      });
      attachmentUris.push(r.data.uri);
    } catch (_) {}
  }

  // ── 3. Measurements (AI scores) ─────────────────────────────────────────────

  const measurementUris = [];
  const scoreEntries = [
    { metric: 'Impact Score',      value: scores.impact,      unit: 'points (0–100)', method: 'filimpact-scorer-agent' },
    { metric: 'Credibility Score', value: scores.credibility, unit: 'points (0–100)', method: 'filimpact-validator-agent' },
    { metric: 'Novelty Score',     value: scores.novelty,     unit: 'points (0–100)', method: 'filimpact-scorer-agent' },
    { metric: 'Confidence Score',  value: scores.confidence,  unit: 'points (0–100)', method: 'filimpact-scorer-agent' },
  ].filter(s => s.value !== undefined && s.value !== null);

  for (const s of scoreEntries) {
    try {
      const r = await agent.com.atproto.repo.createRecord({
        repo: agent.session.did,
        collection: 'org.hypercerts.context.measurement',
        record: {
          $type:      'org.hypercerts.context.measurement',
          subjects:   [ref],
          metric:     s.metric,
          value:      String(Math.round(s.value)),
          unit:       s.unit,
          startDate:  `${year}-01-01T00:00:00Z`,
          endDate:    now,
          methodType: s.method,
          createdAt:  now,
        },
      });
      measurementUris.push(r.data.uri);
    } catch (_) {}
  }

  // ── 4. Evaluation (agentic pipeline summary) ────────────────────────────────

  let evaluationUri = null;
  const keyPoints   = hypercert.key_points || [];
  const evalSummary = keyPoints.length > 0
    ? keyPoints.slice(0, 4).join(' | ')
    : `FilImpact agentic evaluation of "${pageTitle || pageUrl}"`;

  try {
    const scoreVal = typeof scores.impact === 'number' ? Math.round(scores.impact) : null;
    const r = await agent.com.atproto.repo.createRecord({
      repo: agent.session.did,
      collection: 'org.hypercerts.context.evaluation',
      record: {
        $type:      'org.hypercerts.context.evaluation',
        subject:    ref,
        evaluators: [{ did: agent.session.did }],
        summary:    evalSummary.slice(0, 1000),
        ...(scoreVal !== null ? { score: { min: 0, max: 100, value: scoreVal } } : {}),
        content: pageUrl ? [{ $type: 'org.hypercerts.defs#uri', uri: pageUrl }] : [],
        createdAt: now,
      },
    });
    evaluationUri = r.data.uri;
  } catch (_) {}

  out({
    activityUri,
    activityCid,
    did:             agent.session.did,
    pdsUrl,
    attachmentUris,
    measurementUris,
    evaluationUri,
    publishedAt:     now,
  });
}

function _contributors(contribs, fallbackDid) {
  const list = Array.isArray(contribs) && contribs.length > 0 ? contribs : ['FilImpact Archive'];
  return list.slice(0, 5).map(c => ({
    contributorIdentity: {
      $type:    'org.hypercerts.claim.activity#contributorIdentity',
      identity: c.startsWith('did:') ? c : (c === 'FilImpact Archive' ? fallbackDid : c),
    },
  }));
}

function out(data) {
  process.stdout.write(JSON.stringify(data));
  process.exit(data.error ? 1 : 0);
}

main().catch(e => out({ error: e.message }));
