import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// Served from the custom domain ehvidence.robbiemed.org at the site root.
// (For a project page without a custom domain you'd instead set
// site to https://<user>.github.io and base to '/<repo>'.)
export default defineConfig({
  site: 'https://ehvidence.robbiemed.org',
  base: '/',
  trailingSlash: 'ignore',
  integrations: [preact()],
});
