// Single source of truth for course delivery types — labels, learner-facing
// behavior, and which surfaces each type gets. Consumed by the course
// workspace (builder vs settings-only), the courses list/new pages, the
// learner catalog on /my/training, and the enrollment actions.

export const DELIVERY_TYPES = [
  'classroom',
  'self_paced',
  'online',
  'on_the_job',
  'external_certificate',
] as const

export type DeliveryType = (typeof DELIVERY_TYPES)[number]

export type DeliveryMeta = {
  value: DeliveryType
  label: string
  /** One-line explainer shown under the delivery-type select. */
  hint: string
  /** The course carries in-app curriculum (modules/lessons) built in the studio. */
  hasContent: boolean
  /** Learners can start the course themselves from the My training catalog. */
  selfLaunch: boolean
  /**
   * When the course appears in the learner catalog:
   * - with_content — only once it has published modules
   * - always       — regardless of content (the player is settings-driven)
   * - never        — records are entered by training staff, nothing to open
   */
  catalog: 'with_content' | 'always' | 'never'
  /**
   * Whether finishing the course through the enrollment path (a learner
   * completing every required lesson, or an evaluator signing off the last
   * practical) mints the training record + certificate automatically.
   *
   * True for the learner/evaluator-driven types (self-paced, online,
   * on-the-job). FALSE for classroom — an instructor issues those records at
   * class completion with attendance/grade/pass per person — and for external
   * certificates, which are recorded manually. This prevents a stray
   * enrollment on a classroom course from auto-issuing a second record.
   */
  autoIssuesRecord: boolean
}

export const DELIVERY_META: Record<DeliveryType, DeliveryMeta> = {
  classroom: {
    value: 'classroom',
    label: 'Classroom',
    hint: 'Instructor-led classes — records come from class completion. Build slides and handouts for instructors to present.',
    hasContent: true,
    selfLaunch: false,
    catalog: 'with_content',
    autoIssuesRecord: false,
  },
  self_paced: {
    value: 'self_paced',
    label: 'Self-paced',
    hint: 'Learners take the course themselves — lessons, quizzes and practicals. A record and certificate are issued on completion.',
    hasContent: true,
    selfLaunch: true,
    catalog: 'with_content',
    autoIssuesRecord: true,
  },
  online: {
    value: 'online',
    label: 'Online',
    hint: 'Learners follow an external link, then confirm completion in the app. A record and certificate are issued automatically.',
    hasContent: false,
    selfLaunch: true,
    catalog: 'always',
    autoIssuesRecord: true,
  },
  on_the_job: {
    value: 'on_the_job',
    label: 'On-the-job',
    hint: 'Hands-on training signed off by an evaluator against practical criteria. The evaluator sign-off issues the record.',
    hasContent: true,
    selfLaunch: false,
    catalog: 'with_content',
    autoIssuesRecord: true,
  },
  external_certificate: {
    value: 'external_certificate',
    label: 'External certificate',
    hint: 'Tracks credentials earned outside BeaconHS — no in-app content. Certificates are entered as records or imported.',
    hasContent: false,
    selfLaunch: false,
    catalog: 'never',
    autoIssuesRecord: false,
  },
}

export const DELIVERY_OPTIONS: DeliveryMeta[] = DELIVERY_TYPES.map((t) => DELIVERY_META[t])

/**
 * Resolve meta for a raw DB value. Unknown values (should not exist) fall back
 * to a content-enabled shape so nothing authored ever becomes unreachable.
 */
export function deliveryMeta(value: string): DeliveryMeta {
  return (
    DELIVERY_META[value as DeliveryType] ?? {
      value: 'classroom',
      label: value.replace(/_/g, ' '),
      hint: '',
      hasContent: true,
      selfLaunch: false,
      catalog: 'with_content',
      autoIssuesRecord: false,
    }
  )
}

export function deliveryLabel(value: string): string {
  return deliveryMeta(value).label
}
