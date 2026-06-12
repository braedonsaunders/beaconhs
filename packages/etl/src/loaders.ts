// Entity loaders (legacy landing → app schema). Dependency-ordered. Start of the rassaun slice;
// more loaders are appended here as each entity's mapping is finalised (see docs/migration/mapping.md).
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { withSuperAdmin, schema } from '@beaconhs/db'
import { ensureBucket, newAttachmentKey, putObject } from '@beaconhs/storage'
import { H, internals, rowHash, type Loader, type Env } from './orchestrator'
import { source } from './source/landing'

const {
  user,
  tenantUsers,
  personDivisions,
  trades,
  personTitles,
  people,
  orgUnits,
  incidents,
  journalEntries,
  correctiveActions,
  equipmentCategories,
  equipmentTypes,
  equipmentItems,
  documents,
  documentVersions,
  documentTypes,
  documentCategories,
  documentBooks,
  documentBookItems,
  documentReferences,
  documentReferenceTypes,
  documentReferenceCategories,
  attachments,
  trainingCourses,
  trainingRecords,
  trainingClasses,
  trainingClassAttendees,
  trainingAssessmentTypes,
  trainingAssessmentTypeQuestions,
  trainingSkillAuthorities,
  trainingSkillTypes,
  trainingSkillAssignments,
  trainingExtraFields,
  complianceObligations,
  complianceAudience,
  inspectionTypes,
  inspectionBanks,
  inspectionBankCriteria,
  inspectionTypeBanks,
  inspectionRecords,
  inspectionRecordCriteria,
} = schema

