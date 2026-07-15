'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Sub-entity drawer for the PPE register:
//   • issue → register a new PPE item and (optionally) issue it to a person
//
// Opens via `?drawer=issue` so it survives refresh + is link-shareable. The
// register-and-issue server action is passed in from the RSC list page. Person
// blank ⇒ the item just lands in stock; otherwise it's issued in the same step.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  SearchSelect,
  Select,
  Textarea,
  UrlDrawer,
  type SelectOption,
} from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'

type PpeDrawerType = {
  id: string
  name: string
  category: string | null
  sizingScheme: string[] | null
}

type IssueAction = (input: {
  typeId: string
  serialNumber?: string | null
  size?: string | null
  purchaseDate?: string | null
  expiresOn?: string | null
  notes?: string | null
  personId?: string | null
  note?: string | null
}) => Promise<{ ok: true; id: string; issued: boolean } | { ok: false; error: string }>

export function PpeDrawers({
  openDrawer,
  closeHref,
  types,
  issueAction,
}: {
  openDrawer: 'issue' | null
  closeHref: string
  types: PpeDrawerType[]
  issueAction: IssueAction
}) {
  return (
    <IssueDrawer
      open={openDrawer === 'issue'}
      closeHref={closeHref}
      types={types}
      action={issueAction}
    />
  )
}

function IssueDrawer({
  open,
  closeHref,
  types,
  action,
}: {
  open: boolean
  closeHref: string
  types: PpeDrawerType[]
  action: IssueAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [typeId, setTypeId] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [size, setSize] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [notes, setNotes] = useState('')
  const [personId, setPersonId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!typeId) {
      setError(tGenerated('m_022ec7a2f10f4b'))
      return
    }
    startTransition(async () => {
      const res = await action({
        typeId,
        serialNumber: serialNumber.trim() || null,
        size: size.trim() || null,
        purchaseDate: purchaseDate || null,
        expiresOn: expiresOn || null,
        notes: notes.trim() || null,
        personId: personId || null,
        note: note.trim() || null,
      })
      if (res.ok) {
        router.push(`/ppe/${res.id}`)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error))
      }
    })
  }

  const typeOptions: SelectOption[] = types.map((t) => ({
    value: t.id,
    label: t.name,
    hint: t.category ? t.category.replace(/_/g, ' ') : undefined,
  }))

  // Types with a configured sizing scheme get a dropdown of their valid sizes;
  // everything else stays free text.
  const sizingScheme = types.find((t) => t.id === typeId)?.sizingScheme ?? null
  const sizeOptions = sizingScheme && sizingScheme.length > 0 ? sizingScheme : null

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_14d0f6a29a2597')}
      description={tGenerated('m_1b620b8a81380f')}
      size="md"
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
          <Button type="button" onClick={submit} disabled={pending || !typeId}>
            <GeneratedValue
              value={
                pending ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <UserPlus size={14} className="mr-1.5" />
                )
              }
            />
            <GeneratedValue
              value={
                personId ? (
                  <GeneratedText id="m_1bf5a074ef3e26" />
                ) : (
                  <GeneratedText id="m_0b80df3186fa9a" />
                )
              }
            />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_08e32bb4e625a8" />
          </Label>
          <SearchSelect
            value={typeId}
            onChange={(next) => {
              setTypeId(next)
              // A different type may have a different sizing scheme.
              setSize('')
            }}
            options={typeOptions}
            placeholder={tGenerated('m_034a12ae110edb')}
            searchPlaceholder={tGenerated('m_116a037295ed53')}
            sheetTitle="Select a PPE type"
            clearable={false}
          />
          <GeneratedValue
            value={
              types.length === 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <GeneratedText id="m_09da41907891bc" />
                </p>
              ) : null
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pi-serial">
              <GeneratedText id="m_0ff1343b241439" />
            </Label>
            <Input
              id="pi-serial"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.currentTarget.value)}
              placeholder={tGenerated('m_069c786552daed')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pi-size">
              <GeneratedText id="m_11ad4bbeced31b" />
            </Label>
            <GeneratedValue
              value={
                sizeOptions ? (
                  <Select
                    id="pi-size"
                    value={size}
                    onChange={(e) => setSize(e.currentTarget.value)}
                  >
                    <option value="">{'— No size —'}</option>
                    {sizeOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id="pi-size"
                    value={size}
                    onChange={(e) => setSize(e.currentTarget.value)}
                    placeholder={tGenerated('m_03e655a90f63bb')}
                  />
                )
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pi-purchase">
              <GeneratedText id="m_0c895e284365aa" />
            </Label>
            <Input
              id="pi-purchase"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pi-expires">
              <GeneratedText id="m_001b29133dcb72" />
            </Label>
            <Input
              id="pi-expires"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pi-notes">
            <GeneratedText id="m_0b8dadcb78cd08" />
          </Label>
          <Textarea
            id="pi-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder={tGenerated('m_109acff0d80cf1')}
          />
        </div>

        <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0e6c93268e8a38" />
            </Label>
            <RemoteSearchSelect
              lookup="ppe-active-people"
              value={personId}
              onChange={setPersonId}
              placeholder={tGenerated('m_0f5efe4fcca38f')}
              searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
              sheetTitle="Issue to a person"
              clearable
              emptyLabel={tGenerated('m_0690561bb866de')}
            />
          </div>
          <GeneratedValue
            value={
              personId ? (
                <div className="space-y-1.5">
                  <Label htmlFor="pi-note">
                    <GeneratedText id="m_1f1b7fe0457e9a" />
                  </Label>
                  <Input
                    id="pi-note"
                    value={note}
                    onChange={(e) => setNote(e.currentTarget.value)}
                    placeholder={tGenerated('m_0bf12343056455')}
                  />
                </div>
              ) : null
            }
          />
        </div>

        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
      </div>
    </UrlDrawer>
  )
}
