// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
// A fresh translator on every render, like next-intl after any server
// re-render of the layout (a revalidating Server Action).
vi.mock('@/i18n/generated', () => ({
  useGeneratedTranslations: () => (key: string) => key,
  useGeneratedValueTranslations: () => (value: string) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
}))
vi.mock('@/lib/confirm', () => ({ confirmDialog: vi.fn(async () => true) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { OfflineDraftsProvider } = await import('./provider')
const { OfflineRecordProvider, useRecordField } = await import('./offline-record')

type FieldApi = { change: (value: string) => void; commit: () => void; value: () => string }

const Body = forwardRef<FieldApi>(function Body(_props, ref) {
  // The journal workspace never re-renders this prop after a save.
  const field = useRecordField('bodyHtml', '')
  useImperativeHandle(ref, () => ({
    change: field.change,
    commit: () => field.commit(),
    value: () => field.value,
  }))
  return null
})

const RECORD_ID = '11111111-1111-4111-8111-111111111111'

function Tree({ fieldRef }: { fieldRef: React.Ref<FieldApi> }) {
  return (
    <OfflineDraftsProvider tenantId="t1" userId="u1" actorUserId={null}>
      <OfflineRecordProvider module="journals" recordId={RECORD_ID} refreshOnSync={false}>
        <Body ref={fieldRef} />
      </OfflineRecordProvider>
    </OfflineDraftsProvider>
  )
}

describe('record field edits after a layout re-render', () => {
  let root: Root
  let container: HTMLDivElement
  let server = ''
  const requests: Array<{ value: unknown; base: unknown }> = []

  beforeEach(() => {
    server = ''
    requests.length = 0
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // The record saver's compare-and-set, for one text field.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as {
          patches: Array<{ fieldId: string; value: string; base: string }>
        }
        const applied: Array<{ fieldId: string; stored: string }> = []
        const conflicts: Array<{ fieldId: string; current: string }> = []
        for (const patch of body.patches) {
          requests.push({ value: patch.value, base: patch.base })
          if (patch.value === server || patch.base === server) {
            server = patch.value
            applied.push({ fieldId: patch.fieldId, stored: server })
          } else {
            conflicts.push({ fieldId: patch.fieldId, current: server })
          }
        }
        return new Response(
          JSON.stringify({ ok: true, kind: 'fields', applied, conflicts, rejected: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('bases the next edit on the value the server acknowledged, not the first render', async () => {
    const field: { current: FieldApi | null } = { current: null }
    await act(async () => root.render(<Tree fieldRef={field} />))
    await vi.waitFor(() => expect(field.current).not.toBeNull())

    await act(async () => {
      field.current!.change('<p>Working at Sonoco</p>')
      field.current!.commit()
    })
    await vi.waitFor(() => expect(server).toBe('<p>Working at Sonoco</p>'), { timeout: 5000 })

    // Adding a photo revalidates /journals: the layout re-renders.
    await act(async () => root.render(<Tree fieldRef={field} />))

    await act(async () => {
      field.current!.change('<p>Working at Sonoco today performing NDT</p>')
      field.current!.commit()
    })
    await vi.waitFor(() => expect(server).toBe('<p>Working at Sonoco today performing NDT</p>'), {
      timeout: 5000,
    })
    expect(requests.at(-1)).toEqual({
      value: '<p>Working at Sonoco today performing NDT</p>',
      base: '<p>Working at Sonoco</p>',
    })
  })
})
