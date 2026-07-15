// Manual articles: Knowledge & training + Equipment & PPE.
// Written for non-technical field workers. Labels in **bold** are the exact
// strings rendered by the pages under /training, /documents, /equipment, /ppe.

import type { ManualArticle } from '../types'
import { CSV_EXPORT_LIMIT_GUIDANCE } from './_shared'

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
3. Tap the button, then tap **Start course** to begin. If the training is due again, tap **Renew course**. Your earlier certificate stays in your records while course progress starts over for the new period.
4. Work through the lessons in order. The sidebar shows your progress and which lessons are done.
5. At the end of each lesson, tap the button at the bottom — **Mark complete**, **Start quiz**, or **Mark attended**, depending on the lesson type. If the lesson has a minimum time, wait for the time shown before you tap **Mark complete**.
6. When every required lesson is done, you will see **Course complete**. Tap **Download certificate** to save a copy.

## Check your certificates and expiry dates

1. Open **Training** in the left menu. It lands on the **Certificates** tab.
2. Each row shows the **Course**, when it was **Completed**, and when it **Expires**.
3. Expired tickets show a red **Expired** badge. If you were retrained, the old certificate shows **Superseded** instead — only your newest certificate per course counts.
4. Open a certificate. On the desktop table, select **View**. Then open **Cards & certificates**.
5. Choose **Open PDF** for the full-size certificate or wallet card you need. Print or save it from your browser's PDF viewer.
6. In [My training](/my/training), the **Expiring (90d)** tab lists everything coming due, with a **Days left** count for each one.

## See your classes

1. Open **Training**, then tap the **Classes** tab.
2. Search by class, course, code, or site. Filter by **Upcoming**, **Past**, or **All**.
3. Each class shows the date, course, site, and a status: **Scheduled**, **Awaiting completion**, **Completed**, or **Cancelled**.

## Carry your tickets with you

1. Go to [My Workspace](/my) and tap **Wallet**.
2. Each certificate is a card. Tap a card to flip it and see the details.
3. You can download a print-ready pass for any card.

## Automatic class emails (managers)

If you manage training, class changes can send emails on their own — for example, a cancellation notice to everyone registered.

1. Open the Manage hub at [Training manage](/training/manage) and tap **Class automations**.
2. Pick a trigger: **A record is created** (a class is scheduled) or a status change to **Cancelled** or **Completed**.
3. Connect actions like **Send email** or **Notify role**. To email everyone on the roster, set the recipient to the **Attendee emails** field.
4. Turn the flow on.

## Design certificates and wallet cards (managers)

1. Open [Training manage](/training/manage), then choose **Card studio**.
2. Open an existing design, or choose a size under **Add a design**. Card studio supports up to 24 designs.
3. Use **Insert**, **Layers**, **Style**, and **Print** to build the layout. One artboard can hold up to 240 elements.
4. Choose **Preview PDF** to check the current design with sample data.
5. Choose **Save designs**. BeaconHS checks names, colours, dimensions, fields, links, and design size before saving. If it finds a problem, it shows the exact design, artboard, or element to fix and leaves the saved designs unchanged.

## Review skill authorities and holders (managers)

Open **Training** → **Authorities** and choose an authority. On **Skill types**, search by name, code, or description and use **Next** or **Prev** to move through the list. Open a skill type and choose **Holders** to search people or filter the list by **Valid**, **Expiring**, **Expired**, or **No expiry**.

Choose **Additional fields** on an authority or skill type to search field names and values. Use **Next** or **Prev** when the result has more than one page. A worker's skill page keeps its skill, skill-type, and authority field searches separate, so filtering one section does not change the others.

When you edit a worker's held skill, **Person** and **Skill / certification** search the complete active tenant directory and skill catalogue. The currently saved value stays visible while you review an older record, even if that value is no longer active. If the picker says more results exist, add more of the name, employee number, code, or authority to the search.

On **Assessments**, search by person, assessment, or course. The person, assessment type, course, status, and date controls narrow the same list; no filter option is hidden after the first few values.

${CSV_EXPORT_LIMIT_GUIDANCE}

## Tips

