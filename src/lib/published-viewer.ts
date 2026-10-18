import collection from '../data/collection.json';
import { prepareViewerCollection } from './prepare-viewer.js';

// Shared by the manifest and image routes, including during static generation.
let prepared: ReturnType<typeof prepareViewerCollection> | undefined;
export function publishedViewer() {
  return prepared ??= prepareViewerCollection(collection, 'https://mockobj.github.io/content/me/images/');
}
