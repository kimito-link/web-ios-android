// 自動デバッグ（自動で遊ばせて不具合を見つけ、記録し、再現し、直ったかまで確かめる）の判定部品。純関数だけ。
//
// なぜ要るか: りんく(2026-11-27)が龍が如くスタジオの「全自動バグ取りシステム」(CEDEC 2020・ファミ通 2020-09)を共有し
//   「活用されてないような」。このキットの検査は「書いたコードを読む」「決めた手順を通す」だけで、
//   ①勝手に歩き回って ②見つけたら証拠と再現手順つきで自動起票し ③自動で再現を試し ④重複数で優先度を決め
//   ⑤直ったら同じ手順で自動確認し・再発しなければ自動で閉じる、の輪が無かった。
// 正本の決まり: docs/ai-rules/17_AUTO_DEBUG.md
// ★この部品が判定しないこと: 見た目の崩れ・文言の誤り・ログインが要る画面の中（入口までしか歩かない）。

import { createHash } from 'node:crypto';

/** 見つけた異常の種類 → 重要度（記事: 重要度は「エラー判定の種類」で決める）。 */
export const SEVERITY = {
  'js-exception': 'high', // 画面の JavaScript が落ちた
  'server-5xx': 'high', // 同じサイトのサーバーが 500 番台を返した
  'blank-screen': 'high', // 開いたのに何も描かれない
  stuck: 'high', // 開くのに 20 秒以上かかった・固まった
  'broken-link': 'medium', // 同じサイト内のリンク先が 404
  'console-error': 'medium', // コンソールに error が出た
  'request-failed': 'low', // 同じサイトへの通信が途中で切れた
};

export function severityOf(type) {
  return SEVERITY[type] ?? 'medium';
}

/** 重複数 → 優先度（記事: 同じエラーが多い＝広く効いている＝先に直す）。 */
export function priorityOf(count) {
  if (count >= 10) return 'P1';
  if (count >= 3) return 'P2';
  return 'P3';
}

/** URL の道筋を「同じ画面なら同じ形」にそろえる（数字・長い英数字・クエリは潰す）。 */
export function normalizePath(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return String(url);
  }
  const path = u.pathname
    .split('/')
    .map((seg) => {
      if (/^\d+$/.test(seg)) return ':n';
      if (/^[0-9a-f-]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{24,}$/.test(seg)) return ':id';
      return seg;
    })
    .join('/');
  return `${u.host}${path}`;
}

