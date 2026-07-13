-- Explicit pre-launch migration cutover marker.
--
-- Fresh databases execute the generated 0000 baseline first. The validated
-- dev database already has the equivalent physical schema and a historical
-- ledger newer than 0000, so Drizzle skips the baseline and records this
-- marker before any post-cutover migrations. No future migration is ever
-- pre-registered.
SELECT 1;