const oneOf = (v: unknown, allowed: string[], fallback: string): string => {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, '_')
  return allowed.includes(s) ? s : fallback
}
const slugify = (v: unknown, fallback: string): string =>
  (H.str(v) ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || fallback

const sevFromLegacy = (r: any): string => {
  if (H.bool(r.LostTime)) return 'lost_time'
  if (H.bool(r.MedicalAttention)) return 'medical_aid'
  if (H.bool(r.FirstAid)) return 'first_aid_only'
  return 'no_injury'
}

export const RASSAUN_LOADERS: Loader[] = [
  // ---- lookups ----
  {
    entity: 'person_division',
    srcSchema: 'beaconhs',
    srcTable: 'PEOPLEDIVISION',
    tenant: 'rassaun',
    target: personDivisions,
    map: (r) => ({ name: H.str(r.Name) ?? `Division ${r.id}`, description: H.str(r.Description) }),
  },
  {
    entity: 'trade',
    srcSchema: 'peopleapp',
    srcTable: 'EMPLOYEESTRADES',
    tenant: 'rassaun',
    target: trades,
    map: (r) => ({ name: H.str(r.Name) ?? `Trade ${r.id}` }),
  },
  {
    entity: 'person_title',
    srcSchema: 'beaconhs',
    srcTable: 'PEOPLEJOBTITLE',
    tenant: 'rassaun',
    target: personTitles,
    map: (r) => ({
      name: H.str(r.Name) ?? `Title ${r.id}`,
      description: H.str(r.Scope),
      responsibilities: H.str(r.Responsibilities),
      education: H.str(r.Education),
      experience: H.str(r.Experience),
    }),
  },

  // ---- org units (customer level, named from the adminapp.CUSTOMERS ERP mirror) ----
  {
    entity: 'org_unit',
    srcSchema: 'adminapp',
    srcTable: 'CUSTOMERS',
    tenant: 'rassaun',
    target: orgUnits,
    map: () => null, // handled by custom
    custom: async (env: Env, tenantId: string) => {
      // every customer/location referenced by in-scope beaconHS facts
      const refs: any[] = await source().unsafe(`
        with refs as (
          select distinct "Location"::int loc from beaconhs."INCIDENTLOG" where "Location" is not null
          union select distinct "Customer"::int from beaconhs."DAILYJOURNALS" where "Customer" is not null
        )
        select r.loc as id, c."Customer" as name
        from refs r left join adminapp."CUSTOMERS" c on c.id = r.loc
        where r.loc <> 0 order by r.loc`)
      let upserted = 0
      await withSuperAdmin(env.db, async (tx: any) => {
        const out: any[] = []
        for (const r of refs) {
          const id = await internals.reserve(
            env,
            tx,
            'adminapp',
            'CUSTOMERS',
            r.id,
            'org_unit',
            tenantId,
            rowHash(r),
          )
          out.push({
            id,
            tenantId,
            level: 'customer',
            name: H.str(r.name) ?? `Location ${r.id}`,
            code: String(r.id),
          })
        }
        if (out.length) {
          await tx
            .insert(orgUnits)
            .values(out)
            .onConflictDoUpdate({
              target: orgUnits.id,
              set: internals.buildUpsertSet(orgUnits, Object.keys(out[0])),
            })
          upserted = out.length
        }
      })
      return { source: refs.length, upserted }
    },
  },

  // ---- people ----
  {
    entity: 'person',
    srcSchema: 'peopleapp',
    srcTable: 'EMPLOYEESHR',
    tenant: 'rassaun',
    target: people,
    map: (r) => {
      const nm = H.name(r.FullName ?? r.PayrollName)
      return {
        firstName: nm.first || (H.str(r.PayrollName) ?? 'Unknown'),
        lastName: nm.last || '',
        formalName: H.str(r.PayrollName),
        employeeNo: H.str(r.EmployeeNumber),
        jobTitle: H.str(r.JobTitle),
        hireDate: H.date(r.HireDate),
        dateOfBirth: H.date(r.DOB),
        email: H.str(r.Email),
        phone: H.str(r.Phone),
        emergencyContactName: H.str(r.EmergencyContactName),
        emergencyContactPhone: H.str(r.EmergencyContactNumber),
        status: H.bool(r.EmployeeActive) ? 'active' : 'inactive',
        notes: H.str(r.Notes),
        // SIN intentionally dropped (PII); other non-core fields kept in metadata
        metadata: {
          legacy: 'peopleapp.EMPLOYEESHR',
          division: H.str(r.Division),
          trade: H.str(r.Trade),
          employmentType: H.str(r.EmploymentType),
          address: H.str(r.Address),
          homeLocation: H.str(r.HomeLocation),
          naicsCode: H.str(r.NAICSCode),
          wsibRateGroup: H.str(r.WSIBRateGroup),
          stampNumber: H.str(r.StampNumber),
        },
      }
    },
  },

  // ---- users (beaconhs.users → Better-Auth `user` + `tenant_users`) ----
  {
    entity: 'tenant_user',
    srcSchema: 'beaconhs',
    srcTable: 'users',
    tenant: 'rassaun',
    target: tenantUsers,
    map: () => null,
    custom: async (env: Env, tenantId: string) => {
      const rows: any[] = await source().unsafe('select * from beaconhs."users" order by id')
      let upserted = 0
      await withSuperAdmin(env.db, async (tx: any) => {
        for (const r of rows) {
          const email = H.str(r.email)?.toLowerCase()
          if (!email) continue // Better-Auth users require an email
          // global user (unique by email)
          let u = (
            await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
          )[0]
          if (!u) {
            const ins = await tx
              .insert(user)
              .values({
                id: randomUUID(),
                email,
                name: H.str(r.name) ?? H.str(r.formalname) ?? email,
                emailVerified: true,
                isSuperAdmin: false,
              })
              .onConflictDoNothing({ target: user.email })
              .returning({ id: user.id })
            u =
              ins[0] ??
              (await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1))[0]
          }
          if (!u) continue
          // tenant membership (unique tenant_id+user_id) — reuse if it already exists (e.g. bootstrap admin)
          const displayName = H.str(r.formalname) ?? H.str(r.name)
          const existing = (
            await tx
              .select({ id: tenantUsers.id })
              .from(tenantUsers)
              .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, u.id)))
              .limit(1)
          )[0]
          let tuId: string
          if (existing) {
            tuId = existing.id
            await tx.update(tenantUsers).set({ displayName }).where(eq(tenantUsers.id, tuId))
          } else {
            tuId = randomUUID()
            await tx.insert(tenantUsers).values({
              id: tuId,
              tenantId,
              userId: u.id,
              displayName,
              status: H.bool(r.active) ? 'active' : 'suspended',
              joinedAt: H.ts(r.created_at) ?? new Date(),
            })
          }
          // map crosswalk (beaconhs.users.id → tenant_user id) so child FKs (CA owner, incident reporter…) resolve
          await tx.execute(sql`insert into etl.id_map (source_db, source_table, source_pk, entity_type, tenant_id, new_id, row_hash)
            values ('beaconhs', 'users', ${String(r.id)}, 'tenant_user', ${tenantId}::uuid, ${tuId}::uuid, ${rowHash(r)})
            on conflict (source_db, source_table, source_pk) do update set new_id=excluded.new_id, last_synced_at=now()`)
          upserted++
        }
      })
      return { source: rows.length, upserted }
    },
  },

  // ---- incidents ----
  {
    entity: 'incident',
    srcSchema: 'beaconhs',
    srcTable: 'INCIDENTLOG',
    tenant: 'rassaun',
    target: incidents,
    batch: 500,
    map: async (r, ctx) => ({
      reference: `INC-${r.id}`,
      type: 'injury',
      severity: sevFromLegacy(r),
      status: H.bool(r.ReviewComplete) ? 'closed' : 'reported',
      title: `Incident INC-${r.id}`,
      description: H.str(r.Cause),
      // occurred_at / reported_at are NOT NULL — coalesce so a missing legacy date can't break the row
      occurredAt: H.ts(r.IncidentDate) ?? H.ts(r.ReportedDate) ?? H.ts(r.created_at) ?? new Date(0),
      reportedAt: H.ts(r.ReportedDate) ?? H.ts(r.IncidentDate) ?? H.ts(r.created_at) ?? new Date(0),
      siteOrgUnitId: await ctx.lookup('adminapp', 'CUSTOMERS', r.Location),
      location: H.str(r.LocationOnSite),
      eventsLeadingUp: H.str(r.Events),
      ppeWorn: H.str(r.PPEWorn),
      witnesses: H.str(r.Witnesses),
      foremanText: H.str(r.Foreman),
      reportedByTenantUserId: await ctx.lookup('beaconhs', 'users', r.UserID),
      criticalInjury: H.bool(r.CriticalInjury),
      ministryOfLabourNotified: H.bool(r.MOL),
      emsNotified: H.bool(r.EMS),
      firstAidReceived: H.bool(r.FirstAid),
      firstAidProvider: H.str(r.FirstAidProvider),
      medicalAttentionReceived: H.bool(r.MedicalAttention),
      hospitalName: H.str(r.Hospital),
      treatedInCity: H.str(r.City),
      transportation: H.str(r.Transport),
      lostTime: H.bool(r.LostTime),
      lostTimeFirstDay: H.date(r.LostTimeFirstDay),
      lostTimeLastDay: H.date(r.LostTimeLastDay),
      lostTimeDays: H.int(r.LostTimeDays),
      modifiedDuty: H.bool(r.ModifiedDuty),
      modifiedDutyFirstDay: H.date(r.ModifiedDutyFirstDay),
      modifiedDutyLastDay: H.date(r.ModifiedDutyLastDay),
      modifiedDutyDays: H.int(r.ModifiedDutyDays),
      actualSeverity: H.int(r.KMSeverity),
      potentialSeverity: H.int(r.KMPotentialSeverity),
      externallyReportable: H.bool(r.ExternallyReportable),
    }),
  },

  // ---- journals ----
  {
    entity: 'journal_entry',
    srcSchema: 'beaconhs',
    srcTable: 'DAILYJOURNALS',
    tenant: 'rassaun',
    target: journalEntries,
    batch: 1000,
    map: async (r, ctx) => ({
      reference: `JRN-${r.id}`,
      entryDate: H.date(r.Date) ?? H.date(r.created_at) ?? '1970-01-01',
      definition: /super/i.test(String(r.Definition ?? '')) ? 'supervisor' : 'worker',
      bodyText: H.str(r.Details),
      status: H.bool(r.InProgress) ? 'draft' : 'submitted',
      siteOrgUnitId: await ctx.lookup('adminapp', 'CUSTOMERS', r.Customer),
      personId: await ctx.lookup('peopleapp', 'EMPLOYEESHR', r.EmpID),
      supervisorPersonId: await ctx.lookup('peopleapp', 'EMPLOYEESHR', r.SupervisorID),
      metadata: {
        legacy: 'beaconhs.DAILYJOURNALS',
        username: H.str(r.Username),
        supervisor: H.str(r.Supervisor),
      },
    }),
  },

  // ---- corrective actions ----
  {
    entity: 'corrective_action',
    srcSchema: 'beaconhs',
    srcTable: 'CORRECTIVEACTIONS',
    tenant: 'rassaun',
    target: correctiveActions,
    batch: 1000,
    map: async (r, ctx) => {
      const desc = H.str(r.Description)
      const s = String(r.Status ?? '').toLowerCase()
      const status = s.includes('progress')
        ? 'in_progress'
        : s.includes('cancel')
          ? 'cancelled'
          : s.includes('verif')
            ? 'pending_verification'
            : s.includes('clos') || r.DateClosed
              ? 'closed'
              : 'open'
      return {
        reference: `CA-${r.id}`,
        title: desc?.slice(0, 140) ?? `Corrective Action CA-${r.id}`,
        description: desc,
        severity: oneOf(r.Severity, ['low', 'medium', 'high', 'critical'], 'medium'),
        status,
        source: oneOf(
          r.Source,
          ['inspection', 'incident', 'near_miss', 'observation', 'audit', 'jsha'],
          'other',
        ),
        assignedOn: H.date(r.DateAssigned),
        dueOn: H.date(r.DateDue),
        closedAt: H.ts(r.DateClosed),
        actionTaken: H.str(r.ActionTaken),
        siteOrgUnitId: await ctx.lookup('adminapp', 'CUSTOMERS', r.Jobsite),
        // tenant-user FKs. The feed shows the OWNER as the actor; the app sets owner=creator on create
        // and only changes it on reassignment — so faithfully: owner = assignee, else the raiser/creator.
        ownerTenantUserId:
          (await ctx.lookup('beaconhs', 'users', r.AssignedToID)) ??
          (await ctx.lookup('beaconhs', 'users', r.AssignedByID)),
        assignedByTenantUserId: await ctx.lookup('beaconhs', 'users', r.AssignedByID),
        metadata: {
          legacy: 'beaconhs.CORRECTIVEACTIONS',
          assignedBy: H.str(r.AssignedBy),
          assignedTo: H.str(r.AssignedTo),
          inspectionId: H.str(r.InspectionID),
        },
      }
    },
  },

  // ---- equipment (toolCRIB) ----
  {
    entity: 'equipment_category',
    srcSchema: 'toolcrib',
    srcTable: 'EQUIPMENTCATEGORIES',
    tenant: 'rassaun',
    target: equipmentCategories,
    map: (r) => ({
      name: H.str(r.Name) ?? `Category ${r.id}`,
      slug: slugify(r.Name, `cat-${r.id}`),
      description: H.str(r.Description),
    }),
  },
  {
    entity: 'equipment_type',
    srcSchema: 'toolcrib',
    srcTable: 'EQUIPMENTTYPES',
    tenant: 'rassaun',
    target: equipmentTypes,
    map: (r) => ({ name: H.str(r.Name) ?? `Type ${r.id}`, description: H.str(r.Description) }),
  },
  {
    entity: 'equipment_item',
    srcSchema: 'toolcrib',
    srcTable: 'EQUIPMENT',
    tenant: 'rassaun',
    target: equipmentItems,
    batch: 500,
    // EQUIPMENT.Type is free-text (not an id) → build a name→typeId map. Also collect the asset tags
    // that legacy duplicates, since the new schema enforces unique (tenant_id, asset_tag).
    prepare: async (env: Env, tenantId: string) => {
      const typeMap = new Map<string, string>()
      await withSuperAdmin(env.db, async (tx: any) => {
        const rows = await tx
          .select({ id: equipmentTypes.id, name: equipmentTypes.name })
          .from(equipmentTypes)
          .where(eq(equipmentTypes.tenantId, tenantId))
        for (const r of rows) if (r.name) typeMap.set(String(r.name).toLowerCase(), r.id)
      })
      return { typeMap, seen: new Set<string>() }
    },
    map: (r, ctx) => {
      const p = ctx.prepared as { typeMap: Map<string, string>; seen: Set<string> }
      // new schema enforces unique (tenant_id, asset_tag); legacy allows dupes → suffix the legacy id
      // on any repeat (deterministic, since rows stream in pk order). See gaps.md.
      let assetTag = H.str(r.AssetNumber) ?? H.str(r.TagNumber) ?? `EQ-${r.id}`
      if (p.seen.has(assetTag)) assetTag = `${assetTag} (#${r.id})`
      p.seen.add(assetTag)
      return {
        typeId: p.typeMap.get(String(r.Type ?? '').toLowerCase()) ?? null,
        assetTag,
        qrToken: `bhs-eq-${r.id}`,
        serialNumber: H.str(r.SerialNumber),
        name: H.str(r.Name) ?? `Equipment ${r.id}`,
        description: H.str(r.Description),
        status: H.bool(r.Scrapped)
          ? 'retired'
          : H.bool(r.ReportedMissing)
            ? 'lost'
            : H.bool(r.InService)
              ? 'in_service'
              : 'out_of_service',
        requiresPreUseInspection: H.bool(r.RequiresPreUse),
        requiresAnnualInspection: H.bool(r.RequiresInspection),
        lastAnnualInspectionOn: H.date(r.LastInspection),
        nextAnnualInspectionDue: H.date(r.NextInspectionDue),
        requiresOilChange: H.bool(r.RequiresOilChange),
        oilChangeIntervalMonths: H.int(r.OilChangeIntervalMonths),
        lastOilChangeOn: H.date(r.LastOilChange),
        nextOilChangeDue: H.date(r.NextOilChange),
        purchasePrice: H.num(r.PurchasePrice),
        billingRateCategory: H.str(r.RateCategory),
        isMissing: H.bool(r.ReportedMissing),
        missingLastSeenLocation: H.str(r.LastSeenLocation),
        // ~30 niche legacy columns with no first-class home land in metadata (see gaps.md)
        metadata: {
          legacy: 'toolcrib.EQUIPMENT',
          type: H.str(r.Type),
          category: H.str(r.Category),
          division: H.str(r.Division),
          currentLocation: H.str(r.CurrentLocation),
          licensePlate: H.str(r.LicensePlate),
          assignedTo: H.str(r.AssignedTo),
          odometer: H.num(r.Odometer),
          currentHours: H.str(r.CurrentHours),
          year: H.num(r.Year),
          condition: H.num(r.Condition),
          weight: H.num(r.Weight),
          grossWeight: H.num(r.GrossWeight),
          dims: { l: H.num(r.DimL), w: H.num(r.DimW), h: H.num(r.DimH) },
          ndtLast: H.date(r.NDTLast),
          ndtNext: H.date(r.NDTNext),
          atmosphericEquipment: H.str(r.AtmosphericEquipment),
          sensorIds: [r.Sensor1ID, r.Sensor2ID, r.Sensor3ID, r.Sensor4ID].filter((x) => x),
        },
      }
    },
  },

  // ---- documents (legacy HTML → editor docs) ----
  {
    entity: 'document_category',
    srcSchema: 'beaconhs',
    srcTable: 'DOCUMENTATIONCATEGORY',
    tenant: 'rassaun',
    target: documentCategories,
    map: (r) => ({ name: H.str(r.Name) ?? `Category ${r.id}`, description: H.str(r.Description) }),
  },
  {
    entity: 'document_type',
    srcSchema: 'beaconhs',
    srcTable: 'DOCUMENTATIONTYPE',
    tenant: 'rassaun',
    target: documentTypes,
    map: (r) => ({
      key: slugify(r.Name, `dtype-${r.id}`),
      name: H.str(r.Name) ?? `Type ${r.id}`,
      description: H.str(r.Description),
    }),
  },
  {
    entity: 'document',
    srcSchema: 'beaconhs',
    srcTable: 'DOCUMENTATION',
    tenant: 'rassaun',
    target: documents,
    // documents.category is plain text → resolve the legacy CategoryID to a name
    prepare: async () => {
      const m = new Map<number, string>()
      const rows: any[] = await source().unsafe(
        'select id, "Name" from beaconhs."DOCUMENTATIONCATEGORY"',
      )
      for (const r of rows) m.set(Number(r.id), String(r.Name ?? ''))
      return m
    },
    map: async (r, ctx) => ({
      key: `doc-${r.id}`,
      title: H.str(r.Name) ?? `Document ${r.id}`,
      description: H.str(r.Description),
      category: (ctx.prepared as Map<number, string>)?.get(Number(r.CategoryID)) || null,
      categoryId: await ctx.lookup('beaconhs', 'DOCUMENTATIONCATEGORY', r.CategoryID),
      typeId: await ctx.lookup('beaconhs', 'DOCUMENTATIONTYPE', r.TypeID),
      status: H.bool(r.IsPublished) ? 'published' : 'draft',
      printHeader: H.bool(r.PrintHeader),
      printFooter: H.bool(r.PrintFooter),
    }),
  },
  {
    entity: 'document_version',
    srcSchema: 'beaconhs',
    srcTable: 'DOCUMENTATIONDATA',
    tenant: 'rassaun',
    target: documentVersions,
    map: async (r, ctx) => {
      const documentId = await ctx.lookup('beaconhs', 'DOCUMENTATION', r.DocumentationID)
      if (!documentId) return null // orphan version
      return {
        documentId,
        version: H.int(r.Version) ?? 1,
        contentMarkdown: H.str(r.Data), // legacy rich HTML — see gaps.md M7
        changelog: H.str(r.Changelog),
        publishedAt: H.ts(r.created_at),
      }
    },
  },
  // ---- document books (DOCUMENTATIONBOOK → document_books + document_book_items) ----
  // Legacy books are "smart" definitions: ordered records referencing a Document, a whole
  // document Type (expand to every document of that type), a Reference/Assessment, or a Chapter
  // header whose child records nest via EntityParent. The new model stores explicit document
  // items, so we flatten the tree in reading order and expand Type refs. Reference/Assessment
  // items have no document equivalent → skipped; chapter headers collapse (their docs remain).
  {
    entity: 'document_book',
    srcSchema: 'beaconhs',
    srcTable: 'DOCUMENTATIONBOOK',
    tenant: 'rassaun',
    target: documentBooks,
    map: () => null,
    custom: async (env: Env, tenantId: string) => {
      const src = source()
      const books: any[] = await src.unsafe(
        'select * from beaconhs."DOCUMENTATIONBOOK" order by id',
      )
      const records: any[] = await src.unsafe(
        'select id, "BookID", "Name", "Type", "EntityID", "EntityOrder", "EntityParent" from beaconhs."DOCUMENTATIONBOOKRECORD"',
      )
      const docsByType = new Map<string, number[]>()
      for (const d of await src.unsafe('select id, "TypeID" from beaconhs."DOCUMENTATION"')) {
        const k = String((d as any).TypeID)
        ;(docsByType.get(k) ?? docsByType.set(k, []).get(k)!).push((d as any).id)
      }
      const recsByBook = new Map<string, any[]>()
      for (const r of records) {
        const k = String(r.BookID)
        ;(recsByBook.get(k) ?? recsByBook.set(k, []).get(k)!).push(r)
      }
      let booksN = 0
      let itemsN = 0
      for (const b of books) {
        await withSuperAdmin(env.db, async (tx: any) => {
          const lookup = internals.makeLookup(env, tx)
          const recs = recsByBook.get(String(b.id)) ?? []
          const childrenOf = new Map<string, any[]>()
          const roots: any[] = []
          for (const rec of recs) {
            if (Number(rec.EntityParent) === 0) roots.push(rec)
            else {
              const k = String(rec.EntityParent)
              ;(childrenOf.get(k) ?? childrenOf.set(k, []).get(k)!).push(rec)
            }
          }
          const byOrder = (a: any, z: any) =>
            (H.int(a.EntityOrder) ?? 0) - (H.int(z.EntityOrder) ?? 0)
          roots.sort(byOrder)
          for (const list of childrenOf.values()) list.sort(byOrder)
          const legacyDocIds: number[] = []
          const emit = (rec: any) => {
            const t = String(rec.Type ?? '').toLowerCase()
            if (t === 'document') legacyDocIds.push(Number(rec.EntityID))
            else if (t === 'type')
              legacyDocIds.push(...(docsByType.get(String(rec.EntityID)) ?? []))
            else if (t === 'chapter')
              for (const ch of childrenOf.get(String(rec.id)) ?? []) emit(ch)
          }
          for (const root of roots) emit(root)
          const seen = new Set<string>()
          const docIds: string[] = []
          for (const ld of legacyDocIds) {
            const did = await lookup('beaconhs', 'DOCUMENTATION', ld)
            if (did && !seen.has(did)) {
              seen.add(did)
              docIds.push(did)
            }
          }
          const name = H.str(b.Name) ?? `Book ${b.id}`
          const contents = docIds.map((id) => ({ documentId: id }))
          const bookId = await internals.reserve(
            env,
            tx,
            'beaconhs',
            'DOCUMENTATIONBOOK',
            b.id,
            'document_book',
            tenantId,
            rowHash(b),
          )
          await tx
            .insert(documentBooks)
            .values({
              id: bookId,
              tenantId,
              title: name,
              name,
              description: H.str(b.Description),
              status: 'published',
              publishedAt: H.ts(b.created_at) ?? new Date(),
              contents,
            })
            .onConflictDoUpdate({
              target: documentBooks.id,
              set: { title: name, name, description: H.str(b.Description), contents },
            })
          booksN++
          await tx.delete(documentBookItems).where(eq(documentBookItems.bookId, bookId))
          if (docIds.length) {
            await tx
              .insert(documentBookItems)
              .values(docIds.map((did, i) => ({ tenantId, bookId, documentId: did, position: i })))
            itemsN += docIds.length
          }
        })
      }
      console.log(`[${booksN} books, ${itemsN} items] `)
      return { source: books.length, upserted: booksN }
    },
  },
  {
    entity: 'document_reference_category',
    srcSchema: 'beaconhs',
    srcTable: 'DOCUMENTATIONREFERENCECATEGORY',
    tenant: 'rassaun',
    target: documentReferenceCategories,
    map: (r) => ({ name: H.str(r.Name) ?? `Category ${r.id}`, description: H.str(r.Description) }),
  },
  {
    entity: 'document_reference_type',
    srcSchema: 'beaconhs',
    srcTable: 'DOCUMENTATIONREFERENCETYPE',
    tenant: 'rassaun',
    target: documentReferenceTypes,
    map: (r) => ({
      key: slugify(r.Name, `rtype-${r.id}`),
      name: H.str(r.Name) ?? `Type ${r.id}`,
      description: H.str(r.Description),
    }),
  },
  // The physical PDFs: download from Azure Blob → put to R2/MinIO → attachments + document_references.
  {
    entity: 'document_reference',
    srcSchema: 'beaconhs',
    srcTable: 'DOCUMENTATIONREFERENCE',
    tenant: 'rassaun',
    target: documentReferences,
    map: () => null,
    custom: async (env: Env, tenantId: string) => {
      await ensureBucket()
      const rows: any[] = await source().unsafe(
        'select * from beaconhs."DOCUMENTATIONREFERENCE" order by id',
      )
      let upserted = 0
      let files = 0
      let failed = 0
      const CONC = 6
      for (let i = 0; i < rows.length; i += CONC) {
        await Promise.all(
          rows.slice(i, i + CONC).map(async (r) => {
            const url = H.str(r.URL)
            const filename = H.str(r.Filename) ?? `ref-${r.id}.pdf`
            let attachmentId: string | null = null
            let kind = 'url'
            if (url && /^https?:/i.test(url)) {
              try {
                const res = await fetch(url)
                if (res.ok) {
                  const buf = Buffer.from(await res.arrayBuffer())
                  const ct = res.headers.get('content-type') ?? 'application/pdf'
                  const key = newAttachmentKey({ tenantId, kind: 'document', filename })
                  await putObject({ key, body: buf, contentType: ct })
                  await withSuperAdmin(env.db, async (tx: any) => {
                    attachmentId = await internals.reserve(
                      env,
                      tx,
                      'beaconhs',
                      'DOCUMENTATIONREFERENCE_FILE',
                      r.id,
                      'attachment',
                      tenantId,
                      rowHash(r),
                    )
                    await tx
                      .insert(attachments)
                      .values({
                        id: attachmentId,
                        tenantId,
                        kind: 'document',
                        r2Key: key,
                        contentType: ct,
                        sizeBytes: buf.length,
                        filename,
                      })
                      .onConflictDoUpdate({
                        target: attachments.id,
                        set: { r2Key: key, sizeBytes: buf.length, filename },
                      })
                  })
                  kind = 'attachment'
                  files++
                } else failed++
              } catch {
                failed++
              }
            }
            await withSuperAdmin(env.db, async (tx: any) => {
              const lookup = internals.makeLookup(env, tx)
              const refId = await internals.reserve(
                env,
                tx,
                'beaconhs',
                'DOCUMENTATIONREFERENCE',
                r.id,
                'document_reference',
                tenantId,
                rowHash(r),
              )
              await tx
                .insert(documentReferences)
                .values({
                  id: refId,
                  tenantId,
                  title: H.str(r.Name) ?? `Reference ${r.id}`,
                  description: H.str(r.Description),
                  kind,
                  attachmentId,
                  url: kind === 'url' ? url : null,
                  typeId: await lookup('beaconhs', 'DOCUMENTATIONREFERENCETYPE', r.TypeID),
                })
                .onConflictDoUpdate({
                  target: documentReferences.id,
                  set: { kind, attachmentId, url: kind === 'url' ? url : null },
                })
            })
            upserted++
          }),
        )
      }
      console.log(`[files: ${files} uploaded, ${failed} failed] `)
      return { source: rows.length, upserted }
    },
  },

  // ---- training: courses + records ----
  {
    entity: 'training_course',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGCOURSE',
    tenant: 'rassaun',
    target: trainingCourses,
    map: (r) => {
      const ty = String(r.Type ?? '').toLowerCase()
      const deliveryType = /external/.test(ty)
        ? 'external_certificate'
        : /self|online|e-?learn/.test(ty)
          ? 'self_paced'
          : 'classroom'
      const expiryYears = H.int(r.Expiry)
      return {
        code: H.str(r.Shortform) ?? `TC-${r.id}`,
        name: H.str(r.Name) ?? `Course ${r.id}`,
        description: H.str(r.Description),
        deliveryType,
        // legacy "Expiry" is in years; the new column is months
        validForMonths: H.bool(r.DoesExpire) && expiryYears ? expiryYears * 12 : null,
        requiresEvaluator: false,
        metadata: {
          legacy: 'beaconhs.TRAININGCOURSE',
          type: H.str(r.Type),
          trainer: H.str(r.Trainer),
          expiryYears,
          doesExpire: H.bool(r.DoesExpire),
          certTemplate: H.str(r.CertificateDetailsTemplate),
        },
      }
    },
  },
  {
    entity: 'training_record',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGRECORDS',
    tenant: 'rassaun',
    target: trainingRecords,
    batch: 1000,
    map: async (r, ctx) => {
      // person_id + course_id are NOT NULL — skip the few orphans (24 null course / 3 null emp)
      const personId = await ctx.lookup('peopleapp', 'EMPLOYEESHR', r.EmpID)
      const courseId = await ctx.lookup('beaconhs', 'TRAININGCOURSE', r.CourseID)
      if (!personId || !courseId) return null
      const ct = String(r.CertificateType ?? '').toLowerCase()
      return {
        personId,
        courseId,
        source: 'migrated',
        completedOn: H.date(r.TrainDate) ?? H.date(r.created_at) ?? '1970-01-01',
        expiresOn: H.date(r.ExpiryDate),
        score: H.int(r.ScorePercent),
        instructor: H.str(r.Trainer),
        evaluatorPersonId: await ctx.lookup('peopleapp', 'EMPLOYEESHR', r.EvaluatorID),
        certificateType: /auto/.test(ct) ? 'auto' : /photo/.test(ct) ? 'photo' : null,
        details: H.str(r.CertificateDetails),
        notes: H.str(r.CourseName),
      }
    },
  },
  // training classes (scheduled sessions) — beaconhs.TRAININGCLASSES
  {
    entity: 'training_class',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGCLASSES',
    tenant: 'rassaun',
    target: trainingClasses,
    batch: 1000,
    prepare: async (env: Env, tenantId: string) => {
      const m = new Map<string, string>()
      await withSuperAdmin(env.db, async (tx: any) => {
        const rows = await tx
          .select({ id: trainingCourses.id, name: trainingCourses.name })
          .from(trainingCourses)
          .where(eq(trainingCourses.tenantId, tenantId))
        for (const r of rows) m.set(r.id, r.name)
      })
      return m
    },
    map: async (r, ctx) => {
      const courseId = await ctx.lookup('beaconhs', 'TRAININGCOURSE', r.CourseID)
      if (!courseId) return null // course_id is NOT NULL
      const starts = H.ts(r.Date) ?? H.ts(r.created_at) ?? new Date(0)
      const tm = H.str(r.Time)
        ?.trim()
        ?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i) // "7:30 AM" → set the time-of-day (approx, stored UTC)
      if (tm) {
        let h = Number(tm[1]) % 12
        if (/pm/i.test(tm[3] ?? '')) h += 12
        starts.setUTCHours(h, Number(tm[2]), 0, 0)
      }
      const hours = H.num(r.Hours) ?? H.num(r.Length) ?? 1
      const ends = new Date(starts.getTime() + Math.max(0.5, hours) * 3600 * 1000)
      const st = String(r.Status ?? '').toLowerCase()
      const notes = [H.str(r.Location), H.str(r.Trainer) ? `Trainer: ${H.str(r.Trainer)}` : null]
        .filter(Boolean)
        .join(' · ')
      return {
        courseId,
        title:
          H.str(r.ClassLabel) ??
          H.str(r.CourseName) ??
          (ctx.prepared as Map<string, string>)?.get(courseId) ??
          `Class ${r.id}`,
        startsAt: starts,
        endsAt: ends,
        cancelledAt: /cancel/.test(st) ? starts : null,
        completedAt: /complet|closed|done|attend/.test(st) ? ends : null,
        notes: notes || null,
      }
    },
  },
  // class attendees — beaconhs.TRAININGATTENDEES
  {
    entity: 'training_class_attendee',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGATTENDEES',
    tenant: 'rassaun',
    target: trainingClassAttendees,
    batch: 1000,
    map: async (r, ctx) => {
      const classId = await ctx.lookup('beaconhs', 'TRAININGCLASSES', r.ClassID)
      const personId = await ctx.lookup('peopleapp', 'EMPLOYEESHR', r.EmpID)
      if (!classId || !personId) return null // both NOT NULL
      return { classId, personId, status: H.bool(r.Attended) ? 'attended' : 'registered' }
    },
  },

  // ---- training skills (authorities → skill types → per-person grants) ----
  {
    entity: 'training_skill_authority',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGSKILLAUTHORITY',
    tenant: 'rassaun',
    target: trainingSkillAuthorities,
    map: (r) => ({
      name: H.str(r.Name) ?? `Authority ${r.id}`,
      code: H.str(r.Shortform),
      notes: H.str(r.Description),
    }),
  },
  {
    entity: 'training_skill_type',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGSKILLTYPE',
    tenant: 'rassaun',
    target: trainingSkillTypes,
    map: async (r, ctx) => {
      const authorityId = await ctx.lookup('beaconhs', 'TRAININGSKILLAUTHORITY', r.AuthorityID)
      if (!authorityId) return null // authority_id is NOT NULL
      const yrs = H.int(r.ValidLength) // legacy ValidLength is in years
      return {
        authorityId,
        name: H.str(r.Name) ?? `Skill ${r.id}`,
        code: H.str(r.Shortform),
        validForMonths: H.bool(r.DoesExpire) && yrs ? yrs * 12 : null,
        description: H.str(r.Description),
      }
    },
  },
  {
    entity: 'training_skill_assignment',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGSKILLRECORDS',
    tenant: 'rassaun',
    target: trainingSkillAssignments,
    batch: 1000,
    map: async (r, ctx) => {
      const personId = await ctx.lookup('peopleapp', 'EMPLOYEESHR', r.EmpID)
      const skillTypeId = await ctx.lookup('beaconhs', 'TRAININGSKILLTYPE', r.TypeID)
      if (!personId || !skillTypeId) return null // person_id + skill_type_id are NOT NULL
      return {
        personId,
        skillTypeId,
        grantedOn: H.date(r.TrainDate) ?? H.date(r.created_at) ?? '1970-01-01',
        expiresOn: H.date(r.ExpiryDate),
        notes: [H.str(r.Status), H.str(r.Certificate)].filter(Boolean).join(' · ') || null,
      }
    },
  },
  // per-cert custom fields (e.g. Position=F/H/V/O) → polymorphic extra fields on the skill grant
  {
    entity: 'training_extra_field',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGSKILLADDITIONAL',
    tenant: 'rassaun',
    target: trainingExtraFields,
    batch: 1000,
    map: async (r, ctx) => {
      // Per-cert custom answers (Position, Level, …). TrainingSkillID → the migrated grant.
      // ~1000 source rows are skipped on purpose: their parent skill record was deleted from the
      // legacy DB (orphaned answers, no cert to attach to), plus 39 rows with TrainingSkillID=0 are
      // authority field *definitions* keyed on an unmapped field-group id (46/49/52), not user data.
      const fieldKey = H.str(r.AdditionalField)
      if (!fieldKey || !r.TrainingSkillID || Number(r.TrainingSkillID) <= 0) return null
      const ownerId = await ctx.lookup('beaconhs', 'TRAININGSKILLRECORDS', r.TrainingSkillID)
      if (!ownerId) return null
      return {
        ownerType: 'skill',
        ownerId,
        fieldKey,
        fieldValue: H.str(r.Answer) ?? H.str(r.Answers),
        sortOrder: H.int(r.EntityOrder) ?? 0,
      }
    },
  },
  // ---- training REQUIREMENTS → unified compliance engine ----
  // Course requirements (TRAININGASSIGNMENT) + skill requirements (TRAININGSKILLASSIGNMENT) become
  // compliance_obligations; their audience records (Group/Individual/Division) expand to explicit
  // person audience rows (the engine has no group/division kind). The engine evaluates them live
  // against training_records (courses) / training_skill_assignments (skills). Evaluators are a
  // signature/capability list, not an obligation → not folded in.
  {
    entity: 'compliance_training_requirement',
    srcSchema: 'beaconhs',
    srcTable: 'TRAININGASSIGNMENT',
    tenant: 'rassaun',
    target: complianceObligations,
    map: () => null,
    custom: async (env: Env, tenantId: string) => {
      const src = source()
      // --- legacy audience-membership maps (resolve Group/Division → legacy EmpIDs) ---
      const groupMembers = new Map<string, number[]>()
      for (const g of await src.unsafe(
        'select "GroupID","EmpID" from beaconhs."PEOPLEGROUPRECORD"',
      )) {
        const k = String(g.GroupID)
        ;(groupMembers.get(k) ?? groupMembers.set(k, []).get(k)!).push(g.EmpID)
      }
      const divisionName = new Map<string, string>()
      for (const d of await src.unsafe('select id, "Name" from beaconhs."PEOPLEDIVISION"'))
        divisionName.set(String(d.id), String(d.Name ?? '').trim())
      const empsByDivision = new Map<string, number[]>() // EMPLOYEESHR.Division is the division NAME (no id FK)
      for (const e of await src.unsafe(
        'select id, "Division" from peopleapp."EMPLOYEESHR" where "Division" is not null',
      )) {
        const k = String(e.Division).trim()
        ;(empsByDivision.get(k) ?? empsByDivision.set(k, []).get(k)!).push(e.id)
      }
      // expand one audience record (Type, EntityID) → legacy EmpIDs
      const empsFor = (type: unknown, entityId: unknown): number[] => {
        const t = String(type ?? '').toLowerCase()
        if (t === 'individual') return [Number(entityId)]
        if (t === 'group') return groupMembers.get(String(entityId)) ?? []
        if (t === 'division') {
          const nm = divisionName.get(String(entityId))
          return nm ? (empsByDivision.get(nm) ?? []) : []
        }
        return []
      }
      // titles + course-expiry lookups
      const courseName = new Map<string, string>()
      const courseExpires = new Map<string, boolean>()
      for (const c of await src.unsafe(
        'select id, "Name","DoesExpire" from beaconhs."TRAININGCOURSE"',
      )) {
        courseName.set(String(c.id), H.str(c.Name) ?? `Course ${c.id}`)
        courseExpires.set(String(c.id), H.bool(c.DoesExpire))
      }
      const skillTypeName = new Map<string, string>()
      for (const s of await src.unsafe('select id, "Name" from beaconhs."TRAININGSKILLTYPE"'))
        skillTypeName.set(String(s.id), H.str(s.Name) ?? `Skill ${s.id}`)

      let obligations = 0
      let audienceTotal = 0
      let sourceRows = 0

      const loadReqs = async (opts: {
        assignTable: string
        recordTable: string
        mkTarget: (
          a: any,
          lookup: (sd: string, st: string, pk: unknown) => Promise<string | null>,
        ) => Promise<{ targetRef: Record<string, unknown>; title: string; cert: boolean } | null>
      }) => {
        const assigns: any[] = await src.unsafe(
          `select * from beaconhs."${opts.assignTable}" order by id`,
        )
        const records: any[] = await src.unsafe(`select * from beaconhs."${opts.recordTable}"`)
        const recsByAssign = new Map<string, any[]>()
        for (const r of records) {
          const k = String(r.AssignmentID)
          ;(recsByAssign.get(k) ?? recsByAssign.set(k, []).get(k)!).push(r)
        }
        sourceRows += assigns.length
        for (const a of assigns) {
          await withSuperAdmin(env.db, async (tx: any) => {
            const lookup = internals.makeLookup(env, tx)
            const built = await opts.mkTarget(a, lookup)
            if (!built) return
            const obId = await internals.reserve(
              env,
              tx,
              'beaconhs',
              opts.assignTable,
              a.id,
              'compliance_obligation',
              tenantId,
              rowHash(a),
            )
            const recurrence = built.cert
              ? { kind: 'expiry', remindBeforeDays: 30 }
              : { kind: 'one_time' }
            const sourceModule = built.cert ? 'cert_requirement' : 'training'
            await tx
              .insert(complianceObligations)
              .values({
                id: obId,
                tenantId,
                sourceModule,
                subjectKind: 'per_person',
                title: built.title,
                notes: H.str(a.Notes),
                status: 'active',
                targetRef: built.targetRef,
                recurrence,
                recurrenceKind: recurrence.kind,
                legacyTable: `beaconhs.${opts.assignTable}`,
              })
              .onConflictDoUpdate({
                target: complianceObligations.id,
                set: {
                  sourceModule,
                  title: built.title,
                  notes: H.str(a.Notes),
                  targetRef: built.targetRef,
                  recurrence,
                  recurrenceKind: recurrence.kind,
                },
              })
            obligations++
            // audience: expand each record → person uuids, dedupe, upsert (ignore dup person rows)
            const personIds = new Set<string>()
            for (const rec of recsByAssign.get(String(a.id)) ?? []) {
              for (const emp of empsFor(rec.Type, rec.EntityID)) {
                const pid = await lookup('peopleapp', 'EMPLOYEESHR', emp)
                if (pid) personIds.add(pid)
              }
            }
            if (personIds.size) {
              await tx
                .insert(complianceAudience)
                .values(
                  Array.from(personIds).map((pid) => ({
                    tenantId,
                    obligationId: obId,
                    kind: 'person',
                    entityKey: pid,
                  })),
                )
                .onConflictDoNothing({
                  target: [
                    complianceAudience.obligationId,
                    complianceAudience.kind,
                    complianceAudience.entityKey,
                  ],
                })
              audienceTotal += personIds.size
            }
          })
        }
      }

      // course requirements
      await loadReqs({
        assignTable: 'TRAININGASSIGNMENT',
        recordTable: 'TRAININGASSIGNMENTRECORD',
        mkTarget: async (a, lookup) => {
          const courseId = await lookup('beaconhs', 'TRAININGCOURSE', a.CourseID)
          if (!courseId) return null
          return {
            targetRef: { courseId, trainingItemKind: 'course' },
            title: courseName.get(String(a.CourseID)) ?? `Course ${a.CourseID}`,
            cert: courseExpires.get(String(a.CourseID)) ?? false,
          }
        },
      })
      // skill requirements (cert_requirement satisfied by a valid skill grant)
      await loadReqs({
        assignTable: 'TRAININGSKILLASSIGNMENT',
        recordTable: 'TRAININGSKILLASSIGNMENTRECORD',
        mkTarget: async (a, lookup) => {
          const skillTypeId = await lookup('beaconhs', 'TRAININGSKILLTYPE', a.TypeID)
          if (!skillTypeId) return null
          return {
            targetRef: { skillTypeId },
            title: skillTypeName.get(String(a.TypeID)) ?? `Skill ${a.TypeID}`,
            cert: true,
          }
        },
      })

      console.log(`[${obligations} obligations, ${audienceTotal} audience] `)
      return { source: sourceRows, upserted: obligations }
    },
  },

  // ---- inspections: types → bank/criteria templates → records → per-criterion responses ----
  {
    entity: 'inspection_type',
    srcSchema: 'beaconhs',
    srcTable: 'INSPECTIONSTYPES',
    tenant: 'rassaun',
    target: inspectionTypes,
    map: (r) => ({
      name: H.str(r.Name) ?? `Inspection Type ${r.id}`,
      description: H.str(r.Description),
      requiresForeman: false,
      requiresCustomerSignature: H.bool(r.CustomerSignature),
      enableCorrectiveActions: H.bool(r.EnableCorrectiveActions),
      allowCompliantNotes: H.bool(r.CompliantNotes),
      isPublished: true,
    }),
  },
  // criteria template: one bank per type; legacy Groups become section prefixes on each criterion.
  {
    entity: 'inspection_bank',
    srcSchema: 'beaconhs',
    srcTable: 'INSPECTIONSTYPESRECORDS',
    tenant: 'rassaun',
    target: inspectionBanks,
    map: () => null,
    custom: async (env: Env, tenantId: string) => {
      const src = source()
      const types: any[] = await src.unsafe(
        'select id, "Name" from beaconhs."INSPECTIONSTYPES" order by id',
      )
      const recs: any[] = await src.unsafe(
        'select id, "InspectionTypeID", "Criteria", "EntityParent", "EntityOrder", "Type" from beaconhs."INSPECTIONSTYPESRECORDS" order by "InspectionTypeID", "EntityOrder"',
      )
      const groupName = new Map<string, string>()
      for (const g of recs)
        if (String(g.Type).toLowerCase() === 'group')
          groupName.set(String(g.id), H.str(g.Criteria) ?? '')
      let banks = 0
      let crits = 0
      await withSuperAdmin(env.db, async (tx: any) => {
        const lookup = internals.makeLookup(env, tx)
        for (const t of types) {
          const typeId = await lookup('beaconhs', 'INSPECTIONSTYPES', t.id)
          if (!typeId) continue
          const bankName = (H.str(t.Name) ?? `Type ${t.id}`) + ' Checklist'
          const bankId = await internals.reserve(
            env,
            tx,
            'beaconhs',
            'INSPECTIONSTYPES_BANK',
            t.id,
            'inspection_bank',
            tenantId,
            '',
          )
          await tx
            .insert(inspectionBanks)
            .values({
              id: bankId,
              tenantId,
              name: bankName,
              category: 'site_inspection',
              isPublished: true,
            })
            .onConflictDoUpdate({ target: inspectionBanks.id, set: { name: bankName } })
          const tbId = await internals.reserve(
            env,
            tx,
            'beaconhs',
            'INSPECTIONSTYPES_TB',
            t.id,
            'inspection_type_bank',
            tenantId,
            '',
          )
          await tx
            .insert(inspectionTypeBanks)
            .values({ id: tbId, tenantId, typeId, bankId, sequence: 0 })
            .onConflictDoUpdate({ target: inspectionTypeBanks.id, set: { bankId } })
          banks++
          let seq = 0
          for (const c of recs) {
            if (
              String(c.InspectionTypeID) !== String(t.id) ||
              String(c.Type).toLowerCase() !== 'criteria'
            )
              continue
            const gname =
              c.EntityParent && Number(c.EntityParent) > 0
                ? groupName.get(String(c.EntityParent))
                : null
            const text = (gname ? `${gname}: ` : '') + (H.str(c.Criteria) ?? 'Criterion')
            const critId = await internals.reserve(
              env,
              tx,
              'beaconhs',
              'INSPECTIONSTYPESRECORDS',
              c.id,
              'inspection_bank_criterion',
              tenantId,
              '',
            )
            await tx
              .insert(inspectionBankCriteria)
              .values({
                id: critId,
                tenantId,
                bankId,
                sequence: seq,
                text,
                responseType: 'pass_fail_na',
                requiresPhoto: false,
                requiresComment: false,
              })
              .onConflictDoUpdate({
                target: inspectionBankCriteria.id,
                set: { text, bankId, sequence: seq },
              })
            seq++
            crits++
          }
        }
      })
      console.log(`[${banks} banks, ${crits} criteria] `)
      return { source: recs.length, upserted: banks + crits }
    },
  },
  // inspection records (the history). Free-form per-inspection Q&A folded into metadata.
  {
    entity: 'inspection_record',
    srcSchema: 'beaconhs',
    srcTable: 'JOBSITEINSPECTIONS',
    tenant: 'rassaun',
    target: inspectionRecords,
    batch: 500,
    prepare: async () => {
      const m = new Map<string, { q: string | null; a: string | null }[]>()
      for (const q of await source().unsafe(
        'select "InspectionID", "Question", "Answer", "QuestionOrder" from beaconhs."INSPECTIONSQUESTIONS" order by "InspectionID", "QuestionOrder"',
      )) {
        const k = String((q as any).InspectionID)
        const arr = m.get(k) ?? m.set(k, []).get(k)!
        arr.push({ q: H.str((q as any).Question), a: H.str((q as any).Answer) })
      }
      return m
    },
    map: async (r, ctx) => {
      const typeId = await ctx.lookup('beaconhs', 'INSPECTIONSTYPES', r.InspectionTypeID)
      if (!typeId) return null // type_id NOT NULL
      const occurredAt = H.ts(r.DateTime) ?? H.ts(r.created_at) ?? new Date(0)
      const inProgress = H.bool(r.InProgress)
      const customerOu = await ctx.lookup('adminapp', 'CUSTOMERS', r.Customer)
      return {
        reference: `INS-${r.id}`,
        typeId,
        status: inProgress ? 'in_progress' : 'submitted',
        locked: !inProgress,
        occurredAt,
        siteOrgUnitId: customerOu,
        customerOrgUnitId: customerOu,
        inspectorTenantUserId: await ctx.lookup('beaconhs', 'users', r.UserID),
        supervisorTenantUserId: await ctx.lookup('beaconhs', 'users', r.SupervisorID),
        foremanText: H.str(r.Foreman),
        customerContactName: H.str(r.CustomerContact),
        customerSignatureDataUrl: H.str(r.CustomerSignature),
        notes: H.str(r.GeneralNotes),
        submittedAt: inProgress ? null : (H.ts(r.updated_at) ?? occurredAt),
        metadata: {
          legacy: 'JOBSITEINSPECTIONS',
          jobsite: H.str(r.Jobsite),
          locationOnSite: H.str(r.LocationOnSite),
          superintendent: H.str(r.Superintendent),
          workers: H.str(r.Workers),
          vehicles: H.str(r.Vehicles),
          weather: H.str(r.Weather),
          jobScope: H.str(r.JobScope),
          hazId: H.str(r.HazID),
          equipmentNotes: H.str(r.EquipmentNotes),
          siteContact: H.str(r.SiteContact),
          inspectorName: H.str(r.Username),
          questions: (ctx.prepared as Map<string, unknown[]>)?.get(String(r.id)) ?? [],
        },
      }
    },
  },
  // per-criterion responses (391k). Denormalised: legacy stores the question text inline + answer +
  // severity + a link to the migrated corrective action. prepare() pre-warms the FK cache.
  {
    entity: 'inspection_record_criterion',
    srcSchema: 'beaconhs',
    srcTable: 'JOBSITEINSPECTIONSCRITERIA',
    tenant: 'rassaun',
    target: inspectionRecordCriteria,
    batch: 2000,
    prepare: async (env: Env) => {
      const rows: any[] =
        await env.tsql`select source_table, source_pk, new_id from etl.id_map where source_db='beaconhs' and source_table in ('JOBSITEINSPECTIONS','CORRECTIVEACTIONS')`
      for (const r of rows) env.cache.set(`beaconhs.${r.source_table}.${r.source_pk}`, r.new_id)
      return null
    },
    map: async (r, ctx) => {
      const recordId = await ctx.lookup('beaconhs', 'JOBSITEINSPECTIONS', r.InspectionID)
      if (!recordId) return null // record_id NOT NULL — skip responses whose inspection was dropped
      const ans = String(r.Answer ?? '').toLowerCase()
      const answer =
        ans === 'yes'
          ? 'pass'
          : ans === 'no'
            ? 'fail'
            : ans === 'n/a' || ans === 'na'
              ? 'n_a'
              : null
      const sev = String(r.Severity ?? '').toLowerCase()
      const severity = ['low', 'medium', 'high', 'critical'].includes(sev) ? sev : null
      return {
        recordId,
        criterionId: null, // legacy stores the question text inline, not a bank-criterion id
        questionTextSnapshot: H.str(r.Question) ?? '(question)',
        sequence: H.int(r.QuestionOrder) ?? 0,
        answer,
        severity: answer === 'fail' ? severity : null,
        nonComplianceDescription: H.str(r.NonComplianceReason),
        actionTaken: H.str(r.ActionTaken),
        compliantNote: H.str(r.CompliantNotes),
        correctiveActionId: await ctx.lookup('beaconhs', 'CORRECTIVEACTIONS', r.CorrectiveID),
        photoAttachmentIds: [],
      }
    },
  },
]

