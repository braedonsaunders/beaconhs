// Getting started — the first articles every worker sees in the user guide.
// Grounded in the real UI: /login, the sidebar, /my, /notifications, /account,
// /assistant, and /help itself. Keep labels in sync with those pages.

import type { ManualArticle } from '../types'

export const GETTING_STARTED_ARTICLES: ManualArticle[] = [
  {
    slug: 'getting-started',
    title: 'Welcome to BeaconHS',
    group: 'Getting started',
    iconKey: 'gauge',
    summary: 'Sign in, find your way around, and set up BeaconHS on your phone.',
    keywords: [
      'login',
      'log in',
      'sign in',
      'magic link',
      'password',
      'sidebar',
      'menu',
      'dashboard',
      'dark mode',
      'phone',
      'tablet',
      'mobile',
      'install',
      'app',
      'home screen',
      'help',
      'basics',
      'start',
    ],
    body: `BeaconHS is where your crew reports hazards, fills out forms, and keeps safety records in one place. This article covers signing in and finding your way around.

## Signing in

BeaconHS does not have public sign-up. Your administrator creates your account and sends an invitation to your work email.

For your first visit:

1. Open the invitation email.
2. Tap **Accept the invitation and sign in** within 15 minutes. The link works once.
3. If the link expired, ask your administrator to open **Users** and tap **Resend invite**.

After your invitation is accepted:

1. Open the site your company gave you and go to the sign-in page.
2. Enter your work **Email**.
3. Pick one of the two tabs at the top:
   - **Password** — type your password, then tap **Sign in**. Tap **Forgot password?** if you need a reset.
   - **Magic link** — tap **Send magic link**. Check your email and open the link. No password needed.
4. You land on the **Dashboard**.

A normal password or magic-link sign-in does not activate a pending invitation. Use the link from the invitation email first. Each workspace sends its own invitation.

## Finding your way around

The left menu lists everything you can use. Items are grouped:

- **Overview** — the **Dashboard**, your [Workspace](/my), and the activity feed.
- **Frontline** — day-to-day field work like incidents, hazard assessments, and journals.
- **Knowledge** — training and documents.
- **Assets & people** — people, equipment, and PPE.
- **Assurance** — inspections, compliance, and follow-up actions.

You only see the items your role allows. If a page is missing, ask your supervisor or admin.

The **Dashboard** shows your open work at a glance. Tap any card to jump to it.

## Turning on dark mode

1. Tap your name in the top right corner.
2. Use the theme switcher to pick **Light**, **System**, or **Dark**.

## Using BeaconHS on a phone or tablet

BeaconHS works in any modern browser and is built for the field. You can also install it so it opens like a regular app:

1. Open BeaconHS in your phone's browser.
2. On iPhone or iPad: tap the Share icon, then choose **Add to Home Screen**.
3. On Android: open the browser menu, then choose **Install app** or **Add to Home screen**.
4. Open BeaconHS from the new icon.

Installing it also lets you get push notifications on iPhone. See [Notifications & Inbox](/help/notifications).

## Getting help

- Open this user guide any time at [Help](/help). Use the search box to find an answer fast.
- If your company has it turned on, the [AI Assistant](/help/assistant) can answer questions in plain English.
- Your supervisor or safety admin can help with access and permissions.`,
  },
  {
    slug: 'workspace',
    title: 'My Workspace',
    group: 'Getting started',
    iconKey: 'circle-user',
    summary: 'Your personal hub: open items, training, and your credential wallet.',
    keywords: [
      'workspace',
      'my stuff',
      'my page',
      'wallet',
      'tickets',
      'certs',
      'certificates',
      'cards',
      'qr code',
      'training',
      'my tasks',
      'my incidents',
      'drafts',
      'in progress',
      'credentials',
    ],
    body: `Your Workspace is your personal home base. It shows only your own items — nothing from the rest of the crew.

## What this is for

The Workspace gathers everything tied to you in one place: unfinished entries, tasks assigned to you, your training, and your credential cards. Each tile shows a count so you can see what needs attention at a glance.

## Where to find it

Open **Workspace** in the left menu, under Overview. You can also go straight to [Workspace](/my).

## Checking your open items

1. Open [Workspace](/my).
2. Look at the tiles:
   - **In progress** — drafts and unfinished entries you can resume.
   - **Compliance** — safety obligations assigned to you, with an overdue count.
   - **Tasks** — open corrective actions assigned to you.
   - **Training** — your records, expirations, and assigned courses.
   - **Incidents**, **Assessments**, and **Inspections** — records you reported, started, or carried out.
3. Tap a tile to open the full list behind it.

A badge on a tile warns you about anything overdue or expiring soon.

## Using your credential wallet

Your wallet holds your certificates and skill cards — like the paper tickets in your truck, but always with you.

1. Open [Workspace](/my), then tap **Wallet**.
2. Your cards are stacked like a real wallet. Each card shows the credential name and a status: **Valid**, **Expiring soon**, **Expired**, or **No expiry**.
3. Tap a card to flip it over. Cards with a certificate include a QR code on the back.
4. Show the QR code to a supervisor or site inspector. They scan it with their phone camera to verify your credential on the spot.

## Finding your training cards

1. Open [Workspace](/my), then tap **Training**.
2. You will see your training records, anything expiring soon, and courses assigned to you that still need to be done.

## Tips

- Check **In progress** at the end of each shift so drafts do not pile up.
- If your Workspace looks empty, your login may not be linked to a person record yet. Ask your admin to link it.`,
  },
  {
    slug: 'notifications',
    title: 'Notifications & Inbox',
    group: 'Getting started',
    iconKey: 'bell',
    summary: 'Read your alerts, choose how they reach you, and turn on push for your phone.',
    keywords: [
      'notifications',
      'inbox',
      'alerts',
      'messages',
      'bell',
      'push',
      'push notifications',
      'email alerts',
      'text',
      'sms',
      'preferences',
      'mark read',
      'unread',
      'reminders',
    ],
    body: `BeaconHS sends you a notification when something needs your attention — a new task, an overdue item, or a training reminder. They all land in your inbox.

## Where to find it

Tap the bell icon in the top bar, or open [Notifications](/notifications). A number on the bell shows how many are unread.

## Reading and clearing notifications

1. Open your [Inbox](/notifications).
2. Use the folders on the left to filter: **All**, **Unread**, **Critical**, or **To-dos**. You can also filter by category, like Incidents or Training.
3. Tap a notification to read it. Most link to the record they are about.
4. On any notification you can **Mark read** or **Mark unread**, snooze it for a day, or delete it.
5. To clear the whole list at once, tap **Mark all as read** at the top.

There is also a search box at the top if you are looking for something specific.

## Choosing how notifications reach you

1. From your inbox, tap the settings icon, or go to [Notification preferences](/notifications/preferences).
2. You will see a grid of categories (Incidents, Corrective actions, Compliance, Training, Documents, Monitored sessions) and channels (**In-app**, **Email**, **Web push**, **SMS**).
3. Check or uncheck the boxes to choose which categories reach you on which channels. In-app notifications always land in your inbox.
4. Tap **Save preferences**.

## Turning on push notifications on your phone

Push notifications pop up on your phone even when BeaconHS is not open.

1. Open [Notification preferences](/notifications/preferences) on the device you want alerts on.
2. Find the **Push notifications on this device** card.
3. Tap **Enable on this device** and allow notifications when your phone asks.
4. Tap **Send a test push** to check it works.

On iPhone and iPad, push only works after you install BeaconHS to your home screen:

1. In Safari, tap the Share icon.
2. Choose **Add to Home Screen**.
3. Open BeaconHS from the new icon, then follow the steps above.

## Tips

- Push must be enabled on each device separately. Turn it on for both your phone and tablet if you use both.
- Tap **Turn off on this device** any time to stop push on that device.`,
  },
  {
    slug: 'account',
    title: 'Your account',
    group: 'Getting started',
    iconKey: 'settings',
    summary: 'Update your name, time zone, signature, and password.',
    keywords: [
      'account',
      'profile',
      'settings',
      'name',
      'password',
      'change password',
      'time zone',
      'timezone',
      'signature',
      'sign off',
      'language',
      'my details',
    ],
    body: `Your account page holds your personal details: your name, time zone, the signature you sign forms with, and your password.

## Where to find it

Tap your name in the top right corner, then tap **Account settings**. Or go straight to [Account](/account).

## Updating your name, language, and time zone

1. Open [Account](/account).
2. In the **Profile** card, edit your **Name**.
3. Pick your **Language** and **Time zone**. The time zone controls how dates and times show across the app, so set it to where you work.
4. Tap **Save changes**.

Your email address is shown here but cannot be changed yourself. Ask your admin if it needs updating.

## Setting your signature

Your saved signature is used when you sign off forms, inspections, and lift plans — so you do not have to draw it every time.

1. Open [Account](/account) and find the **Signature** card.
2. Draw your signature in the box with your finger or mouse. On a phone, turn it sideways for more room.
3. Tap **Save signature**.
4. To redo it later, come back and draw a new one over the old.

## Changing your password

1. Open [Account](/account) and find the **Password** card.
2. Enter your **Current password**, then your **New password** and **Confirm new password**.
3. Tap **Change password**.

If you cannot remember your current password, tap **Forgot current password?** and BeaconHS emails you a reset link.

## Adding a password if you only use magic links

If you have always signed in with email links, you can add a password too:

1. Open [Account](/account) and find the **Password** card.
2. Tap **Email me a link to set a password**.
3. Open the link from your email and choose a password.

After that you can sign in either way — password or magic link.

## Tips

- Use a password nobody else on the crew would guess, and do not share it.
- If your name or details look wrong and you cannot edit them, they may be synced from your company's records. Ask your admin.`,
  },
  {
    slug: 'assistant',
    title: 'AI Assistant',
    group: 'Getting started',
    iconKey: 'sparkles',
    requiredPermission: 'assistant.use',
    summary: 'Ask questions about your safety data in plain English and get help using the app.',
    keywords: [
      'assistant',
      'ai',
      'chat',
      'chatbot',
      'ask',
      'question',
      'help me',
      'search',
      'ask ai',
      'command k',
      'shortcut',
      'smart search',
    ],
    body: `The Assistant is a chat built into BeaconHS. Ask it questions in plain English — about your safety records or about how to do something in the app.

## What this is for

Instead of digging through lists, you can just ask. For example:

- "Show my overdue corrective actions."
- "How many incidents were reported at the yard this month?"
- "How do I add my signature?"

The Assistant can also read this user guide, so it can walk you through app tasks step by step.

## Where to find it

- Open **Assistant** in the left menu, or go to [Assistant](/assistant).
- From anywhere in the app, tap the **Ask AI** button in the top bar.
- On a keyboard, press Ctrl+K (Cmd+K on a Mac) to open a quick ask box, type your question, and press Enter.

## Asking a question

1. Open [Assistant](/assistant).
2. Type your question in the box at the bottom and send it.
3. The Assistant looks through your data and answers. When it checks a record or runs a search, you will see a card showing what it looked at.
4. Ask follow-up questions in the same chat. Tap **New chat** to start a fresh topic.

Your past conversations are saved in a list on the left so you can come back to them.

## Find an older conversation

1. Type part of its title in **Search chats**.
2. Click **Load more** at the bottom of **Your chats** or **Shared with you** when the conversation is not in the first results.
3. After you open a long conversation, click **Load older messages** at the top to read its earlier messages.

## Share a conversation

1. Open the conversation and click **Share**.
2. Choose **Person** or **Role**, then search by name.
3. Pick the person or role and click **Add**.
4. To remove access, click the remove button beside that person or role under **Shared with**.

Shared conversations are read-only for everyone except the owner.

## Letting it create records for you

The Assistant can draft records — for example, a corrective action. It never creates anything on its own:

1. Ask it to draft what you need.
2. It shows a preview card marked as needing your approval.
3. Check the details, then tap the **Create** button on the card to confirm, or **Discard** to throw it away.

Nothing is saved until you confirm.

## What it can and cannot see

The Assistant only sees what you are allowed to see. It follows the same permissions as your login. If you cannot open a record yourself, the Assistant cannot read it for you either.

## Tips

- Be specific. "Open incidents at Site 4 this week" works better than "incidents".
- The Assistant is a helper, not the boss. Always double-check details before confirming anything it drafts.`,
  },
  {
    slug: 'help-and-tours',
    title: 'Help & guided tours',
    group: 'Getting started',
    iconKey: 'book',
    summary: 'Search this user guide and take step-by-step tours of the screens you use.',
    keywords: [
      'help',
      'guide',
      'manual',
      'user guide',
      'instructions',
      'how to',
      'tour',
      'tours',
      'walkthrough',
      'tutorial',
      'training wheels',
      'onboarding',
      'learn',
    ],
    body: `BeaconHS has two kinds of built-in help: this user guide, and guided tours that show you around live on screen.

## The user guide

The guide you are reading now covers every part of the app in plain language.

1. Open [Help](/help) from the left menu.
2. Use the search box to find what you need. Search works with everyday words — try "tickets", "truck log", or "toolbox talk".
3. Tap an article to read it. Steps are numbered, and button names are shown in **bold** exactly as they appear on screen.

The guide only shows articles for features you can actually use. If you cannot see a module in the left menu, its article is hidden too. That means everything you find here should work for you.

## Guided tours

A guided tour is a short walkthrough that runs on the real screen. It highlights one button at a time and tells you what it does, so you learn by looking at the actual page — not a manual.

## Taking a tour

1. Open [Help](/help).
2. Find the tour you want and start it.
3. Follow the highlights. Each step points at a button or field and explains it.
4. Move forward step by step, or exit at any time. Nothing you do in a tour changes your data unless a step asks you to fill something in.

Some tours start on their own the first time you sign in, to show you the basics. You can exit them whenever you like and run them again later from [Help](/help).

## For admins: choosing who sees which tours

If you manage BeaconHS for your company, you decide which tours are shown to which roles:

1. Open **Admin** in the left menu, then go to **Walkthroughs**.
2. Pick a tour and choose the roles that should see it.
3. New workers in those roles get the tour offered when they first sign in.

## Tips

- Stuck on a page? Search [Help](/help) for the page name first — most screens have a matching article.
- If you prefer to ask instead of read, the [AI Assistant](/help/assistant) can read this guide and answer questions about it.`,
  },
]
