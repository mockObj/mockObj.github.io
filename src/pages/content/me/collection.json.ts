import type { APIRoute } from 'astro';
import collection from '../../../data/collection.json';
import { validateCollection } from '../../../lib/collection-model.js';

export const GET: APIRoute = () => new Response(
  JSON.stringify(validateCollection(collection)),
  { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
);
