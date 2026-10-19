# ヘッダーと検索結果の素材（2.3.14）を、全アプリの出荷手順に入れる

**今の到達点: 検査と手順は実装済み。素材の作成と ASC への登録は、アプリごとに人手が要る（ASC の画面で上げる）。**
入口: [`docs/ai-rules/01_CORE_RULES.md`](../docs/ai-rules/01_CORE_RULES.md) の「2.3.14」行 → このファイル。
関連: [`templates/scripts/lib/creative-asset-specs.mjs`](../templates/scripts/lib/creative-asset-specs.mjs)（寸法の検査）、
[`templates/scripts/lint-pre-submission.mjs`](../templates/scripts/lint-pre-submission.mjs) の CHECK 32。

## これは何か
App Store の商品ページの一番上に出る大きな画像（**ヘッダー**）と、検索結果に出る画像（**検索結果**）。
ASC の「配信 → 版 → プロダクトページ情報 → ヘッダと検索結果」で上げる。**任意**なので、無くても審査は通る。
そのぶん後回しになりやすく、2026-10-18 に malwarecheck で「無いまま審査に出していた」と本人が気づいた。

## 仕様（出典: [Apple 公式](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications)、2026-10-19 確認）
| 場所 | 比率 | 大きさ | 形式 |
|---|---|---|---|
| 商品ページヘッダー | 21:9 | **3840 × 1646** | .jpeg / .jpg / .png |
| 同（もう1つの選択肢） | 16:9 | 5244 × 2950 | .png のみ |
| 検索結果 | 3:2 | 最小 1920 × 1280 〜 最大 3840 × 2560 | .jpeg / .jpg / .png |
| 同（もう1つの選択肢） | 16:9 | 5244 × 2950 | .png のみ |

どちらも**透明（アルファ）は不可**。動画も上げられる（5〜30秒・30か60fps・.mov/.m4v/.mp4）が、まずは画像でよい。

## 載せてよいもの・いけないもの（2.3.14）
- ○ アプリの中身・ブランドに関係する内容。全年齢向け。アプリ名・短い説明・実際の画面
- × **他のアプリへの誤解を招く言及**（姉妹アプリの名前など）／**検証できない主張**（「No.1」「最強」）／**特定・割引の価格**
- 画像の中の文字は機械で読めない。**出す前に人（AI）が画像を見て**、上の×が無いことを確かめる

## 置き場と検査（このキットの約束）
`store-assets/creative-assets/` に **`header.png|jpg`** と **`search-results.png|jpg`** を置く。
`lint-pre-submission` の CHECK 32 が、寸法・形式・透明度を上の仕様と照らす（外れたら **fail**）。
置き場や片方が無ければ **warn**（任意だが入れる価値がある、と知らせる）。

## ★タイミングの罠: 上げられるのは「版が編集できる間」
**審査待ち（WAITING_FOR_REVIEW）の版では、ASC のヘッダー/検索結果の欄に「追加」の操作が出ない**（2026-10-19 実測。空の欄に説明文だけが出る）。
- 出す前（PREPARE_FOR_SUBMISSION）に上げるのが一番楽。**提出の前に素材を用意する**
- 提出した後に気づいたら: ①「この版を審査から削除」して編集 → 上げて再提出（待ち行列の順番は最後になる）か、②次の版（例 0.1.3）で上げる。
  どちらにするかは、直したい緊急度で決める（見た目の改善だけなら②で足りる）
- ASC API でこの欄を操作できるかは**未確認**（API の一覧に見当たらず、現状は画面操作を前提にする）

## 作り方の型（アプリごと）
1. アプリ名・短い説明・アイコン・実際の画面を使い、HTML で組む（価格・主張・他アプリを入れない）
2. ブラウザ（Playwright）で、指定の寸法の**不透明な JPEG**として書き出す（PNG のスクリーンショットは透明を持つことがあるので JPEG が安全）
3. `store-assets/creative-assets/` に置いて lint を通し、画像を目視してから ASC へ上げる
実例: `malwarecheck.site/scripts/generate-creative-assets.mjs`
