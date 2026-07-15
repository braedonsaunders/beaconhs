import { useGeneratedValueTranslations } from '@/i18n/generated'
import { forwardRef, type ImgHTMLAttributes } from 'react'

type RawImageOptimizationReason =
  'authenticated' | 'ephemeral' | 'generated' | 'design-surface' | 'tenant-origin'

type RawImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'> & {
  src: string
  alt: string
  /** Why this source must be loaded by the browser instead of Next's optimizer. */
  optimizationReason: RawImageOptimizationReason
}

/**
 * Native browser image for sources Next's optimizer must not proxy: short-lived
 * signed attachment URLs, blob/data previews, tenant-configured origins, print
 * artifacts, and pixel-exact design surfaces. Callers keep native sizing/loading
 * semantics while ordinary public assets use next/image.
 */
export const RawImage = forwardRef<HTMLImageElement, RawImageProps>(function RawImage(
  { optimizationReason: _optimizationReason, src, alt, ...props },
  ref,
) {
  const tGeneratedValue = useGeneratedValueTranslations()
  // Next's server-side optimizer cannot forward a user's attachment session,
  // preserve expiring URL semantics, consume local data/blob URLs, allow an
  // arbitrary tenant-owned origin, or promise exact design-surface pixels. The
  // required reason keeps this escape hatch explicit at every call site.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt={tGeneratedValue(alt)} {...props} />
})
