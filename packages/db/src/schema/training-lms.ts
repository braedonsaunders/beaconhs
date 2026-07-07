// Native LMS — course curriculum, lessons, enrollments, and per-lesson progress.
//
// This is the world-class course-authoring + learner-runtime layer that sits ON
// TOP of the existing native training spine (training_courses / training_classes
// / training_assessment_types / training_records / training_certificates). It is
// DELIBERATELY native: no Forms/Builder, no Documents-editor coupling. Rich lesson
// content is stored as a bespoke block array (LessonBlock[]); quizzes reuse the
// existing native training assessment engine; in-person lessons point at a class.
//
//   training_courses (existing spine)
//     └─ training_course_modules (ordered sections)            ← new
//          └─ training_lessons (ordered content items)         ← new
//   training_enrollments (person × course runtime state)       ← new
//     └─ training_lesson_progress (person × lesson)            ← new
//
// On completion an enrollment writes a training_records row (and issues a
// certificate), so the matrix / transcripts / compliance engine light up with
// zero extra wiring.

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { people } from './org'
import { trainingClasses, trainingCourses, trainingRecords } from './training'
import { trainingAssessmentTypes, trainingAssessments } from './training-assessments'

// --- Bespoke lesson content model -----------------------------------------
//
// A rich lesson is a vertical stack of blocks authored in the native training
// studio. Intentionally our OWN shape (NOT ProseMirror / the Documents editor).
export type LessonBlock =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'text'; md: string } // bespoke markdown-lite (escaped-first on render)
  | { id: string; type: 'image'; attachmentId: string; alt?: string; caption?: string }
  | { id: string; type: 'video'; attachmentId?: string; url?: string; caption?: string }
  | { id: string; type: 'file'; attachmentId: string; label?: string }
  | { id: string; type: 'embed'; url: string; caption?: string }
  | { id: string; type: 'callout'; tone: 'info' | 'warning' | 'success' | 'danger'; md: string }
  | { id: string; type: 'divider' }

// Rich text authored in the training TipTap editor: ProseMirror JSON (source
// of truth for editing) + sanitized HTML (render in player / slide regions).
export type RichDoc = { html: string; json?: unknown }

// One slide in a slideshow lesson / library deck.
//
// `canvas` slides are the current model: a freeform PowerPoint-style stage of
// SlideElement[] authored in the Fabric editor (@beaconhs/design-studio engine)
// on a virtual 960×540 (16:9) coordinate space, scaled to the rendered size.
// The structured layouts (title / two-col / …) and their RichDoc/LessonBlock
// regions are the legacy model — still rendered everywhere, converted to
// canvas the first time a deck is edited. `pptx` slides are pixel-perfect page
// images produced by the PowerPoint import pipeline (soffice → pdf → png);
// new imports arrive as canvas slides with a locked full-bleed image.
export type SlideRegion = RichDoc | LessonBlock[]

export const SLIDE_STAGE = { width: 960, height: 540 } as const

// A styled run of text within one line of a text element. Properties override
// the element-level defaults for that span only.
export type SlideTextRun = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
}

type SlideElementBase = {
  id: string
  x: number
  y: number
  w: number
  h: number
  rotation?: number // degrees, around the top-left corner (Fabric left/top origin)
  opacity?: number // 0..1
  locked?: boolean // not selectable in the editor (pptx page renders)
}

export type SlideTextElement = SlideElementBase & {
  kind: 'text'
  text: string // plain text, \n-separated lines (always kept in sync with runs)
  runs?: SlideTextRun[][] // optional per-line styled runs; omit when uniformly styled
  fontSize: number // stage units (px at 960-wide)
  fontFamily?: 'sans' | 'serif' | 'mono'
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  list?: 'bullet' | 'number' // lines carry literal "• " / "1. " prefixes
}

export type SlideImageElement = SlideElementBase & {
  kind: 'image'
  attachmentId?: string // tenant attachment (URL resolved at render)
  url?: string // direct https URL (e.g. images pasted into legacy regions)
  fit?: 'stretch' | 'cover' | 'contain' // player object-fit; editor shows the box
  radius?: number // corner radius, stage units
}

export type SlideShapeElement = SlideElementBase & {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'line'
  fill?: string
  stroke?: string
  strokeWidth?: number // stage units
  radius?: number // rect corner radius, stage units
}

