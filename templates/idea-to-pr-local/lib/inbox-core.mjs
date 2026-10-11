// @ts-check
/**
 * inbox-core.mjs — 「受付 Issue」方式の判断部分（純関数）。
 *
 * ■ なぜ受付 Issue か（2026-10-12 の実機確認から）
 *   人は Grok に普通に話したい（「このサイトが気になるから直して」）。しかし Grok の GitHub コネクターは、
 *   **Issue の新規作成ではフォームを出して人に「Create issue」を押させる**（実機で確認）。
 *   一方、**既存の Issue へのコメント追加は、フォームも確認も無しで直接書き込める**（実機で確認）。
 *   そこで「受付」用の Issue を1つ置き、Grok にはそこへコメントとして依頼を書かせる。
 *   常駐PCの worker がそのコメントを拾い、
 *     ① 「わかりました」と返信し（AI の返事）
 *     ② 依頼文のサイトから対象リポを決めて、作業用 Issue を **worker 自身が API で作り**（フォーム不要）
 *     ③ 結果を同じ受付 Issue に書く（Grok が読んで人に報告する）
 *   という流れにする。人は Issue という言葉を意識しない。
 *
 * ■ 守る線
 *   - コメントの作者が許可リストの人（かつ書き込み権限者）のものだけ拾う（pipeline-core の作業 Issue と同じ基準）。
 *   - worker 自身の返信・報告（マーカー付き）は依頼として拾い直さない（自分の返事に自分で反応する無限ループの防止）。
 *   - どのリポか一意に決まらない依頼は、勝手に選ばず、聞き返す（fail-closed）。
 *   - このPCで作業できるリポ（設定の repos）以外は対象にしない。
 *
 * ■ ★判定しないこと
 *   依頼の内容が妥当か・安全か。Grok が人の代わりに書く以上、Grok が読んだ Web ページの中の指示が
 *   依頼として書き込まれる可能性がある（間接的なプロンプトインジェクション）。受け止めるのは、
 *   pipeline-core の守り（道具の制限・差分の検査・ai/issue-N にだけ push・マージは人）。
 */

/** 受付 Issue に worker が書くコメントの目印。これが付いたコメントは依頼として拾わない。 */
export const MARKERS = Object.freeze({
  ack: 'idea-pipeline:ack',
  report: 'idea-pipeline:report',
  inbox: 'idea-pipeline:inbox',
});

const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const TLDS = 'link|com|biz|site|jp|net|org|app|dev|io|ai|co|me|tv|xyz|info';

/**
 * 文章の中のホスト名（URL・ドメイン）を取り出す。www. は外し、小文字にして重複を除く。
 * @param {unknown} text
 * @returns {string[]}
 */
export function extractHosts(text) {
  const s = String(text ?? '');
  const out = new Set();
  // www. を外してから Set に入れる（外す前に重複を除くと、www 付きと無しが別物として2件に数えられ、「複数に当てはまる」と誤判定する）
  const add = (h) => out.add(h.toLowerCase().replace(/^www\./, ''));
  for (const m of s.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) add(m[1]);
  for (const m of s.matchAll(new RegExp(`(?<![a-z0-9.-])((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?![a-z0-9-])`, 'gi'))) add(m[1]);
  return [...out];
}

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** @param {string} url */
function repoFullNameOf(url) {
  const m = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(url || ''));
  return m ? `${m[1]}/${m[2]}` : '';
}

/**
 * 依頼文のサイトから、直す対象のリポを決める。
 *
 * 照合の仕方（台帳 best-trust/data/repositories.json を実行時に読む。コピーを作らない）:
 *   1. 設定の別名表（例: "kimito-skill.link" → "owner/web-ios-android"）
 *   2. リポ名がドメインそのもの（例: malwarecheck.site）
 *   3. 台帳の homepage のホスト
 *   4. Vercel 形式（例: surechigai-romi.link → surechigai-romi-link.vercel.app の先頭ラベル）
 * 一意に決まらなければ決めない（status で理由を返す）。
 *
 * @param {string} text
 * @param {{ledger?:any, aliases?:Record<string,string>, workableRepos:string[], defaultTarget?:string}} opts
 * @returns {{status:'one'|'none'|'many'|'not_workable'|'no_host', repo?:string, candidates:string[], hosts:string[]}}
 */
