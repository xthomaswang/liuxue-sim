import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// base 用相对路径：同一份 dist 既能放在任意静态站点子路径下，也能被 iOS / macOS 外壳用自定义 scheme 加载。
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "tests/**/*.test.{ts,tsx}"],
    testTimeout: 30000,
  },
});
