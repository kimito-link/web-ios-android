# Chrome Web Store 提出 追体験プレイブック — 拡張機能を審査に出すまで

Chrome 拡張を **CWS の審査に出すまで**を一次情報で記録したもの。
実績: `tsuioku-no-kirameki.com`（拡張ID `cjbabignmmodaickpeckiojjabnlogdb`）で
2026-06〜08 に運用。**提出はコマンド1本で全自動**になっている。

関連の正本:
- `_docs/google-play-submission-playbook.md` — Google Play 側（**自動化の境界が違う**。後述 §1）
- `_docs/apple-reject-knowledge-base.md` — iOS 側の却下ナレッジ
- `_docs/release-pipeline-playbook.md` — Web/iOS/Android 同時リリース

> ⚠️ このプレイブックの最重要事項は **§1**。
> 「CWS の提出は人間がダッシュボードで押すしかない」は**誤り**。
> AI がこれを誤解して user に3回「できません」と言った実績がある（2026-08-03）。

---

## 1. ★提出は全自動（ここを最初に読む）

**ZIP のアップロードから審査送信まで、コマンド1本で完了する。**

```bash
node scripts/cws-publish.mjs build/<name>-<version>.zip --publish
```

- `--publish` **なし** = 下書きアップロードのみ
- `--publish` **あり** = **審査へ提出まで実行**
- 成功判定: `status:["OK"]` / `statusDetail:["OK."]` が返る
- 認証: リポジトリ直下 `.cws-credentials.json`（**gitignore 必須**）
  または環境変数 `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN`

成功時の実際の出力（2026-08-03 v0.1.1244）:

```
アップロード中: build/tsuioku-no-kirameki-0.1.1244.zip → item cjbabignmmodaickpeckiojjabnlogdb
upload: {"kind":"chromewebstore#item","id":"...","uploadState":"SUCCESS"}
審査へ提出(公開申請)中…
publish: {"kind":"chromewebstore#item","item_id":"...","status":["OK"],"statusDetail":["OK."]}
✅ 審査のため送信されました。
```

### なぜ「できない」と誤解されるか（症状／原因／直し方）

- **症状**: AI が「CWS のダッシュボードはブラウザ自動操作できないので、提出は代行できません」
  と回答する。user が「いままでぜんぶやってもらってた」と指摘しても繰り返す。
- **原因**: **2つの別々の事実を混同している**。
  - ✅ 事実: CWS の管理画面は Chrome のポリシーでブラウザ自動操作が全面ブロックされる
    （`The extensions gallery cannot be scripted`）。Claude-in-Chrome MCP では screenshot も
    read_page も一切通らない（2026-06-14 に実測して全ブロックを確認）。
  - ✅ 事実: **公式の Chrome Web Store Publish API がある**。API 経由なら全自動でできる。
  - ✗ 誤り: 前者から「提出できない」を導くこと。**ブラウザ操作の不可 ≠ 提出の不可**。
- **直し方**: 提出を頼まれたら、可否を答える前に**まず自動化の有無を確認する**。
  ```bash
  ls scripts/ | grep -iE "cws|publish|webstore"
  ```
  存在確認より先に「できません」と言わない。

### Google Play との境界の違い（混同しないこと）

| | ZIP/AAB アップロード | 掲載情報の入力 | **審査送信** |
|---|---|---|---|
| **Chrome Web Store** | ✅ API で自動 | ✗ 手動（§4） | **✅ API で自動** |
| **Google Play** | ✅ API で自動 | ✅ API で自動 | **✗ UI 必須** |

Play は掲載情報まで自動化できるが**最後の「審査に送信」だけ UI 必須**
（`google-play-submission-playbook.md` §42-51 に「自動化不可・確定」と実体験で記録）。
CWS はその逆で、**審査送信は自動・掲載文だけ手動**。**逆になっている**ので取り違えない。

---

## 2. 初回セットアップ（1度だけ・約5分）

user のブラウザで実施する。AI は手順を出すところまで。

1. https://console.cloud.google.com/apis/credentials を開く
   （**CWS デベロッパー登録と同じ Google アカウント**で）
2. プロジェクトを1つ作成（名前は任意）
3. 「APIとサービス → ライブラリ」で **Chrome Web Store API** を有効化
4. 「OAuth同意画面」: User Type=外部 → 最低限の入力 → **テストユーザーに自分の Gmail を追加**
5. 「認証情報 → OAuthクライアントID」: 種類 = **デスクトップアプリ** → クライアントID/シークレットを控える
6. 次を開いて同意 → **認証コード**をコピー（`CLIENT_ID` を差し替え）
   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```
   - `oob` が拒否される場合は `redirect_uri=http://localhost:8818` にして、
     リダイレクト先 URL の `?code=` をコピーでも可
