'use client'

import { useState } from 'react'

/**
 * THE LIVING PROFILE, shown to the patient.
 *
 * Brief §7 asks for a profile that updates live but does not say who sees it.
 * We show it to the patient, collapsed by default, for two reasons:
 *
 *   1. Legibility. A system that silently builds a clinical record about you
 *      is a black box. Showing the record lets the person correct it, which
 *      is also how the mutation path gets exercised in real use.
 *   2. Discretion. Collapsed by default and labelled neutrally, because this
 *      clinic's subject matter is stigmatised and phones are shared. The
 *      person chooses when "chief complaint" appears on screen.
 *
 * Superseded facts are shown struck through rather than hidden. "Advil
 * (stopped last week)" is clinically different from no medication at all,
 * and the patient should see the same history the clinician will.
 */

export interface MemoryItem {
  id: string
  kind: string
  value: string
  status: string
  timeline: string | null
  supersedes: string | null
}

const KIND_LABELS: Record<string, string> = {
  chief_complaint: 'Main concern',
  symptom: 'Symptoms',
  medication: 'Medications',
  allergy: 'Allergies',
}

const KIND_ORDER = ['chief_complaint', 'symptom', 'medication', 'allergy']

const STATUS_LABELS: Record<string, string> = {
  stopped: 'stopped',
  resolved: 'resolved',
  corrected: 'corrected',
}

export default function ProfilePanel({ items }: { items: MemoryItem[] }) {
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  // Retired rows keep their place in the record but are marked as past.
  const current = items.filter((i) => i.status === 'active')
  const retired = items.filter((i) => i.status !== 'active')

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABELS[kind] ?? kind,
    items: items.filter((i) => i.kind === kind),
  })).filter((group) => group.items.length > 0)

  return (
    <section className="mx-auto w-full max-w-2xl px-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-left text-xs transition"
        style={{
          borderColor: 'var(--fb-border)',
          backgroundColor: 'var(--fb-surface)',
          color: 'var(--fb-text-soft)',
        }}
      >
        <span>
          What I&apos;ve noted so far
          <span className="ml-2 font-medium" style={{ color: 'var(--fb-text)' }}>
            {current.length}
            {retired.length > 0 ? ` (+${retired.length} updated)` : ''}
          </span>
        </span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div
          className="mt-2 rounded-xl border px-4 py-3"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-surface)',
          }}
        >
          <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--fb-text-soft)' }}>
            This is what I have picked up from our conversation. If anything is
            wrong, just tell me and I will update it.
          </p>

          <dl className="space-y-3">
            {grouped.map((group) => (
              <div key={group.kind}>
                <dt
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--fb-text-soft)' }}
                >
                  {group.label}
                </dt>
                <dd className="mt-1 space-y-1">
                  {group.items.map((item) => {
                    const isPast = item.status !== 'active'
                    return (
                      <div
                        key={item.id}
                        className="text-sm leading-snug"
                        style={{
                          color: isPast
                            ? 'var(--fb-text-soft)'
                            : 'var(--fb-text)',
                        }}
                      >
                        <span className={isPast ? 'line-through' : ''}>
                          {item.value}
                        </span>
                        {item.timeline && (
                          <span style={{ color: 'var(--fb-text-soft)' }}>
                            {' '}
                            — {item.timeline}
                          </span>
                        )}
                        {isPast && STATUS_LABELS[item.status] && (
                          <span
                            className="ml-2 rounded px-1.5 py-0.5 text-xs"
                            style={{
                              backgroundColor: 'var(--fb-muted)',
                              color: 'var(--fb-text)',
                            }}
                          >
                            {STATUS_LABELS[item.status]}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 text-xs" style={{ color: 'var(--fb-text-soft)' }}>
            Nothing here is shared with the clinic until you choose to send it.
          </p>
        </div>
      )}
    </section>
  )
}