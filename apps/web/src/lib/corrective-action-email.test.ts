import { describe, expect, it } from 'vitest'
import { renderCorrectiveActionSummaryEmail } from './corrective-action-email'

describe('corrective-action summary email', () => {
  it('renders safe rich text instead of showing its markup as code', () => {
    const rendered = renderCorrectiveActionSummaryEmail({
      reference: 'CA-1',
      title: 'Guard repair',
      severity: 'high',
      status: 'in_progress',
      owner: 'Alex',
      location: 'Plant 1',
      assignedOn: '2026-08-01',
      dueOn: '2026-08-20',
      message: null,
      description: '<p>Replace <strong>damaged</strong> guard</p><script>alert(1)</script>',
      rootCause: '<ul><li>Wear</li></ul>',
      actionTaken: '<p>Part ordered</p>',
      url: 'https://example.test/corrective-actions/1',
    })

    expect(rendered.html).toContain('<strong>damaged</strong>')
    expect(rendered.html).not.toContain('&lt;p&gt;')
    expect(rendered.html).not.toContain('<script')
    expect(rendered.html).toContain('Location')
    expect(rendered.text).toContain('Replace damaged guard')
    expect(rendered.text).not.toContain('<p>')
  })
})
