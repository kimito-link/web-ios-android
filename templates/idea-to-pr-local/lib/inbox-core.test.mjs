import { describe, expect, it } from 'vitest';
import {
  MARKERS,
  ackText,
  askText,
  buildWorkIssue,
  extractHosts,
  inboxMarker,
  parseInboxMarker,
  reportText,
  resolveTargetRepos,
  selectNewInboxComments,
} from './inbox-core.mjs';

const repo = (name, homepage = '', extra = {}) => ({ name, github: { url: `https://github.com/kimito-link/${name}`, homepage, isArchived: false, ...extra } });
const ledger = {
  repositories: [
    repo('malwarecheck.site', 'https://malwarecheck-site.vercel.app'),
    repo('surechigai-romi.link', 'https://surechigai-romi-link.vercel.app'),
    repo('web-ios-android', 'https://web-ios-android.vercel.app'),
    repo('best-trust.biz', 'https://best-trust.biz/'),
    repo('old-site.com', '', { isArchived: true }),
    repo('twin-a', 'https://twin.example.com'),
    repo('twin-b', 'https://twin.example.com'),
  ],
};
const WORKABLE = ['kimito-link/malwarecheck.site', 'kimito-link/surechigai-romi.link', 'kimito-link/web-ios-android', 'kimito-link/twin-a', 'kimito-link/twin-b'];
const resolve = (text, extra = {}) => resolveTargetRepos(text, { ledger, workableRepos: WORKABLE, ...extra });

describe('extractHosts', () => {
  it('URL と裸のドメインの両方を取り出す。www は外し、小文字にして、重複を除く', () => {
    expect(extractHosts('https://WWW.Malwarecheck.site/ と malwarecheck.site が気になる')).toEqual(['malwarecheck.site']);
    expect(extractHosts('このサイト https://surechigai-romi.link/app を直して。kimito-skill.link も')).toEqual(['surechigai-romi.link', 'kimito-skill.link']);
  });
  it('ドメインが無い文章・壊れた入力では空', () => {
    expect(extractHosts('サイトが気になるから直して')).toEqual([]);
    expect(extractHosts(null)).toEqual([]);
    expect(extractHosts('README.md を直して')).toEqual([]);
  });
});

describe('resolveTargetRepos（どのリポを直すか）', () => {
  it('リポ名がドメインそのもの・Vercel 形式・homepage のどれでも一意に決まる', () => {
    expect(resolve('malwarecheck.site が気になる')).toMatchObject({ status: 'one', repo: 'kimito-link/malwarecheck.site' });
    expect(resolve('https://surechigai-romi.link/ を直して')).toMatchObject({ status: 'one', repo: 'kimito-link/surechigai-romi.link' });
    expect(resolve('https://web-ios-android.vercel.app')).toMatchObject({ status: 'one', repo: 'kimito-link/web-ios-android' });
  });
  it('設定の別名表が最優先（台帳に無いドメインを直せる）', () => {
    expect(resolve('kimito-skill.link を直して', { aliases: { 'kimito-skill.link': 'kimito-link/web-ios-android' } })).toMatchObject({ status: 'one', repo: 'kimito-link/web-ios-android' });
  });
  it('【毒】どのリポにも当てはまらなければ決めない（勝手に選ばない）', () => {
    expect(resolve('https://unknown-site.example.com を直して')).toMatchObject({ status: 'none' });
  });
  it('【毒】サイトの URL が無ければ決めない（既定の対象が無い場合）', () => {
    expect(resolve('サイトが気になるから直して')).toMatchObject({ status: 'no_host' });
  });
  it('既定の対象を設定してあれば、URL が無い依頼はそこへ（ただし作業できるリポに限る）', () => {
    expect(resolve('気になるから直して', { defaultTarget: 'kimito-link/web-ios-android' })).toMatchObject({ status: 'one', repo: 'kimito-link/web-ios-android' });
    expect(resolve('気になるから直して', { defaultTarget: 'kimito-link/not-workable' })).toMatchObject({ status: 'no_host' });
  });
  it('【毒】複数のリポに当てはまるなら決めない（聞き返す）', () => {
    expect(resolve('https://twin.example.com を直して')).toMatchObject({ status: 'many' });
    expect(resolve('malwarecheck.site と surechigai-romi.link を直して')).toMatchObject({ status: 'many' });
  });
  it('【毒】この PC で作業できるリポに入っていなければ、対象にしない', () => {
    expect(resolve('best-trust.biz を直して')).toMatchObject({ status: 'not_workable', candidates: ['kimito-link/best-trust.biz'] });
  });
  it('アーカイブ済みのリポは対象にしない', () => {
    expect(resolve('old-site.com を直して')).toMatchObject({ status: 'none' });
  });
  it('壊れた台帳でも throw しない', () => {
    expect(resolveTargetRepos('a.com', { ledger: null, workableRepos: [] }).status).toBe('none');
    expect(resolveTargetRepos('a.com', { ledger: { repositories: [null, {}] }, workableRepos: [] }).status).toBe('none');
  });
});

