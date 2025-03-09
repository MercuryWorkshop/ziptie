import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@yume-chan/fetch-scrcpy-server", "@yume-chan/pcm-player"],
  },
});
