'use client'

// Brief studio: edit sources, instructions, sections, and length on the left
// (autosaved — there is no Save button), and generate a preview for any date
// range on the right. A preview is a real run recorded in the brief's history;
// nothing is emailed.

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Input, Label, Select, Textarea, cn } from '@beaconhs/ui'
import type { BriefSectionSpec, BriefSpec } from '@beaconhs/db/schema'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { previewBrief, saveBrief } from '@/lib/briefs/actions'

type ParamField =
  | { key: string; label: string; kind: 'boolean'; help?: string }
  | {
      key: string
      label: string
      kind: 'multi'
      options: Array<{ value: string; label: string }>
      help?: string
    }

type SourceOption = {
  key: string
  label: string
  description: string
  paramFields: ParamField[]
  readable: boolean
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function sectionKey(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 's_$1')
      .slice(0, 32) || 'section'
  let key = /^[a-z]/.test(base) ? base : `s_${base}`
  let n = 2
  while (taken.has(key)) key = `${base}_${n++}`
  return key
}

export function BriefStudio({
  brief,
  sources,
  canManage,
  defaultDay,
  preview,
  previewWindow,
}: {
  brief: { id: string; name: string; description: string; spec: BriefSpec; specVersion: number }
  sources: SourceOption[]
  canManage: boolean
  defaultDay: string
  preview: ReactNode
  previewWindow: string | null
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const [name, setName] = useState(brief.name)
  const [description, setDescription] = useState(brief.description)
  const [spec, setSpec] = useState<BriefSpec>(brief.spec)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [firstDay, setFirstDay] = useState(defaultDay)
  const [lastDay, setLastDay] = useState(defaultDay)
  const [departmentId, setDepartmentId] = useState('')
  const [previewing, startPreview] = useTransition()
  const firstRender = useRef(true)
  const saving = useRef<Promise<unknown> | null>(null)

  // Autosave: persist ~0.8s after the last edit.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (!canManage) return
    const timer = window.setTimeout(() => {
      const request = saveBrief({ id: brief.id, name, description, spec }).then((result) => {
        if (result.ok) {
          setSaveState('saved')
          setSaveError(null)
        } else {
          setSaveState('error')
          setSaveError(result.error)
        }
      })
      saving.current = request
    }, 800)
    return () => window.clearTimeout(timer)
  }, [brief.id, canManage, name, description, spec])

  // Edits flag the pending save immediately; the effect above persists them.
  const edited = () => {
    if (canManage) setSaveState('saving')
  }
  const update = (patch: Partial<BriefSpec>) => {
    edited()
    setSpec((current) => ({ ...current, ...patch }))
  }
  const sourceConfig = (key: string) => spec.sources.find((s) => s.key === key)
  const toggleSource = (key: string, on: boolean) =>
    update({
      sources: on
        ? [...spec.sources, { key, params: {} }]
        : spec.sources.filter((s) => s.key !== key),
    })
  const setParam = (key: string, param: string, value: unknown) =>
    update({
      sources: spec.sources.map((s) =>
        s.key === key ? { ...s, params: { ...s.params, [param]: value } } : s,
      ),
    })
  const setSection = (index: number, patch: Partial<BriefSectionSpec>) =>
    update({ sections: spec.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
  const moveSection = (index: number, delta: number) => {
    const next = [...spec.sections]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item!)
    update({ sections: next })
  }

  function generatePreview() {
    startPreview(async () => {
      if (saving.current) await saving.current
      const result = await previewBrief({
        id: brief.id,
        firstDay,
        lastDay,
        departmentId: departmentId || null,
      })
      if (!result.ok) {
        toast.error(tGeneratedValue(result.error))
        return
      }
      if (result.error) toast.error(tGeneratedValue(result.error))
      router.replace(`/reports/briefs/${brief.id}?tab=design&preview=${result.runId}`, {
        scroll: false,
      })
      router.refresh()
    })
  }

  const disabled = !canManage
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_0834153991dfe9" />
          </h2>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              saveState === 'error' ? 'text-red-600' : 'text-slate-400',
            )}
            aria-live="polite"
          >
            {saveState === 'saving' ? (
              <>
                <Loader2 size={12} className="animate-spin" />{' '}
                <GeneratedText id="m_106811f2aac664" />
              </>
            ) : saveState === 'saved' ? (
              <>
                <Check size={12} /> <GeneratedText id="m_0a0569b726b225" />
              </>
            ) : saveState === 'error' ? (
              <GeneratedValue value={saveError ?? ''} />
            ) : null}
          </span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brief-name">
            <GeneratedText id="m_02b18d5c7f6f2d" />
          </Label>
          <Input
            id="brief-name"
            value={name}
            maxLength={120}
            disabled={disabled}
            onChange={(e) => {
              edited()
              setName(e.currentTarget.value)
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="brief-description">
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Input
            id="brief-description"
            value={description}
            maxLength={1000}
            disabled={disabled}
            onChange={(e) => {
              edited()
              setDescription(e.currentTarget.value)
            }}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800 dark:text-slate-200">
            <GeneratedText id="m_0c4e106a6e0955" />
          </legend>
          {sources.map((source) => {
            const config = sourceConfig(source.key)
            return (
              <div
                key={source.key}
                className={cn(
                  'rounded-lg border p-3',
                  config
                    ? 'border-teal-300 bg-teal-50/40 dark:border-teal-800 dark:bg-teal-950/20'
                    : 'border-slate-200 dark:border-slate-800',
                )}
              >
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600"
                    checked={Boolean(config)}
                    disabled={disabled || (!source.readable && !config)}
                    onChange={(e) => toggleSource(source.key, e.currentTarget.checked)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      <GeneratedValue value={source.label} />
                    </span>
                    <span className="block text-xs text-slate-500">
                      <GeneratedValue
                        value={
                          source.readable
                            ? source.description
                            : 'You cannot read this module, so it cannot be added.'
                        }
                      />
                    </span>
                  </span>
                </label>
                {config && source.paramFields.length > 0 ? (
                  <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 pl-6 dark:border-slate-800">
                    {source.paramFields.map((field) =>
                      field.kind === 'boolean' ? (
                        <label key={field.key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-teal-600"
                            checked={config.params[field.key] !== false}
                            disabled={disabled}
                            onChange={(e) =>
                              setParam(source.key, field.key, e.currentTarget.checked)
                            }
                          />
                          <GeneratedValue value={field.label} />
                          {field.help ? (
                            <span className="text-xs text-slate-400">
                              — <GeneratedValue value={field.help} />
                            </span>
                          ) : null}
                        </label>
                      ) : (
                        <div
                          key={field.key}
                          className="flex flex-wrap items-center gap-1.5 text-sm"
                        >
                          <span className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue value={field.label} />:
                          </span>
                          {field.options.map((option) => {
                            const selected = Array.isArray(config.params[field.key])
                              ? (config.params[field.key] as string[])
                              : []
                            const on = selected.includes(option.value)
                            return (
                              <button
                                key={option.value}
                                type="button"
                                disabled={disabled}
                                onClick={() =>
                                  setParam(
                                    source.key,
                                    field.key,
                                    on
                                      ? selected.filter((v) => v !== option.value)
                                      : [...selected, option.value],
                                  )
                                }
                                className={cn(
                                  'rounded-full border px-2.5 py-0.5 text-xs',
                                  on
                                    ? 'border-teal-600 bg-teal-600 text-white'
                                    : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
                                )}
                              >
                                <GeneratedValue value={option.label} />
                              </button>
                            )
                          })}
                          <span className="text-xs text-slate-400">
                            <GeneratedText id="m_1074575672fb55" />
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="brief-instructions">
            <GeneratedText id="m_02353074766800" />
          </Label>
          <Textarea
            id="brief-instructions"
            rows={5}
            maxLength={4000}
            value={spec.instructions}
            disabled={disabled}
            placeholder={tGenerated('m_109d3f4fd4dab1')}
            onChange={(e) => update({ instructions: e.currentTarget.value })}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800 dark:text-slate-200">
            <GeneratedText id="m_1152ba42a0ac4d" />
          </legend>
          {spec.sections.map((section, index) => (
            <div
              key={section.key}
              className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
            >
              <div className="flex items-center gap-2">
                <Input
                  aria-label={tGenerated('m_167892ad30a568')}
                  value={section.title}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(e) => setSection(index, { title: e.currentTarget.value })}
                />
                <Input
                  aria-label={tGenerated('m_1c35f32997bff9')}
                  type="number"
                  min={1}
                  max={12}
                  className="w-20"
                  value={section.maxBullets}
                  disabled={disabled}
                  onChange={(e) =>
                    setSection(index, {
                      maxBullets: Math.min(12, Math.max(1, Number(e.currentTarget.value) || 1)),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tGenerated('m_1ec1460770eaa0')}
                  disabled={disabled || index === 0}
                  onClick={() => moveSection(index, -1)}
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tGenerated('m_14ab8cefda3cf9')}
                  disabled={disabled || index === spec.sections.length - 1}
                  onClick={() => moveSection(index, 1)}
                >
                  <ArrowDown size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tGenerated('m_0179000161d80a')}
                  disabled={disabled || spec.sections.length === 1}
                  onClick={() => update({ sections: spec.sections.filter((_, i) => i !== index) })}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              <Textarea
                aria-label={tGenerated('m_021aee0c8e8976')}
                rows={2}
                maxLength={600}
                value={section.guidance}
                disabled={disabled}
                placeholder={tGenerated('m_1602c53f3898fc')}
                onChange={(e) => setSection(index, { guidance: e.currentTarget.value })}
              />
            </div>
          ))}
          <Button
            variant="outline"
            disabled={disabled || spec.sections.length >= 8}
            onClick={() => {
              const taken = new Set(spec.sections.map((s) => s.key))
              update({
                sections: [
                  ...spec.sections,
                  {
                    key: sectionKey('New section', taken),
                    title: 'New section',
                    guidance: '',
                    maxBullets: 5,
                  },
                ],
              })
            }}
          >
            <Plus size={14} /> <GeneratedText id="m_0cfd5e4e441158" />
          </Button>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="brief-words">
              <GeneratedText id="m_1a9d656eec1096" />
            </Label>
            <Input
              id="brief-words"
              type="number"
              min={120}
              max={2500}
              step={50}
              value={spec.targetWords}
              disabled={disabled}
              onChange={(e) =>
                update({
                  targetWords: Math.min(2500, Math.max(120, Number(e.currentTarget.value) || 120)),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brief-tier">
              <GeneratedText id="m_0765ed97aa75fc" />
            </Label>
            <Select
              id="brief-tier"
              value={spec.tier}
              disabled={disabled}
              onChange={(e) =>
                update({ tier: e.currentTarget.value === 'fast' ? 'fast' : 'smart' })
              }
            >
              <option value="smart">Smart model (Admin → AI)</option>
              <option value="fast">Fast model (Admin → AI)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brief-empty">
              <GeneratedText id="m_0a8fbc58673627" />
            </Label>
            <Select
              id="brief-empty"
              value={spec.emptyPolicy}
              disabled={disabled}
              onChange={(e) =>
                update({ emptyPolicy: e.currentTarget.value === 'skip' ? 'skip' : 'send_notice' })
              }
            >
              <option value="send_notice">Send a short notice</option>
              <option value="skip">Send nothing</option>
            </Select>
          </div>
          <label className="flex items-start gap-2.5 pt-6 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600"
              checked={spec.compareWithPrevious}
              disabled={disabled}
              onChange={(e) => update({ compareWithPrevious: e.currentTarget.checked })}
            />
            <span>
              <span className="block font-medium text-slate-800 dark:text-slate-200">
                <GeneratedText id="m_0e9cdbee1dc323" />
              </span>
              <span className="block text-xs text-slate-500">
                <GeneratedText id="m_0ac2471615b9cf" />
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="preview-from">
                <GeneratedText id="m_154c9d7a784dda" />
              </Label>
              <Input
                id="preview-from"
                type="date"
                value={firstDay}
                max={lastDay}
                onChange={(e) => setFirstDay(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="preview-to">
                <GeneratedText id="m_0ea10a854847b2" />
              </Label>
              <Input
                id="preview-to"
                type="date"
                value={lastDay}
                min={firstDay}
                onChange={(e) => setLastDay(e.currentTarget.value)}
              />
            </div>
            <div className="min-w-48 flex-1 space-y-1">
              <Label>
                <GeneratedText id="m_12ea7029815b09" />
              </Label>
              <RemoteSearchSelect
                lookup="brief-departments"
                value={departmentId}
                onChange={setDepartmentId}
                placeholder={tGenerated('m_1de7904254d35c')}
                searchPlaceholder={tGenerated('m_16c34854bcfbe2')}
                ariaLabel="Department"
              />
            </div>
            <Button onClick={generatePreview} disabled={!canManage || previewing}>
              {previewing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              <GeneratedText id="m_11f852e559cf98" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            <GeneratedText id="m_10ae5f3ace880f" />
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {previewing ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> <GeneratedText id="m_054cb19af728e3" />
            </p>
          ) : preview ? (
            <div className="space-y-3">
              {previewWindow ? (
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <GeneratedText id="m_11d37007232de5" /> · <GeneratedValue value={previewWindow} />
                </p>
              ) : null}
              {preview}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              <GeneratedText id="m_16ef68e494a0b9" />
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
