# 正本・契約・共通化境界の設計規約

Version: 1.0
Status: Adopted
Adopted: 2026-09-02

ChatGPT（原点の設計思想の提示者・レビュー）とClaude（司令塔・実地調査）の往復で作成。
v0→v0.1→v0.2→v1.0を経て正式採用。**今後、規約と現実が衝突しない限りv1.1以降の改訂は
行わない**（運用で矛盾・事故が出たときのみ規約改訂に戻る）。

## 発端

`findRepoRoot()`の重複実装をきっかけに、「/componentディレクトリを作れば解決する」という
案から出発したが、実際に君斗りんく（`ai-shain.link`）のChatworkアイコン表示不具合を実コードで
調査する過程で、問題が「関数の重複」だけでなく「文字列定数の重複」「認証経路の重複」
「送信ロジックの重複」など、複数の異なる姿で現れることが分かった。

さらに調査を進める中で、もう一段大きな発見があった。「既存コードを探すようになったAIが、
次に踏む事故は『見つけた既存コードを何でも正本として使ってしまう』ことだ」という指摘である。

> 車輪の再発明を防ぐだけでは足りない。**見つけた古い車輪を何でも標準車輪にしてしまう**のも
> 防がないといけない。

この規約は3段階で構成される:

- **SEARCH**: 既存を見つける工程
- **CANONICAL CHECK**: それを信じてよいか判定する工程
- **ESTABLISH（必要な場合のみ）**: 正しい正本が存在しない場合に、正しい場所に作る工程

これにより「車輪を再発明しない」「間違った車輪を標準化しない」「本当に車輪が無いときだけ
正しい場所に作る」「確証が無いうちは壊さない」の4つを同時にカバーする。

**この規約が最終的に整理した5つの非等価性**（v1.0で確定）:

```
同じ文字列   ≠ 同じ意味
同じコード   ≠ 同じ責務
既存にある   ≠ 正本
KEEP SEPARATE ≠ 正本不要
UNKNOWN      ≠ 全部停止
```

## 実地調査で確認した事実（規約の根拠）

### 成功例（物理共通化が正しく機能している）
- `scripts/lib/tree-view-component.mjs`（web-ios-android）: 単一正本、2生成スクリプトが正しくimport
- `scripts/lib/architecture-map-core.mjs`（web-ios-android）: git/fs走査の単一アダプタ、9関数
- `templates/scripts/verify-app-config-schema.mjs`: 単一バリデータ、ajv使用
- `isPublishable()`（`architecture-map-visibility.mjs:78`）: fail-closedの単一定義、2箇所がimport

### ケース1: DEMO.self.name（ESTABLISH/REHOMEが必要だった実例。「同じ文字列≠同じ意味」の教材）

**Evidence Status（事実の確からしさ）**

FACT（実コードで確認済み）:
- `scripts/lancers-forbidden.mjs`は、ファイル冒頭コメント通り**Lancers向け実演録画の
  「事故防止フィルタ」定義の唯一の正本**（映ってはいけない実名パターンの検算専用モジュール）
- `DEMO`定数（33-36行目）は`self`/`other`の2フィールドのみで、コメントに「デモの登場人物。
  撮影スクリプトはここを参照する」と明記。**撮影台本用のダミーデータ**という文脈で定義されている
- `DEMO.self.name`をimportしているのは`lancers-record-demo.mjs`と`shiori-record-states.mjs`の
  2ファイルのみ、いずれも**デモ動画生成専用**
- `src/site.webmanifest:2`と`src/index.html`（6箇所以上）にも同じ**文字列**「君斗りんく」が
  独立にハードコードされているが、`lancers-forbidden.mjs`をimportしておらず、**参照関係が無い**
- `app.config.json`のような、より上位の設定ファイルはこのリポジトリに存在しない（Glob 0件）

HEURISTIC / UNKNOWN（**v1.0で訂正**: 断定していた箇所を訂正）:
- `DEMO.self.name`とLP側の表示名は、**文字列が一致していることだけがFACT**であり、
  参照関係は無い（FACT）。**両者が本当に同一のdomain concept（同じ責務・同じ理由で
  変更されるべきブランド名）として扱われるべきかは、まだUNKNOWNである**。v0.2までの
  版では「同じ概念（ブランド名）を表している」と断定していたが、これは誤り。撮影台本の
  ダミーデータとLPの実ブランド表示が「たまたま同じ文字列を使っている」だけで、本来別の
  責務（前者はデモ演出用、後者は実サービス表示）である可能性も排除できていない
