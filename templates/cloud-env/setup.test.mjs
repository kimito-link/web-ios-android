// setup.sh が main から取るファイルが、リポに実在するか（名前を変えたら setup.sh も直す）。
// クラウドでは取れなかったファイルの hook は黙って配線されないので、ここで先に気づく。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const script = readFileSync(join(HERE, 'setup.sh'), 'utf8');
const fetched = [...script.matchAll(/^get (\S+) /gm)].map((m) => m[1]);

describe('templates/cloud-env/setup.sh', () => {
  it('取りに行くファイルがすべてリポにある', () => {
    expect(fetched.length).toBeGreaterThan(5);
    for (const f of fetched) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });
  it('残り枠の知らせ（inject-ai-budget-mode）を UserPromptSubmit に配線する', () => {
    expect(fetched).toContain('.claude/hooks/inject-ai-budget-mode.mjs');
    expect(script).toMatch(/add\("UserPromptSubmit", "budget-mode\/\.claude\/hooks\/inject-ai-budget-mode\.mjs"/);
  });
});
