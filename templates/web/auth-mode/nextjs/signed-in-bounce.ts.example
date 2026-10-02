/**
 * ログイン済みの人が「ワンタップ導線（?auto=x）」で /sign-in/ に来たとき、トップへ戻すかの判定。
 * 副作用なしの純関数。
 *
 * ★依存ゼロにしてある理由: ルートの vitest（__tests__/）から相対importで直接テストするため。
 *
 * ★auto=x が付いているときだけ戻す理由（実損に基づく）:
 *   /sign-in/ にはログイン済みのまま「別の X アカウントを追加・切り替える」ために来る人がいる。
 *   その導線は意図して auto=x を付けない（付けると X 側のセッションで認可が素通りし、
 *   同じアカウントで即戻ってきて切り替えられない）。ログイン済みを一律に戻すとこの導線が壊れる。
 *   auto=x 付き＝「X で始める」CTA から来ただけ、なので戻して問題ない。
 *
 * ★recentlyBounced（ループ防止）: トップ側が何かの理由でログイン済みを認識せず、また
 *   /sign-in/?auto=x へ送り返してくると、戻す→送り返すを無限に繰り返す。直近に戻していたら
 *   もう戻さず、通常のログイン画面を出して止める。
 */
export type SignedInBounceInput = {
  /** URL に auto=x が付いているか。 */
  hasAutoParam: boolean;
  /** Clerk の読み込みが完了したか。 */
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  /** 直近（数秒以内）に同じ理由でトップへ戻したか。 */
  recentlyBounced: boolean;
};

export function shouldBounceSignedInToHome(input: SignedInBounceInput): boolean {
  return (
    input.hasAutoParam &&
    input.isLoaded &&
    input.isSignedIn === true &&
    !input.recentlyBounced
  );
}
