import 'server-only'

import juice from 'juice'

// Inline a builder's <style> rules onto each element's style="" attribute.
// GrapesJS keeps authored styles in getCss() (keyed by generated ids like
// #iltl), so the editor serializes `<style>${getCss()}</style>${getHtml()}` —
// but email clients (Gmail/Outlook) strip <style> blocks, so for EMAIL the CSS
// must be inlined onto each element to survive. (PDF renders in Chromium where
// a <style> block is fine, so PDF does NOT juice.)
//
// MUST run on the raw fullHtml BEFORE expandRepeatMarkers turns `data-each` rows
// into {{#each}} blocks — juice parses HTML with cheerio and would choke on the
// handlebars block syntax. juice() only inlines embedded <style>; it performs no
// network/file access (that is juiceResources/juiceFile), so it is safe + sync.
export function inlineEmailCss(html: string): string {
  if (!html.includes('<style')) return html
  try {
    return juice(html)
  } catch {
    // Never block a save on an inliner edge case — fall back to the raw html
    // (still carries the <style> block, which many clients honor).
    return html
  }
}
