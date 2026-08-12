import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Load .env for local runs without adding a runtime dependency.
// In CI the variables are provided by the environment instead.
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    if (!process.env[key]) process.env[key] = match[2]!.replace(/^["']|["']$/g, "");
  }
} catch {
  /* no local .env — rely on the ambient environment */
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
