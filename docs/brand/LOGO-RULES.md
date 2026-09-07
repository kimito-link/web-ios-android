# LP・自社サイトを作るときは「ロゴが主役」（2026-09-04 ユーザー指摘）

> ユーザーの言葉: **「ロゴがいのちなのにひどすぎる」**

**キミトリンクのロゴはブランドの顔。小さく飾ってはいけない。**

## 正本の置き場（ここから取る。作らない・加工しない）
- `kimito-link/src/images/brand/logo/color/` … 全バリエーション
- ★**既定は `logo_kimito-link_RGB_maru_ginga.png`**（丸が銀河テクスチャの特別版）
- favicon は `logo_kimito-link_RGB_favi_blue.png`
- 比率は **800x600**（横長ではない）

## 本家 `kimito-link/src/index.html` の扱い方（これに合わせる）
```html
<img src=".../logo_kimito-link_RGB_maru_ginga.png"
     width="220" height="220" fetchpriority="high" alt="Kimito-Link Logo">
```
- ファーストビューに **220〜400px** で置く
- `fetchpriority="high"` で**最優先読み込み**
- ★つまり **ロゴは主役**。ヘッダーの隅に置く飾りではない。

## 実際にやらかした失敗（繰り返さない）
1. **高さ30pxの飾りにした** → 潰れて読めない。「ひどすぎる」と指摘された
2. **別素材のサイズ指定を流用した** → 追憶LPの**横長**ロゴ用の `width=160 height=40` を、
   比率800x600の**正方形寄り**ロゴに当てて歪ませた。
   ★**素材ごとに比率が違う。コピペする前に実寸を測る**
3. **暗い背景に置いた** → ロゴが濃紺(#1c4b7d)なので沈む。
   ★**明るい地にする**（追憶のきらめきLPも明るい地）

## 配色（ロゴから取る）
- 紺 `#1c4b7d` / 濃紺 `#14375c` / オレンジ `#c8721c`
- 地は生成りの明るい色（例 `#fffaf4` / `#fff3e6`）

## 参考にするLP（この3つを見てから書く）
- `kimito-link/src/index.html` … ★ロゴの扱いの正本
- `tsuioku-no-kirameki.com/tsuioku-no-kirameki/index.html` … 構成と「弱点も正直に書く」姿勢
- `characterlive/index.html` … 上記を踏まえた最小構成の実例
