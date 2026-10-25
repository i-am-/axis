import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Static pages — content files ported verbatim from the Hugo site.
const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    // thanks.md carries `sitemap: exclude: true` (Hugo heritage) — kept verbatim
    sitemap: z.any().optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.coerce.date().optional(),
    // `slides` shows the post as a slide deck, a slide per `##` heading
    // (components/SlideDeck.astro); without JS it reads as an article
    format: z.enum(['article', 'slides']).default('article'),
  }),
});

export const collections = { pages, blog };
