import { prepareViewerCollection } from './prepare-viewer.js';
import { readStoredCollection, readStoredImage } from './collection-files.js';

// Shared by the manifest and image routes, including during static generation.
let prepared: ReturnType<typeof prepareViewerCollection> | undefined;
let revision = '';
let checkedAt = 0;
export async function publishedViewer() {
  if (!prepared || import.meta.env.DEV && Date.now() - checkedAt > 1000) {
    checkedAt = Date.now();
    const collection = await readStoredCollection();
    const next = JSON.stringify(collection);
    if (!prepared || revision !== next) {
      revision = next;
      prepared = prepareViewerCollection(collection, 'https://mockobj.github.io/content/me/images/', readStoredImage);
    }
  }
  return prepared;
}
