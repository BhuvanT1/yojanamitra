/**
 * The multilingual term lexicon.
 *
 * Extraction runs on the citizen's ORIGINAL text, never on a translation. That
 * is not a performance choice — it is what makes the evidence spans meaningful.
 * If we translated first, the evidence for `occupation: farmer` on a Telugu input
 * would be an English word that appears nowhere in what the citizen typed, and
 * the correction panel would have nothing to highlight. So every language the
 * system understands needs its terms here.
 *
 * Adding a language is a data change: append entries with a new `lang` tag.
 * Nothing in the extractor is English-specific.
 *
 * Coverage is deliberately narrow and honest — the terms that actually decide
 * eligibility in this corpus. A term that is not here produces *no* field rather
 * than a guess, and the citizen can fill it in on the correction panel.
 */

export type Lang = 'en' | 'hi' | 'te' | 'romanised';

export interface Term {
  /** Matched case-insensitively against the original text. */
  surface: string;
  lang: Lang;
  /**
   * How sure we are that seeing this string means the value. "farmer" is
   * unambiguous; "worker" could be many things.
   */
  confidence: number;
}

export interface TermTable<V extends string> {
  value: V;
  terms: Term[];
}

const t = (surface: string, lang: Lang, confidence = 0.9): Term => ({ surface, lang, confidence });

// ---------------------------------------------------------------- occupation

export const OCCUPATION_TERMS: TermTable<string>[] = [
  {
    value: 'farmer',
    terms: [
      t('farmer', 'en', 0.95), t('farming', 'en', 0.85), t('cultivator', 'en'),
      t('agriculture', 'en', 0.7), t('agricultural labour', 'en', 0.8),
      t('किसान', 'hi', 0.95), t('खेती', 'hi', 0.8),
      t('రైతు', 'te', 0.95), t('రైతుని', 'te', 0.95), t('వ్యవసాయ', 'te', 0.8),
      t('kisan', 'romanised', 0.9), t('raithu', 'romanised', 0.9), t('kheti', 'romanised', 0.8),
    ],
  },
  {
    value: 'student',
    terms: [
      t('student', 'en', 0.95), t('studying', 'en', 0.85), t('school', 'en', 0.6),
      t('छात्र', 'hi', 0.95), t('विद्यार्थी', 'hi', 0.95), t('पढ़ाई', 'hi', 0.8),
      t('విద్యార్థి', 'te', 0.95), t('చదువు', 'te', 0.8),
      t('vidyarthi', 'romanised', 0.9), t('padhai', 'romanised', 0.8),
    ],
  },
  {
    value: 'labourer',
    terms: [
      t('labourer', 'en', 0.9), t('laborer', 'en', 0.9), t('daily wage', 'en', 0.9),
      t('construction worker', 'en', 0.95), t('mazdoor', 'romanised', 0.9),
      t('मजदूर', 'hi', 0.95), t('కూలీ', 'te', 0.9),
    ],
  },
  {
    value: 'weaver',
    terms: [
      t('weaver', 'en', 0.95), t('handloom', 'en', 0.8), t('बुनकर', 'hi', 0.95),
      t('నేత', 'te', 0.85), t('bunkar', 'romanised', 0.95),
    ],
  },
  {
    value: 'fisherman',
    terms: [t('fisherman', 'en', 0.95), t('fisherwoman', 'en', 0.95), t('मछुआरा', 'hi', 0.95), t('మత్స్యకార', 'te', 0.9)],
  },
  {
    value: 'shopkeeper',
    terms: [
      t('shopkeeper', 'en', 0.95), t('street vendor', 'en', 0.95), t('small shop', 'en', 0.8),
      t('street vending', 'en', 0.95), t('vending stall', 'en', 0.9), t('vendor', 'en', 0.85),
      t('दुकानदार', 'hi', 0.95), t('దుకాణ', 'te', 0.85),
    ],
  },
  {
    value: 'artisan',
    terms: [t('artisan', 'en', 0.95), t('craftsman', 'en', 0.9), t('कारीगर', 'hi', 0.95), t('చేతివృత్తి', 'te', 0.85)],
  },
  {
    value: 'teacher',
    terms: [t('teacher', 'en', 0.95), t('शिक्षक', 'hi', 0.95), t('ఉపాధ్యాయ', 'te', 0.9)],
  },
  {
    value: 'entrepreneur',
    terms: [t('entrepreneur', 'en', 0.9), t('own business', 'en', 0.85), t('self employed', 'en', 0.85)],
  },
];

