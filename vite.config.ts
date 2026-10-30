import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Repozytorium z aplikacją nazywa się media_app.
  base: process.env.GITHUB_ACTIONS ? "/media_app/" : "/",
});