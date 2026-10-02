import { describe, expect, it } from "vitest";
import { shouldBounceSignedInToHome } from "../apps/web/lib/signed-in-bounce";

const base = { hasAutoParam: true, isLoaded: true, isSignedIn: true, recentlyBounced: false };

describe("shouldBounceSignedInToHome", () => {
  it("ログイン済み＋auto=x ならトップへ戻す", () => {
    expect(shouldBounceSignedInToHome(base)).toBe(true);
  });

  it("auto=x が無ければ戻さない（アカウント切り替え導線を壊さない）", () => {
    expect(shouldBounceSignedInToHome({ ...base, hasAutoParam: false })).toBe(false);
  });

  it("Clerk 読み込み前は戻さない", () => {
    expect(shouldBounceSignedInToHome({ ...base, isLoaded: false })).toBe(false);
    expect(shouldBounceSignedInToHome({ ...base, isLoaded: false, isSignedIn: undefined })).toBe(false);
  });

  it("未ログイン・未確定は戻さない（通常の auto=x 発火に任せる）", () => {
    expect(shouldBounceSignedInToHome({ ...base, isSignedIn: false })).toBe(false);
    expect(shouldBounceSignedInToHome({ ...base, isSignedIn: undefined })).toBe(false);
  });

  it("直近に戻していたら戻さない（トップ↔sign-in の無限ループ防止）", () => {
    expect(shouldBounceSignedInToHome({ ...base, recentlyBounced: true })).toBe(false);
  });
});
