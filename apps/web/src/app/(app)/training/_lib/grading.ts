// Server-side grading for assessment attempts.
// Pure function: given a question (kind + correctAnswer) and the user's answer,
// decide correct/incorrect/null. `text` questions never auto-grade — they
// remain null until a human marks them.
//
// Multi-choice canonicalisation: both `correctAnswer` and `answer` are
// comma-separated value lists. We sort + lowercase both before comparing so
// "A,B,C" matches "c,b,a".

export type QuestionKind = 'text' | 'single_choice' | 'multi_choice' | 'numeric' | 'true_false'

export function gradeAnswer(
  kind: QuestionKind,
  correctAnswer: string | null,
  userAnswer: string | null,
): boolean | null {
  if (kind === 'text') return null // never auto-grade free text
  if (userAnswer == null || userAnswer.trim().length === 0) return false
  if (correctAnswer == null || correctAnswer.trim().length === 0) return null

  const ua = userAnswer.trim()
  const ca = correctAnswer.trim()

  if (kind === 'single_choice' || kind === 'true_false') {
    return ua.toLowerCase() === ca.toLowerCase()
  }
  if (kind === 'numeric') {
    const a = Number(ua)
    const b = Number(ca)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    return Math.abs(a - b) < 1e-9
  }
  if (kind === 'multi_choice') {
    const norm = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join('|')
    return norm(ua) === norm(ca)
  }
  return null
}
