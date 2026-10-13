import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 5173이 막혀 있을 때 5174(파일 서버 포트)로 옮겨 앉지 않도록
  server: { strictPort: true },
  optimizeDeps: { exclude: ["replicad-opencascadejs"] },
  worker: { format: "es" },
});
