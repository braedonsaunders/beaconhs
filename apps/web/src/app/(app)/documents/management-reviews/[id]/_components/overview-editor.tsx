'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea } from '@beaconhs/ui'
import { Section } from '@/components/section'
import { ParticipantsEditor } from './participants-editor'
import { updateReviewMeta } from '../actions'

type Initial = {
  title: string
  periodStart: string
  periodEnd: string
  nextReviewOn: string
  discussionNotes: string
  decisions: string
  participants: string[]
}

export function OverviewEditor({
  reviewId,
  initial,
  members,
}: {
  reviewId: string
  initial: Initial
  members: { id: string; label: string }[]
}) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [title, setTitle] = useState(initial.title)
  const [periodStart, setPeriodStart] = useState(initial.periodStart)
  const [periodEnd, setPeriodEnd] = useState(initial.periodEnd)
  const [nextReviewOn, setNextReviewOn] = useState(initial.nextReviewOn)
  const [discussionNotes, setDiscussionNotes] = useState(initial.discussionNotes)
  const [decisions, setDecisions] = useState(initial.decisions)
  const [participants, setParticipants] = useState<string[]>(initial.participants)

  function save() {
    start(async () => {
      await updateReviewMeta(reviewId, {
        title: title.trim(),
        periodStart: periodStart || null,
        periodEnd,
        nextReviewOn: nextReviewOn || null,
        discussionNotes: discussionNotes.trim() || null,
        decisions: decisions.trim() || null,
        participants,
      })
      router.refresh()
    })
  }

  return (
    <Section title={tGenerated('m_1c267da9085447')}>
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0decefd558c355" />
          </Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_13b07f79ffcc5e" />
            </Label>
            <Input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1a5fe1aab6fc42" />
            </Label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0f6a9235679934" />
            </Label>
            <Input
              type="date"
              value={nextReviewOn}
              onChange={(e) => setNextReviewOn(e.target.value)}
            />
          </div>
        </div>

        <ParticipantsEditor members={members} value={participants} onChange={setParticipants} />

        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_03daa461b09c21" />
          </Label>
          <Textarea
            rows={5}
            value={discussionNotes}
            onChange={(e) => setDiscussionNotes(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1c33c753a806d2" />
          </Label>
          <Textarea rows={4} value={decisions} onChange={(e) => setDecisions(e.target.value)} />
        </div>

        <div className="flex justify-end">
          <Button type="button" disabled={pending} onClick={save}>
            <GeneratedValue
              value={
                pending ? (
                  <GeneratedText id="m_106811f2aac664" />
                ) : (
                  <GeneratedText id="m_197d94e8e1ad78" />
                )
              }
            />
          </Button>
        </div>
      </div>
    </Section>
  )
}