export type SlideElement = SlideTextElement | SlideImageElement | SlideShapeElement

export type Slide = {
  id: string
  layout: 'canvas' | 'title' | 'title-content' | 'two-col' | 'image-text' | 'image-full' | 'pptx'
  // canvas slides
  elements?: SlideElement[]
  bgColor?: string // hex stage background
  // legacy structured slides
  title?: string
  subtitle?: string
  body?: SlideRegion // title-content + image-text text region
  left?: SlideRegion // two-col
  right?: SlideRegion // two-col
  imageAttachmentId?: string // image-text / image-full / pptx page render
  bg?: 'white' | 'slate' | 'teal' | 'dark' // background preset
  notes?: string // speaker / learner notes
}

export function isRichRegion(r: SlideRegion | null | undefined): r is RichDoc {
  return !!r && !Array.isArray(r) && typeof (r as RichDoc).html === 'string'
}

// --- Canvas slide sanitisation (server-side, before persisting) -------------

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const clampN = (v: unknown, min: number, max: number, fb: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fb
const hexOr = (v: unknown, fb: string | undefined) =>
  typeof v === 'string' && HEX_COLOR.test(v) ? v : fb
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

function sanitizeRuns(runs: unknown): SlideTextRun[][] | undefined {
  if (!Array.isArray(runs)) return undefined
  const lines = runs.slice(0, 400).map((line) =>
    (Array.isArray(line) ? line : []).slice(0, 80).map(
      (r): SlideTextRun => ({
        text: str((r as SlideTextRun)?.text, 2000),
        ...((r as SlideTextRun)?.bold ? { bold: true } : {}),
        ...((r as SlideTextRun)?.italic ? { italic: true } : {}),
        ...((r as SlideTextRun)?.underline ? { underline: true } : {}),
        ...(hexOr((r as SlideTextRun)?.color, undefined)
          ? { color: hexOr((r as SlideTextRun)?.color, undefined) }
          : {}),
      }),
    ),
  )
  return lines
}

function sanitizeElement(input: unknown): SlideElement | null {
  const el = input as Partial<SlideElement> | null
  if (!el || typeof el !== 'object' || typeof el.id !== 'string') return null
  const base = {
    id: el.id.slice(0, 64),
    x: clampN(el.x, -SLIDE_STAGE.width, SLIDE_STAGE.width * 2, 0),
    y: clampN(el.y, -SLIDE_STAGE.height, SLIDE_STAGE.height * 2, 0),
    w: clampN(el.w, 1, SLIDE_STAGE.width * 3, 100),
    h: clampN(el.h, 0, SLIDE_STAGE.height * 3, 40),
    ...(el.rotation ? { rotation: clampN(el.rotation, -360, 360, 0) } : {}),
    ...(el.opacity != null && el.opacity !== 1 ? { opacity: clampN(el.opacity, 0, 1, 1) } : {}),
    ...(el.locked === true ? { locked: true } : {}),
  }
  if (el.kind === 'text') {
    const t = el as Partial<SlideTextElement>
    return {
      ...base,
      kind: 'text',
      text: str(t.text, 20_000),
      ...(t.runs ? { runs: sanitizeRuns(t.runs) } : {}),
      fontSize: clampN(t.fontSize, 4, 400, 20),
      ...(t.fontFamily && ['sans', 'serif', 'mono'].includes(t.fontFamily)
        ? { fontFamily: t.fontFamily }
        : {}),
      ...(t.bold ? { bold: true } : {}),
      ...(t.italic ? { italic: true } : {}),
      ...(t.underline ? { underline: true } : {}),
      ...(hexOr(t.color, undefined) ? { color: hexOr(t.color, undefined) } : {}),
      ...(t.align && ['left', 'center', 'right'].includes(t.align) ? { align: t.align } : {}),
      ...(t.lineHeight ? { lineHeight: clampN(t.lineHeight, 0.6, 3, 1.2) } : {}),
      ...(t.list && ['bullet', 'number'].includes(t.list) ? { list: t.list } : {}),
    }
  }
  if (el.kind === 'image') {
    const i = el as Partial<SlideImageElement>
    const url = typeof i.url === 'string' && /^https?:\/\//.test(i.url) ? i.url.slice(0, 2000) : ''
    return {
      ...base,
      kind: 'image',
      ...(typeof i.attachmentId === 'string' && i.attachmentId
        ? { attachmentId: i.attachmentId.slice(0, 64) }
        : {}),
      ...(url ? { url } : {}),
      ...(i.fit && ['stretch', 'cover', 'contain'].includes(i.fit) ? { fit: i.fit } : {}),
      ...(i.radius ? { radius: clampN(i.radius, 0, 200, 0) } : {}),
    }
  }
  if (el.kind === 'shape') {
    const s = el as Partial<SlideShapeElement>
    return {
      ...base,
      kind: 'shape',
      shape: s.shape && ['rect', 'ellipse', 'line'].includes(s.shape) ? s.shape : 'rect',
      ...(hexOr(s.fill, undefined) ? { fill: hexOr(s.fill, undefined) } : {}),
      ...(hexOr(s.stroke, undefined) ? { stroke: hexOr(s.stroke, undefined) } : {}),
      ...(s.strokeWidth != null ? { strokeWidth: clampN(s.strokeWidth, 0, 60, 1) } : {}),
      ...(s.radius ? { radius: clampN(s.radius, 0, 200, 0) } : {}),
    }
  }
  return null
}

/** Normalize a canvas slide's elements/background before persisting (caps,
 * numeric clamps, hex-only colors, https-only image URLs). Non-canvas slides
 * pass through untouched — their RichDoc regions are sanitized separately. */
export function sanitizeCanvasSlide(slide: Slide): Slide {
  if (slide.layout !== 'canvas') return slide
  const elements = (Array.isArray(slide.elements) ? slide.elements : [])
    .slice(0, 120)
    .map(sanitizeElement)
    .filter((e): e is SlideElement => !!e)
  return {
    id: String(slide.id).slice(0, 64),
    layout: 'canvas',
    elements,
    ...(hexOr(slide.bgColor, undefined) ? { bgColor: hexOr(slide.bgColor, undefined) } : {}),
    ...(slide.notes ? { notes: str(slide.notes, 8000) } : {}),
  }
}

/**
 * Attachment ids of the locked full-bleed page renders the slides-import
 * worker produces — one per slide, created solely by the renderer and never
 * referenced elsewhere. Used to garbage-collect superseded renders (worker)
 * and to purge a deck's files when its lesson / library item is deleted (web).
 */
export function renderedPageAttachmentIds(slides: Slide[]): string[] {
  const ids: string[] = []
  for (const slide of slides) {
    if (slide.layout !== 'canvas') continue
    for (const el of slide.elements ?? []) {
      if (
        el.kind === 'image' &&
        el.locked === true &&
        el.attachmentId &&
        el.x === 0 &&
        el.y === 0 &&
        el.w === 960 &&
        el.h === 540
      ) {
        ids.push(el.attachmentId)
      }
    }
  }
  return ids
}

// Per-criteria checklist on a practical (hands-on) lesson, signed off by an
// evaluator with training manage permission.
export type PracticalCriterion = { id: string; text: string }

// Ordered sections within a course.
export const trainingCourseModules = pgTable(
  'training_course_modules',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_course_modules_tenant_idx').on(t.tenantId),
    courseIdx: index('training_course_modules_course_idx').on(t.courseId, t.sortOrder),
  }),
)

