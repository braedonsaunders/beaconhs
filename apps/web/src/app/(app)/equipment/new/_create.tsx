'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@beaconhs/ui'
import { createEquipmentDraft } from '../_draft-actions'

export function CreateEquipment() {
  const tGenerated = useGeneratedTranslations()

  const router = useRouter()
  const request = useRef<Promise<Awaited<ReturnType<typeof createEquipmentDraft>>> | null>(null)
  const draftId = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const key = 'beacon-equipment-create'
    let id = draftId.current ?? crypto.randomUUID()
    try {
      id = sessionStorage.getItem(key) ?? id
      sessionStorage.setItem(key, id)
    } catch {}
    draftId.current = id
    const creation = request.current ?? createEquipmentDraft(id)
    request.current = creation
    void creation
      .then((result) => {
        if (!active) return
        if (!result.ok) {
          setError(result.error)
          request.current = null
          return
        }
        try {
          sessionStorage.removeItem(key)
        } catch {}
        router.replace(`/equipment/${result.id}`)
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not create equipment.')
          request.current = null
        }
      })
    return () => {
      active = false
    }
  }, [router, attempt])
  return (
    <div role="status" className="p-6 text-sm">
      {error ? (
        <>
          <p role="alert" className="mb-3 text-rose-600 dark:text-rose-400">
            {error}
          </p>
          <Button
            onClick={() => {
              setError(null)
              setAttempt((value) => value + 1)
            }}
          >
            <GeneratedText id="m_02941fb09831c6" />
          </Button>
        </>
      ) : (
        tGenerated('m_1a04081fd095cd')
      )}
    </div>
  )
}
