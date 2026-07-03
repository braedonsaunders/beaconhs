// The ONE slugify for Builder-area keys/ids (template keys, button ids). Keeps
// lowercase letters, digits, `_` and `-`, collapses whitespace to `_`, trims
// edge underscores, and caps length. Returns '' for all-symbol input — callers
// pick their own fallback (`slugify(name) || 'app'`).

export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}
