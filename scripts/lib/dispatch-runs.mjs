// 役割: dispatch.py の設定(順序・モデル鎖・失敗の合図)と、実行ログ(llm-proxy/runs)の読み取りを1か所にまとめる。
// なぜ要るか: 頭脳の状況(record-brain-status)と、サイトの週間実績(record-site-stats)の両方が同じログを読む。
//   読み方を2つ書くと食い違うので、ここに1つだけ置く。dispatch.py の値は読む(複製しない)。
// 使い方: readDispatchConfig() / readRunLogs({ perBrain, maxFiles, sinceMs })。鍵や会話の内容は読まない(ログ末尾の失敗の合図だけ)。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logLooksFailed, parseRunLogName } from './brain-status-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function readDispatchConfig() {
  const py = fs.readFileSync(path.join(ROOT, 'docs/ai-workflows/tools/dispatch.py'), 'utf8');
  const pyList = (name) => {
    const m = new RegExp(`^${name} = \\[([\\s\\S]*?)\\]`, 'm').exec(py);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  };
  return {
    QWEN_CHAIN: pyList('QWEN_CHAIN'),
    GEMINI_CHAIN: pyList('GEMINI_CHAIN'),
    AUTO_CHAIN: pyList('AUTO_CHAIN'),
    TEXT_CHAIN: pyList('TEXT_CHAIN'),
    FAIL_MARKS: pyList('FAIL_MARKS'),
    ALIBABA_BASE: /^ALIBABA_OPENAI = "([^"]+)"/m.exec(py)?.[1],
  };
}

// 頭脳ごとの実行履歴(新しい順)。{ brain: [{ at, ok, reason }] }。sinceMs を渡すと、それより新しいものだけ。
export function readRunLogs({ failMarks, perBrain = 12, maxFiles = 400, sinceMs = 0 } = {}) {
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'llm-proxy', 'runs');
  const by = {};
  if (!fs.existsSync(dir)) return by;
  const files = fs.readdirSync(dir).map((n) => ({ n, p: parseRunLogName(n) })).filter((x) => x.p)
    .filter((x) => !sinceMs || Date.parse(x.p.at) >= sinceMs)
    .sort((a, b) => (a.p.at < b.p.at ? 1 : -1)).slice(0, maxFiles);
  for (const { n, p } of files) {
    const list = (by[p.brain] ||= []);
    if (list.length >= perBrain) continue;
    let text = '';
    try {
      const fd = fs.openSync(path.join(dir, n), 'r');
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, 6000));
      fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
      fs.closeSync(fd);
      text = buf.toString('utf8');
    } catch { /* 読めないログは数えない */ }
    const mark = failMarks.find((m) => text.includes(m));
    list.push({ at: p.at, ok: !logLooksFailed(text, failMarks), reason: mark || null });
  }
  return by;
}
