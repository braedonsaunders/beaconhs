import { describe, expect, it, vi } from 'vitest'
import {
  buildEditorUrl,
  buildPresentationUrl,
  getCollaboraEditUrl,
  resolveCollaboraEditUrl,
  resolveCollaboraEditUrlBytes,
  resolveCollaboraViewUrl,
} from './collabora'

const ORIGIN = 'https://office.example.com'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function discovery(body: string): string {
  return `<wopi-discovery><net-zone>${body}</net-zone></wopi-discovery>`
}

describe('resolveCollaboraEditUrl', () => {
  it('parses namespaced XML and attribute order, then removes discovery placeholders', () => {
    const url = `${ORIGIN}/browser/hash/cool.html?ui=&lt;ui=UI_LLCC&amp;&gt;`
    const xml = `
      <w:wopi-discovery xmlns:w="urn:wopi">
        <w:net-zone>
          <w:app name="${PPTX}">
            <w:action urlsrc="${url}" ext="pptx" name="edit" />
          </w:app>
        </w:net-zone>
      </w:wopi-discovery>`

    expect(resolveCollaboraEditUrl(xml, ORIGIN)).toBe(`${ORIGIN}/browser/hash/cool.html?ui=`)
  })

  it('accepts only bounded Collabora placeholders in the query string', () => {
    const action = (url: string) =>
      discovery(
        `<app name="${PPTX}"><action name="edit" urlsrc="${url.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}" /></app>`,
      )

    expect(
      resolveCollaboraEditUrl(action(`${ORIGIN}/browser/cool.html?src=<WOPI_SRC>`), ORIGIN),
    ).toBe(`${ORIGIN}/browser/cool.html?src=`)
    expect(
      resolveCollaboraEditUrl(action(`${ORIGIN}/browser/cool.html?src=<script>`), ORIGIN),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(
        action(`${ORIGIN}/browser/cool.html?src=<${`A_`.repeat(70)}>`),
        ORIGIN,
      ),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(action(`${ORIGIN}/browser/cool.html?src=<WOPI_<SRC>>`), ORIGIN),
    ).toBeNull()
  })

  it('fails closed when the first MIME edit action is off-origin', () => {
    const xml = discovery(`
      <app name="${PPTX}">
        <action name="edit" urlsrc="https://evil.example/browser/steal" />
        <action name="edit" urlsrc="${ORIGIN}/browser/hash/cool.html" />
      </app>`)

    expect(resolveCollaboraEditUrl(xml, ORIGIN)).toBeNull()
  })

  it('fails closed when the first MIME edit action has no URL', () => {
    const xml = discovery(`
      <app name="${PPTX}">
        <action name="edit" />
        <action name="edit" urlsrc="${ORIGIN}/browser/hash/cool.html" />
      </app>`)

    expect(resolveCollaboraEditUrl(xml, ORIGIN)).toBeNull()
  })

  it('uses the first legacy extension edit action and validates its origin', () => {
    const valid = discovery(`
      <app name="legacy">
        <action name="view" ext="pptx" urlsrc="https://evil.example/browser/view" />
        <action urlsrc="${ORIGIN}/browser/hash/cool.html" name="edit" ext="pptx" />
      </app>`)
    expect(resolveCollaboraEditUrl(valid, ORIGIN)).toBe(`${ORIGIN}/browser/hash/cool.html`)

    const firstOffOrigin = discovery(`
      <app name="legacy">
        <action ext="pptx" name="edit" urlsrc="https://evil.example/browser/steal" />
        <action ext="pptx" name="edit" urlsrc="${ORIGIN}/browser/hash/cool.html" />
      </app>`)
    expect(resolveCollaboraEditUrl(firstOffOrigin, ORIGIN)).toBeNull()
  })

  it('requires WOPI action hierarchy and excludes another recognized MIME from fallback', () => {
    const outsideApp =
      '<wopi-discovery><net-zone><action ext="pptx" name="edit" urlsrc="https://office.example.com/browser/x" /></net-zone></wopi-discovery>'
    expect(resolveCollaboraEditUrl(outsideApp, ORIGIN)).toBeNull()

    const crossMime = discovery(`
      <app name="${PPTX}">
        <action ext="docx" name="edit" urlsrc="${ORIGIN}/browser/hash/wrong.html" />
      </app>
      <app name="legacy-documents">
        <action ext="docx" name="edit" urlsrc="${ORIGIN}/browser/hash/docx.html" />
      </app>`)
    expect(resolveCollaboraEditUrl(crossMime, ORIGIN, 'text')).toBe(
      `${ORIGIN}/browser/hash/docx.html`,
    )
  })

  it('prefers a MIME action over an earlier legacy extension action', () => {
    const xml = discovery(`
      <app name="legacy">
        <action ext="pptx" name="edit" urlsrc="https://evil.example/browser/legacy" />
      </app>
      <app name="${PPTX}">
        <action name="edit" urlsrc="${ORIGIN}/browser/hash/cool.html" />
      </app>`)

    expect(resolveCollaboraEditUrl(xml, ORIGIN)).toBe(`${ORIGIN}/browser/hash/cool.html`)
  })

  it('selects DOCX independently from PPTX', () => {
    const xml = discovery(`
      <app name="${PPTX}">
        <action name="edit" urlsrc="${ORIGIN}/browser/hash/pptx.html" />
      </app>
      <app name="${DOCX}">
        <action name="edit" urlsrc="${ORIGIN}/browser/hash/docx.html" />
      </app>`)

    expect(resolveCollaboraEditUrl(xml, ORIGIN, 'text')).toBe(`${ORIGIN}/browser/hash/docx.html`)
  })

  it('rejects credentialed, wrong-origin, and non-browser URLs', () => {
    const xml = (url: string) =>
      discovery(`<app name="${PPTX}"><action name="edit" urlsrc="${url}" /></app>`)

    expect(
      resolveCollaboraEditUrl(xml('https://attacker@office.example.com/browser/steal'), ORIGIN),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(xml('https://other.example.com/browser/hash/cool.html'), ORIGIN),
    ).toBeNull()
    expect(resolveCollaboraEditUrl(xml(`${ORIGIN}/cool/hash`), ORIGIN)).toBeNull()
    expect(resolveCollaboraEditUrl(xml(`${ORIGIN}/browser-evil/hash`), ORIGIN)).toBeNull()
  })

  it('rejects reserved parameters, fragments, and placeholders outside the query', () => {
    const xml = (url: string) =>
      discovery(`<app name="${PPTX}"><action name="edit" urlsrc="${url}" /></app>`)

    expect(
      resolveCollaboraEditUrl(
        xml(`${ORIGIN}/browser/hash/cool.html?WOPISrc=https%3A%2F%2Fevil.example%2Fwopi`),
        ORIGIN,
      ),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(
        xml(`${ORIGIN}/browser/hash/cool.html?%57OPISrc=https%3A%2F%2Fevil.example`),
        ORIGIN,
      ),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(xml(`${ORIGIN}/browser/hash/cool.html?UI_DEFAULTS=evil`), ORIGIN),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(xml(`${ORIGIN}/browser/hash/cool.html?DarkTheme=false`), ORIGIN),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(xml(`${ORIGIN}/browser/hash/cool.html#fragment`), ORIGIN),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(xml(`${ORIGIN}/browser/.&lt;x&gt;/../outside-collabora`), ORIGIN),
    ).toBeNull()
  })

  it('constructs exactly one application-owned WOPI and UI parameter', () => {
    const previousCollabora = process.env.COLLABORA_URL
    const previousWopi = process.env.COLLABORA_WOPI_URL
    process.env.COLLABORA_URL = ORIGIN
    process.env.COLLABORA_WOPI_URL = 'https://app.example.com'
    try {
      const url = new URL(
        buildEditorUrl(
          `${ORIGIN}/browser/hash/cool.html?WOPISrc=https%3A%2F%2Fevil.example&ui_defaults=evil`,
          '10000000-0000-4000-8000-000000000001',
        ),
      )
      expect(url.hash).toBe('')
      expect(url.searchParams.getAll('WOPISrc')).toEqual([
        'https://app.example.com/wopi/files/10000000-0000-4000-8000-000000000001',
      ])
      expect(url.searchParams.getAll('ui_defaults')).toHaveLength(1)
      expect(() =>
        buildEditorUrl(`${ORIGIN}/browser/hash/cool.html#fragment`, 'attachment-id'),
      ).toThrow('Invalid Collabora action URL')
      expect(() =>
        buildEditorUrl('https://evil.example/browser/hash/cool.html', 'attachment-id'),
      ).toThrow('Invalid Collabora action URL')
    } finally {
      if (previousCollabora === undefined) delete process.env.COLLABORA_URL
      else process.env.COLLABORA_URL = previousCollabora
      if (previousWopi === undefined) delete process.env.COLLABORA_WOPI_URL
      else process.env.COLLABORA_WOPI_URL = previousWopi
    }
  })

  it('selects the read-only view action and starts native Impress presentation mode', () => {
    const xml = discovery(`
      <app name="${PPTX}">
        <action name="edit" urlsrc="${ORIGIN}/browser/hash/edit.html" />
        <action name="view" urlsrc="${ORIGIN}/browser/hash/view.html" />
      </app>`)
    expect(resolveCollaboraViewUrl(xml, ORIGIN)).toBe(`${ORIGIN}/browser/hash/view.html`)

    const previousCollabora = process.env.COLLABORA_URL
    const previousWopi = process.env.COLLABORA_WOPI_URL
    process.env.COLLABORA_URL = ORIGIN
    process.env.COLLABORA_WOPI_URL = 'https://app.example.com'
    try {
      const url = new URL(
        buildPresentationUrl(
          `${ORIGIN}/browser/hash/view.html?startPresentation=false`,
          '10000000-0000-4000-8000-000000000001',
        ),
      )
      expect(url.searchParams.getAll('startPresentation')).toEqual(['true'])
      expect(url.searchParams.getAll('WOPISrc')).toEqual([
        'https://app.example.com/wopi/files/10000000-0000-4000-8000-000000000001',
      ])
    } finally {
      if (previousCollabora === undefined) delete process.env.COLLABORA_URL
      else process.env.COLLABORA_URL = previousCollabora
      if (previousWopi === undefined) delete process.env.COLLABORA_WOPI_URL
      else process.env.COLLABORA_WOPI_URL = previousWopi
    }
  })

  it('accepts an exact HTTP loopback origin for local development', () => {
    const local = 'http://localhost:9980'
    const xml = discovery(
      `<app name="${PPTX}"><action name="edit" urlsrc="${local}/browser/hash/cool.html" /></app>`,
    )

    expect(resolveCollaboraEditUrl(xml, `${local}/`)).toBe(`${local}/browser/hash/cool.html`)
    expect(
      resolveCollaboraEditUrl(
        discovery(
          `<app name="${PPTX}"><action name="edit" urlsrc="http://office.example.com/browser/hash/cool.html" /></app>`,
        ),
        'http://office.example.com',
      ),
    ).toBeNull()
  })

  it('rejects malformed, DTD-bearing, wrong-root, and oversized XML', () => {
    expect(resolveCollaboraEditUrl('<wopi-discovery>', ORIGIN)).toBeNull()
    expect(
      resolveCollaboraEditUrl(`<!DOCTYPE wopi-discovery><wopi-discovery></wopi-discovery>`, ORIGIN),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(
        '<wrong-root><action name="edit" ext="pptx" urlsrc="https://office.example.com/browser/x" /></wrong-root>',
        ORIGIN,
      ),
    ).toBeNull()
    expect(
      resolveCollaboraEditUrl(
        `<wopi-discovery>${' '.repeat(1024 * 1024)}</wopi-discovery>`,
        ORIGIN,
      ),
    ).toBeNull()
  })

  it('uses fatal UTF-8 decoding for byte-oriented runtime and deployment checks', () => {
    expect(resolveCollaboraEditUrlBytes(new Uint8Array([0xff]), ORIGIN)).toBeNull()
    const xml = discovery(
      `<app name="${PPTX}"><action name="edit" urlsrc="${ORIGIN}/browser/hash/cool.html" /></app>`,
    )
    expect(resolveCollaboraEditUrlBytes(new TextEncoder().encode(xml), ORIGIN)).toBe(
      `${ORIGIN}/browser/hash/cool.html`,
    )
  })

  it('bounds XML depth and total elements below the byte limit', () => {
    const action = `<net-zone><app name="${PPTX}"><action name="edit" urlsrc="${ORIGIN}/browser/hash/cool.html" /></app></net-zone>`
    const nested = (depth: number) =>
      `<wopi-discovery>${'<x>'.repeat(depth)}${'</x>'.repeat(depth)}${action}</wopi-discovery>`

    expect(resolveCollaboraEditUrl(nested(31), ORIGIN)).toBe(`${ORIGIN}/browser/hash/cool.html`)
    expect(resolveCollaboraEditUrl(nested(32), ORIGIN)).toBeNull()

    const tooManyElements = `<wopi-discovery>${'<x/>'.repeat(16_384)}${action}</wopi-discovery>`
    expect(resolveCollaboraEditUrl(tooManyElements, ORIGIN)).toBeNull()
  })

  it('rejects a configured base URL that is not a clean HTTP(S) origin', () => {
    const xml = discovery(
      `<app name="${PPTX}"><action name="edit" urlsrc="${ORIGIN}/browser/hash/cool.html" /></app>`,
    )

    expect(resolveCollaboraEditUrl(xml, `${ORIGIN}/proxy`)).toBeNull()
    expect(resolveCollaboraEditUrl(xml, `ftp://office.example.com`)).toBeNull()
    expect(resolveCollaboraEditUrl(xml, `https://user@office.example.com`)).toBeNull()
  })

  it('bounds the fetched discovery body before parsing and then accepts a valid retry', async () => {
    const previous = process.env.COLLABORA_URL
    process.env.COLLABORA_URL = ORIGIN
    const valid = discovery(`
      <app name="${PPTX}">
        <action name="edit" urlsrc="${ORIGIN}/browser/hash/cool.html" />
      </app>`)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('x'.repeat(1024 * 1024 + 1)))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
      .mockResolvedValueOnce(new Response(valid))
    vi.stubGlobal('fetch', fetchMock)

    try {
      expect(await getCollaboraEditUrl()).toBeNull()
      expect(await getCollaboraEditUrl()).toBeNull()
      expect(await getCollaboraEditUrl()).toBe(`${ORIGIN}/browser/hash/cool.html`)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
      if (previous === undefined) delete process.env.COLLABORA_URL
      else process.env.COLLABORA_URL = previous
    }
  })
})