- The **Assigned** tab in [My training](/my/training) reads the same requirements as **My compliance**. It shows courses, assessments, and certification requirements you still owe, with due dates and current course progress. Choose **Open** to continue the item. For an assessment, use this assigned link so your attempt is credited to that exact requirement. Anything marked overdue needs attention first.
- The **Training compliance** dashboard card counts these same training and certification requirements. It does not count the number of certificates in your history.
- Lessons marked **opt** are optional. Everything else must be completed.`,
  },
  {
    slug: 'training-courses',
    title: 'Building training courses',
    group: 'Knowledge & training',
    iconKey: 'grad',
    summary: 'Create courses, pick the right delivery type, and build the content workers take.',
    keywords: [
      'course builder',
      'new course',
      'delivery type',
      'self-paced',
      'classroom',
      'online course',
      'on-the-job',
      'external certificate',
      'lessons',
      'modules',
      'enroll',
      'evaluations',
    ],
    requiredPermission: 'training.course.manage',
    body: `Courses are built right on the course page — the same page that shows the course's records, classes, and files.

## Create a course

1. Open **Training** in the left menu, then **Courses**.
2. Tap **New course**. A draft opens immediately — there is no form to fill in first.
3. On the **Overview** tab, set the **Name**, **Code**, and **Delivery type**, then tap **Save settings**.

## Pick the delivery type

The delivery type decides what the course page shows and how workers complete the course:

- **Self-paced** — workers take the course themselves from [My training](/my/training). Build lessons, quizzes, and practicals; finishing every required lesson issues a training record and certificate automatically.
- **Classroom** — instructor-led. Schedule classes on the **Classes** tab. You can still build slides and handouts for instructors to present.
- **Online** — an outside website runs the course. Set the **Course URL** and **Instructions** in Overview; workers open the link, finish the course, and confirm completion in the app.
- **On-the-job** — hands-on training. Build **Practical test** lessons, then sign workers off under **Evaluations**.
- **External certificate** — training earned outside the company, like First Aid from a provider. There is nothing to build or take in the app — record each person's certificate with **Add record** on the course page, or on the **Certificates** tab.

Online and external certificate courses do not show the content builder — their course page shows the link or the record shortcuts instead.

## Build the content

1. Open the course and tap the **Build** tab.
2. Drag an element onto a module: **Text lesson**, **Slideshow**, **Video**, **Quiz**, **Practical test**, **In-person session**, **File / handout**, or **Embedded page**. You can also just tap an element to add it.
3. Tap a lesson to edit it. Changes save automatically, one update at a time. Wait for **Saved** before you leave. If you see **Not saved — retry**, tap it and keep the lesson open until the save succeeds. **Done**, course links, and **Play** wait for pending lesson changes before they close or navigate.
4. Drag modules or lessons to change their order. If the course header shows **Order not saved — retry**, tap it before you leave.
5. Use **Preview as learner** to see the course as a worker sees it. **Play** presents the whole course full-screen.

Use the **Completion** menu to decide how a lesson is finished. For **Minimum time**, enter **Minimum time (min)**. The timer starts when the worker opens the lesson, and BeaconHS will not mark it complete early.

**Embedded page** and **Video URL** lessons accept credential-free HTTPS links to external public sites. Links cannot point back to BeaconHS or the document editor. YouTube and Vimeo links are converted to their official players. Other embedded pages run without forms, pop-ups, or top-window navigation; some providers still refuse to be embedded. Use **Preview as learner** and choose an uploaded file when a provider does not work in the frame.

## Reuse material from the Content Library

Open **Training → Content Library** to create material that can be reused in more than one course. Open a text item, write and format it with the rich-text toolbar, then tap **Save content**. In a course lesson, choose that library item under **Reuse library item**.

The **Reuse library item**, **Assessment**, and **Scheduled class** fields search the full tenant catalogue as you type. On the course rail, **Records**, **Classes**, and **Files** each have their own search, relevant filters, order, and **Next** / **Prev** controls. These controls cover the complete history even when a course has years of records.

## Run a classroom (present the content)

For instructor-led courses, BeaconHS is the screen you run the class from. Build the deck, quizzes, and practical once on the course, then present it to the room.

1. Open the class from **Training → Classes** (or schedule a new one).
2. Tap **Present content** in the top corner. The course opens full-screen, ready to project.
3. Move through it with the arrow keys, the on-screen arrows, or by clicking the left/right edges. Slideshows advance one slide at a time, then flow straight into the next element.
4. When you reach a **Quiz**, the screen shows an assessment title card — the question count and pass mark, with instructions for learners to complete it on their own device. It does not show the answers to the room. Tap **Show questions** if you want to review them together afterwards.
5. A **Practical exam** shows the brief and the sign-off criteria so you can run and mark it.
6. Press **Esc** or tap the **✕** to return to the class.

