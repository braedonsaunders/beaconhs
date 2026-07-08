// Manual articles: "Oversight & reports" + "Administration" groups.
// Written for supervisors and office staff, but kept plain-language.

import type { ManualArticle } from '../types'

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
      'hire date',
    ],
    body: `The People directory lists everyone in your company — workers, contractors, and supervisors.

## What this is for

People power almost everything else in the app. Training records, compliance, PPE, and incidents all point back to a person here. Keeping this list correct keeps the rest of the app correct.

## Where to find it

Open [People](/people) from the sidebar.

## Find a person

1. Open [People](/people).
2. Type a name or employee number in the **Search by name or employee #** box.
3. Use the **Status** filter to switch between **Active**, **Inactive**, **Terminated**, or **All**. The list shows active people by default.
4. Click a person to open their page. Tabs like **Overview**, **Compliance**, **Transcript**, and **PPE** show everything about them in one place.

## Add a person

1. Open [People](/people).
2. Click **Add person**.
3. Fill in their name, employee number, department, and hire date.
4. Save. They now show up in pickers across the app.

## Departments

Each person belongs to one department. Departments are used for grouping, compliance audiences, the training matrix, and reports.

1. Open [Departments](/people/departments).
2. Click **Add department** to create one, or search the list to edit one.

## Org chart

The org chart shows who reports to whom. It is built from the manager set on each person.

1. Open [Org chart](/people/org-chart).
2. Click a person to focus on their part of the tree.
3. To change the chart, edit the person and change who they report to.

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

## What picking a site on a record means

When someone fills out a form or reports an incident, they pick a site. That choice controls:

- Which location's tabs the record shows up on (each location page has **Incidents** and **Equipment** tabs).
- How reports and dashboards group results by site or project.
- Who gets notified, when notifications are set up by location.

Tell your crews which site to pick for each job. A record filed against the wrong site is easy to miss later.

## See the whole tree at once

The list page shows locations with their projects and sites. For one flat, searchable list of every level — customer, project, site, and area — open [Org units](/locations/units) and use the **Level** filter.

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

On a phone, the list fills the screen; picking a report opens its preview, and **All reports** takes you back.

## Export a report

1. Select or open the report.
2. Click **CSV**, **Excel**, or **PDF**.
3. The file downloads. The PDF matches the preview page-for-page; CSV and Excel are best for working with the numbers.

You can also click **Email PDF** on the full report to send it right away instead of downloading it.

## Schedule a report by email

Schedules send a report as a PDF email on a repeating schedule, so nobody has to remember to run it.

1. On any report, click **Subscribe**. Or open the **Schedules** tab and click **New schedule**.
2. Pick the report and give the schedule a name.
3. Under **Delivery**, set the **Cadence** (**Daily**, **Weekly**, or **Monthly**), the day, and the time.
4. Under **Recipients**, add team members, or type outside email addresses under **Additional email addresses**.
5. Click **Create schedule**.

The **Schedules** tab shows every schedule with its next run and last run. Use the pause button to stop one without deleting it.

## Build your own report

If no built-in report fits, click **New report** to build a custom one. You can also open a built-in report and click **Edit a copy** to start from something close.

The builder shows a live print preview while you work. Under **Page setup** you can pick the paper size (**Letter**, **A4**, or **Legal**), switch between **Portrait** and **Landscape**, and set the page margin — the preview and every export follow it.

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

Insights answers "how are we doing right now?" — incidents by month, open actions by site, training completion by department. It is the screen you keep open, not the document you print.

One rule to remember: **Reports are documents, Insights are dashboards.** If you need a PDF or a scheduled email, use [Reports](/help/reports). If you need a live view, you are in the right place.

## Where to find it

Open [Insights](/insights) from the sidebar. Your dashboards appear as tabs across the top.

## View a dashboard

1. Open [Insights](/insights).
2. Click a dashboard tab. Cards and charts load with current data.
3. If the dashboard has filters, use the filter bar above the grid to narrow by things like site or date.

## Build a card by asking a question

A card is one saved chart or table. The fastest way to build one is to describe it.

1. Open the [Library](/insights/library) and click **New card**.
2. In the **Ask AI** box, type what you want in plain words — for example, incidents by month this year.
3. Click **Ask AI**. It sets up the data and chart for you.
4. Adjust anything in the side panel (data, filters, grouping, chart type), then click **Save card**.

You can also build a card by hand using the same side panel, without asking AI.

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

1. Open the **Obligations** tab and click **New obligation**.
2. Pick the **Kind**. Common kinds include **Training / assessment**, **Document acknowledgement**, **App (scheduled)** for a form people must fill on a cadence, **Certification requirement**, and **Inspection**.
3. Fill in the title and what to require for that kind — for example, which course or which document.
4. Pick the audience: specific people, a role, a department, a site, or everyone.
5. Click **Create obligation**.

The system then tracks every person in the audience and creates their tasks automatically.

## See who is overdue

1. Open the **Due & expiring** tab. The cards at the top show **Overdue**, **Expired**, **Due soon (30d)**, and **Open tasks**. Filter the list by status to work through it. Certifications only count for active people — someone marked inactive or terminated in People drops off this list.
2. Open the **Aging** tab to see how long items have been overdue, grouped into 0–7 days, 7–30 days, and 30+ days. Start with the oldest.
3. Open the **By person** tab and pick a person to see every requirement on their plate, with status badges like **Overdue**, **Expiring**, and **Completed**.

## Tips

- Each person's own view lives on the **Mine** tab and on their profile, so they can see the same list you see.
- Requiring people to fill a custom form is also done here — see [Builder (custom forms & apps)](/help/builder) for how the two connect.
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

Open [Builder](/apps) from the sidebar. It lists your apps with a **published** or **draft** badge on each.

## Create and publish a form

1. Open [Builder](/apps) and click **New app**.
2. In the designer, open the **Build** tab. Under **Add an element**, drag fields onto the canvas or click one to add it to the selected section.
3. Click a field to set its label, whether it is required, and any logic.
4. Use the other tabs — **Record behaviour**, **Records list**, **Record actions**, and **Access** — to control how records act and who can open them.
5. When it is ready, click **Publish v1**. Until you publish, only builders can see it.

Publishing again later creates the next version. Old submissions keep the version they were filled on.

## Assign the form to people

Filling a form on a schedule is tracked by the compliance engine.

1. In the designer, open the **Assign** tab.
2. Click **Create an assignment**. This opens a new obligation with the form pre-selected.
3. Pick who must fill it and on what cadence, then click **Create obligation**.

Anyone with access can also open and fill the app straight from the gallery, without an assignment. See [Managing compliance](/help/compliance-management) for tracking who is behind.

## Automate with Flows

Flows run automatically when things happen on your form.

1. In the designer, switch the surface from **Build surface** to **Flows**.
2. Add a trigger, like **A record is submitted** or **A field matches a condition**.
3. Connect actions, like **Send email**, **Create CAPA**, **Notify role**, or **Export PDF**.

## See the responses

Every submission lands in [Form responses](/apps/responses). Filter by app and status, open any record, or click **Export CSV** to download the list.`,
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

- **Tenant settings** — branding, languages, risk matrix, hierarchy.
- **Notifications** — who gets automatic alerts and how often reminders repeat.
- **Navigation** — reorder the sidebar and pin forms as modules.
- **Data sources** — reference lists and live data your apps bind to.
- **Data export** — audited CSV exports across modules and Builder apps.
- **Email templates** and **PDF templates** — branded emails and paper documents that flows can send and attach.

## Integrations

- **AI**, **Email**, and **SMS** — pick a provider and store its credentials securely.
- **Integrations** — sync data in and send events out to other systems.
- **API keys** — credentials for the public REST API.

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
3. Only people with one of those roles will get the tour. Leave the roles open if everyone should see it.

This keeps admin-only tours away from field workers, and field tours away from office staff.

## Preview a tour

1. Find the tour in the list.
2. Click **Preview**.
3. The tour runs exactly as your users will see it, step by step. Use this to check the wording and flow before turning a tour on.

## Tips

- After changing roles or auto-start, run **Preview** once to make sure the tour still makes sense for that audience.
- If a page changed a lot, preview its tour — a step that points at something that moved will confuse people more than no tour at all.`,
  },
]
