import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": "http://backend:3000" },
  },
});
