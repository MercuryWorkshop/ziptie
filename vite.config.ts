import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile"
import fs from 'fs';

export default defineConfig({
  optimizeDeps: {
    exclude: ["@yume-chan/fetch-scrcpy-server", "@yume-chan/pcm-player"],
  },
  plugins: [
    viteSingleFile(),
    {
      name: 'vite-plugin-arraybuffer',
      enforce: 'pre',

      async load(id) {
        if (id.match(/\?arraybuffer$/)) {
          const filePath = id.replace(/\?arraybuffer$/, '');
          const buffer = await fs.promises.readFile(filePath);
          const arrayBuffer = Buffer.from(buffer).buffer;

          return `export default new Uint8Array(${JSON.stringify([...new Uint8Array(arrayBuffer)])});`;
        }
      }
    }
  ],
  server: {
    watch: {
      usePolling: true,
    }
  }
});
