import type { APIRoute } from 'astro';
import { readStoredImage } from '../lib/collection-files.js';
import { IMAGE_KEY, IMAGE_TYPES } from '../lib/collection-format.js';

export const GET: APIRoute = async ({ params }) => {
  const key = params.key || '';
  if (!IMAGE_KEY.test(key)) return new Response(null, { status: 404 });
  try {
    return new Response(new Uint8Array(await readStoredImage(key)), {
      headers: { 'Content-Type': IMAGE_TYPES[key.split('.').at(-1) as keyof typeof IMAGE_TYPES], 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch { return new Response(null, { status: 404 }); }
};
