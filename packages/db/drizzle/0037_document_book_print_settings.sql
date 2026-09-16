-- Per-book print settings: paper size, orientation, and which parts of the
-- generated PDF to include (cover, contents, controlled-document headers,
-- footer).
--
-- Nullable on purpose. Null means "use the house defaults" rather than "off",
-- so books that already exist gain the richer output without anyone editing
-- them one at a time.
ALTER TABLE "document_books" ADD COLUMN IF NOT EXISTS "print_settings" jsonb;
