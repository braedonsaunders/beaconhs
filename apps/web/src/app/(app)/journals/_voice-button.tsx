'use client'

// Voice dictation via the browser SpeechRecognition API (no data leaves the
// device). Renders nothing on unsupported browsers.

import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { cn } from '@beaconhs/ui'

type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> & {
          length: number
        }
      }) => void)
    | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

function getSR(): (new () => SR) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SR) | null
}

export function VoiceButton({
  onText,
  disabled,
  className,
}: {
  onText: (text: string) => void
  disabled?: boolean
  className?: string
}) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recRef = useRef<SR | null>(null)

  useEffect(() => {
    setSupported(getSR() !== null)
    return () => {
      try {
        recRef.current?.stop()
      } catch {
        /* noop */
      }
    }
  }, [])

  function toggle() {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const Ctor = getSR()
    if (!Ctor) return
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r && r.isFinal) {
          const t = r[0]?.transcript?.trim()
          if (t) onText(t.endsWith('.') ? `${t} ` : `${t}. `)
        }
      }
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  if (!supported) return null

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={listening ? 'Stop dictation' : 'Dictate'}
      aria-label={listening ? 'Stop dictation' : 'Dictate'}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
        listening
          ? 'animate-pulse border-red-300 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-400'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      {listening ? <Square size={14} /> : <Mic size={15} />}
    </button>
  )
}