- ファイルの主目的（Lancers撮影専用の禁止語検算）と実利用範囲（2ファイルのみ）から見て、
  下位のdemo専用モジュールに「アプリ全体の自分自身の表示名」という広い責務を置くのは
  **依存方向が逆転している**可能性が高い、という判断は引き続きHEURISTICとして成り立つ

**Decision Status（設計判断）**

PROPOSED（この規約が提案する結論だが、まだDECLAREDではない）:
- `DEMO.self.name`は**既存Canonicalとして再利用（REUSE）しない**。理由: 置き場所が
  Lancers撮影専用モジュールであり、責務の置き場所として不適切
- **v1.0で訂正**: 「同じ概念だからESTABLISHする」とは**しない**。正しい手順は、
  「両者が同一責務として扱われるべきかをCANONICAL CHECKで判定し、**同一責務であると
  DECLAREDされた場合にのみ**ESTABLISH/REHOME候補になる」という順序である。現時点では
  この判定自体が済んでいない（UNKNOWN）ため、ESTABLISH/REHOMEはまだ候補にすぎない
- 実行するかどうかは今回のスコープでは決定していない

**分離の教訓（今回の規約の核心）**:
> Evidence Status: 既存の参照元として`DEMO.self.name`が存在する（FACT）
> Evidence Status: 同じ文字列を使っている（FACT）
> Evidence Status: 参照関係は無い（FACT）
> Evidence Status: 両者が同一責務かは未判定（UNKNOWN）
> Decision Status: REUSEしない。同一責務かのCANONICAL CHECKを経てからESTABLISH/REHOMEを検討（PROPOSED）
>
> 「文字列が同じ」と「意味・責務が同じ」を混同しない。これがCANONICAL CHECKの核心の教材である。

### ケース2: site-chrome（重複解消を先に検討すべきだった実例。Semantic Canonical候補、結論保留）

**Evidence Status**

FACT（実コードで確認済み）:
- `site/scripts/site-chrome.js`と`templates/web/site-chrome/site-chrome.template.js`は、
  `isActive()`関数と`mountToggle()`関数が一字一句完全一致
- `site/`はバンドラなし（`package.json`のdependenciesは空）。`<script src="scripts/site-chrome.js">`
  という素の`<script>`タグで読み込まれる（ESモジュールでもバンドルでもない）
- `templates/README.md`に配布手順は「`SITE_CONFIG`/`NAV_ITEMS`を対象サイトの値に置換」と明記。
  手コピー＆値の置換が正式手順で、自動コピーするスクリプトは存在しない
- 既存の「core lib import」パターン（`templates/scripts/check-instrument-ran.mjs`が
  `./lib/instrument-core.mjs`をimportする形）は、両端がNode実行のCLIスクリプト同士で成立して
  いる。`site-chrome.js`は現在`<script src>`の素読み込みであり、**現状のNode向けimport方式を
  そのまま流用することはできない**（FACT）。これを解消するために必要な変更の具体案は複数
  あり得るが、どれが妥当かは未検討
- 差分は値だけではない。実サイト側にしかない機能ブロック（`.share-to-ai-btn`、`ai-index-slot`
  差し込み）が丸ごと1つ乗っている
- 直接の先例（`tree-view-component.mjs`）はあるが、不変条件「このファイルは何もimportしては
  いけない」があり、共有できる部分は「importなしの純粋関数」に限定される

**教訓（今回の規約の核心）**:
> 「重複を検出する仕組み」より先に「重複そのものをなくせないか」を見る必要がある。
> `isActive()`/`mountToggle()`が完全一致すると分かった時点で、すぐ「関数単位PAIRSを作ろう」
> へ進んではならない。まず「なぜ同じ関数が2つ必要なのか」を問う。

この「なぜ2つ必要か」への回答候補は4つ（CANONICAL CHECKで判定する）:
- A. 1つのCanonical Sourceを両方から直接importできる（現状の素`<script>`読み込みでは
  そのまま実現できないことはFACT。実現方法は複数あり得るが未検討）
