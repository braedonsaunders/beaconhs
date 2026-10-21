CREATE TABLE IF NOT EXISTS person_work_days (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 person_id uuid NOT NULL,
 work_date date NOT NULL,
 worked boolean NOT NULL,
 source text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT person_work_days_tenant_person_fk FOREIGN KEY (tenant_id,person_id) REFERENCES people(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT person_work_days_source_ck CHECK (length(trim(source)) BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS person_work_days_person_date_ux ON person_work_days(tenant_id,person_id,work_date);
CREATE INDEX IF NOT EXISTS person_work_days_date_idx ON person_work_days(tenant_id,work_date);
