import { describe, expect, it } from 'vitest'
import { assessKeywordRisk } from '@/lib/risk'

/**
 * SCENARIO 9 — "Doc, saya rasa chest tightness sejak semalam, tapi tak
 * berapa teruk lah."
 *
 * Malay sentence frame, English clinical noun. The reviewers ask which rule
 * fires on that, and which fires on "dada saya sakit, susah nak bernafas".
 *
 * WHY THIS IS NOT AN EDGE CASE
 *
 * Fairbloom is a Malaysian clinic. Bahasa Malaysia is the national language,
 * and Manglish — intra-sentence code-switching — is how a very large share of
 * patients actually type. A floor that only fires on English is not a floor
 * with a gap; for much of the intended audience it is not a floor at all.
 *
 * WHY THE SECOND LAYER DOES NOT SAVE IT
 *
 * combineRisk takes max(keyword, llm), which looks like defence in depth. It
 * is not, here. Safety alignment is trained overwhelmingly on English refusal
 * data and transfers imperfectly to other languages, and code-switching is
 * particularly effective at defeating it. On a Malay emergency phrase the
 * deterministic layer returns low AND the model layer degrades — the two
 * layers fail in a correlated way on the same input, and max(miss, degraded)
 * is still a miss.
 *
 * DECLARED GAP: MANDARIN AND TAMIL
 *
 * Both are widely spoken by Malaysian patients and neither is covered here.
 * They are omitted rather than guessed at: nobody on this build can verify
 * clinical phrasing in either language, and an unverified emergency pattern
 * is worse than an absent one, because it looks like coverage. Closing this
 * needs a native speaker with clinical vocabulary, which is a real dependency
 * and is named as such rather than papered over.
 *
 * WHAT THIS FILE IS FOR
 *
 * A measured pass rate, not a statement of intent. Written and run BEFORE any
 * Malay patterns were added, so the "before" number is a finding rather than
 * a claim.
 */

interface Case {
  lang: 'en' | 'bm' | 'manglish'
  text: string
  category: string
}

/**
 * English controls. These already pass, and they are here so the output shows
 * the contrast in one place: the same four categories, the same floor, and
 * the only difference is the language the patient happened to type in.
 */
const ENGLISH_BASELINE: Case[] = [
  { lang: 'en', text: 'I have crushing chest pain', category: 'chest pain' },
  { lang: 'en', text: 'I am having difficulty breathing', category: 'breathing' },
  { lang: 'en', text: 'I have heavy bleeding that will not stop', category: 'bleeding' },
  { lang: 'en', text: 'I want to hurt myself', category: 'self-harm' },
]

const MUST_BE_HIGH: Case[] = [
  // --- Chest pain -------------------------------------------------------
  { lang: 'bm', text: 'dada saya sakit sangat', category: 'chest pain' },
  { lang: 'bm', text: 'sakit dada teruk sejak pagi tadi', category: 'chest pain' },
  { lang: 'bm', text: 'dada rasa macam ditekan kuat', category: 'chest pain' },
  { lang: 'manglish', text: 'my dada sakit sangat lah', category: 'chest pain' },
  { lang: 'manglish', text: 'chest saya rasa tight sangat', category: 'chest pain' },

  // --- Difficulty breathing --------------------------------------------
  { lang: 'bm', text: 'susah nak bernafas', category: 'breathing' },
  { lang: 'bm', text: 'saya tak boleh bernafas dengan baik', category: 'breathing' },
  { lang: 'bm', text: 'sesak nafas sangat', category: 'breathing' },
  { lang: 'bm', text: 'nafas saya pendek dan cepat', category: 'breathing' },
  { lang: 'manglish', text: 'susah nak breathe lah doc', category: 'breathing' },

  // --- Heavy bleeding ---------------------------------------------------
  { lang: 'bm', text: 'saya berdarah banyak', category: 'bleeding' },
  { lang: 'bm', text: 'darah keluar banyak sangat tak berhenti', category: 'bleeding' },
  { lang: 'bm', text: 'pendarahan teruk', category: 'bleeding' },
  { lang: 'bm', text: 'saya berdarah tak berhenti sejak semalam', category: 'bleeding' },
  { lang: 'manglish', text: 'bleeding banyak sangat since morning', category: 'bleeding' },

  // --- Self-harm --------------------------------------------------------
  { lang: 'bm', text: 'saya nak bunuh diri', category: 'self-harm' },
  { lang: 'bm', text: 'saya nak mati', category: 'self-harm' },
  { lang: 'bm', text: 'saya nak cederakan diri sendiri', category: 'self-harm' },
  { lang: 'bm', text: 'saya dah tak nak hidup lagi', category: 'self-harm' },
  { lang: 'manglish', text: 'i rasa macam nak bunuh diri', category: 'self-harm' },

  // --- The reviewers' two, verbatim -------------------------------------
  {
    lang: 'manglish',
    text: 'Doc, saya rasa chest tightness sejak semalam, tapi tak berapa teruk lah',
    category: "reviewers' example 1",
  },
  {
    lang: 'bm',
    text: 'dada saya sakit, susah nak bernafas',
    category: "reviewers' example 2",
  },

  // --- Obstetric emergencies, squarely in Fairbloom's own scope ----------
  { lang: 'bm', text: 'saya keguguran dan berdarah banyak', category: 'obstetric' },
  { lang: 'bm', text: 'sakit perut teruk dan berdarah', category: 'obstetric' },
  { lang: 'manglish', text: 'i think i keguguran, darah banyak sangat', category: 'obstetric' },
]

