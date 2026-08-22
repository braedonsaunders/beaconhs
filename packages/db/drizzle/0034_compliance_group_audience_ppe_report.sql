-- Compliance audiences can target people groups and crews. PPE report view
-- exposes last annual inspection and holder employment fields so reports can
-- exclude inactive people.

ALTER TYPE "compliance_audience_kind" ADD VALUE IF NOT EXISTS 'person_group';--> statement-breakpoint
ALTER TYPE "compliance_audience_kind" ADD VALUE IF NOT EXISTS 'crew';--> statement-breakpoint

CREATE OR REPLACE VIEW report_ppe_items AS
SELECT
  item.id,
  item.tenant_id,
  item.type_id,
  type.name AS ppe_type,
  item.serial_number,
  item.size,
  item.status,
  item.is_draft,
  item.current_holder_person_id,
  CASE WHEN holder.id IS NULL THEN NULL
       ELSE holder.last_name || ', ' || holder.first_name END AS holder_name,
  holder.status AS holder_status,
  holder.employee_no AS holder_employee_no,
  holder.department_id,
  department.name AS department_name,
  array_to_string(
    ARRAY(
      SELECT membership.group_id::text
      FROM person_group_memberships membership
      WHERE membership.tenant_id = item.tenant_id
        AND membership.person_id = holder.id
      ORDER BY membership.group_id
    ),
    ','
  ) AS group_id_list,
  item.last_inspection_on,
  item.next_inspection_due,
  item.last_annual_inspection_on,
  item.next_annual_inspection_due,
  item.purchase_date,
  item.expires_on,
  item.metadata,
  item.deleted_at
FROM ppe_items item
JOIN ppe_types type
  ON type.id = item.type_id AND type.tenant_id = item.tenant_id
LEFT JOIN people holder
  ON holder.id = item.current_holder_person_id AND holder.tenant_id = item.tenant_id
LEFT JOIN departments department
  ON department.id = holder.department_id AND department.tenant_id = item.tenant_id;
