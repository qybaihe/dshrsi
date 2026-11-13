// Every model-visible line an adaptation produces starts with this prefix.
// The model can attribute it, and the observer can recognise the harness's
// own interventions instead of counting them as fresh failures.
export const MARK = '[harness adaptation'

export function mark(title, text) {
  return `${MARK}: ${title}] ${text}`
}

export function isMarked(text) {
  return String(text ?? '').slice(0, 80).includes(MARK)
}
