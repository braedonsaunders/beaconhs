'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// In-UI sidebar editor. Org-wide, admin-only (gated by admin.nav.manage on the
// page + every server action). Lets an admin reorder / rename / re-icon / hide
// built-in modules, pin form templates as native-looking items, add custom
// links, and group it all — then save it for the whole workspace.
//
// Drag-and-drop via framer-motion's Reorder (already a dependency). Groups
// reorder among themselves; items reorder within a group (cross-group moves use
// the per-item "Move to group" picker). The edited shape is the raw
// TenantNavConfig — the resolver does permission filtering + form resolution at
// render time, so this editor stays a pure layout tool.

import { type ReactNode, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Reorder, useDragControls } from 'framer-motion'
import {
  Check,
  Eye,
  EyeOff,
  FolderPlus,
  GripVertical,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Drawer,
  Input,
  Label,
  SearchSelect,
} from '@beaconhs/ui'
import type { NavItemConfig, TenantNavConfig } from '@beaconhs/db/schema'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { ICON_KEYS, NavIcon } from '@/components/sidebar-nav'
import { NAV_MODULES, PINNED_FORM_DEFAULT_ICON, moduleByKey } from '@/lib/nav/registry'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { resetNavConfig, saveNavConfig } from './_actions'

type TemplateLite = {
  id: string
  name: string
  category: string | null
  iconKey: string | null
  status: string
}

// Editor-internal item carries an ephemeral uid for stable React keys + reorder
// identity (NavItemConfig has no natural id). Stripped on save.
type EItem = NavItemConfig & { uid: string }
type EGroup = { id: string; label: string; items: EItem[] }

function uid(prefix = 'i'): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

function toEditor(config: TenantNavConfig): EGroup[] {
  return config.groups.map((g) => ({
    id: g.id,
    label: g.label,
    items: g.items.map((it) => ({ ...it, uid: uid() })),
  }))
}

function fromEditor(groups: EGroup[]): TenantNavConfig {
  return {
    version: 1,
    groups: groups.map((g) => ({
      id: g.id,
      label: g.label,
      items: g.items.map(({ uid: _u, ...rest }) => rest),
    })),
  }
}

type Display = {
  label: string
  iconKey: string
  type: 'Module' | 'Form' | 'Link'
  sub: string
  missing: boolean
}

function displayFor(item: EItem, templatesById: Map<string, TemplateLite>): Display {
  if (item.kind === 'module') {
    const m = moduleByKey(item.moduleKey)
    return {
      label: item.label ?? m?.label ?? item.moduleKey,
      iconKey: item.iconKey ?? m?.iconKey ?? 'gauge',
      type: 'Module',
      sub: m?.href ?? `Unknown module · ${item.moduleKey}`,
      missing: !m,
    }
  }
  if (item.kind === 'form') {
    const t = templatesById.get(item.templateId)
    return {
      label: item.label ?? t?.name ?? 'Pinned form',
      iconKey: item.iconKey ?? t?.iconKey ?? PINNED_FORM_DEFAULT_ICON,
      type: 'Form',
      sub: t ? 'Pinned form' : 'Pinned form · template not found',
      missing: !t,
    }
  }
  return {
    label: item.label,
    iconKey: item.iconKey ?? 'link',
    type: 'Link',
    sub: item.href,
    missing: false,
  }
}

// ---------------------------------------------------------------------------