// ---------------------------------------------------------------- social category

export const CATEGORY_TERMS: TermTable<string>[] = [
  {
    value: 'sc',
    terms: [
      t('scheduled caste', 'en', 0.95), t('sc', 'en', 0.75),
      t('अनुसूचित जाति', 'hi', 0.95), t('ఎస్సీ', 'te', 0.9),
    ],
  },
  {
    value: 'st',
    terms: [
      t('scheduled tribe', 'en', 0.95), t('st', 'en', 0.7),
      t('अनुसूचित जनजाति', 'hi', 0.95), t('ఎస్టీ', 'te', 0.9),
    ],
  },
  {
    value: 'obc',
    terms: [
      t('obc', 'en', 0.95), t('other backward', 'en', 0.95), t('backward class', 'en', 0.85),
      t('ओबीसी', 'hi', 0.95), t('ఓబీసీ', 'te', 0.9), t('బీసీ', 'te', 0.85),
    ],
  },
  {
    value: 'ews',
    terms: [t('ews', 'en', 0.9), t('economically weaker', 'en', 0.95)],
  },
  {
    value: 'general',
    terms: [t('general category', 'en', 0.9), t('सामान्य वर्ग', 'hi', 0.9)],
  },
];

// ---------------------------------------------------------------- special categories

export const SPECIAL_TERMS: TermTable<string>[] = [
  {
    value: 'bpl',
    terms: [
      t('below poverty line', 'en', 0.95), t('bpl', 'en', 0.9), t('bpl card', 'en', 0.95),
      t('antyodaya', 'en', 0.9), t('गरीबी रेखा', 'hi', 0.95), t('పేదరిక', 'te', 0.85),
    ],
  },
  {
    value: 'widow',
    terms: [
      t('widow', 'en', 0.95), t('widowed', 'en', 0.95),
      t('विधवा', 'hi', 0.95), t('వితంతువు', 'te', 0.95),
      t('vidhwa', 'romanised', 0.95), t('vidhava', 'romanised', 0.9),
    ],
  },
  {
    value: 'differently_abled',
    terms: [
      t('disabled', 'en', 0.9), t('differently abled', 'en', 0.95), t('divyang', 'romanised', 0.95),
      t('handicapped', 'en', 0.9), t('दिव्यांग', 'hi', 0.95), t('వికలాంగ', 'te', 0.9),
    ],
  },
  {
    value: 'landless',
    terms: [
      t('landless', 'en', 0.95), t('no land', 'en', 0.9), t('own no land', 'en', 0.95),
      t('भूमिहीन', 'hi', 0.95),
      t('koi zameen nahi', 'romanised', 0.95), t('zameen nahi', 'romanised', 0.9),
    ],
  },
  {
    value: 'ex_serviceman',
    terms: [t('ex-serviceman', 'en', 0.95), t('ex serviceman', 'en', 0.95), t('retired army', 'en', 0.85)],
  },
  {
    value: 'orphan',
    terms: [t('orphan', 'en', 0.95), t('अनाथ', 'hi', 0.95), t('అనాథ', 'te', 0.95)],
  },
  {
    value: 'senior_citizen',
    terms: [t('senior citizen', 'en', 0.9), t('वरिष्ठ नागरिक', 'hi', 0.9)],
  },
];

// ---------------------------------------------------------------- gender

export const GENDER_TERMS: TermTable<string>[] = [
  {
    value: 'female',
    terms: [
      t('woman', 'en', 0.9), t('female', 'en', 0.9), t('housewife', 'en', 0.85),
      t('महिला', 'hi', 0.95), t('औरत', 'hi', 0.9),
      t('మహిళ', 'te', 0.95), t('స్త్రీ', 'te', 0.95),
      t('mahila', 'romanised', 0.9),
    ],
  },
  {
    value: 'male',
    terms: [t('man', 'en', 0.6), t('male', 'en', 0.9), t('पुरुष', 'hi', 0.95), t('పురుషుడు', 'te', 0.95)],
  },
];

// ---------------------------------------------------------------- residence