- B. 1つのCanonical Sourceから生成/コピーできる（`tree-view-component.mjs`に先例あり。
  ただし差分が値だけでなく機能ブロック単位のため、単純なテンプレ生成では足りない可能性が高い）
- C. 配布境界上、物理コピーが不可避なのでenforcement（同期保証の仕組み）が必要
- D. 現在同じなだけで、将来別々に進化する責務（未確定）

**Decision Status**: **Candidate（候補）に留まる。今回は結論を出さない**（DECLAREDにしない）。

**重要な区別**: もしSemantic Canonicalとして扱うと決まった場合でも、`PAIRS`や
`check-drift.mjs`は**Canonicalそのものではない**。それらは**Enforcement**である。

### ケース3: Chatwork送信（KEEP SEPARATEが正しい設計判断だった実例。Contract Canonicalの非適用例）

**Evidence Status**

FACT（実コードで確認済み）:
- `ai-shain.link`（無人本番運用）・`ai-shain-worker`（テスト実行、人間が事後確認）・
  `reply-copilot-openrouter-v2`（ブラウザ拡張のUI操作代行）の3実装で、「入力→composer投入→
  送信ボタンクリック→成功可否」という4ステップの骨格だけが共通
- FACT: 各runtimeで安全要件が明確に異なる。`ai-shain.link`のみroomId厳密照合・承認カード
  （sha256/nonce/expiresAt）による二重送信防止・DOM着信照合による送信成功確認を持つ。
  `reply-copilot-openrouter-v2`のみEnterキーフォールバックを持つ

UNKNOWN:
- 有用なCanonical Contractをこの4ステップから抽出できるかは未検証。ただしこのUNKNOWNは
  **今回の設計判断（Contractを作るか否か）を直接左右するmaterial UNKNOWN**である
  （「安全要件を残したまま共通化できるか」が分からない限り、共通化に踏み込めない）

**Decision Status**

DECLARED DECISION: 現時点では**KEEP SEPARATE**。3実装の**境界をまたぐ共有Canonical
Contractは作らない**という意味である。

**v1.0で訂正**: これは「`ai-shain.link`の`send.mjs`が自動的にCanonicalになる」という
意味では**ない**。KEEP SEPARATEと決めただけでは、内部の実装がCanonicalとして成立する
わけではない。Canonicalの成立条件（後述: Decision Status = DECLARED、かつCanonical
Sourceが一意に明示）は、境界をまたぐ場合だけでなく、**各runtime内部についても同様に
適用される**。`ai-shain.link`が自分の内部で`send.mjs`を正本にしたいなら、必要に応じて
別途CANONICAL CHECKを行い、成立条件を満たしてから宣言する（例えば`send.mjs`内で
同じ送信ロジックが複数箇所に重複していないか、という同一リポ内でのREUSE判定は、今回の
KEEP SEPARATE判断とは別に行う）。

**この判断はContract Canonicalという分類の「非適用例」である**（実在するContract
Canonicalの実例ではない。後述の表を参照）。

理由: 4ステップの骨格は抽象度が高すぎる。承認・二重送信防止・DOM照合・再送可否・認証・
人間確認/無人実行といった、各runtimeが重視する安全上の意味を、共通Contract化によって
削ってしまうリスクがある。material UNKNOWNが残る状態で、安全要件を削るような統合を
進めるのは、この規約の安全原則（後述）に反する。

## 5種類の正本（v1.0で実例・候補・非適用例を区別）

「規約上その種類のCanonicalが存在しうる」ことと、「今回それが実在すると確認できた」ことは
別である。混同しないため、以下では各種類について**確認済み実例／候補／非適用例**を分けて示す。