export function NavEditor({
  initialConfig,
  templates,
}: {
  initialConfig: TenantNavConfig
  templates: TemplateLite[]
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [groups, setGroups] = useState<EGroup[]>(() => toEditor(initialConfig))
  const [dirty, setDirty] = useState(false)
  const [pending, start] = useTransition()
  const [addTarget, setAddTarget] = useState<string | null>(null)
  const [resolvedTemplates, setResolvedTemplates] = useState(templates)

  const templatesById = useMemo(
    () => new Map(resolvedTemplates.map((template) => [template.id, template])),
    [resolvedTemplates],
  )

  function mutate(next: EGroup[]) {
    setGroups(next)
    setDirty(true)
  }

  const onReorderItems = (groupId: string, items: EItem[]) =>
    mutate(groups.map((g) => (g.id === groupId ? { ...g, items } : g)))
  const renameGroup = (groupId: string, label: string) =>
    mutate(groups.map((g) => (g.id === groupId ? { ...g, label } : g)))
  const removeGroup = (groupId: string) => {
    if (groups.length <= 1) {
      toast.error(tGenerated('m_110a472e15364d'))
      return
    }
    mutate(groups.filter((g) => g.id !== groupId))
  }
  const addGroup = () => mutate([...groups, { id: uid('grp'), label: 'New group', items: [] }])
  const patchItem = (groupId: string, u: string, patch: Partial<NavItemConfig>) =>
    mutate(
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              items: g.items.map((it) => (it.uid === u ? ({ ...it, ...patch } as EItem) : it)),
            }
          : g,
      ),
    )
  const removeItem = (groupId: string, u: string) =>
    mutate(
      groups.map((g) =>
        g.id === groupId ? { ...g, items: g.items.filter((it) => it.uid !== u) } : g,
      ),
    )
  const moveItem = (fromGroupId: string, u: string, toGroupId: string) => {
    if (fromGroupId === toGroupId) return
    const item = groups.find((g) => g.id === fromGroupId)?.items.find((it) => it.uid === u)
    if (!item) return
    mutate(
      groups.map((g) => {
        if (g.id === fromGroupId) return { ...g, items: g.items.filter((it) => it.uid !== u) }
        if (g.id === toGroupId) return { ...g, items: [...g.items, item] }
        return g
      }),
    )
    toast.success(tGenerated('m_0a27525f69a1a1'))
  }
  const addItem = (groupId: string, item: NavItemConfig) => {
    mutate(
      groups.map((g) =>
        g.id === groupId ? { ...g, items: [...g.items, { ...item, uid: uid() }] } : g,
      ),
    )
    setAddTarget(null)
  }

  const usedModuleKeys = useMemo(
    () =>
      new Set(
        groups
          .flatMap((g) => g.items)
          .filter((i): i is Extract<EItem, { kind: 'module' }> => i.kind === 'module')
          .map((i) => i.moduleKey),
      ),
    [groups],
  )
  const availableModules = useMemo(
    () => NAV_MODULES.filter((m) => !usedModuleKeys.has(m.key)),
    [usedModuleKeys],
  )

  function save() {
    start(async () => {
      const res = await saveNavConfig(fromEditor(groups))
      if (!res.ok) {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_084d4d5382264e')))
        return
      }
      toast.success(tGenerated('m_144ce43c8ff99b'))
      setDirty(false)
      router.refresh()
    })
  }
  async function reset() {
    if (
      !(await confirmDialog({
        message: 'Reset the sidebar to defaults? This removes all customisations.',
        tone: 'danger',
      }))
    )
      return
    start(async () => {
      // Rebuild client state from the returned defaults — `initialConfig` is
      // the stale pre-reset prop and router.refresh() does not remount us.
      const res = await resetNavConfig()
      toast.success(tGenerated('m_1f67de126c9538'))
      setGroups(toEditor(res.config))
      setDirty(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            <GeneratedText id="m_053fa0513af9ac" />
          </h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_08d3d05d78c2ba" />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GeneratedValue
            value={
              dirty ? (
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  <GeneratedText id="m_1175a27a9b33f7" />
                </span>
              ) : null
            }
          />
          <Button variant="outline" onClick={reset} disabled={pending}>
            <RotateCcw size={14} /> <GeneratedText id="m_1bd5864b59f5f2" />
          </Button>
          <Button onClick={save} disabled={pending || !dirty}>
            <Save size={14} />{' '}
            <GeneratedValue
              value={
                pending ? (
                  <GeneratedText id="m_106811f2aac664" />
                ) : (
                  <GeneratedText id="m_1ab9025ed1067c" />
                )
              }
            />
          </Button>
        </div>
      </header>

      <Alert variant="info">
        <Info size={16} />
        <AlertTitle>
          <GeneratedText id="m_1722cee51cb72b" />
        </AlertTitle>
        <AlertDescription>
          <GeneratedText id="m_0edd95fe2a818a" />
        </AlertDescription>
      </Alert>

      <Reorder.Group axis="y" values={groups} onReorder={mutate} as="div" className="space-y-4">
        <GeneratedValue
          value={groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              groups={groups}
              templatesById={templatesById}
              onReorderItems={(items) => onReorderItems(group.id, items)}
              onRenameGroup={(label) => renameGroup(group.id, label)}
              onRemoveGroup={() => removeGroup(group.id)}
              onAdd={() => setAddTarget(group.id)}
              onPatchItem={(u, patch) => patchItem(group.id, u, patch)}
              onRemoveItem={(u) => removeItem(group.id, u)}
              onMoveItem={(u, to) => moveItem(group.id, u, to)}
            />
          ))}
        />
      </Reorder.Group>

      <Button variant="outline" onClick={addGroup}>
        <FolderPlus size={15} /> <GeneratedText id="m_17f5673d4b9449" />
      </Button>

      <AddDrawer
        open={addTarget != null}
        onClose={() => setAddTarget(null)}
        availableModules={availableModules}
        onTemplateResolved={(template) =>
          setResolvedTemplates((current) =>
            current.some((candidate) => candidate.id === template.id)
              ? current
              : [...current, template],
          )
        }
        onAdd={(item) => addTarget && addItem(addTarget, item)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function GroupCard({
  group,
  groups,
  templatesById,
  onReorderItems,
  onRenameGroup,
  onRemoveGroup,
  onAdd,
  onPatchItem,
  onRemoveItem,
  onMoveItem,
}: {
  group: EGroup
  groups: EGroup[]
  templatesById: Map<string, TemplateLite>
  onReorderItems: (items: EItem[]) => void
  onRenameGroup: (label: string) => void
  onRemoveGroup: () => void
  onAdd: () => void
  onPatchItem: (u: string, patch: Partial<NavItemConfig>) => void
  onRemoveItem: (u: string) => void
  onMoveItem: (u: string, toGroupId: string) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={group}
      dragListener={false}
      dragControls={controls}
      as="div"
      className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <button
          type="button"
          aria-label={tGenerated('m_0b6106e20b65df')}
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none rounded p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
        >
          <GripVertical size={18} />
        </button>
        <Input
          value={group.label}
          onChange={(e) => onRenameGroup(e.target.value)}
          aria-label={tGenerated('m_1c636cc7ca34e0')}
          className="h-8 max-w-[18rem] border-transparent bg-transparent text-xs font-semibold tracking-wider text-slate-600 uppercase hover:border-slate-200 focus:border-slate-300 dark:text-slate-300 dark:hover:border-slate-700 dark:focus:border-slate-600"
        />
        <Badge variant="secondary" className="text-[10px]">
          <GeneratedValue value={group.items.length} />
        </Badge>
        <div className="ml-auto">
          <IconBtn title={tGenerated('m_1c97c9724f36ef')} onClick={onRemoveGroup}>
            <Trash2 size={15} className="text-rose-500" />
          </IconBtn>
        </div>
      </header>

      <div className="p-2">
        <GeneratedValue
          value={
            group.items.length === 0 ? (
              <p className="px-2 py-5 text-center text-xs text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_153621a4dc7020" />
              </p>
            ) : (
              <Reorder.Group
                axis="y"
                values={group.items}
                onReorder={onReorderItems}
                as="div"
                className="space-y-1.5"
              >
                <GeneratedValue
                  value={group.items.map((item) => (
                    <ItemRow
                      key={item.uid}
                      item={item}
                      display={displayFor(item, templatesById)}
                      groupId={group.id}
                      groups={groups}
                      onPatch={(patch) => onPatchItem(item.uid, patch)}
                      onRemove={() => onRemoveItem(item.uid)}
                      onMove={(to) => onMoveItem(item.uid, to)}
                    />
                  ))}
                />
              </Reorder.Group>
            )
          }
        />
        <button
          type="button"
          onClick={onAdd}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-teal-600 dark:hover:bg-teal-950/40 dark:hover:text-teal-300"
        >
          <Plus size={14} /> <GeneratedText id="m_0b8d1437a1693b" />
        </button>
      </div>
    </Reorder.Item>
  )
}

function ItemRow({
  item,
  display,
  groupId,
  groups,
  onPatch,
  onRemove,
  onMove,
}: {
  item: EItem
  display: Display
  groupId: string
  groups: EGroup[]
  onPatch: (patch: Partial<NavItemConfig>) => void
  onRemove: () => void
  onMove: (toGroupId: string) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const controls = useDragControls()
  const [editing, setEditing] = useState(false)
  const hidden = item.hidden ?? false
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      as="div"
      className={`rounded-lg border bg-white dark:bg-slate-900 ${hidden ? 'border-dashed border-slate-200 opacity-60 dark:border-slate-700' : 'border-slate-200 dark:border-slate-800'}`}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-label={tGenerated('m_0b04b904ce4f9a')}
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none rounded p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
        >
          <GripVertical size={16} />
        </button>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
          <NavIcon iconKey={display.iconKey} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
              <GeneratedValue value={display.label} />
            </span>
            <Badge variant="secondary" className="text-[10px]">
              <GeneratedValue value={display.type} />
            </Badge>
            <GeneratedValue
              value={
                hidden ? (
                  <Badge variant="outline" className="text-[10px]">
                    <GeneratedText id="m_01cb6961ee0ba3" />
                  </Badge>
                ) : null
              }
            />
            <GeneratedValue
              value={
                display.missing ? (
                  <Badge variant="destructive" className="text-[10px]">
                    <GeneratedText id="m_033d838430bc5f" />
                  </Badge>
                ) : null
              }
            />
          </div>
          <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">
            <GeneratedValue value={display.sub} />
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <IconBtn
            title={tGeneratedValue(
              hidden ? tGenerated('m_00fbddc6309531') : tGenerated('m_1b0073432893f9'),
            )}
            onClick={() => onPatch({ hidden: hidden ? undefined : true })}
          >
            <GeneratedValue value={hidden ? <EyeOff size={14} /> : <Eye size={14} />} />
          </IconBtn>
          <IconBtn
            title={tGenerated('m_03a66f9d34ac7b')}
            onClick={() => setEditing((s) => !s)}
            active={editing}
          >
            <Pencil size={14} />
          </IconBtn>
          <IconBtn title={tGenerated('m_1a9d8d971b1edb')} onClick={onRemove}>
            <Trash2 size={14} className="text-rose-500" />
          </IconBtn>
        </div>
      </div>

      <GeneratedValue
        value={
          editing ? (
            <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">
                    <GeneratedText id="m_14a897470e979c" />
                  </Label>
                  <Input
                    value={item.label ?? ''}
                    placeholder={tGeneratedValue(display.label)}
                    onChange={(e) => onPatch({ label: e.target.value || undefined })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    <GeneratedText id="m_158279b74f9a6e" />
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                      <NavIcon iconKey={display.iconKey} size={16} />
                    </span>
                    <SearchSelect
                      className="flex-1"
                      value={item.iconKey ?? ''}
                      onChange={(v) => onPatch({ iconKey: v || undefined })}
                      options={ICON_KEYS.map((k) => ({ value: k, label: k }))}
                      clearable
                      emptyLabel={tGenerated('m_1f7e78461783a1')}
                      placeholder={tGenerated('m_1f7e78461783a1')}
                      searchPlaceholder={tGenerated('m_0e50365bbb945f')}
                      sheetTitle="Pick an icon"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  <GeneratedText id="m_0d5780d08ac6d2" />
                </Label>
                <SearchSelect
                  value={groupId}
                  onChange={(v) => {
                    if (v && v !== groupId) onMove(v)
                  }}
                  options={groups.map((g) => ({ value: g.id, label: g.label }))}
                  sheetTitle="Move to group"
                />
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                  <Check size={14} /> <GeneratedText id="m_00609f822e0571" />
                </Button>
              </div>
            </div>
          ) : null
        }
      />
    </Reorder.Item>
  )
}

function AddDrawer({
  open,
  onClose,
  availableModules,
  onTemplateResolved,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  availableModules: typeof NAV_MODULES
  onTemplateResolved: (template: TemplateLite) => void
  onAdd: (item: NavItemConfig) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [linkLabel, setLinkLabel] = useState('')
  const [linkHref, setLinkHref] = useState('')

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={tGenerated('m_10117a1f68a720')}
      description={tGenerated('m_1d5547eeffd22b')}
    >
      <div className="space-y-7">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            <GeneratedText id="m_136300f8d7fbf6" />
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_058b15e39773b4" />
          </p>
          <RemoteSearchSelect
            lookup="admin-navigation-form-templates"
            value=""
            onChange={(v) => {
              if (v) onAdd({ kind: 'form', templateId: v })
            }}
            onOptionChange={(option) => {
              if (!option?.meta || option.meta.kind !== 'admin-navigation-template') return
              onTemplateResolved({
                id: option.value,
                name: option.label,
                category: option.meta.category,
                iconKey: option.meta.iconKey,
                status: option.meta.status,
              })
            }}
            placeholder={tGenerated('m_0ccf5fd06050bc')}
            searchPlaceholder={tGenerated('m_14d56f6fc82486')}
            sheetTitle="Pin a form"
            ariaLabel="Pin a form"
            clearable={false}
          />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            <GeneratedText id="m_17cb5cf4c51d20" />
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_03469245a2081d" />
          </p>
          <SearchSelect
            value=""
            onChange={(v) => {
              if (v) onAdd({ kind: 'module', moduleKey: v })
            }}
            options={availableModules.map((m) => ({ value: m.key, label: m.label, hint: m.group }))}
            placeholder={tGeneratedValue(
              availableModules.length
                ? tGenerated('m_03241b80e9fcca')
                : tGenerated('m_033568c3c9b473'),
            )}
            searchPlaceholder={tGenerated('m_0adb88307522d5')}
            sheetTitle="Add a module"
          />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            <GeneratedText id="m_1d263676dcbef2" />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">
                <GeneratedText id="m_1d088977412efb" />
              </Label>
              <Input
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder={tGenerated('m_15d0d39e1a0a34')}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                <GeneratedText id="m_17d7f8e3d48e5e" />
              </Label>
              <Input
                value={linkHref}
                onChange={(e) => setLinkHref(e.target.value)}
                placeholder={tGenerated('m_0f00e77a0a91f9')}
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!linkLabel.trim() || !linkHref.trim()}
            onClick={() => {
              onAdd({ kind: 'link', label: linkLabel.trim(), href: linkHref.trim() })
              setLinkLabel('')
              setLinkHref('')
            }}
          >
            <Plus size={14} /> <GeneratedText id="m_16e1f414591109" />
          </Button>
        </section>
      </div>
    </Drawer>
  )
}

function IconBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      title={tGeneratedValue(title)}
      onClick={onClick}
      className={`rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
        active ? 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200' : ''
      }`}
    >
      <GeneratedValue value={children} />
    </button>
  )
}
