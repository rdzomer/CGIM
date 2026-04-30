import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    define: {
        "process.env": {}, // evita "process is not defined" por libs
    },
});
