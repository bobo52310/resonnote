// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Static site for Cloudflare Pages (native git integration, no adapter).
export default defineConfig({
  site: 'https://resonnote.pages.dev',
  integrations: [sitemap()],
  vite: {
    // Use this project's tsconfig only. Without it, Vite also picks up the extension's
    // tsconfig.json at the repo root, which extends a generated .wxt file absent here.
    tsconfig: './tsconfig.json',
    plugins: [tailwindcss()],
  },
});
