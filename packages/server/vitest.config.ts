import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { ADMIN_TOKEN } from "./src/testing/http.ts";

const WORKERS_TESTS = "src/**/*.workers.test.ts";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          exclude: [WORKERS_TESTS],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "../../deploy/cloudflare/wrangler.toml" },
            miniflare: { bindings: { FLOW_SYNC_ADMIN_TOKEN: ADMIN_TOKEN } },
          }),
        ],
        test: { name: "workers", include: [WORKERS_TESTS] },
      },
    ],
  },
});
