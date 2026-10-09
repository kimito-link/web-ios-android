#!/usr/bin/env node
// 統合テスト専用の「偽の gh」。実際の GitHub には一切つながらない。
// 状態は環境変数 FAKE_GH_STATE が指す JSON ファイル。呼び出しは state.calls に記録する。
import fs from 'node:fs';

const statePath = process.env.FAKE_GH_STATE;
if (!statePath) {
  console.error('FAKE_GH_STATE が未設定');
  process.exit(2);
}
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
state.calls = state.calls || [];
state.calls.push(args);
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
const out = (v) => {
  save();
  process.stdout.write(JSON.stringify(v));
  process.exit(0);
};
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fields = () => {
  const o = {};
  for (let i = 0; i < args.length; i++) if (args[i] === '-f') {
    const [k, ...v] = args[i + 1].split('=');
    o[k] = v.join('=');
  }
  return o;
};

if (args[0] === 'pr' && args[1] === 'create') {
  const repo = flag('-R');
  const r = state.repos[repo];
  r.pulls = r.pulls || [];
  const number = 100 + r.pulls.length;
  r.pulls.push({ number, state: 'open', merged: false, created_at: new Date().toISOString(), head: { ref: flag('--head'), sha: 'deadbeefcafe' }, title: flag('--title'), body: flag('--body') });
  save();
  process.stdout.write(`https://github.com/${repo}/pull/${number}\n`);
  process.exit(0);
}

if (args[0] !== 'api') {
  console.error('fake-gh: 未対応: ' + args.join(' '));
  process.exit(3);
}
const method = (flag('-X') || 'GET').toUpperCase();
const p = args.find((a) => a.startsWith('repos/'));
const [pathOnly, query = ''] = p.split('?');
const q = new URLSearchParams(query);
const m = pathOnly.match(/^repos\/([^/]+\/[^/]+)(?:\/(.*))?$/);
const repo = m[1];
const rest = m[2] || '';
const r = state.repos[repo];
if (!r) {
  console.error('fake-gh: 未知のリポ ' + repo);
  process.exit(4);
}

if (rest === '') out({ default_branch: r.default_branch });

let mm;
if ((mm = rest.match(/^issues$/)) && method === 'GET') {
  const label = q.get('labels');
  out(r.issues.filter((i) => i.state === 'open' && (!label || i.labels.some((l) => l.name === label))));
}
if ((mm = rest.match(/^issues\/(\d+)\/labels$/)) && method === 'POST') {
  const i = r.issues.find((x) => x.number === Number(mm[1]));
  const add = fields()['labels[]'];
  if (!i.labels.some((l) => l.name === add)) i.labels.push({ name: add });
  out(i.labels);
}
if ((mm = rest.match(/^issues\/(\d+)\/labels\/(.+)$/)) && method === 'DELETE') {
  const i = r.issues.find((x) => x.number === Number(mm[1]));
  const name = decodeURIComponent(mm[2]);
  i.labels = i.labels.filter((l) => l.name !== name);
  out(i.labels);
}
if ((mm = rest.match(/^issues\/(\d+)\/comments$/)) && method === 'POST') {
  r.comments = r.comments || {};
  (r.comments[mm[1]] = r.comments[mm[1]] || []).push({ body: fields().body });
  out({ id: 1 });
}
if ((mm = rest.match(/^issues\/(\d+)\/comments$/)) && method === 'GET') {
  out((r.comments || {})[mm[1]] || []);
}
if (rest === 'pulls' && method === 'GET') {
  const head = (q.get('head') || '').split(':')[1];
  out((r.pulls || []).filter((x) => !head || x.head.ref === head));
}
if ((mm = rest.match(/^pulls\/(\d+)$/))) out((r.pulls || []).find((x) => x.number === Number(mm[1])));
if ((mm = rest.match(/^commits\/([^/]+)\/check-runs$/))) out({ check_runs: (r.checkRuns || {})[mm[1]] || [] });
if ((mm = rest.match(/^commits\/([^/]+)\/status$/))) out((r.statuses || {})[mm[1]] || { state: 'pending', total_count: 0 });

console.error('fake-gh: 未対応の api: ' + method + ' ' + p);
process.exit(5);
