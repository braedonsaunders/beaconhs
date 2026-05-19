import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createClient } from './client'
import {
  BUILTIN_ROLES,
  correctiveActions,
  crews,
  departments,
  documents,
  documentAcknowledgments,
  documentReviews,
  documentVersions,
  equipmentItems,
  equipmentTypes,
  equipmentWorkOrders,
  equipmentLocationHistory,
  formAssignments,
  formResponses,
  formTemplates,
  formTemplateVersions,
  incidentInjuries,
  incidentLostTimeEvents,
  incidentPeople,
  incidents,
  notifications,
  orgUnits,
  people,
  plugins,
  ppeInspections,
  ppeIssueReports,
  ppeIssues,
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

    const [membership] = await tx
      .insert(tenantUsers)
      .values({
        tenantId: tenant.id,
        userId: admin.id,
        status: 'active',
        joinedAt: new Date(),
        displayName: 'Super Admin',
      })
      .returning()
    if (!membership) throw new Error('Failed to create membership')

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

    const [carp] = await tx.insert(trades).values({ tenantId: tenant.id, name: 'Carpenter' }).returning()
    const [elec] = await tx.insert(trades).values({ tenantId: tenant.id, name: 'Electrician' }).returning()
    const [weld] = await tx.insert(trades).values({ tenantId: tenant.id, name: 'Welder' }).returning()
    const [supervisorTrade] = await tx.insert(trades).values({ tenantId: tenant.id, name: 'Supervisor' }).returning()

    const [crewAlpha] = await tx.insert(crews).values({ tenantId: tenant.id, name: 'Crew Alpha' }).returning()
    const [crewBravo] = await tx.insert(crews).values({ tenantId: tenant.id, name: 'Crew Bravo' }).returning()

    // --- People ---------------------------------------------------------
    const peopleData = [
      {
        firstName: 'John', lastName: 'Anderson', formalName: 'John D. Anderson',
        jobTitle: 'Site Supervisor', employeeNo: 'E001',
        tradeId: supervisorTrade!.id, crewId: crewAlpha!.id, dept: fieldOps!.id,
        email: 'janderson@acme.example', phone: '+1-647-555-0101',
        emergencyContactName: 'Mary Anderson', emergencyContactPhone: '+1-647-555-9001',
        notes: 'Lead supervisor for Tank Farm operations. 15 years on site.',
      },
      {
        firstName: 'Sarah', lastName: 'Bell', formalName: 'Sarah J. Bell',
        jobTitle: 'Lead Carpenter', employeeNo: 'E002',
        tradeId: carp!.id, crewId: crewAlpha!.id, dept: fieldOps!.id,
        email: 'sbell@acme.example', phone: '+1-647-555-0102',
        emergencyContactName: 'Tom Bell', emergencyContactPhone: '+1-647-555-9002',
      },
      {
        firstName: 'Marcus', lastName: 'Chen', formalName: 'Marcus K. Chen',
        jobTitle: 'Journeyman Electrician', employeeNo: 'E003',
        tradeId: elec!.id, crewId: crewAlpha!.id, dept: fieldOps!.id,
        email: 'mchen@acme.example', phone: '+1-647-555-0103',
        emergencyContactName: 'Lisa Chen', emergencyContactPhone: '+1-647-555-9003',
      },
      {
        firstName: 'Priya', lastName: 'Desai', formalName: 'Priya N. Desai',
        jobTitle: 'Pipe Welder', employeeNo: 'E004',
        tradeId: weld!.id, crewId: crewAlpha!.id, dept: fieldOps!.id,
        email: 'pdesai@acme.example', phone: '+1-647-555-0104',
        emergencyContactName: 'Arjun Desai', emergencyContactPhone: '+1-647-555-9004',
      },
      {
        firstName: 'Tom', lastName: 'Eaton', formalName: 'Thomas Eaton',
        jobTitle: 'Site Supervisor', employeeNo: 'E005',
        tradeId: supervisorTrade!.id, crewId: crewBravo!.id, dept: fieldOps!.id,
        email: 'teaton@acme.example', phone: '+1-647-555-0105',
        emergencyContactName: 'Jane Eaton', emergencyContactPhone: '+1-647-555-9005',
      },
      { firstName: 'Maya', lastName: 'Foster', jobTitle: 'Apprentice Carpenter', employeeNo: 'E006', tradeId: carp!.id, crewId: crewBravo!.id, dept: fieldOps!.id },
      { firstName: 'Daniel', lastName: 'Gonzales', jobTitle: 'Apprentice Electrician', employeeNo: 'E007', tradeId: elec!.id, crewId: crewBravo!.id, dept: fieldOps!.id },
      { firstName: 'Aisha', lastName: 'Hamid', jobTitle: 'Welder', employeeNo: 'E008', tradeId: weld!.id, crewId: crewBravo!.id, dept: fieldOps!.id },
      { firstName: 'Linda', lastName: 'Iverson', jobTitle: 'HSE Coordinator', employeeNo: 'E009', tradeId: null, crewId: null, dept: office!.id },
      { firstName: 'Robert', lastName: 'Jensen', jobTitle: 'Project Manager', employeeNo: 'E010', tradeId: null, crewId: null, dept: office!.id },
    ]

    const insertedPeople = await Promise.all(
      peopleData.map(async (p) => {
        const [row] = await tx
          .insert(people)
          .values({
            tenantId: tenant.id,
            firstName: p.firstName,
            lastName: p.lastName,
            formalName: (p as any).formalName ?? null,
            jobTitle: (p as any).jobTitle ?? null,
            employeeNo: p.employeeNo,
            departmentId: p.dept,
            tradeId: p.tradeId,
            crewId: p.crewId,
            hireDate: '2023-01-15',
            status: 'active',
            email: (p as any).email ?? null,
            phone: (p as any).phone ?? null,
            emergencyContactName: (p as any).emergencyContactName ?? null,
            emergencyContactPhone: (p as any).emergencyContactPhone ?? null,
            notes: (p as any).notes ?? null,
          })
          .returning()
        return row!
      }),
    )
    const [john, sarah, marcus, priya, tom] = insertedPeople

    // --- Training courses + records -------------------------------------
    const courseDefs = [
      { code: 'WHMIS', name: 'WHMIS 2015', deliveryType: 'self_paced' as const, valid: 36, description: 'Workplace Hazardous Materials Information System — federally mandated chemical hazard training.' },
      { code: 'H2S', name: 'H2S Alive', deliveryType: 'classroom' as const, valid: 36, description: 'Hydrogen sulfide hazard recognition + SCBA familiarisation (ENFORM standard).' },
      { code: 'FALL', name: 'Fall Protection', deliveryType: 'classroom' as const, valid: 36, description: 'Proper use of harness, lanyard, anchor points, rescue planning.' },
      { code: 'CSE', name: 'Confined Space Entry', deliveryType: 'classroom' as const, valid: 12, description: 'Permit-required confined space awareness for entrants/attendants.' },
      { code: 'FA', name: 'Standard First Aid', deliveryType: 'classroom' as const, valid: 36, description: 'Canadian Red Cross 16-hour SFA + CPR-C certification.' },
    ]
    const courses = await Promise.all(
      courseDefs.map(async (c) => {
        const [row] = await tx
          .insert(trainingCourses)
          .values({
            tenantId: tenant.id,
            code: c.code,
            name: c.name,
            description: c.description,
            deliveryType: c.deliveryType,
            validForMonths: c.valid,
            durationMinutes: 60,
          })
          .returning()
        return row!
      }),
    )

    const today = new Date()
    const dayMs = 24 * 3600 * 1000
    for (const p of insertedPeople) {
      const issue = isoDate(new Date(today.getTime() - 365 * dayMs))
      const expires = isoDate(new Date(today.getTime() + 700 * dayMs))
      await tx.insert(trainingRecords).values({
        tenantId: tenant.id,
        personId: p.id,
        courseId: courses[0]!.id,
        source: 'self_paced',
        completedOn: issue,
        expiresOn: expires,
        certificateType: 'auto',
        grade: 92,
        instructor: 'Online module',
      })
    }
    // Sarah's Fall Protection expires in 24 days
    await tx.insert(trainingRecords).values({
      tenantId: tenant.id,
      personId: sarah!.id,
      courseId: courses[2]!.id,
      source: 'class',
      completedOn: isoDate(new Date(today.getTime() - 1070 * dayMs)),
      expiresOn: isoDate(new Date(today.getTime() + 24 * dayMs)),
      certificateType: 'auto',
      instructor: 'L. Iverson',
      grade: 88,
      details: 'In-person session at Site A muster point.',
    })
    // Marcus' H2S expired 6 days ago
    await tx.insert(trainingRecords).values({
      tenantId: tenant.id,
      personId: marcus!.id,
      courseId: courses[1]!.id,
      source: 'class',
      completedOn: isoDate(new Date(today.getTime() - 1100 * dayMs)),
      expiresOn: isoDate(new Date(today.getTime() - 6 * dayMs)),
      certificateType: 'auto',
      instructor: 'ENFORM',
      grade: 84,
    })
    // First aid for HSE Coordinator (current)
    await tx.insert(trainingRecords).values({
      tenantId: tenant.id,
      personId: insertedPeople[8]!.id,
      courseId: courses[4]!.id,
      source: 'class',
      completedOn: isoDate(new Date(today.getTime() - 60 * dayMs)),
      expiresOn: isoDate(new Date(today.getTime() + (3 * 365 - 60) * dayMs)),
      certificateType: 'auto',
      instructor: 'Canadian Red Cross',
      grade: 96,
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

    const equipmentIds: string[] = []
    for (let i = 1; i <= 8; i++) {
      const isTool = i <= 5
      const [eq] = await tx
        .insert(equipmentItems)
        .values({
          tenantId: tenant.id,
          typeId: isTool ? tools!.id : vehicles!.id,
          assetTag: `AT-${String(i).padStart(4, '0')}`,
          name: isTool ? `Cordless Drill #${i}` : `Pickup Truck #${i - 5}`,
          serialNumber: isTool ? `DRL-${1000 + i}` : `VIN-1HGBH${10000 + i}`,
          qrToken: `bhs-eq-${randomUUID()}`,
          status: 'in_service',
          currentSiteOrgUnitId: i % 2 === 0 ? siteA.id : siteB.id,
          currentHolderPersonId: isTool ? insertedPeople[i % insertedPeople.length]!.id : null,
          purchaseDate: '2024-03-15',
          warrantyExpiresOn: '2027-03-15',
          requiresPreUseInspection: isTool ? true : true,
          requiresAnnualInspection: !isTool,
          lastAnnualInspectionOn: !isTool ? isoDate(new Date(today.getTime() - 120 * dayMs)) : null,
          nextAnnualInspectionDue: !isTool ? isoDate(new Date(today.getTime() + 240 * dayMs)) : null,
          lastPreUseInspectionAt: new Date(today.getTime() - 2 * dayMs),
          billingRateCategory: isTool ? 'tools' : 'vehicles',
        })
        .returning()
      equipmentIds.push(eq!.id)

      // Add a little location history
      await tx.insert(equipmentLocationHistory).values({
        tenantId: tenant.id,
        itemId: eq!.id,
        siteOrgUnitId: i % 2 === 0 ? siteA.id : siteB.id,
        holderPersonId: isTool ? insertedPeople[i % insertedPeople.length]!.id : null,
        recordedAt: new Date(today.getTime() - 7 * dayMs),
        note: 'Issued from yard',
      })
      await tx.insert(equipmentLocationHistory).values({
        tenantId: tenant.id,
        itemId: eq!.id,
        siteOrgUnitId: i % 2 === 0 ? siteB.id : siteA.id,
        recordedAt: new Date(today.getTime() - 30 * dayMs),
        note: 'Transferred',
      })
    }
    // A work order on the first pickup truck
    await tx.insert(equipmentWorkOrders).values({
      tenantId: tenant.id,
      itemId: equipmentIds[5]!,
      reference: 'WO-2026-0001',
      status: 'in_progress',
      summary: 'Replace front-left tire',
      description: 'Sidewall puncture noticed during pre-trip inspection.',
      openedAt: new Date(today.getTime() - 1 * dayMs),
    })
    await tx.insert(equipmentWorkOrders).values({
      tenantId: tenant.id,
      itemId: equipmentIds[5]!,
      reference: 'WO-2026-0002',
      status: 'closed',
      summary: 'Annual safety inspection',
      description: 'Provincial annual inspection completed; certificate filed.',
      openedAt: new Date(today.getTime() - 120 * dayMs),
      closedAt: new Date(today.getTime() - 118 * dayMs),
    })

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
    const harnessIds: string[] = []
    for (let i = 1; i <= 6; i++) {
      const [item] = await tx
        .insert(ppeItems)
        .values({
          tenantId: tenant.id,
          typeId: harness!.id,
          serialNumber: `HARN-${i}`,
          size: i % 2 === 0 ? 'L' : 'M',
          status: i <= 3 ? 'issued' : 'in_stock',
          currentHolderPersonId: i <= 3 ? insertedPeople[i - 1]!.id : null,
          purchaseDate: '2024-01-10',
          expiresOn: '2029-01-10',
          lastInspectionOn: isoDate(new Date(today.getTime() - 14 * dayMs)),
          nextInspectionDue: isoDate(new Date(today.getTime() + 16 * dayMs)),
          lastAnnualInspectionOn: isoDate(new Date(today.getTime() - 200 * dayMs)),
          nextAnnualInspectionDue: isoDate(new Date(today.getTime() + 165 * dayMs)),
        })
        .returning()
      harnessIds.push(item!.id)

      // Inspection history (3 pre-use, 1 annual per item)
      for (let n = 0; n < 3; n++) {
        await tx.insert(ppeInspections).values({
          tenantId: tenant.id,
          itemId: item!.id,
          kind: 'pre_use',
          result: 'pass',
          inspectedOn: isoDate(new Date(today.getTime() - (14 + n * 14) * dayMs)),
          nextDueOn: isoDate(new Date(today.getTime() - (14 + n * 14) * dayMs + 30 * dayMs)),
          inspectedByTenantUserId: membership.id,
        })
      }
      await tx.insert(ppeInspections).values({
        tenantId: tenant.id,
        itemId: item!.id,
        kind: 'annual',
        result: 'pass',
        inspectedOn: isoDate(new Date(today.getTime() - 200 * dayMs)),
        nextDueOn: isoDate(new Date(today.getTime() + 165 * dayMs)),
        inspectedByTenantUserId: membership.id,
        notes: 'Annual inspection by certified competent person.',
      })

      // For items 1-3 (issued), add the issuance receipt
      if (i <= 3) {
        await tx.insert(ppeIssues).values({
          tenantId: tenant.id,
          itemId: item!.id,
          personId: insertedPeople[i - 1]!.id,
          action: 'issue',
          quantity: 1,
          issuedByTenantUserId: membership.id,
          occurredAt: new Date(today.getTime() - 30 * dayMs),
          note: 'Initial issue at site induction.',
        })
      }
    }
    // An open issue report against harness #2
    await tx.insert(ppeIssueReports).values({
      tenantId: tenant.id,
      itemId: harnessIds[1]!,
      reportedByTenantUserId: membership.id,
      description: 'Frayed webbing noticed on leg strap. Removed from service pending inspection.',
      status: 'open',
    })

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
            { id: 'incidentsDiscussed', type: 'yes_no_comment', label: { en: 'Were recent incidents reviewed?' }, required: true },
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
    const [tv1] = await tx
      .insert(formTemplateVersions)
      .values({
        tenantId: tenant.id,
        templateId: tmpl!.id,
        version: 1,
        schema: toolboxSchema,
        publishedAt: new Date(),
        publishedBy: admin.id,
        changelog: 'Initial version',
      })
      .returning()
    await tx.insert(formAssignments).values({
      tenantId: tenant.id,
      templateId: tmpl!.id,
      mode: 'scheduled',
      cron: '0 7 * * 1-5',
      targetRoleKeys: ['foreman'],
      enabled: true,
      createdBy: admin.id,
    })

    // Sample form responses
    for (let i = 0; i < 4; i++) {
      await tx.insert(formResponses).values({
        tenantId: tenant.id,
        templateId: tmpl!.id,
        templateVersionId: tv1!.id,
        status: i === 0 ? 'submitted' : i === 1 ? 'submitted' : i === 2 ? 'in_progress' : 'closed',
        siteOrgUnitId: i % 2 === 0 ? siteA.id : siteB.id,
        submittedBy: membership.id,
        submittedAt: i < 3 ? new Date(today.getTime() - i * dayMs) : new Date(),
        data: {
          foreman: john!.id,
          attendees: insertedPeople.slice(1, 4).map((p) => p.id),
          topics: [
            { topic: 'Pinch points around tank manways', discussion: 'Always use spotters when handling >50lb lids.' },
            { topic: 'Heat stress', discussion: 'Mandatory 15-min water breaks every hour above 28°C.' },
          ],
          incidentsDiscussed: { answer: 'yes', comment: 'Reviewed near-miss INC-2026-0001.' },
        },
      })
    }

    // --- Incidents (rich) ----------------------------------------------
    const [inc1] = await tx
      .insert(incidents)
      .values({
        tenantId: tenant.id,
        reference: 'INC-2026-0001',
        type: 'near_miss',
        severity: 'no_injury',
        status: 'closed',
        title: 'Hand tool dropped from scaffold',
        description: '8" wrench fell from level-2 scaffold into a barricaded area below pump P-103. No personnel in the drop zone — caught by toe-boards.',
        occurredAt: new Date(today.getTime() - 14 * dayMs),
        reportedAt: new Date(today.getTime() - 14 * dayMs + 2 * 3600 * 1000),
        siteOrgUnitId: siteA.id,
        location: 'P-103 pump bay, north scaffold level 2',
        weather: '17°C, light wind',
        departmentId: fieldOps!.id,
        supervisorPersonId: john!.id,
        witnesses: 'M. Foster, D. Gonzales',
        ppeWorn: 'Hard hat, safety glasses, gloves, fall arrest',
        eventsLeadingUp: 'Working at height removing valve packing. Tool was set down on scaffold deck instead of being tethered. A gust knocked it through the toe-board gap.',
        immediateActionTaken: 'Work stopped. Area inspected. Toe-board gap shimmed. Tool tethering tailgate held immediately after.',
        actualSeverity: 1,
        potentialSeverity: 4,
        rootCause: 'Tool not tethered when set down on scaffold deck.',
        contributingFactors: ['Inadequate toe-board height', 'No tool-tethering policy enforcement'],
        assignedInvestigatorTenantUserId: membership.id,
        inProgress: false,
        locked: true,
        closedAt: new Date(today.getTime() - 10 * dayMs),
        closedByTenantUserId: membership.id,
      })
      .returning()

    const [inc2] = await tx
      .insert(incidents)
      .values({
        tenantId: tenant.id,
        reference: 'INC-2026-0002',
        type: 'injury',
        severity: 'first_aid_only',
        status: 'closed',
        title: 'Cut on right hand while opening crate',
        description: 'Box cutter slipped while opening valve crate. Small laceration to right thumb, treated on site.',
        occurredAt: new Date(today.getTime() - 9 * dayMs),
        siteOrgUnitId: siteA.id,
        location: 'Materials lay-down yard',
        supervisorPersonId: john!.id,
        ppeWorn: 'Cut-resistant gloves (level 3)',
        firstAidReceived: true,
        firstAidProvider: 'L. Iverson (HSE Coordinator)',
        actualSeverity: 2,
        potentialSeverity: 2,
        rootCause: 'Box cutter blade fully extended, no proper cut-resistant glove rating for this task.',
        inProgress: false,
        locked: true,
        closedAt: new Date(today.getTime() - 6 * dayMs),
      })
      .returning()
    await tx.insert(incidentInjuries).values({
      tenantId: tenant.id,
      incidentId: inc2!.id,
      personId: sarah!.id,
      personName: 'Sarah Bell',
      bodyParts: ['Right hand', 'Thumb'],
      injuryTypes: ['Laceration'],
      treatment: 'Wound cleaned, butterfly bandage applied, advised follow-up if redness develops.',
      treatedAtFacility: 'On-site first aid station',
      workedHoursPriorTo: 4,
    })
    await tx.insert(incidentPeople).values({
      tenantId: tenant.id,
      incidentId: inc2!.id,
      personId: sarah!.id,
      role: 'involved',
    })

    const [inc3] = await tx
      .insert(incidents)
      .values({
        tenantId: tenant.id,
        reference: 'INC-2026-0003',
        type: 'injury',
        severity: 'medical_aid',
        status: 'under_investigation',
        title: 'Slip on wet floor in mechanical room',
        description: 'Worker slipped after a hose was left dripping at the access point. Treated at walk-in clinic, x-rays clear.',
        occurredAt: new Date(today.getTime() - 3 * dayMs),
        siteOrgUnitId: siteB.id,
        location: 'Mechanical Room 2A, near east entrance',
        supervisorPersonId: tom!.id,
        witnesses: 'Marcus Chen',
        externalPeopleInvolved: 'None',
        eventsLeadingUp: 'Cleaning crew finished pressure-washing equipment and coiled the hose without draining it. Wet patch wasn\'t flagged with a cone.',
        immediateActionTaken: 'Area mopped, cones placed, hose drained, worker driven to MedExpress clinic.',
        ppeWorn: 'Safety boots (SRC slip-resistant), high-vis vest, hard hat',
        actualSeverity: 3,
        potentialSeverity: 3,
        criticalInjury: false,
        ministryOfLabourNotified: false,
        emsNotified: false,
        firstAidReceived: true,
        firstAidProvider: 'L. Iverson',
        medicalAttentionReceived: true,
        treatedAtHospital: 'MedExpress Walk-In Clinic',
        treatedInCity: 'Toronto',
        transportation: 'Private vehicle (supervisor drove)',
        modifiedDuty: true,
        modifiedDutyFirstDay: isoDate(new Date(today.getTime() - 2 * dayMs)),
        modifiedDutyDays: 3,
        externallyReportable: false,
        rootCause: 'Procedure for hose handling at clean-up did not require draining/coning. Cleaning subcontractor not briefed on site policy.',
        contributingFactors: ['Subcontractor onboarding gap', 'No signage placement standard'],
        inProgress: true,
        locked: false,
        assignedInvestigatorTenantUserId: membership.id,
      })
      .returning()
    await tx.insert(incidentInjuries).values({
      tenantId: tenant.id,
      incidentId: inc3!.id,
      personId: priya!.id,
      personName: 'Priya Desai',
      bodyParts: ['Lower back', 'Left wrist'],
      injuryTypes: ['Strain', 'Bruise'],
      treatment: 'X-ray clear, anti-inflammatories prescribed, modified duty for 3 days.',
      treatedAtFacility: 'MedExpress Walk-In Clinic',
      workedHoursPriorTo: 5,
    })
    await tx.insert(incidentLostTimeEvents).values({
      tenantId: tenant.id,
      incidentId: inc3!.id,
      status: 'restricted_duty',
      validFrom: isoDate(new Date(today.getTime() - 2 * dayMs)),
      validTo: isoDate(new Date(today.getTime() + 1 * dayMs)),
      notes: 'No overhead reaching, no carrying > 5kg.',
    })
    await tx.insert(incidentPeople).values({
      tenantId: tenant.id,
      incidentId: inc3!.id,
      personId: priya!.id,
      role: 'involved',
    })

    const [inc4] = await tx
      .insert(incidents)
      .values({
        tenantId: tenant.id,
        reference: 'INC-2026-0004',
        type: 'property_damage',
        severity: 'no_injury',
        status: 'reported',
        title: 'Forklift bumped overhead conduit',
        description: 'Forklift forks struck low-hanging electrical conduit while turning. Conduit dented; circuit isolated as a precaution.',
        occurredAt: new Date(today.getTime() - 1 * dayMs),
        siteOrgUnitId: siteB.id,
        location: 'Warehouse aisle 3',
        supervisorPersonId: tom!.id,
        immediateActionTaken: 'Forklift parked. Electrical isolated by qualified person. Conduit photographed and tagged.',
        ppeWorn: 'Standard site PPE',
        actualSeverity: 1,
        potentialSeverity: 4,
        inProgress: true,
        locked: false,
      })
      .returning()

    // --- Corrective actions --------------------------------------------
    const caRows = [
      {
        reference: 'CA-2026-0001',
        title: 'Install drip pan + cone protocol for cleaning crew',
        severity: 'high' as const,
        status: 'in_progress' as const,
        daysToDue: 7,
        source: 'incident' as const,
        sourceEntityId: inc3!.id,
        actionTaken: 'Drip pans ordered (ETA 3 days). Cone-placement SOP drafted; awaiting sign-off.',
        rootCause: 'Subcontractor onboarding gap.',
      },
      {
        reference: 'CA-2026-0002',
        title: 'Daily scaffold inspection during turnaround',
        severity: 'high' as const,
        status: 'open' as const,
        daysToDue: 3,
        source: 'jsha' as const,
        actionTaken: null,
        rootCause: null,
      },
      {
        reference: 'CA-2026-0003',
        title: 'Refresh slip-trip awareness in monthly toolbox',
        severity: 'low' as const,
        status: 'open' as const,
        daysToDue: 14,
        source: 'inspection' as const,
        actionTaken: null,
        rootCause: null,
      },
      {
        reference: 'CA-2026-0004',
        title: 'Replace damaged conduit section',
        severity: 'high' as const,
        status: 'pending_verification' as const,
        daysToDue: 1,
        source: 'incident' as const,
        sourceEntityId: inc4!.id,
        actionTaken: 'Conduit section replaced by qualified electrician. Awaiting verification by site safety.',
        rootCause: 'Forklift route clearance not validated against installed services.',
      },
    ]
    for (const c of caRows) {
      await tx.insert(correctiveActions).values({
        tenantId: tenant.id,
        reference: c.reference,
        title: c.title,
        severity: c.severity,
        status: c.status,
        siteOrgUnitId: siteA.id,
        assignedOn: isoDate(new Date(today.getTime() - 5 * dayMs)),
        dueOn: isoDate(new Date(today.getTime() + c.daysToDue * dayMs)),
        source: c.source,
        sourceEntityType: c.source === 'incident' ? 'incident' : null,
        sourceEntityId: (c as any).sourceEntityId ?? null,
        actionTaken: c.actionTaken,
        rootCause: c.rootCause,
        ownerTenantUserId: membership.id,
        assignedByTenantUserId: membership.id,
      })
    }

    // --- Documents ------------------------------------------------------
    const docDefs = [
      { key: 'corporate-hs-policy', title: 'Corporate Health & Safety Policy', category: 'policy', reviewFreq: 12, body: '## Purpose\n\nAcme Industrial is committed to providing a safe and healthy workplace for all employees…' },
      { key: 'sds-acetone', title: 'SDS — Acetone', category: 'sds', reviewFreq: 36, body: '## Acetone — Safety Data Sheet\n\n**Hazard class:** Flammable liquid, category 2…' },
      { key: 'wah-procedure', title: 'Work at Height Procedure', category: 'procedure', reviewFreq: 24, body: '## Scope\n\nThis procedure applies to all work performed >3m above grade…' },
    ]
    for (const d of docDefs) {
      const [doc] = await tx
        .insert(documents)
        .values({
          tenantId: tenant.id,
          key: d.key,
          title: d.title,
          category: d.category,
          status: 'published',
          reviewFrequencyMonths: d.reviewFreq,
          nextReviewOn: isoDate(new Date(today.getTime() + d.reviewFreq * 30 * dayMs - 30 * dayMs)),
          ownerTenantUserId: membership.id,
          printHeader: true,
          printFooter: true,
        })
        .returning()
      const [v1] = await tx
        .insert(documentVersions)
        .values({
          tenantId: tenant.id,
          documentId: doc!.id,
          version: 1,
          contentMarkdown: d.body,
          publishedAt: new Date(today.getTime() - 200 * dayMs),
          publishedBy: admin.id,
          changelog: 'Initial release',
        })
        .returning()
      const [v2] = await tx
        .insert(documentVersions)
        .values({
          tenantId: tenant.id,
          documentId: doc!.id,
          version: 2,
          contentMarkdown: d.body + '\n\n## Revision\n\nUpdated reporting contact emails.',
          publishedAt: new Date(today.getTime() - 30 * dayMs),
          publishedBy: admin.id,
          changelog: 'Updated emergency contact roster',
        })
        .returning()
      // Some acknowledgments
      for (let i = 0; i < 5; i++) {
        await tx.insert(documentAcknowledgments).values({
          tenantId: tenant.id,
          documentId: doc!.id,
          versionId: v2!.id,
          personId: insertedPeople[i]!.id,
          acknowledgedAt: new Date(today.getTime() - (28 - i) * dayMs),
        })
      }
      // Review history
      await tx.insert(documentReviews).values({
        tenantId: tenant.id,
        documentId: doc!.id,
        reviewedByTenantUserId: membership.id,
        reviewedAt: new Date(today.getTime() - 30 * dayMs),
        outcome: 'updated',
        nextReviewOn: isoDate(new Date(today.getTime() + d.reviewFreq * 30 * dayMs)),
        notes: 'Reviewed emergency contact list and updated. No structural changes needed.',
      })
    }

    // --- Plugin catalogue (cross-tenant, but seeded once) ---------------
    await tx
      .insert(plugins)
      .values([
        {
          key: 'netsuite-sync',
          name: 'NetSuite People Sync',
          description: 'Pulls employees + departments + customers from NetSuite on a daily cron.',
          version: '0.1.0',
          capabilities: ['sync.in', 'sync.out'],
          manifest: {},
        },
        {
          key: 'adminapp2-sync',
          name: 'adminapp2 Master Data',
          description: 'Reads internal master data (customers, projects, employees) from your internal admin app.',
          version: '0.1.0',
          capabilities: ['sync.in'],
          manifest: {},
        },
        {
          key: 'webhook-out',
          name: 'Outbound Webhooks',
          description: 'POSTs incident/CA/training events to a configurable URL with HMAC-signed bodies.',
          version: '0.1.0',
          capabilities: ['sync.out'],
          manifest: {},
        },
      ])
      .onConflictDoNothing()

    // --- Welcome notification --------------------
    await tx.insert(notifications).values({
      tenantId: tenant.id,
      userId: admin.id,
      category: 'system',
      type: 'tenant.welcome',
      title: 'Welcome to Acme Industrial',
      body: 'Sample data has been seeded. Click around — every list is paginated/sortable and every row clicks through to a real detail page.',
      linkPath: '/dashboard',
    })

    console.log(`  · tenant: ${tenant.name} (${tenant.slug})`)
    console.log(`  · super-admin: ${admin.email}`)
    console.log(`  · seeded: ${insertedPeople.length} people, ${courses.length} courses, 4 incidents (1 rich), ${caRows.length} CAs, ${docDefs.length} documents w/ versions+acks, 8 equipment, 6 harnesses w/ inspections`)
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
