import { Synapse } from '@filoz/synapse-sdk';
import { privateKeyToAccount } from 'viem/accounts';

const CALIBRATION_RPC = 'https://api.calibration.node.glif.io/rpc/v1';
const MAINNET_RPC = 'https://api.node.glif.io/rpc/v1';
const APP_SOURCE = 'fil-archive-ext';

/**
 * StorageAgent — wraps Synapse SDK for archive upload/retrieval.
 *
 * Methods:
 *   prepare(dataSize)                  — ensure balance is funded
 *   store(bytes, meta, callbacks)      — upload bytes, return pieceCid string
 *   retrieve(pieceCid)                 — download bytes by pieceCid
 *   renew(pieceCid)                    — re-upload content to extend storage
 *   prune(history, maxAgeMs)           — filter history to remove old entries
 *   getAddress()                       — derive wallet address from private key
 */
export class StorageAgent {
  constructor(privateKey, network = 'calibration') {
    if (!privateKey || !privateKey.startsWith('0x')) {
      throw new Error('Private key must start with 0x');
    }
    this.account = privateKeyToAccount(privateKey);
    this.network = network;
    this._synapse = null;
  }

  getAddress() {
    return this.account.address;
  }

  _getRpcUrl() {
    return this.network === 'mainnet' ? MAINNET_RPC : CALIBRATION_RPC;
  }

  async _getSynapse() {
    if (!this._synapse) {
      const options = {
        account: this.account,
        source: APP_SOURCE,
      };
      // Calibration testnet configuration
      if (this.network === 'calibration') {
        options.network = 'calibration';
      }
      this._synapse = Synapse.create(options);
    }
    return this._synapse;
  }

  /**
   * Ensure the account is funded for the given data size.
   * Submits a deposit + approval transaction if balance is insufficient.
   */
  async prepare(dataSize) {
    const synapse = await this._getSynapse();
    const prep = await synapse.storage.prepare({ dataSize: BigInt(dataSize) });
    if (prep.transaction) {
      await prep.transaction.execute();
    }
    return prep;
  }

  /**
   * Upload bytes to Filecoin via Synapse SDK.
   *
   * @param {Uint8Array} bytes - raw bytes to upload
   * @param {object} meta - key/value metadata for the archive (url, title, etc.)
   * @param {object} callbacks - { onProgress, onStored, onConfirmed }
   * @returns {string} pieceCid
   */
  async store(bytes, meta = {}, callbacks = {}) {
    const synapse = await this._getSynapse();

    // Build dataset-level metadata (max 10 keys, max ~256 chars each)
    const datasetMeta = {
      Application: APP_SOURCE,
      URL: _truncate(meta.url || '', 200),
      Title: _truncate(meta.title || '', 100),
    };

    // Piece-level metadata (max 5 keys)
    const pieceMeta = {
      filename: 'archive.json',
      contentType: 'application/json',
      timestamp: String(meta.timestamp || Date.now()),
    };

    const uploadCallbacks = {};
    if (callbacks.onProgress) {
      uploadCallbacks.onProgress = (bytesUploaded) => {
        callbacks.onProgress(bytesUploaded, bytes.length);
      };
    }
    if (callbacks.onStored) {
      uploadCallbacks.onStored = (providerId, pieceCid) => {
        callbacks.onStored(providerId, pieceCid?.toString());
      };
    }
    if (callbacks.onCopyComplete) {
      uploadCallbacks.onCopyComplete = callbacks.onCopyComplete;
    }
    if (callbacks.onPiecesConfirmed) {
      uploadCallbacks.onPiecesConfirmed = (dataSetId, providerId) => {
        callbacks.onPiecesConfirmed(dataSetId, providerId);
      };
    }

    const result = await synapse.storage.upload(bytes, {
      metadata: datasetMeta,
      pieceMetadata: pieceMeta,
      count: 1, // single copy to minimize cost for demo
      callbacks: Object.keys(uploadCallbacks).length > 0 ? uploadCallbacks : undefined,
    });

    if (!result || !result.pieceCid) {
      throw new Error('Upload returned no pieceCid');
    }

    return result.pieceCid.toString();
  }

  /**
   * Download content by pieceCid.
   * @param {string} pieceCid
   * @returns {string} decoded text content
   */
  async retrieve(pieceCid) {
    const synapse = await this._getSynapse();
    const bytes = await synapse.storage.download({ pieceCid });
    return new TextDecoder().decode(bytes);
  }

  /**
   * Re-upload an archived piece to refresh its storage period.
   * Returns the new pieceCid.
   */
  async renew(pieceCid) {
    const content = await this.retrieve(pieceCid);
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { content };
    }
    // Mark as renewed
    if (parsed.metadata) {
      parsed.metadata.renewed = true;
      parsed.metadata.originalCid = pieceCid;
      parsed.metadata.renewedAt = Date.now();
    }
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    return await this.store(bytes, {
      url: parsed.metadata?.url || '',
      title: `[Renewed] ${parsed.metadata?.title || ''}`,
      timestamp: Date.now(),
    });
  }

  /**
   * Filter archive history to remove entries older than maxAgeMs.
   * Does not delete from Filecoin — just removes from local history.
   */
  prune(history, maxAgeMs = 365 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    return history.filter((item) => item.timestamp > cutoff);
  }
}

function _truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}
