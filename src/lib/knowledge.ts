/**
 * GROUNDING CORPUS — brief §6, "Low Risk: Provide education/support with citations."
 *
 * A small, curated, auditable knowledge base. Deliberately not web search and
 * deliberately not the model's own recall.
 *
 * WHY CURATED
 * A model asked to cite will produce citations. They look right, resolve to
 * nothing, and are worse than no citation at all because they borrow the
 * authority of a source that was never consulted. Grounding only means
 * something if the span exists somewhere you can point at — so every claim
 * the assistant makes on a low-risk turn comes from this file, and the
 * citation row stores the id, the source, and the exact sentence used.
 *
 * HONEST LIMITATION, stated in the Technical Brief:
 * These entries were drafted for this build, not written or reviewed by a
 * clinician. They are restricted to durable public-health statements rather
 * than precise figures that shift year to year, and each names the body that
 * publishes on the topic rather than a deep link that may move. A real
 * deployment replaces this file with clinician-reviewed content; nothing
 * else in the system changes when it does.
 */

export interface KnowledgeEntry {
  id: string
  /** Topics this entry can answer, used for retrieval. */
  tags: string[]
  /** The claim, written as one citable sentence. */
  text: string
  sourceOrg: string
  sourceTitle: string
  sourceUrl: string | null
}

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  // ---------------------------------------------------------------- fertility
  {
    id: 'fert-01',
    tags: ['fertility', 'trying to conceive', 'infertility', 'not pregnant'],
    text: 'Most couples having regular unprotected sex conceive within a year, and infertility is generally defined as not conceiving after twelve months of trying.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Infertility fact sheet',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/infertility',
  },
  {
    id: 'fert-02',
    tags: ['fertility', 'age', 'over 35', 'when to see a doctor'],
    text: 'Assessment is usually advised after twelve months of trying, or after about six months for women over 35, because fertility declines with age and earlier assessment leaves more options.',
    sourceOrg: 'NHS',
    sourceTitle: 'Infertility — diagnosis',
    sourceUrl: 'https://www.nhs.uk/conditions/infertility/',
  },
  {
    id: 'fert-03',
    tags: ['fertility', 'partner', 'male factor', 'semen analysis'],
    text: 'Fertility problems involve a male factor in roughly a third to a half of cases, so assessment normally looks at both partners rather than one.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Infertility fact sheet',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/infertility',
  },
  {
    id: 'fert-04',
    tags: ['egg freezing', 'oocyte cryopreservation', 'fertility preservation'],
    text: 'Egg freezing involves ovarian stimulation over roughly two weeks, then egg collection under sedation, and success later depends heavily on the age at which the eggs were frozen.',
    sourceOrg: 'NHS',
    sourceTitle: 'Egg freezing',
    sourceUrl: 'https://www.nhs.uk/conditions/fertility-treatment/',
  },
  {
    id: 'fert-05',
    tags: ['ivf', 'treatment', 'success rate'],
    text: 'IVF success rates fall with age and no clinic can guarantee a live birth, so published rates should always be read alongside the age group they describe.',
    sourceOrg: 'NHS',
    sourceTitle: 'IVF — what happens',
    sourceUrl: 'https://www.nhs.uk/conditions/ivf/',
  },

  // ------------------------------------------------------------ menstruation
  {
    id: 'mens-01',
    tags: ['period', 'cycle', 'irregular', 'menstruation'],
    text: 'A menstrual cycle is commonly between about 21 and 35 days in adults, and cycles that are consistently outside that range, or that change noticeably, are worth discussing with a clinician.',
    sourceOrg: 'NHS',
    sourceTitle: 'Periods and fertility in the menstrual cycle',
    sourceUrl: 'https://www.nhs.uk/conditions/periods/',
  },
  {
    id: 'mens-02',
    tags: ['heavy periods', 'menorrhagia', 'bleeding'],
    text: 'Heavy menstrual bleeding is common and is treatable; it is defined by the effect on a person\u2019s life rather than by a measured volume.',
    sourceOrg: 'NICE',
    sourceTitle: 'Heavy menstrual bleeding: assessment and management',
    sourceUrl: 'https://www.nice.org.uk/guidance/ng88',
  },
  {
    id: 'mens-03',
    tags: ['period pain', 'cramps', 'dysmenorrhoea', 'endometriosis'],
    text: 'Period pain severe enough to disrupt daily life is not something to accept as normal, and can be a sign of a condition such as endometriosis, which is often diagnosed years after symptoms begin.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Endometriosis fact sheet',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/endometriosis',
  },
  {
    id: 'mens-04',
    tags: ['pcos', 'polycystic', 'irregular periods'],
    text: 'Polycystic ovary syndrome is one of the most common hormonal conditions in people of reproductive age and is a frequent cause of irregular cycles.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Polycystic ovary syndrome fact sheet',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/polycystic-ovary-syndrome',
  },

  // ----------------------------------------------------------- sexual health
  {
    id: 'sti-01',
    tags: ['sti', 'std', 'infection', 'symptoms', 'testing'],
    text: 'Many sexually transmitted infections cause no symptoms at all, which is why testing is recommended based on risk rather than only when something feels wrong.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Sexually transmitted infections fact sheet',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/sexually-transmitted-infections-(stis)',
  },
  {
    id: 'sti-02',
    tags: ['sti', 'chlamydia', 'fertility', 'untreated'],
    text: 'Untreated chlamydia and gonorrhoea can lead to pelvic inflammatory disease and affect future fertility, and both are curable with antibiotics when found.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Sexually transmitted infections fact sheet',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/sexually-transmitted-infections-(stis)',
  },
  {
    id: 'sti-03',
    tags: ['hpv', 'cervical', 'screening', 'smear', 'pap'],
    text: 'Nearly all cervical cancer is linked to persistent HPV infection, and regular cervical screening detects changes early, before they become cancer.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Cervical cancer fact sheet',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/cervical-cancer',
  },
  {
    id: 'sti-04',
    tags: ['discharge', 'thrush', 'bacterial vaginosis', 'itching'],
    text: 'A change in vaginal discharge is common and often not an infection, but a change in colour, smell or amount, particularly with pain or fever, is worth having examined.',
    sourceOrg: 'NHS',
    sourceTitle: 'Vaginal discharge',
    sourceUrl: 'https://www.nhs.uk/conditions/vaginal-discharge/',
  },

  // -------------------------------------------------------------- pregnancy
  {
    id: 'preg-01',
    tags: ['pregnancy', 'early pregnancy', 'first trimester'],
    text: 'Early pregnancy care usually includes confirming the pregnancy, dating it by scan, and starting folic acid, which is recommended before conception where possible.',
    sourceOrg: 'NHS',
    sourceTitle: 'Your first midwife appointment',
    sourceUrl: 'https://www.nhs.uk/pregnancy/',
  },
  {
    id: 'preg-02',
    tags: ['miscarriage', 'early loss', 'pregnancy loss'],
    text: 'Miscarriage is common in early pregnancy and in most cases is not caused by anything the person did or did not do.',
    sourceOrg: 'NHS',
    sourceTitle: 'Miscarriage — causes',
    sourceUrl: 'https://www.nhs.uk/conditions/miscarriage/',
  },
  {
    id: 'preg-03',
    tags: ['postnatal', 'postpartum', 'mood', 'depression', 'after birth'],
    text: 'Postnatal depression affects a significant minority of people after birth, is a recognised medical condition rather than a failing, and responds to treatment.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Maternal mental health',
    sourceUrl: 'https://www.who.int/teams/mental-health-and-substance-use/promotion-prevention/maternal-mental-health',
  },

  // ------------------------------------------------------------ contraception
  {
    id: 'contra-01',
    tags: ['contraception', 'birth control', 'pill', 'iud'],
    text: 'Contraceptive methods differ substantially in typical-use effectiveness, and the most effective methods are those that do not depend on remembering to use them.',
    sourceOrg: 'World Health Organization',
    sourceTitle: 'Family planning and contraception fact sheet',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/family-planning-contraception',
  },

  // -------------------------------------------------------------- menopause
  {
    id: 'meno-01',
    tags: ['menopause', 'perimenopause', 'hot flushes'],
    text: 'Perimenopause can begin several years before periods stop and may bring changes in cycle, sleep, mood and temperature regulation.',
    sourceOrg: 'NHS',
    sourceTitle: 'Menopause — symptoms',
    sourceUrl: 'https://www.nhs.uk/conditions/menopause/',
  },
]

/**
 * Naive keyword retrieval, and naive on purpose.
 *
 * Embeddings would retrieve better, but they add a model, a vector store and
 * a failure mode to a corpus of twenty entries. Tag overlap is inspectable:
 * anyone can read why a given entry was offered, which matters more here than
 * recall. Swap this for embeddings when the corpus outgrows a screen.
 */
export function retrieve(query: string, limit = 3): KnowledgeEntry[] {
  const haystack = query.toLowerCase()

  const scored = KNOWLEDGE_BASE.map((entry) => {
    let score = 0
    for (const tag of entry.tags) {
      if (haystack.includes(tag)) score += tag.split(' ').length
    }
    return { entry, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry)
}