Presenting never changes anyone's records. When the class is done, issue records on the **Completion** tab (below).

## Schedule and complete a class

1. Open **Training → Classes** and select **Schedule new class**.
2. On **Details**, choose the course, times, site, instructor, and maximum attendance.
3. Open **Roster**. Search the existing roster or use **Add a person to the roster…** to search active workers by name, employee number, job title, or email. If the picker says more results exist, add more detail to the search. Select the worker and choose **Add**.
4. Open **Completion** after the class. Search the roster and review attendance, grade, and pass state for every person on the current page.
5. Choose **Save this page** before moving to another page. The reviewed count shows how many people remain.
6. When everyone is reviewed, choose **Mark class complete**. BeaconHS locks the class and issues a training record for each person marked as passed.

A person marked as a no-show cannot pass. A cancelled class is read-only; choose **Reopen class** before changing details, the roster, or completion decisions. A completed class stays locked so its issued records cannot drift.

## Enroll learners for sign-off

Classroom and on-the-job courses are not self-started — workers see them in [My training](/my/training) only once you enroll them.

1. Open the course and tap **Evaluations**.
2. Pick a person under **Enroll a learner…** and tap **Enroll**.
3. The learner appears in the sign-off grid. Tap a cell to evaluate them against the practical's criteria, with a signature.

Only an **In progress** enrollment can be evaluated. Finished, expired, or withdrawn enrollments stay available for review, but their sign-offs are read-only.

## Tips

- A self-paced course only appears in workers' course lists once it has at least one module of content.
- Pick which certificate designs a course issues under **Credential designs** in Overview.
- Slideshow lessons can import PowerPoint files — see [Course slideshows & PowerPoint](/help/training-slideshows).`,
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
    body: `Every slideshow is a real PowerPoint file. Import a deck you already have, or start a blank one. BeaconHS opens that same .pptx in PowerPoint-compatible editing and presentation modes. It does not turn the deck into PDFs or slide images.

## Where to find it

Open **Training** in the left menu, then **Courses**. Open a course, add or open a lesson, and set its type to **Slideshow**. Reusable decks live in the **Content Library** the same way.

## Start a deck

1. Open a slideshow lesson. A new deck offers two choices.
2. **Import PowerPoint** — drop in a .pptx file that is 1 GiB (1,024 MiB) or smaller. It becomes the deck's working copy, with speaker notes carried over.
3. **Start blank** — creates a new empty PowerPoint deck.
4. The PowerPoint editor opens the file directly. There is no conversion wait.

## Edit the deck

1. Open the slideshow lesson. The PowerPoint editor opens right in the page, with the file name in the toolbar.
2. Make your changes — text, slides, images, layouts, anything. Changes save automatically.
3. Authors, instructors, and learners all open the saved .pptx directly.

If the page says PowerPoint editing or playback is unavailable, ask your administrator to restore the Collabora server. There is no image or PDF playback fallback.

If the page says the workspace is unavailable, a platform administrator must restore the workspace before the editor can open or save the file.

The editor is also blocked while an administrator is using **View as user**. Exit that session and open the deck as yourself.

## Download the PowerPoint

Click **Download** in the deck toolbar to save the current file, including every edit made in the browser.

## Replace the file

Click **Replace** and drop in a different .pptx. It immediately becomes the deck's working copy.

## Present the deck

Tap **Present** in the slideshow editor, **Play** in the course, or **Present content** on a class. Self-paced learners get the same PowerPoint playback in their lesson. Animations, builds, transitions, timings, links, audio, and video run inside the PowerPoint engine.

Use PowerPoint's own controls inside the presentation to move through the deck. In course or class presentation mode, use the BeaconHS controls below the presentation to move to the next course element.

## Tips

