// Reporting views — flat, join-baked projections that the custom report
// builder's single-table executor can query directly (CUSTOM_ENTITY_TABLE maps
// an entity to one of these). Applied idempotently after migrations, like the
// RLS policies. RLS still applies: the views read the FORCE-RLS base tables,
// so rows are tenant-scoped by the app.tenant_id GUC exactly as usual.

export const REPORT_VIEWS_SQL: string[] = [
  // Externally-issued skills & certifications per person (the shape the old
  // hardcoded CWB welder report produced — now any tenant user can build /
  // clone reports over it).
  `CREATE OR REPLACE VIEW report_skill_assignments AS
   SELECT
     a.id,
     a.tenant_id,
     p.employee_no,
     p.last_name,
     p.first_name,
     tr.name AS trade,
     au.name AS authority,
     t.code  AS certification_code,
     t.name  AS certification_name,
     a.granted_on,
     a.expires_on,
     CASE
       WHEN a.expires_on IS NULL THEN 'no_expiry'
       WHEN a.expires_on < CURRENT_DATE THEN 'expired'
       WHEN a.expires_on <= CURRENT_DATE + 90 THEN 'expiring'
       ELSE 'valid'
     END AS status
   FROM training_skill_assignments a
   JOIN training_skill_types t ON t.id = a.skill_type_id
   JOIN training_skill_authorities au ON au.id = t.authority_id
   JOIN people p ON p.id = a.person_id
   LEFT JOIN trades tr ON tr.id = p.trade_id`,
]
