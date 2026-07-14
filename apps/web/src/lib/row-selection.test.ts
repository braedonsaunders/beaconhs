import { describe, expect, it } from 'vitest'
import { toggleAllVisible, toggleSelection, visibleSelection } from './row-selection'

describe('row selection', () => {
  it('never exposes IDs that are no longer on the visible page', () => {
    expect([...visibleSelection(new Set(['old', 'current']), ['current', 'other'])]).toEqual([
      'current',
    ])
  })

  it('toggles one ID without mutating the previous selection', () => {
    const previous = new Set(['one'])
    expect([...toggleSelection(previous, 'two')]).toEqual(['one', 'two'])
    expect([...previous]).toEqual(['one'])
    expect([...toggleSelection(previous, 'one')]).toEqual([])
  })

  it('selects the visible page and clears it when every row is selected', () => {
    expect([...toggleAllVisible(new Set(['hidden']), ['one', 'two'])]).toEqual(['one', 'two'])
    expect([...toggleAllVisible(new Set(['one', 'two']), ['one', 'two'])]).toEqual([])
    expect([...toggleAllVisible(new Set(), [])]).toEqual([])
  })
})
