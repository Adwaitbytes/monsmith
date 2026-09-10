/**
 * Emits a JSON-LD script tag. Server-rendered so it is present in the initial
 * HTML a crawler reads; the `<` escape stops a value from ever closing the tag.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