7. 認証コード → リフレッシュトークン交換（**ここは AI が実行してよい**）
   ```bash
   curl -s -X POST https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
     -d code=認証コード -d grant_type=authorization_code \
     -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```
8. `.cws-credentials.json` を作成（**gitignore に追加すること**）
   ```json
   { "clientId": "...", "clientSecret": "...", "refreshToken": "..." }
   ```

---

## 3. 毎回の提出フロー

```bash
# 1) ストア用ビルド（★秘密キーを空にするフラグを忘れない・§5参照）
NL_STORE_BUILD=1 npm run build

# 2) ZIP 生成（宣言/参照の突合ガードが走る・§6参照）
python scripts/stage-submission.py <version>

# 3) 版数の整合確認
npm run verify:bump

# 4) LP のライブ版が最新か確認（★審査員が見るのはライブURL）
curl -s https://<your-domain>/privacy.html | grep 最終更新

# 5) 提出（審査送信まで完了する）
node scripts/cws-publish.mjs build/<name>-<version>.zip --publish
```

**手順4を飛ばさないこと。** リポジトリのファイルを直しても、デプロイしていなければ
審査員には旧文が見える。プライバシーポリシーの記述と実挙動の不一致は
**修正再提出ではなくアイテム停止級**（CWS User Data Policy）。

---

## 4. 掲載文の変更だけは手動（API の限界）

- **症状**: ストアの「詳細な説明」を変えたのに、提出しても反映されない。
- **原因**: **Publish API の `items` エンドポイントは掲載情報を更新できない**。
  API でできるのは ZIP のアップロードと審査送信だけ。
- **直し方**: 説明文を変えた回**だけ**、user が手動で貼り替える。
  1. https://chrome.google.com/webstore/devconsole を開く
  2. 該当拡張 →「ストアの掲載情報」→「詳細な説明」
  3. 掲載文の正本ファイルから全文貼り替え → 保存 → 審査送信
- ✗ **効かなかった**: Claude-in-Chrome MCP での自動貼り替え。
  ギャラリーは Chrome ポリシーで screenshot も read_page も全ブロック（2026-06-14 実測）。
  **説明文が前回と同じなら、この手順は不要**（ZIP 提出だけで完結する）。

---

## 5. 提出ビルドに秘密キーを焼き込まない

- **症状**: 提出 ZIP の `dist/*.js` に API の書き込みキーが平文で入っている。
- **原因**: ビルド時 define（esbuild の `define`）で `.env` の値を注入している場合、
  **通常ビルドの成果物をそのまま ZIP に詰めると鍵ごと配布される**。
  CRX は誰でも展開できるので、**公開 = 全世界に鍵を配る**ことになる。
- **直し方**: ストア用ビルドのフラグを設け、その時だけ空文字を焼く。
  ```js
  const IS_STORE_BUILD = process.env.NL_STORE_BUILD === '1';
  const statusDefine = {
    NL_STATUS_INGEST_KEY: JSON.stringify(IS_STORE_BUILD ? '' : process.env.NL_STATUS_INGEST_KEY || ''),
    // ...
  };
  ```
  さらに **ZIP を読み直して空を検証する**ガードを置く（fail-closed）。
  ```python
  for name in [n for n in names if n.endswith('.js')]:
      text = zf.read(name).decode('utf-8', 'ignore')
      for key_name in ('ingestKey', 'viewToken'):
          for m in re.finditer(rf'{key_name}\s*:\s*"([^"]*)"', text):
              if m.group(1):
                  raise RuntimeError('公開キーが焼き込まれています')
  ```
- ★既に配布済みなら**鍵のローテーションが必須**（サーバー側の作業）。

---

## 6. ZIP のアセット欠落（同じ穴を3回踏んだ）

- **症状**: 審査員の実機で効果音が鳴らない・画像が欠ける・ページが空白になる。
  ローカルの開発版では正常に動くので気づけない。
- **原因**: ステージングスクリプトが**手書きの許可リスト**でファイルを選んでおり、
  manifest やコードの追加に追随しない。検査側も同じ穴を持っていた。
  実際に3段階で踏んだ:

  | 回 | 検査の網 | 欠落したもの |
  |---|---|---|
  | 1 | 手書きの必須9件リスト | manifest 宣言済みの `sound/`(38件) `images/avatar-parts/`(22件) |
  | 2 | manifest 宣言のみ突合 | `getURL()` で開くページ4枚 + `<script src>` の guard 2件 |
  | 3 | `<script src>` のみ追跡 | `<img src>` の画像3点（popup を開いた瞬間に404） |

