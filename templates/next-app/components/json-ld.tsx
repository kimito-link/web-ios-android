/**
 * 構造化データ(JSON-LD)を <script> として埋め込む Server Component。
 * malwarecheck.site の実装を金型化。data は 1件でも配列でも可。
 *
 * 使い方（page.tsx 内・Server Component）:
 *   import { JsonLd } from "@/components/json-ld";
 *   import { buildServiceJsonLd } from "@/components/seo";
 *   ...
 *   return <><JsonLd data={buildServiceJsonLd({...})} />...</>
 */
export function JsonLd({ data }: { data: unknown | unknown[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((d, i) => (
        <script
          key={i}
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d) }}
        />
      ))}
    </>
  );
}
