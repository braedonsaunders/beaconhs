'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// A representative, read-only preview of ONE element — how it looks in the
// shipped product. Used by the canvas blocks (WYSIWYG building) and the Preview
// drawer. Uses the element's real label / options / config, not placeholders.

import { AlertTriangle, BarChart3, MapPin, ScanLine, Sparkles, Star } from 'lucide-react'
import { Input, Select, Textarea } from '@beaconhs/ui'
import type { FormField } from '@beaconhs/forms-core'
import { localizeText, type AppLocale } from '@beaconhs/i18n'

function cfg(field: FormField): Record<string, unknown> {
  return (field.config as Record<string, unknown> | undefined) ?? {}
}

function optionLabels(field: FormField, locale: AppLocale, defaultLocale: AppLocale): string[] {
  const opts =
    (field.validation?.options as { value: string; label: unknown }[] | undefined) ??
    (cfg(field).options as { value: string; label: unknown }[] | undefined) ??
    []
  return opts.map((o) =>
    localizeText(o.label as Record<string, string>, locale, o.value, defaultLocale),
  )
}

export function ElementPreview({
  field,
  locale,
  defaultLocale,
  compact = false,
}: {
  field: FormField
  locale: AppLocale
  defaultLocale: AppLocale
  compact?: boolean
}) {
  const label = localizeText(field.label, locale, field.id, defaultLocale)
  const helpText = localizeText(field.helpText, locale, '', defaultLocale)
  const t = field.type

  // Content elements ARE their content — no separate field label.
  if (t === 'heading')
    return (
      <h3 className="text-base font-semibold text-slate-800">
        <GeneratedValue value={label} />
      </h3>
    )
  if (t === 'paragraph')
    return (
      <p className="text-sm leading-snug text-slate-500">
        <GeneratedValue value={label} />
      </p>
    )
  if (t === 'divider') return <hr className="my-1 border-slate-200" />
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-600">
        <GeneratedValue value={label} />
        <GeneratedValue value={field.required ? <span className="text-rose-500"> *</span> : null} />
      </div>
      <ElementInput field={field} locale={locale} defaultLocale={defaultLocale} compact={compact} />
      <GeneratedValue
        value={
          helpText ? (
            <p className="text-[10px] text-slate-400">
              <GeneratedValue value={helpText} />
            </p>
          ) : null
        }
      />
    </div>
  )
}