/** 文言から毎回変わる部分（数字・URL・引用の中身の長い英数字）を潰す。 */
export function normalizeMessage(msg) {
  return String(msg ?? '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** 同じ不具合なら同じ指紋。Issue の題に [auto-debug:<指紋>] として入れ、重複をまとめる鍵にする。 */
export function signatureOf(finding) {
  const key = [finding.type, normalizePath(finding.url), normalizeMessage(finding.message)].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 10);
}

/** 1回の巡回で出た異常を指紋ごとにまとめる（同じ回の重複も数として残す＝記事「重複も役に立つデータ」）。 */
export function groupFindings(findings) {
  const map = new Map();
  for (const f of findings) {
    const sig = f.signature ?? signatureOf(f);
    const cur = map.get(sig);
    if (cur) cur.count += 1;
    else map.set(sig, { ...f, signature: sig, count: 1 });
  }
  return [...map.values()];
}

/** 再現なしで閉じるまでの日数（記事: 同じエラー報告が来なくなったら「もう再発しない」として確認済みにする）。 */
export const QUIET_DAYS_TO_CLOSE = 14;

const MARK_RE = /<!-- auto-debug (\{.*?\}) -->/;

/** Issue 本文に埋めた台帳（指紋・合計回数・最後に見た日）を読む。 */
export function readMark(body) {
  const m = MARK_RE.exec(String(body ?? ''));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function writeMark(body, mark) {
  const line = `<!-- auto-debug ${JSON.stringify(mark)} -->`;
  const b = String(body ?? '');
  return MARK_RE.test(b) ? b.replace(MARK_RE, line) : `${b}\n\n${line}\n`;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * 今回の巡回結果と既存の Issue から、やることを決める。
 * issues: [{ number, state: 'OPEN'|'CLOSED', body, labels: [name] }]（題に [auto-debug:sig] があるものだけ渡す）
 * found:  groupFindings() の結果に reproduced(true/false) を足したもの
 * replayed: Map<指紋, 再現したか>（既存 Issue に残した手順を今夜たどり直した結果。再現したものは found にも入れて渡す）
 * 返り値: [{ op: 'create'|'bump'|'reopen'|'close'|'verified', ... }]
 *   verified = 人や PR が閉じた Issue を、残した手順でたどっても出なかった（記事: 修正確認を自動で「確認済み」に）
 */
export function planActions({ issues, found, replayed = new Map(), now = Date.now(), quietDays = QUIET_DAYS_TO_CLOSE }) {
  const bySig = new Map();
  for (const is of issues) {
    const mark = readMark(is.body);
    if (mark?.sig) bySig.set(mark.sig, { ...is, mark });
  }
  const actions = [];
  const seen = new Set();
  for (const f of found) {
    seen.add(f.signature);
    const is = bySig.get(f.signature);
    if (!is) {
      const mark = { sig: f.signature, count: f.count, lastSeen: new Date(now).toISOString() };
      actions.push({ op: 'create', finding: f, mark, severity: severityOf(f.type), priority: priorityOf(f.count) });
      continue;
    }
    const count = (is.mark.count ?? 0) + f.count;
    const mark = { ...is.mark, count, lastSeen: new Date(now).toISOString() };
    const op = is.state === 'CLOSED' ? 'reopen' : 'bump'; // 閉じたのに再発 = 記事の「差し戻し」
    actions.push({ op, number: is.number, finding: f, mark, severity: severityOf(f.type), priority: priorityOf(count) });
  }
  for (const [sig, is] of bySig) {
    if (seen.has(sig)) continue;
    if (is.state === 'CLOSED') {
      if (replayed.get(sig) === false && !is.mark.verified) {
        actions.push({ op: 'verified', number: is.number, sig, mark: { ...is.mark, verified: new Date(now).toISOString() } });
      }
      continue;
    }
    const last = Date.parse(is.mark.lastSeen ?? '');
    if (Number.isFinite(last) && now - last >= quietDays * DAY) {
      actions.push({ op: 'close', number: is.number, sig, quietDays });
    }
  }
  return actions;
}

/** 本番で押してはいけないものの文言（押すと消える・お金・送る・出る）。巡回はこれを含む要素を押さない。 */
export const DENY_WORDS =
  /削除|消す|退会|解約|購入|買う|支払|決済|課金|申し込|申込|送信|投稿|ログアウト|サインアウト|delete|remove|logout|log out|sign out|signout|purchase|buy|checkout|pay|subscribe|submit|send|post/i;

export function isSafeTarget(t, origin) {
  if (DENY_WORDS.test(`${t.text ?? ''} ${t.href ?? ''} ${t.label ?? ''}`)) return false;
  if (t.kind === 'link') {
    try {
      const u = new URL(t.href);
      if (u.origin !== origin) return false; // 外のサイトへは出ない
      if (/^(mailto|tel|javascript):/i.test(t.href)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** 種から決まる乱数（同じ種なら同じ歩き方＝そのまま再現手順になる）。 */
export function rng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** まだ行っていない所を優先して、次に押すものを1つ選ぶ（記事: 寄り道も含めていろいろな可能性を試す）。 */
export function pickTarget(targets, visited, random) {
  if (!targets.length) return null;
  const fresh = targets.filter((t) => !(t.kind === 'link' && visited.has(t.href)));
  const pool = fresh.length && random() < 0.8 ? fresh : targets;
  return pool[Math.floor(random() * pool.length)];
}
