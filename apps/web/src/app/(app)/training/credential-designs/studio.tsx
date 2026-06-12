'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import {
  Award,
  BadgeCheck,
  CreditCard,
  FileText,
  Frame,
  Grid3X3,
  Palette,
  QrCode,
  ScanFace,
  Sparkles,
  Type,
} from 'lucide-react'
import { Badge, Button, Input, Label, Select, cn } from '@beaconhs/ui'
import {
  type CredentialDesign,
  type CredentialFormat,
  type CredentialTemplateId,
  type CredentialTypeface,
} from '@/lib/credential-designs'

const TEMPLATES: {
  id: CredentialTemplateId
  label: string
  tone: string
  primary: string
  accent: string
  paper: string
  typeface: CredentialTypeface
  patternStrength: number
}[] = [
  {
    id: 'sovereign-seal',
    label: 'Sovereign Seal',
    tone: 'Formal certificate',
    primary: '#18385f',
    accent: '#b8892f',
    paper: '#fdf9ef',
    typeface: 'classic',
    patternStrength: 56,
  },
  {
    id: 'field-pass',
    label: 'Field Pass',
    tone: 'Crew-ready credential',
    primary: '#174033',
    accent: '#d98a1f',
    paper: '#f7fbf7',
    typeface: 'technical',
    patternStrength: 42,
  },
  {
    id: 'clean-authority',
    label: 'Clean Authority',
    tone: 'Minimal compliance',
    primary: '#22313f',
    accent: '#0f766e',
    paper: '#ffffff',
    typeface: 'modern',
    patternStrength: 18,
  },
]

const FORMATS: { value: CredentialFormat; label: string; icon: ReactNode }[] = [
  { value: 'letter-landscape', label: '11 x 8.5', icon: <FileText size={14} /> },
  { value: 'letter-portrait', label: '8.5 x 11', icon: <Frame size={14} /> },
  { value: 'wallet', label: 'Wallet', icon: <CreditCard size={14} /> },
]

const SAMPLE = {
  tenant: 'Beacon Health & Safety',
  recipient: 'Avery Chen',
  employeeNo: 'BH-1048',
  credential: 'Confined Space Entry and Monitor',
  code: 'CSE-201',
  completed: 'June 11, 2026',
  expires: 'June 11, 2027',
  instructor: 'Morgan Patel',
  token: '7F3A-91CE-42BD',
}

const typefaceClass: Record<CredentialTypeface, string> = {
  classic: 'font-serif',
  modern: 'font-sans',
  technical: 'font-mono',
}