export const trainingLessonKind = pgEnum('training_lesson_kind', [
  'rich', // bespoke content blocks
  'video', // attachment or external url
  'file', // downloadable attachment
  'embed', // iframe url
  'quiz', // → training_assessment_types (existing engine)
  'session', // → training_classes (in-person / blended)
  'slides', // structured slideshow (Slide[]) — native or PPTX-imported
  'practical', // hands-on/physical test signed off by an evaluator
])

export const trainingLessonCompletionRule = pgEnum('training_lesson_completion_rule', [
  'view', // complete on view / next
  'pass', // must pass the linked assessment
  'acknowledge', // explicit "I have read & understood"
  'min_time', // must spend minTimeSeconds on the lesson
  'evaluator', // an evaluator must sign the learner off (practical lessons)
])

// Ordered content items within a module.
export const trainingLessons = pgTable(
  'training_lessons',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => trainingCourseModules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: trainingLessonKind('kind').default('rich').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    // kind = 'rich' (content) | 'practical' (instructions) — legacy block format
    contentBlocks: jsonb('content_blocks').$type<LessonBlock[]>().default([]).notNull(),
    // TipTap-authored content (supersedes contentBlocks when present):
    // ProseMirror JSON is the editing source of truth; HTML is sanitized
    // server-side at save and rendered in the player.
    contentJson: jsonb('content_json').$type<Record<string, unknown> | null>(),
    contentHtml: text('content_html'),
    // kind = 'slides'
    slides: jsonb('slides').$type<Slide[]>().default([]).notNull(),
    // kind = 'practical'
    practicalCriteria: jsonb('practical_criteria')
      .$type<PracticalCriterion[]>()
      .default([])
      .notNull(),
    // PPTX import lifecycle (worker writes these)
    importStatus: text('import_status'), // 'pending' | 'processing' | 'complete' | 'failed'
    importError: text('import_error'),
    // PPTX master copy: when set, the referenced attachment (the uploaded
    // .pptx) is the deck's source of truth — slides[] is a derived render that
    // the worker replaces after every import/edit, and the deck is edited in
    // the PowerPoint editor (Collabora) instead of the canvas editor.
    sourceAttachmentId: uuid('source_attachment_id'),
    // kind = 'quiz' → existing native assessment engine
    assessmentTypeId: uuid('assessment_type_id').references(() => trainingAssessmentTypes.id, {
      onDelete: 'set null',
    }),
    // kind = 'session' → in-person class
    classId: uuid('class_id').references(() => trainingClasses.id, { onDelete: 'set null' }),
    // kind = 'video' | 'file'
    attachmentId: uuid('attachment_id'),
    // kind = 'embed' | external 'video'
    embedUrl: text('embed_url'),
    // Reuse a library content item instead of inline content (rich/video/file/embed).
    contentItemId: uuid('content_item_id'),
    durationMinutes: integer('duration_minutes'),
    isRequired: boolean('is_required').default(true).notNull(),
    completionRule: trainingLessonCompletionRule('completion_rule').default('view').notNull(),
    minTimeSeconds: integer('min_time_seconds'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_lessons_tenant_idx').on(t.tenantId),
    courseIdx: index('training_lessons_course_idx').on(t.courseId),
    moduleIdx: index('training_lessons_module_idx').on(t.moduleId, t.sortOrder),
  }),
)

