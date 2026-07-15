'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// "New PDF template" trigger + slide-in Drawer form (matches the app's flyout
// pattern for create forms). On submit it calls the createPdfTemplate action,
// closes, and refreshes the list.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button, Drawer, Input, Label, Select } from '@beaconhs/ui'
import { createPdfTemplate } from './_actions'

type SubjectOpt = { key: string; label: string }

export function NewPdfTemplateFlyout({
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
      await createPdfTemplate(formData)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={14} /> <GeneratedText id="m_05098faf9f246b" />
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={tGenerated('m_05098faf9f246b')}
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
              placeholder={tGenerated('m_0494f21f6d8385')}
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="paperSize">
                <GeneratedText id="m_0ccb1fd4550a71" />
              </Label>
              <Select id="paperSize" name="paperSize" defaultValue="letter">
                <option value="letter">{'Letter'}</option>
                <option value="a4">{'A4'}</option>
                <option value="legal">{'Legal'}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orientation">
                <GeneratedText id="m_0af3bf11ca2a12" />
              </Label>
              <Select id="orientation" name="orientation" defaultValue="portrait">
                <option value="portrait">{'Portrait'}</option>
                <option value="landscape">{'Landscape'}</option>
              </Select>
            </div>
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
