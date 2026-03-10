# FilArchive — Decentralized Web Archive Chrome Extension

> Archive any webpage permanently to Filecoin decentralized storage.
> Built for the Filecoin track — Hackathon 2026.

## What It Does

FilArchive is a Chrome extension that lets you save any webpage to Filecoin's
decentralized storage network in one click. The page is packaged as a structured
JSON archive (HTML + visible text + metadata) and uploaded via the
[Synapse SDK](https://github.com/FilOzone/synapse-sdk). You get back a PieceCID
that can be used to retrieve the page from anywhere, forever.

```
Open Webpage → Click "Archive This Page" → Page captured → Uploaded to Filecoin → CID returned
```

## Features

- **One-click archiving** — captures title, URL, full HTML, and visible text
- **Filecoin storage** — uses `@filoz/synapse-sdk` for Filecoin Onchain Cloud
- **CID history** — last 50 archives stored locally with quick copy/view actions
- **Balance-aware** — auto-prepares your account via `synapse.storage.prepare()`
- **Progress tracking** — live 5-step progress UI (extract → package → balance → upload → confirm)
- **StorageAgent class** — `store()`, `retrieve()`, `renew()`, `prune()` methods
- **Testnet support** — defaults to Filecoin Calibration for hackathon demo

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome MV3, JavaScript, Webpack 5 |
| Storage SDK | `@filoz/synapse-sdk` (Filecoin Onchain Cloud) |
| Wallet | `viem` + `privateKeyToAccount` |
| Network | Filecoin Calibration Testnet (or Mainnet) |
| Bundler | Webpack 5 with Buffer polyfill |

## Setup

### Prerequisites

- Node.js >= 18
- A Filecoin wallet private key (`0x...`)
- Testnet tokens (Calibration):
  - **tFIL** (for gas): [faucet.calibnet.chainsafe-fil.io](https://faucet.calibnet.chainsafe-fil.io/)
  - **tUSDFC** (for storage payments): [faucet.secured.finance](https://faucet.secured.finance/)

### Build

```bash
npm install
npm run build        # production build → dist/
npm run dev          # watch mode for development
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder

### Configure

1. Click the FilArchive icon in your toolbar
2. Click the **⚙** settings button
3. Enter your private key (`0x...`) and select **Calibration** network
4. Click **Save Settings**
5. Your wallet address will appear — fund it with tFIL and tUSDFC

## Architecture

```
chrome-ext/
├── src/
│   ├── popup.js              # Main popup UI logic + archive orchestration
│   ├── content.js            # Content script — extracts page data
│   ├── background.js         # Service worker — archive history storage
│   └── storage/
│       └── agent.js          # StorageAgent class (Synapse SDK wrapper)
├── static/
│   ├── manifest.json         # Chrome MV3 manifest
│   ├── popup.html            # Extension popup UI
│   └── icon.png
├── dist/                     # Built extension (load this in Chrome)
├── package.json
└── webpack.config.js
```

### StorageAgent API

```javascript
import { StorageAgent } from './storage/agent.js';

const agent = new StorageAgent('0x...privateKey', 'calibration');

// Archive a page
await agent.prepare(bytes.length);           // fund if needed
const cid = await agent.store(bytes, meta);  // upload → returns pieceCid

// Retrieve an archive
const content = await agent.retrieve(cid);  // download by pieceCid

// Extend storage
const newCid = await agent.renew(cid);      // re-upload content

// Clean up local history
const recent = agent.prune(history, 365 * 24 * 60 * 60 * 1000);
```

### Upload Flow

1. **Extract** — content script pulls `outerHTML` (≤200KB) and `innerText` (≤50KB)
2. **Package** — JSON archive with `metadata` + `content` sections
3. **Prepare** — `synapse.storage.prepare({ dataSize })` — auto-deposits USDFC if needed
4. **Upload** — `synapse.storage.upload(bytes, { metadata, callbacks })` — store-pull-commit
5. **Confirm** — on-chain confirmation, `pieceCid` returned

### Archive Format

```json
{
  "metadata": {
    "url": "https://example.com/article",
    "title": "Page Title",
    "timestamp": 1710000000000,
    "archivedAt": "2026-03-11T00:00:00.000Z",
    "version": "1.0",
    "source": "filarchive-chrome-extension"
  },
  "content": {
    "html": "<!DOCTYPE html>...",
    "text": "Visible text content..."
  }
}
```

## Retrieval

Retrieve any archived page using its PieceCID:

```javascript
const content = await agent.retrieve('bafkzcib...');
const archive = JSON.parse(content);
console.log(archive.metadata.url);
```

Or view via IPFS gateway:
```
https://ipfs.io/ipfs/<pieceCid>
```

## Resources

- [Synapse SDK Docs](https://docs.filecoin.cloud/)
- [Filecoin Onchain Cloud](https://docs.filecoin.cloud/core-concepts/architecture.md)
- [Synapse SDK GitHub](https://github.com/FilOzone/synapse-sdk)
- [Starter Kit (foc-upload-dapp)](https://github.com/FIL-Builders/foc-upload-dapp)
- [MCP Storage Server](https://github.com/FIL-Builders/foc-storage-mcp)

## License

MIT
