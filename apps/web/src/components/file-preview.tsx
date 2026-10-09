'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { FileText } from 'lucide-react'
import { RawImage } from './raw-image'

const PdfViewer = dynamic(() => import('./pdf-viewer').then((module) => module.PdfViewer), {
  ssr: false,
})

/** One lazy first-page preview, shared by attachment cards and lists. */
export function FilePreview({
  url,
  contentType,
  label,
  className = 'h-36 w-full',
}: {
  url: string
  contentType: string
  label: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={ref} className={`overflow-hidden bg-slate-50 dark:bg-slate-950 ${className}`}>
      {contentType.startsWith('image/') ? (
        <RawImage
          src={url}
          alt={label}
          optimizationReason="authenticated"
          className="h-full w-full object-contain"
        />
      ) : contentType === 'application/pdf' && visible ? (
        <PdfViewer url={url} thumbnail className="pointer-events-none h-full w-full" />
      ) : (
        <div className="grid h-full place-items-center text-slate-400">
          <FileText size={32} />
        </div>
      )}
    </div>
  )
}
