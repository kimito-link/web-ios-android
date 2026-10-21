// warn-long-running-session の P7(1回/セッション)テスト。
// 純関数(sanitizeSessionId / markerPathFor)の単体 + フック本体を2回起動して
// 「同じ session_id では二度目が黙る」挙動(E2E)を実測する。
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sanitizeSessionId, markerPathFor } from './warn-long-running-session.mjs';

const HOOK = fileURLToPath(new URL('./warn-long-running-session.mjs', import.meta.url));

describe('sanitizeSessionId / markerPathFor', () => {
  it('安全な文字だけ残す', () => {
    expect(sanitizeSessionId('session_01ABC')).toBe('session_01ABC');
    expect(sanitizeSessionId('a b/c\\d')).toBe('a_b_c_d');
    expect(sanitizeSessionId(null)).toBe('');
  });
  it('マーカーパスは session ごとに分かれる', () => {
    const a = markerPathFor('/base', 'sess-A');
    const b = markerPathFor('/base', 'sess-B');
    expect(a).not.toBe(b);
    expect(a.endsWith('sess-A.json')).toBe(true);
    expect(a.includes('warn-long-running')).toBe(true);
  });
});

/** 2日前の timestamp を先頭に持つ transcript を作る(経過>12h の信号を確実に出す)。 */
function makeTranscript(dir) {
  const p = join(dir, 'transcript.jsonl');
  const old = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  writeFileSync(p, JSON.stringify({ type: 'user', timestamp: old }) + '\n', 'utf8');
  return p;
}

function runHook(transcriptPath, sessionId, tmp) {
  const input = JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, cwd: tmp });
  return spawnSync(process.execPath, [HOOK], {
    input,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: tmp },
  });
}

describe('1回/セッション(P7・E2E)', () => {
  it('初回は警告を出し、同じ session では二度目が黙る。別 session は再び出す', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'warn-p7-'));
    try {
      const transcript = makeTranscript(tmp);

      const r1 = runHook(transcript, 'sess-ONCE', tmp);
      expect(r1.status).toBe(0);
      expect(r1.stdout).toContain('additionalContext');
      // マーカーが記録された
      expect(existsSync(markerPathFor(tmp, 'sess-ONCE'))).toBe(true);

      const r2 = runHook(transcript, 'sess-ONCE', tmp);
      expect(r2.status).toBe(0);
      expect(r2.stdout.trim()).toBe(''); // 二度目は黙る

      const r3 = runHook(transcript, 'sess-OTHER', tmp);
      expect(r3.status).toBe(0);
      expect(r3.stdout).toContain('additionalContext'); // 別セッションは出す
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('経過が浅く正本更新も無ければ(信号なし)何も出さない', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'warn-p7b-'));
    try {
      const p = join(tmp, 'transcript.jsonl');
      writeFileSync(p, JSON.stringify({ type: 'user', timestamp: new Date().toISOString() }) + '\n', 'utf8');
      const r = runHook(p, 'sess-FRESH', tmp);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
