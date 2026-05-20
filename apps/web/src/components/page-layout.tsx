import { cn } from '@beaconhs/ui'
import { FadeInBody, FadeInHeader } from './page-layout-motion'

/**
 * Default page wrapper for content-driven pages (dashboards, forms, etc).
 * The whole body scrolls; header travels with it.
 *
 * Use ListPageLayout for tabular pages and DetailPageLayout for entities.
 */
export function PageContainer({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className="app-scroll flex-1 overflow-y-auto">
      <FadeInBody className={cn('mx-auto w-full max-w-screen-2xl p-6', className)}>
        {children}
      </FadeInBody>
    </div>
  )
}

/**
 * List page layout — header (title/actions/search/filter chips) is sticky;
 * only the table area scrolls. The header fades in on mount; the body
 * fades in slightly behind it.
 *
 *   <ListPageLayout
 *     header={...}        // PageHeader, search/filter row, etc
 *     children={tableElement}
 *   />
 */
export function ListPageLayout({
  header,
  children,
}: {
  header: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white px-6 pb-3 pt-5">
        <FadeInHeader className="mx-auto max-w-screen-2xl space-y-3">{header}</FadeInHeader>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        <FadeInBody className="mx-auto max-w-screen-2xl p-6">{children}</FadeInBody>
      </div>
    </div>
  )
}

/**
 * Detail page layout — fixed header (DetailHeader + optional alerts) and a
 * horizontal subtab strip; tab content fills the remaining space and scrolls
 * internally.
 *
 *   <DetailPageLayout
 *     header={<DetailHeader … />}
 *     alerts={<Alert … />}
 *     subtabs={<TabNav … />}
 *     children={activeTabContent}
 *   />
 */
export function DetailPageLayout({
  header,
  alerts,
  subtabs,
  children,
  className,
}: {
  header: React.ReactNode
  alerts?: React.ReactNode
  subtabs?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white">
        <FadeInHeader className="mx-auto max-w-screen-2xl px-6 pt-5">
          {header}
          {alerts ? <div className="mt-3 space-y-2">{alerts}</div> : null}
          {subtabs ? <div className="mt-4">{subtabs}</div> : null}
        </FadeInHeader>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        <FadeInBody className={cn('mx-auto max-w-screen-2xl p-6', className)}>
          {children}
        </FadeInBody>
      </div>
    </div>
  )
}

/**
 * Split layout for entity detail pages that have a sticky sidebar (profile
 * card etc) + a tabbed pane. The sidebar AND the body each scroll
 * independently so neither bleeds out of the viewport.
 */
export function DetailSplitLayout({
  header,
  alerts,
  sidebar,
  subtabs,
  children,
}: {
  header: React.ReactNode
  alerts?: React.ReactNode
  sidebar: React.ReactNode
  subtabs?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white">
        <FadeInHeader className="mx-auto max-w-screen-2xl px-6 pt-5">
          {header}
          {alerts ? <div className="mt-3 space-y-2">{alerts}</div> : null}
        </FadeInHeader>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="app-scroll w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-6">
          {sidebar}
        </aside>
        <div className="flex min-h-0 flex-1 flex-col">
          {subtabs ? (
            <div className="border-b border-slate-200 bg-white px-6">
              <div className="mx-auto max-w-screen-2xl">{subtabs}</div>
            </div>
          ) : null}
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
            <FadeInBody className="mx-auto max-w-screen-2xl p-6">{children}</FadeInBody>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Three-row "wizard" layout for forms — sticky header (title/progress),
 * scrollable body (the active step), sticky footer (Back/Next/Submit).
 */
export function WizardLayout({
  header,
  footer,
  children,
}: {
  header: React.ReactNode
  footer: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white">
        <FadeInHeader className="mx-auto max-w-2xl px-6 py-4">{header}</FadeInHeader>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        <FadeInBody className="mx-auto max-w-2xl p-6">{children}</FadeInBody>
      </div>
      <div className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-3">{footer}</div>
      </div>
    </div>
  )
}
