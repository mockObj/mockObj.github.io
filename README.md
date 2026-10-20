# mockObj / eyes

元の `eyes-self-hosted` をAstro 7の静的サイトへ移植したものです。公開URLは https://mockobj.github.io/content/me/ です。

## 開発

Node.js 22.22以上（推奨24）を使います。

```powershell
npm ci
npm run dev
```

`http://127.0.0.1:4321/content/me/` の右下に「編集」リンクが表示されます。`/content/me/editor/` が編集画面、`/content/me/preview/` が下書きのプレビューです。同じオリジン（127.0.0.1）で開いてください。

`http://127.0.0.1:4321/content/me/loading-test/` はローカル専用のローディング確認ページです。待ち時間（即完了〜8秒・手動完了）、再実行、途中での完了、PC幅・スマホ幅を切り替えられます。編集画面の「ローディング確認」からも開けます。本番と同じコンポーネント・CSS・完了処理を使い、登録画像や保存データは読みません。

公開画面と下書きプレビューの右下には、ローカル開発時だけ「動作確認」が表示されます。Aの視線戻し、Bの個別まばたき・画像交換を、最初の1分や抽選を待たずに試せます。まばたき時間も入力で変更できます。この入力値はそのページでの確認用です。公開時の初期値はCSSのパラメータで設定します。デバッグUIは公開ビルド・書き出した単体HTMLには含めません。

編集画面と下書きプレビューは `npm run dev` のときだけ登録されます。サーバーは127.0.0.1で起動します。公開用のビルドには編集リンク・編集画面・下書きプレビューを含めず、公開URLの `/content/me/editor/` と `/content/me/preview/` は404になります。`npm run preview` は公開用ビルドの確認用なので、編集には `npm run dev` を使ってください。

## 画面とソースの対応

| ファイル・フォルダ | 編集する内容 |
| --- | --- |
| `src/layouts/SiteLayout.astro` | HTML、タイトル、メタ情報 |
| `src/components/viewer/EyeField.astro` | 目の空間、描画用canvas |
| `src/components/viewer/FieldChrome.astro` | 操作ヒント、ステータス |
| `src/components/viewer/LoadingEye.astro` | 読み込み中の両目と、その上の「Now loading...」 |
| `src/components/editor/` | 編集ヘッダー、画像の設定、登録画像一覧、読込エラー |
| `src/pages/content/me/` | 公開画面、公開JSON |
| `src/local/` | ローカル開発時だけ使える編集画面と下書きプレビュー |
| `src/styles/viewer.css` / `editor.css` | 色、余白、レスポンシブ表示 |
| `src/scripts/viewer.js` | ドラッグ、スクロール、目の追従 |
| `src/scripts/viewer-settings.js` | 演出時間・頻度・視線追従・慣性・画像寸法の共通設定 |
| `src/lib/viewer-styles.js` | 共通設定からCSS変数・まばたきのキーフレームをビルド時に生成 |
| `src/scripts/loading-screen.js` | 本番・単体HTML・確認ページで共通のローディング完了処理 |
| `src/local/loading-test.astro` | ローカル専用のローディング確認と操作パネル |
| `src/scripts/random-field.js` | 重複を抑えたランダム配置、座標ごとの配置保持 |
| `src/scripts/field-layout.js` | 画像サイズとグリッドの寸法 |
| `src/scripts/field-gl.js` | WebGLの描画 |
| `src/scripts/eyes.js` | 初期サンプル、出典、目の描画素材 |
| `src/scripts/editor.js` | 画像の取り込み、切り抜き、配置の操作 |
| `src/lib/collection-model.js` | JSONの検証。ブラウザ、ビルド、取込コマンドで共通利用 |
| `src/lib/collection-store.js` | IndexedDBの画像別保存、画像変換、ZIP・HTMLの書き出し |
| `src/lib/collection-files.js` / `collection-format.js` | 画像・登録情報の分割保存、参照とハッシュの検証 |
| `src/lib/collection-archive.js` | 画像入りZIPバックアップの入出力 |
| `src/lib/prepare-viewer.js` / `published-viewer.ts` | 公開用WebPの切り出し・圧縮、小さな画像一覧の生成 |
| `src/data/collection/items/` | 1登録につき1つの小さなJSON。タイトル・出典・切り抜き位置・画像参照 |
| `src/data/collection/images/` | 画像ごとの原本。内容のSHA-256で重複をまとめ、先頭2文字でフォルダ分け |
| `public/content/me/assets/` | 元の画像ファイル（元のバイトを保持） |

