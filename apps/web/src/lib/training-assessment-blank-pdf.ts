import { escapeHtml } from '@beaconhs/email-render'
import type { trainingAssessmentTypeQuestions, trainingAssessmentTypes } from '@beaconhs/db/schema'

type BlankQuestion = Pick<
  typeof trainingAssessmentTypeQuestions.$inferSelect,
  'prompt' | 'kind' | 'options' | 'helpText' | 'mandatory'
>
type BlankType = Pick<
  typeof trainingAssessmentTypes.$inferSelect,
  'name' | 'description' | 'preAssessmentMessage'
>

/** Candidate paper copy: deliberately accepts no answer key or attempt values. */
export function buildBlankTrainingAssessmentHtml(
  type: BlankType,
  questions: BlankQuestion[],
): string {
  const prose = (value: string | null) => (value ? `<p class="prose">${escapeHtml(value)}</p>` : '')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:12px Arial,sans-serif;color:#0f172a}h1{font-size:22px;margin-bottom:8px}
    .prose{white-space:pre-wrap;overflow-wrap:anywhere}.identity{display:flex;gap:24px;margin:24px 0}
    .identity div{flex:1;border-bottom:1px solid #64748b;height:28px}
    .question{break-inside:avoid;margin:22px 0}.prompt{font-weight:bold;white-space:pre-wrap;overflow-wrap:anywhere}
    .help{color:#475569}.choice{display:flex;gap:10px;margin:10px 0;overflow-wrap:anywhere}
    .box{display:inline-block;flex:none;width:12px;height:12px;border:1px solid #475569}
    .round{border-radius:50%}.line{height:26px;border-bottom:1px solid #94a3b8}
  </style></head><body><h1>${escapeHtml(type.name)}</h1>
    ${prose(type.description)}${prose(type.preAssessmentMessage)}
    <div class="identity"><div>Name:</div><div>Date:</div></div>
    ${questions
      .map((question, index) => {
        const options =
          question.kind === 'true_false'
            ? [
                { value: 'true', label: 'True' },
                { value: 'false', label: 'False' },
              ]
            : question.options
        const choices = ['single_choice', 'multi_choice', 'true_false'].includes(question.kind)
        return `<section class="question"><div class="prompt">${index + 1}. ${escapeHtml(question.prompt)}${question.mandatory ? ' (required)' : ''}</div>
        <div class="help">${prose(question.helpText)}</div>
        ${choices ? `<p>${question.kind === 'multi_choice' ? 'Select all that apply.' : 'Select one answer.'}</p>${(options ?? []).map((option) => `<div class="choice"><span class="box ${question.kind === 'multi_choice' ? '' : 'round'}"></span><span>${escapeHtml(option.label)}</span></div>`).join('')}` : `<div class="line"></div>${question.kind === 'text' ? '<div class="line"></div><div class="line"></div><div class="line"></div>' : ''}`}
      </section>`
      })
      .join('')}
    <div class="identity"><div>Signature:</div><div>Instructor:</div></div>
  </body></html>`
}
