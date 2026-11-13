// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MotionGlobalConfig } from 'framer-motion'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  beginPendingDrawer,
  Drawer,
  PendingDrawerProvider,
  settlePendingDrawer,
} from '@beaconhs/ui'

let root: Root | undefined
let container: HTMLDivElement | undefined
const actGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

// jsdom cannot run the slide animations; this covers the panel's state. The
// slide-free takeover was checked in a production build in a real browser.
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true
})

afterEach(async () => {
  MotionGlobalConfig.skipAnimations = false
  if (root) await act(async () => root!.unmount())
  container?.remove()
  root = undefined
  container = undefined
  vi.useRealTimers()
  delete actGlobals.IS_REACT_ACT_ENVIRONMENT
})

function Page() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" id="toggle-drawer" onClick={() => setOpen((value) => !value)}>
        toggle
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="New obligation" size="lg">
        content
      </Drawer>
    </>
  )
}

/** The server's response landing: the page re-renders with its drawer open (or closed). */
const toggleDrawer = () =>
  act(async () =>
    document
      .getElementById('toggle-drawer')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )

async function render() {
  actGlobals.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root!.render(
      <PendingDrawerProvider>
        <Page />
      </PendingDrawerProvider>,
    ),
  )
}

const loadingPanel = () => document.querySelector('aside[role="status"]')
const advance = (ms: number) => act(async () => vi.advanceTimersByTime(ms))

it('slides a loading panel out at once and lets the real drawer take it over in place', async () => {
  await render()
  await act(async () => beginPendingDrawer('md', '/compliance/obligations?drawer=new'))
  // A response faster than the delay never shows the panel.
  expect(loadingPanel()).toBeNull()
  await advance(150)
  expect(loadingPanel()?.className).toContain('sm:max-w-xl')

  await toggleDrawer()
  // Removal waits for the next animation frame.
  await advance(50)
  const dialog = document.querySelector('aside[role="dialog"]')
  expect(dialog?.textContent).toContain('content')
  // Taking over: the loading panel is gone with the real drawer in its place.
  expect(loadingPanel()).toBeNull()
  await act(async () => settlePendingDrawer())
  await advance(50)
  expect(loadingPanel()).toBeNull()

  // The panel remembers the drawer's real size for the next open.
  await toggleDrawer()
  await advance(1000)
  await act(async () => beginPendingDrawer('md', '/compliance/obligations?drawer=new'))
  await advance(150)
  expect(loadingPanel()?.className).toContain('sm:max-w-2xl')
})

it('puts the panel away when the navigation opens no drawer', async () => {
  await render()
  await act(async () => beginPendingDrawer())
  await advance(150)
  expect(loadingPanel()).not.toBeNull()
  await act(async () => settlePendingDrawer())
  await advance(1000)
  expect(loadingPanel()).toBeNull()
})
