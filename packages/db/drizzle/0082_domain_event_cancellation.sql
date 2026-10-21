-- Explicit cancellation retains the original payload and delivery evidence.
-- The worker claims only pending or expired publishing leases, so cancelled
-- events can never be replayed by a scheduler scan.
ALTER TYPE "public"."domain_event_outbox_status" ADD VALUE IF NOT EXISTS 'cancelled';
