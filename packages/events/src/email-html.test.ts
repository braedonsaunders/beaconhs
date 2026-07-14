import { describe, expect, it } from 'vitest'
import { complianceRollupEmailHtml, maintenanceRollupEmailHtml } from './email-html'

describe('domain-event rollup email HTML', () => {
  it('escapes compliance labels, status text, dates, body, and URLs', () => {
    const html = complianceRollupEmailHtml({
      body: '<img src=x onerror=alert(1)>',
      entries: [{ label: '<script>x</script>', to: 'overdue"', dueOn: '<today>' }],
      url: 'https://example.test/a?x=" onmouseover="alert(1)',
    })

    expect(html).not.toMatch(/<(?:script|img)\b/i)
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('overdue&quot;')
    expect(html).toContain('&lt;today&gt;')
    expect(html).toContain('x=&quot; onmouseover=&quot;alert(1)')
  })

  it('escapes equipment labels and keeps the digest bounded to 25 rows', () => {
    const entries = Array.from({ length: 27 }, (_, index) => ({
      itemName: index === 0 ? '<b>Truck</b>' : `Truck ${index}`,
      assetTag: index === 0 ? 'A&1' : `A${index}`,
      title: index === 0 ? '<img src=x>' : 'Inspection',
      dueOn: '2026-07-13',
    }))
    const html = maintenanceRollupEmailHtml({
      title: '<Maintenance>',
      entries,
      url: 'https://example.test/equipment',
    })

    expect(html).toContain('&lt;Maintenance&gt;')
    expect(html).toContain('&lt;b&gt;Truck&lt;/b&gt; (A&amp;1)')
    expect(html).not.toContain('<img')
    expect(html).toContain('…and 2 more.')
    expect(html).not.toContain('Truck 25')
  })
})
