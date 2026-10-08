import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
vi.mock('@/i18n/generated', () => ({ GeneratedValue: ({ value }: { value: ReactNode }) => value }))
vi.mock('./raw-image', () => ({
  RawImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))
import { ActivityFeed } from './activity-feed'
it('shows removed signature evidence in Activity without presenting it as current ink', () => {
  const html = renderToStaticMarkup(
    <ActivityFeed
      timeZone="America/Toronto"
      entries={[
        {
          id: 'removal',
          action: 'delete',
          occurredAt: new Date(),
          summary: 'Removed crew member',
          before: { signer: 'Crew member', signatureAttachmentId: 'retained-ink' },
          signatureImage: '/retained-signature.png',
        },
      ]}
    />,
  )
  expect(html).toContain('show changes')
  expect(html).toContain('src="/retained-signature.png"')
  expect(html).toContain('Not set')
  expect(html).not.toContain('retained-ink')
})
