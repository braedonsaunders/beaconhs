// Entity loaders (legacy landing → app schema). Dependency-ordered. Start of the rassaun slice;
// more loaders are appended here as each entity's mapping is finalised (see docs/migration/mapping.md).
import { eq } from 'drizzle-orm'
import { withSuperAdmin, schema } from '@beaconhs/db'
import { ensureBucket, newAttachmentKey, putObject } from '@beaconhs/storage'
import { H, internals, rowHash, type Loader, type Env } from './orchestrator'
import { source } from './source/landing'

const {
  personDivisions, trades, personTitles, people, orgUnits, incidents, journalEntries, correctiveActions,
  equipmentCategories, equipmentTypes, equipmentItems,
  documents, documentVersions, documentTypes, documentCategories,
  documentReferences, documentReferenceTypes, documentReferenceCategories, attachments,
} = schema

const oneOf = (v: unknown, allowed: string[], fallback: string): string => {
  const s = String(v ?? '').toLowerCase().replace(/\s+/g, '_')
  return allowed.includes(s) ? s : fallback
}
const slugify = (v: unknown, fallback: string): string =>
  (H.str(v) ?? fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || fallback

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
          const id = await internals.reserve(env, tx, 'adminapp', 'CUSTOMERS', r.id, 'org_unit', tenantId, rowHash(r))
          out.push({ id, tenantId, level: 'customer', name: H.str(r.name) ?? `Location ${r.id}`, code: String(r.id) })
        }
        if (out.length) {
          await tx
            .insert(orgUnits)
            .values(out)
            .onConflictDoUpdate({ target: orgUnits.id, set: internals.buildUpsertSet(orgUnits, Object.keys(out[0])) })
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
      metadata: { legacy: 'beaconhs.DAILYJOURNALS', username: H.str(r.Username), supervisor: H.str(r.Supervisor) },
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
        source: oneOf(r.Source, ['inspection', 'incident', 'near_miss', 'observation', 'audit', 'jsha'], 'other'),
        assignedOn: H.date(r.DateAssigned),
        dueOn: H.date(r.DateDue),
        closedAt: H.ts(r.DateClosed),
        actionTaken: H.str(r.ActionTaken),
        siteOrgUnitId: await ctx.lookup('adminapp', 'CUSTOMERS', r.Jobsite),
        // assigned_by / owner are tenant_user FKs — populated once the users loader exists
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
    map: (r) => ({ name: H.str(r.Name) ?? `Category ${r.id}`, slug: slugify(r.Name, `cat-${r.id}`), description: H.str(r.Description) }),
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
    map: (r) => ({ key: slugify(r.Name, `dtype-${r.id}`), name: H.str(r.Name) ?? `Type ${r.id}`, description: H.str(r.Description) }),
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
      const rows: any[] = await source().unsafe('select id, "Name" from beaconhs."DOCUMENTATIONCATEGORY"')
      for (const r of rows) m.set(Number(r.id), String(r.Name ?? ''))
      return m
    },
    map: async (r, ctx) => ({
      key: `doc-${r.id}`,
      title: H.str(r.Name) ?? `Document ${r.id}`,
      description: H.str(r.Description),
      category: (ctx.prepared as Map<number, string>)?.get(Number(r.CategoryID)) || null,
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
    map: (r) => ({ key: slugify(r.Name, `rtype-${r.id}`), name: H.str(r.Name) ?? `Type ${r.id}`, description: H.str(r.Description) }),
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
      const rows: any[] = await source().unsafe('select * from beaconhs."DOCUMENTATIONREFERENCE" order by id')
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
                    attachmentId = await internals.reserve(env, tx, 'beaconhs', 'DOCUMENTATIONREFERENCE_FILE', r.id, 'attachment', tenantId, rowHash(r))
                    await tx
                      .insert(attachments)
                      .values({ id: attachmentId, tenantId, kind: 'document', r2Key: key, contentType: ct, sizeBytes: buf.length, filename })
                      .onConflictDoUpdate({ target: attachments.id, set: { r2Key: key, sizeBytes: buf.length, filename } })
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
              const refId = await internals.reserve(env, tx, 'beaconhs', 'DOCUMENTATIONREFERENCE', r.id, 'document_reference', tenantId, rowHash(r))
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
                .onConflictDoUpdate({ target: documentReferences.id, set: { kind, attachmentId, url: kind === 'url' ? url : null } })
            })
            upserted++
          }),
        )
      }
      console.log(`[files: ${files} uploaded, ${failed} failed] `)
      return { source: rows.length, upserted }
    },
  },
]
