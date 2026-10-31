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
  // One bucket for the suite: SeaweedFS gives every bucket its own volumes, which run out.
  const bucket = "flow-sync-test";

  const client = () =>
    s3Client({
      endpoint: `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      forcePathStyle: true,
    });

  beforeAll(async () => {
    container = await new GenericContainer(IMAGE)
      .withCommand(["server", "-s3", "-dir=/data"])
      .withExposedPorts(S3_PORT)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    await client().send(new CreateBucketCommand({ Bucket: bucket }));
    // The port opens before the store has volumes to write to.
    for (let attempt = 0; ; attempt++) {
      try {
        await client().send(new PutObjectCommand({ Bucket: bucket, Key: "ready", Body: "1" }));
        return;
      } catch (error) {
        if (attempt === 60) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }, 120_000);
  afterAll(() => container.stop());

  storageContract("sqlite + s3", async () => {
    const blobs = openS3Blobs(client(), bucket);
    await blobs.clear();
    return { meta: openSqlite(":memory:").meta, blobs };
  });

  test("clearing leaves other objects in a shared bucket alone", async () => {
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
