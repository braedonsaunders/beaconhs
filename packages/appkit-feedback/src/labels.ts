export type FeedbackLabels = {
  launcherAria: string
  title: string
  description: string
  close: string
  placeholder: string
  send: string
  sending: string
  pageChip: string
  removePage: string
  thatHelped: string
  stillABug: string
  continue: string
  filedTitle: string
  filedBody: string
  openIssue: string
  strippedHeading: string
  unavailableTitle: string
  workingHelp: string
  workingIssues: string
  workingFile: string
  workingDefault: string
  settingsTitle: string
  settingsDescription: string
  enabled: string
  enabledHelp: string
  owner: string
  repo: string
  token: string
  tokenHelp: string
  tokenSet: string
  labels: string
  labelsHelp: string
  searchDuplicates: string
  searchDuplicatesHelp: string
  save: string
  saving: string
}

export const DEFAULT_FEEDBACK_LABELS: FeedbackLabels = {
  launcherAria: 'Report an issue',
  title: 'Report an issue',
  description:
    'Describe what went wrong. We will check for a known answer, then file a product report if it is a defect.',
  close: 'Close',
  placeholder: 'What happened?',
  send: 'Send',
  sending: 'Checking…',
  pageChip: 'This page',
  removePage: 'Remove page context',
  thatHelped: 'That helped',
  stillABug: 'Still a bug',
  continue: 'Continue',
  filedTitle: 'Report filed',
  filedBody: 'A generalized product issue was created. Personal and tenant details were removed.',
  openIssue: 'Open issue',
  strippedHeading: 'Removed before filing',
  unavailableTitle: 'Unable to report',
  workingHelp: 'Checking the help guide…',
  workingIssues: 'Looking for a known issue…',
  workingFile: 'Filing a product issue…',
  workingDefault: 'Reviewing your report…',
  settingsTitle: 'In-app issue reporting',
  settingsDescription:
    'People can report a product issue from any page. Filed issues go to the product tracker after personal data is removed.',
  enabled: 'Enable reporting',
  enabledHelp: 'Show the report control in the application header.',
  owner: 'Repository owner',
  repo: 'Repository name',
  token: 'Access token',
  tokenHelp:
    'Needs Issues: Read and write (fine-grained) or repo (classic). Leave blank to keep the saved token.',
  tokenSet: 'A token is already saved.',
  labels: 'Default labels',
  labelsHelp: 'Comma-separated labels that already exist on the repository.',
  searchDuplicates: 'Search open issues first',
  searchDuplicatesHelp:
    'When a matching open issue already exists, point the person to it instead of filing a duplicate.',
  save: 'Save',
  saving: 'Saving…',
}

export function mergeFeedbackLabels(overrides?: Partial<FeedbackLabels>): FeedbackLabels {
  return { ...DEFAULT_FEEDBACK_LABELS, ...overrides }
}

export function workingStatusForTool(
  toolName: string | undefined,
  labels: FeedbackLabels = DEFAULT_FEEDBACK_LABELS,
): string {
  switch (toolName) {
    case 'search_help':
    case 'read_help':
      return labels.workingHelp
    case 'search_existing_issues':
      return labels.workingIssues
    case 'submit_issue':
      return labels.workingFile
    default:
      return labels.workingDefault
  }
}
