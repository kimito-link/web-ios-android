/**
 * PowerPoint（.pptx / .pptm）から文字を取り出す。外部ライブラリなし・Workers / Node 共通。
 * 出典: kimito-link/linebot apps/worker/src/services/pptx-text.ts（2026-11-16、本番E2Eで確認済み）
 * ★Workers AI の toMarkdown は PowerPoint 非対応（公式の対応表に pptx が無い:
 *   https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/ ）。
 *   .pptx は ZIP の中に slideN.xml が並ぶだけなので、ZIP を自前で開き <a:t> の文字を集める。
 *   展開は DecompressionStream('deflate-raw')。
 */

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP の中から、名前が条件に合うファイルだけを取り出す（中央ディレクトリを読む）。 */
async function readZipEntries(buf: Uint8Array, want: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  // 末尾の End of Central Directory（PK\x05\x06）を探す
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= buf.length && u32(buf, p) === 0x02014b50; n++) {
    const method = u16(buf, p + 10);
    const csize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
    const local = u32(buf, p + 42);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name) || u32(buf, local) !== 0x04034b50) continue;
    const start = local + 30 + u16(buf, local + 26) + u16(buf, local + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
  }
  return out;
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** スライド1枚の XML から、段落ごとに文字を集める。 */
function slideText(xml: string): string {
  return xml.split(/<\/a:p>/).map((para) => [...para.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unescapeXml(m[1]!)).join('')).map((t) => t.trim()).filter(Boolean).join('\n');
}

/** .pptx の文字を「## スライド N」見出しつきの Markdown で返す。読めなければ空文字。 */
export async function pptxToText(data: ArrayBuffer | Uint8Array): Promise<string> {
  try {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    const files = await readZipEntries(buf, (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
    const num = (n: string) => Number(n.match(/(\d+)\.xml$/)![1]);
    const dec = new TextDecoder();
    const slides = [...files.keys()].filter((n) => n.startsWith('ppt/slides/')).sort((a, b) => num(a) - num(b));
    const parts: string[] = [];
    for (const s of slides) {
      const body = slideText(dec.decode(files.get(s)!));
      const noteXml = files.get(`ppt/notesSlides/notesSlide${num(s)}.xml`);
      const note = noteXml ? slideText(dec.decode(noteXml)).replace(/^\d+$/gm, '').trim() : '';
      if (body || note) parts.push(`## スライド ${num(s)}\n${body}${note ? `\n（メモ）${note}` : ''}`);
    }
    return parts.join('\n\n');
  } catch {
    return '';
  }
}
