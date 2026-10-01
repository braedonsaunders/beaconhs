-- Attachment deletion validates every inbound tenant FK. Without these indexes,
-- signature invalidation repeatedly scans whole history tables.
CREATE INDEX IF NOT EXISTS "ca_photos_attachment_id_ref_idx" ON "ca_photos" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ca_complete_steps_signature_attachment_id_ref_idx" ON "ca_complete_steps" ("tenant_id", "signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_source_attachment_id_ref_idx" ON "documents" ("tenant_id", "source_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_content_attachment_id_ref_idx" ON "document_versions" ("tenant_id", "content_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_docx_attachment_id_ref_idx" ON "document_versions" ("tenant_id", "docx_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_pdf_attachment_id_ref_idx" ON "document_versions" ("tenant_id", "pdf_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_body_pdf_attachment_id_ref_idx" ON "document_versions" ("tenant_id", "body_pdf_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_book_pdf_attachment_id_ref_idx" ON "document_versions" ("tenant_id", "book_pdf_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_acknowledgments_signature_attachment_id_ref_idx" ON "document_acknowledgments" ("tenant_id", "signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_inspection_record_attachments_attachment_id_ref_idx" ON "equipment_inspection_record_attachments" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_log_entries_attachment_id_ref_idx" ON "equipment_log_entries" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_items_manual_attachment_id_ref_idx" ON "equipment_items" ("tenant_id", "manual_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_items_photo_attachment_id_ref_idx" ON "equipment_items" ("tenant_id", "photo_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_responses_pdf_attachment_id_ref_idx" ON "form_responses" ("tenant_id", "pdf_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_response_steps_signature_attachment_id_ref_idx" ON "form_response_steps" ("tenant_id", "signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flow_gates_signature_attachment_id_ref_idx" ON "flow_gates" ("tenant_id", "signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hazid_assessment_signatures_signature_attachment_id_ref_idx" ON "hazid_assessment_signatures" ("tenant_id", "signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hazid_assessment_photos_attachment_id_ref_idx" ON "hazid_assessment_photos" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hazid_hazards_photo_attachment_id_ref_idx" ON "hazid_hazards" ("tenant_id", "photo_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_attachments_attachment_id_ref_idx" ON "incident_attachments" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_records_customer_signature_attachment_id_ref_idx" ON "inspection_records" ("tenant_id", "customer_signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_title_task_acknowledgments_signature_attachment_id_ref_idx" ON "job_title_task_acknowledgments" ("tenant_id", "signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_entry_photos_attachment_id_ref_idx" ON "journal_entry_photos" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_photo_attachment_id_ref_idx" ON "people" ("tenant_id", "photo_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_signature_attachment_id_ref_idx" ON "people" ("tenant_id", "signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_files_attachment_id_ref_idx" ON "person_files" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppe_annual_records_certificate_attachment_id_ref_idx" ON "ppe_annual_records" ("tenant_id", "certificate_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppe_issues_receipt_signature_attachment_id_ref_idx" ON "ppe_issues" ("tenant_id", "receipt_signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_runs_pdf_attachment_id_ref_idx" ON "report_runs" ("tenant_id", "pdf_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_course_files_attachment_id_ref_idx" ON "training_course_files" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_lessons_attachment_id_ref_idx" ON "training_lessons" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_lessons_source_attachment_id_ref_idx" ON "training_lessons" ("tenant_id", "source_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_lesson_progress_evaluation_signature_attachme_19064006" ON "training_lesson_progress" ("tenant_id", "evaluation_signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_content_items_source_attachment_id_ref_idx" ON "training_content_items" ("tenant_id", "source_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_content_items_attachment_id_ref_idx" ON "training_content_items" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_assignments_evidence_attachment_id_ref_idx" ON "training_skill_assignments" ("tenant_id", "evidence_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_assignment_files_attachment_id_ref_idx" ON "training_skill_assignment_files" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_class_attendees_signature_attachment_id_ref_idx" ON "training_class_attendees" ("tenant_id", "signature_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_certificate_attachment_id_ref_idx" ON "training_records" ("tenant_id", "certificate_attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_record_files_attachment_id_ref_idx" ON "training_record_files" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppe_inspection_attachments_attachment_id_ref_idx" ON "ppe_inspection_attachments" ("tenant_id", "attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_record_attachments_attachment_id_ref_idx" ON "inspection_record_attachments" ("tenant_id", "attachment_id");
