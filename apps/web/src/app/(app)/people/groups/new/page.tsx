import Link from 'next/link'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { createGroup } from '../../_actions/groups'

export const metadata = { title: 'New group' }
export const dynamic = 'force-dynamic'

const COLOR_PRESETS = [
  '#0f766e', // teal
  '#2563eb', // blue
  '#7c3aed', // violet
  '#ea580c', // orange
  '#dc2626', // red
  '#65a30d', // lime
  '#475569', // slate
] as const

export default async function NewGroupPage() {
  await requireModuleManage('people')
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-5">
        <DetailHeader
          back={{ href: '/people/groups', label: 'Back to groups' }}
          title="New group"
          subtitle="Pick a colour and name; you can add members from the detail page after saving."
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createGroup} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" required placeholder="e.g. Fire Wardens" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  placeholder="What is this group for? Who maintains it?"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="color">Colour</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="color"
                    name="color"
                    type="color"
                    defaultValue="#0f766e"
                    className="h-9 w-12 cursor-pointer rounded border border-slate-300"
                  />
                  <div className="flex gap-1">
                    {COLOR_PRESETS.map((c) => (
                      <label key={c} className="cursor-pointer">
                        <input type="radio" name="colorPreset" value={c} className="sr-only" />
                        <span
                          className="block h-6 w-6 rounded-full border border-slate-200 transition hover:scale-110"
                          style={{ background: c }}
                          title={c}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Used to render the group chip on People list pages.
                </p>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Link href="/people/groups">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit">Create group</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
