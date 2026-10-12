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
  matchRepoByName,
  noteHead,
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

describe("名前だけの依頼（「マルウェアチェックのサイト」「健康診断のやつ」）", () => {
  const n = (name, note, extra = {}) => ({ name, note, github: { url: `https://github.com/kimito-link/${name}`, homepage: "", isArchived: false, ...extra } });
  const led = {
    repositories: [
      n("malwarecheck.site", "マルウェアチェック.site"),
      n("reviewcheck.jp", "口コミチェック.jp"),
      n("ai-audit", "AIの健康診断（2026-09-08に改名）"),
      n("web-health-check-lp", "WEBサイト健康診断。旧名web-health-check.link"),
      n("web-health-check-app", "WEBサイト健康診断（アプリ本体）"),
      n("rolex", "ロレックス応募補助アプリ"),
      n("hp-maker", "ホームページ作成ツール"),
      n("old-tool", "古い診断ツール診断", { isArchived: true }),
    ],
  };
  const all = led.repositories.map((r) => `kimito-link/${r.name}`);
  const go = (t, extra = {}) => resolveTargetRepos(t, { ledger: led, workableRepos: all, ...extra });

  it("noteHead は製品名の部分だけを取り出す（ドメインの末尾は外す）", () => {
    expect(noteHead("マルウェアチェック.site")).toBe("マルウェアチェック");
    expect(noteHead("AIの健康診断（2026-09-08に改名）")).toBe("AIの健康診断");
    expect(noteHead(undefined)).toBe("");
  });
  it("製品名がはっきり言われていれば、URL が無くても1件に決まる", () => {
    expect(go("マルウェアチェックのサイトを直して")).toMatchObject({ status: "one", repo: "kimito-link/malwarecheck.site" });
    expect(go("ロレックスの応募のやつ直して")).toMatchObject({ status: "one", repo: "kimito-link/rolex" });
    expect(go("malwarecheck を直して")).toMatchObject({ status: "one", repo: "kimito-link/malwarecheck.site" });
  });
  it("【毒】ふわっとして複数に当てはまるなら決めない。候補を名前つきで返す", () => {
    const r = go("健康診断のやつ直して");
    expect(r.status).toBe("many");
    expect(r.candidates.sort()).toEqual(["kimito-link/ai-audit", "kimito-link/web-health-check-app", "kimito-link/web-health-check-lp"]);
    expect(r.labels.join("")).toContain("WEBサイト健康診断");
    expect(go("チェックのサイト直して").status).toBe("many");
  });
  it("【毒】「サイト」「アプリ」など誰にでも付く言葉だけでは決めない", () => {
    expect(go("このサイトが気になるから直して").status).toBe("no_host");
    expect(go("アプリのサイトのページを直して").status).toBe("no_host");
    expect(go("ホームページを直して").status).toBe("no_host");
    expect(go("ホームページ作成ツールを直して")).toMatchObject({ status: "one", repo: "kimito-link/hp-maker" });
  });
  it("【毒】短い偶然の一致（3文字以下）では決めない", () => {
    expect(go("ロレを直して").status).toBe("no_host");
  });
  it("アーカイブ済みのリポは名前でも対象にしない", () => {
    expect(go("古い診断ツール診断を直して").status).toBe("no_host");
  });
  it("この PC で作業できないリポは、名前で当てても作業しない（理由を言う）", () => {
    expect(go("マルウェアチェックを直して", { workableRepos: ["kimito-link/rolex"] })).toMatchObject({ status: "not_workable" });
  });
  it("聞き返しに答えて、リポ名を書き直せば1件に決まる", () => {
    expect(go("web-health-check-app のほう").repo).toBe("kimito-link/web-health-check-app");
    expect(go("WEBサイト健康診断のアプリ本体").candidates.length).toBeGreaterThan(0);
  });
  it("設定の別名表に日本語の呼び名を入れると、ふわっとした言い方が1件に固定される", () => {
    expect(go("健康診断のやつ直して", { aliases: { 健康診断: "kimito-link/web-health-check-app" } })).toMatchObject({ status: "one", repo: "kimito-link/web-health-check-app" });
  });
  it("URL があるときは URL が優先。名前の照合は使わない", () => {
    expect(go("https://unknown.example.com のマルウェアチェック").status).toBe("none");
  });
  it("聞き返しの文に、候補が名前つきで出る", () => {
    const t = askText({ commentId: 1, result: go("健康診断のやつ直して") });
    expect(t).toContain("WEBサイト健康診断");
    expect(t).toContain("もう一度書いてください");
  });
  it("空・壊れた台帳で throw しない", () => {
    expect(matchRepoByName("", led.repositories).candidates).toEqual([]);
    expect(matchRepoByName("マルウェアチェック", [null, {}, { name: "x" }]).candidates).toEqual([]);
  });
});
