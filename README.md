# mockObj / eyes

元の `eyes-self-hosted` をAstro 7の静的サイトへ移植したものです。公開URLは https://mockobj.github.io/content/me/ です。

## 開発

Node.js 22.22以上（推奨24）を使います。

```powershell
npm ci
npm run dev
```

`http://127.0.0.1:4321/content/me/` の右下に「編集」リンクが表示されます。`/content/me/editor/` が編集画面、`/content/me/preview/` が下書きのプレビューです。同じオリジン（127.0.0.1）で開いてください。

編集画面と下書きプレビューは `npm run dev` のときだけ登録されます。サーバーは127.0.0.1で起動します。公開用のビルドには編集リンク・編集画面・下書きプレビューを含めず、公開URLの `/content/me/editor/` と `/content/me/preview/` は404になります。`npm run preview` は公開用ビルドの確認用なので、編集には `npm run dev` を使ってください。

## 画面とソースの対応

| ファイル・フォルダ | 編集する内容 |
| --- | --- |
| `src/layouts/SiteLayout.astro` | HTML、タイトル、メタ情報 |
| `src/components/viewer/EyeField.astro` | 目の空間、描画用canvas |
| `src/components/viewer/FieldChrome.astro` | 操作ヒント、ステータス |
| `src/components/editor/` | 編集ヘッダー、画像の設定、登録画像一覧、読込エラー |
| `src/pages/content/me/` | 公開画面、公開JSON |
| `src/local/` | ローカル開発時だけ使える編集画面と下書きプレビュー |
| `src/styles/viewer.css` / `editor.css` | 色、余白、レスポンシブ表示 |
| `src/scripts/viewer.js` | ドラッグ、スクロール、目の追従 |
| `src/scripts/random-field.js` | 重複を抑えたランダム配置、座標ごとの配置保持 |
| `src/scripts/field-layout.js` | 画像サイズとグリッドの寸法 |
| `src/scripts/field-gl.js` | WebGLの描画 |
| `src/scripts/eyes.js` | 初期サンプル、出典、目の描画素材 |
| `src/scripts/editor.js` | 画像の取り込み、切り抜き、配置の操作 |
| `src/lib/collection-model.js` | JSONの検証。ブラウザ、ビルド、取込コマンドで共通利用 |
| `src/lib/collection-store.js` | IndexedDB、画像変換、JSON・HTMLの書き出し |
| `src/data/collection.json` | 全員に公開する登録画像と切り抜き設定の正本 |
| `public/content/me/assets/` | 元の画像ファイル（元のバイトを保持） |

Astroコンポーネントは通常のマークアップで編集できます。大きなHTMLを埋め込んだiframeは使っていません。描画と編集のJavaScriptも用途ごとに分けています。`src/templates/viewer.html` はダウンロードする単体HTMLの外枠です。単体HTMLのJavaScriptとCSSには、サイト本体と同じソースをビルド時に取り込みます。

## 保存・DB

GitHub Pagesは静的配信のため、サーバー側のDBや更新APIはありません。[GitHub Pagesの説明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

| 保存先 | 用途 |
| --- | --- |
| `src/data/collection.json` + Git履歴 | 公開データの永続保存・履歴・復元。ビルド時に検証して `/content/me/collection.json` を生成 |
| IndexedDB `mockobj-content-me-v1` / `collections` / `active` | 編集画面で「保存して反映」した画像・円・リンクの下書きを保存 |
| ダウンロードした `collection.json` | バックアップ、別ブラウザへの移動、公開データの更新 |

公開画面は必ず公開JSONを読みます。下書きが公開画面へ混ざることはありません。編集操作はローカル開発サーバーで行います。公開データを書き換えるにはリポジトリへの書込権限が必要です。GitHubのトークンやパスワードをサイトに埋め込む必要はありません。

下書きは「保存して反映」で保存します。保存前のタイトルや円の編集はタブを閉じると失われます。ブラウザのデータ消去でも下書きが失われるので、定期的に「データを書出」を使ってください。保存領域の不足や壊れたデータは画面に表示し、JSONの読み込みで復元できます。

ローカル編集画面の「登録画像の一覧」では、元画像の全体、タイトル、画像サイズを確認できます。タイトル検索と重複の絞り込みに対応します。重複は同じ画像データ（または同じ画像URL）の登録で判定し、該当する登録番号を表示します。別形式や別URLの画像を見た目で照合するものではありません。各画像の「削除」は、その登録だけを削除し、ほかの登録は残します。

登録画像はすべて自動でランダム配置します。画像をひと通り使うシャッフルを繰り返し、近くに同じ画像が続く配置を避けます。同じ画像データの重複登録で表示頻度は増えず、切り抜きが違う登録はランダムに使い分けます。配置はスクロール中・戻ったとき・画面サイズ変更時にも位置ごとに保持し、ページを開き直すと別の並びになります。固定の8×8パターンを繰り返さず、登録数や移動範囲に応じて配置を生成します。画像数が少ない場合は繰り返し表示します。

初期サンプルは登録画像が0件のときだけ表示します。1件以上登録すると、プレビュー・公開画面・書き出したHTMLでは登録画像だけを表示します。保存形式は `version: 2` の画像一覧です。以前の `version: 1` のJSONやブラウザの保存データも読めます。登録画像と切り抜き設定は引き継ぎ、手動のマス配置は自動配置へ移行します。

## 画像と配置の更新

1. `npm run dev` で起動し、`http://127.0.0.1:4321/content/me/` の「編集」を開く。画像ファイルを追加し、画像上でドラッグして目の範囲を円で指定。
2. タイトルと出典リンクを入力し、「保存して反映」。登録した画像は自動で配置されます。
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

「サイトを書出」は画像とランダム配置の処理を含む `me.html` をダウンロードします。このファイルはオフラインでも単体で開けます。

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

ブラウザテストはローカルにインストールされたMicrosoft Edgeを使い、ローカルの編集リンク、画像の追加・編集・保存・再読込、下書きと公開データの分離、JSONの再読込、オフラインHTMLの書き出し、破損データからの復元を確認します。100枚の画像がスクロールで表示されること、戻った位置の画像が変わらないこと、公開用ビルドで編集リンクがなく編集画面と下書きプレビューが404になることも確認します。

## 初期素材の出典

- Mouthwashing / Curly: Wrong Organ / CRITICAL REFLEX の公式Steam素材。https://store.steampowered.com/app/2475490/Mouthwashing/
- 古明地さとりの第三の目: 東方地霊殿 / ZUN / 上海アリス幻樂団の公式立ち絵（Touhou Wiki掲載画像）。https://touhou.fandom.com/wiki/Satori_Komeiji
- シーカーの目: Nintendo公式SVGの中央の図形。https://www.nintendo.com/us/store/products/the-legend-of-zelda-breath-of-the-wild-switch/

取得URLと加工内容は `src/scripts/eyes.js` と `public/content/me/assets/sheikah-eye.svg` に残しています。