- Keep one person editing a deck at a time. The editor supports more, but training content rarely needs two authors at once.
- Large decks can take longer to open because the PowerPoint engine loads the original file.
- Keep embedded media available to the browser and test it before the class.
- Use **Present** to rehearse the same playback learners and instructors receive.`,
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

The same tab shows everyone who has signed. Use **Search people or sessions**, **Source**, and **Order** to find an individual acknowledgment or a group sign-off. Use **Next** and **Prev** to move through the complete history.

## Document books

A book bundles related documents into one big PDF — for example, a full safety manual.

1. Go to [Document books](/documents/books).
2. Search or browse the cards. Each card shows how many documents are inside.
3. Tap **View PDF** to read the whole book.

Published books are fixed to the exact document versions approved when the book was published. A newer document version does not change an already published book.

${CSV_EXPORT_LIMIT_GUIDANCE}

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
      'ai',
      'assistant',
    ],
    requiredPermission: 'documents.manage',
    body: `Documents are Word files. You write them in a full Word editor right inside BeaconHS, and readers always see a numbered, published PDF that looks identical on every device and on paper.

## Start a document

1. Open [Documents](/documents) and click **New document** — a draft opens right away.
2. On the **Write** tab, pick **Import Word file** (drop in a .docx) or **Start blank**. Set the title and details in the panel on the left.
3. The file becomes the working draft. Everything you type saves automatically.

The **Key** is the document's short identifier. It can be up to 120 characters and must be unique among live documents. The save badge changes to **Not saved** and shows the reason if any detail cannot be saved.

Imported Word files must be .docx files and 100 MB or smaller.

## Edit the draft

1. Open the document's **Write** tab. The Word editor opens right in the page.
2. Page size, headers, footers, images, tables — set them in the editor, exactly like Word.
3. Use the editor's **Review** menu for track changes and comments while a document is being reviewed.
4. **Download DOCX** saves the working file; **Replace** swaps in a different Word file.

## AI assistant

If AI is set up for your company, an **AI** button appears in the Write toolbar.

1. Click **AI** to open the assistant beside the editor.
2. Ask it to draft the whole document, rewrite a section, or fix specific wording — it edits the document for you, and the editor reloads with the changes.
3. You can also just ask questions; the assistant reads the current draft before answering.
4. Use **Insert at cursor** to place a reply exactly where you are typing instead.

Changes the assistant makes save into the working draft like your own edits — nothing publishes until you click **Publish**.

After the published PDF finishes preparing, **Send email** sends that exact published version. Draft content is never emailed. Each recipient and Cc address receives a private copy.

If the editor says the workspace is unavailable, a platform administrator must restore the workspace before the editor can open or save the file.

The editor is blocked while an administrator is using **View as user**. Exit that session and open the document as yourself.

## Publish a version

1. Click **Publish** in the Write toolbar.
2. Add a short note about what changed (optional), then confirm.
3. The draft is frozen as the next whole numbered version — v1, v2, v3 — and its PDF renders in the background. Imported decimal revisions such as v1.1 stay in the history. Readers always see the latest published version; your draft stays private until the next publish.

## Version history

Open the **Versions** tab. Every published version keeps its own PDF and Word file:

- **PDF** — read or print that exact version.
- **DOCX** — download the Word snapshot.
- **Open read-only** — view the old version in the editor without changing anything.

Use **Search versions or changes**, **Status**, and **Order** to work through a long version history. The **Reviews**, **Compliance**, and **Activity** tabs have the same search, relevant filters, and **Next** / **Prev** paging, so older records stay available instead of disappearing from the page.

## Uploaded PDFs

Documents can also be plain uploaded PDFs (scanned or externally produced). Open the **PDF** tab and drop the file into the uploader — there is no editor for these; the file itself is the document. Once a PDF is in place, **Replace** in the PDF toolbar prepares a new draft version. Readers keep seeing the previous published version until you click **Publish** at the top of the page.

## Organize categories, types, and management reviews

If your role manages Documents, use the document tabs to keep the library organized:

1. Open **Categories** to arrange the library into a hierarchy. Search by category, description, or parent. Use **Level** to show top-level or nested categories, and **Usage** to find categories with or without documents. Use the searchable **Parent** picker to move a category within the hierarchy. Category names must be unique under the same parent, but different branches can reuse a name.
2. Open **Types** to manage classifications such as Policy, Procedure, SDS, and Manual. Use the search box to find a type by name, key, or description. Use **Usage** to show types that are used or unused.
3. Open **Management reviews** to record board reviews of the safety management system. Under **Documents reviewed**, add the published documents the board reviewed, then click **Save documents**. BeaconHS pins each document to its exact published version, so a later revision cannot change the historical review record. Search by review title, or use **Next review** to show reviews that have or do not have another review scheduled.

