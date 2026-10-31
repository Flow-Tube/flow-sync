import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  paginateListObjectsV2,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { BlobStore } from "./types.ts";

/** Under a prefix, so clearing never touches anything else in a shared bucket. */
const PREFIX = "flow-sync/blobs/";

export function s3Client(config: S3ClientConfig): S3Client {
  return new S3Client({
    // Some S3-compatible stores reject the SDK's newer default checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...config,
  });
}

/** Blobs as objects in a bucket on AWS S3, R2, or any S3-compatible store. */
export function openS3Blobs(client: S3Client, bucket: string): BlobStore {
  const at = (hash: string) => ({ Bucket: bucket, Key: PREFIX + hash });
  return {
    async put(hash, data) {
      await client.send(new PutObjectCommand({ ...at(hash), Body: data }));
    },
    async get(hash) {
      try {
        const { Body } = await client.send(new GetObjectCommand(at(hash)));
        return await Body?.transformToByteArray();
      } catch (error) {
        if (error instanceof NoSuchKey) return undefined;
        throw error;
      }
    },
    async delete(hash) {
      await client.send(new DeleteObjectCommand(at(hash)));
    },
    async clear() {
      const pages = paginateListObjectsV2({ client }, { Bucket: bucket, Prefix: PREFIX });
      for await (const { Contents = [] } of pages) {
        if (!Contents.length) continue;
        const Objects = Contents.map(({ Key }) => ({ Key }));
        await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }),
        );
      }
    },
  };
}
