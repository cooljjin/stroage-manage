import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const adminRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: adminRoot,
  envDir: resolve(adminRoot, ".."),
  plugins: [react()],
  server: {
    fs: {
      allow: [resolve(adminRoot, "..")]
    }
  },
  build: {
    outDir: resolve(adminRoot, "../dist-admin"),
    emptyOutDir: true
  }
});