// ===================== ExternalTraining DB → `external-training` tenant =====================
// Source schema `externaltraining`; its own CUSTOMERS / PEOPLE / quiz structure.
export const EXTERNAL_TRAINING_LOADERS: Loader[] = [
  // org units = ExternalTraining customers (the external client orgs)
  {
    entity: 'org_unit',
    srcSchema: 'externaltraining',
    srcTable: 'CUSTOMERS',
    tenant: 'external-training',
    target: orgUnits,
    map: (r) => ({
      level: 'customer',
      name: H.str(r.Customer) ?? `Customer ${r.id}`,
      code: String(r.id),
      address: { line1: H.str(r.Address), formatted: H.str(r.FormattedAddress) },
      metadata: {
        legacy: 'externaltraining.CUSTOMERS',
        industry: H.str(r.Industry),
        website: H.str(r.Website),
        active: H.bool(r.isActive),
      },
    }),
  },
  // people lookups
  {
    entity: 'person_division',
    srcSchema: 'externaltraining',
    srcTable: 'PEOPLEDIVISION',
    tenant: 'external-training',
    target: personDivisions,
    map: (r) => ({ name: H.str(r.Name) ?? `Division ${r.id}`, description: H.str(r.Description) }),
  },
  {
    entity: 'trade',
    srcSchema: 'externaltraining',
    srcTable: 'PEOPLETRADES',
    tenant: 'external-training',
    target: trades,
    map: (r) => ({ name: H.str(r.Name) ?? `Trade ${r.id}` }),
  },
  {
    entity: 'person_title',
    srcSchema: 'externaltraining',
    srcTable: 'PEOPLEJOBTITLE',
    tenant: 'external-training',
    target: personTitles,
    map: (r) => ({
      name: H.str(r.Name) ?? `Title ${r.id}`,
      description: H.str(r.Scope),
      responsibilities: H.str(r.Responsibilities),
      education: H.str(r.Education),
      experience: H.str(r.Experience),
    }),
  },
  // people
  {
    entity: 'person',
    srcSchema: 'externaltraining',
    srcTable: 'PEOPLE',
    tenant: 'external-training',
    target: people,
    map: async (r, ctx) => {
      const nm = H.name(r.PayrollName)
      return {
        firstName: nm.first || (H.str(r.PayrollName) ?? 'Unknown'),
        lastName: nm.last || '',
        formalName: H.str(r.PayrollName),
        email: H.str(r.Email),
        phone: H.str(r.Phone),
        dateOfBirth: H.date(r.DOB),
        tradeId: await ctx.lookup('externaltraining', 'PEOPLETRADES', r.TradeID),
        emergencyContactName: H.str(r.EmergencyContactName),
        emergencyContactPhone: H.str(r.EmergencyContactNumber),
        status: H.bool(r.EmployeeActive) ? 'active' : 'inactive',
        notes: H.str(r.Notes),
        metadata: {
          legacy: 'externaltraining.PEOPLE',
          customerId: r.CustomerID,
          divisionId: r.DivisionID,
          jobTitleId: r.JobTitleID,
          address: H.str(r.Address),
        },
      }
    },
  },
  // training courses
  {
    entity: 'training_course',
    srcSchema: 'externaltraining',
    srcTable: 'TRAININGCOURSE',
    tenant: 'external-training',
    target: trainingCourses,
    map: (r) => {
      const expiryYears = H.int(r.Expiry)
      return {
        code: H.str(r.Shortform) ?? `TC-${r.id}`,
        name: H.str(r.Name) ?? `Course ${r.id}`,
        description: H.str(r.Description),
        deliveryType: 'classroom',
        validForMonths: H.bool(r.DoesExpire) && expiryYears ? expiryYears * 12 : null,
        requiresEvaluator: false,
        metadata: {
          legacy: 'externaltraining.TRAININGCOURSE',
          trainer: H.str(r.Trainer),
          capacity: H.int(r.Capacity),
          pricePerPerson: H.num(r.PricePerPerson),
          expiryYears,
          doesExpire: H.bool(r.DoesExpire),
          certTemplate: H.str(r.CertificateDetailsTemplate),
        },
      }
    },
  },
  // training records
  {
    entity: 'training_record',
    srcSchema: 'externaltraining',
    srcTable: 'TRAININGRECORDS',
    tenant: 'external-training',
    target: trainingRecords,
    batch: 1000,
    map: async (r, ctx) => {
      const personId = await ctx.lookup('externaltraining', 'PEOPLE', r.EmpID)
      const courseId = await ctx.lookup('externaltraining', 'TRAININGCOURSE', r.CourseID)
      if (!personId || !courseId) return null
      const ct = String(r.CertificateType ?? '').toLowerCase()
      return {
        personId,
        courseId,
        source: 'migrated',
        completedOn: H.date(r.TrainDate) ?? H.date(r.created_at) ?? '1970-01-01',
        expiresOn: H.date(r.ExpiryDate),
        score: H.int(r.ScorePercent),
        instructor: H.str(r.Trainer),
        evaluatorPersonId: await ctx.lookup('externaltraining', 'PEOPLE', r.EvaluatorID),
        certificateType: /auto/.test(ct) ? 'auto' : /photo/.test(ct) ? 'photo' : null,
        details: H.str(r.CertificateDetails),
      }
    },
  },
  // training classes
  {
    entity: 'training_class',
    srcSchema: 'externaltraining',
    srcTable: 'TRAININGCLASSES',
    tenant: 'external-training',
    target: trainingClasses,
    batch: 1000,
    prepare: async (env: Env, tenantId: string) => {
      const m = new Map<string, string>()
      await withSuperAdmin(env.db, async (tx: any) => {
        const rows = await tx
          .select({ id: trainingCourses.id, name: trainingCourses.name })
          .from(trainingCourses)
          .where(eq(trainingCourses.tenantId, tenantId))
        for (const r of rows) m.set(r.id, r.name)
      })
      return m
    },
    map: async (r, ctx) => {
      const courseId = await ctx.lookup('externaltraining', 'TRAININGCOURSE', r.CourseID)
      if (!courseId) return null // course_id is NOT NULL
      const starts = H.ts(r.Date) ?? H.ts(r.created_at) ?? new Date(0)
      const hours = H.num(r.Hours) ?? H.num(r.Length) ?? 1
      const ends = new Date(starts.getTime() + Math.max(0.5, hours) * 3600 * 1000)
      const st = String(r.Status ?? '').toLowerCase()
      return {
        courseId,
        title:
          H.str(r.ClassCode) ??
          (ctx.prepared as Map<string, string>)?.get(courseId) ??
          `Class ${r.id}`,
        startsAt: starts,
        endsAt: ends,
        siteOrgUnitId: await ctx.lookup('externaltraining', 'CUSTOMERS', r.CustomerID),
        cancelledAt: /cancel/.test(st) ? starts : null,
        completedAt: /complet|done|attend/.test(st) ? ends : null,
        notes: H.str(r.CertificateDetails),
      }
    },
  },
  // class attendees
  {
    entity: 'training_class_attendee',
    srcSchema: 'externaltraining',
    srcTable: 'TRAININGATTENDEES',
    tenant: 'external-training',
    target: trainingClassAttendees,
    batch: 1000,
    map: async (r, ctx) => {
      const classId = await ctx.lookup('externaltraining', 'TRAININGCLASSES', r.ClassID)
      const personId = await ctx.lookup('externaltraining', 'PEOPLE', r.EmpID)
      if (!classId || !personId) return null
      return {
        classId,
        personId,
        status: H.bool(r.Attended) ? 'attended' : 'registered',
        notes: H.str(r.Notes),
      }
    },
  },
  // quizzes → assessment types + questions (QUIZRESULTS are empty, so no attempts to load)
  {
    entity: 'training_assessment_type',
    srcSchema: 'externaltraining',
    srcTable: 'QUIZ',
    tenant: 'external-training',
    target: trainingAssessmentTypes,
    map: async (r, ctx) => ({
      name: H.str(r.Name) ?? `Quiz ${r.id}`,
      description: H.str(r.Description),
      passingScore: H.int(r.PassingGrade) ?? 80,
      courseId: await ctx.lookup('externaltraining', 'TRAININGCOURSE', r.CourseID),
      graded: H.bool(r.Graded),
      preAssessmentMessage: H.str(r.PreAssessmentMessage),
      postAssessmentMessage: H.str(r.PostAssessmentMessage),
      metadata: { legacy: 'externaltraining.QUIZ', createdBy: H.str(r.CreatedBy) },
    }),
  },
  {
    entity: 'training_assessment_type_question',
    srcSchema: 'externaltraining',
    srcTable: 'QUIZQUESTIONS',
    tenant: 'external-training',
    target: trainingAssessmentTypeQuestions,
    batch: 1000,
    map: async (r, ctx) => {
      const typeId = await ctx.lookup('externaltraining', 'QUIZ', r.QuizID)
      if (!typeId) return null // type_id NOT NULL
      const choices = [r.MultipleChoiceA, r.MultipleChoiceB, r.MultipleChoiceC, r.MultipleChoiceD]
        .map((x) => H.str(x))
        .filter(Boolean) as string[]
      const t = String(r.Type ?? '').toLowerCase()
      const kind = choices.length
        ? 'single_choice'
        : /true.?false|bool/.test(t)
          ? 'true_false'
          : 'text'
      return {
        typeId,
        prompt: H.str(r.Question) ?? `Q${r.id}`,
        kind,
        options: choices.length
          ? choices.map((c, i) => ({ value: String.fromCharCode(65 + i), label: c }))
          : null,
        correctAnswer: H.str(r.Answer),
        entityOrder: H.int(r.QuestionOrder) ?? 0,
        mandatory: true,
      }
    },
  },
]

export const ALL_LOADERS: Loader[] = [...RASSAUN_LOADERS, ...EXTERNAL_TRAINING_LOADERS]
