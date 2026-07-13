import { createElement, forwardRef, type ImgHTMLAttributes } from 'react'

/**
 * Native browser image for sources Next's optimizer must not proxy: short-lived
 * signed attachment URLs, blob/data previews, and print artifacts. Callers keep
 * native sizing/loading semantics while ordinary public assets use next/image.
 */
export const RawImage = forwardRef<HTMLImageElement, ImgHTMLAttributes<HTMLImageElement>>(
  function RawImage(props, ref) {
    return createElement('img', { ...props, ref })
  },
)
