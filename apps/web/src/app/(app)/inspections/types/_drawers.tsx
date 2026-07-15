'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Sub-entity drawer for the inspection types list page:
//   • new-type → create a new inspection type shell
//
// Opens via `?drawer=new-type` so it survives refresh + is link-shareable.
// The server action is passed in from the RSC list page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  Select,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'

const CADENCES = [
  { value: '', label: '— No default —' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
]

type CreateTypeAction = (input: {
  name: string
  description: string | null
  requiresForeman: boolean
  requiresCustomerSignature: boolean
  enableCorrectiveActions: boolean
  allowCompliantNotes: boolean
  isPublished: boolean
  defaultCadence: string | null
}) => Promise<{ ok: true; id: string } | { ok: false; error: string }>

export function InspectionTypesDrawers({
  openDrawer,
  closeHref,
  createTypeAction,
}: {
  openDrawer: 'new-type' | null
  closeHref: string
  createTypeAction: CreateTypeAction
}) {
  return (
    <NewTypeDrawer
      open={openDrawer === 'new-type'}
      closeHref={closeHref}
      action={createTypeAction}
    />
  )
}

function NewTypeDrawer({
  open,
  closeHref,
  action,
}: {
  open: boolean
  closeHref: string
  action: CreateTypeAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [defaultCadence, setDefaultCadence] = useState('')
  const [requiresForeman, setRequiresForeman] = useState(false)
  const [requiresCustomerSignature, setRequiresCustomerSignature] = useState(false)
  const [enableCorrectiveActions, setEnableCorrectiveActions] = useState(true)
  const [allowCompliantNotes, setAllowCompliantNotes] = useState(true)
  const [isPublished, setIsPublished] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    const trimmed = name.trim()
    if (!trimmed) {
      setError(tGenerated('m_1c66cb30434189'))
      return
    }
    startTransition(async () => {
      const res = await action({
        name: trimmed,
        description: description.trim() || null,
        defaultCadence: defaultCadence.trim() || null,
        requiresForeman,
        requiresCustomerSignature,
        enableCorrectiveActions,
        allowCompliantNotes,
        isPublished,
      })
      if (res.ok) {
        router.push(`/inspections/types/${res.id}`)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error || tGenerated('m_0ac365dcdc6dbd')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_13f748eec4ec4b')}
      description={tGenerated('m_00e94e5fcfa412')}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            <GeneratedValue
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedText id="m_043fe9fe859dff" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Alert variant="info">
          <AlertTitle>
            <GeneratedText id="m_187e0786ff1cc0" />
          </AlertTitle>
          <AlertDescription>
            <GeneratedText id="m_08c58ad46027b9" />
          </AlertDescription>
        </Alert>

        <div className="space-y-1.5">
          <Label htmlFor="it-name">
            <GeneratedText id="m_1a9978900838e6" />
          </Label>
          <Input
            id="it-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder={tGenerated('m_00a9c925dbf230')}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="it-description">
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea
            id="it-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
            placeholder={tGenerated('m_16b40b1c30abd7')}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="it-cadence">
              <GeneratedText id="m_058321201dc72d" />
            </Label>
            <Select
              id="it-cadence"
              value={defaultCadence}
              onChange={(e) => setDefaultCadence(e.currentTarget.value)}
            >
              <GeneratedValue
                value={CADENCES.map((c) => (
                  <option key={c.value} value={c.value}>
                    <GeneratedValue value={c.label} />
                  </option>
                ))}
              />
            </Select>
          </div>
          <div className="space-y-2 pt-7 text-sm">
            <Toggle
              checked={requiresForeman}
              onChange={setRequiresForeman}
              label={tGenerated('m_009aa82c778013')}
            />
            <Toggle
              checked={requiresCustomerSignature}
              onChange={setRequiresCustomerSignature}
              label={tGenerated('m_07085f507bc4a0')}
            />
            <Toggle
              checked={enableCorrectiveActions}
              onChange={setEnableCorrectiveActions}
              label={tGenerated('m_116e6aa3546258')}
            />
            <Toggle
              checked={allowCompliantNotes}
              onChange={setAllowCompliantNotes}
              label={tGenerated('m_00fd79d0912a73')}
            />
            <Toggle
              checked={isPublished}
              onChange={setIsPublished}
              label={tGenerated('m_0c88300e407074')}
            />
          </div>
        </div>

        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
      </div>
    </UrlDrawer>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      <span>
        <GeneratedValue value={label} />
      </span>
    </label>
  )
}
