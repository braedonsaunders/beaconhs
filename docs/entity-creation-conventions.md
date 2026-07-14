# Entity-creation conventions & audit

Status: proposal (2026-06). Drives the rollout that started with the Safe Distance tool
(instant-create → land in an inline editor; no separate create form, no separate edit page).

## The standard (how creation SHOULD work)

Four tiers. Pick by what the thing _is_, not by module.

### Tier 1 — Standalone authored records → **draft-first**

Records a person sits down and fills out (incidents, CAs, hazard assessments, inspection records,
journals, safe-distance, training courses/classes, equipment & PPE items, documents…).

- **New** = a server action that _instantly_ inserts the record (sensible defaults, auto reference)
  and `redirect()`s to `/[id]`.
- `/[id]` is the **single inline/tabbed view+edit surface**. No separate `/[id]/edit` page —
  if one exists it becomes a `redirect()` to `/[id]`.
- No `/new` form page.
- The fresh record is a **draft** until "committed" (validated for required fields). Two flavors:
  - **Hidden draft** (compliance/audit-sensitive: incidents, CAs, hazard assessments,
    lone-worker): excluded from lists, dashboards, compliance counts & notifications until
    committed; a worker sweeps drafts untouched > 48h; a small "Drafts (N)" affordance lets the
    user resume/discard.
  - **Badged draft** (operational: equipment, PPE, safe-distance, training): shows in the list
    immediately with a "Draft/Incomplete" badge; no hiding/sweep needed.

### Tier 2 — Sub-entities & ledger rows → **inline-add or drawer on the parent**

Line items and append-only facts (criteria, questions, attendees, lessons, segments, photos,
investigation events, hazards, check-ins, expenses, signatures, complete-steps…).

- Created/edited **in place** on the parent's detail page (inline row or URL-driven `?drawer=`).
- Immutable ledgers stay read-only after create. Never a `/new` page, never a separate edit page.
- **This is already the dominant pattern in the app and is correct — keep it.**

### Tier 3 — Small lookup / admin reference → **quick-create modal or inline-on-list**

Short reference records (departments, groups, tags, classifications, injury types, equipment
types/categories, document books, report schedules…).

- A lightweight modal (or inline row on the list) capturing the few fields; edit on the
  detail page or in the same row. **No full `/new` page.**

### Special — Genuinely complex multi-step setup → **full page / wizard (justified)**

Where creation is inherently multi-part (compliance obligations: kind→target→audience→recurrence;
tenant provisioning; the Forms designer launchpad). Keep the full page, but the resulting record
should still be edited on an inline detail/builder surface (not a second standalone edit page).

### Decision rule

```
Is it append-only / a child of another record?            → Tier 2 (inline/drawer, keep)
Is it a short reference/lookup row?                        → Tier 3 (quick-create modal)
Is creation inherently multi-step setup?                   → Special (full page / wizard)
Otherwise (a record you author and revisit)                → Tier 1 (draft-first)
```

---

## Master inventory

Legend — Current/Target: `page-form` (separate /new) · `instant-create` (draft-first) ·
`inline-add` · `drawer` · `modal` · `designer` · `read-only` · `redirect` (/edit→/[id]).
✅ = already matches target.

### Tier 1 — standalone records

| Entity                      | Current create         | Current edit                        | Has draft?                  | Target                  | Action                                                 |
| --------------------------- | ---------------------- | ----------------------------------- | --------------------------- | ----------------------- | ------------------------------------------------------ |
| Journal entry               | instant-create         | inline-on-detail                    | ✅ status=draft             | draft-first (hidden)    | ✅ exemplar — none                                     |
| Document                    | instant-create         | inline-on-detail + editor           | ✅ status=draft             | draft-first (hidden)    | ✅ exemplar — none                                     |
| Safe distance               | instant-create         | inline editor                       | no                          | draft-first (badged)    | ✅ done — optional badge                               |
| Inspection record           | page-form              | inline-on-detail (criteria/sign)    | ✅ status=draft             | draft-first (hidden)    | drop `/new` → instant-create draft                     |
| Training assessment attempt | page-form              | immersive player                    | ✅ status                   | draft-first             | drop `/new` → instant-create attempt                   |
| Incident                    | page-form              | **separate /[id]/edit**             | partial (status,inProgress) | draft-first (hidden)    | merge edit→detail; /edit→redirect; New→draft           |
| Corrective action           | page-form              | **separate /[id]/edit**             | no (needs flag)             | draft-first (hidden)    | add draft state; merge edit→detail; New→draft          |
| Hazard assessment           | page-form (TypePicker) | redirect ✅ (inline detail)         | yes (inProgress)            | draft-first (hidden)    | New→quick-pick type then instant-create draft          |
| Lone-worker session         | page-form              | detail (no /edit)                   | yes (status)                | quick-create _or_ draft | capture safety params (end/interval/grace) then detail |
| Equipment item              | page-form              | inline-on-detail                    | no (needs flag)             | draft-first (badged)    | add draft flag; New→instant-create; keep detail editor |
| PPE item                    | page-form              | issue-ledger on detail              | no (needs flag)             | draft-first (badged)    | add draft flag; New→instant-create                     |
| Training course             | page-form              | detail / studio                     | no                          | draft-first (badged)    | drop `/new` → instant-create; edit on detail/studio    |
| Training class              | page-form              | detail                              | no                          | draft-first (badged)    | drop `/new` → instant-create                           |
| Training assessment type    | page-form              | inline-on-detail (questions inline) | no                          | draft-first (badged)    | drop `/new` → instant-create                           |
| Training authority          | page-form              | detail (skill types)                | no                          | instant-create          | drop `/new` → instant-create                           |