export const RESIDENCE_TERMS: TermTable<string>[] = [
  {
    value: 'rural',
    terms: [
      t('village', 'en', 0.9), t('rural', 'en', 0.95), t('gaon', 'romanised', 0.9),
      t('गांव', 'hi', 0.95), t('गाँव', 'hi', 0.95), t('ग्रामीण', 'hi', 0.95),
      t('గ్రామ', 'te', 0.9), t('పల్లె', 'te', 0.9),
    ],
  },
  {
    value: 'urban',
    terms: [
      t('city', 'en', 0.85), t('urban', 'en', 0.95), t('town', 'en', 0.75),
      t('शहर', 'hi', 0.9), t('నగర', 'te', 0.85), t('shahar', 'romanised', 0.9),
      t('sheher', 'romanised', 0.9),
    ],
  },
];

// ---------------------------------------------------------------- relations

/** Words that introduce a household member rather than the applicant. */
export const RELATION_TERMS: TermTable<string>[] = [
  {
    value: 'daughter',
    terms: [
      t('daughter', 'en', 0.95), t('girl child', 'en', 0.9), t('my girl', 'en', 0.8),
      t('बेटी', 'hi', 0.95), t('लड़की', 'hi', 0.85),
      t('అమ్మాయి', 'te', 0.9), t('కూతురు', 'te', 0.95),
      t('beti', 'romanised', 0.9), t('ladki', 'romanised', 0.85),
    ],
  },
  {
    value: 'son',
    terms: [
      t('son', 'en', 0.95), t('boy child', 'en', 0.85),
      t('बेटा', 'hi', 0.95), t('अब्बा', 'hi', 0.5),
      t('అబ్బాయి', 'te', 0.9), t('కొడుకు', 'te', 0.95),
      t('beta', 'romanised', 0.85),
    ],
  },
  {
    value: 'child',
    terms: [
      t('child', 'en', 0.85), t('children', 'en', 0.85), t('kid', 'en', 0.7),
      t('बच्चा', 'hi', 0.9), t('बच्चे', 'hi', 0.9), t('పిల్ల', 'te', 0.9),
    ],
  },
];

// ---------------------------------------------------------------- education

/**
 * Education stages. The class number is parsed separately; these are the words
 * that say a class number is about schooling at all.
 */
export const EDUCATION_WORDS: Term[] = [
  t('class', 'en', 0.9), t('standard', 'en', 0.85), t('grade', 'en', 0.85), t('std', 'en', 0.8),
  t('कक्षा', 'hi', 0.95), t('तरगती', 'hi', 0.7),
  t('తరగతి', 'te', 0.95),
  t('kaksha', 'romanised', 0.9), t('class', 'romanised', 0.85),
];

export const EDUCATION_STAGE_TERMS: TermTable<string>[] = [
  {
    value: 'undergraduate',
    terms: [
      t('undergraduate', 'en', 0.95), t('b.tech', 'en', 0.9), t('btech', 'en', 0.9),
      t('bachelor', 'en', 0.9), t('degree college', 'en', 0.85), t('engineering', 'en', 0.7),
      t('स्नातक', 'hi', 0.9), t('డిగ్రీ', 'te', 0.85),
    ],
  },
  {
    value: 'postgraduate',
    terms: [
      t('postgraduate', 'en', 0.95), t('m.tech', 'en', 0.9), t('masters', 'en', 0.9),
      t('post graduate', 'en', 0.95), t('परास्नातक', 'hi', 0.9),
    ],
  },
  {
    value: 'class_11_12',
    terms: [t('intermediate', 'en', 0.85), t('junior college', 'en', 0.85), t('इंटर', 'hi', 0.8)],
  },
];

/** Map a school class number onto the stage the corpus uses. */
export function stageForClass(n: number): string | null {
  if (n >= 1 && n <= 5) return 'class_1_5';
  if (n >= 6 && n <= 8) return 'class_6_8';
  if (n >= 9 && n <= 10) return 'class_9_10';
  if (n >= 11 && n <= 12) return 'class_11_12';
  return null;
}

// ---------------------------------------------------------------- states

/**
 * State names in each script, plus the common short forms citizens actually
 * type. Keyed to the canonical lowercase English name used in the corpus.
 */