Periodic reviews on an individual document also record the exact published version. Open the document's **Reviews** tab, click **Record review**, and explicitly choose the outcome. Historical reviews whose old source did not capture an outcome are labelled **outcome not recorded** instead of being treated as approvals.

## Build and publish a document book

A document book combines approved documents into one controlled PDF.

1. Open [Document books](/documents/books) and click **New book**.
2. Add published documents under **Contents**. Draft, archived, and deleted documents are not available in the picker.
3. Drag the documents into the required order. Complete the **Settings** tab, then click **Publish book**.
4. BeaconHS checks that every document has a valid published PDF and pins the book to those exact version numbers.
5. A published book's contents, order, and settings are locked. Click **Unpublish** before making changes, then click **Publish book** again when the revised book is ready.

A document cannot be unpublished, archived, or deleted while it belongs to a published book. Unpublish the book first. A document also cannot be unpublished, archived, or deleted while an active compliance obligation requires it. Pause or delete the obligation first. These checks prevent an approved book or live requirement from silently losing its document.

## Archive or delete

- **Archive** (select documents in the list, pick **Archive**) retires a document but keeps it findable under the Archived filter. Use this for superseded documents. Unpublish any book that contains it first.
- **Delete** removes a document completely: click **Delete** on the document's page, or select documents in the list and pick **Delete**. Readers lose access and it disappears from all lists. It is removed from draft books, but a published book must be unpublished first. Version history is kept for audit.
- A document that an active compliance obligation still requires cannot be unpublished, archived, or deleted — pause or delete the obligation first.

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
      'custom fields',
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

## Record a custody change (managers)

1. Open the unit and select **Location & custody**.
2. Select **Transfer** to change its site or holder. Add a note, then select **Record transfer**. The movement is added to **Location history**.
3. Select **Check out** to issue an available unit. A **Destination site** is required; the person and expected return date are optional.
4. Select **Check in** to close the open check-out. The unit returns to the default check-in location configured for the station.

An open check-out must be checked in before you can use **Transfer** or a bulk site/holder change. This keeps the current custody and check-out history in agreement.

To update several visible units, select their checkboxes and choose **Transfer to site** or **Assign to holder** in the bulk bar. Search the site or holder field, choose the exact match, then select **Apply**. The search reads the complete current directory in small pages, so a site or person is not hidden just because the workspace is large.

## Check service and maintenance records

1. Open the unit and tap the **Log** tab. Entries are tagged by kind: **Note**, **Maintenance**, **Fuel**, **Incident**, or **Modification**.
2. The **Files** tab holds manuals, certificates, receipts, and photos for the unit.
3. The **Inspections** tab shows the inspection history and anything marked **overdue** or **due soon**.
4. Use the search boxes above **Inspection schedules** and **Reminders** to narrow long lists. Use **Prev** and **Next** to move through every match.

The **Maintenance** cockpit opens a quick preview when you select a unit. It shows up to the first 25 open reminders and gives the exact total. Select **Open full record** to search and page through every reminder.

Managers can change **Type** and **Category** on **Overview** by searching the complete tenant catalogue. On **Inspections**, **Pre-use checklist** and **Inspection type** also search the full set that applies to that unit's type. A saved inactive choice remains visible on an older unit or schedule. If the picker says more results exist, add more of the name or description.

Categories organize equipment in the register, filters, and reports. Billing rates and financial records are managed outside BeaconHS.

## Add company-specific fields (managers)

Use custom fields when your company needs an equipment detail that is not built in.

1. Open [Equipment custom fields](/equipment/custom-fields) from **Manage** → **Custom fields**.
2. Use **Search custom fields…** or **Status** to find an existing field. Select **New field** to add one.
3. Enter the label and field type. Choose **All types** or one equipment type under **Applies to type**.
4. Select **Create field**. The field appears on each matching equipment record and saves inline.

The field type is fixed after creation. Changing a field's scope, removing a choice option, or tightening a number range can remove saved values that no longer fit; BeaconHS warns you before it saves. **Delete field** permanently removes the field and every value captured under it. If a saved report or Insights Card uses the field, BeaconHS blocks **Hidden** and **Delete field** until you remove that reference.

