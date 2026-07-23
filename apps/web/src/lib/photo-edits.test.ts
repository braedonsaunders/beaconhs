import { describe, expect, it } from 'vitest'
import { parsePhotoEdits } from './photo-edits'

describe('photo edit validation', () => {
  it('normalizes an empty caption and annotation layer', () => {
    expect(parsePhotoEdits({ caption: '   ', annotations: [] })).toEqual({
      caption: null,
      annotations: null,
    })
  })

  it('accepts bounded normalized freehand markup', () => {
    expect(
      parsePhotoEdits({
        caption: '  Guard is cracked  ',
        annotations: [
          {
            type: 'free',
            points: [
              [10, 20],
              [30, 40],
            ],
            color: '#ef4444',
            width: 8,
          },
        ],
      }),
    ).toEqual({
      caption: 'Guard is cracked',
      annotations: [
        {
          type: 'free',
          points: [
            [10, 20],
            [30, 40],
          ],
          color: '#ef4444',
          width: 8,
        },
      ],
    })
  })

  it('rejects oversized or out-of-bounds markup payloads', () => {
    expect(() =>
      parsePhotoEdits({
        caption: 'x'.repeat(1_001),
        annotations: [{ type: 'free', points: [[-1, 20]], color: '#ef4444', width: 8 }],
      }),
    ).toThrow()
  })
})
