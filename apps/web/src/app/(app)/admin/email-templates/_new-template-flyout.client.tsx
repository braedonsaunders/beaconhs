'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// "New template" trigger + slide-in Drawer form (the app's flyout pattern for
// create forms, mirroring the PDF-templates sibling). On submit it calls the
// createEmailTemplate action, closes, and refreshes the list.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button, Drawer, Input, Label, Select } from '@beaconhs/ui'
import { createEmailTemplate } from './_actions'

type SubjectOpt = { key: string; label: string }

export function NewEmailTemplateFlyout({
  modules,
  apps,
}: {
  modules: SubjectOpt[]
  apps: SubjectOpt[]
}) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      await createEmailTemplate(formData)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={14} /> <GeneratedText id="m_029927b6de38e7" />
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={tGenerated('m_029927b6de38e7')}
        size="md"
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">
              <GeneratedText id="m_1a9978900838e6" />
            </Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={200}
              placeholder={tGenerated('m_168c7270870b8b')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recordSubject">
              <GeneratedText id="m_0f9634263f05a3" />
            </Label>
            <Select id="recordSubject" name="recordSubject" required defaultValue="">
              <option value="" disabled>
                {'Choose a record type…'}
              </option>
              <optgroup label={tGenerated('m_1e649a5a75a0e0')}>
                {modules.map((s) => (
                  <option key={`module:${s.key}`} value={`module:${s.key}`}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              {apps.length > 0 ? (
                <optgroup label={tGenerated('m_0c770d55914bfa')}>
                  {apps.map((s) => (
                    <option key={`form_template:${s.key}`} value={`form_template:${s.key}`}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
            <p className="text-[11px] text-slate-400">
              <GeneratedText id="m_01d1bbc9241d07" />
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">
              <GeneratedText id="m_108b41637f364f" />
            </Label>
            <Select id="category" name="category" defaultValue="notification">
              <option value="general">{'General'}</option>
              <option value="notification">{'Notification'}</option>
              <option value="reminder">{'Reminder'}</option>
              <option value="approval">{'Approval'}</option>
              <option value="digest">{'Digest'}</option>
              <option value="marketing">{'Marketing'}</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              <GeneratedText id="m_112e2e8ecda428" />
            </Button>
            <Button type="submit" disabled={pending}>
              <Plus size={14} />{' '}
              <GeneratedValue
                value={
                  pending ? (
                    <GeneratedText id="m_14edc14616e78d" />
                  ) : (
                    <GeneratedText id="m_017309f0f9f564" />
                  )
                }
              />
            </Button>
          </div>
        </form>
      </Drawer>
    </>
  )
}