export function CredentialDesignStudio({
  initialDesign,
  onSave,
}: {
  initialDesign: CredentialDesign
  onSave: (design: CredentialDesign) => Promise<CredentialDesign>
}) {
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [design, setDesign] = useState<CredentialDesign>(initialDesign)

  const activeTemplate = useMemo(
    () => TEMPLATES.find((t) => t.id === design.templateId) ?? TEMPLATES[0],
    [design.templateId],
  )

  function applyTemplate(id: CredentialTemplateId) {
    const t = TEMPLATES.find((template) => template.id === id)
    if (!t) return
    setDesign((prev) => ({
      ...prev,
      templateId: t.id,
      primary: t.primary,
      accent: t.accent,
      paper: t.paper,
      typeface: t.typeface,
      patternStrength: t.patternStrength,
    }))
  }

  function saveDraft() {
    startTransition(async () => {
      const saved = await onSave(design)
      setDesign(saved)
      setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    })
  }

  return (
    <div className="flex min-h-[680px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{design.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">{activeTemplate?.label}</div>
            </div>
            <Badge variant="secondary">Draft</Badge>
          </div>
        </div>

        <div className="app-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
          <section className="space-y-2">
            <RailLabel icon={<Frame size={14} />} label="Format" />
            <div className="grid grid-cols-3 gap-1.5">
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setDesign((prev) => ({ ...prev, format: f.value }))}
                  className={cn(
                    'flex h-16 flex-col items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors',
                    design.format === f.value
                      ? 'border-teal-700 bg-teal-50 text-teal-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {f.icon}
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <RailLabel icon={<Sparkles size={14} />} label="Templates" />
            <div className="space-y-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  className={cn(
                    'w-full rounded-md border p-2 text-left transition-colors',
                    design.templateId === t.id
                      ? 'border-teal-700 bg-teal-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <TemplateChip primary={t.primary} accent={t.accent} paper={t.paper} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{t.label}</div>
                      <div className="text-xs text-slate-500">{t.tone}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <RailLabel icon={<Palette size={14} />} label="Palette" />
            <ColorField
              label="Primary"
              value={design.primary}
              onChange={(primary) => setDesign((prev) => ({ ...prev, primary }))}
            />
            <ColorField
              label="Accent"
              value={design.accent}
              onChange={(accent) => setDesign((prev) => ({ ...prev, accent }))}
            />
            <ColorField
              label="Paper"
              value={design.paper}
              onChange={(paper) => setDesign((prev) => ({ ...prev, paper }))}
            />
          </section>

          <section className="space-y-3">
            <RailLabel icon={<Type size={14} />} label="Typography" />
            <Select
              value={design.typeface}
              onChange={(e) =>
                setDesign((prev) => ({
                  ...prev,
                  typeface: e.currentTarget.value as CredentialTypeface,
                }))
              }
            >
              <option value="classic">Classic serif</option>
              <option value="modern">Modern sans</option>
              <option value="technical">Technical mono</option>
            </Select>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Security pattern</Label>
                <span className="text-xs text-slate-500 tabular-nums">
                  {design.patternStrength}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={80}
                value={design.patternStrength}
                onChange={(e) =>
                  setDesign((prev) => ({
                    ...prev,
                    patternStrength: Number(e.currentTarget.value),
                  }))
                }
                className="w-full accent-teal-700"
              />
            </div>
          </section>

          <section className="space-y-2">
            <RailLabel icon={<Grid3X3 size={14} />} label="Layers" />
            <LayerToggle
              checked={design.showPhoto}
              icon={<ScanFace size={14} />}
              label="Photo"
              onChange={(showPhoto) => setDesign((prev) => ({ ...prev, showPhoto }))}
            />
            <LayerToggle
              checked={design.showQr}
              icon={<QrCode size={14} />}
              label="Verification QR"
              onChange={(showQr) => setDesign((prev) => ({ ...prev, showQr }))}
            />
            <LayerToggle
              checked={design.showSeal}
              icon={<Award size={14} />}
              label="Seal"
              onChange={(showSeal) => setDesign((prev) => ({ ...prev, showSeal }))}
            />
          </section>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-slate-100">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
          <BadgeCheck size={15} className="text-teal-700" />
          <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            Live Preview
          </span>
          <div className="ml-auto flex items-center gap-2">
            {savedAt ? <span className="text-xs text-slate-500">Saved {savedAt}</span> : null}
            <Button type="button" size="sm" onClick={saveDraft} disabled={pending}>
              {pending ? 'Saving' : 'Save design'}
            </Button>
          </div>
        </div>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex min-h-full items-center justify-center">
            {design.format === 'wallet' ? (
              <WalletPreview design={design} />
            ) : (
              <CertificatePreview design={design} />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function RailLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
      {icon}
      {label}
    </div>
  )
}

function TemplateChip({
  primary,
  accent,
  paper,
}: {
  primary: string
  accent: string
  paper: string
}) {
  return (
    <span
      className="grid h-10 w-12 shrink-0 grid-cols-[1fr_10px] overflow-hidden rounded border border-slate-200"
      style={{ backgroundColor: paper }}
    >
      <span style={{ backgroundColor: primary }} />
      <span style={{ backgroundColor: accent }} />
    </span>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 text-xs font-medium text-slate-600">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="h-8 w-10 rounded border border-slate-200 bg-white p-0.5"
      />
      <Input value={value} onChange={(e) => onChange(e.currentTarget.value)} className="h-8" />
    </label>
  )
}

function LayerToggle({
  checked,
  icon,
  label,
  onChange,
}: {
  checked: boolean
  icon: ReactNode
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm">
      <span className="flex items-center gap-2 text-slate-700">
        {icon}
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-4 w-4 accent-teal-700"
      />
    </label>
  )
}

function CertificatePreview({ design }: { design: CredentialDesign }) {
  const portrait = design.format === 'letter-portrait'
  return (
    <div
      className={cn(
        'relative overflow-hidden bg-white shadow-2xl ring-1 ring-black/10',
        portrait ? 'h-[880px] w-[680px]' : 'h-[620px] w-[880px]',
        typefaceClass[design.typeface],
      )}
      style={{
        color: design.primary,
        backgroundColor: design.paper,
        backgroundImage: `linear-gradient(135deg, ${design.primary}${hexAlpha(
          design.patternStrength,
        )} 0 1px, transparent 1px 28px), linear-gradient(45deg, ${design.accent}${hexAlpha(
          Math.round(design.patternStrength * 0.7),
        )} 0 1px, transparent 1px 32px)`,
      }}
    >
      <div className="absolute inset-8 border-[3px]" style={{ borderColor: design.primary }} />
      <div className="absolute inset-12 border" style={{ borderColor: design.accent }} />
      <div className="absolute inset-16 border border-black/10" />

      {design.showQr ? (
        <div className="absolute top-20 right-20 grid h-20 w-20 place-items-center rounded border border-black/10 bg-white">
          <QrCode size={48} style={{ color: design.primary }} />
        </div>
      ) : null}

      <div className="absolute inset-x-20 top-16 text-center">
        <div className="text-xs font-bold tracking-[0.32em] uppercase">{SAMPLE.tenant}</div>
        <div className="mx-auto mt-4 h-px w-72" style={{ backgroundColor: design.accent }} />
      </div>

      <main className="absolute inset-x-20 top-36 bottom-24 flex flex-col items-center justify-center text-center">
        <div className="text-5xl font-bold tracking-[0.18em] uppercase">Certificate</div>
        <div
          className="mt-3 text-xs font-semibold tracking-[0.42em] uppercase"
          style={{ color: design.accent }}
        >
          Of completion
        </div>
        <div className="mt-12 text-lg text-slate-600 italic">This certifies that</div>
        <div className="mt-4 text-6xl font-semibold" style={{ color: design.primary }}>
          {SAMPLE.recipient}
        </div>
        <div className="mt-4 h-px w-[72%]" style={{ backgroundColor: design.accent }} />
        <div className="mt-8 max-w-3xl text-2xl font-semibold">{SAMPLE.credential}</div>
        <div className="mt-3 text-xs font-bold tracking-[0.24em] text-slate-500 uppercase">
          Course {SAMPLE.code}
        </div>
        <div className="mt-10 grid w-full max-w-2xl grid-cols-3 gap-4 text-sm">
          <Meta label="Completed" value={SAMPLE.completed} />
          <Meta label="Valid until" value={SAMPLE.expires} />
          <Meta label="Instructor" value={SAMPLE.instructor} />
        </div>
      </main>

      <footer className="absolute inset-x-20 bottom-14 flex items-end justify-between gap-8">
        <Signature label="Instructor" color={design.primary} />
        {design.showSeal ? <Seal design={design} /> : null}
        <Signature label="Issued by Beacon" color={design.primary} />
      </footer>
    </div>
  )
}

function WalletPreview({ design }: { design: CredentialDesign }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <WalletSide design={design} side="front" />
      <WalletSide design={design} side="back" />
    </div>
  )
}

function WalletSide({ design, side }: { design: CredentialDesign; side: 'front' | 'back' }) {
  const isBack = side === 'back'
  return (
    <div
      className={cn(
        'relative h-[340px] w-[540px] overflow-hidden rounded-xl shadow-2xl ring-1 ring-black/10',
        typefaceClass[design.typeface],
      )}
      style={{
        color: isBack ? '#ffffff' : design.primary,
        background: isBack
          ? `linear-gradient(135deg, ${design.primary}, #111827)`
          : `linear-gradient(180deg, ${design.primary} 0 30%, ${design.paper} 30% 100%)`,
      }}
    >
      {!isBack ? (
        <>
          <div className="absolute top-7 right-7 left-7 flex items-start justify-between">
            <div>
              <div className="text-xs font-bold tracking-[0.24em] text-white uppercase">
                {SAMPLE.tenant}
              </div>
              <div className="mt-1 text-[11px] font-semibold tracking-[0.2em] text-white/70 uppercase">
                Training credential
              </div>
            </div>
            {design.showSeal ? <Seal design={design} small /> : null}
          </div>
          {design.showPhoto ? (
            <div className="absolute top-24 left-7 grid h-32 w-28 place-items-center rounded-lg border-4 border-white bg-slate-200 shadow-lg">
              <ScanFace size={42} className="text-slate-500" />
            </div>
          ) : null}
          <div className={cn('absolute top-28 right-7', design.showPhoto ? 'left-44' : 'left-7')}>
            <div className="text-2xl font-extrabold text-slate-950">{SAMPLE.recipient}</div>
            <div className="mt-1 font-mono text-xs text-slate-500">NO. {SAMPLE.employeeNo}</div>
            <div className="mt-5 text-base font-bold text-slate-900">{SAMPLE.credential}</div>
            <div
              className="mt-2 inline-flex rounded border px-2 py-1 font-mono text-xs"
              style={{ borderColor: design.accent, color: design.primary }}
            >
              {SAMPLE.code}
            </div>
          </div>
          <div className="absolute right-7 bottom-7 left-7 flex gap-10 text-xs">
            <Meta label="Issued" value={SAMPLE.completed} compact />
            <Meta label="Expires" value={SAMPLE.expires} compact />
          </div>
        </>
      ) : (
        <>
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `linear-gradient(45deg, ${design.accent} 0 1px, transparent 1px 24px)`,
            }}
          />
          <div className="absolute top-7 right-7 left-7 flex items-center justify-between border-b border-white/20 pb-4">
            <div className="text-xs font-bold tracking-[0.24em] uppercase">{SAMPLE.tenant}</div>
            <div className="text-[11px] font-semibold uppercase" style={{ color: design.accent }}>
              Verification
            </div>
          </div>
          <div className="absolute top-24 left-7 flex gap-6">
            <div className="grid h-32 w-32 place-items-center rounded-lg bg-white text-slate-950">
              {design.showQr ? <QrCode size={78} /> : null}
            </div>
            <div className="max-w-[310px] pt-3">
              <div className="text-sm font-bold tracking-[0.18em] uppercase">Scan to verify</div>
              <div className="mt-3 font-mono text-xs leading-5 text-white/70">
                beaconhs.app/verify/{SAMPLE.token}
              </div>
              <div
                className="mt-5 inline-flex rounded bg-white/10 px-3 py-1.5 font-mono text-xs"
                style={{ color: design.accent }}
              >
                {SAMPLE.token}
              </div>
            </div>
          </div>
          <div className="absolute right-7 bottom-7 left-7 border-t border-white/20 pt-4 text-[11px] leading-4 text-white/60">
            Issued by {SAMPLE.tenant}. Alteration voids the credential.
          </div>
        </>
      )}
    </div>
  )
}

function Meta({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'border-l border-black/10 px-4 first:border-l-0'}>
      <div className="text-[10px] font-bold tracking-[0.2em] text-slate-500 uppercase">{label}</div>
      <div className={compact ? 'mt-1 font-semibold text-slate-950' : 'mt-2 font-semibold'}>
        {value}
      </div>
    </div>
  )
}

function Signature({ label, color }: { label: string; color: string }) {
  return (
    <div className="w-56 text-center">
      <div className="h-px" style={{ backgroundColor: color }} />
      <div className="mt-2 text-[10px] font-bold tracking-[0.2em] text-slate-500 uppercase">
        {label}
      </div>
    </div>
  )
}

function Seal({ design, small }: { design: CredentialDesign; small?: boolean }) {
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center rounded-full border-[6px] bg-white font-bold shadow-lg',
        small ? 'h-16 w-16 text-sm' : 'h-28 w-28 text-2xl',
      )}
      style={{ borderColor: design.accent, color: design.primary }}
    >
      BH
    </div>
  )
}

function hexAlpha(amount: number): string {
  const hex = Math.max(0, Math.min(255, Math.round((amount / 100) * 255)))
    .toString(16)
    .padStart(2, '0')
  return hex
}
