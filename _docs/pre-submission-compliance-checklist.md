# 提出前コンプライアンスチェック テンプレ（iOS + Android・Capacitor WebView 薄殻向け）

両OSの審査提出前チェックを **(A) CIで自動化できる静的チェック** と **(B) ランタイム/手動でしか確認できない項目** に分けたテンプレ。各項目に該当ガイドライン条番号と「Capacitor server.url WebView 薄殻アプリでの当てはまり度（高/中/低）」を付す。

> 出典: 2026-06-30 deep-research（106エージェント・23クレーム検証済み・3-0が大半）。一次ソース＝Apple/Google/fastlane/Capacitor/RevylAI公式。
> ⚠️ ガイドライン§番号・Required Reason 理由コード・必須SDKリストは更新されうる。運用時に都度一次ソースで再確認すること。

---

## 0. 結論（薄殻アプリでの優先度）

- **iOS で最優先＝プライバシーマニフェスト**（`PrivacyInfo.xcprivacy`）。Capacitor は Apple の「マニフェスト必須サードパーティSDKリスト」に明記され（2024-05-01施行・現行）、WebView 薄殻でも**提出要件として直接当てはまる**（当てはまり度: 高）。
- **greenlight（iOS静的スキャナ）は薄殻には当てはまり度 中〜低**。非公開API/UIWebView/動的コード実行/暗号マイニング等のコード検出は「該当ソースが無い＝空振り」になりやすい。ただしプラットフォーム言及・プレースホルダ・HTTP/IPv4・プライバシーポリシー参照・マニフェスト周りは薄殻でも有効。
- **両OSともツールは全問題を保証しない**（Google「pre-launch reportは全問題を特定できると保証しない」/ greenlight「静的パスは false sense of security」）。**(A)CI自動静的 + (B)手動/ランタイム の2層**が現実解。

---

## (A) CIで自動化できる静的チェック

| 項目 | ツール/方法 | ガイドライン | 薄殻当てはまり度 |
|---|---|---|---|
| プラットフォーム言及（Android/Google Play/Windows 等の文字・スクショ写り込み） | greenlight / grep / スクショ専用ページ(bare layout) | App Store審査 | **高**（X/𝕏ロゴ写り込みは過去却下歴）| <!-- impl: templates/scripts/lint-pre-submission.mjs#platform-references -->
| プレースホルダ文字列（Lorem ipsum/Coming soon/TBD） | greenlight / grep | 2.3 メタデータ | 中 |
| ハードコードされた HTTP/IPv4 URL（本番URL設定ミス） | greenlight / grep | — | **高**（server.url の設定ミス検出に有効）| <!-- impl: templates/scripts/lint-pre-submission.mjs#capacitor-server-cleartext (部分: server.url のみ。全ファイル grep は未実装) -->
| プライバシーポリシー参照の有無 | greenlight / 手動 | 5.1.1 | 高 | <!-- impl: templates/scripts/lint-pre-submission.mjs#app-config-review-urls -->
| ハードコードされたシークレット/APIキー | greenlight / gitleaks | 1.6 | 中（殻にキーを置かなければ低）|
| 非公開API使用 | greenlight / IPA解析 | 2.5.1 | 低（殻にネイティブcoードほぼ無し＝空振り）| <!-- impl: none (IPA バイナリ解析が必要で source grep では空振り。薄殻当てはまり度:低・キット事故実績なし。greenlight 非採用の判断は §greenlight 導入の判断基準を参照) -->
| UIWebView 残存（削除済みAPI・hard reject） | greenlight | 2.5.1 | 中（古いプラグイン由来の混入に注意）| <!-- impl: templates/scripts/lint-pre-submission.mjs#uiwebview-scan (ios/ コミット時のみ。CI 生成運用の最終ゲートは Apple ITMS-90809) -->
| 動的コード実行・暗号マイニング | greenlight | 2.5.2 / 3.1.5 | 低 |
| メタデータ違反（他PF言及/到達不能URL/禁止語/著作権年） | **fastlane precheck**（iOS・メタデータのみ） | 2.3 | 高 | <!-- impl: templates/scripts/lint-pre-submission.mjs#platform-references (部分: 他PF言及のみ。fastlane precheck 本体=到達不能URL/禁止語/著作権年は未導入) -->
| Swiftコードのlint | swiftlint（fastlane経由・raise_if_swiftlint_error でCIゲート可） | — | **低**（殻はSwiftほぼ無し）|
| **iOS プライバシーマニフェスト宣言**（`PrivacyInfo.xcprivacy`：Required Reason API カテゴリ＋理由コード） | 手動確認 + CIでファイル存在検査 | 必須SDK要件(2024-05) | **高**（後述）| <!-- impl: templates/scripts/lint-pre-submission.mjs#privacy-manifest -->
| Android: AAB署名 | リリースWF（既存 android-patch-signing） | — | 高 | <!-- impl: templates/scripts/android-patch-signing.mjs -->
| Android: Data Safety 整合 | **Data Safety CSV 自動生成→API送信**（kimito実装済み）| Play Data Safety | **高** | <!-- impl: templates/scripts/play-fill-data-safety.mjs -->
| Android: 権限の最小化 | manifest grep / Google Checks | Play権限ポリシー | 中 |

