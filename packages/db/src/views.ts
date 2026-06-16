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

  // Person × course training coverage. The cross product of active people and
  // courses (so "never trained" cells exist) LEFT JOINed to each person's
  // latest record per course, with a derived coverage status. All three base
  // tables are FORCE-RLS, so every branch is tenant-scoped by app.tenant_id;
  // the explicit tenant equality keeps the cross join within a tenant too.
  `CREATE OR REPLACE VIEW report_training_matrix AS
   WITH latest AS (
     SELECT DISTINCT ON (r.tenant_id, r.person_id, r.course_id)
            r.tenant_id, r.person_id, r.course_id, r.completed_on, r.expires_on
     FROM training_records r
     WHERE r.deleted_at IS NULL
     ORDER BY r.tenant_id, r.person_id, r.course_id, r.completed_on DESC
   )
   SELECT
     (p.id::text || ':' || c.id::text) AS id,
     p.tenant_id                       AS tenant_id,
     p.id                              AS person_id,
     p.employee_no                     AS employee_no,
     p.last_name                       AS last_name,
     p.first_name                      AS first_name,
     (p.last_name || ', ' || p.first_name) AS person_name,
     c.id                              AS course_id,
     c.code                            AS course_code,
     c.name                            AS course_name,
     l.completed_on                    AS completed_on,
     l.expires_on                      AS expires_on,
     CASE
       WHEN l.person_id IS NULL              THEN 'missing'
       WHEN l.expires_on IS NULL             THEN 'valid'
       WHEN l.expires_on < CURRENT_DATE      THEN 'expired'
       WHEN l.expires_on <= CURRENT_DATE + 90 THEN 'expiring'
       ELSE 'valid'
     END                               AS coverage_status
   FROM people p
   CROSS JOIN training_courses c
   LEFT JOIN latest l
     ON l.person_id = p.id AND l.course_id = c.id AND l.tenant_id = p.tenant_id
   WHERE p.tenant_id = c.tenant_id
     AND p.status = 'active'
     AND p.deleted_at IS NULL
     AND c.deleted_at IS NULL`,

  // Per-month safety-rate components: recordable + DART incident counts (OSHA
  // definitions) and hours worked, so TRIR/DART are buildable as a calculated
  // rate (sum(recordable)/sum(hours)×200000). Both base tables are FORCE-RLS.
  `CREATE OR REPLACE VIEW report_incident_rates AS
   WITH months AS (
     SELECT tenant_id, date_trunc('month', occurred_at)::date AS month
     FROM incidents WHERE deleted_at IS NULL
     UNION
     SELECT tenant_id, date_trunc('month', period_start)::date AS month
     FROM incident_hours_periods WHERE deleted_at IS NULL
   ),
   inc AS (
     SELECT tenant_id, date_trunc('month', occurred_at)::date AS month,
       COUNT(*) FILTER (WHERE severity IN ('medical_aid', 'lost_time', 'fatality')) AS recordable_count,
       COUNT(*) FILTER (WHERE lost_time IS TRUE) AS dart_count
     FROM incidents WHERE deleted_at IS NULL
     GROUP BY 1, 2
   ),
   hrs AS (
     SELECT tenant_id, date_trunc('month', period_start)::date AS month,
       SUM(total_hours) AS hours_worked
     FROM incident_hours_periods WHERE deleted_at IS NULL
     GROUP BY 1, 2
   )
   SELECT
     (m.tenant_id::text || ':' || m.month::text) AS id,
     m.tenant_id                          AS tenant_id,
     m.month                              AS month,
     COALESCE(inc.recordable_count, 0)::int     AS recordable_count,
     COALESCE(inc.dart_count, 0)::int           AS dart_count,
     COALESCE(hrs.hours_worked, 0)::numeric     AS hours_worked
   FROM months m
   LEFT JOIN inc ON inc.tenant_id = m.tenant_id AND inc.month = m.month
   LEFT JOIN hrs ON hrs.tenant_id = m.tenant_id AND hrs.month = m.month`,
]
