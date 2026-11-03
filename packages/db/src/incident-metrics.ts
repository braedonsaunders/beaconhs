/** Reporting scales. Keep labels shared between the form and exported evidence. */
const severityOptions = [
  'No first aid or medical treatment required. No property damage.',
  'First aid treatment required. No property damage.',
  'Medical aid treatment and/or property damage greater than $0 and less than $5,000.',
  'Critical injury and/or property damage from $5,000 to less than $25,000.',
  'Fatality and/or property damage of $25,000 or more.',
] as const

export const INCIDENT_METRICS = [
  {
    field: 'actualSeverity',
    key: 'actual_severity',
    label: 'Actual severity',
    question: 'The actual severity of this incident is:',
    help: 'Rate what actually happened. Use the higher rating when injury and property damage fall into different bands.',
    higherIsBetter: false,
    options: severityOptions,
  },
  {
    field: 'potentialSeverity',
    key: 'potential_severity',
    label: 'Potential severity',
    question: 'The potential severity of this incident is:',
    help: 'Rate what could reasonably have happened. Use the higher rating when injury and property damage fall into different bands.',
    higherIsBetter: false,
    options: severityOptions,
  },
  {
    field: 'processExperience',
    key: 'process_experience',
    label: 'Experience with the process',
    question: 'How experienced is the person involved with the process they were performing?',
    help: 'New Employee: 0 to 6 months working with this process at your company. Young Worker: 18 to 24 years old and less than two years working with this process at your company. Use rating 1 if either definition applies; otherwise use completed years of experience.',
    higherIsBetter: true,
    options: [
      'New employee and/or young worker.',
      'More than 6 months to less than 2 years of experience and not a young worker.',
      '2 to less than 5 years of experience.',
      '5 to 10 years of experience.',
      'Greater than 10 years of experience.',
    ],
  },
  {
    field: 'crewResponse',
    key: 'crew_response',
    label: 'Crew response',
    question: 'The crew handled the situation:',
    help: 'Choose the description that best matches the crew’s response.',
    higherIsBetter: true,
    options: [
      'No treatment/repair provided. No action taken to remediate incident or injury. No conversation with others about incident/injury prevention.',
      'Treatment/repair provided. No action to prevent further incident. No conversation with others about incident/injury prevention.',
      'Treatment/repair provided. Eventual action provided to prevent future occurrence. No conversation with others about incident/injury prevention.',
      'Treatment/repair provided. Immediate action taken to prevent future occurrence. No conversation with others about incident/injury prevention.',
      'Treatment/repair provided. Immediate action taken to prevent future occurrence. Conversation with others about incident/injury prevention.',
    ],
  },
  {
    field: 'siteConditions',
    key: 'site_conditions',
    label: 'Site conditions',
    question: 'Generally, the conditions on site are:',
    help: 'Choose the description that best matches the site conditions.',
    higherIsBetter: true,
    options: [
      'No protection from injury or incident. Re-occurrence likely to happen.',
      'Protection for injury and incident prevention available, not in use/below satisfactory. Re-occurrence likely to happen.',
      'Protection for injury and incident satisfactory. Re-occurrence unlikely to happen.',
      'Protection for injury and incident above satisfactory. Re-occurrence unlikely.',
      'Hazard or risk eliminated.',
    ],
  },
] as const

export function incidentMetricAnswer(
  metric: (typeof INCIDENT_METRICS)[number],
  value: number | null,
): string {
  if (value == null) return ''
  const description = metric.options[value - 1]
  return description ? `${value} — ${description}` : ''
}
