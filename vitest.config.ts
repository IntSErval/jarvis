import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // server.ts and mcp/calendar real client are integration glue (need live creds);
      // excluded from unit coverage — validated manually per the plan.
      exclude: ["src/**/*.test.ts", "src/server.ts", "src/mcp/calendar.ts"],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
  },
});
