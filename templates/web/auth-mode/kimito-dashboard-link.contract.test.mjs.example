// kimito.link 共通アカウント: 本家マイページ導線（kimito-dashboard-link.js）の契約テストの型。
// コピー先で node:test（Node組み込み、新規依存ゼロ）または vitest/jest に読み替えて使う。
//
// 契約（これが崩れたら赤）:
//   1. Clerk 読み込み前は何も描かない・既存表示にも触らない
//   2. 未ログインなら何も描かない（本家の sign-in へも送らない）
//   3. ログイン中は <a> を1本だけ描き、href は https://kimito.link/dashboard/ で `?` 無し
//   4. data 属性で文言・URL を上書きできる。https 以外・クエリ付きの URL は既定へ戻す
//   5. Clerk の addListener でログアウトに追従し、消す
//
// 実行例（配布先）: node --test test/kimito-dashboard-link.contract.test.mjs
// 実行例（キット内の確認）: .example を外した名前で一時ディレクトリへ2ファイルを置いて同じコマンド
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// ★配布先の配置に合わせて候補を足す。先に見つかったものを使う。
const SOURCE_CANDIDATES = [
  new URL('./kimito-dashboard-link.js', import.meta.url),
  new URL('./kimito-dashboard-link.js.example', import.meta.url),
  new URL('../src/js/kimito-dashboard-link.js', import.meta.url),
  new URL('../js/modules/kimito-dashboard-link.js', import.meta.url),
];
const SOURCE_PATH = SOURCE_CANDIDATES.map((u) => fileURLToPath(u)).find((p) => existsSync(p));
if (!SOURCE_PATH) throw new Error('kimito-dashboard-link.js が見つからない: SOURCE_CANDIDATES を配置に合わせる');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');

// ── 最小の DOM スタブ（部品が使う API だけ）────────────────────────────────
function makeElement(tagName) {
  const el = {
    tagName: tagName.toUpperCase(),
    attributes: new Map(),
    children: [],
    textContent: '',
    get firstChild() { return this.children[0] ?? null; },
    setAttribute(k, v) { this.attributes.set(k, String(v)); },
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
  };
  return el;
}

function makeDocument(containers) {
  return {
    readyState: 'complete',
    createElement: makeElement,
    querySelectorAll(selector) {
      assert.equal(selector, '[data-kimito-dashboard-link]', 'コンテナのセレクタ契約');
      return containers;
    },
    addEventListener() {},
  };
}

/** Clerk のふり。user を差し替えて addListener で通知できる。 */
function makeClerk(user) {
  const listeners = [];
  return {
    loaded: true,
    user,
    addListener(fn) { listeners.push(fn); },
    setUser(next) { this.user = next; listeners.forEach((fn) => fn({ user: next })); },
    listenerCount() { return listeners.length; },
  };
}

/** IIFE を隔離コンテキストで評価し、window.KimitoDashboardLink を返す。自動起動は止める。 */
function loadModule(doc) {
  const sandbox = {
    KIMITO_DASHBOARD_LINK_MANUAL: true,
    document: doc,
    setInterval() { return 0; },
    clearInterval() {},
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: SOURCE_PATH });
  assert.ok(sandbox.KimitoDashboardLink, 'window.KimitoDashboardLink を公開する');
  return sandbox.KimitoDashboardLink;
}

function anchorsOf(container) {
  return container.children.filter((c) => c.tagName === 'A');
}

// ── 純関数の契約 ─────────────────────────────────────────────────────────
// ★vm コンテキスト内で作られたオブジェクトは Object.prototype が別物なので deepStrictEqual は
//   「構造は同じだが参照が違う」で落ちる。フィールドを個別に比べる。
test('Clerk 読み込み前は wait（何もしない）', () => {
  const mod = loadModule(makeDocument([]));
  const d = mod.resolve({ isLoaded: false, isSignedIn: undefined });
  assert.equal(d.action, 'wait');
  assert.equal('href' in d, false);
});

test('未ログインは clear（描かない・sign-in へも送らない）', () => {
  const mod = loadModule(makeDocument([]));
  const d = mod.resolve({ isLoaded: true, isSignedIn: false });
  assert.equal(d.action, 'clear');
  assert.equal('href' in d, false);
});

