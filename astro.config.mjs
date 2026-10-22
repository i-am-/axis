// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import netlify from '@astrojs/netlify';
import mermaid from 'astro-mermaid';

export default defineConfig({
  site: 'https://igniting.coach',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // Every page is still prerendered; the adapter adds Netlify's image CDN
  // and lets a page opt into on-demand rendering with `prerender = false`.
  adapter: netlify(),
  integrations: [
    // ```mermaid blocks in Markdown, drawn in the brand palette. Mermaid's
    // own autoTheme only flips between its stock themes, so it is off:
    // the `base` theme carries the fixed brand colours (pie slices, mind-
    // map branches), and the `.mermaid` rules in global.css repaint boxes,
    // lines and text from the site tokens, so they follow light/dark live.
    mermaid({
      theme: 'base',
      autoTheme: false,
      mermaidConfig: {
        fontFamily: '"Roboto Flex", system-ui, sans-serif',
        themeVariables: {
          fontFamily: '"Roboto Flex", system-ui, sans-serif',
          fontSize: '15px',
          primaryColor: '#F5F1E9',
          primaryTextColor: '#15181A',
          primaryBorderColor: '#B8892B',
          secondaryColor: '#E4EEF0',
          tertiaryColor: '#F3E9E7',
          lineColor: '#5D6560',
          noteBkgColor: '#F5F1E9',
          noteBorderColor: '#B8892B',
          pie1: '#B8892B', pie2: '#006B7F', pie3: '#800000',
          pie4: '#5D6560', pie5: '#D8B8B4', pie6: '#262A2D',
          pieStrokeColor: 'transparent',
          pieOpacity: '1',
          cScale0: '#B8892B', cScale1: '#006B7F', cScale2: '#800000',
          cScale3: '#5D6560', cScale4: '#D8B8B4', cScale5: '#262A2D',
          cScaleLabel0: '#15181A', cScaleLabel1: '#F5F1E9', cScaleLabel2: '#F5F1E9',
          cScaleLabel3: '#F5F1E9', cScaleLabel4: '#15181A', cScaleLabel5: '#F5F1E9',
        },
      },
    }),
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      // the natal chart's country flags stay files, fetched only when a
      // place list shows them, instead of all being inlined into its script
      assetsInlineLimit: (file) => (file.includes('/flag-icons/') ? false : undefined),
    },
  },
});
