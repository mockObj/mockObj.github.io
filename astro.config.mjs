import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mockobj.github.io',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  // Imports swap the data directory atomically. Do not let Windows file
  // watchers hold its directories open; the server reads updated data on demand.
  vite: {
    // Checking or building must not invalidate a running editor's imports.
    cacheDir: `.astro/vite-${['check', 'build', 'preview'].find(command => process.argv.includes(command)) || 'dev'}`,
    optimizeDeps: { include: ['fflate'] },
    server: { watch: { ignored: ['**/src/data/collection', '**/src/data/collection/**', '**/src/data/.collection-*', '**/src/data/.collection-*/**'] } },
  },
  integrations: [{
    name: 'local-editor',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/content/me/editor', entrypoint: new URL('./src/local/editor.astro', import.meta.url) });
        injectRoute({ pattern: '/content/me/preview', entrypoint: new URL('./src/local/preview.astro', import.meta.url) });
        injectRoute({ pattern: '/content/me/loading-test', entrypoint: new URL('./src/local/loading-test.astro', import.meta.url) });
        injectRoute({ pattern: '/content/me/collection.json', entrypoint: new URL('./src/local/collection.json.ts', import.meta.url) });
        injectRoute({ pattern: '/content/me/publish/', entrypoint: new URL('./src/local/publish.ts', import.meta.url) });
        injectRoute({ pattern: '/content/me/originals/[key]', entrypoint: new URL('./src/local/original.ts', import.meta.url) });
      },
    },
  }],
});
