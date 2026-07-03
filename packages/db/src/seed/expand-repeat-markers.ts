// Mirror of @beaconhs/email-render's expandRepeatMarkers, inlined so the db
// package stays dependency-free. Shared by the record email-template and PDF
// document-template seeders: a repeating row marked with `data-each="<coll>"`
// (or `data-if="<key>"`) round-trips through the builder as an invisible attr;
// the SEND/RENDER path needs it expanded into a {{#each}} / {{#if}} block.
export function expandRepeatMarkers(html: string): string {
  return html.replace(
    /<tr\b([^>]*)\bdata-(each|if)="([^"]+)"([^>]*)>([\s\S]*?)<\/tr>/gi,
    (_m, pre: string, kind: string, key: string, post: string, inner: string) => {
      const attrs = `${pre}${post}`.replace(/\s+/g, ' ').trim()
      const open = attrs ? `<tr ${attrs}>` : '<tr>'
      const block = kind === 'each' ? 'each' : 'if'
      return `{{#${block} ${key}}}${open}${inner}</tr>{{/${block}}}`
    },
  )
}
