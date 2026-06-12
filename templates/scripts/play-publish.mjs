#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/play-publish.mjs
//        (Exosome/scripts/play-publish.mjs と同一内容)
//
// AAB を Google Play Console にアップロードして審査提出する。
// app.config.json を SSOT とする: packageName はハードコードせず、
// env PLAY_PACKAGE_NAME 優先 → app.config.json stores.playPackageName の順で解決。
//
// Reads:
//   env GOOGLE_PLAY_SA_JSON_PATH or _BASE64 or _JSON
//   env PLAY_PACKAGE_NAME (省略時は app.config.json の stores.playPackageName)
//   env PLAY_TRACK         (default: internal — production にしてから本番リリース)
//   env PLAY_AAB_PATH      (default: android-twa/app/build/outputs/bundle/release/app-release.aab)
//   ./release-notes/CURRENT-ja.txt (release notes, ja-JP)
//   ./android-twa/app/build.gradle -> versionCode (for sanity)
//
// Modes:
//   --draft   create a draft release (don't submit). Default if PLAY_DRAFT=1.
//   --submit  upload + submit for review (default).
//   --status  read-only status check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceAccount, makePlayClient, uploadBundle } from './lib/play-api.mjs';
import { loadAppConfig } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APP_CONFIG = loadAppConfig();

