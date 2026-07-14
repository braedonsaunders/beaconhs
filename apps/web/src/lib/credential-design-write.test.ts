import { describe, expect, it } from 'vitest'
import { DESIGN_DOCUMENT_LIMITS, type DesignElement } from '@beaconhs/design-studio'
import {
  CREDENTIAL_OUTPUTS_SETTINGS_KEY,
  DEFAULT_CREDENTIAL_OUTPUTS,
  normalizeCredentialOutputs,
  type CredentialOutput,
} from './credential-designs'
import {
  CREDENTIAL_OUTPUT_LIMITS,
  parseCredentialOutputForPreview,
  parseCredentialOutputsForSave,
} from './credential-design-write'

function validOutputs(): CredentialOutput[] {
  return structuredClone(DEFAULT_CREDENTIAL_OUTPUTS)
}

function textElement(id: string, text = 'Safe text'): DesignElement {
  return {
    id,
    name: `Layer ${id}`,
    kind: 'text',
    x: 0.5,
    y: 0.5,
    width: 2,
    height: 0.5,
    text,
    fontFamily: "'Archivo', Arial, sans-serif",
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    visible: true,
    opacity: 1,
  }
}

function firstDocument(outputs: CredentialOutput[]) {
  return outputs[0]!.document!
}

function firstArtboard(outputs: CredentialOutput[]) {
  return firstDocument(outputs).artboards[0]!
}

