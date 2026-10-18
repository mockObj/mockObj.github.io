import type { APIRoute, GetStaticPaths } from 'astro';
import { publishedViewer } from '../../../../lib/published-viewer';

export const getStaticPaths: GetStaticPaths = async () => [...(await publishedViewer()).assets]
  .map(([image, buffer]) => ({ params: { image }, props: { buffer } }));

export const GET: APIRoute = ({ props }) => new Response(new Uint8Array(props.buffer), {
  headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
});
