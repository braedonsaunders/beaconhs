// Built-in UI walkthroughs (guided tours). Pure data + helpers — no server
// imports — so the client player can import it too. Per-tenant overrides
// (enabled / auto-start / roles) live in walkthrough_settings; per-user
// completion in walkthrough_progress (see lib/walkthroughs/service.ts).
//
// The tour set is deliberately frontline-first: legacy BeaconHS usage shows
// daily journals, PPE checks, hazard assessments (JSHAs), site inspections and
// truck logs are what field workers actually enter day to day.
//
// AGENTS: when a step's target button/route changes, update the step here and
// the matching /help article (see AGENTS.md "In-app user guide").

type WalkthroughStep = {
  /** Route this step happens on. The player navigates there when needed. */
  path?: string
  /**
   * CSS selector of the element to spotlight. Sidebar items expose
   * [data-walkthrough="nav:<href>"]. Undefined — or a selector that never
   * appears (e.g. sidebar links on a phone) — renders a centered card instead.
   */
  target?: string
  title: string
  /** Plain language, 1–3 short sentences. Written for a field crew. */
  body: string
}

export type Walkthrough = {
  /** Stable id — stored in walkthrough_settings / walkthrough_progress. */
  id: string
  title: string
  /** One sentence shown on /help and /admin/walkthroughs. */
  description: string
  /** Route the tour starts on (also the admin Preview target). */
  startPath: string
  /** Defaults when the tenant has no walkthrough_settings row. */
  defaultEnabled: boolean
  defaultAutoStart: boolean
  steps: WalkthroughStep[]
}

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: 'welcome',
    title: 'Welcome to BeaconHS',
    description: 'A quick lap of the app: the menu, your workspace, and where to get help.',
    startPath: '/dashboard',
    defaultEnabled: true,
    defaultAutoStart: true,
    steps: [
      {
        title: 'Welcome',
        body: 'BeaconHS is where your crew logs safety work: journals, hazard assessments, inspections, incidents and more. This quick tour shows you around. You can leave it any time with Skip.',
      },
      {
        target: '[data-walkthrough="nav:/dashboard"]',
        title: 'Dashboard',
        body: 'Your home page. It shows what needs your attention and shortcuts to common tasks.',
      },
      {
        target: '[data-walkthrough="nav:/my"]',
        title: 'My Workspace',
        body: 'Everything that is yours in one place: open items, training cards and your certificate wallet.',
      },
      {
        target: '[data-walkthrough="nav:/notifications"]',
        title: 'Inbox',
        body: 'Reminders and alerts land here — things assigned to you, due dates, sign-offs.',
      },
      {
        target: '[data-walkthrough="nav:/help"]',
        title: 'User Guide',
        body: 'Plain-language how-tos for every part of the app, plus more tours like this one. If you are ever stuck, start here.',
      },
      {
        title: 'That is the basics',
        body: 'Open the User Guide any time for step-by-step help, or ask the Assistant a question in plain English.',
      },
    ],
  },
  {
    id: 'daily-journal',
    title: 'Write a daily journal',
    description: 'Log what happened on site today: notes, photos and tags.',
    startPath: '/journals',
    defaultEnabled: true,
    defaultAutoStart: false,
    steps: [
      {
        path: '/journals',
        title: 'Journals',
        body: 'This is your daily log. Most crews add one entry per day: what was worked on, conditions, anything worth remembering.',
      },
      {
        path: '/journals',
        target: '[data-walkthrough="journals-new"]',
        title: 'Start an entry',
        body: 'Tap New entry to open a fresh journal for today.',
      },
      {
        title: 'Write it down',
        body: 'Type what happened in your own words. Add photos from your phone camera and tags so it is easy to find later.',
      },
      {
        title: 'Finding old entries',
        body: 'Past entries are grouped by date on the left. Use search to jump to a day or a keyword.',
      },
    ],
  },
  {
    id: 'hazard-assessment',
    title: 'Complete a hazard assessment',
    description: 'Fill out a JSHA / FLHA: tasks, hazards, controls and crew sign-on.',
    startPath: '/hazard-assessments',
    defaultEnabled: true,
    defaultAutoStart: false,
    steps: [
      {
        path: '/hazard-assessments',
        title: 'Hazard assessments',
        body: 'Before starting a task, your crew records the hazards and how you will control them. This list shows every assessment you can see.',
      },
      {
        path: '/hazard-assessments',
        target: 'a[href="/hazard-assessments?drawer=new"]',
        title: 'Start a new assessment',
        body: 'Tap New assessment. Pick the assessment type your supervisor told you to use.',
      },
      {
        title: 'Tasks and hazards',
        body: 'Add each task, then the hazards that come with it. Rate the risk before and after your controls — the colours follow your company risk matrix.',
      },
      {
        title: 'PPE and sign-on',
        body: 'Select the PPE the job needs. Then every crew member signs on. Their signature means they read and understood it.',
      },
      {
        title: 'Submit it',
        body: 'When everything is filled in, submit. Your supervisor can see it right away, and you can reopen it if conditions change.',
      },
    ],
  },
  {
    id: 'site-inspection',
    title: 'Do a site inspection',
    description: 'Walk the site, answer the checklist, flag deficiencies with photos.',
    startPath: '/inspections/records',
    defaultEnabled: true,
    defaultAutoStart: false,
    steps: [
      {
        path: '/inspections/records',
        title: 'Inspections',
        body: 'Inspections are checklists your company set up: site walk-throughs, housekeeping checks and more.',
      },
      {
        path: '/inspections/records',
        target: 'a[href="/inspections/records?drawer=new"]',
        title: 'Start one',
        body: 'Tap New inspection and pick the inspection type and the site.',
      },
      {
        title: 'Answer the checklist',
        body: 'Work through each item. Anything that fails, note what you saw and add a photo — that is what gets fixed.',
      },
      {
        title: 'Draft or submit',
        body: 'You can save a draft and finish later. Submitting locks in your answers and notifies whoever follows up.',
      },
    ],
  },
  {
    id: 'report-incident',
    title: 'Report an incident',
    description: 'Report an injury, near miss or damage — fast, from any device.',
    startPath: '/incidents',
    defaultEnabled: true,
    defaultAutoStart: false,
    steps: [
      {
        path: '/incidents',
        title: 'Incidents',
        body: 'Report everything: injuries, near misses, property damage, spills. A near miss reported today prevents an injury tomorrow.',
      },
      {
        path: '/incidents',
        target: 'a[href="/incidents/new"]',
        title: 'Start a report',
        body: 'Tap Report incident. Do it as soon as you safely can — details fade fast.',
      },
      {
        title: 'What to include',
        body: 'Say what happened in your own words: when, where, who was involved, what you saw. Photos help a lot. You will not get in trouble for reporting.',
      },
      {
        title: 'What happens next',
        body: 'Your safety team reviews it, may investigate, and can assign corrective actions so it does not happen again. You can check the status here any time.',
      },
    ],
  },
  {
    id: 'vehicle-log',
    title: 'Fill in your vehicle log',
    description: 'Log your truck days for the month: destinations or odometer readings.',
    startPath: '/equipment/vehicle-log',
    defaultEnabled: true,
    defaultAutoStart: false,
    steps: [
      {
        path: '/equipment/vehicle-log',
        title: 'Vehicle log',
        body: 'This is your truck log for the month. Each row is a day. Fill in the days you drove.',
      },
      {
        title: 'Log a day',
        body: 'Tap a day and enter where you went, or your start and end odometer — whichever your company uses. On a phone, days show as cards you can fill one by one.',
      },
      {
        title: 'Quick fill',
        body: 'Driving the same route all week? Use quick fill to copy an entry across several days instead of typing it again.',
      },
      {
        title: 'Keep it current',
        body: 'Fill it in as you go — end of day works. It beats reconstructing a whole month from memory.',
      },
    ],
  },
  {
    id: 'ppe-inspection',
    title: 'Check your PPE',
    description: 'Inspect the gear issued to you and report anything damaged.',
    startPath: '/ppe',
    defaultEnabled: true,
    defaultAutoStart: false,
    steps: [
      {
        path: '/ppe',
        title: 'PPE',
        body: 'This shows the PPE issued to you — harnesses, lanyards, respirators and more — and when each item is due for a check.',
      },
      {
        title: 'Inspect an item',
        body: 'Open the item and start its inspection. Answer each check honestly — a failed strap found now is a life saved later.',
      },
      {
        title: 'Damaged gear',
        body: 'If something fails, say so in the inspection. Tag the gear out and tell your supervisor — do not keep using it.',
      },
    ],
  },
  {
    id: 'my-training',
    title: 'Your training & tickets',
    description: 'Take assigned courses and find your certificates.',
    startPath: '/training',
    defaultEnabled: true,
    defaultAutoStart: false,
    steps: [
      {
        path: '/training',
        title: 'Training',
        body: 'Courses assigned to you show here. Some are online lessons with a quiz; some are in-person classes you are enrolled in.',
      },
      {
        title: 'Take a course',
        body: 'Open the course and work through it. Your progress saves as you go, so you can finish on a break.',
      },
      {
        title: 'Your tickets',
        body: 'Finished training becomes a record with a certificate. Your wallet in My Workspace keeps them on your phone — with a QR code anyone can scan to verify.',
      },
    ],
  },
  {
    id: 'manage-user-access',
    title: 'Invite users and manage access',
    description: 'Invite a member, resend a link, and set their tenant role and scope.',
    startPath: '/admin/users',
    defaultEnabled: false,
    defaultAutoStart: false,
    steps: [
      {
        path: '/admin/users',
        title: 'Users',
        body: 'This list controls membership in this workspace. Global account security stays with the member or a platform super-admin.',
      },
      {
        path: '/admin/users',
        target: 'a[href="/admin/users/invite"]',
        title: 'Send an invitation',
        body: 'Tap Invite user, enter the work email, and choose an initial role. The member gets a one-time link that expires after 15 minutes.',
      },
      {
        title: 'Pending invitations',
        body: 'An invited membership activates only when the person accepts the email link. Open the member and tap Resend invite when the link expires.',
      },
      {
        title: 'Roles, scope, and status',
        body: 'Open a member to set their tenant display name, person link, roles, scope, and permission overrides. Suspend access when it should be temporarily blocked.',
      },
    ],
  },
]

const BY_ID = new Map(WALKTHROUGHS.map((w) => [w.id, w]))

export function walkthroughById(id: string): Walkthrough | undefined {
  return BY_ID.get(id)
}
