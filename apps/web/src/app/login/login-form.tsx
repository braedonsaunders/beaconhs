'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from '@beaconhs/auth/client'
import { Alert, AlertDescription, Button, Input, Label } from '@beaconhs/ui'

type Mode = 'password' | 'magic'

export function LoginForm() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    start(async () => {
      try {
        if (mode === 'password') {
          const result = await signIn.email({ email, password })
          if ('error' in result && result.error) {
            setError(result.error.message ?? 'Sign-in failed')
            return
          }
          router.replace('/dashboard')
        } else {
          const result = await signIn.magicLink({ email, callbackURL: '/dashboard' })
          if ('error' in result && result.error) {
            setError(result.error.message ?? 'Could not send magic link')
            return
          }
          setInfo('Check your email for a sign-in link.')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sign-in failed')
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
          Password
        </button>
        <button
          type="button"
          onClick={() => setMode('magic')}
          className={`flex-1 rounded px-3 py-1 ${mode === 'magic' ? 'bg-slate-100 font-medium' : 'text-slate-600'}`}
        >
          Magic link
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {mode === 'password' ? (
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Working…' : mode === 'password' ? 'Sign in' : 'Send magic link'}
      </Button>
    </form>
  )
}
