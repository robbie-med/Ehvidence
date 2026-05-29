import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// For a GitHub project page the site is served from /<repo>/.
// If you later attach a custom domain or use a <user>.github.io repo,
// set `base: '/'` and update `site` accordingly.
export default defineConfig({
  site: 'https://robbie-med.github.io',
  base: '/ehvidence',
  trailingSlash: 'ignore',
  integrations: [preact()],
});
