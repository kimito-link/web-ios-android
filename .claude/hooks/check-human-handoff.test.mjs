// check-human-handoff.mjs の回帰テスト。
// 何を守るか: 2026-11-10 の実例（Git Bash に貼るコマンド・画面を送って・PC で最新にして会議を動かして）は拒否、
// 「人に頼む理由:」付き・引用での言及・ふつうの報告は通す、無効化変数と壊れた入力は通す(fail-open)。
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findHumanHandoff, findTextFileAttachments, findConfirmationAsk, findCommandWithoutPlace } from "./check-human-handoff.mjs";

const HOOK = fileURLToPath(new URL("./check-human-handoff.mjs", import.meta.url));
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
const post = (text) => ({ tool_name: "mcp__hearthbot__post_message", tool_input: { text } });
const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : undefined);

describe("findHumanHandoff", () => {
  it("2026-11-10 の実例を拾う", () => {
    expect(findHumanHandoff(["Git Bash に次の1行を貼って実行してください\n```\nnpx wrangler deploy\n```"])).not.toBeNull();
    expect(findHumanHandoff(["wrangler login を実行してください。"])).not.toBeNull();
    expect(findHumanHandoff(["画面を送ってください"])).not.toBeNull();
    // 2026-11-16: LINE Bot の確認をスマホで頼む（LINEシミュレーションで AI がやる）
    expect(findHumanHandoff(["スマホのLINEでメニューを押して確かめてください"])).not.toBeNull();
    expect(findHumanHandoff(["LINEで「分身をつくる」と送ってみてください"])).not.toBeNull();
    expect(findHumanHandoff(["PCで tsuioku を git pull で最新にしてから会議を動かしてください"])).not.toBeNull();
    expect(findHumanHandoff(["下のコマンドを実行してください\n```\nnode scripts/x.mjs\n```"])).not.toBeNull();
  });
  it("ふつうの報告・引用での言及は拾わない", () => {
    expect(findHumanHandoff(["wrangler deploy まで自分で実行し、本番で確認しました。"])).toBeNull();
    expect(findHumanHandoff(["これからは「Git Bash に貼って実行して」と頼む前に止まります。"])).toBeNull();
    expect(findHumanHandoff(["マージしてよいか教えてください。"])).toBeNull();
    expect(findHumanHandoff(["LINEシミュレーションで本番の webhook に送って確かめました。39/39 です。"])).toBeNull();
  });
});

describe("hook", () => {
  it("理由なしの依頼は deny、理由ありは通す", () => {
    expect(decision(run(post("Git Bash に貼って実行してください")))).toBe("deny");
    expect(decision(run(post("Git Bash に貼って実行してください。人に頼む理由: 本人のログイン画面での承認が要るため")))).toBeUndefined();
  });
  it("request_decision の選択肢の中も見る", () => {
    const r = run({ tool_name: "mcp__hearthbot__request_decision", tool_input: { question: "どうしますか", options: [{ label: "自分で", consequence: "PowerShell で実行してください" }] } });
    expect(decision(r)).toBe("deny");
  });
  it("対象外のツール・無効化・壊れた入力は通す", () => {
    expect(decision(run({ tool_name: "Bash", tool_input: { command: "echo 貼って実行して Git Bash" } }))).toBeUndefined();
    expect(decision(run(post("Git Bash に貼って実行してください"), { HUMAN_HANDOFF_CHECK_OFF: "1" }))).toBeUndefined();
    expect(run("not json").status).toBe(0);
  });
});

describe("テキストのファイルの添付（08 §3.6、2026-11-11）", () => {
  const attach = (text, outs) => ({ tool_name: "mcp__hearthbot__post_message", tool_input: { text, attached_outputs: outs } });
  it(".md / .txt の添付だけを拾う", () => {
    expect(findTextFileAttachments({ attached_outputs: [{ kind: "file", ref: "/mnt/project-files/x/plan.md" }, { kind: "file", ref: "/mnt/project-files/a.png" }] })).toEqual(["/mnt/project-files/x/plan.md"]);
    expect(findTextFileAttachments({ attached_outputs: [{ kind: "link", ref: "https://claude.ai/artifact/x.md" }] })).toEqual([]);
    expect(findTextFileAttachments({ text: "x" })).toEqual([]);
  });
  it("理由なしの .md 添付は deny、理由ありは通す", () => {
    expect(decision(run(attach("手順をまとめました。", [{ kind: "file", ref: "/mnt/project-files/x/steps.md" }])))).toBe("deny");
    expect(decision(run(attach("設計書です。ファイルにする理由: 次のAIへの引き継ぎの正本", [{ kind: "file", ref: "/mnt/project-files/x/DESIGN.md" }])))).toBeUndefined();
  });
  it("画像・Artifact・リンクの添付は止めない", () => {
    expect(decision(run(attach("画面です。", [{ kind: "file", ref: "/mnt/project-files/x/shot.png" }, { kind: "frame", ref: "https://claude.ai/artifact/abc" }])))).toBeUndefined();
  });
});

