#!/usr/bin/env node
// Submit Google Play Data Safety answers through Android Publisher API.
//
// Google accepts the exact CSV text exported from Play Console as the
// safetyLabels field. Keep the CSV in a secret when possible because it is
// policy-sensitive release metadata, not runtime application code.
//
// Generate the CSV once with play-generate-data-safety-csv.mjs (merges
// lib/play-data-safety-template.json with your app's answers), or export it
// straight from Play Console.
//
// Inputs, first match wins:
//   PLAY_DATA_SAFETY_CSV / GOOGLE_PLAY_DATA_SAFETY_CSV          raw CSV text
//   PLAY_DATA_SAFETY_CSV_BASE64 / GOOGLE_PLAY_DATA_SAFETY_CSV_BASE64
//   PLAY_DATA_SAFETY_CSV_PATH                                  file path
//   store-assets/play/data-safety.csv                          local fallback
//
// Resolution order for package: env → app.config.json → error (no brand default).
//
// Usage:
//   node scripts/play-fill-data-safety.mjs
//   node scripts/play-fill-data-safety.mjs --optional  # skip cleanly if CSV is absent
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceAccount, makePlayClient } from './lib/play-api.mjs';
import { cfg } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const PACKAGE = process.env.PLAY_PACKAGE_NAME || cfg('stores.playPackageName');
if (!PACKAGE) {
  console.error(
    'PLAY_PACKAGE_NAME が未設定で、app.config.json の stores.playPackageName も空です。',
  );
  process.exit(1);
}

const OPTIONAL = process.argv.includes('--optional');
// Same pattern as play-fill-listing.mjs — when the Service Account hasn't
// been granted "Manage store presence" / CAN_MANAGE_PUBLIC_LISTING yet,
// POSTing the CSV returns 403. Soft-fail in that case so the release
// pipeline keeps working until the user does the one-time UI grant.
const ALLOW_PERMISSION_SKIP = process.env.PLAY_PREFILL_ALLOW_PERMISSION_SKIP === '1';
const DEFAULT_CSV_PATH = path.join(REPO, 'store-assets', 'play', 'data-safety.csv');

function isPermissionDenied(e) {
  return /403|PERMISSION_DENIED|does not have permission/i.test(String(e?.message || e));
}

function normalizeCsvText(text) {
  let csv = String(text || '').replace(/^﻿/, '');
  if (!csv.includes('\n') && csv.includes('\\n')) csv = csv.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  csv = csv.replace(/\r\n/g, '\n').trim();
  if (!csv) return '';
  if (!/PSL_/i.test(csv) || !/,/.test(csv)) {
    throw new Error(
      'Data Safety CSV does not look like a Play Console export/template. Expected comma-separated rows with PSL_* machine-readable question IDs.',
    );
  }
  return `${csv}\n`;
}

function readCsvInput() {
  const direct = process.env.PLAY_DATA_SAFETY_CSV || process.env.GOOGLE_PLAY_DATA_SAFETY_CSV;
  if (direct) return { source: 'env raw CSV', csv: normalizeCsvText(direct) };

  const b64 = process.env.PLAY_DATA_SAFETY_CSV_BASE64 || process.env.GOOGLE_PLAY_DATA_SAFETY_CSV_BASE64;
  if (b64) {
    return { source: 'env base64 CSV', csv: normalizeCsvText(Buffer.from(b64.trim(), 'base64').toString('utf8')) };
  }

  const filePath = process.env.PLAY_DATA_SAFETY_CSV_PATH || DEFAULT_CSV_PATH;
  if (fs.existsSync(filePath)) {
    return { source: path.relative(REPO, filePath), csv: normalizeCsvText(fs.readFileSync(filePath, 'utf8')) };
  }

  return null;
}

(async () => {
  const input = readCsvInput();
  if (!input) {
    const message =
      'No Data Safety CSV found. Export from Play Console once, then provide PLAY_DATA_SAFETY_CSV_BASE64 or store-assets/play/data-safety.csv.';
    if (OPTIONAL) {
      console.log(`[skip] ${message}`);
      return;
    }
    throw new Error(message);
  }

  const sa = loadServiceAccount();
  const api = makePlayClient(sa, PACKAGE);
  console.log(`packageName=${PACKAGE}`);
  console.log(`Data Safety source: ${input.source} (${input.csv.length} bytes)`);
  try {
    await api('POST', '/dataSafety', { safetyLabels: input.csv });
    console.log('DONE — Data Safety declaration submitted via Android Publisher API.');
  } catch (e) {
    if (ALLOW_PERMISSION_SKIP && isPermissionDenied(e)) {
      console.log(
        '  [soft-fail] Data Safety POST hit a permission boundary. Grant the Service Account ' +
          '"Manage store presence" / CAN_MANAGE_PUBLIC_LISTING in Play Console → Setup → API access ' +
          'to commit the Data Safety declaration. play-review-poll will keep the blocker visible.',
      );
      return;
    }
    throw e;
  }
})().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
