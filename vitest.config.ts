import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: ".env", quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
