/**
 * /auth/kimito-link（ログイン案内の中継ページ）の行き先判定。副作用なしの純関数。
 *
 * ★依存ゼロにしてある理由: ルートの vitest（__tests__/）から相対importで直接
 *   テストできるようにするため（apps/web 側にテスト基盤を持たない）。
 *
 * ★ループ防止の核: Clerk の読み込みが終わる前（isLoaded=false）は動かない（"wait"）。
 *   isSignedIn が未確定のまま sign-in へ飛ばすと、ログイン済みの人を一瞬ログイン画面へ
 *   送ってしまう。行き先は呼び出し側が渡す固定パスだけ（外部入力は受けない＝オープンリダイレクト不可）。
 */
export type KimitoLinkRedirectInput = {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
};

export type KimitoLinkRedirectTargets = {
  /** ログイン済みの人の行き先（サービスのトップ）。 */
  home: string;
  /** 未ログインの人の行き先（auto=x 付きの sign-in）。 */
  signIn: string;
};

export type KimitoLinkRedirectDecision =
  | { action: "wait" }
  | { action: "go"; to: string };

export function resolveKimitoLinkRedirect(
  input: KimitoLinkRedirectInput,
  targets: KimitoLinkRedirectTargets,
): KimitoLinkRedirectDecision {
  if (!input.isLoaded) return { action: "wait" };
  return { action: "go", to: input.isSignedIn ? targets.home : targets.signIn };
}