| 正本の種類 | 定義 | 確認済み実例（Canonical成立） | 候補（結論保留） | 非適用例（KEEP SEPARATE等） |
|---|---|---|---|---|
| **Implementation Canonical** | 同一runtime・同一責務の関数/UIコンポーネント。変わる理由がない | `tree-view-component.mjs`, `architecture-map-core.mjs`, `isPublishable()` | — | — |
| **Data Canonical** | 同じ概念を表し、同じ理由によって変更される値 | なし（今回はまだ成立例なし） | `DEMO.self.name`とLP表示名が同一責務かは未判定。CANONICAL CHECKを経てDECLAREDされて初めて候補が正式化する（ケース1） | — |
| **Contract Canonical** | API/メッセージ/schemaの入出力の意味 | なし | — | Chatwork送信: KEEP SEPARATEとDECLARED。共有Contract Canonicalを作らない非適用例（ケース3） |
| **Policy Canonical** | fallback/error/validation/loadingの判断規則 | なし | Chatwork送信の安全機構は用途別に強度が違う＝Policyとして意図的に分岐している事実はあるが、明文化された単一のPolicy Canonicalとしてはまだ確立していない | — |
| **Semantic Canonical** | プラットフォーム境界・配布境界をまたぐ、意味は同じでも実装は別 | なし | `site-chrome.js`↔`site-chrome.template.js`: 結論保留のCandidate（ケース2） | — |

**Data Canonicalの定義について**: 「同じ概念を表し、同じ理由によって変更される値」という
定義は、CANONICAL CHECKの項目（同じ意味か・同じ理由で変更されるか）を満たして初めて
Data Canonicalと呼べる、という意味である。単に同じ文字列を含んでいるだけでは、この定義を
満たしたことにならない（ケース1の教訓そのもの）。

## 判定フロー（SEARCH → CANONICAL CHECK → 出口6種）

```
CLAUDE.md
      ↓
Architecture Map
      ↓
SEARCH（ai-hub find / grep / Architecture Map参照）
      ↓
候補あり ／ 候補なし
      ↓
CANONICAL CHECK
      │
      ├─ 同じ責務か？
      ├─ 同じ意味か？
      ├─ 同じ理由で変更されるか？
      ├─ 正本候補の置き場所は責務として適切か？
      ├─ 依存方向が逆転しないか？
      ├─ runtime/platform/配布境界はあるか？
      └─ 安全性/確実性の要求水準は同じか？
      ↓
  この判断を左右する material UNKNOWN が残っているか？（v1.0で「いずれかのUNKNOWN」から限定）
      │
      ├─ material UNKNOWNが残る ─→ 破壊的・不可逆な出口（大規模REHOME・既存削除・
      │                    安全要件を削るCONTRACT統合）には進まない。
      │                    KEEP SEPARATE / LOCAL / 現状維持 / 追加調査を優先
      │                    （判断と無関係なUNKNOWNは無視してよい）
      ↓
┌────────────────────────────────────────────────┐
│ REUSE            既存の適切な正本を再利用          │
│ ESTABLISH/REHOME 正本が無い、または既存候補の      │
│                   置き場所が不適切なので、          │
│                   適切な責務境界に確立              │
│ CONTRACT         実装は別、契約(入出力)を共有       │
│ SYNC             実装は別、意味をenforcementで同期  │
│ KEEP SEPARATE    その境界をまたぐ共有Canonicalは    │
│                   作らない（各実装内部で独自の      │
│                   Canonicalを持つには、別途          │
│                   CANONICAL CHECKと成立条件が要る）  │
│ LOCAL            現在の宣言済みスコープ内で利用先が  │
│                   1箇所だけ。Canonical化は不要        │
└────────────────────────────────────────────────┘
      ↓
CHANGE
      ↓
Gate
      ↓
Proof
```

**SEARCH・CANONICAL CHECK・ESTABLISHの役割分担**:
- SEARCH: 既存を見つける工程
- CANONICAL CHECK: それを信じてよいか判定する工程
- ESTABLISH: 正しい正本が存在しない場合に**初めて**、正しい場所に作る工程

**LOCALについて（v1.0で未来予測を排除）**: KEEP SEPARATEは「複数の既存実装があるが、
それらの間で共有Canonicalを作らない」という判断であるのに対し、**LOCAL**は「そもそも
現在の宣言済みスコープ内で、同じ責務の利用先が1箇所だけであり、共有要件が確認されて
いない」という判断である。**「将来必要になる見込みが薄いから」という未来予測は判定材料に
しない**（AIに将来予測をさせるとHEURISTICがFACT化する）。あくまで現時点のスコープ内で
利用先が1箇所かどうかだけを見る。将来、実際に2箇所目が現れたら、その時点で改めて
SEARCH → CANONICAL CHECKを行えば十分である。

### CANONICAL CHECKで判定すること（最低限）

既存候補が見つかったら、次を全て確認してから使う:

