export type RegulatoryTerminology = {
  authorityName: string
  authorityAbbreviation: string
  legislationName: string
  legislationAbbreviation: string
  otherApplicableLegislation: string
}

export const DEFAULT_REGULATORY_TERMINOLOGY: RegulatoryTerminology = {
  authorityName: 'Ministry of Labour',
  authorityAbbreviation: 'MOL',
  legislationName: 'Occupational Health and Safety Act',
  legislationAbbreviation: 'OHSA',
  otherApplicableLegislation: '',
}

const regulatoryValue = (value: unknown, fallback: string, maxLength: number): string =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback

export function resolveRegulatoryTerminology(settings: unknown): RegulatoryTerminology {
  const root = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const raw =
    root.regulatoryTerminology && typeof root.regulatoryTerminology === 'object'
      ? (root.regulatoryTerminology as Record<string, unknown>)
      : {}
  return {
    authorityName: regulatoryValue(
      raw.authorityName,
      DEFAULT_REGULATORY_TERMINOLOGY.authorityName,
      160,
    ),
    authorityAbbreviation: regulatoryValue(
      raw.authorityAbbreviation,
      DEFAULT_REGULATORY_TERMINOLOGY.authorityAbbreviation,
      24,
    ),
    legislationName: regulatoryValue(
      raw.legislationName,
      DEFAULT_REGULATORY_TERMINOLOGY.legislationName,
      200,
    ),
    legislationAbbreviation: regulatoryValue(
      raw.legislationAbbreviation,
      DEFAULT_REGULATORY_TERMINOLOGY.legislationAbbreviation,
      24,
    ),
    otherApplicableLegislation:
      typeof raw.otherApplicableLegislation === 'string'
        ? raw.otherApplicableLegislation.trim().slice(0, 2_000)
        : '',
  }
}

export function getRegulatoryTerminology(context: {
  regulatory?: RegulatoryTerminology
}): RegulatoryTerminology {
  return context.regulatory ?? DEFAULT_REGULATORY_TERMINOLOGY
}
