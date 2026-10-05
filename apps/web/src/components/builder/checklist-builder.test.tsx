import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

const state = vi.hoisted(() => ({
  transition: null as Promise<unknown> | null,
  toastError: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useTransition: () => [
    false,
    (action: () => Promise<unknown>) => {
      state.transition = action()
    },
  ],
}))
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: state.refresh }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: state.toastError } }))
vi.mock('@/lib/confirm', () => ({ confirmDialog: state.confirm }))
vi.mock('@/i18n/generated', () => ({
  GeneratedText: () => null,
  GeneratedValue: () => null,
  useGeneratedTranslations: () => (message: string) => message,
  useGeneratedValueTranslations: () => (message: string) => message,
}))
import { useBuilderActionRunner, useConfirmedBuilderDelete } from './checklist-builder'

function redirectSignal() {
  return Object.assign(new Error('NEXT_REDIRECT'), {
    digest: 'NEXT_REDIRECT;replace;/training/assessments/types;303;',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.transition = null
  state.confirm.mockResolvedValue(true)
})

function mountDelete(action: () => Promise<unknown>, onDeleted = vi.fn()) {
  let remove!: () => Promise<void>
  function Harness() {
    remove = useConfirmedBuilderDelete({ confirmMessage: 'Delete this type?', action, onDeleted })
    return null
  }
  renderToString(<Harness />)
  return { remove, onDeleted }
}

describe('builder server action errors', () => {
  it('passes a successful deletion redirect to Next without an error toast', async () => {
    const signal = redirectSignal()
    const { remove, onDeleted } = mountDelete(async () => {
      throw signal
    })
    await remove()
    await expect(state.transition).rejects.toBe(signal)
    expect(state.toastError).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('still shows a real deletion error and stays on the builder', async () => {
    const { remove, onDeleted } = mountDelete(async () => {
      throw new Error('This type is used by a compliance requirement')
    })
    await remove()
    await state.transition
    expect(state.toastError).toHaveBeenCalledWith('This type is used by a compliance requirement')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('navigates after a deletion that returns normally and respects cancelled confirmation', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    const { remove, onDeleted } = mountDelete(action)
    state.confirm.mockResolvedValueOnce(false)
    await remove()
    expect(action).not.toHaveBeenCalled()
    await remove()
    await state.transition
    expect(onDeleted).toHaveBeenCalledOnce()
  })

  it('does not toast or refresh over a redirect in the shared action runner', async () => {
    let run!: ReturnType<typeof useBuilderActionRunner>
    function Harness() {
      run = useBuilderActionRunner()
      return null
    }
    renderToString(<Harness />)
    const signal = redirectSignal()
    run(async () => {
      throw signal
    })
    await expect(state.transition).rejects.toBe(signal)
    expect(state.toastError).not.toHaveBeenCalled()
    expect(state.refresh).not.toHaveBeenCalled()
  })
})
