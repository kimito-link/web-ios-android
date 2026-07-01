#!/usr/bin/env node
// Push every edit-scoped Play Console field that the Android Publisher API exposes:
//   - store listing (title / shortDescription / fullDescription) in one locale
//   - developer contact details (defaultLanguage / contactEmail / website)
//   - store graphics (icon / feature graphic / phone screenshots)
//   - optional production release notes re-stamp (PLAY_RESTAMP_RELEASE_NOTES=1)
//
// Data Safety is NOT edit-scoped; fill it with play-fill-data-safety.mjs after
// exporting the Play Console Data Safety CSV once.
//
// Still left to Play Console UI / browser automation (Google exposes no API):
//   - App content declarations (privacy URL display / ads / app access)
//   - Content Rating (IARC questionnaire)
//   - Target Audience
//   - the final "Send for review" (see google-play-submission-playbook.md §3)
//
// Resolution order for identity: env → app.config.json → error (no brand default).
//
// Usage:
//   PLAY_PACKAGE_NAME=... GOOGLE_PLAY_SA_JSON_PATH=... node scripts/play-fill-listing.mjs
//
// Assets it reads (place them before running):
//   store-assets/play/listing-copy.md        # fenced "## 詳しい説明" block = fullDescription
//   store-assets/play/icon-512.png           # 512x512 store icon
//   store-assets/play/feature-graphic.png    # 1024x500 feature graphic
//   store-assets/play/screenshots/*.png      # phone screenshots (max 8 per locale — see cap below)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceAccount, makePlayClient, uploadListingImage } from './lib/play-api.mjs';
import { loadAppConfig, cfg } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APP_CONFIG = loadAppConfig();

// No brand default: env → app.config → error. (Copy-from-another-app scripts must
// never ship a hardcoded package name; it silently targets the wrong app.)
const PACKAGE = process.env.PLAY_PACKAGE_NAME || cfg('stores.playPackageName');
if (!PACKAGE) {
  console.error(
    'PLAY_PACKAGE_NAME が未設定で、app.config.json の stores.playPackageName も空です。\n' +
      'env PLAY_PACKAGE_NAME=<applicationId> を渡すか app.config.json を埋めてください。',
  );
  process.exit(1);
}

const PLAY_LOCALE = process.env.PLAY_LISTING_LOCALE || 'ja-JP';
const REPLACE_IMAGES = process.env.PLAY_REPLACE_IMAGES !== '0';
const RESTAMP_RELEASE_NOTES = process.env.PLAY_RESTAMP_RELEASE_NOTES === '1';
const ALLOW_PERMISSION_SKIP = process.env.PLAY_PREFILL_ALLOW_PERMISSION_SKIP === '1';

// title / shortDescription も env → app.config → 明示エラー。ブランド文言をデフォルト
// に埋め込まない（別アプリにコピーしたとき前アプリの文言が漏れるため）。
const FULL_TITLE = process.env.PLAY_APP_TITLE || cfg('identity.displayName');
if (!FULL_TITLE) {
  console.error('PLAY_APP_TITLE も app.config.json の identity.displayName も空です。');
  process.exit(1);
}
// Play の shortDescription は 80 文字以内。env PLAY_SHORT_DESCRIPTION 優先、無ければ
// app.config の identity.shortDescription。
const SHORT_DESCRIPTION = process.env.PLAY_SHORT_DESCRIPTION || cfg('identity.shortDescription');
if (!SHORT_DESCRIPTION) {
  console.error('PLAY_SHORT_DESCRIPTION も app.config.json の identity.shortDescription も空です。');
  process.exit(1);
}

const PLAY_ASSETS_DIR = path.join(REPO, 'store-assets', 'play');
const FULL_DESCRIPTION_FILE = path.join(PLAY_ASSETS_DIR, 'listing-copy.md');
const PRODUCTION_DOMAIN = cfg('identity.productionDomain');
const CONTACT = {
  contactEmail: cfg('contact.email'),
  contactWebsite: cfg('contact.marketingUrl') || (PRODUCTION_DOMAIN ? `https://${PRODUCTION_DOMAIN}` : undefined),
  // contactPhone intentionally omitted. Play allows blank, and Apple review
  // receives the phone number through App Store Connect review-detail fields.
};