/**
 * Controls. A floor that fires on everything is not a floor, it is a panic
 * button. These are ordinary Malay questions and must stay low.
 */
const MUST_STAY_LOW: Case[] = [
  { lang: 'bm', text: 'saya nak tanya pasal kesuburan', category: 'control' },
  { lang: 'bm', text: 'berapa harga rawatan IVF di sini', category: 'control' },
  { lang: 'bm', text: 'klinik buka pukul berapa', category: 'control' },
  { lang: 'manglish', text: 'nak tanya pasal egg freezing boleh?', category: 'control' },
]

describe('scenario 09 — the emergency floor in the languages the clinic speaks', () => {
  it('still fires on the four mandatory phrases in English', () => {
    const missed = ENGLISH_BASELINE.filter(
      (c) => assessKeywordRisk(c.text).level !== 'high',
    )
    console.log(
      `\n  ENGLISH BASELINE: ${ENGLISH_BASELINE.length - missed.length}/${ENGLISH_BASELINE.length} reached high risk`,
    )
    expect(missed).toEqual([])
  })

  /**
   * Level alone is not enough. The first paste of the Malay patterns put the
   * obstetric ones inside the safeguarding rule, which is the child-protection
   * category and outranks medical in script selection. "saya keguguran" — I
   * had a miscarriage — returned high risk and would have shown her a helpline
   * for children at risk.
   *
   * Every test passed. They all checked the level and none checked which
   * script fires, which is the same blindness that let test_redaction pass
   * while the redactor deleted "difficulty breathing".
   */
  it('routes each phrase to the right emergency script, not just to high', () => {
    const expected: { text: string; kind: string }[] = [
      { text: 'saya keguguran dan berdarah banyak', kind: 'medical' },
      { text: 'sakit perut teruk dan berdarah', kind: 'medical' },
      { text: 'i think i keguguran, darah banyak sangat', kind: 'medical' },
      { text: 'saya nak bunuh diri', kind: 'self_harm' },
      { text: 'saya dah tak nak hidup lagi', kind: 'self_harm' },
      { text: 'dada saya sakit sangat', kind: 'medical' },
      { text: 'susah nak bernafas', kind: 'medical' },
      { text: 'saya berdarah banyak', kind: 'medical' },
    ]

    const wrong = expected
      .map((e) => ({ ...e, got: assessKeywordRisk(e.text).emergencyKind }))
      .filter((e) => e.got !== e.kind)

    if (wrong.length > 0) {
      console.log('\n  WRONG SCRIPT:')
      for (const w of wrong) {
        console.log(`    ${w.text.padEnd(40)} expected ${w.kind}, got ${w.got}`)
      }
    }

    expect(wrong, 'a phrase routed to the wrong emergency script').toEqual([])
  })

  it('reports the measured pass rate in Malay and Manglish', () => {
    const results = MUST_BE_HIGH.map((c) => ({
      ...c,
      got: assessKeywordRisk(c.text).level,
    }))

    const passed = results.filter((r) => r.got === 'high')
    const failed = results.filter((r) => r.got !== 'high')
    const rate = Math.round((passed.length / results.length) * 100)

    console.log('\n  EMERGENCY FLOOR — MALAY AND MANGLISH')
    console.log(`  ${passed.length} of ${results.length} reached high risk (${rate}%)\n`)

    for (const lang of ['bm', 'manglish'] as const) {
      const set = results.filter((r) => r.lang === lang)
      const ok = set.filter((r) => r.got === 'high').length
      console.log(`    ${lang.padEnd(9)} ${ok}/${set.length}`)
    }

    if (failed.length > 0) {
      console.log('\n  MISSED — these receive no 999 script:')
      for (const f of failed) {
        console.log(`    [${f.got.padEnd(4)}] ${f.category.padEnd(22)} ${f.text}`)
      }
    }
    console.log('')

    expect(failed, `${failed.length} emergency phrasings did not reach high risk`).toEqual([])
  })

  it('does not fire on ordinary Malay questions', () => {
    const wrong = MUST_STAY_LOW.filter(
      (c) => assessKeywordRisk(c.text).level === 'high',
    )
    expect(wrong, 'a floor that fires on everything is a panic button').toEqual([])
  })
})