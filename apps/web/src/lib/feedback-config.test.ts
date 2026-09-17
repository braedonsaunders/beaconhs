import { describe, expect, it } from 'vitest'
import { parseFeedbackLabels, sanitizeFeedbackSettingsInput } from './feedback-config'

describe('feedback settings', () => {
  it('keeps unique comma-separated labels', () => {
    expect(parseFeedbackLabels(`bug, Bug, product, , ${'x'.repeat(41)}`)).toEqual([
      'bug',
      'product',
    ])
  })

  it('accepts a GitHub owner and repo', () => {
    const next = sanitizeFeedbackSettingsInput({
      enabled: true,
      owner: 'braedonsaunders',
      repo: 'beaconhs-platform',
      labels: 'in-app, product',
      searchDuplicates: true,
      token: ' ghp_example ',
    })
    expect(next.owner).toBe('braedonsaunders')
    expect(next.repo).toBe('beaconhs-platform')
    expect(next.labels).toBe('in-app, product')
    expect(next.token).toBe('ghp_example')
  })

  it('rejects an invalid repository owner', () => {
    expect(() =>
      sanitizeFeedbackSettingsInput({
        enabled: true,
        owner: '-bad',
        repo: 'beaconhs-platform',
        labels: '',
        searchDuplicates: true,
      }),
    ).toThrow(/owner/)
  })
})
