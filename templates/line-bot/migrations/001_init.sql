-- LINE bot 最小スキーマ（単一公式アカウント・単一プロジェクト向けに簡素化）
-- 出典: line-harness-oss（マルチアカウント/マルチ製品のCRM機構を除去した最小版）

CREATE TABLE IF NOT EXISTS friends (
  id             TEXT PRIMARY KEY,
  line_user_id   TEXT UNIQUE NOT NULL,
  display_name   TEXT,
  picture_url    TEXT,
  status_message TEXT,
  is_following   INTEGER NOT NULL DEFAULT 1,
  ai_reply_mode  TEXT NOT NULL DEFAULT 'bot', -- 'bot' | 'human'（エスカレーション後に人間対応へ切替）
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS messages_log (
  id           TEXT PRIMARY KEY,
  friend_id    TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  direction    TEXT NOT NULL, -- 'incoming' | 'outgoing'
  message_type TEXT NOT NULL DEFAULT 'text',
  content      TEXT NOT NULL,
  source       TEXT, -- 'groq_reply' | 'groq_canned' | 'fallback' 等（outgoingのみ）
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_messages_log_friend ON messages_log (friend_id, created_at);

-- Groq/LLM 回答キャッシュ（canonical 質問のみ・TTL既定72h）
CREATE TABLE IF NOT EXISTS llm_response_cache (
  id                  TEXT PRIMARY KEY,
  question_hash       TEXT NOT NULL,
  question_normalized TEXT NOT NULL,
  answer              TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  expires_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_response_cache_lookup
  ON llm_response_cache (question_hash, expires_at);

-- RAG 用ナレッジ記事 + FTS5（日本語は bigram フォールバック併用）
CREATE TABLE IF NOT EXISTS kb_articles (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts USING fts5(
  title,
  content,
  content='kb_articles',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS kb_articles_ai AFTER INSERT ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS kb_articles_ad AFTER DELETE ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS kb_articles_au AFTER UPDATE ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
  INSERT INTO kb_articles_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

-- Groq 日次使用量（無料枠監視・fail-closed 安全弁）
CREATE TABLE IF NOT EXISTS groq_usage_daily (
  id           TEXT PRIMARY KEY,
  usage_date   TEXT NOT NULL UNIQUE,
  groq_calls   INTEGER NOT NULL DEFAULT 0,
  cache_hits   INTEGER NOT NULL DEFAULT 0,
  escalations  INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);