Astroコンポーネントは通常のマークアップで編集できます。大きなHTMLを埋め込んだiframeは使っていません。描画と編集のJavaScriptも用途ごとに分けています。`src/templates/viewer.html` はダウンロードする単体HTMLの外枠です。単体HTMLのJavaScriptとCSSには、サイト本体と同じソースをビルド時に取り込みます。

スマホではアクセス直後から画面中央へ視線を向け、スワイプで目が中央を通り過ぎるにつれて向きが変わります。指を離して慣性で移動する間も中央を見続けます。次に触れると慣性が止まります。PCではカーソルへ視線を向けます。演出や慣性の設定は `src/scripts/viewer-settings.js` にまとめています。CSS変数とまばたきのキーフレームは同じ設定からビルド時に生成し、公開画面・下書き・ローディング確認・単体HTMLで共有します。ブラウザの描画中に設定ファイルやスタイルシートを生成し直す処理はありません。

画面端の目には、画像の中心へ視線を戻す動き、またはその画像と枠の範囲だけを上下の黒い幕で閉じ、別の画像に交換して開く動きが起こります。開始までの待ち時間と平均発生間隔は `idle` で調整し、画面全体でA/Bを抽選します。PC・スマホとも抽選時点の画面サイズを使い、枠の見えている部分が外周の帯（短辺×`edgeBand`）に触れている目から1つ選びます。中心が画面外でも枠が一部見えていれば対象になり、枠全体が画面外にある目は対象外です。交換先から現在の画像と周囲8マスの元画像を除外し、画面外の隣接マスや過去に交換した画像も確認します。交換先がない場合は視線の動きだけになります。動きを減らす設定や非表示タブでは抽選を止めます。

`src/scripts/viewer-settings.js` の `VIEWER_SETTINGS` を編集します。時間はすべてミリ秒です。大きさ・間隔の倍率は `1` が現在の見た目です。`sizeScale` は四角だけ、`gapXScale`・`gapYScale` は横・縦の隙間だけを変えます。たとえば `sizeScale: 1.2` で四角を20%大きく、`gapXScale: .5` で横の隙間を半分にできます。隙間は `0` でなくなります。枠・画像・当たり判定・個別まばたきは同じ寸法を共有します。

各パラメータの単位と意味は設定ファイル内のコメントに記載しています。現在の値は同ファイルを参照してください。通常のWebGL表示では画像要素を各マスへ複製せず、代替表示が必要なときだけ作成します。描画用データはフレーム間で再利用し、写真の輪郭も乗算・平方根で計算します。

| 調整する値 | 設定キー |
| --- | --- |
| 目の四角の大きさ | `geometry.sizeScale` |
| 横の隙間 | `geometry.gapXScale` |
| 縦の隙間 | `geometry.gapYScale` |
| サイズ算出の基準列数 | `geometry.columns` |
| 幅による切り替え位置（CSS px） | `geometry.breakpoints` |
| 倍率をかける前の基準セルの最小・最大（CSS px） | `geometry.minCellSize` / `geometry.maxCellSize` |
| 全体と個別のまばたき時間 | `blink.durationMs` |
| 動きを減らす設定での全体まばたき時間 | `blink.reducedDurationMs` |
| 中央へ視線を向ける時間 | `glance.centerMs` |
| 中央で止める時間 | `glance.holdMs` |
| 元の視線へ戻す時間 | `glance.returnMs` |
| 最初の演出禁止時間 | `idle.startDelayMs` |
| 平均発生間隔（A/B合計） | `idle.meanIntervalMs` |
| 抽選間隔 | `idle.checkIntervalMs`（抽選確率は抽選間隔÷平均発生間隔） |
| まばたきを選ぶ確率 | `idle.blinkProbability` |
| 画面端とみなす幅 | `idle.edgeBand` |
| 慣性の減速時間 | `pan.decayMs` |

## 保存・DB

