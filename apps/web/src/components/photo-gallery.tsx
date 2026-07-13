'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { RawImage } from '@/components/raw-image'

export type GalleryPhoto = {
  id: string
  url: string
  filename: string
  caption?: string | null
}

export function PhotoGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [lightbox, setLightbox] = useState<GalleryPhoto | null>(null)
  if (photos.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No photos attached.</p>
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setLightbox(p)}
            className="group relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
          >
            <RawImage
              src={p.url}
              alt={p.caption ?? p.filename}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            {p.caption ? (
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/40 px-1.5 py-0.5 text-[10px] text-white">
                {p.caption}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white hover:text-slate-300"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <RawImage
            src={lightbox.url}
            alt={lightbox.caption ?? lightbox.filename}
            className="max-h-full max-w-full rounded-md object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  )
}