function readFullDescription() {
  const md = fs.readFileSync(FULL_DESCRIPTION_FILE, 'utf8');
  const m = md.match(/##\s*詳しい説明[^\n]*\n+```\n([\s\S]+?)\n```/);
  if (!m) {
    throw new Error(`Could not locate '## 詳しい説明' fenced block in ${FULL_DESCRIPTION_FILE}`);
  }
  return m[1].trim();
}

function readReleaseNotes() {
  const p = path.join(REPO, 'release-notes', 'CURRENT-ja.txt');
  return fs.readFileSync(p, 'utf8').trim();
}

// Distinguish the two 403s the API returns during commit/validate:
//   - real permission boundary (service account lacks CAN_MANAGE_PUBLIC_LISTING)
//   - content-limit rejections that ALSO come back as PERMISSION_DENIED but are
//     really "your data is invalid" (e.g. too many screenshots). Treating the
//     latter as a permission problem was a real trap: the edit got soft-failed
//     and the true cause ("more than 8 screenshots") was hidden. Never let a
//     content-limit 403 be swallowed by the permission soft-fail.
function isContentLimit403(e) {
  return /more than \d+ screenshots|exceeds the maximum|too many|invalid|not a valid/i.test(
    String(e?.message || e),
  );
}
function isPermissionDenied(e) {
  return (
    /403|PERMISSION_DENIED|does not have permission/i.test(String(e?.message || e)) &&
    !isContentLimit403(e)
  );
}

function existingFiles(paths) {
  return paths.filter((file) => fs.existsSync(file));
}

function sortedPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(dir, name));
}

async function replaceImageSet(api, sa, editId, imageType, files) {
  if (files.length === 0) {
    console.log(`  ${imageType}: no local files; skipping.`);
    return;
  }
  if (REPLACE_IMAGES) {
    await api('DELETE', `/edits/${editId}/listings/${PLAY_LOCALE}/${imageType}`);
    console.log(`  ${imageType}: cleared existing images.`);
  }
  for (const file of files) {
    const result = await uploadListingImage(sa, PACKAGE, editId, PLAY_LOCALE, imageType, file);
    const url = result?.image?.url || '(uploaded)';
    console.log(`  ${imageType}: ${path.relative(REPO, file)} -> ${url}`);
  }
}

// Play allows at most 8 phoneScreenshots per locale. Exceeding it makes
// edits:validate fail with 403 "This app has more than 8 screenshots for
// language <loc>", the whole edit is then discarded, and NOTHING lands —
// icon, listing text, and graphics are all lost with it. A capture step that
// emits both 6.5" and 6.7" sizes yields 10 files and trips this. Cap to 8.
const PLAY_MAX_PHONE_SCREENSHOTS = 8;

async function uploadStoreImages(api, sa, editId) {
  const allPhoneShots = sortedPngs(path.join(PLAY_ASSETS_DIR, 'screenshots'));
  const phoneScreenshots = allPhoneShots.slice(0, PLAY_MAX_PHONE_SCREENSHOTS);
  if (allPhoneShots.length > PLAY_MAX_PHONE_SCREENSHOTS) {
    console.log(
      `  phoneScreenshots: ${allPhoneShots.length} found; capping to ${PLAY_MAX_PHONE_SCREENSHOTS} (Play limit). ` +
        `dropped: ${allPhoneShots
          .slice(PLAY_MAX_PHONE_SCREENSHOTS)
          .map((f) => path.basename(f))
          .join(', ')}`,
    );
  }
  await replaceImageSet(api, sa, editId, 'icon', existingFiles([path.join(PLAY_ASSETS_DIR, 'icon-512.png')]));
  await replaceImageSet(
    api,
    sa,
    editId,
    'featureGraphic',
    existingFiles([path.join(PLAY_ASSETS_DIR, 'feature-graphic.png')]),
  );
  await replaceImageSet(api, sa, editId, 'phoneScreenshots', phoneScreenshots);
}

