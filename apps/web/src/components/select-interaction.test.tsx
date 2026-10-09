// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Select } from '../../../../packages/ui/src/select'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  vi.unstubAllGlobals()
})

it('a controlled select updates a builder field inside a fieldset', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const mount = document.createElement('div')
  document.body.append(mount)
  const root = createRoot(mount)
  dispose = () => {
    act(() => root.unmount())
    mount.remove()
  }
  function Harness() {
    const [value, setValue] = useState('')
    return (
      <fieldset>
        <Select value={value} onChange={(event) => setValue(event.target.value)}>
          <option value="">Choose</option>
          <option value="FallArrest">Fall arrest</option>
          <option value="TravelRestraint">Travel restraint</option>
        </Select>
        <output>{value}</output>
      </fieldset>
    )
  }
  await act(async () => root.render(<Harness />))
  await act(async () => mount.querySelector<HTMLButtonElement>('button')!.click())
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (element) => element.textContent?.includes('Fall arrest'),
  )
  expect(option).toBeDefined()
  await act(async () => option!.click())
  expect(mount.querySelector('output')?.textContent).toBe('FallArrest')
})
