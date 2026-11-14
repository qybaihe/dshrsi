// Every model-visible line an adaptation produces starts with this prefix.
// The model can attribute it, and the observer can recognise the harness's
// own interventions instead of counting them as fresh failures.
export const MARK = '[harness adaptation'

export function mark(title, text) {
  return `${MARK}: ${title}] ${text}`
}

/** How a notice begins when the harness takes one of its own adaptations back. The session read model looks for it. */
export const WITHDREW = 'The harness took this adaptation back'

export function isMarked(text) {
  return String(text ?? '').slice(0, 80).includes(MARK)
}
