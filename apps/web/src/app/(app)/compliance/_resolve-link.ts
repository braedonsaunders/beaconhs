// Where a person goes to COMPLETE or REVIEW an obligation — the module's own
// record / fill / create flow, NOT the (compliance.read-gated) obligation
// detail. Pure data, no 'use client' / no DB, so both the dashboard "My
// compliance" widget metrics and the /compliance/mine table import it and a
// click lands directly on the document, journal, app, course, inspection, etc.
//
// `prefetch: false` is returned for links that MUTATE on GET (inspection/hazard
// "start" routes create a draft record then redirect) — Next must not fire those
// from a list on hover/viewport — and for the form fill route, to avoid a
// prefetch storm over a long list of outstanding items.

import type { ComplianceTargetRef } from '@beaconhs/db/schema'

type ComplianceLink = { href: string; prefetch: boolean }

export function resolveComplianceLink(
  kind: string,
  targetRef: ComplianceTargetRef | null | undefined,
  opts: {
    personId?: string | null
    obligationId?: string | null
    responseId?: string | null
  } = {},
): ComplianceLink | null {
  const ref = targetRef ?? {}
  switch (kind) {
    case 'document':
      // Land on the Acknowledgments tab so the acknowledge action + signature
      // are front-and-centre, with the document shown in the right pane.
      return ref.documentId
        ? { href: `/documents/${ref.documentId}?tab=acknowledgments`, prefetch: true }
        : null
    case 'journal':
      // The journals workspace is where today's entry is logged.
      return { href: '/journals', prefetch: true }
    case 'form':
      if (opts.responseId) {
        return { href: `/apps/responses/${encodeURIComponent(opts.responseId)}`, prefetch: true }
      }
      return ref.formTemplateId
        ? {
            href: `/apps/templates/${ref.formTemplateId}/fill${
              opts.obligationId ? `?obligationId=${encodeURIComponent(opts.obligationId)}` : ''
            }`,
            prefetch: false,
          }
        : null
    case 'training':
    case 'cert_requirement':
      if (ref.courseId) return { href: `/training/learn/${ref.courseId}`, prefetch: true }
      if (ref.assessmentTypeId && opts.personId) {
        const params = new URLSearchParams({
          typeId: ref.assessmentTypeId,
          personId: opts.personId,
        })
        if (opts.obligationId) params.set('obligationId', opts.obligationId)
        return {
          href: `/training/assessments?drawer=new&${params.toString()}`,
          prefetch: true,
        }
      }
      return ref.skillTypeId
        ? { href: '/my/wallet', prefetch: true }
        : { href: '/my/training', prefetch: true }
    case 'inspection':
      // `new?typeId=` starts a draft + redirects — never prefetch it.
      return ref.inspectionTypeId
        ? { href: `/inspections/records/new?typeId=${ref.inspectionTypeId}`, prefetch: false }
        : { href: '/inspections/records', prefetch: true }
    case 'hazard_assessment':
      return { href: '/hazard-assessments/new', prefetch: false }
    case 'job_title_signoff':
      // Title tasks are signed off inline on the holder's own person page.
      return opts.personId ? { href: `/people/${opts.personId}`, prefetch: true } : null
    default:
      return null
  }
}

/** The call-to-action verb shown on a "mine" row for each obligation kind. */
export function complianceActionLabel(kind: string): string {
  switch (kind) {
    case 'document':
      return 'Acknowledge'
    case 'journal':
      return 'Log entry'
    case 'form':
      return 'Open app'
    case 'training':
    case 'cert_requirement':
      return 'Go to training'
    case 'inspection':
      return 'Start inspection'
    case 'hazard_assessment':
      return 'New assessment'
    case 'job_title_signoff':
      return 'Sign off'
    default:
      return 'Open'
  }
}