export const trainingEnrollmentStatus = pgEnum('training_enrollment_status', [
  'not_started',
  'in_progress',
  'completed',
  'expired',
  'withdrawn',
])

export const trainingEnrollmentSource = pgEnum('training_enrollment_source', [
  'self',
  'assigned',
  'compliance',
])

// One row per (person × course): the in-progress runtime state. Immutable
// completion facts live in training_records; this row resets on renewal.
export const trainingEnrollments = pgTable(
  'training_enrollments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    status: trainingEnrollmentStatus('status').default('not_started').notNull(),
    source: trainingEnrollmentSource('source').default('self').notNull(),
    assignedByTenantUserId: uuid('assigned_by_tenant_user_id').references(() => tenantUsers.id),
    progressPercent: integer('progress_percent').default(0).notNull(),
    currentLessonId: uuid('current_lesson_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    dueOn: date('due_on'),
    expiresOn: date('expires_on'),
    // The training_record written when this enrollment completed (provenance).
    recordId: uuid('record_id').references(() => trainingRecords.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_enrollments_tenant_idx').on(t.tenantId),
    personIdx: index('training_enrollments_person_idx').on(t.tenantId, t.personId),
    courseIdx: index('training_enrollments_course_idx').on(t.tenantId, t.courseId),
    personCourseUx: uniqueIndex('training_enrollments_person_course_ux').on(t.courseId, t.personId),
  }),
)

export const trainingProgressStatus = pgEnum('training_progress_status', [
  'not_started',
  'in_progress',
  'completed',
])

