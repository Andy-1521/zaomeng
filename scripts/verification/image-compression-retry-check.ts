import assert from 'node:assert/strict';
import { compressImageFromUrl } from '@/lib/imageCompression';

async function main() {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  try {
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError('fetch failed');
      }

      return new Response(Buffer.from('retry-ok-image-buffer'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }) as typeof fetch;

    const buffer = await compressImageFromUrl('https://example.test/runninghub-result.png', {
      maxWidthSize: 5 * 1024 * 1024,
    });

    assert.equal(attempts, 2, 'compressImageFromUrl should retry one transient fetch failure');
    assert.equal(buffer.toString(), 'retry-ok-image-buffer');
    console.log(JSON.stringify({ ok: true, attempts }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
