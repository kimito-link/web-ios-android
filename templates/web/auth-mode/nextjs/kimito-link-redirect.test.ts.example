import { describe, expect, it } from "vitest";
import { resolveKimitoLinkRedirect } from "../apps/web/lib/kimito-link-redirect";

const targets = { home: "/", signIn: "/sign-in/?redirect_url=%2F&auto=x" };

describe("resolveKimitoLinkRedirect", () => {
  it("Clerk 読み込み前は動かない（ログイン済みの人を sign-in へ誤送しない）", () => {
    expect(resolveKimitoLinkRedirect({ isLoaded: false, isSignedIn: undefined }, targets)).toEqual({
      action: "wait",
    });
    // 読み込み前に isSignedIn が false に見えても動かない。
    expect(resolveKimitoLinkRedirect({ isLoaded: false, isSignedIn: false }, targets)).toEqual({
      action: "wait",
    });
  });

  it("ログイン済みはトップへ", () => {
    expect(resolveKimitoLinkRedirect({ isLoaded: true, isSignedIn: true }, targets)).toEqual({
      action: "go",
      to: "/",
    });
  });

  it("未ログインは auto=x 付き sign-in へ", () => {
    expect(resolveKimitoLinkRedirect({ isLoaded: true, isSignedIn: false }, targets)).toEqual({
      action: "go",
      to: "/sign-in/?redirect_url=%2F&auto=x",
    });
  });

  it("isSignedIn が未確定(undefined)でも読み込み完了後は未ログイン扱い", () => {
    expect(resolveKimitoLinkRedirect({ isLoaded: true, isSignedIn: undefined }, targets)).toEqual({
      action: "go",
      to: "/sign-in/?redirect_url=%2F&auto=x",
    });
  });

  it("行き先は渡した固定パス以外にならない", () => {
    const d = resolveKimitoLinkRedirect({ isLoaded: true, isSignedIn: false }, targets);
    expect(d.action === "go" && d.to.startsWith("/")).toBe(true);
  });
});