describe('selectNewInboxComments（どのコメントを依頼として拾うか）', () => {
  const c = (id, over = {}) => ({ id, body: '依頼', user: { login: 'me' }, author_association: 'OWNER', ...over });
  const opts = { allowedAuthors: ['me'], lastId: 10 };
  it('許可作者・書き込み権限者の、lastId より新しいコメントだけを古い順に拾う', () => {
    const r = selectNewInboxComments([c(30), c(5), c(20)], opts);
    expect(r.requests.map((x) => x.id)).toEqual([20, 30]);
  });
  it('【毒】許可外の作者・外部権限・空の本文は拾わない', () => {
    const r = selectNewInboxComments([c(11, { user: { login: 'stranger' } }), c(12, { author_association: 'NONE' }), c(13, { body: '   ' })], opts);
    expect(r.requests).toEqual([]);
    expect(r.skipped.length).toBe(3);
  });
  it('【毒】worker 自身の返信・報告は拾わない（自分の返事に自分で反応する無限ループの防止）', () => {
    const ack = ackText({ commentId: 11, repo: 'o/r', issueNumber: 3, issueUrl: 'u' });
    const rep = reportText({ kind: 'verified', title: 't', workRef: 'o/r#3' });
    const r = selectNewInboxComments([c(14, { body: ack }), c(15, { body: rep })], opts);
    expect(r.requests).toEqual([]);
    expect(r.skipped.every((s) => s.reason.includes('worker'))).toBe(true);
  });
  it('壊れた入力で throw しない', () => {
    expect(selectNewInboxComments(null, opts).requests).toEqual([]);
    expect(selectNewInboxComments([null, {}, { id: 'x' }], opts).requests).toEqual([]);
  });
});

describe('作業用 Issue と受付との対応', () => {
  it('マーカーは往復できる。本文に受付へのリンクが入る', () => {
    const inbox = { repo: 'o/inbox', issue: 5, commentId: 123 };
    const w = buildWorkIssue({ text: 'malwarecheck.site が気になる\nフォントが小さい', commentUrl: 'https://github.com/o/inbox/issues/5#issuecomment-123', inbox });
    expect(w.title).toBe('malwarecheck.site が気になる');
    expect(w.body).toContain('フォントが小さい');
    expect(w.body).toContain('issuecomment-123');
    expect(parseInboxMarker(w.body)).toEqual(inbox);
  });
  it('タイトルは70文字までに切る。壊れた/無い マーカーは null', () => {
    expect([...buildWorkIssue({ text: 'あ'.repeat(200), commentUrl: 'u', inbox: { repo: 'o/r', issue: 1, commentId: 1 } }).title].length).toBe(70);
    expect(parseInboxMarker('マーカー無し')).toBeNull();
    expect(parseInboxMarker('<!-- idea-pipeline:inbox repo=bad issue=x comment=1 -->')).toBeNull();
    expect(parseInboxMarker(null)).toBeNull();
  });
  it('マーカーの文字列は、拾い直し防止の判定（<!-- idea-pipeline:）と同じ接頭辞を持つ', () => {
    expect(inboxMarker({ repo: 'o/r', issue: 1, commentId: 1 })).toContain('<!-- idea-pipeline:');
    expect(Object.values(MARKERS).every((m) => m.startsWith('idea-pipeline:'))).toBe(true);
  });
});

describe('人に読まれる文', () => {
  it('「わかりました」の返事に、対象と管理番号が入る', () => {
    const t = ackText({ commentId: 9, repo: 'o/r', issueNumber: 3, issueUrl: 'https://x/3' });
    expect(t).toContain('わかりました');
    expect(t).toContain('o/r');
    expect(t).toContain('#3');
  });
  it('聞き返しは、理由と、次にしてほしいことを言う', () => {
    const t = askText({ commentId: 9, result: resolve('https://unknown-site.example.com') });
    expect(t).toContain('見つかりませんでした');
    expect(t).toContain('もう一度書いてください');
  });
  it('【毒】成功以外の報告で「全て成功」と言わない。完了とも言わない', () => {
    for (const kind of ['pr_created', 'check_failed', 'failed', 'unverified', 'pr_closed']) {
      const t = reportText({ kind, title: 't', workRef: 'o/r#3', prUrl: 'u', detail: 'd' });
      expect(t, kind).not.toContain('全て成功');
      expect(t, kind).not.toContain('完了しました');
    }
  });
  it('長い依頼文は60字で切り、切ったことが分かる「…」を付ける。短ければ付けない', () => {
    expect(reportText({ kind: 'failed', title: 'あ'.repeat(100), workRef: 'o/r#3' })).toContain(`「${'あ'.repeat(60)}…」`);
    expect(reportText({ kind: 'failed', title: '短い依頼', workRef: 'o/r#3' })).toContain('「短い依頼」');
  });
  it('成功の報告は「まだ公開には反映されていない」「内容が正しいとは限らない」と言う', () => {
    const t = reportText({ kind: 'verified', title: 't', workRef: 'o/r#3', prUrl: 'u' });
    expect(t).toContain('全て成功');
    expect(t).toContain('まだ公開には反映されていません');
    expect(t).toContain('正しいとは限りません');
  });
});