1. **同じ責務か**: 見つかった値/関数の本来の役割は何か。名前・置き場所・コメントから読む
2. **同じ意味か**: 値が偶然一致しているだけで、参照関係が無い可能性はないか（ケース1で
   実際に起きた: `DEMO.self.name`とLP側の表示名は同じ**文字列**だが、同一責務かは
   **UNKNOWNのまま**である）
3. **同じ理由で変更されるか**: 今は同じでも、将来同じ理由で変更されるとは限らない。
   過剰な共通化を防ぐための問い
4. **正本候補の置き場所は責務として正しいか**: そのモジュール/ファイルの主目的と、今使おうと
   している責務が一致しているか
5. **依存方向が逆転しないか**: 下位（用途限定）のモジュールに、上位（全体共通）の責務を
   持たせようとしていないか
6. **runtime/platform/配布境界はあるか**: 物理的に同じファイルをimportできない境界がある場合、
   REUSEではなくCONTRACTかSYNCを検討する
7. **物理共通化できるか（REUSE）**: 境界が無く、置き場所も適切なら、まず1実装への統合を検討する
8. **重複そのものをなくせないか**: SYNCの仕組み（PAIRS等）を作る前に、そもそも2つのコピーが
   本当に必要かを問う（ケース2の教訓）。生成スクリプト化・import構造の変更で1つに減らせないか
   先に検討する
9. **contractだけ共有すべきか（CONTRACT）**: 実装は複数必要でも、入出力の意味を揃える
   価値があるか。ただし共通化によって重要な差分（安全要件等）を削らないか要確認（ケース3）
10. **semantic syncにすべきか（SYNC）**: 物理共通化もcontract共有も難しいが、意味だけは
    揃えたい場合。CanonicalとEnforcementを分けて設計する
11. **共通化しない方が安全か（KEEP SEPARATE）**: 境界をまたぐ共有Canonicalを作らないという
    判断。各実装内部でのCanonicalは妨げないが、内部Canonicalも自動成立はしない（後述の
    成立条件を別途満たす必要がある）
12. **現在のスコープ内で利用先が1箇所だけか（LOCAL）**: 未来予測はしない。今の宣言済み
    スコープ内で他に同じ責務が無いなら、Canonical化自体を見送る
13. **正本が存在しない、または既存候補が同一責務とDECLAREDされたなら ESTABLISH/REHOME**:
    適切な責務境界に新しくCanonicalを確立する。**ただしmaterial UNKNOWNが残るなら、
    破壊的な移行は実行しない**（次項の安全原則）

判定結果は6つに分かれる: **REUSE** / **ESTABLISH/REHOME** / **CONTRACT** / **SYNC** /
**KEEP SEPARATE** / **LOCAL**。

### 安全原則: material UNKNOWNが残るときは破壊的・不可逆な共通化に進まない（v1.0で限定範囲を明確化）

CANONICAL CHECKの各項目のうち、**今回の設計判断（REUSE/ESTABLISH/CONTRACT/SYNC/KEEP
SEPARATE/LOCALのどれを選ぶか）を直接左右するUNKNOWN**（= material UNKNOWN）が残って
いる場合、次の行動には**進まない**:
- 既存コード・既存ファイルの削除
- 大規模なREHOME（多数のファイルを一括で書き換える移行）
- 安全要件・確認機構を削るようなCONTRACT統合

**v1.0で明確化**: 判断に無関係な細部のUNKNOWN（例: あるファイル名の由来が分からない、
コメントの意図が不明、等）は、この安全原則の対象外である。設計判断そのものに影響しない
UNKNOWNを理由に、CHANGEを無期限に止めてはならない。「material（判断を左右する）か
どうか」を都度判定してから、安全原則を適用するかを決める。

UNKNOWNが残る場合に優先すべき行動:
- **KEEP SEPARATE**（境界をまたぐ共有Canonicalを作らず、各実装内部のCanonicalに留める）
- **LOCAL**（この場では正本化を見送る）
- **現状維持**
- **必要なら追加調査**（UNKNOWNをFACTかHEURISTICへ格上げしてから再判定する）

ケース1（`DEMO.self.name`）がこの原則の実例: 「両者が同一責務か」というmaterial
UNKNOWNが残ったまま、既存の値を削除して一括REHOMEするような実行はしない。

