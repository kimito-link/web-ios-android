import { describe, expect, it } from "vitest";
import { classifyRejection } from "./asc-rejection-classify.mjs";

const FOUR_THREE_TEXT =
  "Guideline 4.3(a) - Design - Spam. We noticed your app shares a similar binary, metadata, and/or concept as apps submitted to the App Store by you or other developers, with only minor differences. Creating and submitting multiple similar apps using a repackaged app template.";

describe("classifyRejection", () => {
  it("4.3 原文は manual-review-no-retry（自動再提出しない）", () => {
    const r = classifyRejection({ state: "REJECTED", feedbackText: FOUR_THREE_TEXT });
    expect(r.code).toBe("FOUR_THREE_SPAM");
    expect(r.action).toBe("manual-review-no-retry");
    expect(r.label).toMatch(/4\.3\(a\)/);
    expect(r.hint).toMatch(/自動再提出しない/);
  });

  it("4.2 は同様に manual-review-no-retry", () => {
    const r = classifyRejection({
      state: "REJECTED",
      feedbackText: "Guideline 4.2 - Design - Minimum Functionality. This app is a web clipping.",
    });
    expect(r.code).toBe("FOUR_TWO");
    expect(r.action).toBe("manual-review-no-retry");
  });

  it("'iOS 14.3' や 'v1.4.3' の数字では 4.3 / 4.2 に誤爆しない", () => {
    const r1 = classifyRejection({
      state: "REJECTED",
      feedbackText: "The app crashed on launch on iOS 14.3 due to a bug in build 1.4.3.",
    });
    expect(r1.code).toBe("CRASH_BUG");
    const r2 = classifyRejection({
      state: "REJECTED",
      feedbackText: "Please see section 14.2 and version 1.4.2 notes. The app crashed.",
    });
    expect(r2.code).toBe("CRASH_BUG");
  });

  it("2.3.10 の他プラットフォーム言及は従来どおり TWO_THREE_TEN", () => {
    const r = classifyRejection({
      state: "METADATA_REJECTED",
      feedbackText: "Your app description mentions Android and Google Play.",
    });
    expect(r.code).toBe("TWO_THREE_TEN");
    expect(r.action).toBe("retry-after-metadata-fix");
  });

  it("screenshot 却下は従来どおり SCREENSHOT", () => {
    const r = classifyRejection({
      state: "METADATA_REJECTED",
      feedbackText: "The screenshots are misleading and the app preview is inaccurate.",
    });
    expect(r.code).toBe("SCREENSHOT");
    expect(r.action).toBe("retry-with-fresh-screenshots");
  });

  it("demo account は従来どおり DEMO_ACCOUNT", () => {
    const r = classifyRejection({
      state: "REJECTED",
      feedbackText: "Please provide a demo account. We were unable to access the app due to sign-in.",
    });
    expect(r.code).toBe("DEMO_ACCOUNT");
    expect(r.action).toBe("add-demo-account-secret");
  });

  it("crash は従来どおり CRASH_BUG", () => {
    const r = classifyRejection({
      state: "REJECTED",
      feedbackText: "The app crashed on launch due to a bug.",
    });
    expect(r.code).toBe("CRASH_BUG");
    expect(r.action).toBe("fix-and-rebuild");
  });
});
