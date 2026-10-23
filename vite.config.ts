import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// One site, six pages. Each page is its own entry; the modules they share are bundled once.
const page = (path: string) => resolve(import.meta.dirname, 'web', path);

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: page('index.html'),
        film: page('film/index.html'),
        match: page('match/index.html'),
        desk: page('desk/index.html'),
        replay: page('replay/index.html'),
        evidence: page('evidence/index.html'),
      },
    },
  },
  // the evidence page and the film read the results and the model card straight from the repository
  server: { fs: { allow: ['..'] } },
});
