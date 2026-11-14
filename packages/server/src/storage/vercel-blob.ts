import { del, get, list, put } from "@vercel/blob";
import { BLOB_PREFIX, type BlobStore } from "./types.ts";

const access = "private";

/** Private blobs in the project's Vercel Blob store; the SDK reads BLOB_READ_WRITE_TOKEN. */
export function openVercelBlobs(): BlobStore {
  return {
    async put(hash, data) {
      await put(BLOB_PREFIX + hash, new Blob([data.slice()]), {
        access,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
    async get(hash) {
      // The CDN cache could still serve a blob deleted moments ago.
      const result = await get(BLOB_PREFIX + hash, { access, useCache: false });
      if (result?.statusCode !== 200) return undefined;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async delete(hash) {
      await del(BLOB_PREFIX + hash);
    },
    async clear() {
      for (let cursor: string | undefined; ; ) {
        const page = await list({ prefix: BLOB_PREFIX, ...(cursor && { cursor }) });
        if (page.blobs.length) await del(page.blobs.map((blob) => blob.url));
        if (!page.hasMore) return;
        cursor = page.cursor;
      }
    },
  };
}
