// Field codecs for record savers: how a stored column value maps to the wire
// value the record page's live fields render (and send back), and how a
// submitted wire value is validated into the stored value.
//
// The live field primitives (components/live-field.tsx) speak strings: ''
// for empty, 'true'/'false' for switches, `YYYY-MM-DD` for dates and
// `YYYY-MM-DDTHH:mm` (in the worker's timezone) for date-times. `format`
// must return exactly what the page passes as the field's initial value, and
// both directions canonicalise, so equal values always compare equal.

import { htmlToText, sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { datetimeLocalValue, parseDatetimeLocal } from '@/lib/datetime'
import {
  optionalDateInput,
  optionalNumberInput,
  optionalUuidInput,
  requireUuidInput,
} from '@/lib/mutation-input'
import { RecordEditRejection, recordOp, type ErasedRecordOp } from './edits'

export type Codec<T> = {
  parse: (wire: unknown) => T
  format: (value: T) => string
}

function wireString(wire: unknown, label: string): string {
  if (wire == null) return ''
  if (typeof wire === 'string') return wire
  if (typeof wire === 'number' || typeof wire === 'boolean') return String(wire)
  throw new RecordEditRejection(`${label} is invalid.`)
}

type TextOptions = {
  label: string
  maxLength?: number
  /** Store the value as typed (only an all-blank value is trimmed to empty). */
  keepWhitespace?: boolean
}

function parseText(wire: unknown, options: TextOptions): string | null {
  const raw = wireString(wire, options.label)
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    throw new RecordEditRejection(`${options.label} is too long.`)
  }
  return options.keepWhitespace ? raw : trimmed
}

/** Optional single-line or multi-line text; blank clears the column. */
export function optionalText(options: TextOptions): Codec<string | null> {
  return { parse: (wire) => parseText(wire, options), format: (value) => value ?? '' }
}

/** Required text; blank is refused. */
export function requiredText(options: TextOptions): Codec<string> {
  return {
    parse: (wire) => {
      const value = parseText(wire, options)
      if (value === null) throw new RecordEditRejection(`${options.label} is required.`)
      return value
    },
    format: (value) => value,
  }
}

/** Rich text (HTML), sanitised on the way in; text-empty HTML clears it. */
export function optionalRichText(options: {
  label: string
  maxLength?: number
}): Codec<string | null> {
  return {
    parse: (wire) => {
      const raw = wireString(wire, options.label)
      if (options.maxLength !== undefined && raw.length > options.maxLength) {
        throw new RecordEditRejection(`${options.label} is too long.`)
      }
      if (htmlToText(raw).length === 0) return null
      return sanitizeDocumentHtml(raw)
    },
    format: (value) => value ?? '',
  }
}

/** One of a fixed set of values; blank clears it when `nullable`. */
export function choice<const T extends string>(
  values: readonly T[],
  options: { label: string; nullable: true },
): Codec<T | null>
export function choice<const T extends string>(
  values: readonly T[],
  options: { label: string; nullable?: false },
): Codec<T>
export function choice<const T extends string>(
  values: readonly T[],
  options: { label: string; nullable?: boolean },
): Codec<T | null> {
  return {
    parse: (wire) => {
      const value = wireString(wire, options.label).trim()
      if (!value) {
        if (options.nullable) return null
        throw new RecordEditRejection(`${options.label} is required.`)
      }
      if (!(values as readonly string[]).includes(value)) {
        throw new RecordEditRejection(`${options.label} is invalid.`)
      }
      return value as T
    },
    format: (value) => value ?? '',
  }
}

/** A reference id; blank clears it. Existence checks belong in the op. */
export function optionalRef(options: { label: string }): Codec<string | null> {
  return {
    parse: (wire) => optionalUuidInput(wireString(wire, options.label), options.label),
    format: (value) => value ?? '',
  }
}

export function requiredRef(options: { label: string }): Codec<string> {
  return {
    parse: (wire) => requireUuidInput(wireString(wire, options.label), options.label),
    format: (value) => value,
  }
}

/** A switch: 'true'/'false' on the wire. */
export function flag(): Codec<boolean> {
  return {
    parse: (wire) => wire === true || wire === 'true' || wire === 'on' || wire === '1',
    format: (value) => (value ? 'true' : 'false'),
  }
}

/** An optional whole number. */
export function optionalInteger(options: {
  label: string
  min?: number
  max?: number
}): Codec<number | null> {
  return {
    parse: (wire) =>
      optionalNumberInput(wireString(wire, options.label), options.label, {
        integer: true,
        ...(options.min === undefined ? {} : { min: options.min }),
        ...(options.max === undefined ? {} : { max: options.max }),
      }),
    format: (value) => (value === null ? '' : String(value)),
  }
}

/** An optional decimal stored in a `numeric` column (a string in Drizzle). */
export function optionalDecimal(options: {
  label: string
  min?: number
  max?: number
  maxScale?: number
}): Codec<string | null> {
  return {
    parse: (wire) => {
      const value = optionalNumberInput(wireString(wire, options.label), options.label, {
        ...(options.min === undefined ? {} : { min: options.min }),
        ...(options.max === undefined ? {} : { max: options.max }),
        ...(options.maxScale === undefined ? {} : { maxScale: options.maxScale }),
      })
      return value === null ? null : String(value)
    },
    // numeric columns come back zero-padded ("12.50"): compare the number.
    format: (value) => (value === null ? '' : String(Number(value))),
  }
}

/** A calendar date (`YYYY-MM-DD`), optional. */
export function optionalDate(options: { label: string }): Codec<string | null> {
  return {
    parse: (wire) => optionalDateInput(wireString(wire, options.label), options.label),
    format: (value) => value ?? '',
  }
}

function parseDateTime(wire: unknown, label: string, timeZone: string): Date | null {
  const raw = wireString(wire, label).trim()
  if (!raw) return null
  const parsed = parseDatetimeLocal(raw, timeZone)
  if (!parsed) throw new RecordEditRejection(`${label} is invalid.`)
  return parsed
}

/** A date-time edited as wall-clock time in the worker's timezone. */
export function optionalDateTime(options: { label: string; timeZone: string }): Codec<Date | null> {
  return {
    parse: (wire) => parseDateTime(wire, options.label, options.timeZone),
    format: (value) => (value ? datetimeLocalValue(value, options.timeZone) : ''),
  }
}

export function requiredDateTime(options: { label: string; timeZone: string }): Codec<Date> {
  return {
    parse: (wire) => {
      const value = parseDateTime(wire, options.label, options.timeZone)
      if (!value) throw new RecordEditRejection(`${options.label} is required.`)
      return value
    },
    format: (value) => datetimeLocalValue(value, options.timeZone),
  }
}

/**
 * Ops for plain columns of one locked row. `update` writes a partial row with
 * the batch's transaction (the module scopes it to the record and tenant);
 * the loaded row is updated in place so later edits in the batch see it.
 */
export function columnOps<R extends Record<string, unknown>>(
  row: R,
  codecs: { [K in keyof R]?: Codec<R[K]> },
  update: (patch: Partial<R>) => Promise<unknown>,
): (op: string) => ErasedRecordOp | null {
  return (op) => {
    if (!Object.prototype.hasOwnProperty.call(codecs, op)) return null
    const column = op as keyof R & string
    const codec = codecs[column]
    if (!codec) return null
    return recordOp<R[typeof column]>({
      current: row[column],
      parse: codec.parse,
      format: codec.format,
      write: async (value) => {
        await update({ [column]: value } as Partial<R>)
        row[column] = value
      },
    })
  }
}
