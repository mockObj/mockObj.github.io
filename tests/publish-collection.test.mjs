import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPublicationHandler } from '../src/lib/publish-collection.js';
import { createCollectionArchive } from '../src/lib/collection-archive.js';
import { describeImage, imageKey } from '../src/lib/collection-format.js';
import { readStoredCollection, readStoredImage } from '../src/lib/collection-files.js';

const git = promisify(execFile);
const origin = 'http://127.0.0.1:4321';
const request = (body, site = origin) => new Request(origin + '/content/me/publish/', {
  method: 'POST', headers: { Origin: site, 'X-Eyes-Editor': 'local', 'Content-Type': 'application/zip' }, body,
});

test('local publication writes and stages only the collection, and rejects invalid requests before changing it', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'eyes-publish-'));
  const directory = join(repositoryRoot, 'src', 'data', 'collection');
  try {
    await git('git', ['init', '--quiet', repositoryRoot]);
    await writeFile(join(repositoryRoot, 'other.txt'), 'already staged');
    await git('git', ['add', '--', 'other.txt'], { cwd: repositoryRoot });
    await writeFile(join(repositoryRoot, 'other.txt'), 'unsaved elsewhere');
    const image = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });
    const { key } = await describeImage(image);
    const collection = { version: 3, items: [{ id: 'eye-one', title: 'Draft title', image: `asset:${key}`, width: 1, height: 1, sourceUrl: '', eye: { x: .4, y: .6, r: .18 } }] };
    const archive = await createCollectionArchive(collection, () => image);
    const publish = createPublicationHandler({ directory, repositoryRoot });
    assert.equal((await publish(request(archive, 'https://elsewhere.example'))).status, 403);
    const response = await publish(request(archive));
    assert.deepEqual(await response.json(), { saved: true, staged: true, count: 1 });
    const saved = await readStoredCollection(directory);
    assert.equal(saved.items[0].title, 'Draft title');
    assert.deepEqual(saved.items[0].eye, { x: .4, y: .6, r: .18 });
    assert.deepEqual(await readStoredImage(imageKey(saved.items[0].image), directory), Buffer.from(await image.arrayBuffer()));
    const staged = (await git('git', ['diff', '--cached', '--name-only'], { cwd: repositoryRoot })).stdout.trim().split(/\r?\n/);
    assert.equal(staged.length, 4);
    assert.ok(staged.includes('other.txt'));
    assert.ok(staged.filter(path => path.startsWith('src/data/collection/')).length === 3);
    assert.equal((await git('git', ['show', ':other.txt'], { cwd: repositoryRoot })).stdout, 'already staged');
    assert.equal((await publish(request(new Blob(['broken'])))).status, 400);
    assert.deepEqual(await readStoredCollection(directory), saved);
    assert.equal((await git('git', ['diff', '--cached', '--name-only'], { cwd: repositoryRoot })).stdout.trim().split(/\r?\n/).length, 4);
  } finally { await rm(repositoryRoot, { recursive: true, force: true }); }
});
