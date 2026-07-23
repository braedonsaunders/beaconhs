// Manual articles: "Oversight & reports" + "Administration" groups.
// Written for supervisors and office staff, but kept plain-language.

import type { ManualArticle } from '../types'
import { CSV_EXPORT_LIMIT_GUIDANCE } from './_shared'

export const OVERSIGHT_ADMIN_ARTICLES: ManualArticle[] = [
  {
    slug: 'people',
    title: 'People directory',
    group: 'Oversight & reports',
    iconKey: 'users',
    summary: 'Find anyone in your company, manage departments, and view the org chart.',
    keywords: [
      'people',
      'directory',
      'employees',
      'workers',
      'departments',
      'org chart',
      'reporting structure',
      'crew',
      'job title',
      'primary title',
      'held titles',
      'hire date',
      'id badge',
      'badge',
      'transcript qr',
      'custom fields',
    ],
    body: `The People directory lists everyone in your company — workers, contractors, and supervisors.

## What this is for

People power almost everything else in the app. Training records, compliance, PPE, and incidents all point back to a person here. Keeping this list correct keeps the rest of the app correct.

## Where to find it

Open [People](/people) from the sidebar.

## Find a person

1. Open [People](/people).
2. Type a name, employee number, or job title in the **Search by name, employee #, or job title** box.
3. Use the **Status** filter to switch between **Active**, **Inactive**, **Terminated**, or **All**. The list shows active people by default.
4. Click a person to open their page. Tabs like **Overview**, **Compliance**, **Transcript**, and **PPE** show everything about them in one place.

## Add a person

1. Open [People](/people).
2. Click **Add person**.
3. Fill in their name, employee number, **Primary job title**, department, and hire date.
4. Click **Create person**. They now show up in pickers across the app.

## Job titles

**Primary job title** is the one shown in the directory, org chart, reports, and people pickers. **Held titles** can include extra duties, such as a carpenter who also acts as a relief foreman.

1. Open the person's **Overview** tab.
2. Under **Employment**, choose their **Primary job title**.
3. Under **Groups & titles**, use **Held titles** to add or remove any other titles they hold.

Changing the primary title also adds it to **Held titles**. Removing the current primary automatically promotes one of the remaining held titles. For a synced person, job titles are read-only here; update them in the source system.

To manage the title catalogue, open [Job titles](/people/titles) under **Manage people**. Use the **Status** filter to find active or archived titles.

- **Archive** keeps the title and its history but removes it from new selections. BeaconHS blocks archiving while the title still has current or historical person assignments, active tasks, or active compliance obligations. Remove or archive those dependencies first.
- Open an archived title and click **Restore** to make it available again.
- Open **Tasks** on a title to search, reorder, archive, or restore its job-description tasks. After anyone acknowledges a task, its wording is locked. Archive it and add a replacement instead of changing text that was already signed.

## Departments

Each person belongs to one department. Departments are used for grouping, compliance audiences, the training matrix, and reports.

1. Open [Departments](/people/departments).
2. Click **Add department** to create one, or search the list to edit one.

## Add company-specific fields (managers)

1. Open [People custom fields](/people/custom-fields) from **Manage people** → **Custom fields**.
2. Use **Search custom fields…** or **Status** to find a field. Select **New field** to add one.
3. Enter the label and field type, then select **Create field**. The field appears on each person's page and saves inline.

The field type is fixed after creation. Removing a choice option or tightening a number range can clear saved values that no longer fit; BeaconHS warns you before it saves. **Delete field** permanently removes the field and every value captured under it. If a saved report or Insights Card uses the field, BeaconHS blocks **Hidden** and **Delete field** until you remove that reference.

## Org chart

The org chart shows who reports to whom. It is built from the manager set on each person.

1. Open [Org chart](/people/org-chart).
2. Click a person to focus on their part of the tree.
3. To change the chart, edit the person and change who they report to.

## ID badges

Every person can have a printed ID badge — a wallet-size card with their photo, name, and a QR code. Scanning the QR opens a public page with their live training record: what is valid, what is expiring, and what has expired. The page always shows current information while the workspace is active, so a printed badge never goes stale. If the workspace is suspended or archived, the live badge page stops showing company data. Individual certificate QR codes still verify the credential's lasting record.

To print a badge:

1. Open the person's page.
2. Flip the **ID badge preview** to check both saved sides.
3. Click **ID badge** to open a print-ready PDF with the front and back of the card.
4. If the design uses a direct-print provider, click its **Print with…** button to send the finished 300-DPI faces to the tenant-configured card printer. BeaconHS supports cardPresso, Zebra, Evolis, and HID FARGO and audits every accepted job.

To change how badges look:

1. Open [ID badge design](/people/badges/design) from **Manage people**.
2. Move, restyle, or add elements on the front and back. Click **Save badge design**.
3. New prints use the new design right away.

${CSV_EXPORT_LIMIT_GUIDANCE}

## Tips

- Some companies sync people from another system. Synced fields show as read-only and cannot be edited here. If a locked field is wrong, fix it in the source system and it will update on the next sync.
- Overdue training and other requirements for one person live on their **Compliance** tab. For the whole company, see [Managing compliance](/help/compliance-management).`,
  },
  {
    slug: 'locations',
    title: 'Locations',
    group: 'Oversight & reports',
    iconKey: 'pin',
    summary: 'Set up your customers, projects, and sites so records land in the right place.',
    keywords: [
      'locations',
      'sites',
      'projects',
      'jobsite',
      'org units',
      'customers',
      'site contacts',
      'areas',
      'custom fields',
    ],
    body: `Locations describe where your work happens: customers at the top, then projects, then sites.

## What this is for

Almost every record in the app — incidents, inspections, forms — asks for a site. Picking the right site is what makes reports, dashboards, and compliance views line up by location. If your locations are set up well, everything else sorts itself.

## Where to find it

Open [Locations](/locations) from the sidebar.

## Add a location

1. Open [Locations](/locations).
2. Click **Add location**.
3. Enter the location name, an optional code, and the mailing address.
4. Click **Create location**.

Locations sit at the top of the tree. You add projects and sites underneath from the location's detail page.

## Add projects and sites under a location

1. Open the location from the list.
2. On the **Projects** tab, click **Add project**.
3. Open a project and add sites under it the same way.
4. Use the **Contacts** tab to add on-site contacts, like a client rep or a site manager who does not work for you.

## Add company-specific fields (managers)

1. Open [Location custom fields](/locations/custom-fields) from **Manage locations** → **Custom fields**.
2. Use **Search custom fields…** or **Status** to find a field. Select **New field** to add one.
3. Enter the label and field type, then select **Create field**. The field appears on each location page and saves inline.

The field type is fixed after creation. Removing a choice option or tightening a number range can clear saved values that no longer fit; BeaconHS warns you before it saves. **Delete field** permanently removes the field and every value captured under it. If a saved report or Insights Card uses the field, BeaconHS blocks **Hidden** and **Delete field** until you remove that reference.

## What picking a site on a record means

When someone fills out a form or reports an incident, they pick a site. That choice controls:

- Which location's tabs the record shows up on (each location page has **Incidents** and **Equipment** tabs).
- How reports and dashboards group results by site or project.
- Who gets notified, when notifications are set up by location.

Tell your crews which site to pick for each job. A record filed against the wrong site is easy to miss later.

## See the whole tree at once

The list page shows locations with their projects and sites. For one flat, searchable list of every level — customer, project, site, and area — open [Org units](/locations/units) and use the **Level** filter.

${CSV_EXPORT_LIMIT_GUIDANCE}

## Tips

- Use the **Status** filter to show **Archived** locations. Archive a finished job from its location page instead of deleting it, so old records keep their history.`,
  },
  {
    slug: 'reports',
    title: 'Reports',
    group: 'Oversight & reports',
    iconKey: 'file',
    summary: 'Preview print-ready reports, export them, and schedule email delivery.',
    keywords: [
      'reports',
      'export',
      'pdf',
      'csv',
      'excel',
      'schedule',
      'email report',
      'subscribe',
      'print preview',
      'page setup',
    ],
    body: `Reports turn your records into print-ready documents you can preview, export, and email on a schedule.

## What this is for

Use Reports when you need a document: a weekly incident summary for a meeting, a training list for an audit, or a monthly PDF sent to a manager. For live on-screen charts, use [Insights dashboards](/help/insights) instead.

## Where to find it

Open [Reports](/reports) from the sidebar. It has two tabs: **Reports** and **Schedules**.

## Run a report

1. The list on the left shows built-in reports and any custom ones your team made. Custom reports show a small **custom** badge.
2. Use **Search reports…** or the **Kind** and **Category** filters to narrow the list.
3. Click a report. The right side shows the printed pages, exactly as the PDF will look.
4. Click **Open** to see the full document. Use the day-range buttons (like **30 days**) to change how far back the report looks.
5. On a training certificate, expired, or missing report, open **Report filters**. Choose any employees, people groups, departments, courses, course types, or delivery types. Choose **Group by** → **Course** or **Employee**, then click **Apply**. Leaving a choice empty includes all records.

The **Training — Expired & Upcoming** report also lets you choose an expiry window from 30 to 365 days. **Training — Certificates** can include or exclude expired certificates. **Training — Missing** only shows courses assigned to each employee through compliance requirements; it does not treat every course in the catalogue as required.

The legacy-parity reports have filters that match their subject. Skills reports filter by employee, group, department, skill, and issuing authority. The CWB report also filters by standard. Corrective actions filter by owner, department, group, location, and status. PPE reports filter by holder, department, group, and PPE type. Compliance and Hazard ID reports filter by employee, group, department, status, and date; compliance reports can also filter requirements and source modules.

On a phone, the list fills the screen; picking a report opens its preview, and **All reports** takes you back.

The built-in catalogue includes the former BeaconHS reports for training certificates, missing and expired training, skill matrices, missing and expired skills, CWB qualifications, corrective actions, journals, inspections, operational equipment, vehicle logs, and PPE. Use **Compliance — By Entity** for one or more requirements, **Compliance — By Person** for a worker's requirements across modules, and **Hazard ID — Signatures** for hazard-assessment signature compliance. The old training certificate matrix is now the live **Training — Certificate Matrix** card in Insights, so it is not duplicated in Reports. Equipment charges and ROI are intentionally excluded because equipment financials are outside BeaconHS.

## Export a report

1. Select or open the report.
2. Set any report filters first, then click **CSV**, **Excel**, or **PDF**.
3. The file downloads. The PDF matches the preview page-for-page; CSV and Excel are best for working with the numbers.

You can also click **Email PDF** on the full report to send it right away instead of downloading it.

## Schedule a report by email

Schedules send a report as a PDF email on a repeating schedule, so nobody has to remember to run it.

1. On any report, click **Subscribe**. Or open the **Schedules** tab and click **New schedule**.
2. Pick the report and give the schedule a name.
3. Under **Delivery**, set the **Cadence** (**Daily**, **Weekly**, or **Monthly**), **Repeat every**, the day, and the time. Monthly schedules can use a calendar date or a weekday pattern such as the first Monday.
4. Add an optional **Start date** or **End date** when the delivery must run only for a fixed period.
5. For any report with **Report filters**, choose the records and grouping the schedule should use. A schedule created from an already-filtered report carries those choices in automatically.
6. Under **Recipients**, add team members, or type outside email addresses under **Additional email addresses**.
7. Under **Email copy**, enter an optional subject or message. Leave them blank to use the standard report email.
8. Click **Create schedule**.

The schedule runs with the current access of the member and active role that created or last edited it. If that membership is suspended, the role is removed, or access to a Builder app is revoked, the run fails without exposing that app's records. Edit and save the schedule to claim it under your current role.

The **Schedules** tab shows every schedule with its next run and last run. Use **Search schedules and reports…** to find one by schedule or report name, and use the **Status** filter to show active or paused schedules. Use the pause button to stop one without deleting it.

Open a schedule to see **Run history**. Search by date, status, or trigger, or use **Status** to show queued, running, succeeded, or failed runs. Use **Next** and **Prev** to move through older deliveries.

## Build your own report

If no built-in report fits, click **New report** to build a custom one. You can also open a built-in report and click **Edit a copy** to start from something close.

The builder shows a live print preview while you work. Builder apps you can currently open appear in the **Data source** list by their own names — pick one to report on its submissions. Draft, archived, and role-restricted apps you cannot open stay out of the list and cannot be queried from a saved report. Under **Page setup** you can pick the paper size (**Letter**, **A4**, or **Legal**), switch between **Portrait** and **Landscape**, set the page margin, choose **Compact** to fit more rows per page, and turn the **Summary cards** band on or off — the preview and every export follow it.

On the full report, subscriptions, past runs, and report details live on the **Schedules & activity** tab.`,
  },
  {
    slug: 'insights',
    title: 'Insights dashboards',
    group: 'Oversight & reports',
    iconKey: 'gauge',
    summary: 'Build live dashboards with cards and charts, and ask AI to build charts for you.',
    keywords: [
      'insights',
      'dashboards',
      'charts',
      'cards',
      'analytics',
      'kpi',
      'metrics',
      'ask ai',
      'graphs',
    ],
    body: `Insights is where you watch your numbers live: dashboards made of cards and charts that update as records come in.

## What this is for

Insights answers "how are we doing right now?" — incidents by month, open actions by site, training completion by department. It is the screen you keep open. You can also save any individual card as a current PDF snapshot.

One rule to remember: **Reports are scheduled documents, Insights are live dashboards.** Use [Reports](/help/reports) for a designed report or scheduled email. Use a card's PDF export when you need a quick snapshot of its current data.

## Where to find it

Open [Insights](/insights) from the sidebar. Your dashboards appear as tabs across the top.

## View a dashboard

1. Open [Insights](/insights).
2. Click a dashboard tab. Cards and charts load with current data.
3. If the dashboard has filters, use the filter bar above the grid to narrow by things like site or date.

## Build a card by asking a question

A card is one saved chart or table. The fastest way to build one is to describe it.

1. Open the [Library](/insights/library) and click **New card**.
2. Enter the **Card name**. Add the optional **Description** when people need more context in the Insights library.
3. In the **Ask AI** box, type what you want in plain words — for example, incidents by month this year.
4. Click **Ask AI**. It sets up the data and chart for you.
5. Adjust anything in the side panel (data, filters, grouping, chart type), then click **Save card**.

You can also build a card by hand using the same side panel, without asking AI. The data-source list only includes Builder apps you can currently open. If an app is a draft, archived, or restricted to another active role, its records cannot be used by your cards.

For a custom grouping or measure, open **ƒ Fields & functions**. If the data source has many columns, type a field or related-table name in **Search fields or related tables…**. The search covers the complete available schema; no field is dropped after the first page of columns.

## Open the training certificate matrix

The live **Training — Certificate Matrix** is the one canonical training matrix. It replaces the old flat report.

1. Open the [Library](/insights/library).
2. Search for **Training — Certificate Matrix** and open it.
3. Employees are the rows, courses are the columns, and each cell shows the latest certificate status.
4. To put it on a dashboard, open that dashboard, click **Customise**, then **Add content** and choose the matrix card.

A person who has no record for a course has a blank cell. The matrix does not add an empty **None** course column. Use **Download CSV** or **PDF** on the card when you need a snapshot.

## Save a card as PDF

You need data-export permission to download card data.

1. Open the [Library](/insights/library).
2. Click the PDF icon on a card, or open the card and click **PDF**.
3. BeaconHS downloads a branded snapshot using the card's current data. Wide matrices continue in readable column sections.

Use **Download CSV** on the open card when you need the same live data in a spreadsheet. Exporting an AI card runs its saved analysis and puts the summary and key points in the PDF.

## Build or change a dashboard

1. On a dashboard, click **Customise**.
2. Click **Add content** to open the card library, then place cards on the grid.
3. Drag and resize cards until the layout works.
4. Click **Save**, then **Done**.

## Share dashboards

Click **Publish** while customising to share a dashboard with your team. Others find shared dashboards in the [Library](/insights/library) under the **Dashboards** tab and can pin one to add it as a tab of their own.`,
  },
  {
    slug: 'compliance-management',
    title: 'Managing compliance',
    group: 'Oversight & reports',
    iconKey: 'check',
    summary: 'Set up obligations, see who is overdue, and keep the whole company compliant.',
    keywords: [
      'compliance',
      'obligations',
      'overdue',
      'due',
      'expiring',
      'training requirements',
      'acknowledgement',
      'certifications',
      'assign',
      'audience',
    ],
    requiredPermission: 'compliance.read',
    body: `The Compliance hub is the org-wide view of every requirement: who must do what, by when, and who is behind.

## What this is for

An obligation is a rule like "everyone in the Field department completes fall protection training" or "all supervisors acknowledge the new safety policy." The hub tracks each rule against each person and shows you the gaps.

## Where to find it

Open [Compliance](/compliance) from the sidebar. The tabs are **Overview**, **Obligations**, **By person**, **Aging**, **Due & expiring**, and **Mine**.

The **Overview** tab shows the big picture: total obligations, subjects tracked, overdue and expiring counts, and overall compliance.

## Create an obligation

1. Open the **Obligations** tab and click **New obligation**. The creation flyout opens without leaving the list.
2. Pick the **Kind**. Common kinds include **Training / assessment**, **Document acknowledgement**, **App (scheduled)** for a form people must fill on a cadence, **Certification requirement**, and **Inspection**.
3. Fill in the title and what to require for that kind — for example, which course or which document.
4. Pick the audience: specific people, a role, a department, a site, or everyone.
5. For a recurring item, choose the **Cadence**. Inspections, journals, and hazard assessments also have **Quantity per period** and **Compliant threshold (%)**. Leave **Cron override (optional)** blank for the standard cadence time. For an inspection or scheduled app, **Due offset (minutes after fire)** moves the deadline later without changing when the next period starts.
6. Click **Create obligation**.

The system then tracks every person in the audience and creates their tasks automatically.

Recurring periods use the compliance scan timezone under **Admin** → **Notifications**. A schedule must fire once in each selected cadence period. The current period stays visible until the next scheduled fire, so an overdue weekly item does not disappear at midnight before the new week actually starts.

## See who is overdue

1. Open the **Due & expiring** tab. The cards at the top show **Overdue**, **Expired**, **Due soon (30d)**, and **Open tasks**. Search by item or person, filter by **Status** or **Module**, and click a heading to sort the list. Certifications only count for active people — someone marked inactive or terminated in People drops off this list. Only the newest certificate per person and course counts: once someone is retrained, their older certificate for that course stops showing as expired.
2. Open the **Aging** tab to see how long items have been overdue, grouped into 0–7 days, 7–30 days, and 30+ days. Start with the oldest.
3. Open the **By person** tab and pick a person to see every requirement on their plate. Search the selected person's obligations or filter them by **Status** and **Kind**. Open an obligation to search and filter its resolved subjects.

## Tips

- Each person's own view lives on the **Mine** tab and on their profile, so they can see the same list you see.
- Requiring people to fill a custom form is also done here — see [Builder (custom forms & apps)](/help/builder) for how the two connect.
- A setup record used by an active obligation cannot be deleted, deactivated, or unpublished. Turn off or delete the obligation first, then retire the inspection type, assessment, document, equipment type, or PPE type.
- Turning an obligation off keeps its history. Edit the obligation and disable it instead of deleting it.`,
  },
  {
    slug: 'builder',
    title: 'Builder (custom forms & apps)',
    group: 'Administration',
    iconKey: 'clipboard-check',
    summary:
      'Create your own forms and apps, publish them, assign them, and automate what happens after.',
    keywords: [
      'builder',
      'forms',
      'apps',
      'templates',
      'designer',
      'publish',
      'flows',
      'automations',
      'responses',
      'checklists',
      'wizards',
    ],
    requiredPermission: 'forms.template.read',
    body: `Builder lets you create your own forms, checklists, wizards, and mini-apps — no developer needed.

## What this is for

When the built-in modules do not cover something — a site orientation form, a vehicle checklist, an equipment register — build it here. You design the form, publish it, decide who must fill it, and automate what happens when they do.

## Where to find it

Open [Builder](/apps) from the sidebar. People who can build templates see every live app, including **published**, **draft**, and **archived** apps. Everyone else sees only published apps allowed for the role they are currently using.

## Create and publish a form

1. Open [Builder](/apps) and click **New app**.
2. Choose one app structure or ready-made starting point, enter the **App name**, then click **Create app**. There is one creation action for every starting point.
3. In the designer, open the **Build** tab. Under **Add an element**, drag a field onto the exact section where it belongs. The section highlights before you drop. You can also select a section and click the field to add it there.
4. Click a field to set its label, whether it is required, and any logic.
5. Use the other tabs — **Record behaviour**, **Records list**, **Record actions**, and **Access** — to control how records act and who can open them. On **Access**, leave the role list open for everyone or choose the exact roles that may find and use the app.
6. When it is ready, click **Publish v1**. Until you publish, only builders can preview, edit, or inspect its records. A draft cannot accept live entries.

The language picker in the designer toolbar controls which translation you are editing. Add field labels, help text, section titles, option labels, and workflow step titles for each enabled workspace language. The canvas and preview show the selected language. Workers see their own language when a translation exists, then the workspace default when it does not.

Use **Risk matrix** when a response needs a scored likelihood-and-severity rating based on the workspace risk matrix. Use **Rating grid** for an ordinary set of choice rows; it does not add a compliance score.

Under **Data**, a **Lookup** searches its full data source as the worker types. **Results per search** controls the size of each result set. A **Data table** has its own search and pages; **Rows per page** controls each page. For a grouped **Metric**, **Groups shown** limits only the chart. Counts, sums, averages, minimums, and maximums always use every matching record the worker is allowed to see.

**Photo + AI analysis** stores the review for the exact attached photos. Replacing, adding, removing, or reordering a photo clears the old review. **Photo + markup** uses one photo at a time and clears its numbered markers when that photo changes.

For a text field that must follow a fixed code format, open its validation settings and use **Fixed-format pattern**. Start the pattern with **^**, end it with **$**, and use exact repeats such as **{2}** or **{4}**. The designer rejects variable repeats and alternate branches so a saved pattern cannot slow down form submission.

Publishing again later creates the next version. Old submissions keep the version they were filled on.

## Build or edit with AI

If AI is enabled and you have permission to use it, click **AI** in the designer.

1. Describe the form or change you want, then send the message.
2. Review the assistant's proposed form and click **Apply to builder**. Nothing is published by the assistant.
3. Click **History** to reopen a saved chat. Use **Search chats** and **Load more** to find older chats.
4. In a long chat, click **Load older messages** to read earlier messages.
5. Review the applied draft in the designer, then click **Publish** only when it is ready.

If a person has several roles and switches roles in BeaconHS, the app gallery, pinned apps, records, and form links immediately follow the role they are acting under. A template builder can still open every app to maintain it, but can only create a live entry after the app is published.

Builders can review records belonging to a draft or archived app, but those records are read-only. Publish the app before testing live entry, workflow, comment, monitoring, or record-action behaviour.

When you fill a published app, watch for **Saved** at the top. You can leave and resume the entry from **In progress**. If the same draft was changed in another tab, BeaconHS stops the older tab from overwriting it and asks you to refresh before continuing.

The first publish also generates the app's **PDF template** — the document its record downloads and flow attachments use. Admins can restyle it (or generate one for an older app) under **Admin → PDF templates**.

## Assign the form to people

Filling a form on a schedule is tracked by the compliance engine.

1. In the designer, open the **Assign** tab.
2. Click **Create an assignment**. This opens a new obligation with the form pre-selected.
3. Pick who must fill it and on what cadence, then click **Create obligation**.

Anyone with access can also open and fill the app straight from the gallery. That is an on-demand entry and does not clear a scheduled obligation. To complete a required app, open **Compliance** → **Mine** and use **Open app** on that exact obligation. See [Managing compliance](/help/compliance-management) for tracking who is behind.

## Automate with Flows

Flows run automatically when things happen on your form.

1. In the designer, switch the surface from **Build surface** to **Flows**.
2. Add a trigger, like **A record is submitted** or **A field matches a condition**.
3. Connect actions, like **Send email**, **Create CAPA**, **Notify role**, or **Export PDF**.

Rename a flow from its pencil button. Flow names can be up to 200 characters.

For **Send email**, recipients can follow the record. **The record person's manager** follows the reporting manager of the person or user in the selected field. **A People group in the record person's department** reaches only group members in the same department as the selected person field. **A contact for the record location** sends only when the selected contact belongs to the location in the selected record field. **A recipient for a matching compliance assignment** sends only when the record person is part of that assignment. These options let one flow replace separate rules for every department, project, or assignment.

To send a filled Excel form, add an **XLSX template** under **Spreadsheet attachments**. Cells containing a field marker such as \`{{site_name}}\` are replaced with the record value. Add an optional **Include only when** rule for site-specific or client-specific forms. Hazard-assessment templates can also use \`{{SIGNATURE-NAME}}\`, \`{{SIGNATURE-VALUE}}\`, and \`{{AdditionalInformation['Question text']}}\`.

**Export PDF** saves the generated file on that form response. The response list shows a **PDF** badge when it is ready. Running the action again replaces that response's previous generated file.

Use **Start another form** to choose a published target app. Each run creates one draft and carries over the source record's owner, person, and site. The quick **Record actions** panel offers only actions that are complete as soon as they are added; configure actions that need recipients, fields, statuses, or a target app on the full **Flows** surface.

Webhook actions send the record payload as JSON to a public **HTTPS** URL. BeaconHS owns the request headers, rejects local or private network destinations when you save the flow, and checks the destination again every time the flow runs.

## See the responses

Every submission lands in [Form responses](/apps/responses). Filter by app and status, open any record, or click **Export CSV** to download the list.

The [Builder gallery](/apps) is paged for large workspaces. Search app names or descriptions, filter by app type, then use **Sort** and **Direction** to change the order. Open an app to see its records. On that record list, search by record ID, subject, site, or submitter; filter by status; and click a column heading to sort. Your search, filters, sort, and page stay in the address so a shared link opens the same view.

Inside a response, use **Response** for the saved answers and workflow. If the response created corrective actions or incidents, search and filter each list under **Spawned from this response**. Use **Comments** to search the full discussion or post a new note. Use **Audit trail** to search and filter the complete change history. A monitored response also shows the complete **Check-in history**, with search, kind, order, and page controls.

## Monitor timed sessions

Set up monitoring entirely in **Flows**:

1. Connect **A record is submitted** to **Start monitored session**.
2. Set the check-in interval, grace time, optional duration, and whether a location is required.
3. Add **A monitored session is overdue** as another trigger.
4. Connect it to **Notify role** or another real escalation action.

Open [Monitored sessions](/apps/sessions) to review every timed Builder session you are allowed to see. Search by worker or app, filter by status, and sort the table. An overdue next check-in is shown in red. Open the worker's row to review the live session record.

## Review person transcripts

Reviewers can open [Form transcripts](/apps/transcripts) to find a person and see every form they participated in or signed. Search and sort the people list, then open a person. Their transcript can be searched, filtered by record status, sorted, and paged without changing the all-time summary above it.`,
  },
  {
    slug: 'user-access',
    title: 'Inviting users and managing access',
    group: 'Administration',
    iconKey: 'users',
    summary: 'Invite members, assign roles and scope, suspend access, and resend expired links.',
    keywords: [
      'users',
      'invite',
      'resend invite',
      'membership',
      'roles',
      'scope',
      'permissions',
      'suspend',
      'access',
      'login',
    ],
    requiredPermission: 'admin.users.manage',
    body: `The Users area controls access to this workspace. It does not let tenant administrators take over a person's global account.

## Invite a member

1. Open [Users](/admin/users).
2. Click **Invite user**.
3. Enter the person's work email and optional display name.
4. Pick an initial role and scope when needed.
5. Click **Send invite**.

The membership stays **invited** until the person opens **Accept the invitation and sign in** in their email. The one-time link expires after 15 minutes. Signing in another way does not activate it.

## Find a member or role

On **Users**, use the search box to find a name, email address, tenant display name, or assigned role. Use **Status** to show active, invited, or suspended memberships. Click a column heading to sort the current list.

On **Roles**, search by role name or description and use **Type** to show built-in or custom roles. The list shows each role's permission and active-member counts.

## Resend an expired invitation

1. Open the invited member from [Users](/admin/users).
2. Click **Resend invite**.
3. Tell the person to use the newest email within 15 minutes.

An invitation cannot reactivate a suspended member or a suspended workspace. Each workspace invitation activates only that workspace.

## Change tenant access

Open the member to manage only this workspace's settings:

- **Display name in this tenant** changes how the name appears here.
- **Person record** links the login to the right employee record.
- **Roles & scope** controls what the member can do and which records they can reach.
- **Permissions** adds a specific grant or denial when a role needs an exception.
- **Suspend member** blocks this workspace without changing the person's other workspaces.
- **Reactivate** restores a suspended membership.
- **Reset password** sends an active member a one-time reset link. Administrators never see or choose the member's password.
- **Remove from tenant** deletes this membership, its role assignments, and its overrides.

Pending invitations cannot be marked active by an administrator. The person must prove control of the invited email by using the one-time link.

A platform-level workspace suspension blocks normal member access, pending invitations, API keys, public kiosks, live badge pages, and in-browser Word or PowerPoint editing and playback. Printed individual certificate links remain available so issued credentials can still be verified.

## Account security

Members manage their own account name and password under **Account settings**. Tenant administrators can send an active member a password-reset email from the member's **Overview** tab, but cannot see or set the password. Tenant administrators also cannot change a member's sign-in email, mark their email verified, sign out all of their sessions, or grant platform super-admin access.

Platform super-admins manage global identity from **Platform → Users**. Search by name, email, or tenant and use the view filter for multi-tenant, super-admin, or unassigned accounts. Open an identity to search and filter its tenant memberships. **Platform → Tenants** has the same search, status, sorting, and page controls for workspaces. Use these areas only for platform-level work.

## Tips

- Link the correct **Person record** before assigning self-scoped work.
- Give the smallest role and scope the person needs.
- Suspend access when someone is temporarily away. Remove the membership only when its tenant-specific role history is no longer needed.`,
  },
  {
    slug: 'admin',
    title: 'Admin area',
    group: 'Administration',
    iconKey: 'settings',
    summary: 'The map of every admin tool: users, settings, notifications, integrations, and logs.',
    keywords: [
      'admin',
      'administration',
      'users',
      'roles',
      'permissions',
      'settings',
      'navigation',
      'audit log',
      'integrations',
      'api keys',
      'data export',
      'email templates',
      'direct printing',
      'cardpresso',
      'zebra',
      'evolis',
      'hid fargo',
    ],
    requiredAnyPermission: [
      'admin.users.manage',
      'admin.roles.manage',
      'admin.org.manage',
      'admin.api-keys.manage',
      'admin.settings.manage',
      'admin.audit.read',
      'admin.nav.manage',
      'admin.integrations.manage',
      'admin.data.export',
    ],
    body: `The Admin area is one page of tiles covering everything that configures your workspace. This article is a map — each tile has its own screens.

## What this is for

When you need to change how the app itself works — who can log in, what the sidebar shows, who gets alerts — the answer is almost always behind one of these tiles.

## Where to find it

Open [Admin](/admin) from the sidebar. You only see the tiles your permissions allow. The tiles are grouped into five sections.

## Organization

- **Users** — invite people, assign roles and scopes.
- **Roles & permissions** — define roles and what they grant.

## Workspace

- **Tenant settings** — branding, languages, regulatory terminology, and hierarchy. Risk matrices are configured in each module's own **Manage** area.
- **Notifications** — who gets automatic alerts and how often reminders repeat.
- **Navigation** — reorder the sidebar and pin forms as modules.
- **Data sources** — reference lists and live data your apps bind to. Search by name, key, or description and filter by **Reference** or **Live responses**. Inside a reference source, search its row values and its Builder references separately.
- **Data export** — audited CSV exports across modules and Builder apps. Search and filter the source catalogue, then sort it by name, group, or sensitivity. Builder app sources follow the role you are currently using; template builders can also export records from draft and archived apps for review.
- **Email templates** and **PDF templates** — branded emails and paper documents. PDF templates drive record downloads: every module ships with an editable default document, and each Builder app gets its own generated one the first time it is published. On the **Module print defaults** tab you pick which template each module's **PDF** button renders, and press **Generate default template** for any app that lacks one. Records without a template get a clean field-summary PDF.

## Configure direct card printing

1. Open **Admin**, then **Direct printing**.
2. Open the provider used by the Card Studio design: **cardPresso Web Print Server**, **Zebra Browser Print bridge**, **Evolis SDK bridge**, or **HID FARGO SDK bridge**.
3. Enter the tenant's HTTPS service URL and printer name. For cardPresso, also enter the WPS login, card document, image item IDs, and both credentials. For the other providers, enter the secured bridge access token.
4. Turn on **Enable this provider**, then click **Save provider**. Secrets are encrypted in the database; leave a secret box blank later to keep the stored value.
5. Open an issued ID badge, course wallet card, or external certification wallet card and use the matching **Print with…** button.

On **Notifications → Rules**, each delivery channel shows whether its provider is **Ready**, **Not set up**, or **Disabled by platform policy**. Disabled means a platform kill switch is active; it does not mean the saved credential is missing. Turn a category **Off** to stop every automatic in-app, email, push, and text alert in that category, including alerts already waiting in a queue. The **Compliance detection schedule** has an **Automatic detection** switch: turn it **Off** to pause scheduled overdue and expiring detection for the whole workspace without losing the configured schedule.

## Set workspace languages

1. Open **Admin**, then **Tenant settings**.
2. Under **Languages**, enable every language members may choose.
3. Choose the **Default language**. The default is always enabled and is used by members who choose **Use tenant default**.
4. Click **Save settings**.

Members choose their own language under **Account settings**. Their choice applies only to this workspace. If you disable a language, BeaconHS clears member choices for that language and those members return to the workspace default. Tenant-wide generated documents and group recap emails use the workspace default.

## Set the local authority and legislation

1. Open **Admin**, then **Tenant settings**.
2. Under **Regulatory terminology**, enter the authority name and abbreviation used in your jurisdiction.
3. Enter the governing legislation name and abbreviation.
4. Put any additional acts, regulations, standards, or client requirements under **Other applicable legislation**.
5. Click **Save settings**. Incident screens, regulatory notices, and compliance labels use the saved terminology.

## Build People groups

People groups are the one reusable group list across BeaconHS. The same groups are available in notification rules, Flows, role-based record access, and **Send email** dialogs.

1. Open **People**, then **Groups**.
2. Search by group name or description, or click **Add group**.
3. Open the group. Enter its name, description, and colour, then click **Save**.
4. Under **Members**, move people into the group and save the membership list.

BeaconHS blocks deletion while a People group is used by a notification rule, Flow, or role scope. Remove those references first, then delete the group.

## Integrations

- **AI**, **Email**, and **SMS** — pick a provider and store its credentials securely.
- **Integrations** — sync data in and send events out to other systems.
- **API keys** — credentials for the public REST API. Search by key name or prefix and filter by active, expired, or revoked status. Choose the smallest permissions and explicitly select every Builder app the integration may access; forms permissions alone expose no apps. After you click **Generate**, copy each highlighted secret before you dismiss it; a secret is shown only once. Write requests require an **Idempotency-Key**, and keys are rate-limited. API keys stop authenticating while the workspace is suspended or archived.

For an inbound data-sync connection, the schedule controls automatic runs only. A connection set to manual still owns the records it imported, so source-managed fields stay read-only. Use **Delete connection** only when you want those records handed back to manual management. Deleting the connection keeps the imported records; it removes the source ownership link.

## Configure AI

1. Open **Admin**, then click **AI**. Platform super-admins set the shared default under **Platform AI**.
2. Choose the **Provider** and enter its API key.
3. Choose the fast and smart models. Use **Load models** to read the provider's available model list, or enter the exact model IDs.
4. For **Custom (OpenAI-compatible)**, enter a public **HTTPS** base URL with a valid certificate. Private, local, reserved, and unresolvable addresses are blocked. Named providers can use their built-in address by leaving **Base URL** blank.
5. Turn on the provider and click **Save AI settings**.
6. Click **Test saved connection** and confirm the model replies.

The platform policy can let tenants choose their own provider, force every tenant to use the platform provider, or disable AI everywhere. API keys are encrypted at rest. Removing a key disables that saved provider; it does not bypass a platform default that still applies.

## Configure the platform email provider

Platform super-admins set the default provider used for sign-in links, invitations, password resets, and tenants without their own provider.

1. Open **Platform**, then click **Platform email**.
2. Choose the **Policy**. **Tenants choose their own (recommended)** lets a tenant override the default. **Force the platform default for all tenants** sends every tenant's email through this provider. **Disable all email (kill switch)** is the emergency stop.
3. Choose the **Provider** and enter a verified **From email**. Enter **Reply-to** only when replies should go somewhere else.
4. Enter the provider credential. If you change providers, enter the new provider's credential in the same save. BeaconHS never reuses one provider's saved credential with another provider. An unauthenticated custom SMTP relay is the only exception and does not need a password.
5. Turn on **Enable the platform default provider**.
6. Click **Save platform email**.
7. Under **Send a test through the platform provider**, enter an address you can check and click **Send test**.

A successful test means the provider accepted the message. Check the inbox as well. Provider accounts can still suppress delivery when the sender or sending domain has not been verified. The global kill switch blocks test messages too. Platform tests are limited to five every ten minutes per administrator. Each tenant applies the same limit to its own test sends.

For custom SMTP in a production deployment, use a public, externally resolvable DNS hostname and a valid TLS certificate that matches that hostname. BeaconHS blocks private, local, reserved, unresolvable, and IP-literal hosts. Leave **Port** blank to use 465 with **Use implicit TLS (port 465)** turned on, or 587 when it is off.

## Configure a tenant email provider

This option is available only while the platform policy is **Tenants choose their own (recommended)**.

1. Open **Admin**, then **Notifications**, then **Email**.
2. Choose the **Provider** and enter its sender details.
3. Enter the provider credential. Changing providers requires the new provider's credential, except when the new custom SMTP relay is intentionally unauthenticated.
4. Turn on **Enable this tenant provider override**.
5. Click **Save email settings**.
6. Under **Send a test through this tenant's provider**, enter an address you can check and click **Send test**.

When the override is off, the tenant uses the platform default provider. Clicking **Remove key** removes the tenant credential and turns off the override; it does not stop email supplied by the platform default. Add a credential and enable the override again before sending another tenant-provider test.

## Configure the platform SMS provider

Platform super-admins set the default provider used for critical text-message notifications.

1. Open **Platform**, then click **Platform SMS**.
2. Choose the **Policy**. **Tenants choose their own (recommended)** lets a tenant override the default. **Force the platform default for all tenants** sends every tenant's SMS through this provider. **Disable all SMS (kill switch)** stops all SMS immediately.
3. Choose the **Provider** and enter the required sender and provider account details.
4. Enter the provider credential. If you change providers, enter the new provider's credential in the same save. BeaconHS never reuses one provider's saved credential with another provider.
5. Click **Save platform SMS**.
6. Under **Send a test through the platform provider**, enter a full E.164 number such as **+15551234567**, then click **Send test**.

A successful test means the provider accepted the message. Confirm that the phone receives it. The global kill switch blocks test messages too. Platform tests are limited to five every ten minutes per administrator. Each tenant applies the same limit to its own test sends.

## Configure a tenant SMS provider

This option is available only while the platform policy is **Tenants choose their own (recommended)**.

1. Open **Admin**, then **Notifications**, then **SMS**.
2. Choose the **Provider** and enter its sender and account details.
3. Enter the provider credential. Changing providers requires the new provider's credential.
4. Turn on **Enable this tenant provider override**.
5. Click **Save SMS settings**.
6. Under **Send a test through this tenant's provider**, enter a full E.164 number such as **+15551234567**, then click **Send test**.

When the override is off, the tenant uses the platform default provider. Clicking **Remove key** removes the tenant credential and turns off the override; it does not stop SMS supplied by the platform default. Add a credential and enable the override again before sending another tenant-provider test.

Integration connections can reach public **HTTPS** services only. External database connections also need a public DNS name, valid **SSL/TLS**, and a certificate that matches that name. BeaconHS blocks local, private, and reserved network addresses. When sending to an external SQL table, enter its **Identity column** so a partial retry can remove completed inserts before trying again.

If a sync uses **Archive after safe full pulls**, BeaconHS applies it only after a complete full snapshot. An empty entity or failed record blocks archiving and marks the run partial. A page-limit warning means BeaconHS processed only part of the source, so it also skips archiving. Check the run details before trying again.

On a connection, **Run history** shows every attempt. Search by trigger, status, or error, or use **Status** and **Type** to separate live runs from previews. Use **Next** and **Prev** to move through older runs.

On a sync run, use the record-decision search and the **Action** and **Entity** filters to review created, updated, skipped, failed, or conflicting rows. Click a sortable heading when you need a different order.

## Activity

- **Audit log** — every change captured, with who did it and what changed.
- **Email log** and **SMS log** — every message the system sent.

## Modules

The **Modules** section shows one tile per module you can administer — like Incidents, Journals, or Equipment. Each opens that module's Manage hub with its records, taxonomies, and settings. This is where you rename categories, adjust module settings, and tidy data.

## Tips

- Cannot find a setting? Check the module's own Manage tile first, then **Tenant settings**.
- Changes here affect everyone, and the **Audit log** records them. Make one change at a time and check the result.
- Guided tours have their own admin page — see [Configuring guided tours](/help/walkthroughs-admin).`,
  },
  {
    slug: 'walkthroughs-admin',
    title: 'Configuring guided tours',
    group: 'Administration',
    iconKey: 'sparkles',
    summary: 'Choose which guided tours run, which start automatically, and which roles see them.',
    keywords: [
      'walkthroughs',
      'guided tours',
      'onboarding',
      'tour',
      'tutorial',
      'preview',
      'new users',
    ],
    requiredPermission: 'admin.settings.manage',
    body: `Guided tours walk people through a screen step by step. This page controls which tours your team gets and when.

## What this is for

New hires learn faster when the app shows them around. Each tour highlights parts of a page in order, with a short note on each step. As an admin, you decide which tours are on, which ones start by themselves for new users, and which roles see each one.

## Where to find it

Open [Admin](/admin), then **Walkthroughs**. Or go straight to [Walkthroughs](/admin/walkthroughs). You need the settings-manage permission to open it.

## Turn a tour on or off

1. Open [Walkthroughs](/admin/walkthroughs). Every available tour is listed.
2. Use the enabled toggle on a tour to turn it on or off.
3. Tours that are off never appear for anyone.

## Start a tour automatically for new users

1. Find the tour in the list.
2. Turn on its auto-start option.
3. New users will get that tour on their own the first time they reach the matching page. Users can always dismiss a tour, and they will not be forced through it again.

Keep auto-start for the few tours that matter most on day one. Too many automatic tours gets annoying fast.

## Limit a tour to certain roles

1. Find the tour in the list.
2. Pick which roles should see it.
3. Only people currently acting under one of those roles will get the tour. Leave the roles open if everyone should see it.

This keeps admin-only tours away from field workers, and field tours away from office staff. If a person switches roles, their available tours follow the role they are now using.

## Preview a tour

1. Find the tour in the list.
2. Click **Preview**.
3. The tour runs exactly as your users will see it, step by step. Use this to check the wording and flow before turning a tour on.

## Tips

- After changing roles or auto-start, run **Preview** once to make sure the tour still makes sense for that audience.
- If a page changed a lot, preview its tour — a step that points at something that moved will confuse people more than no tour at all.`,
  },
]
