import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { deriveTopic, type RawTopic } from '../lib/derive';
import { buildSearchDocs } from '../lib/searchIndex';

/**
 * Static search index, emitted at build time to /search-index.json. The
 * SearchBox island fetches this once and ranks client-side with the same pure
 * scorer used to build it (src/lib/searchIndex.ts).
 */
export const GET: APIRoute = async () => {
  const base = import.meta.env.BASE_URL;
  const entries = await getCollection('topics');
  const topics = entries.map((e) => deriveTopic(e.data as RawTopic));
  const docs = buildSearchDocs(topics, base);
  return new Response(JSON.stringify({ generated: new Date().toISOString(), docs }), {
    headers: { 'content-type': 'application/json' },
  });
};