## 物理共通化を避ける／慎重に判断する条件

1. **実行環境・配布境界がある**: 物理的に同じファイルをimportできない場合でも、
   Contract/Policy/Testレベルでの共通化は検討の余地がある（REUSEを避けるだけで、
   CONTRACT/SYNCまで否定しない）
2. **安全性/確実性の要求水準が違う**: 強い方に弱い方を合わせる物理統合は避ける
3. **見た目や名前が似ているだけ**（意味が違う）: 責務の同一性を確認していない類似コード
4. **依存方向が逆転する**: 用途限定の下位モジュールに全体共通の責務を置くと、逆転を検知
   したら、ESTABLISH/REHOMEで正しい置き場所へ移す
5. **同じ理由で変更されない**: 今は同一実装でも、将来の変更理由が異なると予想される場合は、
   物理統合を急がない
6. **material UNKNOWNが残る**: 前項の安全原則の通り、判断を左右する確証が持てないうちは
   破壊的な統合を避ける

## テストでliteralを残すべき条件

正しい整理:
- **Canonicalが正しく利用されていることを検証するテスト**（例:「一致判定ロジックが機能するか」）
  → Canonicalを参照してよい。値自体は任意の固定文字列で成立する
- **Canonicalの値そのものが仕様通りであることを検証するテスト**（例:「ブランド名は
  『君斗りんく』である、という仕様そのものを守っているか」）
  → **独立したexpected literal / fixture / specを使う**。Canonicalをimportしない。
  正本の誤変更が起きたとき、このテストが「仕様と実装が食い違った」ことを検知する役目を持つ

## Canonical と Enforcement の分離

```
Canonical Source
（何が真実なのか＝仕様/source/schema/policy）
      ↓
Enforcement
（その真実から逸脱していないか確認する仕組み＝PAIRS/check-drift/Gate/Test）
```

- **Canonical**: 仕様そのもの。Implementation Canonicalなら実装ファイル、Data Canonicalなら
  定数定義、Contract Canonicalならschema/type定義、Policy Canonicalなら判断規則の明文化、
  Semantic Canonicalなら「意味の仕様」（複数実装が満たすべき契約・期待結果）
- **Enforcement**: Canonicalからの逸脱を検出する仕組み。`PAIRS`/`check-drift.mjs`/
  各種`Gate`/テストがこれにあたる
- 特に生成スクリプトを使う場合: **Canonical = 生成元**、**Generated Copy = 派生物**、
  **Gate = 派生物が最新か確認する仕組み**。`PAIRS`そのものがCanonicalなのではない

## FACT/HEURISTIC/UNKNOWN と Decision Status（2軸に分離）

**Evidence Status**（知識としての確からしさ）:
- **FACT**: 実コードで確認できた事実（参照元の存在・利用箇所・依存構造）
- **HEURISTIC**: 推測。断定しない
- **UNKNOWN**: 確認できていない。「たぶん重複していない」も「たぶん重複している」も言わない

**Decision Status**（設計上どう決めたか）:
- **PROPOSED**: この規約が提案する結論だが、まだ実行に移すと決まっていない
- **DECLARED**: 正式に決定し、CHANGEへ進んでよい

例（Chatwork）:
```
FACT: 安全要件が異なる
UNKNOWN（material）: 有用なCanonical Contractを抽出できるか
DECLARED DECISION: 現時点ではKEEP SEPARATE
```

**「既存の参照元が存在する」（FACT）と「それを正本として採用してよい」（HEURISTIC/UNKNOWN）と
「採用する/しないと決めた」（PROPOSED/DECLARED）は、常に別の行として書く。混同して
1つの結論に圧縮しない。**

**重要な決定（変更なし）**: 文字列重複を自動検出するGateは作らない。代わりに、人間/AIが
「これは正本を持つべき責務」と一度宣言してから、その宣言済み責務についてのみ正本逸脱を
機械検査する方式にする。

## Canonicalの成立条件

以下の**両方**が満たされたときに初めて、あるものを「Canonical」と呼んでよい:

1. **Decision Status = DECLARED**（REUSE/ESTABLISH-REHOME/CONTRACT/SYNCのいずれかで
   正式決定済み。PROPOSEDのままでは成立しない）
