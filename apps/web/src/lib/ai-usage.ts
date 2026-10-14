// Display labels for the `feature` tag every metered model call carries
// (getModel(config, tier, feature) in @beaconhs/ai). Unknown tags fall back to
// the raw key so a newly tagged call still shows up on Admin → AI → Usage.

export const AI_FEATURE_LABEL: Record<string, string> = {
  assistant: 'Assistant',
  briefs: 'AI briefs',
  builder: 'Builder AI',
  documents: 'Documents',
  feedback: 'Issue reporter',
  'insights.card': 'Insights cards',
  'journals.entry': 'Journal summaries and tags',
  'journals.writing': 'Journal writing help',
  vision: 'Photo and document reading',
  'connection.test': 'Connection test',
  general: 'Other',
}

export function aiFeatureLabel(feature: string): string {
  return AI_FEATURE_LABEL[feature] ?? feature
}