function ElementInput({
  field,
  locale,
  defaultLocale,
  compact,
}: {
  field: FormField
  locale: AppLocale
  defaultLocale: AppLocale
  compact?: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const t = field.type
  const labels = optionLabels(field, locale, defaultLocale)
  const choices = labels.length ? labels : ['Option A', 'Option B']

  switch (t) {
    case 'long_text':
      return <Textarea rows={compact ? 2 : 3} disabled placeholder="" className="bg-white" />
    case 'number':
      return <Input type="number" disabled placeholder="0" className="bg-white" />
    case 'date':
      return <Input type="date" disabled className="bg-white" />
    case 'datetime':
      return <Input type="datetime-local" disabled className="bg-white" />
    case 'time':
      return <Input type="time" disabled className="bg-white" />
    case 'email':
      return (
        <Input
          type="email"
          disabled
          placeholder={tGenerated('m_1b781270c0d2f5')}
          className="bg-white"
        />
      )
    case 'phone':
      return <Input disabled placeholder="(555) 555-5555" className="bg-white" />
    case 'url':
      return <Input disabled placeholder="https://" className="bg-white" />
    case 'select':
    case 'customer_picker':
    case 'site_picker':
    case 'project_picker':
    case 'area_picker':
    case 'person_picker':
    case 'multi_person_picker':
      return (
        <Select disabled className="bg-white">
          <option>{labels[0] ?? 'Select…'}</option>
        </Select>
      )
    case 'radio':
      return (
        <div className="space-y-1">
          <GeneratedValue
            value={choices.slice(0, 4).map((l, i) => (
              <label key={i} className="flex items-center gap-2 text-xs text-slate-500">
                <input type="radio" disabled /> <GeneratedValue value={l} />
              </label>
            ))}
          />
        </div>
      )
    case 'checkbox_group':
    case 'multi_select':
      return (
        <div className="space-y-1">
          <GeneratedValue
            value={choices.slice(0, 4).map((l, i) => (
              <label key={i} className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" disabled /> <GeneratedValue value={l} />
              </label>
            ))}
          />
        </div>
      )
    case 'yes_no_comment':
      return (
        <div className="flex gap-2">
          <GeneratedValue
            value={['Yes', 'No'].map((v) => (
              <span
                key={v}
                className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-500"
              >
                <GeneratedValue value={v} />
              </span>
            ))}
          />
        </div>
      )
    case 'pass_fail_na':
      return (
        <div className="flex gap-1">
          <GeneratedValue
            value={['PASS', 'FAIL', 'N/A'].map((v) => (
              <span
                key={v}
                className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-500"
              >
                <GeneratedValue value={v} />
              </span>
            ))}
          />
        </div>
      )
    case 'traffic_light':
      return (
        <div className="flex gap-1.5">
          <GeneratedValue
            value={['bg-emerald-500', 'bg-amber-400', 'bg-red-500'].map((tone) => (
              <span key={tone} className={`h-5 w-5 rounded-full ${tone}`} />
            ))}
          />
        </div>
      )
    case 'rating':
      return (
        <div className="flex gap-0.5 text-amber-400">
          <GeneratedValue
            value={[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} size={16} fill="currentColor" strokeWidth={0} />
            ))}
          />
        </div>
      )
    case 'signature':
      return (
        <div className="flex h-16 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 italic">
          <GeneratedText id="m_05a0e2d38bded7" />
        </div>
      )
    case 'photo':
      return (
        <div className="space-y-1.5">
          <div className="flex h-16 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
            <GeneratedText id="m_10e50435ff2693" />
          </div>
          {cfg(field).aiAnalysis === true ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
              <Sparkles size={12} /> <GeneratedText id="m_0fec93e95858fc" />
            </span>
          ) : null}
        </div>
      )
    case 'file':
    case 'video':
    case 'audio':
      return (
        <div className="flex h-16 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
          <GeneratedText id="m_10e50435ff2693" />
        </div>
      )
    case 'sketch':
      return (
        <div className="flex h-20 items-center justify-center rounded border border-dashed border-slate-300 bg-[repeating-linear-gradient(45deg,transparent,transparent_9px,rgba(148,163,184,0.12)_9px,rgba(148,163,184,0.12)_10px)] text-xs text-slate-400 italic">
          <GeneratedText id="m_1abf555859c0a8" />
        </div>
      )
    case 'typed_attestation':
      return <Input disabled placeholder={tGenerated('m_0d0facbd71aa6a')} className="bg-white" />
    case 'formula':
      return <Input disabled value="= computed" className="bg-slate-50 italic" />
    case 'slider': {
      const c = cfg(field) as { min?: number; max?: number }
      const min = c.min ?? 0
      const max = c.max ?? 10
      return (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={min}
            max={max}
            defaultValue={(min + max) / 2}
            disabled
            className="h-2 flex-1 rounded-full bg-slate-200 accent-teal-600"
          />
          <span className="text-xs text-slate-400">
            <GeneratedValue value={Math.round((min + max) / 2)} />
          </span>
        </div>
      )
    }
    case 'gps':
      return (
        <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-500">
          <MapPin size={13} /> <GeneratedText id="m_07cd022cc38d60" />
        </div>
      )
    case 'matrix': {
      const c = cfg(field) as {
        rows?: { key: string; label: string }[]
        scale?: { value: string; label: string }[]
      }
      const rows = c.rows ?? [
        { key: 'r1', label: 'Item 1' },
        { key: 'r2', label: 'Item 2' },
      ]
      const scale = c.scale ?? [
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
      ]
      return (
        <table className="w-full text-[10px]">
          <thead>
            <tr>
              <th />
              <GeneratedValue
                value={scale.map((s) => (
                  <th key={s.value} className="px-1 text-center font-normal text-slate-400">
                    <GeneratedValue value={s.label} />
                  </th>
                ))}
              />
            </tr>
          </thead>
          <tbody>
            <GeneratedValue
              value={rows.slice(0, 3).map((r) => (
                <tr key={r.key}>
                  <td className="pr-1 text-slate-500">
                    <GeneratedValue value={r.label} />
                  </td>
                  <GeneratedValue
                    value={scale.map((s) => (
                      <td key={s.value} className="text-center">
                        <input type="radio" disabled />
                      </td>
                    ))}
                  />
                </tr>
              ))}
            />
          </tbody>
        </table>
      )
    }
    case 'risk_matrix':
      return (
        <div className="grid w-fit grid-cols-5 gap-0.5">
          <GeneratedValue
            value={Array.from({ length: 25 }).map((_, i) => {
              const sev = (i % 5) + Math.floor(i / 5)
              const tone =
                sev >= 6
                  ? 'bg-red-400'
                  : sev >= 4
                    ? 'bg-amber-300'
                    : sev >= 2
                      ? 'bg-yellow-200'
                      : 'bg-emerald-200'
              return <span key={i} className={`h-3.5 w-3.5 rounded-sm ${tone}`} />
            })}
          />
        </div>
      )
    case 'qr_scanner':
      return (
        <div className="flex items-center gap-2">
          <Input
            disabled
            placeholder={tGenerated('m_0a43fb83c91fdf')}
            className="flex-1 bg-white"
          />
          <span className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-[11px] text-slate-500">
            <ScanLine size={12} /> <GeneratedText id="m_198b8dba5a829c" />
          </span>
        </div>
      )
    case 'ranking': {
      const ls = optionLabels(field, locale, defaultLocale)
      const itemsR = ls.length ? ls : ['Option A', 'Option B', 'Option C']
      return (
        <ol className="space-y-1">
          <GeneratedValue
            value={itemsR.slice(0, 4).map((l, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              >
                <span className="w-4 text-center font-semibold text-slate-400">
                  <GeneratedValue value={i + 1} />
                </span>
                <span className="flex-1 truncate text-slate-600">
                  <GeneratedValue value={l} />
                </span>
                <span className="text-slate-300">⇅</span>
              </li>
            ))}
          />
        </ol>
      )
    }
    case 'rich_text':
      return (
        <div className="rounded border border-slate-200">
          <div className="flex gap-2 border-b border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-400">
            <span className="font-bold">
              <GeneratedText id="m_03d716fddcdd92" />
            </span>
            <span className="italic">
              <GeneratedText id="m_01f47383f19f8c" />
            </span>
            <span>
              <GeneratedText id="m_1287c1049195af" />
            </span>
          </div>
          <div className="space-y-1 p-2">
            <div className="h-1.5 w-3/4 rounded bg-slate-100" />
            <div className="h-1.5 w-1/2 rounded bg-slate-100" />
          </div>
        </div>
      )
    case 'address':
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-400">
            <MapPin size={12} /> <GeneratedText id="m_178de0c94da150" />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="col-span-2 h-7 rounded border border-slate-200 bg-white" />
            <div className="h-7 rounded border border-slate-200 bg-white" />
            <div className="h-7 rounded border border-slate-200 bg-white" />
          </div>
        </div>
      )
    case 'table':
      return <MiniTable field={field} />
    case 'lookup':
      return (
        <div className="space-y-1">
          <Select disabled className="bg-white">
            <option>{'Select…'}</option>
          </Select>
          <GeneratedValue
            value={
              field.binding?.autofill?.length ? (
                <p className="text-[10px] text-violet-500">
                  <GeneratedText id="m_011434db59926f" />{' '}
                  <GeneratedValue value={field.binding.autofill.length} />{' '}
                  <GeneratedText id="m_1d6aa8702d3fac" />
                  <GeneratedValue
                    value={
                      field.binding.autofill.length === 1 ? (
                        ''
                      ) : (
                        <GeneratedText id="m_00ded356f0f424" />
                      )
                    }
                  />
                </p>
              ) : null
            }
          />
        </div>
      )
    case 'data_table': {
      const keys = field.binding?.columns ?? []
      const headers = keys.length ? keys : ['Column A', 'Column B', 'Column C']
      const sel = field.binding?.selectable
      return (
        <div className="overflow-hidden rounded border border-slate-200 text-[10px]">
          <div className="flex bg-slate-50">
            <GeneratedValue
              value={headers.slice(0, 5).map((h, i) => (
                <div
                  key={i}
                  className="flex-1 truncate border-r border-slate-200 px-1.5 py-1 font-medium text-slate-500 last:border-0"
                >
                  <GeneratedValue value={h} />
                </div>
              ))}
            />
          </div>
          <GeneratedValue
            value={[0, 1, 2].map((r) => (
              <div key={r} className="flex border-t border-slate-100">
                <GeneratedValue
                  value={headers.slice(0, 5).map((_, i) => (
                    <div
                      key={i}
                      className="flex-1 border-r border-slate-100 px-1.5 py-1 text-slate-300 last:border-0"
                    >
                      —
                    </div>
                  ))}
                />
              </div>
            ))}
          />
          <GeneratedValue
            value={
              sel && sel !== 'none' ? (
                <div className="bg-slate-50 px-1.5 py-0.5 text-[9px] text-slate-400">
                  <GeneratedValue
                    value={
                      sel === 'single' ? (
                        <GeneratedText id="m_1d33f094c621dc" />
                      ) : (
                        <GeneratedText id="m_1a1dcc7d0b9e8a" />
                      )
                    }
                  />
                </div>
              ) : null
            }
          />
        </div>
      )
    }
    case 'metric': {
      const agg = field.binding?.aggregate
      const grouped =
        !!agg?.groupBy || (!!field.binding?.display && field.binding.display !== 'number')
      if (grouped) {
        return (
          <div className="flex h-14 items-end gap-1">
            <GeneratedValue
              value={[8, 14, 10, 16, 6].map((h, i) => (
                <span key={i} className="w-3 rounded-t bg-teal-400" style={{ height: h * 3 }} />
              ))}
            />
          </div>
        )
      }
      return (
        <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <BarChart3 size={18} className="text-teal-500" />
          <div>
            <div className="text-2xl leading-none font-semibold text-slate-800">—</div>
            <div className="mt-0.5 text-[10px] tracking-wide text-slate-400 uppercase">
              <GeneratedValue value={agg?.fn ?? <GeneratedText id="m_15f748343d3956" />} />
              <GeneratedValue value={agg?.column ? ` · ${agg.column}` : ''} />
            </div>
          </div>
        </div>
      )
    }
    default:
      return <Input disabled placeholder="" className="bg-white" />
  }
}

function MiniTable({ field }: { field: FormField }) {
  const cols = (cfg(field).columns as { key: string; label: string }[] | undefined) ?? []
  if (cols.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-300 p-2 text-center text-[11px] text-slate-400">
        <GeneratedText id="m_0d90d1eceb566b" />
      </div>
    )
  }
  const shown = cols.slice(0, 5)
  return (
    <div className="overflow-hidden rounded border border-slate-200 text-[10px]">
      <div className="flex bg-slate-50">
        <GeneratedValue
          value={shown.map((c) => (
            <div
              key={c.key}
              className="flex-1 truncate border-r border-slate-200 px-1.5 py-1 font-medium text-slate-500 last:border-0"
            >
              <GeneratedValue value={c.label || c.key} />
            </div>
          ))}
        />
      </div>
      <GeneratedValue
        value={[0, 1].map((r) => (
          <div key={r} className="flex border-t border-slate-100">
            <GeneratedValue
              value={shown.map((c) => (
                <div
                  key={c.key}
                  className="flex-1 border-r border-slate-100 px-1.5 py-1 text-slate-300 last:border-0"
                >
                  —
                </div>
              ))}
            />
          </div>
        ))}
      />
    </div>
  )
}
