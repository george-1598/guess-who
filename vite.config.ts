import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages project site. Keep this in sync with your repository name.
  base: "/guess-who/",
});
