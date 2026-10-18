# mockObj / eyes

元の `eyes-self-hosted` をAstro 7の静的サイトへ移植したものです。公開予定のURLは https://mockobj.github.io/content/me/ です。

## 開発

Node.js 22.22以上（推奨24）を使います。

```powershell
npm ci
npm run dev
```

`http://localhost:4321/content/me/` が公開画面、`/content/me/editor/` が編集画面、`/content/me/preview/` が下書きのプレビューです。同じオリジン（localhostか127.0.0.1のどちらかに統一）で開いてください。

## 画面とソースの対応

| ファイル・フォルダ | 編集する内容 |
| --- | --- |
| `src/layouts/SiteLayout.astro` | HTML、タイトル、メタ情報 |
| `src/components/viewer/EyeField.astro` | 目の空間、描画用canvas |
| `src/components/viewer/FieldChrome.astro` | 操作ヒント、ステータス |
| `src/components/editor/` | 編集ヘッダー、画像の設定、配置、読込エラー |
| `src/pages/content/me/` | 公開画面、編集画面、下書きプレビュー、公開JSON |
| `src/styles/viewer.css` / `editor.css` | 色、余白、レスポンシブ表示 |
| `src/scripts/viewer.js` | ドラッグ、スクロール、目の追従 |
| `src/scripts/field-layout.js` | 画像サイズとグリッドの寸法 |
| `src/scripts/field-gl.js` | WebGLの描画 |
| `src/scripts/eyes.js` | 初期素材、出典、空きマスの模様 |
| `src/scripts/editor.js` | 画像の取り込み、切り抜き、配置の操作 |
| `src/lib/collection-model.js` | JSONの検証。ブラウザ、ビルド、取込コマンドで共通利用 |
| `src/lib/collection-store.js` | IndexedDB、画像変換、JSON・HTMLの書き出し |
| `src/data/collection.json` | 全員に公開する画像と配置の正本 |
| `public/content/me/assets/` | 元の画像ファイル（元のバイトを保持） |

Astroコンポーネントは通常のマークアップで編集できます。大きなHTMLを埋め込んだiframeは使っていません。描画と編集のJavaScriptも用途ごとに分けています。`src/templates/viewer.html` はダウンロードする単体HTMLの外枠です。単体HTMLのJavaScriptとCSSには、サイト本体と同じソースをビルド時に取り込みます。

## 保存・DB

GitHub Pagesは静的配信のため、サーバー側のDBや更新APIはありません。[GitHub Pagesの説明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

| 保存先 | 用途 |
| --- | --- |
| `src/data/collection.json` + Git履歴 | 公開データの永続保存・履歴・復元。ビルド時に検証して `/content/me/collection.json` を生成 |
| IndexedDB `mockobj-content-me-v1` / `collections` / `active` | 編集画面で「保存して反映」した画像・円・配置の下書きを保存 |
| ダウンロードした `collection.json` | バックアップ、別ブラウザへの移動、公開データの更新 |

公開画面は必ず公開JSONを読みます。編集者や閲覧者の下書きが公開画面へ混ざることはありません。編集画面は誰でも自分のブラウザ内で試せますが、公開データを書き換えるにはリポジトリへの書込権限が必要です。GitHubのトークンやパスワードをサイトに埋め込む必要はありません。

下書きは「保存して反映」で保存します。保存前のタイトルや円の編集はタブを閉じると失われます。ブラウザのデータ消去でも下書きが失われるので、定期的に「データを書出」を使ってください。保存領域の不足や壊れたデータは画面に表示し、JSONの読み込みで復元できます。

## 画像と配置の更新

1. `/content/me/editor/` を開く。画像ファイルを追加し、画像上でドラッグして目の範囲を円で指定。
2. タイトルと出典リンクを入力し、「保存して反映」。下のマスを選び、登録画像をクリックして配置。
3. 「プレビュー」で下書きを確認。「データを書出」で `collection.json` を保存。
4. このリポジトリで次を実行。

```powershell
npm run data:import -- "C:\Users\mukoy\Downloads\collection.json"
npm run build
git add src/data/collection.json
git commit -m "Update eyes collection"
git push
```

`data:import` は入力を検証してから差し替えます。不正なデータで公開データを上書きしません。画像ファイルから取り込んだデータはJSONに埋め込まれるため、画像用の別サーバーも不要です。外部画像URLはリンク切れやCORS制約の影響を受けるため、ファイルからの取り込みを推奨します。

GitHub上で `src/data/collection.json` をアップロードして置き換え、mainへコミットする方法でも更新できます。

「サイトを書出」は画像と配置を含む `me.html` をダウンロードします。このファイルはオフラインでも単体で開けます。

## GitHub Pagesの初回設定

この作業の公開先は **publicの `mockObj/mockObj.github.io`（リポジトリID: `1424163394`）** です。`sheep_web` は別のリポジトリです。push前に `npm run repo:verify` でoriginのURL、転送の有無、リポジトリID、公開状態を確認できます。現在の作業コピーには、この確認を自動実行するローカルのpre-pushフックも設定しています。別の場所にcloneした場合は、push前に手動で実行してください。

ワークフローのbuild・deployジョブも名前とIDが一致した場合だけ実行します。リポジトリを改名・複製した場合にはジョブを実行しません。

所有者のアカウントで [Settings → Pages](https://github.com/mockObj/mockObj.github.io/settings/pages) を開き、Build and deployment → Sourceで **GitHub Actions** を選びます。

mainへのpush後に `.github/workflows/deploy.yml` がチェック・テスト・ビルド・公開を行います。設定前の実行が失敗した場合は、[Actions](https://github.com/mockObj/mockObj.github.io/actions) で `Deploy Astro to GitHub Pages` を開いて再実行してください。独自ドメインや外部DBの設定は不要です。[Astro公式のGitHub Pages手順](https://docs.astro.build/en/guides/deploy/github/)

## 確認

```powershell
npm run check
npm test
npm run build
npm run test:browser
```

ブラウザテストはローカルにインストールされたMicrosoft Edgeを使い、公開画面、画像の追加・編集・保存・再読込、下書きと公開データの分離、JSONの再読込、オフラインHTMLの書き出し、破損データからの復元を確認します。

## 初期素材の出典

- Mouthwashing / Curly: Wrong Organ / CRITICAL REFLEX の公式Steam素材。https://store.steampowered.com/app/2475490/Mouthwashing/
- 古明地さとりの第三の目: 東方地霊殿 / ZUN / 上海アリス幻樂団の公式立ち絵（Touhou Wiki掲載画像）。https://touhou.fandom.com/wiki/Satori_Komeiji
- シーカーの目: Nintendo公式SVGの中央の図形。https://www.nintendo.com/us/store/products/the-legend-of-zelda-breath-of-the-wild-switch/

取得URLと加工内容は `src/scripts/eyes.js` と `public/content/me/assets/sheikah-eye.svg` に残しています。
