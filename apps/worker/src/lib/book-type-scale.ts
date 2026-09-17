/**
 * How much to scale each document so the whole book reads at one type size.
 *
 * Fitting each document to the page decides its scale from geometry, which is
 * the wrong input: source documents are authored at different body sizes, so
 * equal fit means unequal type. Measured on a real 61-document manual, 39
 * documents were set at 14.5pt and 14 at 17.5pt — a 21% difference that no
 * amount of page-fitting can remove.
 *
 * The target is the largest type size EVERY document can reach without its
 * content overflowing the page, so the book comes out even and nothing is cut.
 * That is a floor, not an average: one document set very large in a full-page
 * block pulls the whole book down to what it can manage, which is the price of
 * uniformity.
 */

export type BookDocumentMetrics = {
  /** The document's own body type size, in source points. */
  bodyTypePt: number | null
  /** Width of its measured content box, in source points. */
  contentWidthPt: number
  /** Height of its measured content box, in source points. */
  contentHeightPt: number
}

export type BookContentBox = { widthPt: number; heightPt: number }

/**
 * Per-document scales, in the order given. `null` where the document could not
 * be measured — those fall back to fitting, which is what happens today.
 */
export function bookTypeScales(
  documents: readonly BookDocumentMetrics[],
  box: BookContentBox,
): (number | null)[] {
  const fitOf = (document: BookDocumentMetrics): number =>
    Math.min(box.widthPt / document.contentWidthPt, box.heightPt / document.contentHeightPt)

  const measurable = documents.filter(
    (document) =>
      document.bodyTypePt !== null &&
      document.bodyTypePt > 0 &&
      document.contentWidthPt > 0 &&
      document.contentHeightPt > 0,
  )
  if (measurable.length === 0) return documents.map(() => null)

  // The largest type every document can reach. Taking the minimum of
  // type×fit — rather than, say, the median type — is what guarantees the
  // scale it implies never overflows any page.
  const target = Math.min(...measurable.map((d) => d.bodyTypePt! * fitOf(d)))
  if (!Number.isFinite(target) || target <= 0) return documents.map(() => null)

  return documents.map((document) => {
    if (
      document.bodyTypePt === null ||
      document.bodyTypePt <= 0 ||
      document.contentWidthPt <= 0 ||
      document.contentHeightPt <= 0
    ) {
      return null
    }
    // Clamped for safety even though the target is chosen to fit: a document
    // measured as a sliver of text would otherwise ask to be magnified.
    return Math.min(target / document.bodyTypePt, fitOf(document))
  })
}
