import { describe, expect, it } from 'vitest';
import { settleLoop } from './worker.mjs';

describe('settleLoop（チェックが終わるのを待つ。待ち続けない）', () => {
  const mkClock = (startMs = 0) => {
    let t = startMs;
    return { nowMs: () => t, sleep: (ms) => { t += ms; } };
  };

  it('結論待ちが無ければ、待たずに終わる', () => {
    const c = mkClock();
    let called = 0;
    const r = settleLoop(() => { called++; return { pendingVerify: 0 }; }, { minutes: 20, intervalSec: 45, pendingNow: 0, ...c });
    expect(r).toEqual({ rounds: 0, pendingVerify: 0 });
    expect(called).toBe(0);
  });
  it('結論待ちが片付いたところで終わる', () => {
    const c = mkClock();
    const answers = [{ pendingVerify: 1 }, { pendingVerify: 1 }, { pendingVerify: 0 }];
    const r = settleLoop(() => answers.shift(), { minutes: 20, intervalSec: 45, pendingNow: 1, ...c });
    expect(r).toEqual({ rounds: 3, pendingVerify: 0 });
  });
  it('【毒】片付かなくても、上限の時間で打ち切る（待ち続けない）', () => {
    const c = mkClock();
    let called = 0;
    const r = settleLoop(() => { called++; return { pendingVerify: 2 }; }, { minutes: 3, intervalSec: 60, pendingNow: 2, ...c });
    expect(called).toBe(3);
    expect(r.pendingVerify).toBe(2);
    expect(c.nowMs()).toBeLessThanOrEqual(3 * 60 * 1000);
  });
  it('壊れた戻り値でも throw せず、待ち続けない', () => {
    const c = mkClock();
    const r = settleLoop(() => ({}), { minutes: 5, intervalSec: 30, pendingNow: 1, ...c });
    expect(r).toEqual({ rounds: 1, pendingVerify: 0 });
  });
});
