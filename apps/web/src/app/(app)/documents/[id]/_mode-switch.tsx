'use client'

import { useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Segmented Write ↔ PDF switch for the document surface. Write = the editor;
// PDF = the document's PDF (generated from content, or an uploaded source).

import type { ReactNode } from 'react'
import { FileText, PenLine } from 'lucide-react'
import { cn } from '@beaconhs/ui'

export type DocumentMode = 'write' | 'pdf'

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: DocumentMode
  onChange: (m: DocumentMode) => void
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800">
      <ModeBtn
        active={mode === 'write'}
        onClick={() => onChange('write')}
        icon={<PenLine size={13} />}
        label={tGenerated('m_1100b584efd51b')}
      />
      <ModeBtn
        active={mode === 'pdf'}
        onClick={() => onChange('pdf')}
        icon={<FileText size={13} />}
        label={tGenerated('m_1a2b2ed6729166')}
      />
    </div>
  )
}

function ModeBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300'
          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
      )}
    >
      <GeneratedValue value={icon} />
      <GeneratedValue value={label} />
    </button>
  )
}
