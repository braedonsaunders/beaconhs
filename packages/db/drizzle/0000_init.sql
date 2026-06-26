CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tenant_user_status" AS ENUM('active', 'invited', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."permission_override_effect" AS ENUM('grant', 'deny');--> statement-breakpoint
CREATE TYPE "public"."org_unit_level" AS ENUM('customer', 'project', 'site', 'area');--> statement-breakpoint
CREATE TYPE "public"."people_status" AS ENUM('active', 'inactive', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('image', 'document', 'video', 'audio', 'signature', 'other');--> statement-breakpoint
CREATE TYPE "public"."flow_gate_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."flow_subject_type" AS ENUM('form_template', 'module');--> statement-breakpoint
CREATE TYPE "public"."form_assignment_mode" AS ENUM('on_demand', 'scheduled', 'event_triggered', 'manual');--> statement-breakpoint
CREATE TYPE "public"."form_monitor_status" AS ENUM('active', 'completed', 'missed', 'escalated', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."form_response_checkin_kind" AS ENUM('manual', 'auto_prompted', 'missed', 'escalation_acknowledged');--> statement-breakpoint
CREATE TYPE "public"."form_response_compliance_status" AS ENUM('compliant', 'non_compliant', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."form_response_status" AS ENUM('draft', 'in_progress', 'submitted', 'in_review', 'closed', 'rejected', 'non_compliant');--> statement-breakpoint
CREATE TYPE "public"."form_template_kind" AS ENUM('form', 'wizard', 'checklist', 'register', 'mini_app');--> statement-breakpoint
CREATE TYPE "public"."form_template_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."ai_share_target_type" AS ENUM('user', 'role');--> statement-breakpoint
CREATE TYPE "public"."incident_factor_category" AS ENUM('equipment', 'procedure', 'training', 'environment', 'human', 'other');--> statement-breakpoint
CREATE TYPE "public"."incident_preventative_step_status" AS ENUM('planned', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('first_aid_only', 'medical_aid', 'lost_time', 'fatality', 'no_injury');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('reported', 'under_investigation', 'pending_review', 'closed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('injury', 'illness', 'near_miss', 'property_damage', 'environmental', 'security', 'other');--> statement-breakpoint
CREATE TYPE "public"."lost_time_status" AS ENUM('off_work', 'restricted_duty', 'full_duty');--> statement-breakpoint
CREATE TYPE "public"."training_class_attendance" AS ENUM('registered', 'attended', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."training_delivery_type" AS ENUM('classroom', 'self_paced', 'on_the_job', 'external_certificate');--> statement-breakpoint
CREATE TYPE "public"."training_record_source" AS ENUM('class', 'self_paced', 'evaluator', 'external_upload', 'migrated');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('in_service', 'out_of_service', 'in_repair', 'lost', 'retired');--> statement-breakpoint
CREATE TYPE "public"."work_order_priority" AS ENUM('low', 'med', 'high');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('open', 'assigned', 'in_progress', 'awaiting_parts', 'repaired', 'verified', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."equipment_inspection_criterion_kind" AS ENUM('pass_fail', 'pass_fail_na', 'text', 'numeric', 'photo');--> statement-breakpoint
CREATE TYPE "public"."equipment_inspection_criterion_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."equipment_inspection_interval" AS ENUM('pre_use', 'daily', 'weekly', 'monthly', 'quarterly', 'annually', 'five_year', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."equipment_inspection_record_answer" AS ENUM('pass', 'fail', 'n_a');--> statement-breakpoint
CREATE TYPE "public"."equipment_inspection_record_status" AS ENUM('draft', 'in_progress', 'submitted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."equipment_inspection_result" AS ENUM('pass', 'fail', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."equipment_checkout_condition" AS ENUM('good', 'fair', 'damaged', 'unusable');--> statement-breakpoint
CREATE TYPE "public"."ppe_inspection_kind" AS ENUM('pre_use', 'annual');--> statement-breakpoint
CREATE TYPE "public"."ppe_inspection_result" AS ENUM('pass', 'fail', 'n_a');--> statement-breakpoint
CREATE TYPE "public"."ppe_issue_action" AS ENUM('issue', 'return', 'replace', 'mark_damaged', 'discard');--> statement-breakpoint
CREATE TYPE "public"."ppe_issue_status" AS ENUM('open', 'resolved', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."ppe_item_status" AS ENUM('in_stock', 'issued', 'returned', 'damaged', 'discarded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ppe_criterion_inspection_kind" AS ENUM('pre_use', 'annual');--> statement-breakpoint
CREATE TYPE "public"."ppe_criterion_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ppe_annual_record_result" AS ENUM('pass', 'fail', 'remediated');--> statement-breakpoint
CREATE TYPE "public"."document_book_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."document_review_outcome" AS ENUM('approved_no_change', 'updated', 'retired');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'published', 'archived', 'under_review');--> statement-breakpoint
CREATE TYPE "public"."corrective_action_complete_step_kind" AS ENUM('action_taken', 'verification', 'signature');--> statement-breakpoint
CREATE TYPE "public"."corrective_action_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."corrective_action_source" AS ENUM('inspection', 'incident', 'near_miss', 'observation', 'audit', 'jsha', 'other');--> statement-breakpoint
CREATE TYPE "public"."corrective_action_status" AS ENUM('open', 'in_progress', 'pending_verification', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'push', 'sms');--> statement-breakpoint
CREATE TYPE "public"."inspection_bank_response_type" AS ENUM('pass_fail_na', 'rating', 'yes_no');--> statement-breakpoint
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
CREATE TYPE "public"."training_extra_field_owner_type" AS ENUM('skill', 'skill_type', 'authority');--> statement-breakpoint
CREATE TYPE "public"."training_content_item_kind" AS ENUM('rich', 'video', 'file', 'embed', 'slides');--> statement-breakpoint
CREATE TYPE "public"."training_enrollment_source" AS ENUM('self', 'assigned', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."training_enrollment_status" AS ENUM('not_started', 'in_progress', 'completed', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."training_lesson_completion_rule" AS ENUM('view', 'pass', 'acknowledge', 'min_time', 'evaluator');--> statement-breakpoint
CREATE TYPE "public"."training_lesson_kind" AS ENUM('rich', 'video', 'file', 'embed', 'quiz', 'session', 'slides', 'practical');--> statement-breakpoint
CREATE TYPE "public"."training_progress_status" AS ENUM('not_started', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."report_cadence" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."report_definition_kind" AS ENUM('built_in', 'custom');--> statement-breakpoint
CREATE TYPE "public"."report_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_reference_kind" AS ENUM('url', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."document_assignment_audience_type" AS ENUM('role', 'trade', 'department', 'person', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."kiosk_scan_kind" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."hazid_assessment_style" AS ENUM('task_based', 'hazard_based');--> statement-breakpoint
CREATE TYPE "public"."hazid_question_type" AS ENUM('yes_no', 'text', 'multi_select');--> statement-breakpoint
CREATE TYPE "public"."hazid_ppe_answer" AS ENUM('yes', 'no', 'na');--> statement-breakpoint
CREATE TYPE "public"."hazid_signature_type" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."hazid_signed_report_status" AS ENUM('pending', 'generating', 'ready', 'rendering', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."journal_assignment_frequency" AS ENUM('day', 'week', 'month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."journal_definition" AS ENUM('worker', 'supervisor');--> statement-breakpoint
CREATE TYPE "public"."journal_entry_status" AS ENUM('draft', 'submitted', 'archived');--> statement-breakpoint
CREATE TYPE "public"."journal_tag_source" AS ENUM('ai', 'user');--> statement-breakpoint
CREATE TYPE "public"."safe_distance_method" AS ENUM('nasa', 'asme', 'lloyds');--> statement-breakpoint
CREATE TYPE "public"."safe_distance_segment_unit" AS ENUM('inch', 'feet', 'mm', 'cm', 'm');--> statement-breakpoint
CREATE TYPE "public"."safe_distance_unit" AS ENUM('metric', 'imperial');--> statement-breakpoint
CREATE TYPE "public"."email_log_status" AS ENUM('queued', 'sent', 'failed', 'bounced', 'opened');--> statement-breakpoint
CREATE TYPE "public"."sms_log_status" AS ENUM('sent', 'failed', 'suppressed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."insight_card_kind" AS ENUM('question', 'model', 'metric', 'ai');--> statement-breakpoint
CREATE TYPE "public"."insight_share_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."compliance_audience_kind" AS ENUM('everyone', 'person', 'role', 'trade', 'department', 'org_unit');--> statement-breakpoint
CREATE TYPE "public"."compliance_dispatch_status" AS ENUM('scheduled', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."compliance_obligation_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."compliance_recurrence_kind" AS ENUM('one_time', 'frequency', 'cron', 'expiry', 'event');--> statement-breakpoint
CREATE TYPE "public"."compliance_source_module" AS ENUM('inspection', 'document', 'training', 'form', 'journal', 'cert_requirement', 'equipment_inspection', 'ppe_inspection', 'job_title_signoff', 'corrective_action', 'permit', 'lone_worker', 'custom', 'hazard_assessment');--> statement-breakpoint
CREATE TYPE "public"."compliance_status_value" AS ENUM('pending', 'in_progress', 'completed', 'overdue', 'expiring', 'waived', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."compliance_subject_kind" AS ENUM('per_person', 'per_record', 'per_task');--> statement-breakpoint
CREATE TYPE "public"."data_source_kind" AS ENUM('reference', 'responses');--> statement-breakpoint
CREATE TYPE "public"."email_template_category" AS ENUM('general', 'notification', 'reminder', 'approval', 'digest', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."pdf_orientation" AS ENUM('portrait', 'landscape');--> statement-breakpoint
CREATE TYPE "public"."pdf_paper_size" AS ENUM('letter', 'a4', 'legal');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"activeTenantId" uuid,
	"impersonating_user_id" text,
	"impersonation_tenant_id" uuid,
	"impersonation_started_at" timestamp with time zone,
	"impersonation_expires_at" timestamp with time zone,
	"impersonation_reason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text,
	"status" "tenant_user_status" DEFAULT 'active' NOT NULL,
	"invited_at" timestamp with time zone,
	"invited_by" text,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"region" text DEFAULT 'ca-central-1' NOT NULL,
	"default_language" text DEFAULT 'en' NOT NULL,
	"enabled_languages" jsonb DEFAULT '["en"]'::jsonb NOT NULL,
	"hierarchy" jsonb DEFAULT '{"customer":true,"project":true,"site":true,"area":false}'::jsonb NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_matrix" jsonb,
	"kiosk_pin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"isSuperAdmin" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"effect" "permission_override_effect" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"foreman_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" "org_unit_level" NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"lat" double precision,
	"lng" double precision,
	"geofence_meters" integer,
	"address" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text,
	"employee_no" text,
	"external_employee_id" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"formal_name" text,
	"job_title" text,
	"date_of_birth" date,
	"hire_date" date,
	"termination_date" date,
	"department_id" uuid,
	"trade_id" uuid,
	"crew_id" uuid,
	"email" text,
	"phone" text,
	"photo_attachment_id" uuid,
	"manager_person_id" uuid,
	"signature_attachment_id" uuid,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"notes" text,
	"status" "people_status" DEFAULT 'active' NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "people_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"notes" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" text,
	"actor_ip" text,
	"actor_user_agent" text,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"uploaded_by" text,
	"kind" "attachment_kind" NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"filename" text NOT NULL,
	"width" bigint,
	"height" bigint,
	"duration_ms" bigint,
	"captured_at" timestamp with time zone,
	"geo_lat" double precision,
	"geo_lng" double precision,
	"exif" jsonb,
	"annotations" jsonb,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" "flow_subject_type" NOT NULL,
	"subject_key" text,
	"subject_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"title" text NOT NULL,
	"assignee_tenant_user_id" uuid,
	"status" "flow_gate_status" DEFAULT 'pending' NOT NULL,
	"signature_required" boolean DEFAULT false NOT NULL,
	"signature_data_url" text,
	"comment" text,
	"decided_by_tenant_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"mode" "form_assignment_mode" NOT NULL,
	"target_role_keys" jsonb,
	"target_org_unit_ids" jsonb,
	"target_person_ids" jsonb,
	"cron" text,
	"due_offset_minutes" integer,
	"trigger_event" text,
	"trigger_filter" jsonb,
	"due_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" "flow_subject_type" DEFAULT 'form_template' NOT NULL,
	"subject_key" text,
	"template_id" uuid,
	"name" text DEFAULT 'Flow' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"graph" jsonb NOT NULL,
	"last_scheduled_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_response_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"kind" "form_response_checkin_kind" NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"geo_lat" double precision,
	"geo_lng" double precision,
	"note" text,
	"by_tenant_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "form_response_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"author_tenant_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_response_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"field_id" text NOT NULL,
	"section_id" text,
	"score" integer,
	"label" text,
	"weight" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_response_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"sequence" integer NOT NULL,
	"assignee_tenant_user_id" uuid,
	"signed_at" timestamp with time zone,
	"signature_attachment_id" uuid,
	"comment" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"signature_data_url" text,
	"signed_by_person_id" uuid,
	"signed_by_tenant_user_id" uuid,
	"rejection_reason" text,
	"rejected_at" timestamp with time zone,
	"rejected_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"assignment_id" uuid,
	"status" "form_response_status" DEFAULT 'draft' NOT NULL,
	"current_step" text,
	"site_org_unit_id" uuid,
	"subject_person_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_tenant_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_data" jsonb,
	"draft_updated_at" timestamp with time zone,
	"draft_step_index" integer,
	"source_entity_type" text,
	"source_entity_id" uuid,
	"compliance_score" numeric(6, 2),
	"compliance_status" "form_response_compliance_status",
	"pdf_attachment_id" uuid,
	"workflow_state" jsonb DEFAULT 'null'::jsonb,
	"monitor_status" "form_monitor_status",
	"checkin_interval_minutes" integer,
	"grace_period_minutes" integer,
	"monitor_require_geo" boolean DEFAULT false NOT NULL,
	"expected_end_at" timestamp with time zone,
	"next_checkin_due_at" timestamp with time zone,
	"last_checkin_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"changelog" text,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"status" "form_template_status" DEFAULT 'draft' NOT NULL,
	"kind" "form_template_kind" DEFAULT 'form' NOT NULL,
	"icon_key" text,
	"allowed_roles" jsonb,
	"module_binding" text,
	"email_on_submit" boolean DEFAULT false NOT NULL,
	"surface_as_tool" boolean DEFAULT false NOT NULL,
	"record_config" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_response_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"category" text,
	"person_id" uuid NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"signed_at" timestamp with time zone,
	"occurred_on" date,
	"field_id" text,
	"section_id" text,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversation_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"target_type" "ai_share_target_type" NOT NULL,
	"target_user_id" text,
	"target_role_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text,
	"scope" text NOT NULL,
	"scope_ref_id" text,
	"title" text DEFAULT 'New chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"content" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "incident_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_contributing_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"category" "incident_factor_category" NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_by_tenant_user_id" uuid,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_injuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"person_id" uuid,
	"person_name" text,
	"body_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"injury_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"injury_type_id" uuid,
	"treatment" text,
	"treated_at_facility" text,
	"worked_hours_prior_to" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_lost_time_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"injury_id" uuid,
	"status" "lost_time_status" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"person_id" uuid,
	"person_name_text" text,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_preventative_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"description" text NOT NULL,
	"owner_person_id" uuid,
	"target_date" date,
	"status" "incident_preventative_step_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_root_cause_whys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"why_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"type" "incident_type" NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"status" "incident_status" DEFAULT 'reported' NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"classification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site_org_unit_id" uuid,
	"location" text,
	"weather" text,
	"department_id" uuid,
	"reported_by_tenant_user_id" uuid,
	"supervisor_person_id" uuid,
	"foreman_text" text,
	"external_people_involved" text,
	"witnesses" text,
	"events_leading_up" text,
	"immediate_action_taken" text,
	"ppe_worn" text,
	"critical_injury" boolean DEFAULT false NOT NULL,
	"ministry_of_labour_notified" boolean DEFAULT false NOT NULL,
	"ems_notified" boolean DEFAULT false NOT NULL,
	"first_aid_received" boolean DEFAULT false NOT NULL,
	"first_aid_provider" text,
	"first_aid_given" boolean DEFAULT false NOT NULL,
	"first_aid_notes" text,
	"medical_attention_received" boolean DEFAULT false NOT NULL,
	"treated_at_hospital" text,
	"treated_in_city" text,
	"transportation" text,
	"ems_called" boolean DEFAULT false NOT NULL,
	"ems_arrived_at" timestamp with time zone,
	"hospital_name" text,
	"hospital_arrived_at" timestamp with time zone,
	"discharged_at" timestamp with time zone,
	"attending_physician" text,
	"mol_notified_at" timestamp with time zone,
	"mol_report_number" text,
	"lost_time" boolean DEFAULT false NOT NULL,
	"lost_time_first_day" date,
	"lost_time_last_day" date,
	"lost_time_days" integer,
	"modified_duty" boolean DEFAULT false NOT NULL,
	"modified_duty_first_day" date,
	"modified_duty_last_day" date,
	"modified_duty_days" integer,
	"externally_reportable" boolean DEFAULT false NOT NULL,
	"actual_severity" integer,
	"potential_severity" integer,
	"severity_rating" integer,
	"damage_estimate" numeric(14, 2),
	"police_notified" boolean DEFAULT false NOT NULL,
	"police_report_number" text,
	"insurance_claim_number" text,
	"classification_id" uuid,
	"root_cause" text,
	"contributing_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_investigator_tenant_user_id" uuid,
	"in_progress" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_tenant_user_id" uuid,
	"source_form_response_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"pdf_attachment_id" uuid,
	"verify_token" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_class_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "training_class_attendance" DEFAULT 'registered' NOT NULL,
	"sign_in_at" timestamp with time zone,
	"signature_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"site_org_unit_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"instructor_tenant_user_id" uuid,
	"capacity" integer,
	"hours_per_day" numeric(5, 2),
	"length_days" integer,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"delivery_type" "training_delivery_type" NOT NULL,
	"duration_minutes" integer,
	"valid_for_months" integer,
	"requires_evaluator" boolean DEFAULT false NOT NULL,
	"material_attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assessment" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid,
	"course_id" uuid,
	"source" "training_record_source" NOT NULL,
	"class_id" uuid,
	"score" integer,
	"grade" integer,
	"completed_on" date NOT NULL,
	"expires_on" date,
	"instructor" text,
	"evaluator_person_id" uuid,
	"certificate_type" text,
	"certificate_attachment_id" uuid,
	"issued_by_tenant_user_id" uuid,
	"details" text,
	"notes" text,
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
CREATE TABLE "equipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid,
	"asset_tag" text NOT NULL,
	"serial_number" text,
	"name" text NOT NULL,
	"description" text,
	"notes" text,
	"qr_token" text NOT NULL,
	"status" "equipment_status" DEFAULT 'in_service' NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"purchase_date" date,
	"warranty_expires_on" date,
	"current_site_org_unit_id" uuid,
	"current_holder_person_id" uuid,
	"photo_attachment_id" uuid,
	"manual_attachment_id" uuid,
	"requires_pre_use_inspection" boolean DEFAULT false NOT NULL,
	"pre_use_inspection_template_key" text,
	"last_pre_use_inspection_at" timestamp with time zone,
	"requires_annual_inspection" boolean DEFAULT false NOT NULL,
	"last_annual_inspection_on" date,
	"next_annual_inspection_due" date,
	"is_missing" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_seen_site_org_unit_id" uuid,
	"last_seen_holder_person_id" uuid,
	"missing_reported_at" timestamp with time zone,
	"missing_reported_by" text,
	"missing_last_seen_at" date,
	"missing_last_seen_location" text,
	"missing_notes" text,
	"missing_found_at" timestamp with time zone,
	"requires_oil_change" boolean DEFAULT false NOT NULL,
	"oil_change_interval_months" integer,
	"last_oil_change_on" date,
	"next_oil_change_due" date,
	"bulk_qr_token" text,
	"bulk_qr_generated_at" timestamp with time zone,
	"is_available_for_checkout" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "equipment_location_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"site_org_unit_id" uuid,
	"holder_person_id" uuid,
	"geo_lat" double precision,
	"geo_lng" double precision,
	"recorded_by_tenant_user_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "equipment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"category_id" uuid,
	"description" text,
	"requires_pre_use_inspection" jsonb,
	"inspection_schedule" jsonb,
	"default_oil_change_interval_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "work_order_status" DEFAULT 'open' NOT NULL,
	"priority" "work_order_priority" DEFAULT 'med' NOT NULL,
	"summary" text NOT NULL,
	"description" text,
	"action_taken" text,
	"cost" numeric(12, 2),
	"reported_by_person_id" uuid,
	"opened_by_tenant_user_id" uuid,
	"assigned_to_tenant_user_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "truck_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"driver_person_id" uuid,
	"start_odometer" integer,
	"end_odometer" integer,
	"km_driven" integer,
	"site_org_unit_id" uuid,
	"hours_on_site" numeric(6, 2),
	"manpower_count" integer,
	"notes" text,
	"created_by_tenant_user_id" uuid,
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
	"group_id" uuid,
	"sequence" integer NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"kind" "equipment_inspection_criterion_kind" DEFAULT 'pass_fail' NOT NULL,
	"severity" "equipment_inspection_criterion_severity" DEFAULT 'medium' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_inspection_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inspection_type_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"description" text,
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
CREATE TABLE "equipment_inspection_record_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_inspection_record_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"criterion_id" uuid,
	"question_text_snapshot" text NOT NULL,
	"group_label_snapshot" text,
	"kind" "equipment_inspection_criterion_kind" DEFAULT 'pass_fail' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"sequence" integer NOT NULL,
	"answer" "equipment_inspection_record_answer",
	"numeric_value" numeric,
	"text_value" text,
	"answered_at" timestamp with time zone,
	"answered_by_tenant_user_id" uuid,
	"severity" "equipment_inspection_criterion_severity",
	"comment" text,
	"action_taken" text,
	"corrected_on" date,
	"photo_attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_inspection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"inspection_type_id" uuid,
	"equipment_item_id" uuid NOT NULL,
	"status" "equipment_inspection_record_status" DEFAULT 'draft' NOT NULL,
	"result" "equipment_inspection_result",
	"locked" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"interval_snapshot" "equipment_inspection_interval",
	"last_inspection_on" date,
	"next_due_on" date,
	"site_org_unit_id" uuid,
	"inspector_tenant_user_id" uuid,
	"inspector_person_id" uuid,
	"inspector_text" text,
	"supervisor_tenant_user_id" uuid,
	"foreman_person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"foreman_text" text,
	"hours" numeric,
	"serial" text,
	"certificate" text,
	"is_rental" boolean DEFAULT false NOT NULL,
	"work_order_id" uuid,
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
CREATE TABLE "ppe_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "ppe_inspection_kind" NOT NULL,
	"result" "ppe_inspection_result" NOT NULL,
	"inspected_by_tenant_user_id" uuid,
	"inspected_on" date NOT NULL,
	"next_due_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_issue_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reported_by_tenant_user_id" uuid,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"status" "ppe_issue_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"person_id" uuid,
	"action" "ppe_issue_action" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"issued_by_tenant_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"receipt_signature_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"serial_number" text,
	"size" text,
	"status" "ppe_item_status" DEFAULT 'in_stock' NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"current_holder_person_id" uuid,
	"purchase_date" date,
	"expires_on" date,
	"notes" text,
	"last_inspection_on" date,
	"next_inspection_due" date,
	"last_annual_inspection_on" date,
	"next_annual_inspection_due" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ppe_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"is_inspectable" boolean DEFAULT false NOT NULL,
	"inspection_schedule" jsonb,
	"sizing_scheme" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_type_criteria_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ppe_type_id" uuid NOT NULL,
	"inspection_kind" "ppe_criterion_inspection_kind" DEFAULT 'pre_use' NOT NULL,
	"label" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_type_inspection_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ppe_type_id" uuid NOT NULL,
	"group_id" uuid,
	"inspection_kind" "ppe_criterion_inspection_kind" DEFAULT 'pre_use' NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"severity" "ppe_criterion_severity" DEFAULT 'medium' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"entity_order" integer DEFAULT 0 NOT NULL,
	"source_bank_id" uuid,
	"source_bank_criterion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_criteria_bank_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"severity" "ppe_criterion_severity" DEFAULT 'medium' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppe_criteria_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_by" text,
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
CREATE TABLE "document_acknowledgment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"title" text,
	"location" text,
	"notes" text,
	"conducted_by_tenant_user_id" uuid,
	"conducted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_acknowledgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"session_id" uuid,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text,
	"category" text,
	"type_id" uuid,
	"category_id" uuid,
	"review_frequency_months" integer,
	"next_review_on" date,
	"status" "document_book_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"contents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"anchor_id" text,
	"quoted_text" text,
	"body" text NOT NULL,
	"author_tenant_user_id" uuid NOT NULL,
	"thread_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"content_json" jsonb,
	"content_html" text,
	"base_version_id" uuid,
	"updated_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"reviewed_by_tenant_user_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "document_review_outcome" NOT NULL,
	"next_review_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_attachment_id" uuid,
	"content_markdown" text,
	"content_json" jsonb,
	"published_at" timestamp with time zone,
	"published_by" text,
	"changelog" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"type_id" uuid,
	"category_id" uuid,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"owner_tenant_user_id" uuid,
	"review_frequency_months" integer,
	"next_review_on" date,
	"required_for_role_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_for_trade_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"print_header" boolean DEFAULT true NOT NULL,
	"print_footer" boolean DEFAULT true NOT NULL,
	"page_size" text DEFAULT 'Letter' NOT NULL,
	"header_text" text,
	"footer_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
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
CREATE TABLE "corrective_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" "corrective_action_severity" DEFAULT 'medium' NOT NULL,
	"status" "corrective_action_status" DEFAULT 'open' NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"assigned_by_tenant_user_id" uuid,
	"owner_tenant_user_id" uuid,
	"site_org_unit_id" uuid,
	"assigned_on" date,
	"due_on" date,
	"root_cause" text,
	"action_taken" text,
	"source" "corrective_action_source",
	"source_entity_type" text,
	"source_entity_id" uuid,
	"source_form_response_id" uuid,
	"verification_required" boolean DEFAULT false NOT NULL,
	"verification_notes" text,
	"verified_by_tenant_user_id" uuid,
	"verified_at" timestamp with time zone,
	"cost_impact" numeric(12, 2),
	"closed_at" timestamp with time zone,
	"locked" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_path" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webpush_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_plugin_id" uuid,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_plugin_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_plugin_id" uuid NOT NULL,
	"key_name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"key_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plugin_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_export_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"integration_key" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"external_system" text NOT NULL,
	"external_ref" text,
	"status" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"integration_key" text,
	"name" text,
	"trigger_key" text,
	"destination_key" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"last_error" text,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_bank_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"response_type" "inspection_bank_response_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_by" text,
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
CREATE TABLE "inspection_type_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"group_id" uuid,
	"sequence" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"response_type" "inspection_bank_response_type" DEFAULT 'pass_fail_na' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"source_bank_id" uuid,
	"source_bank_criterion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_type_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"group_label_snapshot" text,
	"response_type" "inspection_bank_response_type" DEFAULT 'pass_fail_na' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
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
	"corrected_on" date,
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
CREATE TABLE "training_skill_assignment_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_assignment_id" uuid NOT NULL,
	"attachment_id" uuid,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_skill_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid,
	"skill_type_id" uuid,
	"granted_on" date NOT NULL,
	"expires_on" date,
	"granted_by_tenant_user_id" uuid,
	"evidence_attachment_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_skill_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"jurisdiction" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_skill_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_assignment_id" uuid NOT NULL,
	"pdf_attachment_id" uuid,
	"verify_token" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_skill_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"authority_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"valid_for_months" integer,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "training_course_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"attachment_id" uuid,
	"label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_extra_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_type" "training_extra_field_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"field_value" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" "training_content_item_kind" DEFAULT 'rich' NOT NULL,
	"content_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_json" jsonb,
	"content_html" text,
	"slides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"import_status" text,
	"import_error" text,
	"attachment_id" uuid,
	"embed_url" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_course_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "training_enrollment_status" DEFAULT 'not_started' NOT NULL,
	"source" "training_enrollment_source" DEFAULT 'self' NOT NULL,
	"assigned_by_tenant_user_id" uuid,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"current_lesson_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"due_on" date,
	"expires_on" date,
	"record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_lesson_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "training_progress_status" DEFAULT 'not_started' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"time_spent_seconds" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_position" jsonb,
	"assessment_id" uuid,
	"evaluated_by_tenant_user_id" uuid,
	"evaluation_notes" text,
	"evaluation_signature_data_url" text,
	"criteria_results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "training_lesson_kind" DEFAULT 'rich' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"content_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_json" jsonb,
	"content_html" text,
	"slides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"practical_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"import_status" text,
	"import_error" text,
	"assessment_type_id" uuid,
	"class_id" uuid,
	"attachment_id" uuid,
	"embed_url" text,
	"content_item_id" uuid,
	"duration_minutes" integer,
	"is_required" boolean DEFAULT true NOT NULL,
	"completion_rule" "training_lesson_completion_rule" DEFAULT 'view' NOT NULL,
	"min_time_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" "report_definition_kind" DEFAULT 'built_in' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"query_kind" text NOT NULL,
	"custom_query" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "report_run_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"pdf_attachment_id" uuid,
	"row_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cadence" "report_cadence" NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"hour" integer NOT NULL,
	"minute" integer NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"recipient_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_notification_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"digest_mode" text DEFAULT 'off' NOT NULL,
	"digest_hour_utc" integer DEFAULT 7 NOT NULL,
	"quiet_hours" jsonb DEFAULT 'null'::jsonb,
	"scan_cron" text DEFAULT '0 6 * * *' NOT NULL,
	"scan_timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_notification_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"role_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_assignment_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"audience_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_plugin_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'queued' NOT NULL,
	"duration_ms" text,
	"summary" text,
	"error" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_book_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"type_id" uuid,
	"kind" "document_reference_kind" NOT NULL,
	"url" text,
	"attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
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
CREATE TABLE "kiosk_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "kiosk_scan_kind" NOT NULL,
	"site_org_unit_id" uuid,
	"crew_id" uuid,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_type_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT false NOT NULL,
	"auto_create" boolean DEFAULT true NOT NULL,
	"entity_order" integer DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
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
	"default_hazard_set_id" uuid,
	"available_to_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
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
	"pre_likelihood" integer,
	"pre_severity" integer,
	"post_likelihood" integer,
	"post_severity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hazid_assessment_app_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"type_app_id" uuid,
	"template_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"entity_order" integer DEFAULT 1 NOT NULL,
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
	"pre_likelihood" integer,
	"pre_severity" integer,
	"controls" text,
	"post_likelihood" integer,
	"post_severity" integer,
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
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_assignment_dispatches" (
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
CREATE TABLE "journal_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frequency" "journal_assignment_frequency" DEFAULT 'week' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"due_offset_days" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"compliant_percentage" integer DEFAULT 100 NOT NULL,
	"send_to_additional" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cron" text,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"person_id" uuid,
	"supervisor_person_id" uuid,
	"created_by_tenant_user_id" uuid,
	"entry_date" date NOT NULL,
	"site_org_unit_id" uuid,
	"definition" "journal_definition" DEFAULT 'worker' NOT NULL,
	"title" text,
	"body_html" text,
	"body_text" text,
	"summary" text,
	"status" "journal_entry_status" DEFAULT 'draft' NOT NULL,
	"weather" jsonb,
	"geo" jsonb,
	"tags_cache" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_text, '') || ' ' || coalesce(summary, ''))) STORED,
	"submitted_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journal_entry_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entry_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"source" "journal_tag_source" DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "person_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"attachment_id" uuid,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"name" text DEFAULT 'Pressure test' NOT NULL,
	"method" "safe_distance_method" DEFAULT 'nasa' NOT NULL,
	"unit" "safe_distance_unit" DEFAULT 'imperial' NOT NULL,
	"test_pressure" numeric(12, 4) DEFAULT '0' NOT NULL,
	"description" text,
	"site_org_unit_id" uuid,
	"supervisor_tenant_user_id" uuid,
	"operator_person_id" uuid,
	"total_volume" numeric(16, 6) DEFAULT '0' NOT NULL,
	"result_nasa" numeric(12, 4) DEFAULT '0' NOT NULL,
	"result_asme" numeric(12, 4) DEFAULT '0' NOT NULL,
	"result_lloyds" numeric(12, 4) DEFAULT '0' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "safe_distance_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"name" text,
	"unit" "safe_distance_segment_unit" DEFAULT 'inch' NOT NULL,
	"length_value" numeric(16, 6) DEFAULT '0' NOT NULL,
	"internal_diameter" numeric(16, 6) DEFAULT '0' NOT NULL,
	"volume_m3" numeric(18, 9) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_dashboard_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"layout" jsonb NOT NULL,
	"source_role" text,
	"is_customised" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"job_id" text,
	"provider_message_id" text,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_primary" text,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_addr" text NOT NULL,
	"reply_to_addr" text,
	"subject" text NOT NULL,
	"html_size" integer DEFAULT 0 NOT NULL,
	"text_size" integer DEFAULT 0 NOT NULL,
	"html_body" text,
	"text_body" text,
	"status" "email_log_status" DEFAULT 'queued' NOT NULL,
	"category_key" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"job_id" text,
	"provider_message_id" text,
	"provider" text,
	"recipient" text,
	"body" text,
	"body_length" integer DEFAULT 0 NOT NULL,
	"status" "sms_log_status" DEFAULT 'sent' NOT NULL,
	"category_key" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_nav_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"layout" jsonb DEFAULT '{"widgets":[]}'::jsonb NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"param_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "insight_share_status" DEFAULT 'draft' NOT NULL,
	"allowed_roles" jsonb,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "insight_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"description" text,
	"kind" "insight_card_kind" DEFAULT 'question' NOT NULL,
	"query" jsonb NOT NULL,
	"viz_type" text DEFAULT 'table' NOT NULL,
	"viz_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb,
	"status" "insight_share_status" DEFAULT 'draft' NOT NULL,
	"allowed_roles" jsonb,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "insight_dashboard_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_audience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"kind" "compliance_audience_kind" NOT NULL,
	"entity_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date,
	"period_start" date,
	"period_end" date,
	"status" "compliance_dispatch_status" DEFAULT 'scheduled' NOT NULL,
	"audience_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_module" "compliance_source_module" NOT NULL,
	"subject_kind" "compliance_subject_kind" NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" "compliance_obligation_status" DEFAULT 'active' NOT NULL,
	"target_ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recurrence" jsonb NOT NULL,
	"recurrence_kind" "compliance_recurrence_kind" NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"legacy_table" text,
	"legacy_id" uuid,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "compliance_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"person_id" uuid,
	"subject_ref" jsonb,
	"subject_key" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"due_on" date,
	"status" "compliance_status_value" DEFAULT 'pending' NOT NULL,
	"completed_on" date,
	"count" integer DEFAULT 0 NOT NULL,
	"expected" integer DEFAULT 0 NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"source_ref" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_source_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "data_source_kind" DEFAULT 'reference' NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"schedule" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_id" uuid,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_crosswalk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"source_system" text NOT NULL,
	"external_id" text NOT NULL,
	"canonical_id" uuid NOT NULL,
	"row_hash" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "email_template_category" DEFAULT 'general' NOT NULL,
	"record_subject_type" text,
	"record_subject_key" text,
	"subject_template" text DEFAULT '' NOT NULL,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compiled_html" text DEFAULT '' NOT NULL,
	"mjml_source" text,
	"merge_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdf_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"record_subject_type" text,
	"record_subject_key" text,
	"paper_size" "pdf_paper_size" DEFAULT 'letter' NOT NULL,
	"orientation" "pdf_orientation" DEFAULT 'portrait' NOT NULL,
	"margin_mm" integer DEFAULT 16 NOT NULL,
	"header_html" text,
	"footer_html" text,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compiled_html" text DEFAULT '' NOT NULL,
	"source_html" text,
	"merge_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_module_default" boolean DEFAULT false NOT NULL,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_impersonating_user_id_user_id_fk" FOREIGN KEY ("impersonating_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_manager_person_id_people_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_assignments" ADD CONSTRAINT "people_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_assignments" ADD CONSTRAINT "people_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_assignments" ADD CONSTRAINT "people_assignments_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_gates" ADD CONSTRAINT "flow_gates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_gates" ADD CONSTRAINT "flow_gates_flow_id_form_automations_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."form_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_gates" ADD CONSTRAINT "flow_gates_assignee_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assignee_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_gates" ADD CONSTRAINT "flow_gates_decided_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("decided_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_automations" ADD CONSTRAINT "form_automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_automations" ADD CONSTRAINT "form_automations_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_checkins" ADD CONSTRAINT "form_response_checkins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_checkins" ADD CONSTRAINT "form_response_checkins_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_checkins" ADD CONSTRAINT "form_response_checkins_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_comments" ADD CONSTRAINT "form_response_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_comments" ADD CONSTRAINT "form_response_comments_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_comments" ADD CONSTRAINT "form_response_comments_author_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("author_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_scores" ADD CONSTRAINT "form_response_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_scores" ADD CONSTRAINT "form_response_scores_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_assignee_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assignee_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_signed_by_person_id_people_id_fk" FOREIGN KEY ("signed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_signed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("signed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_rejected_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("rejected_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_template_version_id_form_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."form_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_assignment_id_form_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."form_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_subject_person_id_people_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_submitted_by_tenant_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_locked_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("locked_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_participants" ADD CONSTRAINT "form_response_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_participants" ADD CONSTRAINT "form_response_participants_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_participants" ADD CONSTRAINT "form_response_participants_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_participants" ADD CONSTRAINT "form_response_participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_target_role_id_roles_id_fk" FOREIGN KEY ("target_role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_classifications" ADD CONSTRAINT "incident_classifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_classifications" ADD CONSTRAINT "incident_classifications_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_hours_periods" ADD CONSTRAINT "incident_hours_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_hours_periods" ADD CONSTRAINT "incident_hours_periods_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_hours_periods" ADD CONSTRAINT "incident_hours_periods_entered_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("entered_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_injury_types" ADD CONSTRAINT "incident_injury_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_injury_types" ADD CONSTRAINT "incident_injury_types_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_contributing_factors" ADD CONSTRAINT "incident_contributing_factors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_contributing_factors" ADD CONSTRAINT "incident_contributing_factors_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_recorded_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("recorded_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_injuries" ADD CONSTRAINT "incident_injuries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_injuries" ADD CONSTRAINT "incident_injuries_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_injuries" ADD CONSTRAINT "incident_injuries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_injuries" ADD CONSTRAINT "incident_injuries_injury_type_id_incident_injury_types_id_fk" FOREIGN KEY ("injury_type_id") REFERENCES "public"."incident_injury_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_lost_time_events" ADD CONSTRAINT "incident_lost_time_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_lost_time_events" ADD CONSTRAINT "incident_lost_time_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_lost_time_events" ADD CONSTRAINT "incident_lost_time_events_injury_id_incident_injuries_id_fk" FOREIGN KEY ("injury_id") REFERENCES "public"."incident_injuries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_people" ADD CONSTRAINT "incident_people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_people" ADD CONSTRAINT "incident_people_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_people" ADD CONSTRAINT "incident_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_preventative_steps" ADD CONSTRAINT "incident_preventative_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_preventative_steps" ADD CONSTRAINT "incident_preventative_steps_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_preventative_steps" ADD CONSTRAINT "incident_preventative_steps_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_root_cause_whys" ADD CONSTRAINT "incident_root_cause_whys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_root_cause_whys" ADD CONSTRAINT "incident_root_cause_whys_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("reported_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_supervisor_person_id_people_id_fk" FOREIGN KEY ("supervisor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_classification_id_incident_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."incident_classifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assigned_investigator_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assigned_investigator_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_closed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("closed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_record_id_training_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."training_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD CONSTRAINT "training_class_attendees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD CONSTRAINT "training_class_attendees_class_id_training_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."training_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD CONSTRAINT "training_class_attendees_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_classes" ADD CONSTRAINT "training_classes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_classes" ADD CONSTRAINT "training_classes_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_classes" ADD CONSTRAINT "training_classes_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_classes" ADD CONSTRAINT "training_classes_instructor_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("instructor_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_class_id_training_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."training_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_evaluator_person_id_people_id_fk" FOREIGN KEY ("evaluator_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_issued_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("issued_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_type_id_equipment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_current_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("current_site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_current_holder_person_id_people_id_fk" FOREIGN KEY ("current_holder_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_last_seen_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("last_seen_site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_last_seen_holder_person_id_people_id_fk" FOREIGN KEY ("last_seen_holder_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_missing_reported_by_user_id_fk" FOREIGN KEY ("missing_reported_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_location_history" ADD CONSTRAINT "equipment_location_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_location_history" ADD CONSTRAINT "equipment_location_history_item_id_equipment_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_location_history" ADD CONSTRAINT "equipment_location_history_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_location_history" ADD CONSTRAINT "equipment_location_history_holder_person_id_people_id_fk" FOREIGN KEY ("holder_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_location_history" ADD CONSTRAINT "equipment_location_history_recorded_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("recorded_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_types" ADD CONSTRAINT "equipment_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_types" ADD CONSTRAINT "equipment_types_category_id_equipment_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."equipment_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD CONSTRAINT "equipment_work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD CONSTRAINT "equipment_work_orders_item_id_equipment_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD CONSTRAINT "equipment_work_orders_reported_by_person_id_people_id_fk" FOREIGN KEY ("reported_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD CONSTRAINT "equipment_work_orders_opened_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("opened_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD CONSTRAINT "equipment_work_orders_assigned_to_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assigned_to_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_driver_person_id_people_id_fk" FOREIGN KEY ("driver_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_person_person_id_people_id_fk" FOREIGN KEY ("person_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" ADD CONSTRAINT "equipment_log_entries_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_criteria" ADD CONSTRAINT "equipment_inspection_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_criteria" ADD CONSTRAINT "equipment_inspection_criteria_inspection_type_id_equipment_inspection_types_id_fk" FOREIGN KEY ("inspection_type_id") REFERENCES "public"."equipment_inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_criteria" ADD CONSTRAINT "equipment_inspection_criteria_group_id_equipment_inspection_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."equipment_inspection_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_groups" ADD CONSTRAINT "equipment_inspection_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_groups" ADD CONSTRAINT "equipment_inspection_groups_inspection_type_id_equipment_inspection_types_id_fk" FOREIGN KEY ("inspection_type_id") REFERENCES "public"."equipment_inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_types" ADD CONSTRAINT "equipment_inspection_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_types" ADD CONSTRAINT "equipment_inspection_types_applies_to_type_id_equipment_types_id_fk" FOREIGN KEY ("applies_to_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_attachments" ADD CONSTRAINT "equipment_inspection_record_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_attachments" ADD CONSTRAINT "equipment_inspection_record_attachments_record_id_equipment_inspection_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."equipment_inspection_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_criteria" ADD CONSTRAINT "equipment_inspection_record_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_criteria" ADD CONSTRAINT "equipment_inspection_record_criteria_record_id_equipment_inspection_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."equipment_inspection_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_criteria" ADD CONSTRAINT "equipment_inspection_record_criteria_answered_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("answered_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_criteria" ADD CONSTRAINT "equipment_inspection_record_criteria_work_order_id_equipment_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."equipment_work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_inspection_type_id_equipment_inspection_types_id_fk" FOREIGN KEY ("inspection_type_id") REFERENCES "public"."equipment_inspection_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_inspector_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("inspector_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_inspector_person_id_people_id_fk" FOREIGN KEY ("inspector_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_supervisor_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("supervisor_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_work_order_id_equipment_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."equipment_work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_submitted_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("submitted_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_closed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("closed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_holder_person_id_people_id_fk" FOREIGN KEY ("holder_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_destination_org_unit_id_org_units_id_fk" FOREIGN KEY ("destination_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_checked_out_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("checked_out_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" ADD CONSTRAINT "equipment_checkouts_checked_in_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("checked_in_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD CONSTRAINT "ppe_inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD CONSTRAINT "ppe_inspections_item_id_ppe_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ppe_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD CONSTRAINT "ppe_inspections_inspected_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("inspected_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" ADD CONSTRAINT "ppe_issue_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" ADD CONSTRAINT "ppe_issue_reports_item_id_ppe_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ppe_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" ADD CONSTRAINT "ppe_issue_reports_reported_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("reported_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_issues" ADD CONSTRAINT "ppe_issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_issues" ADD CONSTRAINT "ppe_issues_item_id_ppe_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ppe_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_issues" ADD CONSTRAINT "ppe_issues_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_issues" ADD CONSTRAINT "ppe_issues_issued_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("issued_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_items" ADD CONSTRAINT "ppe_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_items" ADD CONSTRAINT "ppe_items_type_id_ppe_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."ppe_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_items" ADD CONSTRAINT "ppe_items_current_holder_person_id_people_id_fk" FOREIGN KEY ("current_holder_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_types" ADD CONSTRAINT "ppe_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_type_criteria_groups" ADD CONSTRAINT "ppe_type_criteria_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_type_criteria_groups" ADD CONSTRAINT "ppe_type_criteria_groups_ppe_type_id_ppe_types_id_fk" FOREIGN KEY ("ppe_type_id") REFERENCES "public"."ppe_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_type_inspection_criteria" ADD CONSTRAINT "ppe_type_inspection_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_type_inspection_criteria" ADD CONSTRAINT "ppe_type_inspection_criteria_ppe_type_id_ppe_types_id_fk" FOREIGN KEY ("ppe_type_id") REFERENCES "public"."ppe_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_type_inspection_criteria" ADD CONSTRAINT "ppe_type_inspection_criteria_group_id_ppe_type_criteria_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ppe_type_criteria_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_criteria_bank_criteria" ADD CONSTRAINT "ppe_criteria_bank_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_criteria_bank_criteria" ADD CONSTRAINT "ppe_criteria_bank_criteria_bank_id_ppe_criteria_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."ppe_criteria_banks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_criteria_banks" ADD CONSTRAINT "ppe_criteria_banks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_criteria_banks" ADD CONSTRAINT "ppe_criteria_banks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" ADD CONSTRAINT "ppe_annual_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" ADD CONSTRAINT "ppe_annual_records_item_id_ppe_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ppe_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" ADD CONSTRAINT "ppe_annual_records_inspected_by_person_id_people_id_fk" FOREIGN KEY ("inspected_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" ADD CONSTRAINT "ppe_annual_records_certificate_attachment_id_attachments_id_fk" FOREIGN KEY ("certificate_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions" ADD CONSTRAINT "document_acknowledgment_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions" ADD CONSTRAINT "document_acknowledgment_sessions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions" ADD CONSTRAINT "document_acknowledgment_sessions_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions" ADD CONSTRAINT "document_acknowledgment_sessions_conducted_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("conducted_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_session_id_document_acknowledgment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."document_acknowledgment_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_books" ADD CONSTRAINT "document_books_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_books" ADD CONSTRAINT "document_books_type_id_document_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_books" ADD CONSTRAINT "document_books_category_id_document_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."document_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_books" ADD CONSTRAINT "document_books_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_author_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("author_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_resolved_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("resolved_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_base_version_id_document_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_updated_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("updated_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_reviewed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("reviewed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_id_document_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_document_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."document_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("owner_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_complete_steps" ADD CONSTRAINT "ca_complete_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_complete_steps" ADD CONSTRAINT "ca_complete_steps_ca_id_corrective_actions_id_fk" FOREIGN KEY ("ca_id") REFERENCES "public"."corrective_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_complete_steps" ADD CONSTRAINT "ca_complete_steps_completed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("completed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_photos" ADD CONSTRAINT "ca_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_photos" ADD CONSTRAINT "ca_photos_ca_id_corrective_actions_id_fk" FOREIGN KEY ("ca_id") REFERENCES "public"."corrective_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assigned_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assigned_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_owner_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("owner_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_verified_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("verified_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webpush_subscriptions" ADD CONSTRAINT "webpush_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webpush_subscriptions" ADD CONSTRAINT "webpush_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_events" ADD CONSTRAINT "plugin_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_events" ADD CONSTRAINT "plugin_events_tenant_plugin_id_tenant_plugins_id_fk" FOREIGN KEY ("tenant_plugin_id") REFERENCES "public"."tenant_plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_plugin_secrets" ADD CONSTRAINT "tenant_plugin_secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_plugin_secrets" ADD CONSTRAINT "tenant_plugin_secrets_tenant_plugin_id_tenant_plugins_id_fk" FOREIGN KEY ("tenant_plugin_id") REFERENCES "public"."tenant_plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_plugins" ADD CONSTRAINT "tenant_plugins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_plugins" ADD CONSTRAINT "tenant_plugins_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_export_log" ADD CONSTRAINT "integration_export_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_bank_criteria" ADD CONSTRAINT "inspection_bank_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_bank_criteria" ADD CONSTRAINT "inspection_bank_criteria_bank_id_inspection_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."inspection_banks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_banks" ADD CONSTRAINT "inspection_banks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_banks" ADD CONSTRAINT "inspection_banks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_types" ADD CONSTRAINT "inspection_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_types" ADD CONSTRAINT "inspection_types_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria" ADD CONSTRAINT "inspection_type_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria" ADD CONSTRAINT "inspection_type_criteria_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria" ADD CONSTRAINT "inspection_type_criteria_group_id_inspection_type_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."inspection_type_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_groups" ADD CONSTRAINT "inspection_type_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_groups" ADD CONSTRAINT "inspection_type_groups_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_answered_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("answered_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_assigned_to_person_id_people_id_fk" FOREIGN KEY ("assigned_to_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_assigned_to_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assigned_to_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD CONSTRAINT "inspection_record_criteria_corrective_action_id_corrective_actions_id_fk" FOREIGN KEY ("corrective_action_id") REFERENCES "public"."corrective_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" ADD CONSTRAINT "inspection_assignment_compliance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" ADD CONSTRAINT "inspection_assignment_compliance_assignment_id_inspection_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."inspection_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" ADD CONSTRAINT "inspection_assignment_compliance_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" ADD CONSTRAINT "inspection_assignment_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" ADD CONSTRAINT "inspection_assignment_dispatches_assignment_id_inspection_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."inspection_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" ADD CONSTRAINT "training_skill_assignment_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" ADD CONSTRAINT "training_skill_assignment_files_skill_assignment_id_training_skill_assignments_id_fk" FOREIGN KEY ("skill_assignment_id") REFERENCES "public"."training_skill_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" ADD CONSTRAINT "training_skill_assignment_files_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" ADD CONSTRAINT "training_skill_assignment_files_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_skill_type_id_training_skill_types_id_fk" FOREIGN KEY ("skill_type_id") REFERENCES "public"."training_skill_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_granted_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("granted_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_evidence_attachment_id_attachments_id_fk" FOREIGN KEY ("evidence_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_authorities" ADD CONSTRAINT "training_skill_authorities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_certificates" ADD CONSTRAINT "training_skill_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_certificates" ADD CONSTRAINT "training_skill_certificates_skill_assignment_id_training_skill_assignments_id_fk" FOREIGN KEY ("skill_assignment_id") REFERENCES "public"."training_skill_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_types" ADD CONSTRAINT "training_skill_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_types" ADD CONSTRAINT "training_skill_types_authority_id_training_skill_authorities_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."training_skill_authorities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "training_course_files" ADD CONSTRAINT "training_course_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_course_files" ADD CONSTRAINT "training_course_files_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_course_files" ADD CONSTRAINT "training_course_files_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_extra_fields" ADD CONSTRAINT "training_extra_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_content_items" ADD CONSTRAINT "training_content_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_course_modules" ADD CONSTRAINT "training_course_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_course_modules" ADD CONSTRAINT "training_course_modules_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_assigned_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("assigned_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_record_id_training_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."training_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_enrollment_id_training_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."training_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_lesson_id_training_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."training_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_assessment_id_training_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."training_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_evaluated_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("evaluated_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lessons" ADD CONSTRAINT "training_lessons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lessons" ADD CONSTRAINT "training_lessons_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lessons" ADD CONSTRAINT "training_lessons_module_id_training_course_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."training_course_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lessons" ADD CONSTRAINT "training_lessons_assessment_type_id_training_assessment_types_id_fk" FOREIGN KEY ("assessment_type_id") REFERENCES "public"."training_assessment_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lessons" ADD CONSTRAINT "training_lessons_class_id_training_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."training_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_pdf_attachment_id_attachments_id_fk" FOREIGN KEY ("pdf_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_definition_id_report_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."report_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_notification_policy" ADD CONSTRAINT "tenant_notification_policy_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_notification_recipients" ADD CONSTRAINT "tenant_notification_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_notification_recipients" ADD CONSTRAINT "tenant_notification_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_notification_settings" ADD CONSTRAINT "tenant_notification_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD CONSTRAINT "form_assignment_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD CONSTRAINT "form_assignment_dispatches_assignment_id_form_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."form_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_runs" ADD CONSTRAINT "plugin_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_runs" ADD CONSTRAINT "plugin_runs_tenant_plugin_id_tenant_plugins_id_fk" FOREIGN KEY ("tenant_plugin_id") REFERENCES "public"."tenant_plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_book_items" ADD CONSTRAINT "document_book_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_book_items" ADD CONSTRAINT "document_book_items_book_id_document_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."document_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_book_items" ADD CONSTRAINT "document_book_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_type_id_document_reference_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."document_reference_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "kiosk_scans" ADD CONSTRAINT "kiosk_scans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_scans" ADD CONSTRAINT "kiosk_scans_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_scans" ADD CONSTRAINT "kiosk_scans_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_scans" ADD CONSTRAINT "kiosk_scans_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" ADD CONSTRAINT "hazid_assessment_type_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" ADD CONSTRAINT "hazid_assessment_type_apps_type_id_hazid_assessment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."hazid_assessment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" ADD CONSTRAINT "hazid_assessment_type_apps_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_assessment_id_hazid_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."hazid_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_type_app_id_hazid_assessment_type_apps_id_fk" FOREIGN KEY ("type_app_id") REFERENCES "public"."hazid_assessment_type_apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_locked_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("locked_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD CONSTRAINT "hazid_signed_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD CONSTRAINT "hazid_signed_reports_pdf_attachment_id_attachments_id_fk" FOREIGN KEY ("pdf_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD CONSTRAINT "hazid_signed_reports_built_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("built_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_assignment_dispatches" ADD CONSTRAINT "journal_assignment_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_assignment_dispatches" ADD CONSTRAINT "journal_assignment_dispatches_assignment_id_journal_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."journal_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_assignments" ADD CONSTRAINT "journal_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_assignments" ADD CONSTRAINT "journal_assignments_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_supervisor_person_id_people_id_fk" FOREIGN KEY ("supervisor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_photos" ADD CONSTRAINT "journal_entry_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_photos" ADD CONSTRAINT "journal_entry_photos_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_tags" ADD CONSTRAINT "journal_entry_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_tags" ADD CONSTRAINT "journal_entry_tags_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_tags" ADD CONSTRAINT "journal_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_tags" ADD CONSTRAINT "journal_tags_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_group_memberships" ADD CONSTRAINT "person_group_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_group_memberships" ADD CONSTRAINT "person_group_memberships_group_id_person_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."person_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_group_memberships" ADD CONSTRAINT "person_group_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_groups" ADD CONSTRAINT "person_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_title_assignments" ADD CONSTRAINT "person_title_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_title_assignments" ADD CONSTRAINT "person_title_assignments_title_id_person_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."person_titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_title_assignments" ADD CONSTRAINT "person_title_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_titles" ADD CONSTRAINT "person_titles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_files" ADD CONSTRAINT "person_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_files" ADD CONSTRAINT "person_files_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_files" ADD CONSTRAINT "person_files_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_files" ADD CONSTRAINT "person_files_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" ADD CONSTRAINT "job_title_task_acknowledgments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" ADD CONSTRAINT "job_title_task_acknowledgments_task_id_job_title_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."job_title_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" ADD CONSTRAINT "job_title_task_acknowledgments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_tasks" ADD CONSTRAINT "job_title_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_tasks" ADD CONSTRAINT "job_title_tasks_title_id_person_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."person_titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_records" ADD CONSTRAINT "safe_distance_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_records" ADD CONSTRAINT "safe_distance_records_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_records" ADD CONSTRAINT "safe_distance_records_supervisor_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("supervisor_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_records" ADD CONSTRAINT "safe_distance_records_operator_person_id_people_id_fk" FOREIGN KEY ("operator_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_segments" ADD CONSTRAINT "safe_distance_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_distance_segments" ADD CONSTRAINT "safe_distance_segments_record_id_safe_distance_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."safe_distance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_log" ADD CONSTRAINT "sms_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_nav_config" ADD CONSTRAINT "tenant_nav_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_dashboards" ADD CONSTRAINT "insight_dashboards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_dashboards" ADD CONSTRAINT "insight_dashboards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_dashboards" ADD CONSTRAINT "insight_dashboards_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_cards" ADD CONSTRAINT "insight_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_cards" ADD CONSTRAINT "insight_cards_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_cards" ADD CONSTRAINT "insight_cards_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_dashboard_pins" ADD CONSTRAINT "insight_dashboard_pins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_dashboard_pins" ADD CONSTRAINT "insight_dashboard_pins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_dashboard_pins" ADD CONSTRAINT "insight_dashboard_pins_dashboard_id_insight_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."insight_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_audience" ADD CONSTRAINT "compliance_audience_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_audience" ADD CONSTRAINT "compliance_audience_obligation_id_compliance_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."compliance_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD CONSTRAINT "compliance_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD CONSTRAINT "compliance_dispatches_obligation_id_compliance_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."compliance_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_status" ADD CONSTRAINT "compliance_status_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_status" ADD CONSTRAINT "compliance_status_obligation_id_compliance_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."compliance_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_status" ADD CONSTRAINT "compliance_status_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_rows" ADD CONSTRAINT "data_source_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_rows" ADD CONSTRAINT "data_source_rows_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_connections" ADD CONSTRAINT "sync_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_crosswalk" ADD CONSTRAINT "sync_crosswalk_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_crosswalk" ADD CONSTRAINT "sync_crosswalk_connection_id_sync_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sync_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_sync_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sync_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_templates" ADD CONSTRAINT "pdf_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_templates" ADD CONSTRAINT "pdf_templates_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "account_provider_idx" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_ux" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_users_tenant_user_ux" ON "tenant_users" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_users_tenant_idx" ON "tenant_users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_users_user_idx" ON "tenant_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_ux" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_ux" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "role_assignments_tenant_idx" ON "role_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "role_assignments" USING btree ("tenant_user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_role_idx" ON "role_assignments" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_key_ux" ON "roles" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "roles_tenant_idx" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permission_overrides_user_permission_ux" ON "user_permission_overrides" USING btree ("tenant_user_id","permission");--> statement-breakpoint
CREATE INDEX "user_permission_overrides_tenant_idx" ON "user_permission_overrides" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_permission_overrides_user_idx" ON "user_permission_overrides" USING btree ("tenant_user_id");--> statement-breakpoint
CREATE INDEX "crews_tenant_idx" ON "crews" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "departments_tenant_idx" ON "departments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_tenant_name_ux" ON "departments" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "org_units_tenant_idx" ON "org_units" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "org_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "org_units_tenant_level_idx" ON "org_units" USING btree ("tenant_id","level");--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_tenant_code_ux" ON "org_units" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "people_tenant_idx" ON "people" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_tenant_employee_no_ux" ON "people" USING btree ("tenant_id","employee_no");--> statement-breakpoint
CREATE INDEX "people_name_idx" ON "people" USING btree ("tenant_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX "people_assignments_tenant_idx" ON "people_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "people_assignments_person_idx" ON "people_assignments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "people_assignments_org_idx" ON "people_assignments" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "trades_tenant_idx" ON "trades" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_contacts_tenant_org_idx" ON "customer_contacts" USING btree ("tenant_id","org_unit_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("tenant_id","actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attachments_tenant_idx" ON "attachments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "attachments_kind_idx" ON "attachments" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "flow_gates_subject_idx" ON "flow_gates" USING btree ("tenant_id","subject_type","subject_id","status");--> statement-breakpoint
CREATE INDEX "flow_gates_assignee_idx" ON "flow_gates" USING btree ("tenant_id","assignee_tenant_user_id","status");--> statement-breakpoint
CREATE INDEX "flow_gates_flow_idx" ON "flow_gates" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "form_assignments_tenant_idx" ON "form_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_assignments_template_idx" ON "form_assignments" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "form_assignments_mode_idx" ON "form_assignments" USING btree ("tenant_id","mode");--> statement-breakpoint
CREATE INDEX "form_automations_template_idx" ON "form_automations" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "form_automations_subject_idx" ON "form_automations" USING btree ("tenant_id","subject_type","subject_key");--> statement-breakpoint
CREATE INDEX "form_automations_tenant_idx" ON "form_automations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_response_checkins_response_idx" ON "form_response_checkins" USING btree ("response_id","recorded_at");--> statement-breakpoint
CREATE INDEX "form_response_checkins_tenant_idx" ON "form_response_checkins" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_response_comments_response_idx" ON "form_response_comments" USING btree ("response_id","created_at");--> statement-breakpoint
CREATE INDEX "form_response_comments_tenant_idx" ON "form_response_comments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_response_scores_response_idx" ON "form_response_scores" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "form_response_scores_tenant_idx" ON "form_response_scores" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_response_steps_response_idx" ON "form_response_steps" USING btree ("response_id","sequence");--> statement-breakpoint
CREATE INDEX "form_response_steps_tenant_idx" ON "form_response_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_response_steps_status_idx" ON "form_response_steps" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "form_responses_tenant_idx" ON "form_responses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_responses_template_idx" ON "form_responses" USING btree ("tenant_id","template_id");--> statement-breakpoint
CREATE INDEX "form_responses_status_idx" ON "form_responses" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "form_responses_site_idx" ON "form_responses" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "form_responses_submitted_idx" ON "form_responses" USING btree ("tenant_id","submitted_at");--> statement-breakpoint
CREATE INDEX "form_responses_source_idx" ON "form_responses" USING btree ("tenant_id","source_entity_type","source_entity_id");--> statement-breakpoint
CREATE INDEX "form_responses_monitor_due_idx" ON "form_responses" USING btree ("monitor_status","next_checkin_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "form_template_versions_uniq" ON "form_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "form_template_versions_tenant_idx" ON "form_template_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_tenant_key_ux" ON "form_templates" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "form_templates_tenant_idx" ON "form_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_templates_category_idx" ON "form_templates" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "form_response_participants_tenant_idx" ON "form_response_participants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_response_participants_person_idx" ON "form_response_participants" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "form_response_participants_response_idx" ON "form_response_participants" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "form_response_participants_template_idx" ON "form_response_participants" USING btree ("tenant_id","template_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_shares_conversation_idx" ON "ai_conversation_shares" USING btree ("tenant_id","conversation_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_shares_user_idx" ON "ai_conversation_shares" USING btree ("tenant_id","target_user_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_shares_role_idx" ON "ai_conversation_shares" USING btree ("tenant_id","target_role_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_scope_idx" ON "ai_conversations" USING btree ("tenant_id","scope","scope_ref_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_tenant_idx" ON "ai_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_classifications_tenant_idx" ON "incident_classifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_classifications_parent_idx" ON "incident_classifications" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_classifications_tenant_parent_name_ux" ON "incident_classifications" USING btree ("tenant_id","parent_id","name");--> statement-breakpoint
CREATE INDEX "incident_hours_periods_tenant_idx" ON "incident_hours_periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_hours_periods_range_idx" ON "incident_hours_periods" USING btree ("tenant_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "incident_hours_periods_site_idx" ON "incident_hours_periods" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "incident_injury_types_tenant_idx" ON "incident_injury_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_injury_types_tenant_name_ux" ON "incident_injury_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "incident_attachments_incident_idx" ON "incident_attachments" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_contributing_factors_incident_idx" ON "incident_contributing_factors" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_contributing_factors_tenant_idx" ON "incident_contributing_factors" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_events_incident_idx" ON "incident_events" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_events_tenant_idx" ON "incident_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_events_occurred_idx" ON "incident_events" USING btree ("incident_id","occurred_at");--> statement-breakpoint
CREATE INDEX "incident_injuries_tenant_idx" ON "incident_injuries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_injuries_incident_idx" ON "incident_injuries" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_injuries_injury_type_idx" ON "incident_injuries" USING btree ("injury_type_id");--> statement-breakpoint
CREATE INDEX "incident_lost_time_incident_idx" ON "incident_lost_time_events" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_lost_time_tenant_idx" ON "incident_lost_time_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_people_incident_idx" ON "incident_people" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_people_tenant_idx" ON "incident_people" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_preventative_steps_incident_idx" ON "incident_preventative_steps" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_preventative_steps_tenant_idx" ON "incident_preventative_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_preventative_steps_status_idx" ON "incident_preventative_steps" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "incident_root_cause_whys_incident_idx" ON "incident_root_cause_whys" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_root_cause_whys_tenant_idx" ON "incident_root_cause_whys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_root_cause_whys_incident_ordinal_idx" ON "incident_root_cause_whys" USING btree ("incident_id","ordinal");--> statement-breakpoint
CREATE INDEX "incidents_tenant_idx" ON "incidents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incidents_reference_idx" ON "incidents" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "incidents_occurred_idx" ON "incidents" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "incidents_site_idx" ON "incidents" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "training_certificates_record_idx" ON "training_certificates" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "training_certificates_token_idx" ON "training_certificates" USING btree ("verify_token");--> statement-breakpoint
CREATE INDEX "training_class_attendees_class_idx" ON "training_class_attendees" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "training_class_attendees_person_idx" ON "training_class_attendees" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "training_classes_tenant_idx" ON "training_classes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_classes_course_idx" ON "training_classes" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "training_classes_starts_idx" ON "training_classes" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "training_courses_tenant_idx" ON "training_courses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_courses_tenant_code_idx" ON "training_courses" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "training_records_tenant_idx" ON "training_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_records_person_course_idx" ON "training_records" USING btree ("tenant_id","person_id","course_id");--> statement-breakpoint
CREATE INDEX "training_records_expires_idx" ON "training_records" USING btree ("tenant_id","expires_on");--> statement-breakpoint
CREATE INDEX "equipment_categories_tenant_idx" ON "equipment_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_categories_tenant_slug_ux" ON "equipment_categories" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_items_tenant_tag_ux" ON "equipment_items" USING btree ("tenant_id","asset_tag");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_items_qr_ux" ON "equipment_items" USING btree ("qr_token");--> statement-breakpoint
CREATE INDEX "equipment_items_tenant_idx" ON "equipment_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_items_site_idx" ON "equipment_items" USING btree ("tenant_id","current_site_org_unit_id");--> statement-breakpoint
CREATE INDEX "equipment_items_available_idx" ON "equipment_items" USING btree ("tenant_id","is_available_for_checkout");--> statement-breakpoint
CREATE INDEX "equipment_location_history_item_idx" ON "equipment_location_history" USING btree ("item_id","recorded_at");--> statement-breakpoint
CREATE INDEX "equipment_location_history_tenant_idx" ON "equipment_location_history" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_types_tenant_idx" ON "equipment_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_types_cat_idx" ON "equipment_types" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "equipment_work_orders_item_idx" ON "equipment_work_orders" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "equipment_work_orders_status_idx" ON "equipment_work_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "equipment_work_orders_tenant_idx" ON "equipment_work_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_work_orders_priority_idx" ON "equipment_work_orders" USING btree ("tenant_id","priority");--> statement-breakpoint
CREATE INDEX "truck_log_tenant_idx" ON "truck_log_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_log_truck_date_ux" ON "truck_log_entries" USING btree ("tenant_id","equipment_item_id","entry_date");--> statement-breakpoint
CREATE INDEX "truck_log_date_idx" ON "truck_log_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "truck_log_truck_idx" ON "truck_log_entries" USING btree ("equipment_item_id","entry_date");--> statement-breakpoint
CREATE INDEX "truck_log_site_idx" ON "truck_log_entries" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_tenant_idx" ON "equipment_log_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_item_idx" ON "equipment_log_entries" USING btree ("equipment_item_id","entry_date");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_kind_idx" ON "equipment_log_entries" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "equipment_inspection_criteria_type_seq_idx" ON "equipment_inspection_criteria" USING btree ("inspection_type_id","sequence");--> statement-breakpoint
CREATE INDEX "equipment_inspection_criteria_group_idx" ON "equipment_inspection_criteria" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_criteria_tenant_idx" ON "equipment_inspection_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_groups_tenant_idx" ON "equipment_inspection_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_groups_type_seq_idx" ON "equipment_inspection_groups" USING btree ("inspection_type_id","sequence");--> statement-breakpoint
CREATE INDEX "equipment_inspection_types_tenant_idx" ON "equipment_inspection_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_types_applies_idx" ON "equipment_inspection_types" USING btree ("tenant_id","applies_to_type_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_attachments_record_idx" ON "equipment_inspection_record_attachments" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_attachments_tenant_idx" ON "equipment_inspection_record_attachments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_criteria_tenant_idx" ON "equipment_inspection_record_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_criteria_record_idx" ON "equipment_inspection_record_criteria" USING btree ("record_id","sequence");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_criteria_answer_idx" ON "equipment_inspection_record_criteria" USING btree ("tenant_id","answer");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_inspection_record_criteria_record_criterion_ux" ON "equipment_inspection_record_criteria" USING btree ("record_id","criterion_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_tenant_idx" ON "equipment_inspection_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_inspection_records_tenant_reference_ux" ON "equipment_inspection_records" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_type_idx" ON "equipment_inspection_records" USING btree ("tenant_id","inspection_type_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_item_idx" ON "equipment_inspection_records" USING btree ("tenant_id","equipment_item_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_status_idx" ON "equipment_inspection_records" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_occurred_idx" ON "equipment_inspection_records" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_next_due_idx" ON "equipment_inspection_records" USING btree ("tenant_id","next_due_on");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_tenant_idx" ON "equipment_checkouts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_item_idx" ON "equipment_checkouts" USING btree ("equipment_item_id","checked_out_at");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_open_idx" ON "equipment_checkouts" USING btree ("tenant_id","returned_at");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_holder_idx" ON "equipment_checkouts" USING btree ("tenant_id","holder_person_id");--> statement-breakpoint
CREATE INDEX "ppe_inspections_item_idx" ON "ppe_inspections" USING btree ("item_id","inspected_on");--> statement-breakpoint
CREATE INDEX "ppe_inspections_tenant_idx" ON "ppe_inspections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_issue_reports_item_idx" ON "ppe_issue_reports" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ppe_issue_reports_tenant_idx" ON "ppe_issue_reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_issues_item_idx" ON "ppe_issues" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ppe_issues_person_idx" ON "ppe_issues" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "ppe_issues_tenant_idx" ON "ppe_issues" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_items_tenant_idx" ON "ppe_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_items_type_idx" ON "ppe_items" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "ppe_items_holder_idx" ON "ppe_items" USING btree ("tenant_id","current_holder_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_items_tenant_serial_ux" ON "ppe_items" USING btree ("tenant_id","serial_number");--> statement-breakpoint
CREATE INDEX "ppe_types_tenant_idx" ON "ppe_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_type_criteria_groups_tenant_idx" ON "ppe_type_criteria_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_type_criteria_groups_type_idx" ON "ppe_type_criteria_groups" USING btree ("ppe_type_id","inspection_kind","sequence");--> statement-breakpoint
CREATE INDEX "ppe_type_inspection_criteria_tenant_idx" ON "ppe_type_inspection_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_type_inspection_criteria_type_idx" ON "ppe_type_inspection_criteria" USING btree ("ppe_type_id","inspection_kind","entity_order");--> statement-breakpoint
CREATE INDEX "ppe_type_inspection_criteria_group_idx" ON "ppe_type_inspection_criteria" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "ppe_criteria_bank_criteria_bank_seq_idx" ON "ppe_criteria_bank_criteria" USING btree ("bank_id","sequence");--> statement-breakpoint
CREATE INDEX "ppe_criteria_bank_criteria_tenant_idx" ON "ppe_criteria_bank_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_criteria_banks_tenant_idx" ON "ppe_criteria_banks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_criteria_banks_tenant_category_idx" ON "ppe_criteria_banks" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "ppe_annual_records_tenant_idx" ON "ppe_annual_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_annual_records_item_idx" ON "ppe_annual_records" USING btree ("item_id","inspected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_annual_records_item_year_ux" ON "ppe_annual_records" USING btree ("item_id","year");--> statement-breakpoint
CREATE INDEX "document_ack_sessions_doc_idx" ON "document_acknowledgment_sessions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_ack_sessions_tenant_idx" ON "document_acknowledgment_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_acks_doc_person_idx" ON "document_acknowledgments" USING btree ("document_id","person_id");--> statement-breakpoint
CREATE INDEX "document_acks_session_idx" ON "document_acknowledgments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "document_acks_tenant_idx" ON "document_acknowledgments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_books_tenant_idx" ON "document_books" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_books_status_idx" ON "document_books" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "document_comments_doc_idx" ON "document_comments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_comments_thread_idx" ON "document_comments" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "document_comments_tenant_idx" ON "document_comments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_drafts_document_ux" ON "document_drafts" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_drafts_tenant_idx" ON "document_drafts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_reviews_doc_idx" ON "document_reviews" USING btree ("document_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "document_reviews_tenant_idx" ON "document_reviews" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "document_versions_tenant_idx" ON "document_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_key_idx" ON "documents" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "documents_review_idx" ON "documents" USING btree ("tenant_id","next_review_on");--> statement-breakpoint
CREATE INDEX "ca_complete_steps_ca_idx" ON "ca_complete_steps" USING btree ("ca_id","entity_order");--> statement-breakpoint
CREATE INDEX "ca_complete_steps_tenant_idx" ON "ca_complete_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ca_photos_ca_idx" ON "ca_photos" USING btree ("ca_id");--> statement-breakpoint
CREATE INDEX "ca_photos_tenant_idx" ON "ca_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "corrective_actions_tenant_idx" ON "corrective_actions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "corrective_actions_status_idx" ON "corrective_actions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "corrective_actions_due_idx" ON "corrective_actions" USING btree ("tenant_id","due_on");--> statement-breakpoint
CREATE INDEX "corrective_actions_source_idx" ON "corrective_actions" USING btree ("tenant_id","source_entity_type","source_entity_id");--> statement-breakpoint
CREATE INDEX "corrective_actions_owner_idx" ON "corrective_actions" USING btree ("tenant_id","owner_tenant_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_uniq" ON "notification_preferences" USING btree ("tenant_id","user_id","category","channel");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("tenant_id","user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE INDEX "webpush_subscriptions_user_idx" ON "webpush_subscriptions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webpush_subscriptions_endpoint_ux" ON "webpush_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "plugin_events_tenant_idx" ON "plugin_events" USING btree ("tenant_id","event");--> statement-breakpoint
CREATE INDEX "plugin_events_pending_idx" ON "plugin_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plugins_key_ux" ON "plugins" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_plugin_secrets_uniq" ON "tenant_plugin_secrets" USING btree ("tenant_plugin_id","key_name");--> statement-breakpoint
CREATE INDEX "tenant_plugin_secrets_tenant_idx" ON "tenant_plugin_secrets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_plugins_uniq" ON "tenant_plugins" USING btree ("tenant_id","plugin_id");--> statement-breakpoint
CREATE INDEX "tenant_plugins_tenant_idx" ON "tenant_plugins" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "integration_export_log_subject_idx" ON "integration_export_log" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "integration_export_log_key_idx" ON "integration_export_log" USING btree ("tenant_id","integration_key");--> statement-breakpoint
CREATE INDEX "tenant_integrations_tenant_idx" ON "tenant_integrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_integrations_tenant_key_ux" ON "tenant_integrations" USING btree ("tenant_id","integration_key");--> statement-breakpoint
CREATE INDEX "tenant_integrations_trigger_idx" ON "tenant_integrations" USING btree ("tenant_id","trigger_key");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "inspection_bank_criteria_bank_seq_idx" ON "inspection_bank_criteria" USING btree ("bank_id","sequence");--> statement-breakpoint
CREATE INDEX "inspection_bank_criteria_tenant_idx" ON "inspection_bank_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_banks_tenant_idx" ON "inspection_banks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_banks_tenant_category_idx" ON "inspection_banks" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "inspection_types_tenant_idx" ON "inspection_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_types_tenant_name_ux" ON "inspection_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "inspection_type_criteria_tenant_idx" ON "inspection_type_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_type_criteria_type_group_seq_idx" ON "inspection_type_criteria" USING btree ("type_id","group_id","sequence");--> statement-breakpoint
CREATE INDEX "inspection_type_groups_tenant_idx" ON "inspection_type_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_type_groups_type_seq_idx" ON "inspection_type_groups" USING btree ("type_id","sequence");--> statement-breakpoint
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
CREATE INDEX "training_skill_assignment_files_tenant_idx" ON "training_skill_assignment_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignment_files_assignment_idx" ON "training_skill_assignment_files" USING btree ("skill_assignment_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignment_files_kind_idx" ON "training_skill_assignment_files" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "training_skill_assignments_tenant_idx" ON "training_skill_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignments_person_idx" ON "training_skill_assignments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignments_skill_type_idx" ON "training_skill_assignments" USING btree ("skill_type_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignments_expires_idx" ON "training_skill_assignments" USING btree ("tenant_id","expires_on");--> statement-breakpoint
CREATE INDEX "training_skill_authorities_tenant_idx" ON "training_skill_authorities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_skill_authorities_tenant_code_idx" ON "training_skill_authorities" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "training_skill_certificates_assignment_idx" ON "training_skill_certificates" USING btree ("skill_assignment_id");--> statement-breakpoint
CREATE INDEX "training_skill_certificates_token_idx" ON "training_skill_certificates" USING btree ("verify_token");--> statement-breakpoint
CREATE INDEX "training_skill_types_tenant_idx" ON "training_skill_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_skill_types_authority_idx" ON "training_skill_types" USING btree ("authority_id");--> statement-breakpoint
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
CREATE INDEX "training_course_files_tenant_idx" ON "training_course_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_course_files_course_idx" ON "training_course_files" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "training_extra_fields_tenant_idx" ON "training_extra_fields" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_extra_fields_owner_idx" ON "training_extra_fields" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "training_content_items_tenant_idx" ON "training_content_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_content_items_kind_idx" ON "training_content_items" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "training_course_modules_tenant_idx" ON "training_course_modules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_course_modules_course_idx" ON "training_course_modules" USING btree ("course_id","sort_order");--> statement-breakpoint
CREATE INDEX "training_enrollments_tenant_idx" ON "training_enrollments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_enrollments_person_idx" ON "training_enrollments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "training_enrollments_course_idx" ON "training_enrollments" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_enrollments_person_course_ux" ON "training_enrollments" USING btree ("course_id","person_id");--> statement-breakpoint
CREATE INDEX "training_lesson_progress_tenant_idx" ON "training_lesson_progress" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_lesson_progress_enrollment_idx" ON "training_lesson_progress" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "training_lesson_progress_person_idx" ON "training_lesson_progress" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_lesson_progress_lesson_ux" ON "training_lesson_progress" USING btree ("enrollment_id","lesson_id");--> statement-breakpoint
CREATE INDEX "training_lessons_tenant_idx" ON "training_lessons" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_lessons_course_idx" ON "training_lessons" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "training_lessons_module_idx" ON "training_lessons" USING btree ("module_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_slug_ux" ON "report_definitions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "report_definitions_tenant_kind_idx" ON "report_definitions" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "report_runs_tenant_idx" ON "report_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_runs_schedule_idx" ON "report_runs" USING btree ("schedule_id","started_at");--> statement-breakpoint
CREATE INDEX "report_runs_status_idx" ON "report_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_schedules_tenant_idx" ON "report_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_schedules_active_idx" ON "report_schedules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "report_schedules_definition_idx" ON "report_schedules" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_notification_policy_uniq" ON "tenant_notification_policy" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_notification_recipients_tenant_idx" ON "tenant_notification_recipients" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_notification_recipients_uniq" ON "tenant_notification_recipients" USING btree ("tenant_id","category","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_notification_settings_uniq" ON "tenant_notification_settings" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "form_assignment_dispatches_tenant_idx" ON "form_assignment_dispatches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_assignment_dispatches_assignment_idx" ON "form_assignment_dispatches" USING btree ("assignment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "plugin_runs_tenant_idx" ON "plugin_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "plugin_runs_plugin_idx" ON "plugin_runs" USING btree ("tenant_plugin_id","started_at");--> statement-breakpoint
CREATE INDEX "plugin_runs_cadence_idx" ON "plugin_runs" USING btree ("cadence","started_at");--> statement-breakpoint
CREATE INDEX "document_book_items_book_idx" ON "document_book_items" USING btree ("book_id","position");--> statement-breakpoint
CREATE INDEX "document_book_items_tenant_idx" ON "document_book_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_book_items_book_doc_ux" ON "document_book_items" USING btree ("book_id","document_id");--> statement-breakpoint
CREATE INDEX "document_references_tenant_idx" ON "document_references" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_references_category_idx" ON "document_references" USING btree ("tenant_id","category");--> statement-breakpoint
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
CREATE INDEX "kiosk_scans_tenant_idx" ON "kiosk_scans" USING btree ("tenant_id","scanned_at");--> statement-breakpoint
CREATE INDEX "kiosk_scans_person_idx" ON "kiosk_scans" USING btree ("tenant_id","person_id","scanned_at");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_apps_type_idx" ON "hazid_assessment_type_apps" USING btree ("type_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_apps_template_idx" ON "hazid_assessment_type_apps" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_apps_tenant_idx" ON "hazid_assessment_type_apps" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_assessment_type_apps_type_key_ux" ON "hazid_assessment_type_apps" USING btree ("type_id","key");--> statement-breakpoint
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
CREATE INDEX "hazid_assessment_app_responses_assessment_idx" ON "hazid_assessment_app_responses" USING btree ("assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_app_responses_response_idx" ON "hazid_assessment_app_responses" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_app_responses_tenant_idx" ON "hazid_assessment_app_responses" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_assessment_app_responses_assessment_type_app_ux" ON "hazid_assessment_app_responses" USING btree ("assessment_id","type_app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_assessment_app_responses_response_ux" ON "hazid_assessment_app_responses" USING btree ("response_id");--> statement-breakpoint
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
CREATE INDEX "journal_assignment_dispatches_tenant_idx" ON "journal_assignment_dispatches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "journal_assignment_dispatches_assignment_idx" ON "journal_assignment_dispatches" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "journal_assignment_dispatches_occurred_idx" ON "journal_assignment_dispatches" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "journal_assignments_tenant_idx" ON "journal_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "journal_assignments_active_idx" ON "journal_assignments" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_idx" ON "journal_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_ref_ux" ON "journal_entries" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_person_date_idx" ON "journal_entries" USING btree ("tenant_id","person_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_site_idx" ON "journal_entries" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "journal_entries_status_idx" ON "journal_entries" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "journal_entries_search_idx" ON "journal_entries" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "journal_entry_photos_tenant_idx" ON "journal_entry_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "journal_entry_photos_entry_idx" ON "journal_entry_photos" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_entry_tags_tenant_tag_idx" ON "journal_entry_tags" USING btree ("tenant_id","tag");--> statement-breakpoint
CREATE INDEX "journal_entry_tags_entry_idx" ON "journal_entry_tags" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_tags_entry_tag_ux" ON "journal_entry_tags" USING btree ("entry_id","tag");--> statement-breakpoint
CREATE INDEX "journal_tags_tenant_idx" ON "journal_tags" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_tags_tenant_name_ux" ON "journal_tags" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "person_group_memberships_tenant_idx" ON "person_group_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "person_group_memberships_group_idx" ON "person_group_memberships" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "person_group_memberships_person_idx" ON "person_group_memberships" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_group_memberships_unique_ux" ON "person_group_memberships" USING btree ("group_id","person_id");--> statement-breakpoint
CREATE INDEX "person_groups_tenant_idx" ON "person_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_groups_tenant_name_ux" ON "person_groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "person_title_assignments_tenant_idx" ON "person_title_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "person_title_assignments_title_idx" ON "person_title_assignments" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "person_title_assignments_person_idx" ON "person_title_assignments" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_title_assignments_unique_ux" ON "person_title_assignments" USING btree ("title_id","person_id");--> statement-breakpoint
CREATE INDEX "person_titles_tenant_idx" ON "person_titles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_titles_tenant_name_ux" ON "person_titles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "person_files_tenant_idx" ON "person_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "person_files_person_idx" ON "person_files" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_files_kind_idx" ON "person_files" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "job_title_task_acks_tenant_idx" ON "job_title_task_acknowledgments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "job_title_task_acks_task_idx" ON "job_title_task_acknowledgments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "job_title_task_acks_person_idx" ON "job_title_task_acknowledgments" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_title_task_acks_unique_ux" ON "job_title_task_acknowledgments" USING btree ("task_id","person_id");--> statement-breakpoint
CREATE INDEX "job_title_tasks_tenant_idx" ON "job_title_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "job_title_tasks_title_idx" ON "job_title_tasks" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "job_title_tasks_order_idx" ON "job_title_tasks" USING btree ("title_id","entity_order");--> statement-breakpoint
CREATE INDEX "safe_distance_records_tenant_idx" ON "safe_distance_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "safe_distance_records_tenant_ref_ux" ON "safe_distance_records" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "safe_distance_records_method_idx" ON "safe_distance_records" USING btree ("tenant_id","method");--> statement-breakpoint
CREATE INDEX "safe_distance_records_site_idx" ON "safe_distance_records" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "safe_distance_records_occurred_idx" ON "safe_distance_records" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "safe_distance_segments_record_idx" ON "safe_distance_segments" USING btree ("record_id","sort_order");--> statement-breakpoint
CREATE INDEX "safe_distance_segments_tenant_idx" ON "safe_distance_segments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_dashboard_layouts_user_ux" ON "user_dashboard_layouts" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "user_dashboard_layouts_tenant_idx" ON "user_dashboard_layouts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_log_tenant_idx" ON "email_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "email_log_status_idx" ON "email_log" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "email_log_category_idx" ON "email_log" USING btree ("tenant_id","category_key","created_at");--> statement-breakpoint
CREATE INDEX "email_log_recipient_idx" ON "email_log" USING btree ("recipient_primary","created_at");--> statement-breakpoint
CREATE INDEX "email_log_job_idx" ON "email_log" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "sms_log_tenant_idx" ON "sms_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_log_status_idx" ON "sms_log" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sms_log_category_idx" ON "sms_log" USING btree ("tenant_id","category_key","created_at");--> statement-breakpoint
CREATE INDEX "sms_log_recipient_idx" ON "sms_log" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "sms_log_job_idx" ON "sms_log" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_nav_config_tenant_ux" ON "tenant_nav_config" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_nav_config_tenant_idx" ON "tenant_nav_config" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "insight_dashboards_tenant_user_idx" ON "insight_dashboards" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "insight_dashboards_tenant_status_idx" ON "insight_dashboards" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "insight_cards_tenant_idx" ON "insight_cards" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "insight_cards_tenant_status_idx" ON "insight_cards" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "insight_cards_tenant_creator_idx" ON "insight_cards" USING btree ("tenant_id","created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "insight_dashboard_pins_user_dashboard_ux" ON "insight_dashboard_pins" USING btree ("user_id","dashboard_id");--> statement-breakpoint
CREATE INDEX "insight_dashboard_pins_tenant_user_idx" ON "insight_dashboard_pins" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "compliance_audience_tenant_idx" ON "compliance_audience" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "compliance_audience_obligation_idx" ON "compliance_audience" USING btree ("obligation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_audience_unique_ux" ON "compliance_audience" USING btree ("obligation_id","kind","entity_key");--> statement-breakpoint
CREATE INDEX "compliance_dispatches_tenant_idx" ON "compliance_dispatches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "compliance_dispatches_obligation_idx" ON "compliance_dispatches" USING btree ("obligation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "compliance_obligations_tenant_idx" ON "compliance_obligations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "compliance_obligations_module_idx" ON "compliance_obligations" USING btree ("tenant_id","source_module");--> statement-breakpoint
CREATE INDEX "compliance_obligations_scan_idx" ON "compliance_obligations" USING btree ("recurrence_kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_obligations_legacy_ux" ON "compliance_obligations" USING btree ("legacy_table","legacy_id");--> statement-breakpoint
CREATE INDEX "compliance_status_tenant_idx" ON "compliance_status" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "compliance_status_obligation_idx" ON "compliance_status" USING btree ("obligation_id");--> statement-breakpoint
CREATE INDEX "compliance_status_person_idx" ON "compliance_status" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "compliance_status_status_idx" ON "compliance_status" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_status_unique_ux" ON "compliance_status" USING btree ("obligation_id","subject_key");--> statement-breakpoint
CREATE INDEX "data_source_rows_source_idx" ON "data_source_rows" USING btree ("data_source_id","position");--> statement-breakpoint
CREATE INDEX "data_source_rows_tenant_idx" ON "data_source_rows" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "data_sources_tenant_idx" ON "data_sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_tenant_key_ux" ON "data_sources" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "sync_connections_tenant_idx" ON "sync_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sync_connections_connector_idx" ON "sync_connections" USING btree ("tenant_id","connector_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_crosswalk_uniq" ON "sync_crosswalk" USING btree ("tenant_id","connection_id","entity","external_id");--> statement-breakpoint
CREATE INDEX "sync_crosswalk_canonical_idx" ON "sync_crosswalk" USING btree ("tenant_id","entity","canonical_id");--> statement-breakpoint
CREATE INDEX "sync_runs_tenant_idx" ON "sync_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_idx" ON "sync_runs" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE INDEX "email_templates_tenant_idx" ON "email_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_tenant_key_ux" ON "email_templates" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "email_templates_category_idx" ON "email_templates" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "pdf_templates_tenant_idx" ON "pdf_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_templates_tenant_key_ux" ON "pdf_templates" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "pdf_templates_subject_idx" ON "pdf_templates" USING btree ("tenant_id","record_subject_type","record_subject_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_templates_module_default_ux" ON "pdf_templates" USING btree ("tenant_id","record_subject_key") WHERE "pdf_templates"."is_module_default" and "pdf_templates"."record_subject_type" = 'module' and "pdf_templates"."deleted_at" is null;