2. **Canonical Source（仕様/source/schema/policy）が一意に明示されていること**
   （どのファイル・どの定義が「真実」なのかが1つに定まっている。複数の候補が並存した
   ままでは成立しない）

どちらか片方だけでは不十分。例えば`DEMO.self.name`は現状「参照元が複数あるうちの1つ」に
過ぎず（Canonical Sourceが一意でない）、かつDecision StatusもPROPOSEDに留まる（DECLARED
ではない）ため、いずれの条件も満たしておらず、Canonicalとして成立していない。

**v1.0で明確化**: この成立条件は、**境界をまたぐSemantic Canonicalだけでなく、KEEP
SEPARATEと判定された各runtime内部の実装についても同様に適用される**。「KEEP SEPARATE」は
「境界をまたぐ共有Canonicalを作らない」という判断であって、「各runtime内部の実装が
自動的にCanonicalになる」という意味ではない。`ai-shain.link`が自分の`send.mjs`を
内部の正本として扱いたい場合も、必要に応じて別途CANONICAL CHECKを行い、この成立条件
（DECLARED、かつCanonical Sourceが一意）を満たしてから宣言する。

## どの時点で正本と宣言するか

- CANONICAL CHECKでREUSE/ESTABLISH-REHOME/CONTRACT/SYNCのいずれかとDECLAREDされ、かつ
  Canonical Sourceが一意に明示された時点（前項の成立条件を両方満たした時点）
- KEEP SEPARATEの場合は「その境界をまたぐ共有Canonicalを宣言しない」だけである。各実装
  内部でのCanonical宣言は、この規約とは別に、内部について改めてCANONICAL CHECKと成立
  条件を満たしてから行う。LOCALの場合はCanonical自体を宣言しない
- 宣言の形式は責務の種類による: Implementation/Data Canonicalは`export`する1ファイル、
  Contract Canonicalはschema/type定義、Semantic CanonicalはCanonical Source（仕様/生成元）
  を明示し、Enforcement（PAIRS/Gate等）は別途設計する

## 正本変更時に利用先をどう検証するか

Architecture Mapは完全なAST依存解析ではなく、HTML/JSON/manifest/runtime read/dynamic
reference/文字列参照はimport graphだけでは追えない。

- Implementation/Data Canonical: **Architecture Mapのimport edges＋exact reference
  search（grep等）＋既存Gate/Test**の組み合わせで利用先を確認する。import edgesだけを
  万能扱いしない
- Contract Canonical: 契約を満たすテスト（fixture/期待結果）が全実装側にあるか確認
- Semantic Canonical: Enforcement機構（`check-drift.mjs`等）、または重複解消（生成
  スクリプト化）ができた場合は生成元の検証で足りる

## 今回は結論を出さなかったこと（次回への持ち越し）

- `DEMO.self.name`とLP側の表示名が同一責務かどうかの判定自体が、まだ行われていない
  （material UNKNOWNのまま）。判定を経てDECLAREDされない限り、ESTABLISH/REHOMEは実行しない
- `site-chrome.js`↔`templates/web/site-chrome/`について、重複解消（B案: 生成スクリプト化）の
  コストが見合うかは未検討。既存Enforcement機構（`check-drift.mjs`）がファイル単位比較しか
  できないのか、関数単位にも対応できるのかも未確認
- Chatwork送信のContract化はしない、というDECLARED DECISIONはmaterial UNKNOWNを根拠に
  しており、将来別の情報が出れば再検討し得る
- PRE-FLIGHT receiptに「どの責務を探していたか」「CANONICAL CHECKの結果」を記録する仕組みは、
  この規約が定着してから検討する（時期尚早）

## まだやらないこと（今回のスコープ外、確認済み）

- 文字列重複の自動検出Gate（方針として不採用）
- `ai-shain.link`の`DEMO.self.name`のESTABLISH/REHOME実行（PROPOSEDのみ、DECLAREDではない。
  同一責務かの判定自体が済んでいないため）
- `site-chrome.js`のPAIRS登録（重複解消を先に検討すべきため、かつCandidateのまま結論保留のため）
- Chatwork送信のcontract定義ファイルの新規作成（KEEP SEPARATEとDECLAREDしたため）
- CLAUDE.mdへの新しい基準の追記（文章を増やさない、という前回設計の方針を維持）
- コード変更・commit・push（本ドキュメントの改訂のみ）
