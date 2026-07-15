'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from '@beaconhs/auth/client'
import { Alert, AlertDescription, Button, Input, Label } from '@beaconhs/ui'

type Mode = 'password' | 'magic'

export function LoginForm() {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(tGeneratedValue(null))
    setInfo(null)
    start(async () => {
      try {
        if (mode === 'password') {
          const result = await signIn.email({ email, password })
          if ('error' in result && result.error) {
            setError(tGeneratedValue(result.error.message ?? tGenerated('m_123c64572b4068')))
            return
          }
          router.replace('/auth/continue')
        } else {
          const result = await signIn.magicLink({ email, callbackURL: '/auth/continue' })
          if ('error' in result && result.error) {
            setError(tGeneratedValue(result.error.message ?? tGenerated('m_18431d16dad9e6')))
            return
          }
          setInfo('Check your email for a sign-in link.')
        }
      } catch (err) {
        setError(
          tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_123c64572b4068')),
        )
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex gap-2 rounded-md border border-slate-200 bg-white p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode('password')}
          className={`flex-1 rounded px-3 py-1 ${mode === 'password' ? 'bg-slate-100 font-medium' : 'text-slate-600'}`}
        >
          <GeneratedText id="m_155d0bdc9a243f" />
        </button>
        <button
          type="button"
          onClick={() => setMode('magic')}
          className={`flex-1 rounded px-3 py-1 ${mode === 'magic' ? 'bg-slate-100 font-medium' : 'text-slate-600'}`}
        >
          <GeneratedText id="m_086c6ef3266fa4" />
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">
          <GeneratedText id="m_00a0ba9938bdff" />
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <GeneratedValue
        value={
          mode === 'password' ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">
                  <GeneratedText id="m_155d0bdc9a243f" />
                </Label>
                <Link href="/forgot-password" className="text-xs text-teal-700 hover:underline">
                  <GeneratedText id="m_0f435be138c0e6" />
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          error ? (
            <Alert variant="destructive">
              <AlertDescription>
                <GeneratedValue value={error} />
              </AlertDescription>
            </Alert>
          ) : null
        }
      />
      <GeneratedValue
        value={
          info ? (
            <Alert variant="success">
              <AlertDescription>
                <GeneratedValue value={info} />
              </AlertDescription>
            </Alert>
          ) : null
        }
      />

      <Button type="submit" className="w-full" disabled={pending}>
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_09001dc89c0edf" />
            ) : mode === 'password' ? (
              <GeneratedText id="m_1d1210bb1b1dca" />
            ) : (
              <GeneratedText id="m_1591a4310c73e0" />
            )
          }
        />
      </Button>
    </form>
  )
}