The **Custom fields** count on [Equipment types](/equipment/types) shows definitions scoped to each type. A type cannot be deleted until its scoped custom fields are moved to another scope or deleted.

## Work orders

If your role can see them, work orders track repairs.

1. On a unit, tap the **Work orders** tab to see repairs for that unit.
2. Or open the full list at [Work orders](/equipment/work-orders).
3. Statuses run from **Open** through **In progress** and **Awaiting parts** to **Repaired**, **Verified**, and **Completed**.
4. Use **All assignees** and **All equipment types** to search the filter values used by work orders you are allowed to open. If a picker says more results exist, add more of the person's name or equipment type.

${CSV_EXPORT_LIMIT_GUIDANCE}

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
2. Scan your badge first, type your name in the scan box, or search **Active holder**. You will see **Active holder set** — that is you.
3. Search **Check-out destination** and choose where the unit is going.
4. Scan the unit's tag, or type its asset tag and tap it in the list.
5. You will see **Checked out** with the asset tag and name. The unit is now on you.

## Check a unit back in

1. Open the [station](/equipment/station).
2. Scan the unit's tag or type it in.
3. You will see **Checked in**. The unit snaps back to its home base location.

The **Scan does** setting controls what a scan means: **Toggle** flips each unit (out if it was in, in if it was out), or lock it to **Out** or **In** when you are moving a big batch one way.

## Configure the station (managers)

1. Open the station and select **Station settings**.
2. Search **Default check-in location** and choose where returned units go.
3. Under **Locations that count as “checked in”**, search or filter the location list. Use **Prev** and **Next** to move through every match. Selecting a base checkbox saves it immediately without clearing base locations on other pages.
4. Choose the scan behaviour, holder requirement, condition prompt, sound setting, and optional kiosk PIN.
5. Select **Save settings**. Base-location checkboxes are already saved separately.

## Print QR tag labels (managers)

Each unit's QR page has a **Download label PDF** button — a print-ready tag at your company's label size, made for shipping-label printers.

1. To tag many units at once, open **Equipment** → **Manage** → **Bulk QR labels**.
2. Search by asset tag or name, or use **Type** to narrow the list.
3. Pick equipment from the current page, then tap **Generate sheet**. Use **Next** to work through another page. One PDF opens with one tag per page.
4. To change what the tag looks like — size, layout, fields — open **Equipment** → **Manage** → **QR label design** and edit it like a document. Tap **Save label design** when done.

## Scan a QR label with your phone

1. Every tagged unit has a QR label. Scan it with your phone camera.
2. It opens the station with that unit already loaded — then check it in or out as usual.
3. On the station page itself, you can also tap the camera button (**Scan with camera**) and point your phone at a tag.

## Use the mounted tablet kiosk

Some yards run a tablet at the door in kiosk mode.

1. Walk up to the tablet. If it is locked, enter the yard PIN and tap **Unlock kiosk**.
2. Scan your badge or search **Active holder**.
3. Search **Check-out destination**, then scan your units — the same check-out steps as above.

The kiosk locks automatically when the workspace is suspended or archived. Ask a platform administrator to restore the workspace before using it again.

## Tips

