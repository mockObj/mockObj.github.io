import { execFileSync } from 'node:child_process';

const target = {
  url: 'https://github.com/mockObj/mockObj.github.io.git',
  name: 'mockObj/mockObj.github.io',
  id: 1424163394,
};

try {
  const [remote = 'origin', pushUrl] = process.argv.slice(2);
  if (remote !== 'origin') throw new Error('この作業では origin へのpushだけを許可します。');
  const gitUrls = flag => execFileSync('git', ['remote', 'get-url', ...flag, '--all', remote], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const urls = [...gitUrls([]), ...gitUrls(['--push']), ...(pushUrl ? [pushUrl] : [])];
  if (urls.some(url => url !== target.url)) throw new Error('originのURLが今回の公開先と一致しません。');

  const response = await fetch(`https://api.github.com/repos/${target.name}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status !== 200) throw new Error(`公開先を確認できません（HTTP ${response.status}）。リダイレクトには追従しません。`);
  const repository = await response.json();
  if (repository.id !== target.id || repository.full_name !== target.name || repository.private !== false || repository.visibility !== 'public') {
    throw new Error('公開先のID・名前・公開状態が今回の対象と一致しません。');
  }
  console.log(`公開先を確認: ${target.name} (public, ID ${target.id})`);
} catch (error) {
  console.error('push先の確認に失敗: ' + error.message);
  process.exitCode = 1;
}
