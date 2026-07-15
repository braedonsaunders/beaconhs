'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Nango self-serve connect. Mints a Connect session server-side, then opens
// Nango's hosted Connect UI (loaded from a version-pinned CDN asset) so the customer authorises their
// own account. Falls back to pasting a Connection ID if the UI can't load.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@beaconhs/ui'
import { finishNangoConnect, saveNangoModels, startNangoConnect } from '../_actions'

const ENTITY_LABELS: Record<string, string> = {
  people: 'People',
  org_unit: 'Locations & Projects',
  equipment: 'Equipment',
  contact: 'Contacts',
}

interface NangoClient {
  openConnectUI(opts: {
    sessionToken: string
    onEvent: (e: { type: string; payload?: { connectionId?: string } }) => void
  }): unknown
}

// Never load a floating npm tag in production. This exact SDK release is part
// of the reviewed application build even though the browser retrieves its ESM
// artifact on demand.
const NANGO_FRONTEND_URL = 'https://cdn.jsdelivr.net/npm/@nangohq/frontend@0.70.9/+esm'

export function NangoConnect({
  connectionId,
  connected,
  nangoConnectionId,
  integrationId,
  entities,
  initialModels,
}: {
  connectionId: string
  connected: boolean
  nangoConnectionId: string
  integrationId: string
  entities: string[]
  initialModels: Record<string, string>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [manualId, setManualId] = useState('')
  const [models, setModels] = useState<Record<string, string>>(() => ({ ...initialModels }))
  const [busy, setBusy] = useState(false)
  const [pending, startTransition] = useTransition()

  function link(connId: string) {
    startTransition(async () => {
      const res = await finishNangoConnect(connectionId, connId)
      if (res.ok) {
        toast.success(tGenerated('m_14694415556680'))
        router.refresh()
      } else toast.error(tGeneratedValue(res.error ?? tGenerated('m_16425027ace064')))
    })
  }

  async function connect() {
    if (!integrationId) {
      toast.error(tGenerated('m_14372ffec764d1'))
      return
    }
    setBusy(true)
    try {
      const res = await startNangoConnect(connectionId)
      if (!res.ok || !res.sessionToken) {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_075d1e1c691ee0')))
        return
      }
      const mod = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ NANGO_FRONTEND_URL
      )) as {
        default: new () => NangoClient
      }
      const nango = new mod.default()
      nango.openConnectUI({
        sessionToken: res.sessionToken,
        onEvent: (e) => {
          if (e.type === 'connect' && e.payload?.connectionId) link(e.payload.connectionId)
        },
      })
    } catch {
      toast.error(tGenerated('m_00ebc312a21e95'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedText id="m_107c39f5727c74" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          <GeneratedValue
            value={
              connected ? (
                <span className="text-emerald-700 dark:text-emerald-300">
                  <GeneratedText id="m_117ad39e228e60" />{' '}
                  <GeneratedValue value={nangoConnectionId} />
                </span>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_03e799a28eee9e" />
                </span>
              )
            }
          />
        </div>

        <div>
          <Button type="button" onClick={connect} disabled={busy}>
            <GeneratedValue
              value={
                busy ? (
                  <GeneratedText id="m_01944fa32440a0" />
                ) : connected ? (
                  <GeneratedText id="m_0db75283ded38f" />
                ) : (
                  <GeneratedText id="m_1cc1cf21d8c316" />
                )
              }
            />
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="manualId">
            <GeneratedText id="m_159cc3c3357e4d" />
          </Label>
          <div className="flex gap-2">
            <Input
              id="manualId"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder={tGenerated('m_04006b7d348c62')}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => manualId.trim() && link(manualId.trim())}
              disabled={pending}
            >
              <GeneratedText id="m_197fef09772e0d" />
            </Button>
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Label>
            <GeneratedText id="m_087380447dc002" />
          </Label>
          <GeneratedValue
            value={entities.map((e) => (
              <div key={e} className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-sm text-slate-600 dark:text-slate-300">
                  <GeneratedValue value={ENTITY_LABELS[e] ?? e} />
                </span>
                <Input
                  value={models[e] ?? ''}
                  onChange={(ev) => setModels((m) => ({ ...m, [e]: ev.target.value }))}
                  placeholder={tGenerated('m_10214959323aaf')}
                />
              </div>
            ))}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                startTransition(async () => {
                  const res = await saveNangoModels(connectionId, models)
                  if (res.ok) {
                    toast.success(tGenerated('m_0d5d7577132662'))
                    router.refresh()
                  } else toast.error(tGeneratedValue(res.error ?? tGenerated('m_0824d7cd907294')))
                })
              }
              disabled={pending}
            >
              <GeneratedText id="m_1fc4c6e3e32ea6" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
