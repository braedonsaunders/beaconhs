import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { Truck } from 'lucide-react'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { evaluateLogicRule } from '@beaconhs/forms-core'
import { formAutomations } from '@beaconhs/db/schema'
import { can, assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { createVehicleLogFlowAdapter } from '@/lib/flows/adapters/vehicle-log'
import {
  applyVehicleLogImportToVehicleLog,
  deleteVehicleLogMonth,
  loadVehicleLogWorkspace,
  upsertVehicleLogEntry,
  type ApplyVehicleLogImportInput,
  type SaveVehicleLogEntryInput,
} from './_service'
import { runVehicleLogAction } from './_flow-actions'
import { VehicleLogWorkspaceClient, type VehicleLogRecordAction } from './_workspace.client'

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

async function applyVehicleLogImportAction(input: ApplyVehicleLogImportInput) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  try {
    const result = await applyVehicleLogImportToVehicleLog(ctx, input)
    return { ok: true as const, result }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Failed to import vehicle log source.',
    }
  }
}

async function deleteMonthAction(input: ApplyVehicleLogImportInput) {
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

  // Manual-trigger flow buttons for the viewed month. The anchor record is the
  // month's latest saved entry — the vehicle-log adapter expands it to the
  // whole driver+vehicle month, so actions like "Email month PDF" cover the
  // sheet on screen. Authored permission/showIf gates are applied server-side.
  let recordActions: VehicleLogRecordAction[] = []
  const actionEntryId = [...workspace.rows].reverse().find((row) => row.entry.id)?.entry.id ?? null
  if (actionEntryId) {
    const manualFlows = await ctx.db((tx) =>
      tx
        .select({ id: formAutomations.id, graph: formAutomations.graph })
        .from(formAutomations)
        .where(
          and(
            eq(formAutomations.subjectType, 'module'),
            eq(formAutomations.subjectKey, 'vehicle-log'),
            eq(formAutomations.enabled, true),
          ),
        ),
    )
    const withManual = manualFlows.filter((flow) =>
      flow.graph.nodes.some(
        (n) => n.data.kind === 'trigger' && n.data.trigger.trigger === 'manual',
      ),
    )
    if (withManual.length > 0) {
      const values = await createVehicleLogFlowAdapter(ctx, actionEntryId)
        .loadValues()
        .catch(() => ({}) as Record<string, unknown>)
      for (const flow of withManual) {
        for (const node of flow.graph.nodes) {
          if (node.data.kind !== 'trigger') continue
          const t = node.data.trigger
          if (t.trigger !== 'manual') continue
          if (t.requirePermission && !can(ctx, t.requirePermission)) continue
          if (t.showIf && !evaluateLogicRule(t.showIf, { values, rows: {}, entities: {} })) continue
          recordActions.push({
            flowId: flow.id,
            buttonId: t.buttonId,
            label: t.label,
            icon: t.icon,
            variant: t.variant,
            confirm: t.confirm,
            order: t.order ?? 0,
          })
        }
      }
      recordActions = recordActions.sort((a, b) => a.order - b.order)
    }
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader title="Vehicle log" description="Driver and vehicle monthly log entry." />
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
          canManage={can(ctx, 'equipment.manage')}
          saveAction={saveVehicleLogEntryAction}
          applyAction={applyVehicleLogImportAction}
          deleteMonthAction={deleteMonthAction}
          recordActions={recordActions}
          actionEntryId={actionEntryId}
          runAction={runVehicleLogAction}
        />
      )}
    </ListPageLayout>
  )
}
