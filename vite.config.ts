import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env": {}, // evita "process is not defined" por libs
  },
  server: {
    proxy: {
      // Proxy para a API ComexStat — evita CORS em desenvolvimento local
      "/comexstat-api": {
        target: "https://api-comexstat.mdic.gov.br",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/comexstat-api/, ""),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) {
            return 'firebase-vendor';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/xlsx')) {
            return 'xlsx-vendor';
          }
          if (id.includes('node_modules/recharts')) {
            return 'recharts-vendor';
          }
          if (id.includes('node_modules/docx')) {
            return 'docx-vendor';
          }
        },
      },
    },
  },
});