// One row per (enrollment × lesson). This is the xAPI-shaped event log the
// deferred SCORM/xAPI wave will read from.
export const trainingLessonProgress = pgTable(
  'training_lesson_progress',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => trainingEnrollments.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => trainingLessons.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    status: trainingProgressStatus('status').default('not_started').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    timeSpentSeconds: integer('time_spent_seconds').default(0).notNull(),
    score: integer('score'), // quiz lessons: 0..100
    attempts: integer('attempts').default(0).notNull(),
    // Resume payload: video seconds / scroll offset / (future) SCORM suspend_data.
    lastPosition: jsonb('last_position').$type<Record<string, unknown> | null>(),
    // quiz lessons: link to the concrete attempt in the existing engine.
    assessmentId: uuid('assessment_id').references(() => trainingAssessments.id, {
      onDelete: 'set null',
    }),
    // practical lessons: evaluator sign-off
    evaluatedByTenantUserId: uuid('evaluated_by_tenant_user_id').references(() => tenantUsers.id),
    evaluationNotes: text('evaluation_notes'),
    evaluationSignatureDataUrl: text('evaluation_signature_data_url'),
    criteriaResults: jsonb('criteria_results').$type<Record<string, boolean> | null>(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_lesson_progress_tenant_idx').on(t.tenantId),
    enrollmentIdx: index('training_lesson_progress_enrollment_idx').on(t.enrollmentId),
    personIdx: index('training_lesson_progress_person_idx').on(t.tenantId, t.personId),
    lessonUx: uniqueIndex('training_lesson_progress_lesson_ux').on(t.enrollmentId, t.lessonId),
  }),
)

// --- Relations -------------------------------------------------------------

export const trainingCourseModulesRelations = relations(trainingCourseModules, ({ one, many }) => ({
  course: one(trainingCourses, {
    fields: [trainingCourseModules.courseId],
    references: [trainingCourses.id],
  }),
  lessons: many(trainingLessons),
}))

export const trainingLessonsRelations = relations(trainingLessons, ({ one }) => ({
  module: one(trainingCourseModules, {
    fields: [trainingLessons.moduleId],
    references: [trainingCourseModules.id],
  }),
  course: one(trainingCourses, {
    fields: [trainingLessons.courseId],
    references: [trainingCourses.id],
  }),
  assessmentType: one(trainingAssessmentTypes, {
    fields: [trainingLessons.assessmentTypeId],
    references: [trainingAssessmentTypes.id],
  }),
}))

export const trainingEnrollmentsRelations = relations(trainingEnrollments, ({ one, many }) => ({
  course: one(trainingCourses, {
    fields: [trainingEnrollments.courseId],
    references: [trainingCourses.id],
  }),
  person: one(people, { fields: [trainingEnrollments.personId], references: [people.id] }),
  progress: many(trainingLessonProgress),
}))

export const trainingLessonProgressRelations = relations(trainingLessonProgress, ({ one }) => ({
  enrollment: one(trainingEnrollments, {
    fields: [trainingLessonProgress.enrollmentId],
    references: [trainingEnrollments.id],
  }),
  lesson: one(trainingLessons, {
    fields: [trainingLessonProgress.lessonId],
    references: [trainingLessons.id],
  }),
}))

// --- Reusable content library ----------------------------------------------
//
// "Material outside the course" — reusable content items referenced by lessons
// via training_lessons.content_item_id. Native to training; same bespoke block
// model as inline lesson content. Quizzes (assessment types) and sessions
// (classes) are already their own reusable entities, so they're not duplicated
// here — the library covers rich / video / file / embed material.
export const trainingContentItemKind = pgEnum('training_content_item_kind', [
  'rich',
  'video',
  'file',
  'embed',
  'slides',
])

export const trainingContentItems = pgTable(
  'training_content_items',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    kind: trainingContentItemKind('kind').default('rich').notNull(),
    contentBlocks: jsonb('content_blocks').$type<LessonBlock[]>().default([]).notNull(),
    contentJson: jsonb('content_json').$type<Record<string, unknown> | null>(),
    contentHtml: text('content_html'),
    slides: jsonb('slides').$type<Slide[]>().default([]).notNull(),
    importStatus: text('import_status'),
    importError: text('import_error'),
    // PPTX master copy (see trainingLessons.sourceAttachmentId).
    sourceAttachmentId: uuid('source_attachment_id'),
    attachmentId: uuid('attachment_id'),
    embedUrl: text('embed_url'),
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    durationMinutes: integer('duration_minutes'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_content_items_tenant_idx').on(t.tenantId),
    kindIdx: index('training_content_items_kind_idx').on(t.tenantId, t.kind),
  }),
)
