import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Bell, Check } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { notifications } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Inbox' }
export const dynamic = 'force-dynamic'

async function markRead(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)),
  )
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
}

async function markAllRead() {
  'use server'
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt))),
  )
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
}

export default async function InboxPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .orderBy(desc(notifications.occurredAt))
      .limit(100),
  )
  const unread = rows.filter((r) => !r.readAt).length

  return (
    <PageContainer>
      <div className="space-y-4">
        <PageHeader
          title="Inbox"
          description="In-app notifications. Email + Web Push + SMS are wired through the worker; you'll see the in-app copy here regardless."
          actions={
            unread > 0 ? (
              <form action={markAllRead}>
                <Button variant="outline">
                  <Check size={14} /> Mark all read
                </Button>
              </form>
            ) : undefined
          }
        />

        {rows.length === 0 ? (
          <EmptyState icon={<Bell size={32} />} title="Inbox zero" description="You're all caught up." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>When</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((n) => (
                <TableRow key={n.id} className={!n.readAt ? 'bg-teal-50/30' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {!n.readAt ? <span className="h-2 w-2 rounded-full bg-teal-600" /> : null}
                      {n.linkPath ? (
                        <Link href={n.linkPath as any} className="font-medium hover:underline">
                          {n.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{n.title}</span>
                      )}
                      {n.isCritical ? <Badge variant="destructive">critical</Badge> : null}
                    </div>
                    {n.body ? <div className="mt-0.5 text-xs text-slate-500">{n.body}</div> : null}
                  </TableCell>
                  <TableCell className="text-slate-600">{n.category}</TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(n.occurredAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {!n.readAt ? (
                      <form action={markRead} className="inline">
                        <input type="hidden" name="id" value={n.id} />
                        <Button size="sm" variant="outline">
                          Mark read
                        </Button>
                      </form>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageContainer>
  )
}
