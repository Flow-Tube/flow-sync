import { type GetStoreOptions, getStore, type Store } from "@netlify/blobs";
import type { BlobStore } from "./types.ts";

/**
 * A store of its own, so clearing touches nothing else. It opens on first use because
 * Netlify provides the store's context only while a request runs.
 */
export function openNetlifyBlobs(options: GetStoreOptions): BlobStore {
  let opened: Store | undefined;
  const store = () => {
    opened ??= getStore({ consistency: "strong", ...options });
    return opened;
  };
  return {
    async put(hash, data) {
      await store().set(hash, new Blob([data]));
    },
    async get(hash) {
      const data = await store().get(hash, { type: "arrayBuffer" });
      return data ? new Uint8Array(data) : undefined;
    },
    async delete(hash) {
      await store().delete(hash);
    },
    async clear() {
      for await (const page of store().list({ paginate: true })) {
        await Promise.all(page.blobs.map((blob) => store().delete(blob.key)));
      }
    },
  };
}
