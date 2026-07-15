'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Per-device Web Push enrolment. Distinct from the category × channel matrix
// below it: that decides *which* notifications route to the push channel; this
// card grants OS permission and registers *this browser/device* to receive
// them. Subscription state lives in the browser (pushManager.getSubscription),
// mirrored server-side in webpush_subscriptions via push-actions.ts.
//
// iOS/iPadOS only exposes the Push API to apps installed to the Home Screen, so
// a Safari tab gets Add-to-Home-Screen guidance instead of an enable button.

import { useEffect, useState } from 'react'
import { BellOff, BellRing, Check, Loader2, RotateCw, Send, Share, Smartphone } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { removePushSubscription, savePushSubscription, sendTestPush } from './push-actions'

type Status = 'loading' | 'unsupported' | 'ios-install' | 'blocked' | 'idle' | 'subscribed'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ reports a desktop UA, so fall back to the touch-Mac heuristic.
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [status, setStatus] = useState<Status>('loading')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function detect() {
      const supported =
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      if (!supported) {
        // On iOS the Push API only exists inside an installed PWA — steer the
        // user to the Home Screen rather than calling it unsupported.
        const next = isIos() && !isStandalone() ? 'ios-install' : 'unsupported'
        if (!cancelled) setStatus(next)
        return
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setStatus('blocked')
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled) setStatus(sub ? 'subscribed' : 'idle')
      } catch {
        if (!cancelled) setStatus('idle')
      }
    }
    void detect()
    return () => {
      cancelled = true
    }
  }, [])

  async function enable() {
    if (!vapidPublicKey) {
      toast.error(tGenerated('m_1a9433db6ab8ec'))
      return
    }
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'idle')
        if (permission === 'denied') {
          toast.error(tGenerated('m_008d6cbc66114d'))
        }
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
      const json = sub.toJSON() as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
      }
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        await sub.unsubscribe().catch(() => {})
        toast.error(tGenerated('m_15ecd60fb99b5b'))
        return
      }
      const res = await savePushSubscription({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent.slice(0, 512),
      })
      if (res.ok) {
        setStatus('subscribed')
        toast.success(tGenerated('m_03b10f2aec79b8'))
      } else {
        await sub.unsubscribe().catch(() => {})
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0cf0e78e0807bc')))
      }
    } catch (err) {
      console.warn('[pwa] push subscribe failed:', err)
      toast.error(tGenerated('m_10a53fca470f10'))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      const endpoint = sub?.endpoint
      if (sub) await sub.unsubscribe().catch(() => {})
      if (endpoint) await removePushSubscription({ endpoint })
      setStatus('idle')
      toast.success(tGenerated('m_06bbcabdd8bff0'))
    } catch (err) {
      console.warn('[pwa] push unsubscribe failed:', err)
      toast.error(tGenerated('m_15dc78f8ecc56e'))
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setTesting(true)
    try {
      const res = await sendTestPush()
      if (res.ok) {
        toast.success(
          tGenerated('m_09107121b21a42', { value0: res.sent, value1: res.sent === 1 ? '' : 's' }),
        )
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0afa5e0f3d14ad')))
      }
    } finally {
      setTesting(false)
    }
  }

  const description: Record<Status, string> = {
    loading: 'Checking notification status on this device…',
    unsupported: "This browser doesn't support push notifications.",
    'ios-install': 'iOS delivers push notifications only to apps added to the Home Screen.',
    blocked:
      'Notifications are blocked for this site. Enable them in your browser or system settings, then reload this page.',
    idle: "Get incidents, overdue actions, and escalations on this device even when BeaconHS isn't open.",
    subscribed:
      'This device receives push notifications, routed by your per-category choices below.',
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <GeneratedValue
            value={status === 'ios-install' ? <Smartphone size={18} /> : <BellRing size={18} />}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_0701db2335ff0b" />
            </h3>
            <GeneratedValue
              value={
                status === 'subscribed' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                    <Check size={11} /> <GeneratedText id="m_0738c9c7544385" />
                  </span>
                ) : null
              }
            />
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            <GeneratedValue value={description[status]} />
          </p>

          <GeneratedValue
            value={
              status === 'ios-install' ? (
                <ol className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                  <li className="flex items-center gap-2">
                    <span className="text-slate-400 dark:text-slate-500">1.</span>
                    <GeneratedText id="m_02cd6a2738a890" />
                    <Share size={15} className="text-slate-500 dark:text-slate-400" />
                    <GeneratedText id="m_0b8b304a0c5c91" />
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-slate-400 dark:text-slate-500">2.</span>
                    <GeneratedText id="m_0a815ce0e3baca" />{' '}
                    <span className="font-medium">
                      <GeneratedText id="m_1d4c2089835b29" />
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-slate-400 dark:text-slate-500">3.</span>
                    <GeneratedText id="m_09acfe5d71409a" />
                  </li>
                </ol>
              ) : null
            }
          />

          <GeneratedValue
            value={
              status === 'idle' ? (
                <div className="mt-3">
                  <Button type="button" onClick={enable} disabled={busy}>
                    <GeneratedValue
                      value={
                        busy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <BellRing size={14} />
                        )
                      }
                    />
                    <GeneratedText id="m_180a0f9bd0af49" />
                  </Button>
                </div>
              ) : null
            }
          />

          <GeneratedValue
            value={
              status === 'subscribed' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" onClick={test} disabled={testing || busy}>
                    <GeneratedValue
                      value={
                        testing ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Send size={14} />
                        )
                      }
                    />
                    <GeneratedText id="m_1b23b0c7c5c899" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={disable}
                    disabled={busy || testing}
                  >
                    <GeneratedValue
                      value={
                        busy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <BellOff size={14} />
                        )
                      }
                    />
                    <GeneratedText id="m_18257299c963a9" />
                  </Button>
                </div>
              ) : null
            }
          />

          <GeneratedValue
            value={
              status === 'blocked' ? (
                <div className="mt-3">
                  <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                    <RotateCw size={14} />
                    <GeneratedText id="m_19e1952e7364a8" />
                  </Button>
                </div>
              ) : null
            }
          />
        </div>
      </div>
    </div>
  )
}
