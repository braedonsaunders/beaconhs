// Everyday tasks — the articles field workers use most: journals, hazard
// assessments, inspections, incidents, corrective actions, the truck log,
// forms, compliance, the feed, and field tools. Grounded in the real UI —
// keep the bolded labels in sync with those pages.

import type { ManualArticle } from '../types'

export const FRONTLINE_ARTICLES: ManualArticle[] = [
  {
    slug: 'journals',
    title: 'Daily journals',
    group: 'Everyday tasks',
    iconKey: 'journal',
    summary: 'Write a daily log of your work, add photos, and submit it.',
    keywords: [
      'journal',
      'daily log',
      'diary',
      'site diary',
      'daily report',
      'log book',
      'notes',
      'photos',
      'tags',
      'voice',
      'dictate',
    ],
    body: `Your journal is a daily record of what happened on the job: work done, hazards spotted, visitors, weather, anything worth remembering.

## What this is for

A journal entry protects you and your crew. If a question comes up months later, your entry shows what happened that day. Supervisors also read journals to stay on top of site conditions.

## Where to find it

Open **Journals** in the left menu. The page opens on your most recent entry. On a desktop your past entries sit in a list on the left. On a phone, tap **Browse** to see them.

## Writing today's entry

1. Open [Journals](/journals).
2. Tap **New entry**. An entry for today opens.
3. Type what happened. Your words save automatically as you go — there is no save button.
4. Use the microphone button to dictate by voice instead of typing, if you prefer.
5. Set the location and people in the bar above the text, if they apply.

## Adding photos

1. Scroll to the **Photos** section under the text.
2. Tap the upload area to take a photo or pick one from your phone.
3. To remove a photo, tap the remove button on it.

## Tags

Tags help people find entries later (for example a tag for concrete pours). Tap the **Tags** chip in the bar above the text to add or change tags. If your company has AI assist turned on, tags are often added for you.

## Submitting

1. When your entry is done, tap **Submit** at the top.
2. Submitted entries are shared with the people allowed to see them. Until then the entry is a draft only you can see.

## Viewing past entries

1. Open [Journals](/journals). On a phone, tap **Browse**.
2. Entries are grouped by date. Tap one to open it.
3. Tap **Drafts** in the list to see entries you have not submitted yet.

## Tips

- Write your entry through the day, not from memory at quitting time. It autosaves, so short visits are fine.
- A photo of a hazard is worth a paragraph. Add both.
- If you missed a day, pick that date in the list to create an entry for it.`,
  },
  {
    slug: 'hazard-assessments',
    title: 'Hazard assessments (JSHA / FLHA)',
    group: 'Everyday tasks',
    iconKey: 'radiation',
    summary: 'Assess the hazards of a task before work starts and get the crew signed on.',
    keywords: [
      'JSA',
      'JSHA',
      'FLHA',
      'FLRA',
      'hazard card',
      'tailgate',
      'hazard assessment',
      'job safety analysis',
      'field level',
      'risk',
      'risk rating',
      'controls',
      'sign on',
      'signature',
      'PPE',
    ],
    body: `A hazard assessment (your company may call it a JSA, JSHA, FLHA, FLRA, or hazard card) captures the hazards of a planned task and the controls that make it safe — before the crew starts work.

## What this is for

Walking through the hazards as a crew catches problems while they are still cheap to fix. The signed record shows everyone understood the risks that day.

## Where to find it

Open **Hazard Assessments** in the left menu, or go to [Hazard assessments](/hazard-assessments).

## Starting a new assessment

1. Tap **New assessment**.
2. Use the search box to find the right assessment type (for example a daily FLHA or a task-specific JSHA) and tap it.
3. Fill in the **General Information** section: who, what, where, and when. Fields save as you type.

## Tasks, hazards, and risk ratings

Depending on the type, you list either the steps of the job or the hazards on site.

1. Tap **Add task** to add a step of the job, or **Add hazard from library** to pick a known hazard. **Add ad-hoc hazard** covers anything not in the list.
2. For each hazard, rate the risk before controls: how likely it is, and how bad it would be.
3. Write the controls that reduce the risk — things like lockout/tagout, barricades, or signage.
4. Rate the risk again after controls. This is the residual risk, and it should be lower.

## PPE

1. Tap **Add PPE** to list the gear the task needs.
2. Add a note on when or why each item is needed.

## Crew sign-on

1. In the signatures section, tap **Add signature**.
2. Pick **Internal (employee)** and choose the person, or **External (visitor / contractor)** and type their name.
3. Have them sign in the **Signature** box.
4. Repeat for everyone on the crew. The header shows how many signatures are collected.

## Finishing up

1. When everything is rated and signed, tap **Lock** so nothing changes.
2. Use **Print / PDF** for a paper copy, or **Send email** to share it.

## Tips

- Conditions change. If the job changes, unlock and update the assessment, or start a new one.
- **Copy assessment** starts a new one pre-filled from an old one — handy for repeat work.`,
  },
  {
    slug: 'inspections',
    title: 'Site inspections',
    group: 'Everyday tasks',
    iconKey: 'clipboard',
    summary: 'Run a checklist inspection, flag failures, and submit the record.',
    keywords: [
      'inspection',
      'checklist',
      'audit',
      'walkdown',
      'walk down',
      'site check',
      'deficiency',
      'pass fail',
      'punch list',
      'findings',
    ],
    body: `An inspection is a checklist you walk through on site: each item passes, fails, or does not apply. Failures capture what was wrong and what was done about it.

## What this is for

Regular inspections catch unsafe conditions before they hurt someone. The record proves the check happened and tracks anything found.

## Where to find it

Open **Inspections** in the left menu. Records live at [Inspection records](/inspections/records).

## Starting an inspection

1. Tap **New inspection**.
2. Use the search box to find the inspection type and tap it. The list shows how many checks each type has.
3. A new draft record opens. Fill in the details at the top — site, foreman, notes. Fields save as you go.

## Answering the criteria

1. Work down the list. Tap **Pass**, **Fail**, or **N/A** on each item. Some items use **Yes** / **No** instead.
2. When you tap **Fail**, extra fields open on that item:
   - **Reason for non-compliance** — what is wrong.
   - **Action taken** — what was done to fix it.
   - A severity, and a person the finding is assigned to, if your company uses those.
3. Add photos on any failed item. Some items require a photo before you can submit — they show a **Photo** tag.
4. If most items pass, tap **Mark unanswered as pass** in the **Status & workflow** section to fill the rest in one tap. Only do this when you actually checked them.

## Draft vs submitted

A record stays a draft while you work — you can leave and come back. When every item is answered:

1. Open the **Status & workflow** section.
2. Pick the new status under **Move to** and tap **Update status**.
3. Submitting or closing requires every item to be answered. Closing locks the record so it cannot change.

## Tips

- Answer items as you walk, on your phone. Everything saves instantly.
- A failed item with a photo and a clear reason gets fixed faster than a vague note.
- Failures can turn into follow-up work. See [Corrective actions](/help/corrective-actions).`,
  },
  {
    slug: 'incidents',
    title: 'Reporting an incident',
    group: 'Everyday tasks',
    iconKey: 'alert',
    summary: 'Report injuries, near misses, property damage, and spills — fast.',
    keywords: [
      'incident',
      'injury',
      'accident',
      'near miss',
      'near-miss',
      'close call',
      'first aid',
      'property damage',
      'spill',
      'environmental',
      'report',
      'investigation',
    ],
    body: `Report every incident: injuries, illnesses, near misses, property damage, environmental spills, and security events. If it went wrong — or almost went wrong — it belongs here.

## What this is for

Near misses are free lessons. A close call reported today can stop an injury next month. Reporting is not about blame; it is how the company finds and fixes hazards.

## Where to find it

Open **Incidents** in the left menu, or go to [Incidents](/incidents).

## Reporting an incident

1. Tap **Report incident**.
2. Pick the **Type**: injury, illness, near miss, property damage, environmental, or security.
3. Pick the **Severity**. For a near miss with no one hurt, pick no injury.
4. Set **Occurred at** (date and time) and the **Site**.
5. Give it a short **Title**, like "Slip on wet floor near pump 3".
6. In **Description**, write what happened: who was there, what equipment was involved, what you saw.
7. Fill in **Immediate action taken** — first aid given, area barricaded, equipment locked out, and so on.
8. Tap **Submit report**.

The quick report captures the essentials. Photos, witness statements, and the full investigation happen on the incident's page after you submit.

## What happens after

- The incident starts as **Reported**. The right people are notified automatically.
- An investigator may move it to investigating, dig into the causes, and record findings on the incident page.
- Fixes get assigned as [corrective actions](/help/corrective-actions) with owners and due dates.
- When the investigation and fixes are done, the incident is closed.

You can open your own reports any time from the [Incidents](/incidents) list to see their status.

## Tips

- Report first, get details later. A quick report now beats a perfect report tomorrow.
- Get first aid and make the area safe before touching the app. The report can wait a few minutes; a person cannot.
- When in doubt, report it. Nobody gets in trouble for reporting a near miss.`,
  },
  {
    slug: 'corrective-actions',
    title: 'Corrective actions',
    group: 'Everyday tasks',
    iconKey: 'list-checks',
    summary: 'Fixes assigned to you: what they are, doing the work, and closing them out.',
    keywords: [
      'corrective action',
      'CA',
      'action item',
      'follow up',
      'follow-up',
      'punch list',
      'fix',
      'deficiency',
      'due date',
      'overdue',
      'assigned to me',
      'close out',
    ],
    body: `A corrective action is a fix that came out of an incident, inspection, or hazard assessment — with an owner and a due date. If one is assigned to you, it is your job to do the work and record it.

## What this is for

Finding a problem only matters if someone fixes it. Corrective actions track each fix from "assigned" to "done and checked" so nothing falls through the cracks.

## Where to find it

Open **Corrective Actions** in the left menu, or go to [Corrective actions](/corrective-actions). The list opens on open actions. Each row shows the status and the due date — overdue ones are flagged. Use the search box and the status filter to narrow the list; tap **All statuses** to see closed ones too.

## Completing one assigned to you

1. Open the action from the list.
2. Read the **General** section so you understand what is being asked, and check the due date.
3. Do the work in the field.
4. In the **Work** section, fill in **Action taken** — what you actually did. Fields save as you type. Add the root cause if you know it.
5. Add photos of the finished fix in the **Photos** section.
6. Some actions have step-by-step items. Check each one off as you finish it.

## Verification and closing

- Some actions need a second person to verify the fix before they can close. The **Verification** section shows this — the verifier taps **Verify** and signs.
- To close, tap **Close + lock** at the top. You can add a cost figure and a close note. Closing locks the record so it becomes read-only.
- Made a mistake? Someone with access can tap **Reopen**.

## Due dates

The due date is on the row in the list and at the top of the action. Overdue actions are marked and show up in reports your supervisor sees. If you cannot make the date, say so early — do not let it quietly go overdue.

## Tips

- Write **Action taken** like you are explaining it to someone who was not there.
- A before-and-after photo pair tells the whole story.`,
  },
  {
    slug: 'vehicle-log',
    title: 'Vehicle / truck log',
    group: 'Everyday tasks',
    iconKey: 'wrench',
    summary: 'Log your monthly truck kilometres — by destination or by odometer.',
    keywords: [
      'truck log',
      'vehicle log',
      'mileage',
      'odometer',
      'kms',
      'km',
      'kilometres',
      'kilometers',
      'truck',
      'driving',
      'personal km',
      'business km',
      'month',
    ],
    body: `The vehicle log records the kilometres you drive a company truck each month. Each day gets one row.

## What this is for

The log splits business and personal kilometres so the company records are right at tax time, and shows which vehicle went where.

## Where to find it

Open **Equipment** in the left menu, then the **Vehicle log** tab — or go straight to [Vehicle log](/equipment/vehicle-log).

## Setting up your month

1. Tap **Choose driver** and pick yourself.
2. Tap **Choose vehicle** and pick your truck.
3. If your company allows both, pick a **Log mode**: **Destination** or **Odometer**.
4. Use the arrows to change months. **This month** jumps back to today's month.

You now see the month grid — one row per day.

## Logging a day (odometer mode)

1. Find today's row.
2. Type the **End** odometer reading. You can skip **Start** — a blank start carries forward from the previous day's end, so you usually only type one number.
3. Type any **Personal km** for that day.
4. Tap out of the field. The row saves by itself — a checkmark shows when it is saved.

The **Total km** column and the month totals at the bottom update as you type.

## Logging a day (destination mode)

1. Find today's row.
2. Pick the **Customer / site** you drove to, or type an **Other destination**.
3. Type the business **Km** and any **Personal km**.
4. Tap out of the field to save.

## Quick fill

- Press Enter in a field to jump to the same field on the next day — you can run down the whole month fast.
- In odometer mode, leaving **Start** blank chains each day off the one before it.

## On a phone

The grid becomes a stack of day cards with big touch targets, one card per day, with the same fields. Fill them the same way.

## Tips

- Tap **PDF** to get the printable monthly sheet for the selected driver and vehicle.
- Log daily. Rebuilding a month from memory is painful and usually wrong.`,
  },
  {
    slug: 'forms',
    title: 'Filling out forms',
    group: 'Everyday tasks',
    iconKey: 'clipboard-check',
    summary: 'Find, fill, and submit company forms like toolbox talks and lift plans.',
    keywords: [
      'form',
      'forms',
      'toolbox talk',
      'safety talk',
      'tailgate talk',
      'lift plan',
      'fill out',
      'submit',
      'signature',
      'paperwork',
      'checklist',
    ],
    body: `Your company builds its own digital forms in BeaconHS — toolbox talks, lift plans, permits, checklists, and more. You fill them in the app instead of on paper.

## What this is for

One place for all the paperwork. Nothing gets lost in a truck cab, and the office sees your form the moment you submit it.

## Where to find forms

- **Pinned forms** sit right in the left menu. Most companies pin **Toolbox talks** and **Lift plans** there, and may pin others.
- **Assigned forms** show up in your [Workspace](/my) and your Inbox when someone assigns one to you, and under [My compliance](/help/compliance) if it is required.

## Filling out a pinned form

1. Tap the form in the left menu — for example **Toolbox talks**. You land on the list of past entries.
2. Tap **New entry**. A fresh entry opens.
3. Fill in the fields. Your answers save as you go, so you can stop and come back.
4. Some forms ask for signatures — sign in the signature box, and pass the phone around if the whole crew signs.
5. Tap **Submit** when you are done. Some entries use a **Finalize** button instead — it does the same job: it marks the entry complete and locks it.

## Filling out an assigned form

1. Open your [Workspace](/my) or the notification you received.
2. Tap the assigned form to open it.
3. Fill it in and submit the same way.

## Finding a past entry

1. Tap the form in the left menu to open its entry list.
2. Use the search box and filters to find the entry, and tap it to open.

## Tips

- Required fields are marked. The form tells you what is missing when you try to submit.
- For a toolbox talk, add everyone who attended before you submit — that is your attendance record.
- If a form you need is not in your menu, ask your supervisor. Forms can be pinned or assigned to you.`,
  },
  {
    slug: 'compliance',
    title: 'My compliance',
    group: 'Everyday tasks',
    iconKey: 'check',
    summary: 'See everything assigned to you — training, forms, documents — and clear it.',
    keywords: [
      'compliance',
      'assigned to me',
      'my tasks',
      'requirements',
      'training due',
      'overdue',
      'acknowledge',
      'sign off',
      'certs',
      'tickets',
      'expiring',
    ],
    body: `The compliance page is your personal to-do list of required items: training to take, forms to fill, documents to read and acknowledge, and sign-offs to complete.

## What this is for

Companies assign required items to roles and crews — a yearly training course, a monthly inspection, a policy to acknowledge. This page shows exactly what is on your plate and when it is due, so nothing sneaks up on you.

## Where to find it

Open **Compliance** in the left menu, or go to [Compliance](/compliance). Most people land straight on the **Mine** tab — your own items. Supervisors also see extra tabs for the whole team.

## Reading the page

- The bar at the top shows your progress — how many items are done out of the total.
- Each row is one obligation. The **Due** column shows the deadline; overdue items are flagged.
- The **Completed** column shows when you finished it.

## Clearing an item

1. Open [Compliance](/compliance).
2. Find a row that is not done. The button on the row tells you what to do — it changes with the kind of item:
   - **Acknowledge** — open the document, read it, and confirm.
   - **Go to training** — opens your training so you can take the course.
   - **Open app** — opens the form you need to fill and submit.
   - **Start inspection** — starts the required inspection.
   - **New assessment** — starts the required hazard assessment.
   - **Log entry** — opens your journal.
   - **Sign off** — records a required sign-off.
3. Finish the task. The row updates to completed on its own.
4. Rows that are done show **Review** so you can look back at what you submitted.

## Tips

- Check this page once a week. Clearing items early beats explaining overdue ones.
- Recurring items come back on schedule — a monthly item reappears every month. That is normal.
- If an item looks wrong (not your job, wrong site), tell your supervisor instead of ignoring it.`,
  },
  {
    slug: 'feed',
    title: 'Activity feed',
    group: 'Everyday tasks',
    iconKey: 'rss',
    summary: 'A live timeline of recent journals, incidents, assessments, and forms.',
    keywords: [
      'feed',
      'activity',
      'timeline',
      'recent',
      'what happened',
      'news',
      'updates',
      'stream',
    ],
    body: `The feed is a running timeline of recent activity across the company: journal entries, incidents, corrective actions, hazard assessments, and form submissions.

## What this is for

It answers "what happened lately?" without opening five different pages. Start your morning here to catch up on yesterday — a new incident on your site, an inspection on your equipment, a journal from another crew.

## Where to find it

Open **Feed** in the left menu, or go to [Feed](/feed).

## Reading the feed

1. Newest items are at the top, grouped by day.
2. Each card shows who did what, and where. Tap a card to open the full record.
3. Scroll down to load older items.

You only see records you are allowed to see. Two people can open the feed and get different timelines — that is by design.

## Filtering

1. Use the filter pills at the top: **All**, **Journal**, **Incident**, **Corrective action**, **Hazard assessment**, **App**.
2. Tap a pill to show only that kind of activity. The counts on the pills show the last 7 days.
3. Tap **All** to clear the filter.

On a desktop, a summary rail on the side shows the same counts at a glance.

## What the kinds mean

- **Journal** — daily log entries. See [Daily journals](/help/journals).
- **Incident** — reported incidents and near misses. See [Reporting an incident](/help/incidents).
- **Corrective action** — fixes being assigned and closed. See [Corrective actions](/help/corrective-actions).
- **Hazard assessment** — JSHAs and FLHAs. See [Hazard assessments](/help/hazard-assessments).
- **App** — submissions of company forms like toolbox talks. See [Filling out forms](/help/forms).

## Tips

- The feed is read-only. To act on something, tap through to the record itself.
- If the feed looks quiet, it may just mean your access is scoped to your own records. Ask your supervisor if you think you should see more.`,
  },
  {
    slug: 'tools',
    title: 'Field tools',
    group: 'Everyday tasks',
    iconKey: 'wrench',
    summary: 'Built-in calculators and utilities, like the Safe Distance pressure-test calculator.',
    keywords: [
      'tools',
      'calculator',
      'safe distance',
      'pressure test',
      'pneumatic test',
      'stand off',
      'standoff',
      'exclusion zone',
      'QR',
      'utilities',
    ],
    body: `The Tools page collects standalone calculators and utilities — small helpers that do one field job well.

## What this is for

Some field math is too important to do on a napkin. Tools give you a tested calculator that also keeps a record of the answer, so the numbers you acted on are saved.

## Where to find it

Open **Tools** in the left menu, or go to [Tools](/tools). Each tool is a card — tap one to open it.

## Safe Distance (pressure-test calculator)

**Safe Distance** works out the stand-off distance for a pneumatic pressure test — how far people must stay from piping under test. It uses recognized industry methods (NASA-Glenn, ASME PCC-2, and Lloyd's Register stored-energy calculations) and saves every assessment for sign-off and PDF export.

1. Open [Tools](/tools) and tap **Safe Distance**.
2. Tap **New assessment**.
3. Enter the details of the system under test — the pipe dimensions and test pressure.
4. Read the calculated stand-off distances and set your exclusion zone to the largest one.
5. The assessment is saved in the list, where it can be signed off and exported as a PDF.

Past assessments stay in the list on the Safe Distance page, so you can pull up the numbers used on an earlier test.

## Bulk QR Generator

**Bulk QR Generator** prints a sheet of QR code labels for a set of equipment — useful when tagging a yard. Pick the equipment, generate the sheet, and print it.

## Company-published tools

Your company can build its own tools and publish them here. Those appear as extra cards on the same page — tap one and fill it in like a form. What you see depends on what your company has published.

## Tips

- The calculator is only as good as the numbers you type. Double-check pressures and pipe sizes against the test plan.
- If a tool you expect is missing, ask your admin — company tools have to be published before they show up.`,
  },
]