export const STATE_TERMS: TermTable<string>[] = [
  { value: 'telangana', terms: [t('telangana', 'en', 0.95), t('तेलंगाना', 'hi', 0.95), t('తెలంగాణ', 'te', 0.95)] },
  { value: 'andhra pradesh', terms: [t('andhra pradesh', 'en', 0.95), t('andhra', 'en', 0.9), t('आंध्र प्रदेश', 'hi', 0.95), t('ఆంధ్రప్రదేశ్', 'te', 0.95)] },
  { value: 'bihar', terms: [t('bihar', 'en', 0.95), t('बिहार', 'hi', 0.95)] },
  { value: 'uttar pradesh', terms: [t('uttar pradesh', 'en', 0.95), t('up', 'en', 0.4), t('उत्तर प्रदेश', 'hi', 0.95)] },
  { value: 'maharashtra', terms: [t('maharashtra', 'en', 0.95), t('महाराष्ट्र', 'hi', 0.95)] },
  { value: 'tamil nadu', terms: [t('tamil nadu', 'en', 0.95), t('tamilnadu', 'en', 0.95), t('तमिलनाडु', 'hi', 0.95)] },
  { value: 'karnataka', terms: [t('karnataka', 'en', 0.95), t('कर्नाटक', 'hi', 0.95)] },
  { value: 'kerala', terms: [t('kerala', 'en', 0.95), t('केरल', 'hi', 0.95)] },
  { value: 'odisha', terms: [t('odisha', 'en', 0.95), t('orissa', 'en', 0.9), t('ओडिशा', 'hi', 0.95)] },
  { value: 'west bengal', terms: [t('west bengal', 'en', 0.95), t('पश्चिम बंगाल', 'hi', 0.95)] },
  { value: 'rajasthan', terms: [t('rajasthan', 'en', 0.95), t('राजस्थान', 'hi', 0.95)] },
  { value: 'gujarat', terms: [t('gujarat', 'en', 0.95), t('गुजरात', 'hi', 0.95)] },
  { value: 'madhya pradesh', terms: [t('madhya pradesh', 'en', 0.95), t('मध्य प्रदेश', 'hi', 0.95)] },
  { value: 'punjab', terms: [t('punjab', 'en', 0.95), t('पंजाब', 'hi', 0.95)] },
  { value: 'haryana', terms: [t('haryana', 'en', 0.95), t('हरियाणा', 'hi', 0.95)] },
  { value: 'assam', terms: [t('assam', 'en', 0.95), t('असम', 'hi', 0.95)] },
  { value: 'jharkhand', terms: [t('jharkhand', 'en', 0.95), t('झारखंड', 'hi', 0.95)] },
  { value: 'chhattisgarh', terms: [t('chhattisgarh', 'en', 0.95), t('छत्तीसगढ़', 'hi', 0.95)] },
  { value: 'delhi', terms: [t('delhi', 'en', 0.9), t('दिल्ली', 'hi', 0.95)] },
  { value: 'goa', terms: [t('goa', 'en', 0.9), t('गोवा', 'hi', 0.95)] },
  { value: 'uttarakhand', terms: [t('uttarakhand', 'en', 0.95), t('उत्तराखंड', 'hi', 0.95)] },
  { value: 'himachal pradesh', terms: [t('himachal', 'en', 0.9), t('हिमाचल', 'hi', 0.95)] },
  { value: 'puducherry', terms: [t('puducherry', 'en', 0.95), t('pondicherry', 'en', 0.9)] },
  { value: 'meghalaya', terms: [t('meghalaya', 'en', 0.95)] },
  { value: 'manipur', terms: [t('manipur', 'en', 0.95)] },
  { value: 'tripura', terms: [t('tripura', 'en', 0.95)] },
  { value: 'nagaland', terms: [t('nagaland', 'en', 0.95)] },
  { value: 'mizoram', terms: [t('mizoram', 'en', 0.95)] },
  { value: 'sikkim', terms: [t('sikkim', 'en', 0.95)] },
  { value: 'arunachal pradesh', terms: [t('arunachal', 'en', 0.9)] },
  { value: 'jammu and kashmir', terms: [t('jammu', 'en', 0.85), t('kashmir', 'en', 0.85)] },
  { value: 'ladakh', terms: [t('ladakh', 'en', 0.95)] },
  { value: 'chandigarh', terms: [t('chandigarh', 'en', 0.95)] },
  { value: 'lakshadweep', terms: [t('lakshadweep', 'en', 0.95)] },
];
