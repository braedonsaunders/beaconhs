import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { Download, ExternalLink, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { attachments, documentReferences } from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

const CATEGORY_OPTIONS = [
  { value: 'sds', label: 'SDS / MSDS' },
  { value: 'manual', label: 'Manual' },
  { value: 'external', label: 'External link' },
  { value: 'standard', label: 'Standard / regulation' },
  { value: 'other', label: 'Other' },
]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Reference · ${id.slice(0, 8)}` }
}

async function updateReference(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const category = String(formData.get('category') ?? '').trim() || null
  const url = String(formData.get('url') ?? '').trim() || null
  if (!id || !title) return

  await ctx.db((tx) =>
    tx
      .update(documentReferences)
      .set({ title, description, category, url })
      .where(eq(documentReferences.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_reference',
    entityId: id,
    action: 'update',
    summary: 'Updated reference',
    after: { title, description, category, url },
  })
  revalidatePath(`/documents/reference/${id}`)
  revalidatePath('/documents/reference')
}

async function deleteReference(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(documentReferences)
      .set({ deletedAt: new Date() })
      .where(eq(documentReferences.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_reference',
    entityId: id,
    action: 'delete',
    summary: 'Deleted reference (soft)',
  })
  revalidatePath('/documents/reference')
  redirect('/documents/reference')
}

export default async function ReferenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [ref] = await tx
      .select()
      .from(documentReferences)
      .where(eq(documentReferences.id, id))
      .limit(1)
    if (!ref || ref.deletedAt) return null
    const attachment = ref.attachmentId
      ? await tx.select().from(attachments).where(eq(attachments.id, ref.attachmentId)).limit(1)
      : []
    return { ref, attachment: attachment[0] ?? null }
  })

  if (!data) notFound()
  const { ref, attachment } = data
  const fileUrl = attachment ? publicUrl(attachment.r2Key) : null

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/documents/reference', label: 'Back to references' }}
          title={ref.title}
          subtitle={`${ref.category ?? 'reference'} · ${ref.kind === 'url' ? 'External URL' : 'Uploaded file'}`}
          badge={
            ref.kind === 'url' ? (
              <Badge variant="secondary">URL</Badge>
            ) : (
              <Badge variant="secondary">File</Badge>
            )
          }
          actions={
            <>
              {ref.kind === 'url' && ref.url ? (
                <a href={ref.url} target="_blank" rel="noopener noreferrer">
                  <Button>
                    <ExternalLink size={14} /> Open URL
                  </Button>
                </a>
              ) : null}
              {ref.kind === 'attachment' && fileUrl ? (
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" download={attachment?.filename ?? undefined}>
                  <Button>
                    <Download size={14} /> Download
                  </Button>
                </a>
              ) : null}
              <form action={deleteReference} className="inline">
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="outline">
                  <Trash2 size={14} className="text-red-500" /> Delete
                </Button>
              </form>
            </>
          }
        />
      }
    >
      <div className="space-y-5">
        <DetailGrid
          rows={[
            { label: 'Title', value: ref.title },
            { label: 'Category', value: ref.category ?? '—' },
            { label: 'Kind', value: ref.kind === 'url' ? 'External URL' : 'Uploaded file' },
            {
              label: 'Target',
              value:
                ref.kind === 'url' && ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-teal-700 hover:underline"
                  >
                    {ref.url}
                  </a>
                ) : ref.kind === 'attachment' && attachment ? (
                  <span>
                    {attachment.filename} · {(attachment.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                ) : (
                  '—'
                ),
            },
            { label: 'Updated', value: new Date(ref.updatedAt).toLocaleString() },
          ]}
        />

        {ref.description ? (
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{ref.description}</p>
            </CardContent>
          </Card>
        ) : null}

        <Section title="Edit reference" defaultOpen={false}>
          <form action={updateReference} className="space-y-4 text-sm">
            <input type="hidden" name="id" value={id} />
            <Field label="Title" required>
              <Input name="title" defaultValue={ref.title} required />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Category">
                <Select name="category" defaultValue={ref.category ?? 'other'}>
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {ref.kind === 'url' ? (
                <Field label="URL">
                  <Input name="url" type="url" defaultValue={ref.url ?? ''} />
                </Field>
              ) : null}
            </div>
            <Field label="Description">
              <Textarea name="description" rows={3} defaultValue={ref.description ?? ''} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Section>
      </div>
    </DetailPageLayout>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
