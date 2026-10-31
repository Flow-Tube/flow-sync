import { getContainerRuntimeClient } from "testcontainers";

/** Container suites skip without Docker, except where FLOW_SYNC_REQUIRE_DOCKER=1 (CI) makes that fail. */
export async function hasDocker(): Promise<boolean> {
  try {
    await getContainerRuntimeClient();
    return true;
  } catch (error) {
    if (process.env.FLOW_SYNC_REQUIRE_DOCKER === "1") throw error;
    return false;
  }
}
