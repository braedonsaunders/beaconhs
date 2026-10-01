import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { JSDOM } from 'jsdom'
import messages from '../../../../../../../../../packages/i18n/src/messages/en.json'
import { LogicBuilder } from './logic-builder'

describe('shared condition editor', () => {
  it('keeps the configured condition visible while disabling every edit control for a read-only flow', () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" timeZone="America/Toronto" messages={messages}>
        <LogicBuilder
          disabled
          rule={{ op: 'eq', field: 'site_org_unit_id', value: 'configured-location' }}
          availableFields={[{ id: 'site_org_unit_id', label: 'Location' }]}
          onChange={() => {
            throw new Error('Viewing a condition must not change it')
          }}
        />
      </NextIntlClientProvider>,
    )
    const dom = new JSDOM(markup)
    try {
      const controls = [...dom.window.document.querySelectorAll('button, input, select')]
      expect(controls.length).toBeGreaterThan(0)
      expect(controls.every((control) => control.hasAttribute('disabled'))).toBe(true)
      expect(dom.window.document.querySelector('input')?.value).toBe('configured-location')
      expect(markup).toContain('Location')
      expect(markup).toContain('equals')
      expect(markup).toContain('Record field')
    } finally {
      dom.window.close()
    }
  })
})