### Tier 1 (builder-backed) — land in a designer, not a form

| Entity                     | Current                                              | Target                    | Action                                                      |
| -------------------------- | ---------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| Inspection type            | page-form **or** drawer → builder; /edit→redirect ✅ | quick-create → builder    | ✅ mostly — prefer the drawer entry, retire the `/new` form |
| Inspection bank            | page-form **or** drawer → builder; /edit→redirect ✅ | quick-create → builder    | ✅ mostly — same                                            |
| Form template              | page-form launchpad → designer                       | keep (launchpad) or modal | keep; the picker (app-type/clone/blank) is meaningful       |
| Report definition (custom) | page-form → ReportStudio                             | keep → studio             | keep; studio is the editor                                  |

### Tier 2 — sub-entities & ledgers (all **keep**, already inline/drawer)

Equipment: types, categories, inspection types and criteria, log entries, check-in/out, and truck
log. Financial rates and expenses remain in the external financial system. PPE: type criteria,
inspections, issues, issue reports, annual records.
Incidents: events, contributing factors, root-cause whys, preventative steps, injuries,
lost-time, attachments. CA: photos, complete-steps. Hazard assessment: tasks, hazards, PPE,
questions, signatures, photos, app-responses; type PPE/questions/apps. Training: class attendees,
assessment-type questions, LMS modules/lessons, skill types. Inspections: bank criteria, type
groups/criteria, record criterion responses. Forms: response participants. Locations: contacts*,
projects* (_currently page-form — see Tier 3). Journals: photos, tags_. Lone-worker: check-ins.

→ No change. These are correct as inline rows / `?drawer=` editors on the parent.

### Tier 3 — small lookups currently on a full `/new` page → **quick-create modal**

| Entity                     | Current                 | Action                                         |
| -------------------------- | ----------------------- | ---------------------------------------------- |
| People department          | page-form               | → table + drawer on the list (shipped)         |
| People group               | page-form               | → quick-create modal                           |
| Document book              | page-form               | → quick-create modal (title/category/desc)     |
| Document management-review | page-form               | → quick-create modal                           |
| Report schedule            | page-form               | → quick-create modal (or keep; ~150-line form) |
| Location: project          | page-form (nested /new) | → quick-create modal on customer detail        |
| Location: customer contact | page-form (nested /new) | → quick-create drawer on location detail       |

Already good (inline/drawer): incident classifications, injury types, hours periods; equipment
types/categories; journal tags; api keys; job-title tasks.

### Special — keep full-page / wizard (justified)

| Entity                 | Why keep                                                                       |
| ---------------------- | ------------------------------------------------------------------------------ |
| Compliance obligation  | kind→target→audience→recurrence; genuinely multi-step (consider a wizard)      |
| Tenant (super-admin)   | provisioning: region/languages/slug/seeding                                    |
| Job title              | 5 long description fields + task matrix (could move to inline-on-detail later) |
| PPE type               | 3 sub-tabs (criteria, sizing); page-form fine                                  |
| Hazard-assessment type | multi-toggle config; page-form fine                                            |
| Customer (org root)    | could be instant-create; low volume, low priority                              |

### Derived / automated — no create UI (correct)

Certificates, training records, lesson progress, enrollments (self-enroll = instant action),
compliance audience/dispatch/status, report runs, AI conversations/messages, form-response
participants.

### Needs confirmation (agents couldn't fully trace)

**Skill assignments**; **content items** (LMS library); hazard **sets** & **location tasks**;
**atmospheric sensors / calibrations** (likely admin-only); tenant-user **invite** flow.

Inspection cadence is authored only through unified compliance obligations; there is no separate
inspection-assignment creation flow.

---

## Rollout order (suggested)

1. **Tier 3 modals** (fast, self-contained, high consistency win): departments, groups, document
   books, management-reviews, report schedules, projects, contacts.
2. **Tier 1 with existing draft state** (no schema change): inspection records, training assessment
   attempts, hazard assessments, training course/class/type/authority → drop `/new`, instant-create,
   merge any `/[id]/edit` into the detail surface.
3. **Tier 1 needing a draft flag** (schema + list filters + sweep): incidents, corrective actions,
   equipment items, PPE items. Add the draft notion, hidden-vs-badged per the table, wire the
   abandoned-draft sweep into the existing worker.
4. **Edit-page merges**: convert remaining `separate-edit-page` (equipment, incidents, people,
   locations, ppe types, compliance, reports) so `/[id]` is the single editor and `/[id]/edit`
   redirects — mirroring hazard-assessments / inspections.

## Shared infra to build once

- A `draft` status convention (reuse existing `status` enums; add a `draft` value or `is_draft`
  where missing) + list/compliance query filters that exclude hidden drafts.
- An abandoned-draft **sweep** job (worker/cron) — delete hidden drafts untouched > 48h.
- A reusable **QuickCreateModal** + a `createDraftAndRedirect` server-action helper.
- A reusable **"Drafts (N)"** list affordance.
