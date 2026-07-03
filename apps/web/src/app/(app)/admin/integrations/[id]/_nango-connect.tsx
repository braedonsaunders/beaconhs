'use client'

// Nango self-serve connect. Mints a Connect session server-side, then opens
// Nango's hosted Connect UI (loaded from CDN) so the customer authorises their
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
}

interface NangoClient {
  openConnectUI(opts: {
    sessionToken: string
    onEvent: (e: { type: string; payload?: { connectionId?: string } }) => void
  }): unknown
}

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
  const router = useRouter()
  const [manualId, setManualId] = useState('')
  const [models, setModels] = useState<Record<string, string>>(() => ({ ...initialModels }))
  const [busy, setBusy] = useState(false)
  const [pending, startTransition] = useTransition()

  function link(connId: string) {
    startTransition(async () => {
      const res = await finishNangoConnect(connectionId, connId)
      if (res.ok) {
        toast.success('Source linked.')
        router.refresh()
      } else toast.error(res.error ?? 'Link failed.')
    })
  }

  async function connect() {
    if (!integrationId) {
      toast.error('Set a Nango integration ID and save settings first.')
      return
    }
    setBusy(true)
    try {
      const res = await startNangoConnect(connectionId)
      if (!res.ok || !res.sessionToken) {
        toast.error(res.error ?? 'Could not start Nango connect.')
        return
      }
      const url = 'https://cdn.jsdelivr.net/npm/@nangohq/frontend@latest/+esm'
      const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as {
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
      toast.error('Could not load the Nango Connect UI. Paste a Connection ID below instead.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Source connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          {connected ? (
            <span className="text-emerald-700 dark:text-emerald-300">
              Connected · {nangoConnectionId}
            </span>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">Not connected yet.</span>
          )}
        </div>

        <div>
          <Button type="button" onClick={connect} disabled={busy}>
            {busy ? 'Opening…' : connected ? 'Reconnect a source' : 'Connect a source'}
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="manualId">Or paste a Connection ID</Label>
          <div className="flex gap-2">
            <Input
              id="manualId"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder="connection id from your Nango dashboard"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => manualId.trim() && link(manualId.trim())}
              disabled={pending}
            >
              Link
            </Button>
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Label>Map entities to Nango models</Label>
          {entities.map((e) => (
            <div key={e} className="flex items-center gap-2">
              <span className="w-40 shrink-0 text-sm text-slate-600 dark:text-slate-300">
                {ENTITY_LABELS[e] ?? e}
              </span>
              <Input
                value={models[e] ?? ''}
                onChange={(ev) => setModels((m) => ({ ...m, [e]: ev.target.value }))}
                placeholder="e.g. Employee"
              />
            </div>
          ))}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                startTransition(async () => {
                  const res = await saveNangoModels(connectionId, models)
                  if (res.ok) {
                    toast.success('Models saved.')
                    router.refresh()
                  } else toast.error(res.error ?? 'Save failed.')
                })
              }
              disabled={pending}
            >
              Save models
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
