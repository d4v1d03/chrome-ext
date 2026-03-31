# FilImpact

> Save impactful webpages permanently to Filecoin. AI scores the impact, generates a Hypercert claim, stores everything encrypted and censorship-resistant.

---

## Quick Start

**1. Build the extension**
```bash
npm install && npm run build
```
Load the `dist/` folder in Chrome via `chrome://extensions` → Developer Mode → Load unpacked.

**2. Run the backend**
```bash
cd backend
cp .env.example .env          # add OPENAI_API_KEY and ENCRYPTION_SECRET
pip install -r requirements.txt
brew services start redis

uvicorn app.main:app --reload --port 8000   # terminal 1
celery -A app.tasks.celery_app worker       # terminal 2
```

**3. Connect the extension**

Open the FilImpact popup → ⚙ Settings → set Backend URL to `http://localhost:8000`.

**4. Save a page**

Click the floating 💾 button on any page (or open the popup). Choose a mode and hit Save.

| Mode | What happens |
|------|------|
| **Full** | Encrypts + stores raw HTML/text. No AI. Instant. |
| **AI Summary** | GPT-4o-mini summarises the page. Stores summary + embeddings. |
| **Agentic** | Full 4-agent pipeline — extracts, validates, scores impact, generates a Hypercert payload. |

**5. Generate an Impact Claim**

After any save, click **Generate Impact Claim** in the popup. Works without an OpenAI key — falls back to Demo Mode automatically.

---

## What It Does

FilImpact is a Chrome extension + backend system for permanently archiving webpages with verifiable impact evidence.

- Every saved page is **AES-256-GCM encrypted** and stored on **Filecoin** via the Synapse SDK
- The **Agentic mode** runs four sequential AI agents: Extractor → Validator → Scorer → Generator
- The **RAG layer** embeds every save so you can semantically search your archive or find related pages
- **Hypercerts** turn any archived page into an EIP-3525-compatible on-chain impact claim — complete with impact type, scores, actors, and Filecoin CID evidence

---

## Tech Stack

| | |
|---|---|
| **Chrome extension** | MV3, vanilla JS, Webpack 5, Shadow DOM for the floating button |
| **Backend API** | FastAPI (Python) — async, all endpoints under `/api/` |
| **Background jobs** | Celery workers + Redis as broker/result backend |
| **AI** | OpenAI `gpt-4o-mini` for all agents, `text-embedding-3-small` for embeddings |
| **RAG** | In-process numpy cosine similarity, persisted to `/tmp/filimpact_rag.json` |
| **Encryption** | AES-256-GCM via Python `cryptography`, PBKDF2 key derivation |
| **Storage** | `@filoz/synapse-sdk` (Filecoin); `MockStorage` in-memory dict for dev |
| **Hypercerts** | EIP-3525 schema; AI-generated or keyword-heuristic demo mode |

---

## Architecture

```
Browser (Extension)
  content.js     — floating button, captures HTML + text
  popup.js       — UI, mode selection, polls /api/status, renders results
  background.js  — proxies cross-origin fetch to backend
        │
        ▼  HTTP
FastAPI (main.py)
  POST /api/save         → queues Celery task, returns job_id
  GET  /api/status/{id}  → returns progress + results
  POST /api/hypercert/{id} → builds Hypercert (AI or demo)
  GET  /api/search       → semantic search via RAG
        │
        ▼  Celery + Redis
Worker (tasks.py)
  process_full_save        — encrypt → store
  process_ai_summary       — GPT summary → embed → store → RAG index
  process_agentic_pipeline — Extractor → Validator → Scorer → Generator
                             → embed → store → RAG index → Hypercert payload
        │
        ▼
Storage (Filecoin / MockStorage)  +  RAG (numpy vector store)
```

### Agent pipeline (Agentic mode only)

| Agent | Input | Output |
|---|---|---|
| **Extractor** | Raw page text | Structured JSON: claims, entities, credibility signals |
| **Validator** | Extractor output + RAG context | Credibility score, flags, contradictions |
| **Scorer** | Extractor + Validator + RAG | Impact score, novelty score, impact type |
| **Generator** | All three outputs + CIDs | Final summary, key points, Hypercert payload |

---

## Resources

- [Synapse SDK](https://github.com/FilOzone/synapse-sdk)
- [Hypercerts Protocol](https://hypercerts.org/docs/developer/metadata)
- [Filecoin Calibration faucet](https://faucet.calibnet.chainsafe-fil.io/)
