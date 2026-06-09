// Single source of truth for document body typography, shared by the editor and
// the PDF so pagination in the editor matches the PDF output. Both render under
// the `.doc-body` scope with identical font / sizes / spacing, and both use a
// 1in page margin → identical content width (6.5in on Letter) → identical line
// breaking → identical page breaks.

export const DOC_FONT = 'Georgia, "Times New Roman", serif'
export const DOC_FONT_SIZE_PX = 14
export const DOC_LINE_HEIGHT = 1.6
export const DOC_PAGE_MARGIN_PX = 96 // 1in @ 96dpi (matches the PDF's 1in margin)

// Returns the body CSS rules scoped under `sel`. Margins live on the bottom
// (top margins kept small) to keep editor height-measurement close to print.
export function documentBodyCss(sel = '.doc-body'): string {
  const s = sel
  return `
${s} { font-family: ${DOC_FONT}; font-size: ${DOC_FONT_SIZE_PX}px; line-height: ${DOC_LINE_HEIGHT}; color: #1a1a1a; word-wrap: break-word; }
${s} > :first-child { margin-top: 0; }
${s} p { margin: 0 0 12px; }
${s} h1 { margin: 18px 0 10px; font-size: 26px; line-height: 1.2; font-weight: 700; }
${s} h2 { margin: 16px 0 8px; font-size: 21px; line-height: 1.25; font-weight: 700; }
${s} h3 { margin: 14px 0 6px; font-size: 17px; line-height: 1.3; font-weight: 700; }
${s} h4 { margin: 12px 0 6px; font-size: 15px; font-weight: 700; }
${s} ul, ${s} ol { margin: 0 0 12px; padding-left: 26px; }
${s} li { margin: 3px 0; }
${s} li > p { margin: 0; }
${s} blockquote { margin: 0 0 12px; border-left: 3px solid #cbd5e1; padding: 2px 14px; color: #475569; }
${s} table { border-collapse: collapse; width: 100%; margin: 0 0 12px; table-layout: fixed; }
${s} th, ${s} td { border: 1px solid #cbd5e1; padding: 5px 8px; vertical-align: top; }
${s} th { background: #f1f5f9; font-weight: 700; text-align: left; }
${s} img { max-width: 100%; height: auto; }
${s} a { color: #0f766e; text-decoration: underline; }
${s} pre { margin: 0 0 12px; background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 6px; overflow: auto; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
${s} code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
${s} strong { font-weight: 700; }
${s} em { font-style: italic; }
${s} u { text-decoration: underline; }
${s} s, ${s} del { text-decoration: line-through; }
${s} sub { vertical-align: sub; font-size: 80%; }
${s} sup { vertical-align: super; font-size: 80%; }
${s} hr { border: none; border-top: 1px solid #cbd5e1; margin: 16px 0; }
`
}
