// Manual articles: Knowledge & training + Equipment & PPE.
// Written for non-technical field workers. Labels in **bold** are the exact
// strings rendered by the pages under /training, /documents, /equipment, /ppe.

import type { ManualArticle } from '../types'

export const KNOWLEDGE_ASSETS_ARTICLES: ManualArticle[] = [
  {
    slug: 'training',
    title: 'Training & certificates',
    group: 'Knowledge & training',
    iconKey: 'grad',
    summary: 'Take your assigned courses and keep track of your tickets and certificates.',
    keywords: [
      'training',
      'tickets',
      'certs',
      'certificates',
      'courses',
      'quiz',
      'classes',
      'orientation',
      'competency',
      'expiring',
      'wallet card',
      'my training',
    ],
    body: `Training is where you take courses and where your tickets live.

## What this is for

Your company assigns you courses — online lessons, quizzes, and classroom sessions. When you finish one, a training record is logged and a certificate is issued. This page also shows when your tickets expire, so nothing lapses on the job.

## Where to find it

Open **Training** in the left menu. You will see tabs for **Certificates**, **Courses**, **Classes**, and more. For your own stuff, the fastest path is [My Workspace](/my): tap the **Training** tile for your courses and records, or the **Wallet** tile for your credential cards.

## Take an assigned course

1. Go to [My training](/my/training) and open the **Courses** tab.
2. Find your course. The button on the card says **Start**, **Continue**, or **Review** if you already finished it.
3. Tap the button, then tap **Start course** to begin.
4. Work through the lessons in order. The sidebar shows your progress and which lessons are done.
5. At the end of each lesson, tap the button at the bottom — **Mark complete**, **Start quiz**, or **Mark attended**, depending on the lesson type.
6. When every required lesson is done, you will see **Course complete**. Tap **Download certificate** to save a copy.

## Check your certificates and expiry dates

1. Open **Training** in the left menu. It lands on the **Certificates** tab.
2. Each row shows the **Course**, when it was **Completed**, and when it **Expires**.
3. Expired tickets show a red **Expired** badge.
4. In [My training](/my/training), the **Expiring (90d)** tab lists everything coming due, with a **Days left** count for each one.

## See your classes

1. Open **Training**, then tap the **Classes** tab.
2. Filter by **Upcoming**, **Past**, or **All**.
3. Each class shows the date, course, site, and a status: **Scheduled**, **Awaiting completion**, **Completed**, or **Cancelled**.

## Carry your tickets with you

1. Go to [My Workspace](/my) and tap **Wallet**.
2. Each certificate is a card. Tap a card to flip it and see the details.
3. You can download a print-ready pass for any card.

## Tips

- The **Assigned** tab in [My training](/my/training) shows training you still owe, with due dates. Anything marked overdue needs attention first.
- Lessons marked **opt** are optional. Everything else must be completed.`,
  },
  {
    slug: 'training-slideshows',
    title: 'Course slideshows & PowerPoint',
    group: 'Knowledge & training',
    iconKey: 'grad',
    summary: 'Build slideshow lessons, or import a PowerPoint and keep editing it in the browser.',
    keywords: [
      'powerpoint',
      'pptx',
      'slides',
      'slideshow',
      'deck',
      'import',
      'presentation',
      'course builder',
      'lesson',
      'collabora',
    ],
    requiredPermission: 'training.course.manage',
    body: `Slideshow lessons show one slide at a time, with speaker notes and a progress bar. Every slideshow is a PowerPoint file: import one you already have, or start a blank deck — either way you edit it in a full PowerPoint editor right inside BeaconHS, and you can download the file at any time.

## Where to find it

Open **Training** in the left menu, then **Courses**. Open a course, add or open a lesson, and set its type to **Slideshow**. Reusable decks live in the **Content Library** the same way.

## Start a deck

1. Open a slideshow lesson. A new deck offers two choices.
2. **Import PowerPoint** — drop in a .pptx file. It becomes the deck's working copy, with speaker notes carried over.
3. **Start blank** — creates a new empty PowerPoint deck.
4. Conversion runs in the background; the slides appear when it finishes and look exactly as they do in PowerPoint.

## Edit the deck

1. Open the slideshow lesson. The PowerPoint editor opens right in the page, with the file name in the toolbar.
2. Make your changes — text, slides, images, layouts, anything. Changes save automatically.
3. After each save the slideshow re-renders for learners; the toolbar shows **rendering…** until it catches up.

If the page says PowerPoint editing is not configured, ask your administrator — the editor needs the Collabora server set up. The slideshow still plays and the file can still be downloaded.

## Download the PowerPoint

Click **Download** in the deck toolbar to save the current file, including every edit made in the browser.

## Replace the file

Click **Replace** and drop in a different .pptx. It becomes the deck's new working copy and the slides re-render.

## Tips

- Keep one person editing a deck at a time. The editor supports more, but training content rarely needs two authors at once.
- Very large files can take a minute or two to convert. The **rendering…** badge shows while that runs.
- Use **Present** to run the deck full-screen from the rendered slides.`,
  },
  {
    slug: 'documents',
    title: 'Documents & policies',
    group: 'Knowledge & training',
    iconKey: 'book',
    summary:
      'Find and read safe work practices, procedures, and policies, and sign off when asked.',
    keywords: [
      'documents',
      'policies',
      'procedures',
      'safe work practice',
      'SWP',
      'SOP',
      'SDS',
      'manuals',
      'acknowledge',
      'sign off',
      'read and sign',
      'document books',
    ],
    body: `Documents holds your company's safe work practices, procedures, policies, and manuals.

## What this is for

Instead of paper binders, every published document lives in one place. You can search it, read it on your phone, and sign off when the company needs proof you read something.

## Where to find it

Open **Documents** in the left menu. You will see cards for every published document. Only published documents show up — drafts stay hidden until they are ready.

## Find and read a document

1. Open [Documents](/documents).
2. Type a word in the search box — it says **Search title or description**. You can also filter by **Category** or **Type**.
3. Tap **View PDF** on the document you want.
4. The document opens right there. Tap **Download** to save a copy, or **New tab** to open it full screen for printing.

## Acknowledge a document

Some documents need your sign-off. This is the digital version of signing the sheet at a toolbox talk.

1. Open the document's page and go to the **Acknowledgments** tab.
2. Read the document first. The screen reminds you: by acknowledging you confirm you have read and understood it.
3. Add your signature if the **Signature (optional)** box is shown.
4. Tap **Acknowledge**.
5. You will see **You've acknowledged this** with the date and time it was recorded. Done — no paper needed.

If a supervisor is running a group sign-off at a toolbox talk, they will pass you the tablet to sign your name on their screen instead.

## Document books

A book bundles related documents into one big PDF — for example, a full safety manual.

1. Go to [Document books](/documents/books).
2. Search or browse the cards. Each card shows how many documents are inside.
3. Tap **View PDF** to read the whole book.

## Tips

- If you cannot find a document, check your spelling, then try a shorter search word.
- Acknowledgment requests can also show up in your notifications. Follow the link, read, and tap **Acknowledge**.
- Need training instead of a document? See [Training & certificates](/help/training).`,
  },
  {
    slug: 'documents-authoring',
    title: 'Writing documents',
    group: 'Knowledge & training',
    iconKey: 'book',
    summary: 'Write documents in a full Word editor, publish numbered versions, keep history.',
    keywords: [
      'write document',
      'word',
      'docx',
      'publish',
      'version',
      'track changes',
      'draft',
      'author',
      'edit document',
    ],
    requiredPermission: 'documents.manage',
    body: `Documents are Word files. You write them in a full Word editor right inside BeaconHS, and readers always see a numbered, published PDF that looks identical on every device and on paper.

## Start a document

1. Open [Documents](/documents) and create a document.
2. On its page, the **Write** tab offers two choices: **Import Word file** (drop in a .docx) or **Start blank**.
3. The file becomes the working draft. Everything you type saves automatically.

## Edit the draft

1. Open the document's **Write** tab. The Word editor opens right in the page.
2. Page size, headers, footers, images, tables — set them in the editor, exactly like Word.
3. Use the editor's **Review** menu for track changes and comments while a document is being reviewed.
4. **Download DOCX** saves the working file; **Replace** swaps in a different Word file.

## Publish a version

1. Click **Publish** in the Write toolbar.
2. Add a short note about what changed (optional), then confirm.
3. The draft is frozen as the next numbered version — v1, v2, v3 — and its PDF renders in the background. Readers always see the latest published version; your draft stays private until the next publish.

## Version history

Open the **Versions** tab. Every published version keeps its own PDF and Word file:

- **PDF** — read or print that exact version.
- **DOCX** — download the Word snapshot.
- **Open read-only** — view the old version in the editor without changing anything.

## Uploaded PDFs

Documents can also be plain uploaded PDFs (scanned or externally produced). Use **Upload PDF** on the PDF tab — there is no editor for these; the file itself is the document.

## Tips

- Acknowledgments always point at published versions, so you can edit the draft freely without affecting sign-offs.
- Keep one person editing a document at a time.`,
  },
  {
    slug: 'equipment',
    title: 'Equipment',
    group: 'Equipment & PPE',
    iconKey: 'construction',
    summary: 'Look up any unit — its status, who has it, where it is, and its service history.',
    keywords: [
      'equipment',
      'units',
      'asset tag',
      'fleet',
      'machine',
      'tools',
      'tool crib',
      'serial number',
      'work order',
      'maintenance',
      'service records',
      'checked out',
    ],
    body: `Equipment is the registry of every unit and tool your company tracks.

## What this is for

Look up any unit to see its status, which site it is at, who is holding it, and its service history. No more radio calls asking where the compactor went.

## Where to find it

Open **Equipment** in the left menu. That opens the full list at [Equipment](/equipment).

## Look up a unit

1. Open [Equipment](/equipment).
2. Type in the search box — it says **Search asset tag, name, serial #**.
3. Or filter by **Status** (**In service**, **Out of service**, **In repair**, **Lost**, **Retired**) or by **Availability** (**Available for check-out**, **Currently checked out**).
4. The list shows the **Asset tag**, **Name**, **Status**, **Site**, and **Holder** for each unit.
5. Tap a row to open the unit's page.

## See who has a unit and where it is

1. Open the unit, then tap the **Location & custody** tab.
2. **Current site** and **Current holder** show where it is and who has it right now.
3. **Check-out history** shows every past hand-off — who took it, when it went out, and when it came back.

To check a unit in or out yourself, use the station. See [Equipment check-in / check-out](/help/equipment-station).

## Check service and maintenance records

1. Open the unit and tap the **Log** tab. Entries are tagged by kind: **Note**, **Maintenance**, **Fuel**, **Incident**, or **Modification**.
2. The **Files** tab holds manuals, certificates, receipts, and photos for the unit.
3. The **Inspections** tab shows the inspection history and anything marked **overdue** or **due soon**.

## Work orders

If your role can see them, work orders track repairs.

1. On a unit, tap the **Work orders** tab to see repairs for that unit.
2. Or open the full list at [Work orders](/equipment/work-orders).
3. Statuses run from **Open** through **In progress** and **Awaiting parts** to **Repaired**, **Verified**, and **Completed**.

## Tips

- A red **missing** badge means someone reported the unit missing. If you find it, tell your supervisor.
- Need to inspect a unit before use? See [Equipment inspections](/help/equipment-inspections).`,
  },
  {
    slug: 'equipment-station',
    title: 'Equipment check-in / check-out',
    group: 'Equipment & PPE',
    iconKey: 'link',
    summary: 'Scan units in and out at the station so everyone knows who has what.',
    keywords: [
      'check out',
      'check in',
      'station',
      'scan',
      'scan gun',
      'QR code',
      'tool crib',
      'sign out tools',
      'kiosk',
      'PIN',
      'badge',
      'return equipment',
    ],
    body: `The station is where you scan equipment in and out, so the system always knows who has what.

## What this is for

When you take a unit, scan it out under your name. When you bring it back, scan it in. "Checked in" means the unit is back at its home base — the yard or shop it belongs to.

## Where to find it

Open **Equipment** in the left menu, then go to the **Check-in / out station** at [the station page](/equipment/station). It works with a USB scan gun, your phone camera, or by typing a tag.

## Check a unit out

1. Open the [station](/equipment/station).
2. Scan your badge first, or type your name in the scan box. It says **Scan a tag or badge — or type to search**. You will see **Active holder set** — that is you.
3. Now scan the unit's tag, or type its asset tag and tap it in the list.
4. You will see **Checked out** with the asset tag and name. The unit is now on you.

## Check a unit back in

1. Open the [station](/equipment/station).
2. Scan the unit's tag or type it in.
3. You will see **Checked in**. The unit snaps back to its home base location.

The **Scan does** setting controls what a scan means: **Toggle** flips each unit (out if it was in, in if it was out), or lock it to **Out** or **In** when you are moving a big batch one way.

## Scan a QR label with your phone

1. Every tagged unit has a QR label. Scan it with your phone camera.
2. It opens the station with that unit already loaded — then check it in or out as usual.
3. On the station page itself, you can also tap the camera button (**Scan with camera**) and point your phone at a tag.

## Use the mounted tablet kiosk

Some yards run a tablet at the door in kiosk mode.

1. Walk up to the tablet. If it is locked, enter the yard PIN and tap **Unlock kiosk**.
2. Scan your badge, then scan your units — same steps as above.

## Tips

- Made a mistake? Tap **Undo** next to the entry in the **This session** list.
- Not sure who has a unit? Look it up — see [Equipment](/help/equipment).`,
  },
  {
    slug: 'equipment-inspections',
    title: 'Equipment inspections',
    group: 'Equipment & PPE',
    iconKey: 'clipboard-check',
    summary: 'Do a pre-use or scheduled inspection on a unit and log any defects.',
    keywords: [
      'inspection',
      'pre-use',
      'pre-trip',
      'circle check',
      'walkaround',
      'checklist',
      'pass fail',
      'defect',
      'work order',
      'equipment inspection',
    ],
    body: `Do your pre-use and scheduled equipment inspections here instead of on paper.

## What this is for

Before you run a unit — or on its service schedule — you walk through a checklist and mark each item pass or fail. Failed items get logged with details, and serious ones can automatically open a work order for the shop.

## Where to find it

Open **Equipment** in the left menu, then go to [Inspections](/equipment/inspections). You can also start a pre-use check straight from a unit's page: open the unit, tap the **Inspections** tab, and tap **Start pre-use inspection**.

## Perform an inspection

1. Open [Inspections](/equipment/inspections) and tap **New inspection**.
2. On the **Start an inspection** screen, pick the **Equipment item** and the **Inspection type**. The checklist loads from the type.
3. Tap **Start inspection**.
4. Go through each item and tap **Pass**, **Fail**, or **N/A**.
5. Your answers save as you go — watch for **Saved** at the top. You can stop and come back later; the inspection stays **In progress**.

## Record a failed item

1. Tap **Fail** on the item.
2. Set the **Severity**: **Low**, **Medium**, **High**, or **Critical**.
3. Fill in **What's wrong?** with a short note, and **Action taken** if you did something about it.
4. Add a photo if the item asks for one. The app will not let you submit until required comments and photos are filled in.

## Submit the inspection

1. If everything left is fine, tap **Pass all remaining** to fill in the rest.
2. Tap **Submit**.
3. The result shows as **pass** or **fail** in the list. Failed items can spawn a work order automatically, so the shop sees the defect without a phone call. A small **Work order** tag appears on the failed item when that happens.

## Tips

- Use the **Status** chips on the list — **All**, **Draft**, **In progress**, **Submitted** — to find an inspection you started earlier.
- Never pencil-whip it. A failed item with a photo gets fixed a lot faster than a fake pass.
- Inspecting your harness or hard hat instead? That lives in [PPE](/help/ppe).`,
  },
  {
    slug: 'ppe',
    title: 'PPE',
    group: 'Equipment & PPE',
    iconKey: 'hard-hat',
    summary: 'See the PPE issued to you, inspect it, report damage, and return it.',
    keywords: [
      'PPE',
      'personal protective equipment',
      'harness',
      'harness inspection',
      'hard hat',
      'gloves',
      'safety glasses',
      'fall arrest',
      'issued',
      'damaged',
      'defect',
      'return gear',
    ],
    body: `PPE tracks the protective gear issued to you — harnesses, hard hats, gloves, glasses — through its whole life.

## What this is for

Every serialized item has its own record: who holds it, when it was last inspected, and when the next inspection is due. You use it to check your own gear, log inspections, and report damage.

## Where to find it

Open **PPE** in the left menu. That opens the list at [PPE](/ppe). It starts filtered to **Issued** items. You can search by type or serial number, or switch the status filter to **In stock**, **Returned**, **Damaged**, **Discarded**, or **Expired**.

## See your issued gear

1. Open [PPE](/ppe).
2. Find your items — the **Holder** column shows who each item is issued to.
3. Tap an item to open it. The **Status & schedule** panel shows **Currently with**, **Last inspection**, and **Next inspection due**.

## Inspect your PPE

Do a quick pre-use check before you trust your gear, and the full periodic check when it comes due.

1. Open the item and tap the **Inspections** tab.
2. Tap **Pre-use** for a quick check, or **Annual** for the full periodic inspection.
3. Answer every criterion: **Pass**, **Fail**, or **N/A**.
4. Add anything worth flagging in the **Notes** box.
5. Tap **Record inspection**. If something failed, the button reads **Record failed inspection** — that is fine, record it honestly.

The result is worked out from your answers. A high-severity failure automatically opens a corrective action, so it gets dealt with.

## Report damaged gear

Frayed strap, cracked shell, missing buckle — report it as soon as you spot it.

1. Open the item and tap the **Issues** tab.
2. Tap **Report defect**.
3. Describe the problem in the **What's wrong?** box.
4. Tap **Report defect** to log it. Open reports stay visible until someone resolves them. Stop using the item until you are told it is safe.

## Return an item

When you leave a site or swap out gear, hand the item back to your supervisor or whoever issued it. They will mark it **Returned** in the system, and the **History** tab on the item keeps the record.

## Tips

- **Next inspection** on the list shows what is coming due — do not let your harness inspection lapse.
- Certificates from third-party recertifications (like annual fall-arrest inspections) live on the item's **Certificates** tab.`,
  },
]