(async () => {
  const sa = loadServiceAccount();
  const api = makePlayClient(sa, PACKAGE);

  const fullDescription = readFullDescription();
  console.log(`packageName=${PACKAGE} locale=${PLAY_LOCALE}`);
  console.log(`fullDescription: ${fullDescription.length} chars (limit 4000)`);
  console.log(`shortDescription: ${SHORT_DESCRIPTION.length} chars (limit 80)`);

  console.log('\n[1] Open edit...');
  const edit = await api('POST', '/edits', {});
  console.log(`  editId=${edit.id}`);

  try {
    console.log('\n[2] PUT listing...');
    await api('PUT', `/edits/${edit.id}/listings/${PLAY_LOCALE}`, {
      language: PLAY_LOCALE,
      title: FULL_TITLE,
      shortDescription: SHORT_DESCRIPTION,
      fullDescription,
    });
    console.log(`  ${PLAY_LOCALE} listing updated.`);

    console.log('\n[3] PUT /details (developer contact info)...');
    try {
      await api('PUT', `/edits/${edit.id}/details`, {
        defaultLanguage: PLAY_LOCALE,
        ...CONTACT,
      });
      console.log('  details updated.');
    } catch (e) {
      console.log(`  (details update failed; continuing) ${e.message.slice(0, 200)}`);
    }

    console.log('\n[4] Upload Play listing graphics...');
    await uploadStoreImages(api, sa, edit.id);

    console.log('\n[5] Optional production release notes re-stamp...');
    if (RESTAMP_RELEASE_NOTES) {
      try {
        const tracks = await api('GET', `/edits/${edit.id}/tracks`);
        const prod = (tracks.tracks || []).find((t) => t.track === 'production');
        const release = prod?.releases?.[0];
        if (release) {
          const notes = readReleaseNotes();
          await api('PUT', `/edits/${edit.id}/tracks/production`, {
            track: 'production',
            releases: [
              {
                ...release,
                releaseNotes: [{ language: PLAY_LOCALE, text: notes }],
              },
            ],
          });
          console.log(`  production release notes re-stamped (${notes.length} chars).`);
        } else {
          console.log('  no production release found; skipping notes re-stamp.');
        }
      } catch (e) {
        console.log(`  (notes re-stamp failed; continuing) ${e.message.slice(0, 200)}`);
      }
    } else {
      console.log('  skipped. play-publish.mjs owns production track release notes.');
    }

    console.log('\n[6] Validate + commit edit...');
    // Google rejects auto-send for some apps ("Changes cannot be sent for
    // review automatically. Please set the query parameter
    // changesNotSentForReview to true."). edits:validate takes no query
    // params, so when validate raises that error we skip it and commit with
    // changesNotSentForReview=true; the change then waits in Play Console
    // until someone presses "Send for review" in the UI.
    const isManualReviewSendError = (e) => /changesNotSentForReview/i.test(String(e?.message || e));
    let manualReviewSend = false;
    try {
      await api('POST', `/edits/${edit.id}:validate`, {});
    } catch (e) {
      if (!isManualReviewSendError(e)) throw e;
      manualReviewSend = true;
      console.log('  validate: Google cannot auto-send these changes for review; committing without auto-send.');
    }
    try {
      await api(
        'POST',
        `/edits/${edit.id}:commit${manualReviewSend ? '?changesNotSentForReview=true' : ''}`,
        {},
      );
    } catch (e) {
      if (manualReviewSend || !isManualReviewSendError(e)) throw e;
      manualReviewSend = true;
      console.log('  commit: retrying with changesNotSentForReview=true.');
      await api('POST', `/edits/${edit.id}:commit?changesNotSentForReview=true`, {});
    }
    console.log(
      manualReviewSend
        ? '  committed (NOT auto-sent for review — use "Send for review" in Play Console UI).'
        : '  committed.',
    );
  } catch (e) {
    // A content-limit 403 (e.g. too many screenshots) is NOT a permission
    // problem — surface it loudly instead of soft-failing, or the real cause
    // stays hidden and the whole edit is silently discarded.
    if (isContentLimit403(e)) {
      console.error(`error during edit (content limit — FIX THE ASSETS, not permissions): ${e.message}`);
      try {
        await api('DELETE', `/edits/${edit.id}`);
      } catch {
        /* swallow */
      }
      throw e;
    }
    console.error(`error during edit: ${e.message}`);
    try {
      await api('DELETE', `/edits/${edit.id}`);
    } catch {
      /* swallow */
    }
    if (ALLOW_PERMISSION_SKIP && isPermissionDenied(e)) {
      console.log(
        '  [soft-fail] Play metadata upload reached edit validate/commit permission boundary. ' +
          'Continuing so play-publish.mjs can handle the release path; play-review-poll will keep the metadata blocker visible. ' +
          'Grant Manage store presence / CAN_MANAGE_PUBLIC_LISTING to commit listing text and graphics.',
      );
      return;
    }
    throw e;
  }

  console.log('\nDONE — store listing, details, and graphics filled via API.');
  console.log(
    '\nNext API-fillable step: node scripts/play-fill-data-safety.mjs after exporting the Play Data Safety CSV once.\n' +
      'Manual/browser-MCP steps still left: App content, Content rating, Target audience, and the final "Send for review".',
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
