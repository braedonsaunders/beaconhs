// Typography for TipTap-authored lesson HTML — applied to the editor surface
// AND the learner player so authoring is true WYSIWYG. Scoped under a class
// (default `.lesson-prose`) and injected via a <style> tag like the documents
// editor does with documentBodyCss.

export function lessonProseCss(scope = '.lesson-prose'): string {
  const s = scope
  return `
${s} { color: #0f172a; font-size: 0.95rem; line-height: 1.65; }
${s} > * + * { margin-top: 0.6em; }
${s} h1 { font-size: 1.7em; font-weight: 700; line-height: 1.25; margin-top: 1em; }
${s} h2 { font-size: 1.35em; font-weight: 700; line-height: 1.3; margin-top: 1em; }
${s} h3 { font-size: 1.15em; font-weight: 600; line-height: 1.35; margin-top: 0.9em; }
${s} p { margin: 0; }
${s} p + p { margin-top: 0.6em; }
${s} ul, ${s} ol { padding-left: 1.4em; }
${s} ul { list-style: disc; }
${s} ol { list-style: decimal; }
${s} li { margin-top: 0.25em; }
${s} li > p { margin: 0; }
${s} blockquote { border-left: 3px solid #99f6e4; background: #f0fdfa; padding: 0.5em 0.9em; border-radius: 0 0.375rem 0.375rem 0; color: #134e4a; }
${s} hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.2em 0; }
${s} code { background: #f1f5f9; border-radius: 0.25rem; padding: 0.1em 0.35em; font-size: 0.88em; }
${s} pre { background: #0f172a; color: #e2e8f0; border-radius: 0.5rem; padding: 0.8em 1em; overflow-x: auto; }
${s} pre code { background: transparent; padding: 0; color: inherit; }
${s} img.lesson-img, ${s} img { max-width: 100%; border-radius: 0.5rem; }
${s} table { border-collapse: collapse; width: 100%; table-layout: fixed; }
${s} th, ${s} td { border: 1px solid #e2e8f0; padding: 0.4em 0.6em; vertical-align: top; }
${s} th { background: #f8fafc; font-weight: 600; text-align: left; }
${s} ul[data-type='taskList'] { list-style: none; padding-left: 0.2em; }
${s} ul[data-type='taskList'] li { display: flex; gap: 0.5em; align-items: flex-start; }
${s} ul[data-type='taskList'] li > label { margin-top: 0.25em; }
${s} a { color: #0f766e; text-decoration: underline; text-underline-offset: 2px; }
${s} .ProseMirror:focus { outline: none; }
${s} p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #94a3b8; float: left; height: 0; pointer-events: none; }

/* Slide regions: scale typography relative to the slide, inherit slide colors. */
.slide-rich { color: inherit; font-size: clamp(0.7rem, 1.8cqw, 1.05rem); line-height: 1.55; }
.slide-rich > * + * { margin-top: 0.5em; }
.slide-rich h1, .slide-rich h2, .slide-rich h3 { font-weight: 700; line-height: 1.25; }
.slide-rich h1 { font-size: 1.5em; }
.slide-rich h2 { font-size: 1.25em; }
.slide-rich h3 { font-size: 1.1em; }
.slide-rich p { margin: 0; }
.slide-rich p + p { margin-top: 0.45em; }
.slide-rich ul, .slide-rich ol { padding-left: 1.3em; }
.slide-rich ul { list-style: disc; }
.slide-rich ol { list-style: decimal; }
.slide-rich li { margin-top: 0.2em; }
.slide-rich blockquote { border-left: 3px solid currentColor; opacity: 0.9; padding-left: 0.7em; }
.slide-rich img { max-width: 100%; border-radius: 0.4rem; }
.slide-rich a { text-decoration: underline; text-underline-offset: 2px; }
.slide-rich .ProseMirror:focus { outline: none; }
.slide-rich p.is-editor-empty:first-child::before { content: attr(data-placeholder); opacity: 0.4; float: left; height: 0; pointer-events: none; }
`
}
