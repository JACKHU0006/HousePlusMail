import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 构建产物输出到 server/public，由后端直接托管（单端口部署）。
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
});
