// One-off: build demo LMS content on an EXISTING course so every content type
// can be exercised in the builder, presenter, and learner player:
//   rich text (TipTap HTML incl. inline image/table) · slideshow (all five
//   layouts + notes + backgrounds) · video (YouTube) · file (real PDF) ·
//   embed · quiz (assessment type + questions) · in-person session (class) ·
//   practical test (criteria + evaluator sign-off)
//
// Run:  cd apps/worker && npx tsx --env-file=../../.env src/scripts/seed-demo-course.ts

import { randomUUID } from 'node:crypto'
import { count, eq, isNull, and } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import {
  attachments,
  tenants,
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingClasses,
  trainingCourseModules,
  trainingCourses,
  trainingLessons,
  type Slide,
} from '@beaconhs/db/schema'
import { ensureBucket, newAttachmentKey, publicUrl, putObject } from '@beaconhs/storage'

// --- tiny asset builders -----------------------------------------------------

function svgSlide(title: string, subtitle: string, from: string, to: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <circle cx="1100" cy="120" r="220" fill="#ffffff" opacity="0.08"/>
  <circle cx="160" cy="620" r="160" fill="#ffffff" opacity="0.08"/>
  <text x="80" y="360" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff">${title}</text>
  <text x="80" y="420" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#ffffff" opacity="0.85">${subtitle}</text>
</svg>`,
  )
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildPdf(title: string, lines: string[]): Buffer {
  const objs: string[] = []
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>'
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>'
  objs[3] =
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>'
  const parts = [`BT /F1 20 Tf 72 710 Td (${pdfEscape(title)}) Tj ET`]
  lines.forEach((l, i) => parts.push(`BT /F1 12 Tf 72 ${672 - i * 20} Td (${pdfEscape(l)}) Tj ET`))
  const stream = parts.join('\n')
  objs[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(out)
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out)
  out += 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out)
}

const rd = (html: string) => ({ html })

async function main() {
  // 1. Pick an existing course that has no curriculum yet.
  const pick = await withSuperAdmin(db, async (tx) => {
    const rows = await tx
      .select({
        id: trainingCourses.id,
        name: trainingCourses.name,
        code: trainingCourses.code,
        tenantId: trainingCourses.tenantId,
        tenantName: tenants.name,
        moduleCount: count(trainingCourseModules.id),
      })
      .from(trainingCourses)
      .innerJoin(tenants, eq(tenants.id, trainingCourses.tenantId))
      .leftJoin(
        trainingCourseModules,
        and(
          eq(trainingCourseModules.courseId, trainingCourses.id),
          isNull(trainingCourseModules.deletedAt),
        ),
      )
      .where(isNull(trainingCourses.deletedAt))
      .groupBy(trainingCourses.id, tenants.name)
      .orderBy(trainingCourses.name)
    // Prefer empty courses so the demo content can be added without disturbing
    // existing course material.
    const ranked = [...rows].sort((a, b) => {
      return Number(a.moduleCount) - Number(b.moduleCount)
    })
    return ranked.find((r) => Number(r.moduleCount) === 0) ?? ranked[0] ?? null
  })
  if (!pick) throw new Error('No courses found in the database')
  const tenantId = pick.tenantId
  console.log(`→ Course: "${pick.name}" (${pick.code}) · tenant ${pick.tenantName} · ${pick.id}`)

  // 2. Assets → MinIO + attachments rows.
  await ensureBucket()
  async function makeAttachment(args: {
    kind: 'image' | 'document'
    filename: string
    contentType: string
    body: Buffer
  }): Promise<{ id: string; url: string }> {
    const key = newAttachmentKey({ tenantId, kind: args.kind, filename: args.filename })
    await putObject({ key, body: args.body, contentType: args.contentType })
    const id = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(attachments)
        .values({
          tenantId,
          kind: args.kind,
          r2Key: key,
          contentType: args.contentType,
          sizeBytes: args.body.length,
          filename: args.filename,
        })
        .returning()
      if (!row) throw new Error('attachment insert failed')
      return row.id
    })
    return { id, url: publicUrl(key) }
  }

  const hero = await makeAttachment({
    kind: 'image',
    filename: 'demo-hero.svg',
    contentType: 'image/svg+xml',
    body: svgSlide('Work at Height', 'Demo visual asset', '#0f766e', '#134e4a'),
  })
  const siteImg = await makeAttachment({
    kind: 'image',
    filename: 'demo-site.svg',
    contentType: 'image/svg+xml',
    body: svgSlide('Anchor Points', 'Inspect before every use', '#1d4ed8', '#0f172a'),
  })
  const pdf = await makeAttachment({
    kind: 'document',
    filename: 'demo-quick-reference.pdf',
    contentType: 'application/pdf',
    body: buildPdf('BeaconHS — Demo Quick Reference', [
      'This handout was generated by the LMS demo seeder.',
      '1. Inspect your harness before every use.',
      '2. Maintain 100% tie-off above 1.8 m (6 ft).',
      '3. Report damaged equipment immediately.',
      '4. Anchor points must be rated for 22 kN (5,000 lb).',
    ]),
  })
  console.log('→ Assets uploaded (2 images, 1 PDF)')

  // 3. Everything else inside the course's tenant.
  await withTenant(db, tenantId, async (tx) => {
    // Quiz: assessment type + questions
    const [aType] = await tx
      .insert(trainingAssessmentTypes)
      .values({
        tenantId,
        name: `Demo Knowledge Check — ${pick.code}`,
        description: 'Seeded demo quiz exercising the LMS quiz element.',
        passingScore: 80,
        courseId: pick.id,
        graded: true,
        active: true,
      })
      .returning()
    if (!aType) throw new Error('assessment type insert failed')
    await tx.insert(trainingAssessmentTypeQuestions).values([
      {
        tenantId,
        typeId: aType.id,
        prompt: 'Above what height is 100% tie-off required?',
        kind: 'single_choice',
        options: [
          { value: 'a', label: '1.2 m (4 ft)' },
          { value: 'b', label: '1.8 m (6 ft)' },
          { value: 'c', label: '3.0 m (10 ft)' },
        ],
        correctAnswer: 'b',
        points: 1,
        entityOrder: 0,
      },
      {
        tenantId,
        typeId: aType.id,
        prompt: 'A harness with frayed webbing may be used if the damage is taped over.',
        kind: 'true_false',
        correctAnswer: 'false',
        points: 1,
        entityOrder: 1,
      },
      {
        tenantId,
        typeId: aType.id,
        prompt: 'Name one thing you must check on an anchor point before use.',
        kind: 'text',
        correctAnswer: null,
        points: 1,
        entityOrder: 2,
      },
    ])

    // In-person session class (tomorrow 09:00–11:00)
    const start = new Date()
    start.setDate(start.getDate() + 1)
    start.setHours(9, 0, 0, 0)
    const end = new Date(start.getTime() + 2 * 3600_000)
    const [klass] = await tx
      .insert(trainingClasses)
      .values({
        tenantId,
        courseId: pick.id,
        title: `Demo Hands-on Session — ${pick.code}`,
        startsAt: start,
        endsAt: end,
        notes: 'Seeded demo class for the in-person session element.',
      })
      .returning()
    if (!klass) throw new Error('class insert failed')

    // Modules
    const mods = await tx
      .insert(trainingCourseModules)
      .values([
        { tenantId, courseId: pick.id, title: 'Module 1 — Orientation', sortOrder: 0 },
        { tenantId, courseId: pick.id, title: 'Module 2 — Core Content', sortOrder: 1 },
        { tenantId, courseId: pick.id, title: 'Module 3 — Assessment & Sign-off', sortOrder: 2 },
      ])
      .returning()
    const [m1, m2, m3] = mods
    if (!m1 || !m2 || !m3) throw new Error('module insert failed')

    const richHtml = `
<h1>Welcome to the demo course</h1>
<p>This lesson exercises the <strong>rich text</strong> element — authored with the inline TipTap editor, rendered identically for learners.</p>
<h2>What good looks like</h2>
<ul><li>Plan the task <em>before</em> you start</li><li>Inspect all equipment</li><li><u>Stop work</u> if conditions change</li></ul>
<blockquote><p>“If it can't be done safely, it doesn't get done.”</p></blockquote>
<h3>Fall factors</h3>
<table><tbody>
<tr><th><p>Factor</p></th><th><p>Meaning</p></th></tr>
<tr><td><p>0</p></td><td><p>Anchor above head, no slack</p></td></tr>
<tr><td><p>1</p></td><td><p>Anchor at shoulder height</p></td></tr>
<tr><td><p>2</p></td><td><p>Anchor at feet — avoid</p></td></tr>
</tbody></table>
<p><img src="${hero.url}" alt="Hero graphic"></p>
<p>Images, tables, lists, quotes — all editable directly on the page.</p>`

    const slides: Slide[] = [
      {
        id: randomUUID(),
        layout: 'title',
        title: 'Working at Height',
        subtitle: 'Demo slideshow — every layout, with speaker notes',
        bg: 'teal',
        notes: 'Welcome everyone. This deck was seeded to exercise the slide player.',
      },
      {
        id: randomUUID(),
        layout: 'title-content',
        title: 'Today we cover',
        body: rd(
          '<ul><li>Hazard identification</li><li>Harness inspection</li><li>Anchor selection</li><li>Rescue planning</li></ul>',
        ),
        bg: 'white',
        notes: 'Run through the agenda quickly — detail comes later.',
      },
      {
        id: randomUUID(),
        layout: 'two-col',
        title: 'Do / Don’t',
        left: rd(
          '<h3>Do</h3><ul><li>Tie off at 1.8 m+</li><li>Inspect daily</li><li>Use rated anchors</li></ul>',
        ),
        right: rd(
          '<h3>Don’t</h3><ul><li>Use damaged gear</li><li>Anchor at your feet</li><li>Work alone at height</li></ul>',
        ),
        bg: 'slate',
      },
      {
        id: randomUUID(),
        layout: 'image-text',
        title: 'Anchor points',
        imageAttachmentId: siteImg.id,
        body: rd(
          '<p>Anchors must be rated for <strong>22 kN</strong> per person attached.</p><p>When in doubt, ask your supervisor.</p>',
        ),
        bg: 'white',
      },
      {
        id: randomUUID(),
        layout: 'image-full',
        title: 'Inspect before every use',
        subtitle: 'Webbing · stitching · hardware · labels',
        imageAttachmentId: hero.id,
        notes: 'Close with the inspection habit — this is the takeaway.',
      },
    ]

    const lessons: (typeof trainingLessons.$inferInsert)[] = [
      // Module 1 — Orientation
      {
        tenantId,
        courseId: pick.id,
        moduleId: m1.id,
        sortOrder: 0,
        title: 'Welcome & objectives',
        kind: 'rich',
        completionRule: 'view',
        contentHtml: richHtml,
        durationMinutes: 5,
      },
      {
        tenantId,
        courseId: pick.id,
        moduleId: m1.id,
        sortOrder: 1,
        title: 'Intro video',
        kind: 'video',
        completionRule: 'view',
        embedUrl: 'https://www.youtube.com/watch?v=ysz5S6PUM-U',
        durationMinutes: 3,
      },
      {
        tenantId,
        courseId: pick.id,
        moduleId: m1.id,
        sortOrder: 2,
        title: 'Quick-reference handout (PDF)',
        kind: 'file',
        completionRule: 'acknowledge',
        attachmentId: pdf.id,
      },
      // Module 2 — Core Content
      {
        tenantId,
        courseId: pick.id,
        moduleId: m2.id,
        sortOrder: 0,
        title: 'Working at Height — slides',
        kind: 'slides',
        completionRule: 'view',
        slides,
        durationMinutes: 10,
      },
      {
        tenantId,
        courseId: pick.id,
        moduleId: m2.id,
        sortOrder: 1,
        title: 'Regulation reference (embedded page)',
        kind: 'embed',
        completionRule: 'view',
        embedUrl: 'https://example.com',
      },
      // Module 3 — Assessment & Sign-off
      {
        tenantId,
        courseId: pick.id,
        moduleId: m3.id,
        sortOrder: 0,
        title: 'Knowledge check',
        kind: 'quiz',
        completionRule: 'pass',
        assessmentTypeId: aType.id,
      },
      {
        tenantId,
        courseId: pick.id,
        moduleId: m3.id,
        sortOrder: 1,
        title: 'Hands-on session',
        kind: 'session',
        completionRule: 'view',
        classId: klass.id,
      },
      {
        tenantId,
        courseId: pick.id,
        moduleId: m3.id,
        sortOrder: 2,
        title: 'Practical: don a harness',
        kind: 'practical',
        completionRule: 'evaluator',
        contentHtml:
          '<h2>Practical test</h2><p>Demonstrate donning and adjusting a full-body harness, then attach to the demo anchor.</p><ul><li>5 minutes max</li><li>Evaluator observes silently</li></ul>',
        practicalCriteria: [
          { id: randomUUID(), text: 'Inspects harness before donning' },
          { id: randomUUID(), text: 'All straps adjusted — two-finger rule' },
          { id: randomUUID(), text: 'Connects to anchor with locking carabiner' },
        ],
      },
    ]
    await tx.insert(trainingLessons).values(lessons)
    console.log(
      `→ Seeded 3 modules, ${lessons.length} lessons, quiz (3 questions), class, practical`,
    )
  })

  console.log('')
  console.log(`✔ Done. Open: http://localhost:3000/training/courses/${pick.id}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
