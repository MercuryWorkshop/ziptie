import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig({
  optimizeDeps: {
    exclude: ["@yume-chan/fetch-scrcpy-server", "@yume-chan/pcm-player"],
  },
  plugins: [viteSingleFile()]
});
