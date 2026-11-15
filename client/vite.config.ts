import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/zhihucopy/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/zhihucopy/api": "http://127.0.0.1:3030",
    },
  },
});