GitHub Pagesは静的配信のため、サーバー側のDBや更新APIはありません。[GitHub Pagesの説明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

| 保存先 | 用途 |
| --- | --- |
| `src/data/collection/` + Git履歴 | 公開に使う原本。画像と登録情報を個別ファイルで保存 |
| IndexedDB `mockobj-content-me-v1`（DBバージョン2）/ `collections` / `active` | 下書きの編集情報と画像の参照のみを保存 |
| 同じIndexedDBの `images` | 画像をBase64文字列にせずBlobで個別保存。内容が同じ画像は1つだけ保存 |
| ダウンロードした `eyes-backup.zip` | 画像原本・登録情報のバックアップ、別ブラウザへの移動、公開データの更新 |

公開画面は必ず公開JSONを読みます。下書きが公開画面へ混ざることはありません。編集操作はローカル開発サーバーで行います。公開データを書き換えるにはリポジトリへの書込権限が必要です。GitHubのトークンやパスワードをサイトに埋め込む必要はありません。

閲覧時は軽量な `/content/me/viewer.json` と `/content/me/images/*.webp` だけを読みます。画像を含む巨大な `collection.json` を閲覧のために取得しません。ビルド時に原本画像の目の周辺と移動用の余白を384×384のWebPへ変換し、元画像・切り抜き設定は変更せず保存します。ファイル名は元画像と切り抜きのハッシュなので、変更のない画像はキャッシュを再利用できます。同じ元画像の切り抜き違いも、ランダム配置では引き続き1種類として扱います。外部画像URLはそのまま利用します。

保存形式は `version: 3` です。`format.json` は形式の番号だけを持ち、`items/先頭2文字/登録IDのハッシュ.json` に1件ずつの編集情報、`images/先頭2文字/画像のハッシュ.拡張子` に画像原本を保存します。JSONには `asset:ハッシュ.拡張子` という参照だけを記録します。全画像を抱える巨大なJSONや、画像数に比例して膨らむ管理ファイルは作りません。256枚の登録上限もありません。

同じ画像から複数の目を切り抜いても原本は1つだけ保存し、最後の参照が削除されたときに不要な画像を除きます。画像は1枚40MB以下です。GitHub Pagesやブラウザの総容量には実際の上限があるため、物理的に無制限ではありませんが、画像の追加で1ファイルが肥大化する方式は使いません。将来ストレージを変更するときも、画像の参照と編集情報をそのまま移せます。

編集・バックアップには `eyes-backup.zip` を使ってください。ZIPを展開したフォルダはそのまま分割形式の原本として取り込めます。`viewer.json` とWebPはビルドの生成物で、編集用の正本ではありません。元データを更新してビルドすると、公開用の圧縮画像も自動で更新されます。公開用ビルドには編集用原本や `/content/me/collection.json`、`/content/me/originals/` は含めません。原本はpublicリポジトリ内にはあります。

読み込み中は提供されたsleepy-loaderの両目が開閉し、その少し上に「Now loading...」を表示します。閉じ始めは全閉まで約1秒の一定速度、75%を過ぎて待機が続く場合は徐々に減速し、長引けばゆっくり開いて繰り返します。完了時もその位置から残りの距離に応じた時間をかけて閉じます。最後の画面切替は初期値で約0.42秒の瞬きです。一段上の層で境界のぼけた黒い幕が上下から中央へ閉じ、完全に覆った瞬間に表示内容を切り替え、中央から外へ開きます。ぼかしはグラデーションで作り、大きなフィルター処理は使いません。ごく短いロードでは小さな目を閉じ切るために待たせません。この動きはダウンロードの進捗率には直接連動せず、CSSで動き続けます。画像の読み込み・描画準備は同時2件までとし、表示サイズに合わせた小さなテクスチャを使います。モバイルの描画解像度も抑え、スクロールは画像群全体の移動にまとめています。WebGLが使えない環境では通常の画像表示に切り替えます。

下書きは「保存して反映」で保存します。保存前のタイトルや円の編集はタブを閉じると失われます。ブラウザのデータ消去でも下書きが失われるので、定期的に「データを書出」を使ってください。保存領域の不足や壊れたデータは画面に表示し、ZIPまたは以前のJSONの読み込みで復元できます。

ローカル編集画面の「登録画像の一覧」では、元画像の全体、タイトル、画像サイズを確認できます。タイトル検索と重複の絞り込みに対応します。重複は同じ画像データ（または同じ画像URL）の登録で判定し、該当する登録番号を表示します。別形式や別URLの画像を見た目で照合するものではありません。各画像の「削除」は、その登録だけを削除し、ほかの登録は残します。

登録画像は、同じ元画像どうしの間隔をできるだけ広げてランダム配置します。異なる元画像が9種類以上ある場合は、上下左右・斜めの隣接8マスに同じ元画像を置きません。全方向の間隔が同じ候補では、縦方向の再登場間隔が長いものを優先します。31種類の初期配置では同じ列の14マス以内に同じ画像が再登場しません。重複登録は1種類として数え、切り抜きが違う登録はランダムに使い分けます。配置はスクロール中・戻ったとき・画面サイズ変更時にも位置ごとに保持し、ページを開き直すと別の並びになります。画面の区切りをまたいでも配置のルールを守り、固定の8×8パターンを繰り返しません。画像数が少ない場合は繰り返し表示します。

初期サンプルは登録画像が0件のときだけ表示します。1件以上登録すると、プレビュー・公開画面・書き出したHTMLでは登録画像だけを表示します。以前の `version: 1` / `version: 2` のJSONも読めます。以前のブラウザ保存は初回読込時に画像別のBlob保存へ自動移行します。画像・登録順・切り抜き設定を引き継ぎ、手動のマス配置は自動配置へ移行します。

## 画像と配置の更新

1. `npm run dev` で起動し、`http://127.0.0.1:4321/content/me/` の「編集」を開く。画像ファイルを追加し、画像上でドラッグして目の範囲を円で指定。
2. タイトルと出典リンクを入力し、「保存して反映」。登録した画像は自動で配置されます。
3. 「プレビュー」で下書きを確認し、「公開データに反映」を押す。未保存のタイトル・切り抜きもまとめて `src/data/collection/` へ保存し、このフォルダだけをGitのステージへ追加します。
4. このリポジトリでcommit / pushすると公開されます。

```powershell
git commit -m "Update eyes collection"
git push
```

「公開データに反映」はローカル開発時だけ使える保存APIへ画像入りZIPを送り、参照・画像ハッシュ・登録情報を検証してから原本を差し替えます。同じオリジンのローカル編集画面からだけ受け付けます。ボタン自体はcommitやpushを実行しません。公開ビルドにはこのAPIも含めません。

「データを書出」は引き続き `eyes-backup.zip` のバックアップです。別途コマンドで取り込む場合は `npm run data:import -- "C:\Users\mukoy\Downloads\eyes-backup.zip"` を使えます。ZIP・展開済みフォルダ・以前の画像入りJSONを受け付け、不正なデータで原本を上書きしません。画像用の別サーバーも不要です。外部画像URLはリンク切れやCORS制約の影響を受けるため、ファイルからの取り込みを推奨します。

GitHubにはZIPそのものをアップロードせず、取込コマンドで分割された `src/data/collection/` をcommitしてください。変更した画像・登録情報だけがGitの差分になります。既存のGit履歴を書き換える必要はありません。

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

モバイル操作はネイティブのタッチイベントを送り、スクロール中の中央への視線、慣性と停止、連続操作と画面高さ変更時の位置保持、タップでの出典リンクを確認します。

公開用WebPの軽量化、切り抜き位置と余白、元データの保持、重複画像の表示頻度、ローディングの繰り返しと文字の位置、準備完了後の視界の瞬き、WebGL無効時の表示も確認します。テストデータには小さなモックを使います。

## 初期素材の出典

- Mouthwashing / Curly: Wrong Organ / CRITICAL REFLEX の公式Steam素材。https://store.steampowered.com/app/2475490/Mouthwashing/
- 古明地さとりの第三の目: 東方地霊殿 / ZUN / 上海アリス幻樂団の公式立ち絵（Touhou Wiki掲載画像）。https://touhou.fandom.com/wiki/Satori_Komeiji
- シーカーの目: Nintendo公式SVGの中央の図形。https://www.nintendo.com/us/store/products/the-legend-of-zelda-breath-of-the-wild-switch/

取得URLと加工内容は `src/scripts/eyes.js` と `public/content/me/assets/sheikah-eye.svg` に残しています。
