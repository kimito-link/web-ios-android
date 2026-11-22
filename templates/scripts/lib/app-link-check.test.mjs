import { describe, expect, it } from "vitest";
import { checkAppLinks, extractStoreLinks, findAppLinksInSources, storeIdsFromConfig } from "./app-link-check.mjs";
import registry from "./app-links.json" with { type: "json" };

const app = { ascAppId: "6775201794", playPackageName: "com.kimito.link.yukkuriexosome" };

describe("extractStoreLinks", () => {
  it("App Store(名前入り・国なし・itunes)と Google Play(hl が前)を拾う", () => {
    const html = `
      <a href="https://apps.apple.com/jp/app/%E3%82%86/id6775201794?l=ja">a</a>
      <a href="https://apps.apple.com/app/id111111111">b</a>
      <a href="https://itunes.apple.com/jp/app/id222222222">c</a>
      <a href="https://play.google.com/store/apps/details?hl=ja&amp;id=com.kimito.link.yukkuriexosome">d</a>`;
    const r = extractStoreLinks(html);
    expect(r.iosIds).toEqual(["6775201794", "111111111", "222222222"]);
    expect(r.playPackages).toEqual(["com.kimito.link.yukkuriexosome"]);
  });
  it("Safari 用バナー(meta と Next.js の metadata.itunes)を拾う", () => {
    expect(extractStoreLinks('<meta name="apple-itunes-app" content="app-id=6775201794, app-argument=https://x/">').bannerIds).toEqual(["6775201794"]);
    expect(extractStoreLinks("export const metadata = { itunes: { appId: '6775201794' } }").bannerIds).toEqual(["6775201794"]);
  });
});

describe("findAppLinksInSources", () => {
  it("ID を組み立てる書き方(テンプレート文字列)も見つかった扱い", () => {
    const files = [{ path: "src/store.ts", text: "const ID = '6775201794'; export const url = `https://apps.apple.com/jp/app/id${ID}`;" }];
    expect(findAppLinksInSources(files, app).ios).toBe("src/store.ts");
    expect(findAppLinksInSources(files, app).play).toBeNull();
  });
  it("ほかのアプリへのリンクだけなら見つからない", () => {
    const files = [{ path: "a.html", text: '<a href="https://apps.apple.com/jp/app/id6779860644">別アプリ</a>' }];
    expect(findAppLinksInSources(files, app).ios).toBeNull();
  });
});

describe("storeIdsFromConfig", () => {
  it("プレースホルダ・空は null", () => {
    expect(storeIdsFromConfig({ stores: { ascAppId: "<App Storeで作ったアプリのID>", playPackageName: "<Android用の住所>" } })).toEqual({ ascAppId: null, playPackageName: null });
    expect(storeIdsFromConfig({ stores: { ascAppId: 6775201794, playPackageName: "com.a.b" } })).toEqual({ ascAppId: "6775201794", playPackageName: "com.a.b" });
  });
});

describe("checkAppLinks", () => {
  it("公開中なのに導線が無ければ fail(止める)", () => {
    const r = checkAppLinks({ app, live: { ios: true, play: true }, found: { ios: true, play: false, banner: true } });
    expect(r.status).toBe("fail");
    expect(r.missing).toEqual(["Google Play(com.kimito.link.yukkuriexosome)"]);
    expect(r.detail).toContain("15_APP_LINK_FROM_WEB");
  });
  it("両方あってバナーもあれば ok", () => {
    expect(checkAppLinks({ app, live: { ios: true, play: true }, found: { ios: true, play: true, banner: true } }).status).toBe("ok");
  });
  it("iPhone 版が公開中でバナーが無ければ warn", () => {
    const r = checkAppLinks({ app, live: { ios: true, play: true }, found: { ios: true, play: true, banner: false } });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("apple-itunes-app");
  });
  it("公開前のストアは問わない", () => {
    const r = checkAppLinks({ app, live: { ios: false, play: true }, found: { ios: false, play: true, banner: false } });
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("公開前");
  });
  it("公開中か分からず導線が無ければ warn(ネットが無いだけで赤にしない)", () => {
    expect(checkAppLinks({ app, live: { ios: null, play: null }, found: { ios: false, play: false } }).status).toBe("warn");
  });
  it("アプリの ID が無い・Web が無いなら skip", () => {
    expect(checkAppLinks({ app: {}, found: { ios: false, play: false } }).status).toBe("skip");
    expect(checkAppLinks({ app, hasWeb: false, live: { ios: true }, found: { ios: false, play: false } }).status).toBe("skip");
  });
});

describe("app-links.json(アプリがある Web サービスの一覧)", () => {
  it("各行に id・repo・web(https)・ストアの ID のどれかがある", () => {
    const ids = new Set();
    for (const s of registry.services) {
      expect(s.id).toBeTruthy();
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.repo).toMatch(/^kimito-link\//);
      expect(s.web.length).toBeGreaterThan(0);
      for (const u of s.web) expect(u).toMatch(/^https:\/\//);
      expect(storeIdsFromConfig({ stores: s }).ascAppId || storeIdsFromConfig({ stores: s }).playPackageName).toBeTruthy();
    }
  });
});
