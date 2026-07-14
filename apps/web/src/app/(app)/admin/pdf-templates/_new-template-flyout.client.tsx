'use client'

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
        <Plus size={14} /> New PDF template
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="New PDF template" size="md">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={200}
              placeholder="e.g. Incident report"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recordSubject">Record type *</Label>
            <Select id="recordSubject" name="recordSubject" required defaultValue="">
              <option value="" disabled>
                Choose a record type…
              </option>
              <optgroup label="Native modules">
                {modules.map((s) => (
                  <option key={`module:${s.key}`} value={`module:${s.key}`}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              {apps.length > 0 ? (
                <optgroup label="Builder apps">
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
              <Label htmlFor="paperSize">Paper</Label>
              <Select id="paperSize" name="paperSize" defaultValue="letter">
                <option value="letter">Letter</option>
                <option value="a4">A4</option>
                <option value="legal">Legal</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orientation">Orientation</Label>
              <Select id="orientation" name="orientation" defaultValue="portrait">
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              <Plus size={14} /> {pending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Drawer>
    </>
  )
}
