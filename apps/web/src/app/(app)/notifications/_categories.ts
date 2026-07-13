// Presentational metadata for notification categories — the "tags" that become
// folders in the Outlook-style rail. Categories are free-form text in the DB, so
// unknown keys fall back to a humanised label, a bell icon and a neutral tint.

import {
  AlertTriangle,
  Bell,
  BookOpen,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FlaskConical,
  GraduationCap,
  HardHat,
  Radio,
  Settings,
  ShieldCheck,
  TrendingUp,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

const LABELS: Record<string, string> = {
  ca: 'Corrective Actions',
  corrective_actions: 'Corrective Actions',
  capa: 'CAPA',
  ppe: 'PPE',
  sds: 'SDS',
  kpi: 'KPI',
  wah: 'Work at Height',
  lone_worker: 'Lone Worker',
  monitored_session: 'Monitored Sessions',
  cross_module: 'Cross-module',
  toolbox_talk: 'Toolbox Talk',
  site_inspection: 'Site Inspection',
}

const ICONS: Record<string, LucideIcon> = {
  incident: AlertTriangle,
  incidents: AlertTriangle,
  ca: Wrench,
  corrective_actions: Wrench,
  capa: Wrench,
  training: GraduationCap,
  document: FileText,
  documents: FileText,
  compliance: ShieldCheck,
  lone_worker: Radio,
  monitored_session: Radio,
  ppe: HardHat,
  equipment: Boxes,
  journal: BookOpen,
  forms: ClipboardList,
  inspections: ClipboardCheck,
  site_inspection: ClipboardCheck,
  kpi: TrendingUp,
  report: TrendingUp,
  system: Settings,
  sds: FlaskConical,
  vehicle: Truck,
}

type Tint = { bg: string; fg: string }

const TINTS: Record<string, Tint> = {
  incident: { bg: 'bg-rose-100 dark:bg-rose-950/40', fg: 'text-rose-600 dark:text-rose-300' },
  incidents: { bg: 'bg-rose-100 dark:bg-rose-950/40', fg: 'text-rose-600 dark:text-rose-300' },
  ca: { bg: 'bg-amber-100 dark:bg-amber-950/40', fg: 'text-amber-600 dark:text-amber-300' },
  corrective_actions: {
    bg: 'bg-amber-100 dark:bg-amber-950/40',
    fg: 'text-amber-600 dark:text-amber-300',
  },
  capa: { bg: 'bg-amber-100 dark:bg-amber-950/40', fg: 'text-amber-600 dark:text-amber-300' },
  training: {
    bg: 'bg-violet-100 dark:bg-violet-950/40',
    fg: 'text-violet-600 dark:text-violet-300',
  },
  document: { bg: 'bg-sky-100 dark:bg-sky-950/40', fg: 'text-sky-600 dark:text-sky-300' },
  documents: { bg: 'bg-sky-100 dark:bg-sky-950/40', fg: 'text-sky-600 dark:text-sky-300' },
  compliance: { bg: 'bg-teal-100 dark:bg-teal-950/40', fg: 'text-teal-600 dark:text-teal-300' },
  lone_worker: {
    bg: 'bg-orange-100 dark:bg-orange-950/40',
    fg: 'text-orange-600 dark:text-orange-300',
  },
  monitored_session: {
    bg: 'bg-orange-100 dark:bg-orange-950/40',
    fg: 'text-orange-600 dark:text-orange-300',
  },
  ppe: { bg: 'bg-lime-100 dark:bg-lime-950/40', fg: 'text-lime-600 dark:text-lime-300' },
  equipment: { bg: 'bg-cyan-100 dark:bg-cyan-950/40', fg: 'text-cyan-600 dark:text-cyan-300' },
  journal: {
    bg: 'bg-indigo-100 dark:bg-indigo-950/40',
    fg: 'text-indigo-600 dark:text-indigo-300',
  },
  inspections: {
    bg: 'bg-emerald-100 dark:bg-emerald-950/40',
    fg: 'text-emerald-600 dark:text-emerald-300',
  },
  site_inspection: {
    bg: 'bg-emerald-100 dark:bg-emerald-950/40',
    fg: 'text-emerald-600 dark:text-emerald-300',
  },
}

const DEFAULT_TINT: Tint = {
  bg: 'bg-slate-100 dark:bg-slate-800',
  fg: 'text-slate-500 dark:text-slate-300',
}

type CategoryMeta = { key: string; label: string; Icon: LucideIcon; bg: string; fg: string }

const humanise = (key: string) =>
  key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')

export function categoryMeta(key: string): CategoryMeta {
  const tint = TINTS[key] ?? DEFAULT_TINT
  return {
    key,
    label: LABELS[key] ?? humanise(key),
    Icon: ICONS[key] ?? Bell,
    bg: tint.bg,
    fg: tint.fg,
  }
}
