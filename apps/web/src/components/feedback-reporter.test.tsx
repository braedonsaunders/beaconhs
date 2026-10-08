// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ loads: 0, error: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/journals' }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/lib/toast', () => ({ toast: { error: state.error } }))
vi.mock('./feedback-dialog', () => {
  state.loads++
  return {
    FeedbackDialog: ({ onClose }: { onClose: () => void }) => (
      <div role="dialog">
        <button onClick={onClose}>close</button>
      </div>
    ),
  }
})
import { FeedbackLauncher } from './feedback-reporter'
let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  container?.remove()
})

it('downloads the reporter only on demand and reuses it when reopened', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<FeedbackLauncher appVersion="fixture" locale="en" />))
  expect(state.loads).toBe(0)
  expect(container.querySelector('[role=dialog]')).toBeNull()
  await act(async () => container!.querySelector<HTMLButtonElement>('button')!.click())
  expect(state.loads).toBe(1)
  expect(container.querySelector('[role=dialog]')).not.toBeNull()
  await act(async () =>
    container!.querySelector<HTMLButtonElement>('[role=dialog] button')!.click(),
  )
  expect(container.querySelector('[role=dialog]')).toBeNull()
  await act(async () => container!.querySelector<HTMLButtonElement>('button')!.click())
  expect(state.loads).toBe(1)
  expect(container.querySelector('[role=dialog]')).not.toBeNull()
  expect(state.error).not.toHaveBeenCalled()
})
