'use client'

import { useId, useRef, useState } from 'react'
import { Braces, Copy, X } from 'lucide-react'
import { Button, Input, Popover } from '@beaconhs/ui'
import type { FlowSubjectProfile } from '@beaconhs/forms-core'
import { useGeneratedValueTranslations } from '@/i18n/generated'
import { toast } from '@/lib/toast'

const PAGE_SIZE = 8

/** The same canonical fields used by flow validation and record adapters. */
export function FlowFieldReference({ profile }: { profile: FlowSubjectProfile }) {
  const t = useGeneratedValueTranslations()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [page, setPage] = useState(1)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const query = search.trim().toLocaleLowerCase()
  const fields = profile.fields.filter(
    (field) =>
      (kind === 'all' || (field.kind ?? 'text') === kind) &&
      (!query || `${t(field.label)} ${field.key}`.toLocaleLowerCase().includes(query)),
  )
  const pages = Math.max(1, Math.ceil(fields.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      toast.success(t('Field marker copied.'))
    } catch {
      toast.error(t('Could not copy. Select the field marker and copy it manually.'))
    }
  }
  const kinds: Record<string, string> = {
    text: 'Text',
    number: 'Number',
    enum: 'Choice',
    date: 'Date',
    person: 'Person',
    org_unit: 'Location',
    bool: 'Yes / no',
  }

  return (
    <Popover
      open={open}
      onOpenChange={(value) => (value ? setOpen(true) : close())}
      className="!right-4 !left-4 z-[80] p-3 sm:!right-6 sm:!left-auto sm:w-[28rem]"
      trigger={
        <Button
          ref={trigger}
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-haspopup="dialog"
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Braces size={14} aria-hidden="true" /> {t('Available fields')}
        </Button>
      }
    >
      <section
        id={id}
        aria-label={t('Available fields')}
        className="max-h-[65dvh] space-y-3 overflow-y-auto"
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
          if (event.key === 'Tab') {
            event.stopPropagation()
            const controls = event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input, select',
            )
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t('Available fields')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t(profile.label)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={close} aria-label={t('Close')}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {t(
            'Paste a field marker into a message subject, message text, or spreadsheet cell. It is replaced with the record value when the flow runs. Empty fields stay blank.',
          )}
        </p>
        <Input
          autoFocus
          aria-label={t('Search fields')}
          placeholder={t('Search fields')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <div role="group" aria-label={t('Field type')} className="flex flex-wrap gap-1">
          {Object.entries({ all: 'All field types', ...kinds })
            .filter(
              ([key]) =>
                key === 'all' || profile.fields.some((field) => (field.kind ?? 'text') === key),
            )
            .map(([key, label]) => (
              <Button
                key={key}
                type="button"
                variant={kind === key ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={kind === key}
                onClick={() => {
                  setKind(key)
                  setPage(1)
                }}
              >
                {t(label)}
              </Button>
            ))}
        </div>
        <ul className="space-y-1">
          {fields.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((field) => {
            const token = `{{${field.key}}}`
            return (
              <li
                key={field.key}
                className="flex min-w-0 items-center justify-between gap-2 rounded border border-slate-200 p-2 dark:border-slate-700"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium">{t(field.label)}</p>
                  <code className="block text-xs break-all text-teal-700 select-all dark:text-teal-300">
                    {token}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('Copy field marker')}: ${token}`}
                  onClick={() => void copy(token)}
                >
                  <Copy size={14} aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
        {fields.length === 0 && (
          <p className="text-xs text-slate-500">{t('No matching fields.')}</p>
        )}
        <div className="flex items-center justify-between gap-2 text-xs" aria-live="polite">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('Previous')}
          </Button>
          <span>
            {currentPage} / {pages} · {fields.length}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </section>
    </Popover>
  )
}
