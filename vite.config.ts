import { defineConfig } from "vitest/config";

export default defineConfig({
  // 相对路径，GitHub Pages 子路径和 Cloudflare Pages 根路径都能用
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    include: ["src/**/*.test.ts", "contracts/**/*.test.ts"],
    environment: "node",
  },
});
