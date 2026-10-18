import type { APIRoute } from 'astro';
import { createPublicationHandler } from '../lib/publish-collection.js';

export const prerender = false;
const publish = createPublicationHandler();
export const POST: APIRoute = ({ request }) => publish(request);