describe('credential design strict write policy', () => {
  it('accepts the real defaults without rewriting any accepted value', () => {
    const input = validOutputs()
    const before = JSON.stringify(input)
    const parsed = parseCredentialOutputsForSave(input)

    expect(parsed).toBe(input)
    expect(JSON.stringify(parsed)).toBe(before)
    expect(parseCredentialOutputForPreview(input[0])).toBe(input[0])
    expect(
      firstArtboard(parsed).elements.some(
        (element) => 'fill' in element && element.fill === 'transparent',
      ),
    ).toBe(true)
    expect(
      firstArtboard(parsed).elements.some(
        (element) => element.kind === 'line' && element.height === 0.01,
      ),
    ).toBe(true)
  })

  it('keeps valid transparent paint and thin rules during defensive reads', () => {
    const normalized = normalizeCredentialOutputs({
      [CREDENTIAL_OUTPUTS_SETTINGS_KEY]: validOutputs(),
    })
    const elements = firstArtboard(normalized).elements
    expect(elements.some((element) => 'fill' in element && element.fill === 'transparent')).toBe(
      true,
    )
    expect(elements.some((element) => element.kind === 'line' && element.height === 0.01)).toBe(
      true,
    )
    expect(parseCredentialOutputsForSave(normalized)).toBe(normalized)
  })

  it('requires a bounded, non-empty output list', () => {
    expect(() => parseCredentialOutputsForSave(null)).toThrow(/must be a list/)
    expect(() => parseCredentialOutputsForSave([])).toThrow(/at least one/)
    expect(() =>
      parseCredentialOutputsForSave(
        Array.from({ length: CREDENTIAL_OUTPUT_LIMITS.maxOutputs + 1 }, () => null),
      ),
    ).toThrow(/no more than 24/)
  })

  it('rejects duplicate or unstable output, artboard, and element ids', () => {
    const duplicateOutputs = validOutputs()
    duplicateOutputs[1]!.id = duplicateOutputs[0]!.id
    expect(() => parseCredentialOutputsForSave(duplicateOutputs)).toThrow(/ID .* duplicated/)

    const unstable = validOutputs()
    unstable[0]!.id = 'Certificate Copy'
    expect(() => parseCredentialOutputsForSave(unstable)).toThrow(/lowercase letters/)

    const duplicateArtboards = validOutputs()
    const document = firstDocument(duplicateArtboards)
    document.artboards.push(structuredClone(document.artboards[0]!))
    expect(() => parseCredentialOutputsForSave(duplicateArtboards)).toThrow(/duplicate artboard ID/)

    const duplicateElements = validOutputs()
    const artboard = firstArtboard(duplicateElements)
    artboard.elements.push(structuredClone(artboard.elements[0]!))
    expect(() => parseCredentialOutputsForSave(duplicateElements)).toThrow(/duplicate element ID/)
  })

  it('rejects overlong or padded output and document labels instead of trimming them', () => {
    const outputName = validOutputs()
    outputName[0]!.name = ` ${outputName[0]!.name}`
    expect(() => parseCredentialOutputsForSave(outputName)).toThrow(/cannot start or end/)

    const description = validOutputs()
    description[0]!.description = 'x'.repeat(CREDENTIAL_OUTPUT_LIMITS.descriptionLength + 1)
    expect(() => parseCredentialOutputsForSave(description)).toThrow(/180 characters or less/)

    const documentName = validOutputs()
    firstDocument(documentName).name = 'x'.repeat(DESIGN_DOCUMENT_LIMITS.documentNameLength + 1)
    expect(() => parseCredentialOutputsForSave(documentName)).toThrow(/120 characters or less/)

    const layerName = validOutputs()
    firstArtboard(layerName).elements[0]!.name = 'x'.repeat(
      DESIGN_DOCUMENT_LIMITS.elementNameLength + 1,
    )
    expect(() => parseCredentialOutputsForSave(layerName)).toThrow(/80 characters or less/)
  })

  it('rejects unsupported output fields, formats, colors, booleans, and numbers', () => {
    const extra = validOutputs() as Array<CredentialOutput & { legacy?: boolean }>
    extra[0]!.legacy = true
    expect(() => parseCredentialOutputsForSave(extra)).toThrow(/unsupported “legacy”/)

    const format = validOutputs()
    ;(format[0] as { format: string }).format = 'wallet-mini'
    expect(() => parseCredentialOutputsForSave(format)).toThrow(/output format.*unsupported/)

    const color = validOutputs()
    color[0]!.primary = 'navy'
    expect(() => parseCredentialOutputsForSave(color)).toThrow(/six-digit hex colour/)

    const enabled = validOutputs()
    ;(enabled[0] as unknown as { enabled: string }).enabled = 'yes'
    expect(() => parseCredentialOutputsForSave(enabled)).toThrow(/must be true or false/)

    const strength = validOutputs()
    strength[0]!.patternStrength = 42.5
    expect(() => parseCredentialOutputsForSave(strength)).toThrow(/whole number from 0 to 80/)
  })

  it('enforces exact document shape, kind, dpi, artboard count, and artboard geometry', () => {
    const extra = validOutputs()
    ;(firstDocument(extra) as unknown as { legacy: boolean }).legacy = true
    expect(() => parseCredentialOutputsForSave(extra)).toThrow(/unsupported “legacy”/)

    const kind = validOutputs()
    ;(firstDocument(kind) as { kind: string }).kind = 'equipment-label'
    expect(() => parseCredentialOutputsForSave(kind)).toThrow(/training credential/)

    const dpi = validOutputs()
    firstDocument(dpi).dpi = 96.5
    expect(() => parseCredentialOutputsForSave(dpi)).toThrow(/whole number from 72 to 300/)

    const noArtboards = validOutputs()
    firstDocument(noArtboards).artboards = []
    expect(() => parseCredentialOutputsForSave(noArtboards)).toThrow(/at least one artboard/)

    const tooManyArtboards = validOutputs()
    const artboard = firstArtboard(tooManyArtboards)
    firstDocument(tooManyArtboards).artboards = Array.from(
      { length: DESIGN_DOCUMENT_LIMITS.maxArtboards + 1 },
      (_, index) => ({ ...structuredClone(artboard), id: `artboard-${index + 1}` }),
    )
    expect(() => parseCredentialOutputsForSave(tooManyArtboards)).toThrow(/no more than 12/)

    const geometry = validOutputs()
    firstArtboard(geometry).width = 0.5
    expect(() => parseCredentialOutputsForSave(geometry)).toThrow(/width must be a number from 1/)
  })

  it('enforces element counts, exact kinds, fields, numbers, colors, and text bounds', () => {
    const tooMany = validOutputs()
    firstArtboard(tooMany).elements = Array.from(
      { length: DESIGN_DOCUMENT_LIMITS.maxElementsPerArtboard + 1 },
      (_, index) => textElement(`layer-${index + 1}`),
    )
    expect(() => parseCredentialOutputsForSave(tooMany)).toThrow(/no more than 240 elements/)

    const kind = validOutputs()
    ;(firstArtboard(kind).elements[0] as unknown as { kind: string }).kind = 'script'
    expect(() => parseCredentialOutputsForSave(kind)).toThrow(/type has an unsupported value/)

    const field = validOutputs()
    const fieldElement = firstArtboard(field).elements.find((element) => element.kind === 'field')!
    ;(fieldElement as { field: string }).field = 'recipient.ssn'
    expect(() => parseCredentialOutputsForSave(field)).toThrow(/data field.*unsupported/)

    const position = validOutputs()
    firstArtboard(position).elements[0]!.x = Number.NaN
    expect(() => parseCredentialOutputsForSave(position)).toThrow(/X position must be a number/)

    const paint = validOutputs()
    const shape = firstArtboard(paint).elements.find((element) => element.kind === 'rect')!
    if ('fill' in shape) shape.fill = 'rgb(0,0,0)'
    expect(() => parseCredentialOutputsForSave(paint)).toThrow(/six-digit hex colour/)

    const text = validOutputs()
    firstArtboard(text).elements = [
      textElement('long-text', 'x'.repeat(DESIGN_DOCUMENT_LIMITS.textLength + 1)),
    ]
    expect(() => parseCredentialOutputsForSave(text)).toThrow(/4000 characters or less/)
  })

  it('accepts only credential-free HTTPS image URLs when a URL source is selected', () => {
    const invalid = validOutputs()
    firstArtboard(invalid).elements = [
      {
        id: 'remote-image',
        name: 'Remote image',
        kind: 'image',
        source: 'url',
        url: 'http://internal.example/image.png',
        x: 0.5,
        y: 0.5,
        width: 2,
        height: 2,
      },
    ]
    expect(() => parseCredentialOutputsForSave(invalid)).toThrow(/credential-free HTTPS URL/)

    const valid = validOutputs()
    firstArtboard(valid).elements = [
      {
        id: 'remote-image',
        name: 'Remote image',
        kind: 'image',
        source: 'url',
        url: 'https://cdn.example.com/image.png',
        fit: 'contain',
        x: 0.5,
        y: 0.5,
        width: 2,
        height: 2,
      },
    ]
    expect(parseCredentialOutputsForSave(valid)).toBe(valid)
  })

  it('enforces both per-document and complete-payload JSON byte limits', () => {
    const documentTooLarge = validOutputs()
    firstArtboard(documentTooLarge).elements = Array.from({ length: 140 }, (_, index) =>
      textElement(`large-${index + 1}`, 'x'.repeat(DESIGN_DOCUMENT_LIMITS.textLength)),
    )
    expect(() => parseCredentialOutputsForSave(documentTooLarge)).toThrow(/document is too large/)

    const payloadTooLarge = Array.from({ length: 3 }, (_, outputIndex) => {
      const output = structuredClone(DEFAULT_CREDENTIAL_OUTPUTS[0]!)
      output.id = `bulk-${outputIndex + 1}`
      output.name = `Bulk ${outputIndex + 1}`
      output.document!.name = `Bulk ${outputIndex + 1}`
      output.document!.artboards[0]!.id = `bulk-${outputIndex + 1}`
      output.document!.artboards[0]!.elements = Array.from({ length: 100 }, (_, elementIndex) =>
        textElement(`bulk-${outputIndex + 1}-${elementIndex + 1}`, 'x'.repeat(3_500)),
      )
      return output
    })
    expect(() => parseCredentialOutputsForSave(payloadTooLarge)).toThrow(
      /Credential designs is too large/,
    )
  })
})
