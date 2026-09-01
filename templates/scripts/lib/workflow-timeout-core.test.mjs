import { describe, expect, it } from "vitest";
import { findJobsWithoutTimeout } from "./workflow-timeout-core.mjs";

// ★毒テスト方針: 「緑のまま嘘をつく門番」を作らないため、
//   検出できることを実際の違反サンプルで示す（memory/instrument-gates-were-lying-green.md）。

describe("findJobsWithoutTimeout", () => {
  it("timeout-minutes が無いジョブを検出する", () => {
    const yml = `name: X
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;
    const { jobs, missing } = findJobsWithoutTimeout(yml);
    expect(jobs).toEqual(["build"]);
    expect(missing).toEqual(["build"]);
  });

  it("timeout-minutes があれば違反にしない", () => {
    const yml = `jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo hi
`;
    expect(findJobsWithoutTimeout(yml).missing).toEqual([]);
  });

  it("複数ジョブのうち欠けている方だけを挙げる", () => {
    const yml = `jobs:
  ok:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo a
  ng:
    runs-on: ubuntu-latest
    steps:
      - run: echo b
`;
    const { jobs, missing } = findJobsWithoutTimeout(yml);
    expect(jobs).toEqual(["ok", "ng"]);
    expect(missing).toEqual(["ng"]);
  });

  // ★これを間違えると「stepsの中のtimeout-minutes」を数えて緑になってしまう。
  it("step 側の timeout-minutes をジョブ側と誤認しない", () => {
    const yml = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
        timeout-minutes: 3
`;
    expect(findJobsWithoutTimeout(yml).missing).toEqual(["build"]);
  });

  it("reusable workflow 呼び出し(uses)は対象外", () => {
    const yml = `jobs:
  call:
    uses: ./.github/workflows/other.yml
`;
    const { jobs, missing } = findJobsWithoutTimeout(yml);
    expect(jobs).toEqual(["call"]);
    expect(missing).toEqual([]);
  });

  it("jobs より後のトップレベルキーをジョブと誤認しない", () => {
    const yml = `jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - run: echo hi
permissions:
  contents: read
`;
    expect(findJobsWithoutTimeout(yml).jobs).toEqual(["build"]);
  });

  it("on/permissions など jobs 以外のブロックのキーを拾わない", () => {
    const yml = `name: X
on:
  schedule:
    - cron: "0 0 * * 1"
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo hi
`;
    expect(findJobsWithoutTimeout(yml).jobs).toEqual(["check"]);
  });
});
