import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createClient } from './client'
import {
  account,
  attachments,
  BUILTIN_ROLES,
  correctiveActions,
  crews,
  departments,
  documents,
  equipmentItems,
  equipmentTypes,
  formAssignments,
  formResponses,
  formTemplates,
  formTemplateVersions,
  incidents,
  notifications,
  orgUnits,
  people,
  ppeItems,
  ppeTypes,
  roles,
  tenants,
  tenantUsers,
  trades,
  trainingCourses,
  trainingRecords,
  user,
} from './schema'
import type { FormSchemaV1 } from './schema'

async function main() {
  const { db, sql: pg } = createClient()
  console.log('▶ Seeding…')

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)

    // --- Super-admin ----------------------------------------------------
    const adminId = randomUUID()
    const inserted = await tx
      .insert(user)
      .values({
        id: adminId,
        email: 'admin@beaconhs.local',
        name: 'Super Admin',
        emailVerified: true,
        isSuperAdmin: true,
      })
      .onConflictDoNothing()
      .returning()

    if (inserted.length === 0) {
      console.log('  · super-admin already exists, skipping')
      return
    }
    const admin = inserted[0]!

    // --- Demo tenant ----------------------------------------------------
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: 'demo',
        name: 'Acme Industrial',
        defaultLanguage: 'en',
        enabledLanguages: ['en'],
        branding: { primaryColor: '#0f766e' },
        riskMatrix: {
          axes: {
            severity: { values: ['Trivial', 'Minor', 'Moderate', 'Major', 'Catastrophic'] },
            likelihood: { values: ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'] },
          },
          cells: build5x5(),
        },
      })
      .returning()
    if (!tenant) throw new Error('Failed to create tenant')

    await tx.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: admin.id,
      status: 'active',
      joinedAt: new Date(),
    })

    for (const [key, def] of Object.entries(BUILTIN_ROLES)) {
      await tx.insert(roles).values({
        tenantId: tenant.id,
        key,
        name: def.name,
        description: def.description,
        isBuiltIn: true,
        permissions: def.permissions as unknown as string[],
      })
    }

    // --- Org hierarchy --------------------------------------------------
    const customer = await insertOrgUnit(tx, tenant.id, null, 'customer', 'Acme Refinery')
    const project = await insertOrgUnit(tx, tenant.id, customer.id, 'project', 'Turnaround 2026')
    const siteA = await insertOrgUnit(tx, tenant.id, project.id, 'site', 'Site A — Tank Farm', {
      lat: 43.6532,
      lng: -79.3832,
      geofenceMeters: 250,
    })
    const siteB = await insertOrgUnit(tx, tenant.id, project.id, 'site', 'Site B — Cracker Unit', {
      lat: 43.6629,
      lng: -79.3957,
      geofenceMeters: 250,
    })

    // --- Departments + Trades + Crews ----------------------------------
    const [fieldOps] = await tx
      .insert(departments)
      .values({ tenantId: tenant.id, name: 'Field Operations' })
      .returning()
    const [office] = await tx
      .insert(departments)
      .values({ tenantId: tenant.id, name: 'Office' })
      .returning()

    const [carp] = await tx
      .insert(trades)
      .values({ tenantId: tenant.id, name: 'Carpenter' })
      .returning()
    const [elec] = await tx
      .insert(trades)
      .values({ tenantId: tenant.id, name: 'Electrician' })
      .returning()
    const [weld] = await tx
      .insert(trades)
      .values({ tenantId: tenant.id, name: 'Welder' })
      .returning()
    const [supervisorTrade] = await tx
      .insert(trades)
      .values({ tenantId: tenant.id, name: 'Supervisor' })
      .returning()

    const [crewAlpha] = await tx
      .insert(crews)
      .values({ tenantId: tenant.id, name: 'Crew Alpha' })
      .returning()
    const [crewBravo] = await tx
      .insert(crews)
      .values({ tenantId: tenant.id, name: 'Crew Bravo' })
      .returning()

    // --- People ---------------------------------------------------------
    const peopleData = [
      { firstName: 'John', lastName: 'Anderson', employeeNo: 'E001', tradeId: supervisorTrade!.id, crewId: crewAlpha!.id, dept: fieldOps!.id },
      { firstName: 'Sarah', lastName: 'Bell', employeeNo: 'E002', tradeId: carp!.id, crewId: crewAlpha!.id, dept: fieldOps!.id },
      { firstName: 'Marcus', lastName: 'Chen', employeeNo: 'E003', tradeId: elec!.id, crewId: crewAlpha!.id, dept: fieldOps!.id },
      { firstName: 'Priya', lastName: 'Desai', employeeNo: 'E004', tradeId: weld!.id, crewId: crewAlpha!.id, dept: fieldOps!.id },
      { firstName: 'Tom', lastName: 'Eaton', employeeNo: 'E005', tradeId: supervisorTrade!.id, crewId: crewBravo!.id, dept: fieldOps!.id },
      { firstName: 'Maya', lastName: 'Foster', employeeNo: 'E006', tradeId: carp!.id, crewId: crewBravo!.id, dept: fieldOps!.id },
      { firstName: 'Daniel', lastName: 'Gonzales', employeeNo: 'E007', tradeId: elec!.id, crewId: crewBravo!.id, dept: fieldOps!.id },
      { firstName: 'Aisha', lastName: 'Hamid', employeeNo: 'E008', tradeId: weld!.id, crewId: crewBravo!.id, dept: fieldOps!.id },
      { firstName: 'Linda', lastName: 'Iverson', employeeNo: 'E009', tradeId: null, crewId: null, dept: office!.id },
      { firstName: 'Robert', lastName: 'Jensen', employeeNo: 'E010', tradeId: null, crewId: null, dept: office!.id },
    ]

    const insertedPeople = await Promise.all(
      peopleData.map(async (p) => {
        const [row] = await tx
          .insert(people)
          .values({
            tenantId: tenant.id,
            firstName: p.firstName,
            lastName: p.lastName,
            employeeNo: p.employeeNo,
            departmentId: p.dept,
            tradeId: p.tradeId,
            crewId: p.crewId,
            hireDate: '2023-01-15',
            status: 'active',
          })
          .returning()
        return row!
      }),
    )

    // --- Training courses + records -------------------------------------
    const courseDefs = [
      { code: 'WHMIS', name: 'WHMIS 2015', deliveryType: 'self_paced' as const, valid: 36 },
      { code: 'H2S', name: 'H2S Alive', deliveryType: 'classroom' as const, valid: 36 },
      { code: 'FALL', name: 'Fall Protection', deliveryType: 'classroom' as const, valid: 36 },
      { code: 'CSE', name: 'Confined Space Entry', deliveryType: 'classroom' as const, valid: 12 },
      { code: 'FA', name: 'Standard First Aid', deliveryType: 'classroom' as const, valid: 36 },
    ]
    const courses = await Promise.all(
      courseDefs.map(async (c) => {
        const [row] = await tx
          .insert(trainingCourses)
          .values({
            tenantId: tenant.id,
            code: c.code,
            name: c.name,
            deliveryType: c.deliveryType,
            validForMonths: c.valid,
            durationMinutes: 60,
          })
          .returning()
        return row!
      }),
    )

    // Give every person WHMIS + Fall Protection. A couple of expiring records too.
    const today = new Date()
    const dayMs = 24 * 3600 * 1000
    for (const p of insertedPeople) {
      const issue = isoDate(new Date(today.getTime() - 365 * dayMs))
      const expires = isoDate(new Date(today.getTime() + 700 * dayMs))
      await tx.insert(trainingRecords).values({
        tenantId: tenant.id,
        personId: p.id,
        courseId: courses[0]!.id, // WHMIS
        source: 'self_paced',
        completedOn: issue,
        expiresOn: expires,
      })
    }
    // Sarah Bell's Fall Protection expires in 25 days (will trip the 30-day reminder)
    const sarah = insertedPeople[1]!
    await tx.insert(trainingRecords).values({
      tenantId: tenant.id,
      personId: sarah.id,
      courseId: courses[2]!.id,
      source: 'class',
      completedOn: isoDate(new Date(today.getTime() - 1070 * dayMs)),
      expiresOn: isoDate(new Date(today.getTime() + 25 * dayMs)),
    })
    // Marcus Chen's H2S Alive expired 5 days ago
    const marcus = insertedPeople[2]!
    await tx.insert(trainingRecords).values({
      tenantId: tenant.id,
      personId: marcus.id,
      courseId: courses[1]!.id,
      source: 'class',
      completedOn: isoDate(new Date(today.getTime() - 1100 * dayMs)),
      expiresOn: isoDate(new Date(today.getTime() - 5 * dayMs)),
    })

    // --- Equipment + PPE -----------------------------------------------
    const [tools] = await tx
      .insert(equipmentTypes)
      .values({ tenantId: tenant.id, name: 'Hand Tools', category: 'tool' })
      .returning()
    const [vehicles] = await tx
      .insert(equipmentTypes)
      .values({ tenantId: tenant.id, name: 'Light Vehicle', category: 'vehicle' })
      .returning()

    for (let i = 1; i <= 8; i++) {
      await tx.insert(equipmentItems).values({
        tenantId: tenant.id,
        typeId: i <= 5 ? tools!.id : vehicles!.id,
        assetTag: `AT-${String(i).padStart(4, '0')}`,
        name: i <= 5 ? `Cordless Drill #${i}` : `Pickup Truck #${i - 5}`,
        qrToken: `bhs-eq-${randomUUID()}`,
        status: 'in_service',
        currentSiteOrgUnitId: i % 2 === 0 ? siteA.id : siteB.id,
      })
    }

    const [harness] = await tx
      .insert(ppeTypes)
      .values({
        tenantId: tenant.id,
        name: 'Full-body harness',
        category: 'fall',
        isInspectable: true,
        sizingScheme: ['S', 'M', 'L', 'XL'],
      })
      .returning()
    for (let i = 1; i <= 6; i++) {
      await tx.insert(ppeItems).values({
        tenantId: tenant.id,
        typeId: harness!.id,
        serialNumber: `HARN-${i}`,
        size: i % 2 === 0 ? 'L' : 'M',
        status: 'in_stock',
      })
    }

    // --- Form template (daily toolbox talk) -----------------------------
    const [tmpl] = await tx
      .insert(formTemplates)
      .values({
        tenantId: tenant.id,
        key: 'daily-toolbox-talk',
        name: 'Daily Toolbox Talk',
        category: 'toolbox_talk',
        description: 'Pre-shift hazard discussion + attendance sign-in.',
        status: 'published',
        createdBy: admin.id,
      })
      .returning()
    const toolboxSchema: FormSchemaV1 = {
      schemaVersion: 1,
      title: { en: 'Daily Toolbox Talk' },
      sections: [
        {
          id: 'crew',
          title: { en: 'Crew & Site' },
          fields: [
            { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
            { id: 'foreman', type: 'person_picker', label: { en: 'Foreman' }, required: true },
            { id: 'attendees', type: 'person_picker', label: { en: 'Attendees' }, required: true },
          ],
        },
        {
          id: 'topics',
          title: { en: 'Topics Covered' },
          repeating: true,
          fields: [
            { id: 'topic', type: 'text', label: { en: 'Topic' }, required: true },
            { id: 'discussion', type: 'textarea', label: { en: 'Discussion notes' } },
          ],
        },
        {
          id: 'signoff',
          title: { en: 'Sign-off' },
          fields: [
            {
              id: 'incidentsDiscussed',
              type: 'yes_no_comment',
              label: { en: 'Were recent incidents reviewed?' },
              required: true,
            },
            { id: 'signature', type: 'signature', label: { en: 'Foreman signature' }, required: true },
          ],
        },
      ],
      workflow: {
        steps: [
          { key: 'submit', title: { en: 'Submit' }, assignee: { type: 'expression', expr: '$submitter' } },
        ],
      },
    }
    await tx.insert(formTemplateVersions).values({
      tenantId: tenant.id,
      templateId: tmpl!.id,
      version: 1,
      schema: toolboxSchema,
      publishedAt: new Date(),
      publishedBy: admin.id,
      changelog: 'Initial version',
    })
    await tx.insert(formAssignments).values({
      tenantId: tenant.id,
      templateId: tmpl!.id,
      mode: 'scheduled',
      cron: '0 7 * * 1-5',
      targetRoleKeys: ['foreman'],
      enabled: true,
      createdBy: admin.id,
    })

    // --- A few example form responses -----------------------------------
    for (let i = 0; i < 4; i++) {
      const [ver] = await tx
        .select()
        .from(formTemplateVersions)
        .where(sql`template_id = ${tmpl!.id}`)
        .limit(1)
      if (!ver) break
      await tx.insert(formResponses).values({
        tenantId: tenant.id,
        templateId: tmpl!.id,
        templateVersionId: ver.id,
        status: i === 0 ? 'submitted' : i === 1 ? 'submitted' : i === 2 ? 'in_progress' : 'closed',
        siteOrgUnitId: i % 2 === 0 ? siteA.id : siteB.id,
        submittedAt: i < 3 ? new Date(today.getTime() - i * dayMs) : new Date(),
        data: { foreman: insertedPeople[0]!.id, attendees: insertedPeople.slice(1, 4).map((p) => p.id) },
      })
    }

    // --- Incidents ------------------------------------------------------
    const incidentRows = [
      {
        reference: 'INC-2026-0001',
        type: 'near_miss' as const,
        severity: 'no_injury' as const,
        status: 'closed' as const,
        title: 'Hand tool dropped from scaffold',
        description: 'Wrench dropped from level 2 scaffold; no injury, area was barricaded.',
        siteId: siteA.id,
        daysAgo: 14,
      },
      {
        reference: 'INC-2026-0002',
        type: 'injury' as const,
        severity: 'first_aid_only' as const,
        status: 'closed' as const,
        title: 'Cut on right hand while opening box',
        description: 'Small laceration during material unpacking; bandaged on site.',
        siteId: siteA.id,
        daysAgo: 9,
      },
      {
        reference: 'INC-2026-0003',
        type: 'injury' as const,
        severity: 'medical_aid' as const,
        status: 'under_investigation' as const,
        title: 'Slip on wet floor in mechanical room',
        description: 'Worker slipped after a hose was left dripping; treated at walk-in clinic.',
        siteId: siteB.id,
        daysAgo: 3,
      },
      {
        reference: 'INC-2026-0004',
        type: 'property_damage' as const,
        severity: 'no_injury' as const,
        status: 'reported' as const,
        title: 'Forklift bumped overhead conduit',
        description: 'Minor damage to conduit, isolated and tagged out.',
        siteId: siteB.id,
        daysAgo: 1,
      },
    ]
    for (const i of incidentRows) {
      await tx.insert(incidents).values({
        tenantId: tenant.id,
        reference: i.reference,
        type: i.type,
        severity: i.severity,
        status: i.status,
        title: i.title,
        description: i.description,
        occurredAt: new Date(today.getTime() - i.daysAgo * dayMs),
      })
    }

    // --- Corrective actions --------------------------------------------
    const caRows = [
      { reference: 'CA-2026-0001', title: 'Install drip pan under leaking hose', severity: 'medium' as const, status: 'in_progress' as const, daysToDue: 7 },
      { reference: 'CA-2026-0002', title: 'Re-run scaffold inspection daily during turnaround', severity: 'high' as const, status: 'open' as const, daysToDue: 3 },
      { reference: 'CA-2026-0003', title: 'Refresh slip-trip awareness in monthly toolbox', severity: 'low' as const, status: 'open' as const, daysToDue: 14 },
      { reference: 'CA-2026-0004', title: 'Replace damaged conduit section', severity: 'high' as const, status: 'pending_verification' as const, daysToDue: 1 },
    ]
    for (const c of caRows) {
      await tx.insert(correctiveActions).values({
        tenantId: tenant.id,
        reference: c.reference,
        title: c.title,
        severity: c.severity,
        status: c.status,
        siteOrgUnitId: siteA.id,
        dueOn: isoDate(new Date(today.getTime() + c.daysToDue * dayMs)),
      })
    }

    // --- Documents ------------------------------------------------------
    await tx.insert(documents).values([
      {
        tenantId: tenant.id,
        key: 'corporate-h&s-policy',
        title: 'Corporate Health & Safety Policy',
        category: 'policy',
        status: 'published',
        reviewFrequencyMonths: 12,
      },
      {
        tenantId: tenant.id,
        key: 'sds-acetone',
        title: 'SDS — Acetone',
        category: 'sds',
        status: 'published',
        reviewFrequencyMonths: 36,
      },
      {
        tenantId: tenant.id,
        key: 'wah-procedure',
        title: 'Work at Height Procedure',
        category: 'procedure',
        status: 'published',
        reviewFrequencyMonths: 24,
      },
    ])

    // --- A welcome notification for the super-admin --------------------
    await tx.insert(notifications).values({
      tenantId: tenant.id,
      userId: admin.id,
      category: 'system',
      type: 'tenant.welcome',
      title: 'Welcome to Acme Industrial',
      body: 'Sample data has been seeded. Have a look around.',
      linkPath: '/dashboard',
    })

    console.log(`  · tenant: ${tenant.name} (${tenant.slug})`)
    console.log(`  · super-admin: ${admin.email}`)
    console.log(`  · seeded: ${insertedPeople.length} people, ${courses.length} courses, ${incidentRows.length} incidents, ${caRows.length} corrective actions`)
    console.log(`  · sign in via Magic link (Mailpit: http://localhost:8025)`)
  })

  await pg.end()
  console.log('✔ Seed complete')
}

async function insertOrgUnit(
  tx: any,
  tenantId: string,
  parentId: string | null,
  level: 'customer' | 'project' | 'site' | 'area',
  name: string,
  extras: { lat?: number; lng?: number; geofenceMeters?: number } = {},
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(orgUnits)
    .values({ tenantId, parentId, level, name, ...extras })
    .returning()
  return row
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function build5x5() {
  const cells: Record<string, { score: number; label: string; color: string }> = {}
  const labels = ['Low', 'Low', 'Medium', 'High', 'Extreme']
  const colors = ['#22c55e', '#86efac', '#eab308', '#f97316', '#dc2626']
  for (let s = 0; s < 5; s++) {
    for (let l = 0; l < 5; l++) {
      const score = (s + 1) * (l + 1)
      const tier = score <= 4 ? 0 : score <= 8 ? 1 : score <= 12 ? 2 : score <= 19 ? 3 : 4
      cells[`${s}:${l}`] = { score, label: labels[tier]!, color: colors[tier]! }
    }
  }
  return cells
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
