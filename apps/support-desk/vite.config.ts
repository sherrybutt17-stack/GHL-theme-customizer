import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 5174 so the desk and the agency dashboard (5173) can run side by side in dev -
// which is exactly how you test that their two auth systems stay separate.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