### iOS プライバシーマニフェスト（薄殻の中核・見落とし注意）
- Capacitor は Apple の[必須SDKリスト](https://developer.apple.com/support/third-party-SDK-requirements/)に明記。`@capacitor/filesystem`・`@capacitor/preferences` 等が Required Reason API を使う。
- `PrivacyInfo.xcprivacy` に APIカテゴリ＋承認理由コードのペアを宣言:
  - `NSPrivacyAccessedAPICategoryUserDefaults` → `CA92.1`（App Group時は `1C8F.1`）
  - `@capacitor/filesystem` の FileTimestamp → `C617.1`
- 通常は Capacitor/各プラグインが同梱マニフェストを持つが、**提出要件としては開発者責任**。最終バンドルに集約されているか Xcode で確認。
- 参照: [Capacitor公式 privacy-manifest](https://capacitorjs.com/docs/v5/ios/privacy-manifest)
- **実装時の裏取り補正（2026-07-04）**: `cap add ios` のアプリテンプレ（ios-pods-template / ios-spm-template）は app-level `PrivacyInfo.xcprivacy` を**生成しない**（SDK 側 Capacitor.framework が同梱、ionic-team/capacitor #7321 = Capacitor 6.0.0 以降）。よって単純な「ファイル存在検査」は CI 生成プロジェクトで必ず false-fail する。lint の `privacy-manifest` チェックは「`@capacitor/ios` <6 なら fail ／ ios/ コミット済みでマニフェストを置いたのに pbxproj 未参照なら fail（バンドルされない）／ ios/ コミット済み・マニフェスト無しは warn」に落としてある。

---

## (B) ランタイム/手動でしか確認できない項目

| 項目 | 確認方法 | ガイドライン | 薄殻当てはまり度 |
|---|---|---|---|
| **OAuth が外部Safariに飛ばないか**（アプリ内完結） | 実機/TestFlight | 4.0 Design / 4.8 | **高**（kimito #4 却下の本丸。静的解析不可）|
| Sign in with Apple 等価ログインの提供 | 実機 + ボタン実動作 | 4.8 | **高**（ソーシャルログイン主体なら必須。greenlightは「存在」しか見ず実動作は見抜けない）|
| アカウント削除フローが実際に動くか | 実機 | 5.1.1 | 高 |
| Restore Purchases が動くか（IAPある時） | 実機 | 3.1.1 | 低（kimitoは課金なし）|
| 認証後画面のスクショが実アプリか | スクショ撮影（公開ページ方式推奨）| 2.3.3 | 高（[[apple-reject §2.3 kimitoケース]]参照）|
| Android: クラッシュ/ANR/起動パフォーマンス | **Play pre-launch report**（実機Roboクロール） | — | 中（殻はクラッシュ/起動に偏る・WebロジックはWeb側でテスト）|
| Android: アクセシビリティ（ラベル/タッチ/コントラスト） | pre-launch report | — | 中 |
| Android: Familiesポリシー/なりすまし/最小機能 | Google Checks（セルフチェック・審査非共有）+ 手動 | Playポリシー | 中 |

---

## ツール比較（何を検出し、何を検出しないか）

- **greenlight**（iOS・Go・無料・オフラインCLI）: コードの静的パターン30+。**フロー実動作は検出不可**（自己申告「false sense of security」）。`verify`サブコマンドのみ有料クラウド実機。
- **fastlane precheck**（iOS）: **メタデータのみ**解析。バイナリ非検査＝非公開API/シークレット/UIWebViewは検出不可。他PF言及/禁止語/到達不能URL/プレースホルダを検出。
- **swiftlint**: Swiftコードのlint。薄殻では当てはまり度低。
- **Play pre-launch report**（Android）: 実機Roboクロール＝**ランタイム**。安定性/アクセシビリティ/パフォーマンス/Android互換性。Webロジックは拾いにくい。
- **Google Checks**（Android）: Data Safety整合/権限最小化/Families/制限API の**セルフチェック**。結果は審査に共有されず・ゲートではない。
- **Data Safety フォーム**（Android・全アプリ必須）: SDK/制御下WebView経由のオフデバイス送信も申告対象。ローカル処理のみは申告不要。

---

## greenlight 導入の判断基準

- **価値が高い**: ネイティブプラグインを自作/追加する時、提出前の安価なワンショット静的スイープ、プラットフォーム言及/プレースホルダ/HTTPの一括検出。
- **価値が低い**: 純粋な server.url 殻でネイティブ変更ゼロの定常リリース（コード検出の多くが空振り）。
- 結論: **薄殻アプリでは「あれば便利だが必須ではない」**。むしろ本テンプレの (A)grep系 + プライバシーマニフェスト確認 + (B)実機フロー検証 の方が当たりが高い。

---

## CI（GitHub Actions）への落とし込み（構成案）

- **PRゲート（必須・失敗でブロック）**: プラットフォーム言及grep / HTTP-IPv4 grep / PrivacyInfo.xcprivacy 存在検査 / AAB署名 / Data Safety CSV生成の整合（orphan key 0）。
- **警告のみ（落とさない）**: greenlight preflight / fastlane precheck（メタデータ）/ swiftlint。
- **手動/別フェーズ**: 実機OAuthフロー（外部Safari）/ アカウント削除動作 / Play pre-launch report 確認 / スクショ目視。
