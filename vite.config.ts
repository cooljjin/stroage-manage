import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const deploymentProjectRefs = {
  staging: "nchvyxhyfatgwpvilbng",
  production: "pcvpkndyqkljgbrvssza"
} as const;

export default defineConfig(({ mode }) => {
  if (mode === "staging" || mode === "production") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    const expectedProjectRef = deploymentProjectRefs[mode];
    if (env.VITE_DEPLOYMENT_ENV !== mode) {
      throw new Error(`${mode} build requires VITE_DEPLOYMENT_ENV=${mode}`);
    }
    if (env.VITE_SUPABASE_PROJECT_REF !== expectedProjectRef) {
      throw new Error(`${mode} build has an invalid VITE_SUPABASE_PROJECT_REF`);
    }
    if (env.VITE_SUPABASE_URL !== `https://${expectedProjectRef}.supabase.co`) {
      throw new Error(`${mode} build has an invalid VITE_SUPABASE_URL`);
    }
    if (!env.VITE_SUPABASE_ANON_KEY) {
      throw new Error(`${mode} build requires VITE_SUPABASE_ANON_KEY`);
    }
  }

  return {
    plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png"],
      manifest: {
        name: "Stockly",
        short_name: "Stockly",
        description: "카페 및 F&B 매장용 모바일 우선 재고관리 앱",
        theme_color: "#5757FF",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: ".",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      },
      workbox: {
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"]
      }
    })
    ]
  };
});
