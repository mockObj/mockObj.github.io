import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative, isAbsolute } from 'node:path';
import { readCollectionArchive } from './collection-archive.js';
import { COLLECTION_DIRECTORY, writeStoredCollection } from './collection-files.js';

const runGit = promisify(execFile);
const publicationResponse = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

// Used only by the local dev route. No GitHub credentials or network writes.
export function createPublicationHandler({ directory = COLLECTION_DIRECTORY, repositoryRoot = process.cwd() } = {}) {
  let saving = false;
  return async request => {
    const url = new URL(request.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || request.headers.get('origin') !== url.origin
      || request.headers.get('x-eyes-editor') !== 'local') {
      return publicationResponse({ error: 'ローカルの編集画面から保存してください。' }, 403);
    }
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/zip') return publicationResponse({ error: '画像入りのZIPデータが必要です。' }, 415);
    if (saving) return publicationResponse({ error: '保存中です。少し待ってからもう一度お試しください。' }, 409);
    const path = relative(resolve(repositoryRoot), resolve(directory));
    if (!path || path.startsWith('..') || isAbsolute(path)) return publicationResponse({ error: '公開用フォルダの設定が不正です。' }, 500);
    saving = true;
    try {
      let archive;
      try { archive = await readCollectionArchive(await request.blob()); }
      catch { return publicationResponse({ error: '画像または編集情報を読み込めませんでした。元データは変更していません。' }, 400); }
      const saved = await writeStoredCollection(archive.collection, key => archive.images.get(key), directory);
      let staged = true;
      try { await runGit('git', ['add', '--', path], { cwd: repositoryRoot, windowsHide: true }); }
      catch { staged = false; }
      return publicationResponse({ saved: true, staged, count: saved.items.length });
    } catch {
      return publicationResponse({ error: '公開用ファイルを保存できませんでした。フォルダの権限や空き容量を確認してください。' }, 500);
    } finally { saving = false; }
  };
}
