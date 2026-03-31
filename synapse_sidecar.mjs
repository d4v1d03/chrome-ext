import { Synapse } from '@filoz/synapse-sdk';
import { privateKeyToAccount } from 'viem/accounts';

const CALIBRATION_RPC = 'https://api.calibration.node.glif.io/rpc/v1';
const MAINNET_RPC     = 'https://api.node.glif.io/rpc/v1';

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: `Invalid JSON input: ${e.message}` }));
    process.exit(1);
  }

  const { privateKey, network = 'calibration', dataB64, metadata = {} } = payload;

  if (!privateKey || !dataB64) {
    process.stdout.write(JSON.stringify({ error: 'privateKey and dataB64 are required' }));
    process.exit(1);
  }

  try {
    const account = privateKeyToAccount(privateKey);
    const synapse  = Synapse.create({
      account,
      network: network === 'mainnet' ? undefined : 'calibration',
      rpcUrl:  network === 'mainnet' ? MAINNET_RPC : CALIBRATION_RPC,
    });

    const bytes = Buffer.from(dataB64, 'base64');

    // Fund the account if needed for this upload size
    const prep = await synapse.storage.prepare({ dataSize: BigInt(bytes.length) });
    if (prep.transaction) {
      await prep.transaction.execute();
    }

    const result = await synapse.storage.upload(bytes, {
      metadata: {
        Application: 'filimpact',
        URL:   String(metadata.url   || '').slice(0, 200),
        Title: String(metadata.title || '').slice(0, 100),
      },
      pieceMetadata: {
        filename:    'archive.bin',
        contentType: 'application/octet-stream',
        mode:        String(metadata.mode || 'unknown'),
      },
      count: 1,
    });

    if (!result?.pieceCid) {
      throw new Error('Upload succeeded but no pieceCid returned');
    }

    process.stdout.write(JSON.stringify({ cid: result.pieceCid.toString() }));
    process.exit(0);

  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message || String(e) }));
    process.exit(1);
  }
}

main();