- **原因の本質**: 拡張には **manifest に宣言されない参照経路**がある。
  - `chrome.runtime.getURL('venue.html')` … 自分で開くページは `web_accessible_resources` 不要
  - HTML の `<script src>` `<img src>` … 同梱ファイルなので宣言不要

  「宣言を正本にする」だけでは **fail-closed にならない**。

- **直し方**: **コードと HTML が実際に参照するもの**を追跡し、ZIP の中身だけで突合する。
  ```python
  # タグ種別を限定せず src/href の全属性を拾う（属性が複数行に折られる実例あり→ re.S）
  HTML_ASSET_REF_RE = re.compile(r'(?:src|href)\s*=\s*["\']([^"\']+)["\']', re.S)
  # 引用符3種 + テンプレートリテラル + クエリ/ワイルドカード付きに対応
  RUNTIME_PAGE_RE = re.compile(r'getURL\(\s*[\'"`]([A-Za-z0-9_\-./]+\.html)(?:[?*#][^\'"`]*)?[\'"`]')
  ```
  - ✗ **効かなかった**: `<script[^>]*src=...>` のようにタグを限定する書き方
    → `<img>` を取りこぼす
  - ✗ **効かなかった**: 引用符を `'"` だけにする書き方
    → `` getURL(`x.html?lv=${v}`) `` を取りこぼす
- **ガードを書いたら必ず「壊れた現物の ZIP を食わせて赤になること」を先に確認する。**
  3回とも旧 ZIP を検査させて真因を特定できた。緑だけ見ると穴に気づけない。

---

## 7. 開示文書と実挙動の一致（最重要・アイテム停止級）

- **症状**: プライバシーポリシーに「自動送信しません」と書いてあるのに、
  実際は定期的に外部送信している。
- **原因**: 機能追加時に実装だけ進み、開示文書が追随しない。
  実例（2026-08-03）: status ページを開いて視聴しているだけで **120秒ごとに**
  視聴者のユーザーID・表示名・コメント本文が外部サーバーへ送信されていた。
  判定関数のゲートは4つあったが**同意の条件が一つも無かった**。
  一方で4つの文書すべてが「自動送信しない」と明記していた。
- **なぜ危険か**: CWS の User Data Policy は開示と実挙動の一致を最重要視する。
  審査でネットワークトレースを取れば1回で露見し、**修正再提出ではなくアイテム停止・
  アカウント警告**に至る系統。既存の公開版があるとアカウント全体にリスクが及ぶ。
- **直し方**:
  1. **同意を純関数の最優先ゲートに置く**（他のどのゲートより先に見る）
     ```js
     if (a.optedIn !== true) return { publish: false, reason: 'no_consent' };
     ```
     `=== true` で真偽値のみ受ける（`"true"` / `1` を同意扱いにしない）。
     storage 読み取り失敗時は **false に倒す**（fail-closed）。
  2. **既定 OFF**。ユーザーが自分で ON にするまで送信しない。
  3. 開示文書は**全部**直す。実例では5ファイルあった:
     `privacy.html` / ダッシュボード入力の正本 / 掲載文 / 権限理由書 / 掲載文の別正本。
     1つでも残ると審査員が突き合わせた瞬間に矛盾が見える。
  4. **絶対表現を書かない**。「いかなる経路でもアクセスしません」は、
     アイコン CDN へ `<img>` で接続する事実と厳密には矛盾する。
  5. `host_permissions` を正本に、各ホストが全文書に載っているか機械照合する。
     ```bash
     for f in <文書リスト>; do grep -c "<host>" "$f"; done
     ```

---

## 8. 提出後の確認事項（毎回）

- **「アップロード ≠ 審査送信」**: `--publish` を付けないと下書きのまま。
  `status:["OK"]` が返って初めて審査キューに入る。
- **「審査通過 ≠ 公開」**: 公開範囲（公開／限定公開／非公開）と対象地域の設定が
  意図どおりでないと、通過してもユーザーに届かない。
- **反映時差**: 承認後もストア掲載・既存ユーザーへの自動更新には時間差がある。
  直後に見えないことを「失敗」と誤診しない。
- **拡張の反映3手順**（開発中の確認）: push しただけでは Chrome に届かない。
  user が pull → 拡張リロード → 対象タブ F5 を踏んで初めて反映される。
