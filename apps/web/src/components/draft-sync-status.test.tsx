// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DraftSyncState } from '@/lib/offline-drafts/engine'
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: React.ReactNode }) => <>{value}</>,
  GeneratedText: ({ id }: { id: string }) => <>{id}</>,
  useGeneratedTranslations: () => (key: string) => key,
  useGeneratedValueTranslations:
    () =>
    <T,>(value: T) =>
      value,
}))
import { DraftRecoveryBanner, DraftSyncIndicator } from './draft-sync-status'
const state: DraftSyncState = {
  storage: 'device',
  offline: false,
  pending: 1,
  syncing: false,
  lastSyncedAt: null,
  error: null,
  blocked: null,
  closed: false,
}
describe('device-only form recovery', () => {
  it('does not promise automatic submission or show a server-sync queue', () => {
    const banner = renderToStaticMarkup(
      <DraftRecoveryBanner
        localOnly
        restored={{ origin: 'new' }}
        conflict={false}
        onDismiss={() => undefined}
        onDiscard={() => undefined}
        onTakeDeviceCopy={() => undefined}
        onTakeSavedVersion={() => undefined}
      />,
    )
    expect(banner).toContain('nothing is submitted automatically')
    expect(banner).not.toContain('m_1c71b13b8c067e')
    const indicator = renderToStaticMarkup(
      <DraftSyncIndicator localOnly state={state} onRetry={() => undefined} />,
    )
    expect(indicator).toContain('Saved on device')
    expect(indicator).not.toContain('m_049b66568efd8d')
  })
  it('clearly identifies the weaker tab-only fallback when persistent storage is unavailable', () => {
    const indicator = renderToStaticMarkup(
      <DraftSyncIndicator
        localOnly
        state={{ ...state, storage: 'memory' }}
        onRetry={() => undefined}
      />,
    )
    expect(indicator).toContain('Kept in this tab')
  })
})