- Made a mistake? Tap **Undo** next to the entry in the **This session** list.
- Not sure who has a unit? Look it up — see [Equipment](/help/equipment).`,
  },
  {
    slug: 'equipment-inspections',
    title: 'Equipment inspections',
    group: 'Equipment & PPE',
    iconKey: 'clipboard-check',
    requiredPermission: 'equipment.read.self',
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
4. Go through each required item and tap **Pass**, **Fail**, or **N/A**. An item marked **Optional** may be left blank.
5. Your answers save as you go — watch for **Saved** at the top. You can stop and come back later; the inspection stays **In progress**.

## Record a failed item

1. Tap **Fail** on the item.
2. Set the **Severity**: **Low**, **Medium**, **High**, or **Critical**.
3. Fill in **What's wrong?** with a short note, and **Action taken** if you did something about it.
4. Add a photo if the item asks for one. The app will not let you submit until required comments and photos are filled in.

## Submit the inspection

1. If **Pass all remaining** is shown and everything left is fine, tap it to fill in the remaining pass/fail items. Some inspection types turn this shortcut off.
2. Tap **Submit**.
3. The result shows as **pass** or **fail** in the list. Failed items can spawn a work order automatically, so the shop sees the defect without a phone call. A small **Work order** tag appears on the failed item when that happens.

Imported or inspection-level evidence appears under **Record photos**. Photos added to a checklist item stay on that item and are also available to the submitted-inspection email flow.

## Reopen an inspection

If you have permission to perform equipment inspections, open a submitted or closed inspection and tap **Reopen**. The inspection returns to **In progress**, clears its old submission and closure stamps, and recalculates its result when you submit it again.

## Automatic emails and alerts (managers)

If you manage equipment, submitted inspections can send emails on their own — for example, the result (with a PDF copy) to the shop.

1. Open the Manage hub at [Equipment manage](/equipment/manage) and tap **Inspection automations**.
2. Add the **A record is submitted** trigger.
3. Connect actions like **Send email**, **Notify role**, or **Create CAPA**.
4. Turn the flow on. It runs every time an inspection is submitted.

## Tips

- Use the **Status** chips on the list — **All**, **Draft**, **In progress**, **Submitted**, or **Closed** — to find an inspection you started earlier.
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
      'custom fields',
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

Items marked **Discarded** or **Expired** are historical records. They cannot be inspected or issued again.

1. Open the item and tap the **Inspections** tab.
2. Tap **Pre-use** for a quick check, or **Annual** for the full periodic inspection.
3. Answer every criterion: **Pass**, **Fail**, or **N/A**.
4. If a criterion fails, describe what is wrong in **What failed?**.
5. Add **Photo evidence** wherever it is required. You can also add optional photos to another answered criterion.
6. Add anything worth flagging overall in the **Notes** box.
7. Tap **Record inspection**. If something failed, the button reads **Record failed inspection** — that is fine, record it honestly.

The result is worked out from your answers. An all-**N/A** checklist stays **N/A** instead of being shown as a pass. A high-severity failure automatically opens a corrective action, so it gets dealt with.

To review the evidence later, open the **Inspections** tab and tap **View checklist** below the inspection. The inspector name, saved question, answer, failure reason, severity, and photos stay with that historical inspection even if the PPE checklist or user account changes later.

## Report damaged gear

Frayed strap, cracked shell, missing buckle — report it as soon as you spot it.

1. Open the item and tap the **Issues** tab.
2. Tap **Report defect**.
3. Describe the problem in the **What's wrong?** box.
4. Tap **Report defect** to log it. Open reports stay visible until someone resolves them. Stop using the item until you are told it is safe.

The issue list shows each report's **Source**. A manual report is labelled **manual**. A defect imported from an inspection keeps its exact source inspection in the record and in generated PDFs.

## Add company-specific fields (managers)

1. Open [PPE custom fields](/ppe/custom-fields) from **Manage** → **Custom fields**.
2. Use **Search custom fields…** or **Status** to find a field. Select **New field** to add one.
3. Enter the label and field type. Choose **All types** or one PPE type under **Applies to type**.
4. Select **Create field**. The field appears on each matching PPE record and saves inline.

The field type is fixed after creation. Changing a field's scope, removing a choice option, or tightening a number range can remove saved values that no longer fit; BeaconHS warns you before it saves. **Delete field** permanently removes the field and every value captured under it. If a saved report or Insights Card uses the field, BeaconHS blocks **Hidden** and **Delete field** until you remove that reference.

The **Custom fields** count on [PPE types](/ppe/types) shows definitions scoped to each type. A type cannot be deleted until its scoped custom fields are moved to another scope or deleted.

## Return an item

When you leave a site or swap out gear, hand the item back to your supervisor or whoever issued it. They will mark it **Returned** in the system, and the **History** tab on the item keeps the record.

## Automatic emails and alerts (managers)

If you manage PPE, recorded inspections can send emails on their own — for example, a failed harness check straight to the safety manager. Email and PDF templates can include the saved checklist and inspection photos.

1. Open the Manage hub at [PPE manage](/ppe/manage) and tap **Automations**.
2. Add the **A record is submitted** trigger.
3. Connect actions like **Send email**, **Notify role**, or **Create CAPA**.
4. Turn the flow on. It runs every time an inspection is recorded on any item.

${CSV_EXPORT_LIMIT_GUIDANCE}

## Tips

- **Next inspection** on the list shows what is coming due — do not let your harness inspection lapse.
- Certificates from third-party recertifications (like annual fall-arrest inspections) live on the item's **Certificates** tab.`,
  },
]
