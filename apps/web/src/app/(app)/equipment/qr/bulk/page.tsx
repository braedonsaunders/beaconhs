import Link from 'next/link'
import { Printer, QrCode } from 'lucide-react'
import { and, asc, eq, ilike, or, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { Section } from '@/components/section'

export const metadata = { title: 'Bulk QR generator' }
export const dynamic = 'force-dynamic'

export default async function BulkQrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const search = pickString(sp.q)
  const typeFilter = pickString(sp.typeId)
  const ctx = await requireRequestContext()

  const { rows, types } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (search) {
      const term = `%${search}%`
      const cond = or(ilike(equipmentItems.assetTag, term), ilike(equipmentItems.name, term))
      if (cond) filters.push(cond)
    }
    if (typeFilter) filters.push(eq(equipmentItems.typeId, typeFilter))
    const where = filters.length ? and(...filters) : undefined
    const items = await tx
      .select({ item: equipmentItems, type: equipmentTypes })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .where(where)
      .orderBy(asc(equipmentItems.assetTag))
      .limit(500)
    const types = await tx
      .select({ id: equipmentTypes.id, name: equipmentTypes.name })
      .from(equipmentTypes)
      .orderBy(asc(equipmentTypes.name))
    return { rows: items, types }
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="equipment" />
          <PageHeader
            title="Bulk QR generator"
            description="Select equipment items to generate a printable A4 sheet of 4×3 QR labels. Submitting opens a print-ready page."
            back={{ href: '/equipment', label: 'Back to equipment' }}
          />
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Search</Label>
              <Input
                name="q"
                placeholder="asset tag or name…"
                defaultValue={search ?? ''}
                className="h-8 w-64"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select name="typeId" defaultValue={typeFilter ?? ''} className="h-8">
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline" size="sm">
              Apply filters
            </Button>
          </form>
          <div className="text-xs text-slate-500">
            <Badge variant="secondary">{rows.length} items</Badge>
          </div>
        </>
      }
    >
      <Section title="Pick equipment for the QR sheet" defaultOpen>
        <form action="/equipment/qr/bulk/print" method="GET" className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">
                    <input
                      type="checkbox"
                      id="select-all"
                      onChange={undefined}
                      // Plain server-rendered select-all: a simple JS hook on
                      // the print page also re-checks based on the chosen IDs.
                    />
                  </TableHead>
                  <TableHead>Asset tag</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>QR token</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ item, type }) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-center">
                      <input type="checkbox" name="ids" value={item.id} className="qr-cb" />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.assetTag}</TableCell>
                    <TableCell>
                      <Link href={`/equipment/${item.id}`} className="font-medium hover:underline">
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{type?.name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {item.qrToken.slice(0, 12)}…
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-slate-600">
              Selections become a printable 4×3 grid (12 labels per page) sized for adhesive vinyl
              asset tags.
            </div>
            <div className="flex items-center gap-2">
              <Link href="/equipment">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit">
                <Printer size={14} /> Generate sheet
              </Button>
            </div>
          </div>
        </form>
      </Section>
    </ListPageLayout>
  )
}
