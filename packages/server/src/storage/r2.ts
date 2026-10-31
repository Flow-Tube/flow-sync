import { BLOB_PREFIX, type BlobStore } from "./types.ts";

export function openR2Blobs(bucket: R2Bucket): BlobStore {
  return {
    async put(hash, data) {
      await bucket.put(BLOB_PREFIX + hash, data);
    },
    async get(hash) {
      const object = await bucket.get(BLOB_PREFIX + hash);
      return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
    },
    async delete(hash) {
      await bucket.delete(BLOB_PREFIX + hash);
    },
    async clear() {
      for (let cursor: string | undefined; ; ) {
        const page = await bucket.list({ prefix: BLOB_PREFIX, ...(cursor && { cursor }) });
        if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
        if (!page.truncated) return;
        cursor = page.cursor;
      }
    },
  };
}
