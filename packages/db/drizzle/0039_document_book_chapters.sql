-- Chapters: the level above sections. A long manual needs both — a chapter
-- opens a major part of the book, sections group documents within it.
ALTER TYPE "public"."document_book_item_kind" ADD VALUE IF NOT EXISTS 'chapter';
