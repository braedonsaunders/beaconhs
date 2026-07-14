// Reporting views — flat, join-baked projections that the custom report
// builder's single-table executor can query directly (CUSTOM_ENTITY_TABLE maps
// an entity to one of these). Applied idempotently after migrations, like the
// RLS policies. RLS still applies: the views read the FORCE-RLS base tables,
// so rows are tenant-scoped by the app.tenant_id GUC exactly as usual.

export const REPORT_VIEWS_SQL: string[] = [
  // report_equipment_fleet shed its financial columns and report_equipment_charges
  // was removed entirely (equipment financials moved to a separate financial system).
  // CREATE OR REPLACE can neither shrink a view's column set nor drop a removed
  // view, so drop both up front every migrate (idempotent); the operational fleet view
  // is recreated further down.
  `DROP VIEW IF EXISTS report_equipment_charges;
   DROP VIEW IF EXISTS report_vehicle_log_monthly;
   DROP VIEW IF EXISTS report_vehicle_log_entries;
   DROP VIEW IF EXISTS report_equipment_fleet`,

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
   LEFT JOIN trades tr ON tr.id = p.trade_id
   WHERE a.deleted_at IS NULL
     AND p.deleted_at IS NULL`,

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
     ORDER BY r.tenant_id, r.person_id, r.course_id,
              r.completed_on DESC, r.created_at DESC, r.id DESC
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

  // Daily vehicle-log detail with driver, vehicle, site and source metadata
  // baked in for the native report engine. Totals use persisted km when
  // present, otherwise derive from business/personal or odometer fields.
  `CREATE OR REPLACE VIEW report_vehicle_log_entries AS
   SELECT
     tl.id                                  AS id,
     tl.tenant_id                           AS tenant_id,
     tl.entry_date                          AS entry_date,
     date_trunc('month', tl.entry_date)::date AS month,
     tl.equipment_item_id                   AS equipment_item_id,
     e.asset_tag                            AS asset_tag,
     e.name                                 AS vehicle_name,
     tl.driver_person_id                    AS driver_person_id,
     p.employee_no                          AS employee_no,
     CASE WHEN p.id IS NULL THEN NULL
          ELSE p.first_name || ' ' || p.last_name END AS driver_name,
     tl.entry_mode                          AS entry_mode,
     tl.start_odometer                      AS start_odometer,
     tl.end_odometer                        AS end_odometer,
     tl.business_km                         AS business_km,
     tl.personal_km                         AS personal_km,
     tl.km_driven                           AS km_driven,
     CASE
       WHEN tl.km_driven IS NOT NULL THEN tl.km_driven
       WHEN tl.business_km IS NOT NULL OR tl.personal_km IS NOT NULL
         THEN COALESCE(tl.business_km, 0) + COALESCE(tl.personal_km, 0)
       WHEN tl.start_odometer IS NOT NULL AND tl.end_odometer IS NOT NULL
         THEN GREATEST(tl.end_odometer - tl.start_odometer, 0)
       ELSE NULL
     END                                    AS total_km,
     tl.hours_on_site                       AS hours_on_site,
     tl.manpower_count                      AS manpower_count,
     tl.site_org_unit_id                    AS site_org_unit_id,
     site.code                              AS site_code,
     site.name                              AS site_name,
     COALESCE(site.name, tl.other_destination) AS destination,
     tl.other_destination                   AS other_destination,
     tl.import_status                       AS import_status,
     sc.connector_key                       AS source_system,
     sc.name                                AS source_name,
     tl.import_meta->>'sourceLabel'         AS source_label,
     tl.source_external_id                  AS source_external_id,
     tl.imported_at                         AS imported_at,
     tl.created_at                          AS created_at,
     tl.updated_at                          AS updated_at
   FROM truck_log_entries tl
   JOIN equipment_items e ON e.id = tl.equipment_item_id AND e.tenant_id = tl.tenant_id
   LEFT JOIN people p ON p.id = tl.driver_person_id AND p.tenant_id = tl.tenant_id
   LEFT JOIN org_units site ON site.id = tl.site_org_unit_id AND site.tenant_id = tl.tenant_id
   LEFT JOIN sync_connections sc ON sc.id = tl.source_connection_id AND sc.tenant_id = tl.tenant_id
   WHERE e.deleted_at IS NULL`,

  // Monthly driver × vehicle rollup for summaries, exports and dashboard
  // diagnostics. This keeps the old annual/monthly truck-log summary shape
  // available through the native report engine instead of bespoke SQL.
  `CREATE OR REPLACE VIEW report_vehicle_log_monthly AS
   SELECT
     (tenant_id::text || ':' || equipment_item_id::text || ':' ||
      COALESCE(driver_person_id::text, 'none') || ':' || month::text) AS id,
     tenant_id,
     month,
     equipment_item_id,
     asset_tag,
     vehicle_name,
     driver_person_id,
     employee_no,
     driver_name,
     COUNT(DISTINCT entry_date)::int          AS logged_days,
     COUNT(*) FILTER (WHERE total_km IS NOT NULL)::int AS km_days,
     COALESCE(SUM(business_km), 0)::int       AS business_km,
     COALESCE(SUM(personal_km), 0)::int       AS personal_km,
     COALESCE(SUM(total_km), 0)::int          AS total_km,
     COALESCE(SUM(hours_on_site), 0)::numeric AS hours_on_site,
     COALESCE(SUM(manpower_count), 0)::int    AS manpower_count,
     COUNT(*) FILTER (WHERE import_status = 'imported')::int AS imported_days,
     COUNT(*) FILTER (WHERE import_status = 'manual')::int   AS manual_days,
     MIN(start_odometer)                      AS first_odometer,
     MAX(end_odometer)                        AS last_odometer,
     COUNT(DISTINCT site_org_unit_id) FILTER (WHERE site_org_unit_id IS NOT NULL)::int AS site_count
   FROM report_vehicle_log_entries
   GROUP BY
     tenant_id,
     month,
     equipment_item_id,
     asset_tag,
     vehicle_name,
     driver_person_id,
     employee_no,
     driver_name`,

  // Fleet register — one row per (non-deleted) asset with type/site/holder names
  // baked in plus YTD + all-time usage (hours/km). OPERATIONAL ONLY: equipment
  // financials (rates, expenses, purchase price, ROI, project charges) are owned by
  // a separate financial system, not this app. Drives the Fleet, Upcoming-inspection
  // and Upcoming-oil-change reports. All base tables are FORCE-RLS, so every row is
  // tenant-scoped by app.tenant_id; the explicit tenant equality on each join keeps
  // the projection within a tenant.
  `CREATE OR REPLACE VIEW report_equipment_fleet AS
   SELECT
     e.id                                 AS id,
     e.tenant_id                          AS tenant_id,
     e.asset_tag                          AS asset_tag,
     e.name                               AS name,
     e.serial_number                      AS serial_number,
     e.status                             AS status,
     t.name                               AS equipment_type,
     type_category.name                   AS type_category,
     e.current_site_org_unit_id           AS current_site_org_unit_id,
     site.name                            AS site_name,
     CASE WHEN holder.id IS NULL THEN NULL
          ELSE holder.first_name || ' ' || holder.last_name END AS holder_name,
     e.is_missing                         AS is_missing,
     e.manufacturer                       AS manufacturer,
     e.model                              AS model,
     e.purchase_price                     AS purchase_price,
     e.ownership                          AS ownership,
     sched.last_inspection_on             AS last_inspection_on,
     sched.next_inspection_due            AS next_inspection_due,
     e.requires_oil_change                AS requires_oil_change,
     e.last_oil_change_on                 AS last_oil_change_on,
     e.next_oil_change_due                AS next_oil_change_due,
     e.oil_change_interval_months         AS oil_change_interval_months,
     e.purchase_date                      AS purchase_date,
     usage.hours_ytd                      AS hours_ytd,
     usage.km_ytd                         AS km_ytd,
     usage.hours_total                    AS hours_total
   FROM equipment_items e
   LEFT JOIN equipment_types t ON t.id = e.type_id AND t.tenant_id = e.tenant_id
   LEFT JOIN equipment_categories type_category
     ON type_category.id = t.category_id AND type_category.tenant_id = t.tenant_id
   LEFT JOIN org_units site ON site.id = e.current_site_org_unit_id AND site.tenant_id = e.tenant_id
   LEFT JOIN people holder ON holder.id = e.current_holder_person_id AND holder.tenant_id = e.tenant_id
   LEFT JOIN LATERAL (
     SELECT
       MIN(s.next_due_on)      AS next_inspection_due,
       MAX(s.last_completed_on) AS last_inspection_on
     FROM equipment_inspection_schedules s
     WHERE s.equipment_item_id = e.id AND s.tenant_id = e.tenant_id AND s.is_active
   ) sched ON true
   LEFT JOIN LATERAL (
     SELECT
       COALESCE(SUM(tl.hours_on_site) FILTER (WHERE tl.entry_date >= date_trunc('year', CURRENT_DATE)::date), 0) AS hours_ytd,
       COALESCE(SUM(tl.km_driven)     FILTER (WHERE tl.entry_date >= date_trunc('year', CURRENT_DATE)::date), 0) AS km_ytd,
       COALESCE(SUM(tl.hours_on_site), 0) AS hours_total
     FROM truck_log_entries tl
     WHERE tl.equipment_item_id = e.id AND tl.tenant_id = e.tenant_id
   ) usage ON true
   WHERE e.deleted_at IS NULL`,
]
