import type { APIRoute } from 'astro';
import { readStoredCollection } from '../lib/collection-files.js';

// Registered only by astro dev; editable originals never enter the static site.
export const GET: APIRoute = async () => new Response(
  JSON.stringify({ ...await readStoredCollection(), version: 3 }),
  { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } },
);
