-- LINEシミュレーション（本番のままの通し確認）用。正本: docs/ai-rules/12_LINE_SIMULATION.md
-- 偽の利用者（env.E2E_USER_ID）への返信・push は LINE に送らず e2e_capture に記録する。
-- 偽の利用者が送った「ファイル・画像」の中身は e2e_files に置く（E2E スクリプトが置き、終わったら消す）。
-- どちらも E2E の外では空のまま。

CREATE TABLE IF NOT EXISTS e2e_capture (
  id         TEXT PRIMARY KEY,
  method     TEXT NOT NULL,          -- replyMessage / pushMessage など
  payload    TEXT NOT NULL,          -- 送るはずだった引数（JSON）
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS e2e_files (
  name         TEXT PRIMARY KEY,     -- messageId の `e2e-file:<name>` の <name>
  content_type TEXT,
  body_base64  TEXT NOT NULL
);