describe("人に確認を求めない（2026-11-16 りんく「全体設定として人間に確認をもとめさせない」）", () => {
  it("2026-11-15 の実例（マージの一言をお願い）を拾う", () => {
    expect(findConfirmationAsk("mcp__hearthbot__post_message", ["りんくさんへのお願い: このスレッドに「tsuioku の #650 をマージして」と書いてください"])).not.toBeNull();
    expect(findConfirmationAsk("mcp__hearthbot__post_message", ["このまま進めてよいですか？"])).not.toBeNull();
    expect(findConfirmationAsk("mcp__hearthbot__post_message", ["A案とB案、どちらにしますか"])).not.toBeNull();
    expect(findConfirmationAsk("mcp__hearthbot__post_message", ["OKをください。"])).not.toBeNull();
  });
  it("ふつうの報告・取り消し線・引用は拾わない", () => {
    expect(findConfirmationAsk("mcp__hearthbot__post_message", ["2本ともマージしました。チェックは全部緑です。"])).toBeNull();
    expect(findConfirmationAsk("mcp__hearthbot__post_message", ["~~このスレッドに一言と書いてください~~ 不要になりました"])).toBeNull();
    expect(findConfirmationAsk("mcp__hearthbot__post_message", ["「よろしいですか」と聞くのをやめました。"])).toBeNull();
  });
  it("選択肢カード・質問ツールは理由なしなら deny、お金／消す／戻せない の理由つきなら通す", () => {
    const card = (reason) => run({ tool_name: "mcp__hearthbot__request_decision", tool_input: { question: "有料プランにしますか", reason, options: [{ label: "はい", consequence: "月$20" }, { label: "いいえ", consequence: "無料のまま" }] } });
    expect(decision(card("おすすめ"))).toBe("deny");
    expect(decision(card("確認が要る理由: お金がかかる（月$20の有料プラン）"))).toBeUndefined();
    expect(decision(run({ tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "どの色？" }] } }))).toBe("deny");
  });
  it("確認が要る理由が お金／消す／戻せない 以外なら通さない", () => {
    expect(decision(run(post("進めてよいですか。確認が要る理由: 念のため")))).toBe("deny");
    expect(decision(run(post("本番DBを消してよいですか。確認が要る理由: 消す操作（本番DBの削除）")))).toBeUndefined();
  });
});

describe("人に渡すコマンドには場所を入れる（08 §3.7、2026-11-16 りんく「ディレクトリの位置も必ずいれる」）", () => {
  const F = "```";
  const good = `会社PCの PowerShell で、下を貼ってください。人に頼む理由: 本人のログイン画面での承認が要るため\n${F}powershell\ncd "C:\\Users\\info\\OneDrive\\デスクトップ\\Resilio\\github\\web-ios-android"\nnpm run deploy:site\n${F}`;
  it("場所・PC・シェルがそろっていれば null", () => {
    expect(findCommandWithoutPlace([good])).toBeNull();
    expect(findCommandWithoutPlace([`どちらのPCでも、PowerShell で。場所はどこでもよいです。\n${F}\nwinget upgrade --all\n${F}`])).toBeNull();
    expect(findCommandWithoutPlace([`会社PCで\n${F}powershell\ngit -C "C:\\x\\tsuioku" pull\n${F}`])).toBeNull();
  });
  it("欠けているものを返す", () => {
    expect(findCommandWithoutPlace([`${F}\nnpm run deploy:site\n${F}`])).toEqual(["フォルダ（cd \"<場所>\"）", "PC（会社PC／レッツノート）", "シェル（PowerShell 等）"]);
    expect(findCommandWithoutPlace([`会社PCの PowerShell で\n${F}\nnpm run deploy:site\n${F}`])).toEqual(["フォルダ（cd \"<場所>\"）"]);
  });
  it("コマンドでないコードブロック（Chrome の Claude に貼る文など）は見ない", () => {
    expect(findCommandWithoutPlace([`${F}\nApp Store Connect の「App のプライバシー」を開いて…\n${F}`])).toBeNull();
    expect(findCommandWithoutPlace(["コードブロックなし"])).toBeNull();
  });
  it("hook: 人に頼むコマンドで場所が無ければ deny、そろえば通す", () => {
    expect(decision(run(post(`PowerShell で実行してください。人に頼む理由: 本人のログインが要るため\n${F}\nnpm run deploy:site\n${F}`)))).toBe("deny");
    expect(decision(run(post(good)))).toBeUndefined();
  });
  it("hook: 自分で走らせた報告のコードブロックは止めない", () => {
    expect(decision(run(post(`本番に反映しました。\n${F}\nnpm run deploy:site\n${F}`)))).toBeUndefined();
  });
});
