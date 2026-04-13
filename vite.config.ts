import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("react-pdf") || id.includes("pdfjs-dist")) {
            return "pdf-vendor";
          }

          if (
            id.includes(`${path.sep}react${path.sep}`) ||
            id.includes(`${path.sep}react-dom${path.sep}`) ||
            id.includes(`${path.sep}scheduler${path.sep}`)
          ) {
            return "react-vendor";
          }

          if (id.includes("lucide-react")) {
            return "icons-vendor";
          }

          if (id.includes("marked") || id.includes("highlight.js") || id.includes("mammoth")) {
            return "document-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