test('ログイン中は render。既定 URL は https://kimito.link/dashboard/ で `?` を含まない', () => {
  const mod = loadModule(makeDocument([]));
  const d = mod.resolve({ isLoaded: true, isSignedIn: true });
  assert.equal(d.action, 'render');
  assert.equal(d.href, 'https://kimito.link/dashboard/');
  assert.equal(d.href.includes('?'), false);
  assert.equal(d.label, 'kimito.link マイページ');
});

test('文言・URL は上書きできる（https・クエリ無しのみ）', () => {
  const mod = loadModule(makeDocument([]));
  const d = mod.resolve({ isLoaded: true, isSignedIn: true }, { href: 'https://kimito.link/dashboard/', label: ' 本家のマイページ ' });
  assert.equal(d.label, '本家のマイページ');
  assert.equal(d.href, 'https://kimito.link/dashboard/');
});

test('受け入れない URL（http / クエリ付き / フラグメント付き / 空）は既定に戻す', () => {
  const mod = loadModule(makeDocument([]));
  for (const bad of ['http://kimito.link/dashboard/', 'https://kimito.link/dashboard/?utm=x', 'https://kimito.link/dashboard/#a', '', 'javascript:alert(1)']) {
    const d = mod.resolve({ isLoaded: true, isSignedIn: true }, { href: bad });
    assert.equal(d.href, 'https://kimito.link/dashboard/', `bad href: ${JSON.stringify(bad)}`);
  }
});

// ── DOM への反映の契約 ─────────────────────────────────────────────────────
test('未ログインでは <a> を描かない', () => {
  const container = makeElement('span');
  container.setAttribute('data-kimito-dashboard-link', '');
  const mod = loadModule(makeDocument([container]));
  mod.render(makeClerk(null), makeDocument([container]));
  assert.equal(anchorsOf(container).length, 0);
});

test('ログイン中は <a href="https://kimito.link/dashboard/" rel="noopener"> を1本だけ描く', () => {
  const container = makeElement('span');
  container.setAttribute('data-kimito-dashboard-link', '');
  const doc = makeDocument([container]);
  const mod = loadModule(doc);
  mod.render(makeClerk({ id: 'user_1' }), doc);
  const anchors = anchorsOf(container);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].getAttribute('href'), 'https://kimito.link/dashboard/');
  assert.equal(anchors[0].getAttribute('rel'), 'noopener');
  assert.equal(anchors[0].textContent, 'kimito.link マイページ');
});

test('data 属性の文言・class が <a> に反映される。2回描いても1本のまま', () => {
  const container = makeElement('span');
  container.setAttribute('data-kimito-dashboard-link', '');
  container.setAttribute('data-kimito-dashboard-label', '本家のマイページ');
  container.setAttribute('data-kimito-dashboard-class', 'btn btn-outline');
  const doc = makeDocument([container]);
  const mod = loadModule(doc);
  const clerk = makeClerk({ id: 'user_1' });
  mod.render(clerk, doc);
  mod.render(clerk, doc);
  const anchors = anchorsOf(container);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].textContent, '本家のマイページ');
  assert.equal(anchors[0].getAttribute('class'), 'btn btn-outline');
});

test('Clerk 読み込み前は既存の中身に触らない', () => {
  const container = makeElement('span');
  container.setAttribute('data-kimito-dashboard-link', '');
  const placeholder = makeElement('em');
  container.appendChild(placeholder);
  const doc = makeDocument([container]);
  const mod = loadModule(doc);
  mod.render({ loaded: false, user: undefined }, doc);
  assert.deepEqual(container.children, [placeholder]);
});

test('attach は addListener で追従する: ログイン→描く、ログアウト→消す。二重 attach は無視', () => {
  const container = makeElement('span');
  container.setAttribute('data-kimito-dashboard-link', '');
  const doc = makeDocument([container]);
  const mod = loadModule(doc);
  const clerk = makeClerk(null);
  assert.equal(mod.attach(clerk, doc), true);
  assert.equal(mod.attach(clerk, doc), false, '同じ Clerk へ二重 attach しない');
  assert.equal(clerk.listenerCount(), 1);
  assert.equal(anchorsOf(container).length, 0);

  clerk.setUser({ id: 'user_1' });
  assert.equal(anchorsOf(container).length, 1);

  clerk.setUser(null);
  assert.equal(anchorsOf(container).length, 0);
});
