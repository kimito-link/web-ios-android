# kimito-skill.link/hub/「出荷事故ゲート導入マトリクス」設計書

設計=Fable（`model:"fable"`サブエージェント） / 素材集め=マルチLLM会議（4/5成功） / 裏取り=司令塔 / 2026-08-31 / council-fableスキル手順2の産物

## お題
github/配下の各プロジェクトが、web-ios-androidキットの出荷事故ゲート9項目をどれだけ導入しているかを、kimito-skill.link/hub/ダッシュボードに可視化する。

## 実測で裏取りした事実（会議の一部を訂正）
- Exploreエージェントで12プロジェクトを先行調査済み（ファイル名キーワード検索、Glob/Grepベース、誤検知なし）
- 会議でgpt-oss-120bが主張した「言語別パーサーが必要」は実測で否定。ゲートはNode製`.mjs`のコピー配置であり、basename一致で判定可能
- `.claude/worktrees/`配下に重複ファイルが実在（surechigai-romi.link）。walk除外パターンに`.claude`を含める必要あり

## 決定事項（詳細はFableの設計本文を参照）
1. データ取得: 動的スキャン一本＋薄いオーバーライドJSON（evidence必須・fail-closed）
2. 対象外判定: プラットフォームプロファイル（hasCapacitor/hasTwa/hasAndroidDir等）を機械検出し、ゲート定義の`appliesTo`述語と突合
3. 3状態＋unknown: 色＋実テキスト記号（✓✗—?）＋`data-state`＋sr-onlyの4重化。対象外はグレー（赤系にしない）
4. 追加先: `generate-hub-dashboard.mjs`に機能追加。スキャン部は`scripts/lib/hub-kit-matrix.mjs`に純関数分離（selftest毒注入のため）
5. デザイン: 既存インラインstyleに追記のみ、既存配色（`.doctor.ok`等）を再利用

却下案: 言語別パーサー／手動JSON正本／ハイブリッド（手動が正）／GitHub Actions巡回スキャン／各プロジェクトへのビーコン配布／新npmスクリプト／JSヒートマップライブラリ

## 実装ハンドオフ
Fableの設計本文（B〜F節）に、ファイルパス・関数シグネチャ・正規表現・CSS・selftest毒のケースまで実装可能な粒度で記載済み。次のアクションで実装する。

## 次のアクション
このセッション内で継続実装する（council-fableスキルの通常運用では次チャットに引き継ぐが、今回はユーザーの作業フロー上、同一セッションで実装まで進める）。
