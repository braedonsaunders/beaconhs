CREATE TYPE "public"."equipment_inspection_criterion_kind" AS ENUM('pass_fail', 'pass_fail_na', 'text', 'numeric', 'photo');--> statement-breakpoint
CREATE TYPE "public"."equipment_inspection_criterion_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."equipment_inspection_interval" AS ENUM('pre_use', 'daily', 'weekly', 'monthly', 'quarterly', 'annually', 'five_year', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."equipment_checkout_condition" AS ENUM('good', 'fair', 'damaged', 'unusable');--> statement-breakpoint
CREATE TYPE "public"."ppe_criterion_inspection_kind" AS ENUM('pre_use', 'annual');--> statement-breakpoint
CREATE TYPE "public"."ppe_criterion_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ppe_annual_record_result" AS ENUM('pass', 'fail', 'remediated');--> statement-breakpoint
CREATE TYPE "public"."corrective_action_complete_step_kind" AS ENUM('action_taken', 'verification', 'signature');--> statement-breakpoint
CREATE TYPE "public"."inspection_record_status" AS ENUM('draft', 'in_progress', 'submitted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."inspection_criterion_answer" AS ENUM('pass', 'fail', 'n_a');--> statement-breakpoint
CREATE TYPE "public"."inspection_criterion_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."inspection_assignment_frequency" AS ENUM('day', 'week', 'month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."training_assessment_question_kind" AS ENUM('text', 'single_choice', 'multi_choice', 'numeric', 'true_false');--> statement-breakpoint
CREATE TYPE "public"."training_assessment_status" AS ENUM('in_progress', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."training_audience_assignment_item_kind" AS ENUM('course', 'assessment_type');--> statement-breakpoint
CREATE TYPE "public"."training_audience_assignment_record_status" AS ENUM('pending', 'in_progress', 'completed', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."training_audience_assignment_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."training_audience_assignment_target_kind" AS ENUM('person', 'trade', 'role', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."report_definition_kind" AS ENUM('built_in', 'custom');--> statement-breakpoint
CREATE TYPE "public"."document_assignment_audience_type" AS ENUM('role', 'trade', 'department', 'person', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."hazid_assessment_style" AS ENUM('task_based', 'hazard_based');--> statement-breakpoint
CREATE TYPE "public"."hazid_question_type" AS ENUM('yes_no', 'text', 'multi_select');--> statement-breakpoint
CREATE TYPE "public"."hazid_cs_rescue_style" AS ENUM('entry', 'non_entry');--> statement-breakpoint
CREATE TYPE "public"."hazid_cs_type" AS ENUM('paper', 'integrated');--> statement-breakpoint
CREATE TYPE "public"."hazid_ppe_answer" AS ENUM('yes', 'no', 'na');--> statement-breakpoint
CREATE TYPE "public"."hazid_signature_type" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."hazid_signed_report_status" AS ENUM('pending', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."toolbox_journal_status" AS ENUM('draft', 'submitted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."lift_plan_signature_role" AS ENUM('supervisor', 'operator', 'rigger', 'signaler', 'spotter');--> statement-breakpoint
CREATE TYPE "public"."lift_plan_status" AS ENUM('draft', 'approved', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."safe_distance_type" AS ENUM('electrical', 'drone', 'overhead_crane', 'vehicle', 'other');--> statement-breakpoint
CREATE TABLE "incident_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"code" text,
	"sort_order" integer,
	"is_recordable" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "incident_hours_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_org_unit_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"period_label" text,
	"total_hours" numeric(14, 2) NOT NULL,
	"employee_count" integer NOT NULL,
	"notes" text,
	"entered_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "incident_injury_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"osha_code" text,
	"sort_order" integer,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "equipment_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"incurred_on" date NOT NULL,
	"category" text NOT NULL,
	"vendor" text,
	"description" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"charged_to_org_unit_id" uuid,
	"attachment_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"category" text,
	"hourly" numeric(12, 2),
	"daily" numeric(12, 2),
	"weekly" numeric(12, 2),
	"monthly" numeric(12, 2),
	"currency" text DEFAULT 'CAD' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"title" text,
	"details" text NOT NULL,
	"site_org_unit_id" uuid,
	"person_person_id" uuid,
	"attachment_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_inspection_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inspection_type_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"kind" "equipment_inspection_criterion_kind" DEFAULT 'pass_fail' NOT NULL,
	"severity" "equipment_inspection_criterion_severity" DEFAULT 'medium' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_inspection_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"applies_to_type_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"interval" "equipment_inspection_interval" DEFAULT 'on_demand' NOT NULL,
	"allow_pass_all" boolean DEFAULT true NOT NULL,
	"fails_spawn_work_orders" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"holder_person_id" uuid,
	"destination_org_unit_id" uuid,
	"checked_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_return_on" date,
	"returned_at" timestamp with time zone,
	"returned_condition" "equipment_checkout_condition",
	"returned_notes" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_out_by_tenant_user_id" uuid,
	"checked_in_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_type_inspection_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ppe_type_id" uuid NOT NULL,
	"inspection_kind" "ppe_criterion_inspection_kind" DEFAULT 'pre_use' NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"severity" "ppe_criterion_severity" DEFAULT 'medium' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"entity_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_annual_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"year" text NOT NULL,
	"inspected_on" date NOT NULL,
	"next_due_on" date,
	"inspected_by_person_id" uuid,
	"inspector_name" text,
	"inspector_company" text,
	"certificate_attachment_id" uuid,
	"result" "ppe_annual_record_result" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ca_complete_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ca_id" uuid NOT NULL,
	"kind" "corrective_action_complete_step_kind" NOT NULL,
	"description" text,
	"completed_by_tenant_user_id" uuid,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_data_url" text,
	"entity_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ca_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ca_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_type_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"requires_foreman" boolean DEFAULT false NOT NULL,
	"requires_customer_signature" boolean DEFAULT false NOT NULL,
	"enable_corrective_actions" boolean DEFAULT true NOT NULL,
	"allow_compliant_notes" boolean DEFAULT true NOT NULL,
	"default_cadence" text,
	"available_to" jsonb,
	"notify_person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inspection_record_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"type_id" uuid NOT NULL,
	"status" "inspection_record_status" DEFAULT 'draft' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"site_org_unit_id" uuid,
	"inspector_tenant_user_id" uuid,
	"supervisor_tenant_user_id" uuid,
	"foreman_person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"foreman_text" text,
	"customer_org_unit_id" uuid,
	"customer_contact_person_id" uuid,
	"customer_contact_name" text,
	"customer_signature_data_url" text,
	"customer_signer_name" text,
	"customer_signed_at" timestamp with time zone,
	"notes" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_tenant_user_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by_tenant_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inspection_record_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"criterion_id" uuid,
	"question_text_snapshot" text NOT NULL,
	"sequence" integer NOT NULL,
	"answer" "inspection_criterion_answer",
	"answered_at" timestamp with time zone,
	"answered_by_tenant_user_id" uuid,
	"severity" "inspection_criterion_severity",
	"non_compliance_description" text,
	"action_taken" text,
	"compliant_note" text,
	"assigned_to_person_id" uuid,
	"assigned_to_tenant_user_id" uuid,
	"assigned_due_date" date,
	"photo_attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrective_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_assignment_compliance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"p1_start" date,
	"p1_end" date,
	"p1_count" integer DEFAULT 0 NOT NULL,
	"p1_expected" integer DEFAULT 0 NOT NULL,
	"p1_percent" integer DEFAULT 0 NOT NULL,
	"p1_compliant" boolean DEFAULT false NOT NULL,
	"p2_count" integer DEFAULT 0 NOT NULL,
	"p2_expected" integer DEFAULT 0 NOT NULL,
	"p2_percent" integer DEFAULT 0 NOT NULL,
	"p2_compliant" boolean DEFAULT false NOT NULL,
	"p3_count" integer DEFAULT 0 NOT NULL,
	"p3_expected" integer DEFAULT 0 NOT NULL,
	"p3_percent" integer DEFAULT 0 NOT NULL,
	"p3_compliant" boolean DEFAULT false NOT NULL,
	"p4_count" integer DEFAULT 0 NOT NULL,
	"p4_expected" integer DEFAULT 0 NOT NULL,
	"p4_percent" integer DEFAULT 0 NOT NULL,
	"p4_compliant" boolean DEFAULT false NOT NULL,
	"overall_percent" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_assignment_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"audience_person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"frequency" "inspection_assignment_frequency" DEFAULT 'week' NOT NULL,
	"cron" text,
	"due_offset_minutes" integer,
	"quantity_per_period" integer DEFAULT 1 NOT NULL,
	"compliant_percentage" integer DEFAULT 100 NOT NULL,
	"target_role_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_org_unit_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_everybody" boolean DEFAULT false NOT NULL,
	"notes" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_assessment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"prompt_snapshot" text NOT NULL,
	"correct_answer_snapshot" text,
	"kind_snapshot" "training_assessment_question_kind" NOT NULL,
	"answer" text,
	"correct" boolean,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"points_possible" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_assessment_type_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"kind" "training_assessment_question_kind" NOT NULL,
	"options" jsonb,
	"correct_answer" text,
	"help_text" text,
	"points" integer DEFAULT 1 NOT NULL,
	"entity_order" integer DEFAULT 0 NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_assessment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"passing_score" integer DEFAULT 80 NOT NULL,
	"course_id" uuid,
	"pre_assessment_message" text,
	"post_assessment_message" text,
	"graded" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_tenant_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"course_id" uuid,
	"passing_score" integer NOT NULL,
	"score" integer,
	"points_awarded" integer,
	"points_possible" integer,
	"passed" boolean,
	"status" "training_assessment_status" DEFAULT 'in_progress' NOT NULL,
	"assignment_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"submitted_by_tenant_user_id" uuid,
	"training_record_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_audience_assignment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "training_audience_assignment_record_status" DEFAULT 'pending' NOT NULL,
	"completed_on" date,
	"source_training_record_id" uuid,
	"source_assessment_id" uuid,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_audience_assignment_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"kind" "training_audience_assignment_target_kind" NOT NULL,
	"person_id" uuid,
	"trade_id" uuid,
	"role_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_audience_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"item_kind" "training_audience_assignment_item_kind" NOT NULL,
	"course_id" uuid,
	"assessment_type_id" uuid,
	"due_on" date,
	"recurrence_cron" text,
	"remind_before_days" integer DEFAULT 7 NOT NULL,
	"status" "training_audience_assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_by_tenant_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"layout" jsonb NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_assignment_audience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"type" "document_assignment_audience_type" NOT NULL,
	"entity_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"title" text,
	"notes" text,
	"due_on" date,
	"assigned_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_reference_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_reference_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_management_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"period_start" date,
	"period_end" date NOT NULL,
	"next_review_on" date,
	"discussion_notes" text,
	"decisions" text,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"documents_reviewed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_items_created" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chaired_by_tenant_user_id" uuid,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_type_ppe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT true NOT NULL,
	"entity_order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_type_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"question" text NOT NULL,
	"question_type" "hazid_question_type" DEFAULT 'yes_no' NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_yes" boolean DEFAULT false NOT NULL,
	"entity_order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"style" "hazid_assessment_style" DEFAULT 'task_based' NOT NULL,
	"has_tasks" boolean DEFAULT true NOT NULL,
	"has_hazards" boolean DEFAULT true NOT NULL,
	"has_ppe" boolean DEFAULT true NOT NULL,
	"has_questions" boolean DEFAULT true NOT NULL,
	"has_wah" boolean DEFAULT false NOT NULL,
	"has_cs" boolean DEFAULT false NOT NULL,
	"has_arc_flash" boolean DEFAULT false NOT NULL,
	"default_hazard_set_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hazid_hazard_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hazard_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_hazard_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#64748b' NOT NULL,
	"icon_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_hazards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hazard_type_id" uuid,
	"standard_controls" text,
	"risks" text,
	"photo_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hazid_location_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hazard_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"controls" text,
	"swp_document_id" uuid,
	"sjp_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_cs_atmospheric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"atmospheric_sensor_id" uuid,
	"time" timestamp with time zone NOT NULL,
	"sensor_1_reading" numeric,
	"sensor_2_reading" numeric,
	"sensor_3_reading" numeric,
	"sensor_4_reading" numeric,
	"distance" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_cs_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"person_id" uuid,
	"external_name" text,
	"time_in" timestamp with time zone,
	"time_out" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_hazards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"hazard_id" uuid,
	"name" text,
	"standard_controls" text,
	"specific_controls" text,
	"applicable" boolean DEFAULT true NOT NULL,
	"entity_order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_ppe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT true NOT NULL,
	"entity_order" integer DEFAULT 1 NOT NULL,
	"answer" "hazid_ppe_answer",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"question" text NOT NULL,
	"question_type" "hazid_question_type" DEFAULT 'yes_no' NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_yes" boolean DEFAULT false NOT NULL,
	"answer" text,
	"entity_order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"signature_type" "hazid_signature_type" NOT NULL,
	"person_id" uuid,
	"external_name" text,
	"signature_data_url" text,
	"cs_entrant" boolean DEFAULT false NOT NULL,
	"cs_attendant" boolean DEFAULT false NOT NULL,
	"cs_rescue" boolean DEFAULT false NOT NULL,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"task_id" uuid,
	"description" text,
	"hazard_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"controls" text,
	"entity_order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"site_org_unit_id" uuid,
	"location_on_site" text,
	"project_org_unit_id" uuid,
	"supervisor_tenant_user_id" uuid,
	"supervisor_person_id" uuid,
	"reported_by_tenant_user_id" uuid,
	"assessment_type_id" uuid,
	"job_scope" text,
	"wah" boolean DEFAULT false NOT NULL,
	"wah_type" text,
	"wah_communication" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wah_access" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wah_equipment" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wah_rescue" text,
	"wah_permit_number" text,
	"confined_space" boolean DEFAULT false NOT NULL,
	"cs_type" "hazid_cs_type",
	"cs_description" text,
	"cs_communication" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cs_communication_rescue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cs_rescue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cs_work_performed" text,
	"cs_diagram_base64" text,
	"cs_rescue_style" "hazid_cs_rescue_style",
	"cs_rescue_procedure" text,
	"cs_atmospheric_sensor_id" uuid,
	"cs_permit_number" text,
	"arc_flash" boolean DEFAULT false NOT NULL,
	"arc_flash_level" text,
	"arc_flash_boundary" text,
	"arc_flash_incident_energy" text,
	"arc_flash_equipment" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"arc_flash_procedures" text,
	"arc_flash_qualified_person" text,
	"in_progress" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hazid_signed_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assessment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "hazid_signed_report_status" DEFAULT 'pending' NOT NULL,
	"pdf_attachment_id" uuid,
	"built_by_tenant_user_id" uuid,
	"built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "toolbox_journal_assignment_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "toolbox_journal_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cron" text NOT NULL,
	"due_offset_days" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"compliant_percentage" integer DEFAULT 80 NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "toolbox_journal_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"signature_data_url" text,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "toolbox_journal_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "toolbox_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"topic" text,
	"occurred_on" date NOT NULL,
	"site_org_unit_id" uuid,
	"foreman_tenant_user_id" uuid,
	"discussion_notes" text,
	"questions_raised" text,
	"action_items" text,
	"status" "toolbox_journal_status" DEFAULT 'draft' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lift_plan_equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lift_plan_id" uuid NOT NULL,
	"equipment_item_id" uuid,
	"equipment_description" text,
	"capacity_kg" numeric(12, 2),
	"boom_length_m" numeric(8, 2),
	"radius_m" numeric(8, 2),
	"capacity_used_pct" numeric(6, 2),
	"entity_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_plan_hazards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lift_plan_id" uuid NOT NULL,
	"hazard_description" text NOT NULL,
	"controls" text,
	"entity_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_plan_loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lift_plan_id" uuid NOT NULL,
	"description" text NOT NULL,
	"weight_kg" numeric(12, 2),
	"dimensions_max_mm" integer,
	"attachment_method" text,
	"entity_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_plan_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lift_plan_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_plan_ppe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lift_plan_id" uuid NOT NULL,
	"ppe_name" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"entity_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_plan_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lift_plan_id" uuid NOT NULL,
	"person_id" uuid,
	"external_name" text,
	"role" "lift_plan_signature_role" NOT NULL,
	"signature_data_url" text,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"project_org_unit_id" uuid,
	"site_org_unit_id" uuid,
	"lift_date" date NOT NULL,
	"description" text,
	"supervisor_tenant_user_id" uuid,
	"operator_person_id" uuid,
	"rigger_person_id" uuid,
	"status" "lift_plan_status" DEFAULT 'draft' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_tenant_user_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_tenant_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_tenant_user_id" uuid,
	"cancellation_reason" text,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "person_group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "person_division_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_division_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "person_title_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"responsibilities" text,
	"education" text,
	"experience" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_title_task_acknowledgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_data_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_title_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"task" text NOT NULL,
	"description" text,
	"entity_order" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "safe_distance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"type" "safe_distance_type" NOT NULL,
	"site_org_unit_id" uuid,
	"source_voltage_kv" numeric(8, 2),
	"height_m" numeric(8, 2),
	"source_description" text,
	"required_distance_m" numeric(8, 2) NOT NULL,
	"actual_distance_m" numeric(8, 2) NOT NULL,
	"complies" boolean NOT NULL,
	"supervisor_tenant_user_id" uuid,
	"operator_person_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "division_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "title_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_injuries" ADD COLUMN "injury_type_id" uuid;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "first_aid_given" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "first_aid_notes" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "ems_called" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "ems_arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "hospital_name" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "hospital_arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "discharged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "attending_physician" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "mol_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "mol_report_number" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "severity_rating" integer;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "damage_estimate" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "police_notified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "police_report_number" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "insurance_claim_number" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "classification_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "requires_oil_change" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "oil_change_interval_months" integer;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "last_oil_change_on" date;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "next_oil_change_due" date;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "purchase_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "bulk_qr_token" text;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "bulk_qr_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "is_available_for_checkout" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_types" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment_types" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "equipment_types" ADD COLUMN "default_oil_change_interval_months" integer;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD COLUMN "verification_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD COLUMN "cost_impact" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "report_definitions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD COLUMN "kind" "report_definition_kind" DEFAULT 'built_in' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD COLUMN "custom_query" jsonb;--> statement-breakpoint
ALTER TABLE "incident_classifications" ADD CONSTRAINT "incident_classifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_classifications" ADD CONSTRAINT "incident_classifications_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_hours_periods" ADD CONSTRAINT "incident_hours_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_hours_periods" ADD CONSTRAINT "incident_hours_periods_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_hours_periods" ADD CONSTRAINT "incident_hours_periods_entered_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("entered_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_injury_types" ADD CONSTRAINT "incident_injury_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_injury_types" ADD CONSTRAINT "incident_injury_types_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD CONSTRAINT "equipment_expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD CONSTRAINT "equipment_expenses_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD CONSTRAINT "equipment_expenses_charged_to_org_unit_id_org_units_id_fk" FOREIGN KEY ("charged_to_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD CONSTRAINT "equipment_expenses_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD CONSTRAINT "equipment_expenses_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_rates" ADD CONSTRAINT "equipment_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_rates" ADD CONSTRAINT "equipment_rates_type_id_equipment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."equipment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_person_person_id_people_id_fk" FOREIGN KEY ("person_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_criteria" ADD CONSTRAINT "equipment_inspection_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_criteria" ADD CONSTRAINT "equipment_inspection_criteria_inspection_type_id_equipment_inspection_types_id_fk" FOREIGN KEY ("inspection_type_id") REFERENCES "public"."equipment_inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_types" ADD CONSTRAINT "equipment_inspection_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_types" ADD CONSTRAINT "equipment_inspection_types_applies_to_type_id_equipment_types_id_fk" FOREIGN KEY ("applies_to_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_holder_person_id_people_id_fk" FOREIGN KEY ("holder_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_destination_org_unit_id_org_units_id_fk" FOREIGN KEY ("destination_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_checked_out_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("checked_out_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_checked_in_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("checked_in_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_type_inspection_criteria" ADD CONSTRAINT "ppe_type_inspection_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_type_inspection_criteria" ADD CONSTRAINT "ppe_type_inspection_criteria_ppe_type_id_ppe_types_id_fk" FOREIGN KEY ("ppe_type_id") REFERENCES "public"."ppe_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" ADD CONSTRAINT "ppe_annual_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" ADD CONSTRAINT "ppe_annual_records_item_id_ppe_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ppe_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" ADD CONSTRAINT "ppe_annual_records_inspected_by_person_id_people_id_fk" FOREIGN KEY ("inspected_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" ADD CONSTRAINT "ppe_annual_records_certificate_attachment_id_attachments_id_fk" FOREIGN KEY ("certificate_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_complete_steps" ADD CONSTRAINT "ca_complete_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_complete_steps" ADD CONSTRAINT "ca_complete_steps_ca_id_corrective_actions_id_fk" FOREIGN KEY ("ca_id") REFERENCES "public"."corrective_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_complete_steps" ADD CONSTRAINT "ca_complete_steps_completed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("completed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_photos" ADD CONSTRAINT "ca_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_photos" ADD CONSTRAINT "ca_photos_ca_id_corrective_actions_id_fk" FOREIGN KEY ("ca_id") REFERENCES "public"."corrective_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_banks" ADD CONSTRAINT "inspection_type_banks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_banks" ADD CONSTRAINT "inspection_type_banks_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_banks" ADD CONSTRAINT "inspection_type_banks_bank_id_inspection_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."inspection_banks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_types" ADD CONSTRAINT "inspection_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_types" ADD CONSTRAINT "inspection_types_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_attachments" ADD CONSTRAINT "inspection_record_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_attachments" ADD CONSTRAINT "inspection_record_attachments_record_id_inspection_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."inspection_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_inspector_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("inspector_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_supervisor_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("supervisor_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_customer_org_unit_id_org_units_id_fk" FOREIGN KEY ("customer_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_customer_contact_person_id_people_id_fk" FOREIGN KEY ("customer_contact_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_submitted_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("submitted_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_closed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("closed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_record_id_inspection_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."inspection_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_criterion_id_inspection_bank_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."inspection_bank_criteria"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_answered_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("answered_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_assigned_to_person_id_people_id_fk" FOREIGN KEY ("assigned_to_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_assigned_to_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assigned_to_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_corrective_action_id_corrective_actions_id_fk" FOREIGN KEY ("corrective_action_id") REFERENCES "public"."corrective_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" ADD CONSTRAINT "inspection_assignment_compliance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" ADD CONSTRAINT "inspection_assignment_compliance_assignment_id_inspection_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."inspection_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" ADD CONSTRAINT "inspection_assignment_compliance_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" ADD CONSTRAINT "inspection_assignment_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" ADD CONSTRAINT "inspection_assignment_dispatches_assignment_id_inspection_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."inspection_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessment_results" ADD CONSTRAINT "training_assessment_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessment_results" ADD CONSTRAINT "training_assessment_results_assessment_id_training_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."training_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessment_results" ADD CONSTRAINT "training_assessment_results_question_id_training_assessment_type_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."training_assessment_type_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessment_type_questions" ADD CONSTRAINT "training_assessment_type_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessment_type_questions" ADD CONSTRAINT "training_assessment_type_questions_type_id_training_assessment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."training_assessment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessment_types" ADD CONSTRAINT "training_assessment_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessment_types" ADD CONSTRAINT "training_assessment_types_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessment_types" ADD CONSTRAINT "training_assessment_types_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD CONSTRAINT "training_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD CONSTRAINT "training_assessments_type_id_training_assessment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."training_assessment_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD CONSTRAINT "training_assessments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD CONSTRAINT "training_assessments_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD CONSTRAINT "training_assessments_submitted_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("submitted_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_records" ADD CONSTRAINT "training_audience_assignment_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_records" ADD CONSTRAINT "training_audience_assignment_records_assignment_id_training_audience_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."training_audience_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_records" ADD CONSTRAINT "training_audience_assignment_records_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_targets" ADD CONSTRAINT "training_audience_assignment_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_targets" ADD CONSTRAINT "training_audience_assignment_targets_assignment_id_training_audience_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."training_audience_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_targets" ADD CONSTRAINT "training_audience_assignment_targets_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_targets" ADD CONSTRAINT "training_audience_assignment_targets_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignments" ADD CONSTRAINT "training_audience_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignments" ADD CONSTRAINT "training_audience_assignments_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignments" ADD CONSTRAINT "training_audience_assignments_assessment_type_id_training_assessment_types_id_fk" FOREIGN KEY ("assessment_type_id") REFERENCES "public"."training_assessment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_audience_assignments" ADD CONSTRAINT "training_audience_assignments_assigned_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assigned_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_parent_id_document_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignment_audience" ADD CONSTRAINT "document_assignment_audience_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignment_audience" ADD CONSTRAINT "document_assignment_audience_assignment_id_document_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."document_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_assigned_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assigned_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference_categories" ADD CONSTRAINT "document_reference_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference_categories" ADD CONSTRAINT "document_reference_categories_parent_id_document_reference_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_reference_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference_types" ADD CONSTRAINT "document_reference_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_management_reviews" ADD CONSTRAINT "document_management_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_management_reviews" ADD CONSTRAINT "document_management_reviews_chaired_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("chaired_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_management_reviews" ADD CONSTRAINT "document_management_reviews_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_ppe" ADD CONSTRAINT "hazid_assessment_type_ppe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_ppe" ADD CONSTRAINT "hazid_assessment_type_ppe_type_id_hazid_assessment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."hazid_assessment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_questions" ADD CONSTRAINT "hazid_assessment_type_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_questions" ADD CONSTRAINT "hazid_assessment_type_questions_type_id_hazid_assessment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."hazid_assessment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_types" ADD CONSTRAINT "hazid_assessment_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_types" ADD CONSTRAINT "hazid_assessment_types_default_hazard_set_id_hazid_hazard_sets_id_fk" FOREIGN KEY ("default_hazard_set_id") REFERENCES "public"."hazid_hazard_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_hazard_sets" ADD CONSTRAINT "hazid_hazard_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_hazard_types" ADD CONSTRAINT "hazid_hazard_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_hazards" ADD CONSTRAINT "hazid_hazards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_hazards" ADD CONSTRAINT "hazid_hazards_hazard_type_id_hazid_hazard_types_id_fk" FOREIGN KEY ("hazard_type_id") REFERENCES "public"."hazid_hazard_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_hazards" ADD CONSTRAINT "hazid_hazards_photo_attachment_id_attachments_id_fk" FOREIGN KEY ("photo_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" ADD CONSTRAINT "hazid_location_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" ADD CONSTRAINT "hazid_location_tasks_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" ADD CONSTRAINT "hazid_location_tasks_task_id_hazid_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."hazid_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_tasks" ADD CONSTRAINT "hazid_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_cs_atmospheric" ADD CONSTRAINT "hazid_assessment_cs_atmospheric_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_cs_atmospheric" ADD CONSTRAINT "hazid_assessment_cs_atmospheric_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_cs_atmospheric" ADD CONSTRAINT "hazid_assessment_cs_atmospheric_atmospheric_sensor_id_atmospheric_sensors_id_fk" FOREIGN KEY ("atmospheric_sensor_id") REFERENCES "public"."atmospheric_sensors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_cs_entries" ADD CONSTRAINT "hazid_assessment_cs_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_cs_entries" ADD CONSTRAINT "hazid_assessment_cs_entries_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_cs_entries" ADD CONSTRAINT "hazid_assessment_cs_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" ADD CONSTRAINT "hazid_assessment_hazards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" ADD CONSTRAINT "hazid_assessment_hazards_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" ADD CONSTRAINT "hazid_assessment_hazards_hazard_id_hazid_hazards_id_fk" FOREIGN KEY ("hazard_id") REFERENCES "public"."hazid_hazards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_ppe" ADD CONSTRAINT "hazid_assessment_ppe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_ppe" ADD CONSTRAINT "hazid_assessment_ppe_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" ADD CONSTRAINT "hazid_assessment_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" ADD CONSTRAINT "hazid_assessment_photos_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" ADD CONSTRAINT "hazid_assessment_photos_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_questions" ADD CONSTRAINT "hazid_assessment_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_questions" ADD CONSTRAINT "hazid_assessment_questions_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" ADD CONSTRAINT "hazid_assessment_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" ADD CONSTRAINT "hazid_assessment_signatures_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" ADD CONSTRAINT "hazid_assessment_signatures_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" ADD CONSTRAINT "hazid_assessment_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" ADD CONSTRAINT "hazid_assessment_tasks_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" ADD CONSTRAINT "hazid_assessment_tasks_task_id_hazid_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."hazid_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_project_org_unit_id_org_units_id_fk" FOREIGN KEY ("project_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_supervisor_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("supervisor_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_supervisor_person_id_people_id_fk" FOREIGN KEY ("supervisor_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_reported_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("reported_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_assessment_type_id_hazid_assessment_types_id_fk" FOREIGN KEY ("assessment_type_id") REFERENCES "public"."hazid_assessment_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_cs_atmospheric_sensor_id_atmospheric_sensors_id_fk" FOREIGN KEY ("cs_atmospheric_sensor_id") REFERENCES "public"."atmospheric_sensors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_locked_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("locked_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD CONSTRAINT "hazid_signed_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD CONSTRAINT "hazid_signed_reports_pdf_attachment_id_attachments_id_fk" FOREIGN KEY ("pdf_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD CONSTRAINT "hazid_signed_reports_built_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("built_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_assignment_dispatches" ADD CONSTRAINT "toolbox_journal_assignment_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_assignment_dispatches" ADD CONSTRAINT "toolbox_journal_assignment_dispatches_assignment_id_toolbox_journal_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."toolbox_journal_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_assignments" ADD CONSTRAINT "toolbox_journal_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_assignments" ADD CONSTRAINT "toolbox_journal_assignments_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_attendees" ADD CONSTRAINT "toolbox_journal_attendees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_attendees" ADD CONSTRAINT "toolbox_journal_attendees_journal_id_toolbox_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."toolbox_journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_attendees" ADD CONSTRAINT "toolbox_journal_attendees_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_photos" ADD CONSTRAINT "toolbox_journal_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journal_photos" ADD CONSTRAINT "toolbox_journal_photos_journal_id_toolbox_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."toolbox_journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journals" ADD CONSTRAINT "toolbox_journals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journals" ADD CONSTRAINT "toolbox_journals_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_journals" ADD CONSTRAINT "toolbox_journals_foreman_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("foreman_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_equipment" ADD CONSTRAINT "lift_plan_equipment_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_equipment" ADD CONSTRAINT "lift_plan_equipment_lift_plan_id_lift_plans_id_fk" FOREIGN KEY ("lift_plan_id") REFERENCES "public"."lift_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_equipment" ADD CONSTRAINT "lift_plan_equipment_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_hazards" ADD CONSTRAINT "lift_plan_hazards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_hazards" ADD CONSTRAINT "lift_plan_hazards_lift_plan_id_lift_plans_id_fk" FOREIGN KEY ("lift_plan_id") REFERENCES "public"."lift_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_loads" ADD CONSTRAINT "lift_plan_loads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_loads" ADD CONSTRAINT "lift_plan_loads_lift_plan_id_lift_plans_id_fk" FOREIGN KEY ("lift_plan_id") REFERENCES "public"."lift_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_photos" ADD CONSTRAINT "lift_plan_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_photos" ADD CONSTRAINT "lift_plan_photos_lift_plan_id_lift_plans_id_fk" FOREIGN KEY ("lift_plan_id") REFERENCES "public"."lift_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_ppe" ADD CONSTRAINT "lift_plan_ppe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_ppe" ADD CONSTRAINT "lift_plan_ppe_lift_plan_id_lift_plans_id_fk" FOREIGN KEY ("lift_plan_id") REFERENCES "public"."lift_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_signatures" ADD CONSTRAINT "lift_plan_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_signatures" ADD CONSTRAINT "lift_plan_signatures_lift_plan_id_lift_plans_id_fk" FOREIGN KEY ("lift_plan_id") REFERENCES "public"."lift_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plan_signatures" ADD CONSTRAINT "lift_plan_signatures_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_project_org_unit_id_org_units_id_fk" FOREIGN KEY ("project_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_supervisor_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("supervisor_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_operator_person_id_people_id_fk" FOREIGN KEY ("operator_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_rigger_person_id_people_id_fk" FOREIGN KEY ("rigger_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_locked_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("locked_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_completed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("completed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_cancelled_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("cancelled_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_group_memberships" ADD CONSTRAINT "person_group_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_group_memberships" ADD CONSTRAINT "person_group_memberships_group_id_person_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."person_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_group_memberships" ADD CONSTRAINT "person_group_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_groups" ADD CONSTRAINT "person_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_division_memberships" ADD CONSTRAINT "person_division_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_division_memberships" ADD CONSTRAINT "person_division_memberships_division_id_person_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."person_divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_division_memberships" ADD CONSTRAINT "person_division_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_divisions" ADD CONSTRAINT "person_divisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_divisions" ADD CONSTRAINT "person_divisions_parent_division_id_person_divisions_id_fk" FOREIGN KEY ("parent_division_id") REFERENCES "public"."person_divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_title_assignments" ADD CONSTRAINT "person_title_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_title_assignments" ADD CONSTRAINT "person_title_assignments_title_id_person_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."person_titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_title_assignments" ADD CONSTRAINT "person_title_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_titles" ADD CONSTRAINT "person_titles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" ADD CONSTRAINT "job_title_task_acknowledgments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" ADD CONSTRAINT "job_title_task_acknowledgments_task_id_job_title_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."job_title_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" ADD CONSTRAINT "job_title_task_acknowledgments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_tasks" ADD CONSTRAINT "job_title_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_tasks" ADD CONSTRAINT "job_title_tasks_title_id_person_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."person_titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_records" ADD CONSTRAINT "safe_distance_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_records" ADD CONSTRAINT "safe_distance_records_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_records" ADD CONSTRAINT "safe_distance_records_supervisor_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("supervisor_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_records" ADD CONSTRAINT "safe_distance_records_operator_person_id_people_id_fk" FOREIGN KEY ("operator_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_classifications_tenant_idx" ON "incident_classifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_classifications_parent_idx" ON "incident_classifications" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_classifications_tenant_parent_name_ux" ON "incident_classifications" USING btree ("tenant_id","parent_id","name");--> statement-breakpoint
CREATE INDEX "incident_hours_periods_tenant_idx" ON "incident_hours_periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_hours_periods_range_idx" ON "incident_hours_periods" USING btree ("tenant_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "incident_hours_periods_site_idx" ON "incident_hours_periods" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "incident_injury_types_tenant_idx" ON "incident_injury_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_injury_types_tenant_name_ux" ON "incident_injury_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "equipment_categories_tenant_idx" ON "equipment_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_categories_tenant_slug_ux" ON "equipment_categories" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "equipment_expenses_tenant_idx" ON "equipment_expenses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_expenses_item_idx" ON "equipment_expenses" USING btree ("equipment_item_id","incurred_on");--> statement-breakpoint
CREATE INDEX "equipment_expenses_cat_idx" ON "equipment_expenses" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "equipment_expenses_date_idx" ON "equipment_expenses" USING btree ("tenant_id","incurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_rates_tenant_type_ux" ON "equipment_rates" USING btree ("tenant_id","type_id");--> statement-breakpoint
CREATE INDEX "equipment_rates_tenant_idx" ON "equipment_rates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_tenant_idx" ON "equipment_log_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_item_idx" ON "equipment_log_entries" USING btree ("equipment_item_id","entry_date");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_kind_idx" ON "equipment_log_entries" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "equipment_inspection_criteria_type_seq_idx" ON "equipment_inspection_criteria" USING btree ("inspection_type_id","sequence");--> statement-breakpoint
CREATE INDEX "equipment_inspection_criteria_tenant_idx" ON "equipment_inspection_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_types_tenant_idx" ON "equipment_inspection_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_types_applies_idx" ON "equipment_inspection_types" USING btree ("tenant_id","applies_to_type_id");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_tenant_idx" ON "equipment_checkouts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_item_idx" ON "equipment_checkouts" USING btree ("equipment_item_id","checked_out_at");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_open_idx" ON "equipment_checkouts" USING btree ("tenant_id","returned_at");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_holder_idx" ON "equipment_checkouts" USING btree ("tenant_id","holder_person_id");--> statement-breakpoint
CREATE INDEX "ppe_type_inspection_criteria_tenant_idx" ON "ppe_type_inspection_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_type_inspection_criteria_type_idx" ON "ppe_type_inspection_criteria" USING btree ("ppe_type_id","inspection_kind","entity_order");--> statement-breakpoint
CREATE INDEX "ppe_annual_records_tenant_idx" ON "ppe_annual_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_annual_records_item_idx" ON "ppe_annual_records" USING btree ("item_id","inspected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_annual_records_item_year_ux" ON "ppe_annual_records" USING btree ("item_id","year");--> statement-breakpoint
CREATE INDEX "ca_complete_steps_ca_idx" ON "ca_complete_steps" USING btree ("ca_id","entity_order");--> statement-breakpoint
CREATE INDEX "ca_complete_steps_tenant_idx" ON "ca_complete_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ca_photos_ca_idx" ON "ca_photos" USING btree ("ca_id");--> statement-breakpoint
CREATE INDEX "ca_photos_tenant_idx" ON "ca_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_type_banks_tenant_idx" ON "inspection_type_banks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_type_banks_type_idx" ON "inspection_type_banks" USING btree ("type_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_type_banks_type_bank_ux" ON "inspection_type_banks" USING btree ("type_id","bank_id");--> statement-breakpoint
CREATE INDEX "inspection_types_tenant_idx" ON "inspection_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_types_tenant_name_ux" ON "inspection_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "inspection_record_attachments_record_idx" ON "inspection_record_attachments" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "inspection_record_attachments_tenant_idx" ON "inspection_record_attachments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_records_tenant_idx" ON "inspection_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_records_tenant_reference_ux" ON "inspection_records" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "inspection_records_type_idx" ON "inspection_records" USING btree ("tenant_id","type_id");--> statement-breakpoint
CREATE INDEX "inspection_records_status_idx" ON "inspection_records" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "inspection_records_occurred_idx" ON "inspection_records" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inspection_records_site_idx" ON "inspection_records" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "inspection_records_inspector_idx" ON "inspection_records" USING btree ("tenant_id","inspector_tenant_user_id");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_tenant_idx" ON "inspection_record_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_record_idx" ON "inspection_record_criteria" USING btree ("record_id","sequence");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_answer_idx" ON "inspection_record_criteria" USING btree ("tenant_id","answer");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_corrective_idx" ON "inspection_record_criteria" USING btree ("corrective_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_record_criteria_record_criterion_ux" ON "inspection_record_criteria" USING btree ("record_id","criterion_id");--> statement-breakpoint
CREATE INDEX "inspection_assignment_compliance_tenant_idx" ON "inspection_assignment_compliance" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_assignment_compliance_assignment_idx" ON "inspection_assignment_compliance" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_assignment_compliance_assignment_person_ux" ON "inspection_assignment_compliance" USING btree ("assignment_id","person_id");--> statement-breakpoint
CREATE INDEX "inspection_assignment_dispatches_tenant_idx" ON "inspection_assignment_dispatches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_assignment_dispatches_assignment_idx" ON "inspection_assignment_dispatches" USING btree ("assignment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inspection_assignments_tenant_idx" ON "inspection_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_assignments_type_idx" ON "inspection_assignments" USING btree ("tenant_id","type_id");--> statement-breakpoint
CREATE INDEX "inspection_assignments_next_due_idx" ON "inspection_assignments" USING btree ("tenant_id","next_due_at");--> statement-breakpoint
CREATE INDEX "training_assessment_results_assessment_idx" ON "training_assessment_results" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "training_assessment_results_question_idx" ON "training_assessment_results" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "training_assessment_results_tenant_idx" ON "training_assessment_results" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_assessment_type_questions_tenant_idx" ON "training_assessment_type_questions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_assessment_type_questions_type_idx" ON "training_assessment_type_questions" USING btree ("type_id","entity_order");--> statement-breakpoint
CREATE INDEX "training_assessment_types_tenant_idx" ON "training_assessment_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_assessment_types_tenant_active_idx" ON "training_assessment_types" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "training_assessment_types_course_idx" ON "training_assessment_types" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "training_assessments_tenant_idx" ON "training_assessments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_assessments_person_idx" ON "training_assessments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "training_assessments_type_idx" ON "training_assessments" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "training_assessments_status_idx" ON "training_assessments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "training_assessments_completed_idx" ON "training_assessments" USING btree ("tenant_id","completed_at");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_records_assignment_idx" ON "training_audience_assignment_records" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_records_person_idx" ON "training_audience_assignment_records" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_records_status_idx" ON "training_audience_assignment_records" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "training_audience_assignment_records_uq" ON "training_audience_assignment_records" USING btree ("assignment_id","person_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_targets_assignment_idx" ON "training_audience_assignment_targets" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_targets_tenant_idx" ON "training_audience_assignment_targets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignments_tenant_idx" ON "training_audience_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignments_tenant_status_idx" ON "training_audience_assignments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "training_audience_assignments_due_idx" ON "training_audience_assignments" USING btree ("tenant_id","due_on");--> statement-breakpoint
CREATE INDEX "training_audience_assignments_course_idx" ON "training_audience_assignments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignments_type_idx" ON "training_audience_assignments" USING btree ("assessment_type_id");--> statement-breakpoint
CREATE INDEX "report_dashboards_tenant_idx" ON "report_dashboards" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_dashboards_tenant_name_ux" ON "report_dashboards" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "document_categories_tenant_idx" ON "document_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_categories_parent_idx" ON "document_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_categories_tenant_name_ux" ON "document_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "document_types_tenant_idx" ON "document_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_tenant_key_ux" ON "document_types" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "document_assignment_audience_tenant_idx" ON "document_assignment_audience" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_assignment_audience_assignment_idx" ON "document_assignment_audience" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_assignment_audience_unique_ux" ON "document_assignment_audience" USING btree ("assignment_id","type","entity_key");--> statement-breakpoint
CREATE INDEX "document_assignments_tenant_idx" ON "document_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_assignments_doc_idx" ON "document_assignments" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "document_assignments_due_idx" ON "document_assignments" USING btree ("tenant_id","due_on");--> statement-breakpoint
CREATE INDEX "document_reference_categories_tenant_idx" ON "document_reference_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_reference_categories_parent_idx" ON "document_reference_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_reference_categories_tenant_name_ux" ON "document_reference_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "document_reference_types_tenant_idx" ON "document_reference_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_reference_types_tenant_key_ux" ON "document_reference_types" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "document_management_reviews_tenant_idx" ON "document_management_reviews" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_management_reviews_period_idx" ON "document_management_reviews" USING btree ("tenant_id","period_end");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_ppe_type_idx" ON "hazid_assessment_type_ppe" USING btree ("type_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_ppe_tenant_idx" ON "hazid_assessment_type_ppe" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_questions_type_idx" ON "hazid_assessment_type_questions" USING btree ("type_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_questions_tenant_idx" ON "hazid_assessment_type_questions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_types_tenant_idx" ON "hazid_assessment_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_assessment_types_tenant_name_ux" ON "hazid_assessment_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "hazid_hazard_sets_tenant_idx" ON "hazid_hazard_sets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_hazard_types_tenant_idx" ON "hazid_hazard_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_hazard_types_tenant_name_ux" ON "hazid_hazard_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "hazid_hazards_tenant_idx" ON "hazid_hazards" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_hazards_name_idx" ON "hazid_hazards" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "hazid_hazards_type_idx" ON "hazid_hazards" USING btree ("tenant_id","hazard_type_id");--> statement-breakpoint
CREATE INDEX "hazid_location_tasks_tenant_idx" ON "hazid_location_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_location_tasks_org_idx" ON "hazid_location_tasks" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "hazid_location_tasks_task_idx" ON "hazid_location_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_location_tasks_org_task_ux" ON "hazid_location_tasks" USING btree ("org_unit_id","task_id");--> statement-breakpoint
CREATE INDEX "hazid_tasks_tenant_idx" ON "hazid_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_tasks_name_idx" ON "hazid_tasks" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "hazid_assessment_cs_atmospheric_assessment_idx" ON "hazid_assessment_cs_atmospheric" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_cs_atmospheric_tenant_idx" ON "hazid_assessment_cs_atmospheric" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_cs_entries_assessment_idx" ON "hazid_assessment_cs_entries" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_cs_entries_tenant_idx" ON "hazid_assessment_cs_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_hazards_assessment_idx" ON "hazid_assessment_hazards" USING btree ("assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_hazards_tenant_idx" ON "hazid_assessment_hazards" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_ppe_assessment_idx" ON "hazid_assessment_ppe" USING btree ("assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_ppe_tenant_idx" ON "hazid_assessment_ppe" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_photos_assessment_idx" ON "hazid_assessment_photos" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_photos_tenant_idx" ON "hazid_assessment_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_questions_assessment_idx" ON "hazid_assessment_questions" USING btree ("assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_questions_tenant_idx" ON "hazid_assessment_questions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_signatures_assessment_idx" ON "hazid_assessment_signatures" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_signatures_tenant_idx" ON "hazid_assessment_signatures" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_tasks_assessment_idx" ON "hazid_assessment_tasks" USING btree ("assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_tasks_tenant_idx" ON "hazid_assessment_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessments_tenant_idx" ON "hazid_assessments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_assessments_reference_idx" ON "hazid_assessments" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "hazid_assessments_occurred_idx" ON "hazid_assessments" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "hazid_assessments_site_idx" ON "hazid_assessments" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "hazid_assessments_type_idx" ON "hazid_assessments" USING btree ("tenant_id","assessment_type_id");--> statement-breakpoint
CREATE INDEX "hazid_assessments_supervisor_idx" ON "hazid_assessments" USING btree ("tenant_id","supervisor_person_id");--> statement-breakpoint
CREATE INDEX "hazid_signed_reports_tenant_idx" ON "hazid_signed_reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "hazid_signed_reports_status_idx" ON "hazid_signed_reports" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "toolbox_journal_assignment_dispatches_tenant_idx" ON "toolbox_journal_assignment_dispatches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "toolbox_journal_assignment_dispatches_assignment_idx" ON "toolbox_journal_assignment_dispatches" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "toolbox_journal_assignment_dispatches_occurred_idx" ON "toolbox_journal_assignment_dispatches" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "toolbox_journal_assignments_tenant_idx" ON "toolbox_journal_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "toolbox_journal_assignments_active_idx" ON "toolbox_journal_assignments" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "toolbox_journal_attendees_tenant_idx" ON "toolbox_journal_attendees" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "toolbox_journal_attendees_journal_idx" ON "toolbox_journal_attendees" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "toolbox_journal_attendees_person_idx" ON "toolbox_journal_attendees" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "toolbox_journal_attendees_journal_person_ux" ON "toolbox_journal_attendees" USING btree ("journal_id","person_id");--> statement-breakpoint
CREATE INDEX "toolbox_journal_photos_tenant_idx" ON "toolbox_journal_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "toolbox_journal_photos_journal_idx" ON "toolbox_journal_photos" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "toolbox_journals_tenant_idx" ON "toolbox_journals" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "toolbox_journals_tenant_ref_ux" ON "toolbox_journals" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "toolbox_journals_status_idx" ON "toolbox_journals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "toolbox_journals_occurred_idx" ON "toolbox_journals" USING btree ("tenant_id","occurred_on");--> statement-breakpoint
CREATE INDEX "toolbox_journals_site_idx" ON "toolbox_journals" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "toolbox_journals_foreman_idx" ON "toolbox_journals" USING btree ("tenant_id","foreman_tenant_user_id");--> statement-breakpoint
CREATE INDEX "lift_plan_equipment_plan_idx" ON "lift_plan_equipment" USING btree ("lift_plan_id","entity_order");--> statement-breakpoint
CREATE INDEX "lift_plan_equipment_tenant_idx" ON "lift_plan_equipment" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lift_plan_equipment_item_idx" ON "lift_plan_equipment" USING btree ("tenant_id","equipment_item_id");--> statement-breakpoint
CREATE INDEX "lift_plan_hazards_plan_idx" ON "lift_plan_hazards" USING btree ("lift_plan_id","entity_order");--> statement-breakpoint
CREATE INDEX "lift_plan_hazards_tenant_idx" ON "lift_plan_hazards" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lift_plan_loads_plan_idx" ON "lift_plan_loads" USING btree ("lift_plan_id","entity_order");--> statement-breakpoint
CREATE INDEX "lift_plan_loads_tenant_idx" ON "lift_plan_loads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lift_plan_photos_plan_idx" ON "lift_plan_photos" USING btree ("lift_plan_id");--> statement-breakpoint
CREATE INDEX "lift_plan_photos_tenant_idx" ON "lift_plan_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lift_plan_ppe_plan_idx" ON "lift_plan_ppe" USING btree ("lift_plan_id","entity_order");--> statement-breakpoint
CREATE INDEX "lift_plan_ppe_tenant_idx" ON "lift_plan_ppe" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lift_plan_signatures_plan_idx" ON "lift_plan_signatures" USING btree ("lift_plan_id");--> statement-breakpoint
CREATE INDEX "lift_plan_signatures_tenant_idx" ON "lift_plan_signatures" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lift_plans_tenant_idx" ON "lift_plans" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lift_plans_reference_idx" ON "lift_plans" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "lift_plans_status_idx" ON "lift_plans" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "lift_plans_lift_date_idx" ON "lift_plans" USING btree ("tenant_id","lift_date");--> statement-breakpoint
CREATE INDEX "lift_plans_site_idx" ON "lift_plans" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "lift_plans_project_idx" ON "lift_plans" USING btree ("tenant_id","project_org_unit_id");--> statement-breakpoint
CREATE INDEX "lift_plans_supervisor_idx" ON "lift_plans" USING btree ("tenant_id","supervisor_tenant_user_id");--> statement-breakpoint
CREATE INDEX "person_group_memberships_tenant_idx" ON "person_group_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "person_group_memberships_group_idx" ON "person_group_memberships" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "person_group_memberships_person_idx" ON "person_group_memberships" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_group_memberships_unique_ux" ON "person_group_memberships" USING btree ("group_id","person_id");--> statement-breakpoint
CREATE INDEX "person_groups_tenant_idx" ON "person_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_groups_tenant_name_ux" ON "person_groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "person_division_memberships_tenant_idx" ON "person_division_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "person_division_memberships_division_idx" ON "person_division_memberships" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "person_division_memberships_person_idx" ON "person_division_memberships" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_division_memberships_unique_ux" ON "person_division_memberships" USING btree ("division_id","person_id");--> statement-breakpoint
CREATE INDEX "person_divisions_tenant_idx" ON "person_divisions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "person_divisions_parent_idx" ON "person_divisions" USING btree ("parent_division_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_divisions_tenant_name_ux" ON "person_divisions" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "person_title_assignments_tenant_idx" ON "person_title_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "person_title_assignments_title_idx" ON "person_title_assignments" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "person_title_assignments_person_idx" ON "person_title_assignments" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_title_assignments_unique_ux" ON "person_title_assignments" USING btree ("title_id","person_id");--> statement-breakpoint
CREATE INDEX "person_titles_tenant_idx" ON "person_titles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_titles_tenant_name_ux" ON "person_titles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "job_title_task_acks_tenant_idx" ON "job_title_task_acknowledgments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "job_title_task_acks_task_idx" ON "job_title_task_acknowledgments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "job_title_task_acks_person_idx" ON "job_title_task_acknowledgments" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_title_task_acks_unique_ux" ON "job_title_task_acknowledgments" USING btree ("task_id","person_id");--> statement-breakpoint
CREATE INDEX "job_title_tasks_tenant_idx" ON "job_title_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "job_title_tasks_title_idx" ON "job_title_tasks" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "job_title_tasks_order_idx" ON "job_title_tasks" USING btree ("title_id","entity_order");--> statement-breakpoint
CREATE INDEX "safe_distance_records_tenant_idx" ON "safe_distance_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "safe_distance_records_tenant_ref_ux" ON "safe_distance_records" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "safe_distance_records_type_idx" ON "safe_distance_records" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "safe_distance_records_site_idx" ON "safe_distance_records" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "safe_distance_records_occurred_idx" ON "safe_distance_records" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "safe_distance_records_complies_idx" ON "safe_distance_records" USING btree ("tenant_id","complies");--> statement-breakpoint
ALTER TABLE "incident_injuries" ADD CONSTRAINT "incident_injuries_injury_type_id_incident_injury_types_id_fk" FOREIGN KEY ("injury_type_id") REFERENCES "public"."incident_injury_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_classification_id_incident_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."incident_classifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_types" ADD CONSTRAINT "equipment_types_category_id_equipment_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."equipment_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_injuries_injury_type_idx" ON "incident_injuries" USING btree ("injury_type_id");--> statement-breakpoint
CREATE INDEX "equipment_items_available_idx" ON "equipment_items" USING btree ("tenant_id","is_available_for_checkout");--> statement-breakpoint
CREATE INDEX "equipment_types_cat_idx" ON "equipment_types" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "corrective_actions_owner_idx" ON "corrective_actions" USING btree ("tenant_id","owner_tenant_user_id");--> statement-breakpoint
CREATE INDEX "report_definitions_tenant_kind_idx" ON "report_definitions" USING btree ("tenant_id","kind");