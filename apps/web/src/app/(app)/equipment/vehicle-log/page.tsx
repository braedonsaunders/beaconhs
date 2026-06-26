import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileText, Truck } from 'lucide-react'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { can, assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import {
  applyWorkActivityToVehicleLog,
  deleteVehicleLogMonth,
  loadVehicleLogWorkspace,
  upsertVehicleLogEntry,
  type ApplyWorkActivityInput,
  type SaveVehicleLogEntryInput,
} from './_service'
import { VehicleLogWorkspaceClient } from './_workspace.client'

export const metadata = { title: 'Vehicle log' }
export const dynamic = 'force-dynamic'

async function saveVehicleLogEntryAction(input: SaveVehicleLogEntryInput) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  try {
    const entry = await upsertVehicleLogEntry(ctx, input)
    return { ok: true as const, entry }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Failed to save vehicle log entry.',
    }
  }
}

async function applyWorkActivityAction(input: ApplyWorkActivityInput) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  try {
    const result = await applyWorkActivityToVehicleLog(ctx, input)
    return { ok: true as const, result }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Failed to import source activity.',
    }
  }
}

async function deleteMonthAction(input: ApplyWorkActivityInput) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  try {
    const deleted = await deleteVehicleLogMonth(ctx, input)
    return { ok: true as const, deleted }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Failed to delete vehicle log entries.',
    }
  }
}

export default async function VehicleLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()
  if (
    !can(ctx, 'equipment.read.all') &&
    !can(ctx, 'equipment.read.site') &&
    !can(ctx, 'equipment.manage')
  ) {
    redirect('/dashboard')
  }

  const workspace = await loadVehicleLogWorkspace(ctx, {
    month: pickString(sp.month),
    driverPersonId: pickString(sp.driver),
    equipmentItemId: pickString(sp.vehicle),
    mode: pickString(sp.mode),
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Vehicle log"
            description="Driver and vehicle monthly log entry."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/equipment/vehicle-log/summary">
                  <Button variant="outline">
                    <FileText size={14} />
                    Summary
                  </Button>
                </Link>
              </div>
            }
          />
          <EquipmentSubNav active="vehicle-log" />
        </>
      }
    >
      {workspace.drivers.length === 0 || workspace.vehicles.length === 0 ? (
        <EmptyState
          icon={<Truck size={32} />}
          title="Vehicle log is not ready"
          description="Active drivers and equipment vehicles are required."
          action={
            <Link href="/equipment">
              <Button>Open equipment</Button>
            </Link>
          }
        />
      ) : (
        <VehicleLogWorkspaceClient
          workspace={workspace}
          saveAction={saveVehicleLogEntryAction}
          applyAction={applyWorkActivityAction}
          deleteMonthAction={deleteMonthAction}
        />
      )}
    </ListPageLayout>
  )
}
