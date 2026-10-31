import { CreateBucketCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, expect, test } from "vitest";
import { hasDocker } from "../testing/docker.ts";
import { storageContract } from "./contract.ts";
import { openS3Blobs, s3Client } from "./s3.ts";
import { openSqlite } from "./sqlite.ts";

// MinIO no longer publishes images; SeaweedFS is another widely used S3-compatible server.
const IMAGE =
  "chrislusf/seaweedfs:4.51@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8";
const S3_PORT = 8333;

if (await hasDocker()) {
  let container: StartedTestContainer;
  let buckets = 0;

  beforeAll(async () => {
    container = await new GenericContainer(IMAGE)
      .withCommand(["server", "-s3", "-dir=/data"])
      .withExposedPorts(S3_PORT)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
  }, 120_000);
  afterAll(() => container.stop());

  const client = () =>
    s3Client({
      endpoint: `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      forcePathStyle: true,
    });

  async function freshBucket(): Promise<string> {
    const bucket = `test-${++buckets}`;
    await client().send(new CreateBucketCommand({ Bucket: bucket }));
    return bucket;
  }

  storageContract("sqlite + s3", async () => ({
    meta: openSqlite(":memory:").meta,
    blobs: openS3Blobs(client(), await freshBucket()),
  }));

  test("clearing leaves other objects in a shared bucket alone", async () => {
    const bucket = await freshBucket();
    await client().send(new PutObjectCommand({ Bucket: bucket, Key: "other", Body: "keep" }));
    const blobs = openS3Blobs(client(), bucket);
    await blobs.put("a", Uint8Array.of(1));
    await blobs.clear();
    expect(await blobs.get("a")).toBeUndefined();
    const { Body } = await client().send(new GetObjectCommand({ Bucket: bucket, Key: "other" }));
    expect(await Body?.transformToString()).toBe("keep");
  });
} else {
  test.skip("s3 storage needs Docker", () => {});
}