const PACKAGE = process.env.PLAY_PACKAGE_NAME || APP_CONFIG.stores.playPackageName;
const TRACK = process.env.PLAY_TRACK || 'internal';
const AAB_PATH = process.env.PLAY_AAB_PATH || path.join(REPO, 'android-twa', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');

if (!PACKAGE) {
  throw new Error(
    'PLAY_PACKAGE_NAME が未設定で、app.config.json の stores.playPackageName も空です。' +
      'どちらかに Android パッケージ名を設定してください。',
  );
}

function readReleaseNotes() {
  const p = path.join(REPO, 'release-notes', 'CURRENT-ja.txt');
  if (!fs.existsSync(p)) throw new Error(`Missing release-notes/CURRENT-ja.txt at ${p}`);
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
  // Google Play は ja-JP のリリースノートを 500 文字以下に制限している。
  // ここで早期に失敗させ、AAB の build / upload を無駄にしない。
  if (text.length > 500) {
    throw new Error(
      `release-notes/CURRENT-ja.txt is ${text.length} chars; Google Play limit is 500. ` +
        `Trim the file before pushing to keep android-play-release green.`,
    );
  }
  return text;
}

function readVersionCode() {
  const p = path.join(REPO, 'android-twa', 'app', 'build.gradle');
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, 'utf8').match(/versionCode\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

const ARGS = new Set(process.argv.slice(2));
const MODE = ARGS.has('--status')
  ? 'status'
  : ARGS.has('--draft') || process.env.PLAY_DRAFT === '1'
    ? 'draft'
    : 'submit';

(async () => {
  const sa = loadServiceAccount();
  const api = makePlayClient(sa, PACKAGE);

  console.log(`packageName=${PACKAGE} track=${TRACK} mode=${MODE}`);
  console.log(`AAB path: ${AAB_PATH}`);
  const expectedVc = readVersionCode();
  if (expectedVc) console.log(`gradle versionCode = ${expectedVc}`);

  if (MODE === 'status') {
    const edit = await api('POST', '/edits', {});
    try {
      const t = await api('GET', `/edits/${edit.id}/tracks/${TRACK}`);
      console.log(JSON.stringify(t, null, 2));
    } finally {
      await api('DELETE', `/edits/${edit.id}`);
    }
    return;
  }

  if (!fs.existsSync(AAB_PATH)) {
    throw new Error(`AAB not found: ${AAB_PATH}\nRun: pnpm android:bundle`);
  }
  const releaseNotes = readReleaseNotes();
  console.log(`releaseNotes (${releaseNotes.length} chars):\n  ${releaseNotes.slice(0, 120).replace(/\n/g, ' / ')}...`);

  console.log('\n[1] Open edit...');
  const edit = await api('POST', '/edits', {});
  console.log(`  editId=${edit.id}`);

  try {
    // 冪等性: 同じ versionCode が同一 ja-JP notes でトラックに既にいるなら no-op で exit。
    let currentTrack = null;
    try {
      currentTrack = await api('GET', `/edits/${edit.id}/tracks/${TRACK}`);
    } catch (e) {
      if (!/404/.test(e.message)) throw e;
    }
    const currentRelease = expectedVc
      ? (currentTrack?.releases || []).find((r) =>
          (r.versionCodes || []).map(String).includes(String(expectedVc)),
        )
      : null;
    const currentJaNotes = (currentRelease?.releaseNotes || []).find((n) => n.language === 'ja-JP')?.text || '';
    if (currentRelease && currentJaNotes.trim() === releaseNotes.trim()) {
      console.log(
        `\n[skip] track ${TRACK} already has versionCode ${expectedVc} with identical ja-JP notes.`,
      );
      console.log(`  Nothing to do. (Bump the version for a new release.)`);
      await api('DELETE', `/edits/${edit.id}`).catch(() => {});
      return;
    }

    // AAB アップロード。versionCode が既に Play にあれば(notes だけ修正の再 push 等)
    // upload をスキップして notes-only 更新にフォールバック。
    console.log('\n[2] Upload AAB...');
    let uploadedVc = null;
    if (currentRelease) {
      console.log(
        `  versionCode ${expectedVc} already on track ${TRACK}; skipping AAB upload (notes-only update).`,
      );
      uploadedVc = expectedVc;
    } else {
      try {
        const bundle = await uploadBundle(sa, PACKAGE, edit.id, AAB_PATH);
        uploadedVc = bundle.versionCode;
        console.log(`  uploaded versionCode=${uploadedVc} sha1=${bundle.sha1}`);
        if (expectedVc && uploadedVc !== expectedVc) {
          console.warn(`  [warn] uploaded versionCode (${uploadedVc}) != gradle versionCode (${expectedVc})`);
        }
      } catch (e) {
        if (/already been used/i.test(e.message) && expectedVc) {
          console.log(
            `  versionCode ${expectedVc} already exists on Play; skipping AAB upload (notes-only update).`,
          );
          uploadedVc = expectedVc;
        } else {
          throw e;
        }
      }
    }

    console.log('\n[3] Set track release...');
    let status = MODE === 'draft' ? 'draft' : 'completed';
    const buildTrackBody = (s) => ({
      track: TRACK,
      releases: [
        {
          name: String(uploadedVc),
          status: s,
          versionCodes: [String(uploadedVc)],
          releaseNotes: [{ language: 'ja-JP', text: releaseNotes }],
          ...(s === 'completed' ? { userFraction: undefined } : {}),
        },
      ],
    });
    await api('PUT', `/edits/${edit.id}/tracks/${TRACK}`, buildTrackBody(status));
    console.log(`  track=${TRACK} status=${status} versionCode=${uploadedVc}`);

    console.log('\n[4] Validate edit...');
    // Google が「自動で審査送信できない」と言うことがある。edits:validate は query を
    // 取らないので、ここで検知して changesNotSentForReview=true で commit し、
    // 実際の「審査に送信」は Play Console UI に任せる。
    const isManualReviewSendError = (err) =>
      /changesNotSentForReview/i.test(String(err?.message || err));
    let manualReviewSend = false;
    try {
      await api('POST', `/edits/${edit.id}:validate`, {});
    } catch (e) {
      // 新規アプリは Play Console チェックリスト(Data Safety / Content Rating /
      // Target Audience / App Content / Pricing 等)が完了するまで completed リリースを
      // 受け付けない。その場合は draft にフォールバックして少なくとも AAB を Play に乗せる。
      if (
        status === 'completed' &&
        /draft app|releases with status draft/i.test(e.message)
      ) {
        console.log(
          `  [fallback] Play app is still in draft state. Re-uploading as DRAFT release ` +
            `(promote to production via Play Console once App content / Data safety / Content rating are filled).`,
        );
        status = 'draft';
        await api('PUT', `/edits/${edit.id}/tracks/${TRACK}`, buildTrackBody(status));
        await api('POST', `/edits/${edit.id}:validate`, {});
      } else if (isManualReviewSendError(e)) {
        manualReviewSend = true;
        console.log(
          `  [fallback] Google cannot auto-send these changes for review. ` +
            `Committing with changesNotSentForReview=true — send for review from the Play Console UI.`,
        );
      } else {
        throw e;
      }
    }

    console.log('\n[5] Commit edit...');
    const sendToReview = MODE === 'submit' && status === 'completed' && !manualReviewSend;
    let commitUrl = `/edits/${edit.id}:commit`;
    if (sendToReview) commitUrl += '?changesNotSentForReview=false';
    else if (manualReviewSend) commitUrl += '?changesNotSentForReview=true';
    let result;
    try {
      result = await api('POST', commitUrl, {});
    } catch (e) {
      if (manualReviewSend || !isManualReviewSendError(e)) throw e;
      manualReviewSend = true;
      console.log(`  [fallback] commit retry with changesNotSentForReview=true.`);
      result = await api('POST', `/edits/${edit.id}:commit?changesNotSentForReview=true`, {});
    }
    console.log(`  committed id=${result.id}`);
    if (manualReviewSend) {
      console.log(
        `  -> committed WITHOUT auto-send. Open Play Console and press "Send for review" (審査に送信) to submit the pending changes.`,
      );
    } else if (sendToReview) {
      console.log(`  -> sent to Google review (changesNotSentForReview=false)`);
    } else if (status === 'draft') {
      console.log(
        `  -> DRAFT release saved on track ${TRACK}. Promote via Play Console UI: ` +
          `App content / Data safety / Content rating need to be filled before production.`,
      );
    } else {
      console.log(`  -> draft saved (not yet sent for review)`);
    }
  } catch (e) {
    console.error(`  error during edit: ${e.message}`);
    try {
      await api('DELETE', `/edits/${edit.id}`);
    } catch {
      /* swallow */
    }
    throw e;
  }

  console.log('\nDONE.');
})().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  process.exit(1);
});