export function resolveTargetRepos(text, opts) {
  const hosts = extractHosts(text);
  const workable = new Set((opts.workableRepos || []).map((r) => r.toLowerCase()));
  const aliases = Object.fromEntries(Object.entries(opts.aliases || {}).map(([k, v]) => [k.toLowerCase().replace(/^www\./, ''), v]));
  /** @type {Set<string>} */
  const found = new Set();
  const repos = Array.isArray(opts.ledger && opts.ledger.repositories) ? opts.ledger.repositories : [];
  for (const host of hosts) {
    if (aliases[host]) {
      found.add(aliases[host]);
      continue;
    }
    const slug = host.replace(/\./g, '-');
    for (const r of repos) {
      if (!r || !r.github || r.github.isArchived) continue;
      const full = repoFullNameOf(r.github.url);
      if (!full) continue;
      const hp = hostOf(r.github.homepage || '');
      const byName = String(r.name || '').toLowerCase() === host;
      const byHomepage = hp !== '' && hp === host;
      const byVercel = hp.endsWith('.vercel.app') && hp.split('.')[0] === slug;
      if (byName || byHomepage || byVercel) found.add(full);
    }
  }
  const candidates = [...found];
  if (hosts.length === 0) {
    if (opts.defaultTarget && workable.has(opts.defaultTarget.toLowerCase())) return { status: 'one', repo: opts.defaultTarget, candidates: [opts.defaultTarget], hosts };
    return { status: 'no_host', candidates: [], hosts };
  }
  if (candidates.length === 0) return { status: 'none', candidates, hosts };
  const ok = candidates.filter((c) => workable.has(c.toLowerCase()));
  if (ok.length === 1 && candidates.length === 1) return { status: 'one', repo: ok[0], candidates, hosts };
  if (ok.length === 0) return { status: 'not_workable', candidates, hosts };
  return { status: 'many', candidates, hosts };
}

/**
 * 受付 Issue のコメントのうち、新しく処理すべき依頼を選ぶ。
 * @param {Array<{id?:number, body?:string|null, user?:{login?:string}, author_association?:string}>} comments
 * @param {{allowedAuthors:string[], lastId:number}} opts
 * @returns {{requests: Array<{id:number, body:string}>, skipped: Array<{id:number, reason:string}>}}
 */
export function selectNewInboxComments(comments, opts) {
  const allowed = new Set((opts.allowedAuthors || []).map((a) => String(a).toLowerCase()));
  const requests = [];
  const skipped = [];
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!c || !Number.isInteger(c.id) || /** @type {number} */ (c.id) <= opts.lastId) continue;
    const id = /** @type {number} */ (c.id);
    const body = String(c.body ?? '').trim();
    if (body.includes('<!-- idea-pipeline:')) {
      skipped.push({ id, reason: 'worker 自身の返信・報告' });
      continue;
    }
    const login = c.user && c.user.login ? String(c.user.login).toLowerCase() : '';
    if (!login || !allowed.has(login)) {
      skipped.push({ id, reason: `作者 ${login || '（不明）'} が許可リストに無い` });
      continue;
    }
    if (!TRUSTED.includes(String(c.author_association || ''))) {
      skipped.push({ id, reason: `作者の権限が ${c.author_association || '（不明）'}` });
      continue;
    }
    if (body === '') {
      skipped.push({ id, reason: '本文が空' });
      continue;
    }
    requests.push({ id, body });
  }
  requests.sort((a, b) => a.id - b.id);
  return { requests, skipped };
}

/**
 * 作業用 Issue のタイトルと本文を作る。本文の末尾に、受付との対応を機械が読めるマーカーで残す
 * （結果を受付 Issue へ戻すため）。
 * @param {{text:string, commentUrl:string, inbox:{repo:string, issue:number, commentId:number}}} p
 */
export function buildWorkIssue(p) {
  const firstLine = String(p.text).split('\n').map((l) => l.trim()).find((l) => l !== '') || '依頼';
  const title = [...firstLine].slice(0, 70).join('');
  const body = [
    String(p.text).trim(),
    '',
    '---',
    `受付 Issue のコメントから自動で作った依頼です（${p.commentUrl}）。`,
    inboxMarker(p.inbox),
  ].join('\n');
  return { title, body };
}

