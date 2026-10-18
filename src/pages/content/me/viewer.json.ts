import type { APIRoute } from 'astro';
import { publishedViewer } from '../../../lib/published-viewer';

export const GET: APIRoute = async () => new Response(
  JSON.stringify((await publishedViewer()).collection),
  { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
);
