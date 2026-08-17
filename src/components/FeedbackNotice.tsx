import type { Feedback } from '../lib/orderFeedback'

/**
 * One visual treatment per tone, plus the outcome's own title — so the distinct
 * outcomes the backends report stay distinct on screen.
 */
const TONE_STYLES: Record<Feedback['tone'], string> = {
  success: 'border-up/50 bg-up/10 text-green-300',
  info: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
  warning: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  danger: 'border-down/50 bg-down/10 text-red-300',
}

export function FeedbackNotice({ feedback }: { feedback: Feedback }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={feedback.tone}
      className={`rounded border px-3 py-2 text-sm ${TONE_STYLES[feedback.tone]}`}
    >
      <p data-testid="feedback-title" className="font-medium">
        {feedback.title}
      </p>
      <p className="mt-1 text-slate-300">{feedback.detail}</p>

      {feedback.fieldErrors && (
        <ul className="mt-2 list-inside list-disc text-slate-300">
          {Object.entries(feedback.fieldErrors).flatMap(([field, messages]) =>
            messages.map((message) => (
              <li key={`${field}-${message}`}>{message}</li>
            )),
          )}
        </ul>
      )}

      {feedback.hint && (
        <p className="mt-2 text-xs text-slate-400">{feedback.hint}</p>
      )}
    </div>
  )
}