/** @param {{repo:string, issue:number, commentId:number}} i */
export function inboxMarker(i) {
  return `<!-- ${MARKERS.inbox} repo=${i.repo} issue=${i.issue} comment=${i.commentId} -->`;
}

/**
 * 作業用 Issue の本文から、受付との対応を取り出す。無ければ null。
 * @param {unknown} body
 * @returns {{repo:string, issue:number, commentId:number}|null}
 */
export function parseInboxMarker(body) {
  const m = new RegExp(`<!-- ${MARKERS.inbox} repo=([\\w.-]+/[\\w.-]+) issue=(\\d+) comment=(\\d+) -->`).exec(String(body ?? ''));
  return m ? { repo: m[1], issue: Number(m[2]), commentId: Number(m[3]) } : null;
}

// ───────── 人に読まれる文（専門用語を避ける。Grok がこれを読んで人に伝える） ─────────

/** @param {number} commentId */
export const ackMarker = (commentId) => `<!-- ${MARKERS.ack} comment=${commentId} -->`;

/**
 * 「わかりました」の返事。
 * @param {{commentId:number, repo:string, issueNumber:number, issueUrl:string}} p
 */
export function ackText(p) {
  return `${ackMarker(p.commentId)}\nわかりました。依頼を受け付けました。\n\n- 直す対象: ${p.repo}\n- 管理番号: #${p.issueNumber}（${p.issueUrl}）\n\nできたら、このスレッドに結果を書きます。`;
}

/**
 * 対象が決まらなかったときの聞き返し。
 * @param {{commentId:number, result:ReturnType<typeof resolveTargetRepos>}} p
 */
export function askText(p) {
  const r = p.result;
  const reason = {
    none: `「${r.hosts.join('、')}」に当てはまるリポジトリが見つかりませんでした。`,
    no_host: 'どのサイトのことか分かりませんでした（サイトの URL が書かれていません）。',
    many: `複数のリポジトリに当てはまりました: ${r.candidates.join('、')}。`,
    not_workable: `当てはまるリポジトリ（${r.candidates.join('、')}）は、この PC で作業できる設定に入っていません。`,
    one: '',
  }[r.status];
  return `${ackMarker(p.commentId)}\n依頼は受け取りましたが、まだ作業を始められません。\n\n${reason}\n\nサイトの URL（例: https://…）か、リポジトリの名前を、もう一度書いてください。`;
}

/**
 * 結果の報告。
 * @param {{kind:'pr_created'|'verified'|'check_failed'|'failed'|'unverified'|'pr_closed', title:string, workRef:string, prUrl?:string, detail?:string, sha?:string}} p
 */
export function reportText(p) {
  const head = `<!-- ${MARKERS.report} ref=${p.workRef} kind=${p.kind}${p.sha ? ` sha=${p.sha}` : ''} -->`;
  // 長い依頼文は60字で切り、切ったことが分かるように「…」を付ける（実機の報告で「…にしてほし」と途中で切れて見えた）
  const chars = [...String(p.title)];
  const t = `「${chars.slice(0, 60).join('')}${chars.length > 60 ? '…' : ''}」`;
  const body = {
    pr_created: `${t}: 修正案（PR）を作りました。いま、問題がないかの自動チェックを確かめています。まだ完了ではありません。${p.prUrl ? `\n修正案: ${p.prUrl}` : ''}`,
    verified: `${t}: 修正案ができて、自動チェックも全て成功しました。ただし、まだ公開には反映されていません（あなたが修正案を見て、取り込むかを決めます）。${p.prUrl ? `\n修正案: ${p.prUrl}` : ''}\n※チェックが通っても、内容が正しいとは限りません。`,
    check_failed: `${t}: 修正案は作りましたが、自動チェックに失敗がありました。${p.detail ? `\n${p.detail}` : ''}${p.prUrl ? `\n修正案: ${p.prUrl}` : ''}`,
    failed: `${t}: 自動では直せませんでした。${p.detail ? `\n理由: ${p.detail}` : ''}\nあなたの確認が必要です。`,
    unverified: `${t}: 修正案は作りましたが、自動チェックが無い（または全て実行されていない）ため、成功とは確認できていません。${p.prUrl ? `\n修正案: ${p.prUrl}` : ''}`,
    pr_closed: `${t}: 修正案は取り込まれずに閉じられました。この依頼は未完了です。`,
  }[p.kind];
  return `${head}\n${body}`;
}
