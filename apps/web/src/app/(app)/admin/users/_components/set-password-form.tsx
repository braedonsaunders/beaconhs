'use client'

// Admin-set password form. Client-side only for the ergonomics — generate a
// strong password, show/hide, copy, and confirm-match — then it posts to the
// `setMemberPassword` server action, which re-validates length + match.

import { useState } from 'react'
import { Button, Input, Label } from '@beaconhs/ui'
import { setMemberPassword } from '../_actions'

// Ambiguous characters (0/O, 1/l/I) left out so a copied temp password is easy
// to read aloud or type if needed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*'

function generatePassword(length = 16): string {
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const n of bytes) out += ALPHABET[n % ALPHABET.length]
  return out
}

export function SetPasswordForm({ membershipId }: { membershipId: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [revoke, setRevoke] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tooShort = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit = password.length >= 8 && password === confirm

  function fill() {
    const pw = generatePassword()
    setPassword(pw)
    setConfirm(pw)
    setShow(true)
    setError(null)
    setCopied(false)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (e.g. insecure context) — the value is visible to copy manually.
    }
  }

  function onSubmit(e: React.FormEvent) {
    if (password.length < 8) {
      e.preventDefault()
      setError('Password must be at least 8 characters.')
    } else if (password !== confirm) {
      e.preventDefault()
      setError('Passwords do not match.')
    }
  }

  return (
    <form action={setMemberPassword} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            aria-invalid={tooShort}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value)
              setError(null)
            }}
            aria-invalid={mismatch}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="text-slate-600 hover:underline dark:text-slate-300"
        >
          {show ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          onClick={fill}
          className="text-teal-700 hover:underline dark:text-teal-400"
        >
          Generate strong password
        </button>
        {password ? (
          <button
            type="button"
            onClick={copy}
            className="text-slate-600 hover:underline dark:text-slate-300"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : null}
        {tooShort ? (
          <span className="text-red-600 dark:text-red-400">At least 8 characters</span>
        ) : null}
        {mismatch ? (
          <span className="text-red-600 dark:text-red-400">Passwords don&apos;t match</span>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          name="revokeSessions"
          checked={revoke}
          onChange={(e) => setRevoke(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800"
        />
        Sign out the member&apos;s existing sessions
      </label>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          Set password
        </Button>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          You&apos;ll need to share this password with the member directly.
        </p>
      </div>
    </form>
  )
}
