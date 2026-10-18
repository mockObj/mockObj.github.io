import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mockobj.github.io',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  integrations: [{
    name: 'local-editor',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/content/me/editor', entrypoint: new URL('./src/local/editor.astro', import.meta.url) });
        injectRoute({ pattern: '/content/me/preview', entrypoint: new URL('./src/local/preview.astro', import.meta.url) });
      },
    },
  }],
});
