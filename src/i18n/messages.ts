/**
 * UI strings.
 *
 * Adding a language is appending a key to `MESSAGES` and a row to `LOCALES` —
 * no component changes, which is what the brief required.
 *
 * Two rules the translations must keep:
 *
 *   Scheme names are NEVER translated. A citizen who searches for "PM-KISAN"
 *   must find PM-KISAN; a translated legal name is unsearchable and cannot be
 *   quoted at an office. Names render in the original with the translation, if
 *   any, alongside.
 *
 *   Numerals stay Western Arabic. Indian government forms and portals use them,
 *   so a citizen copying a figure into an application needs the same digits.
 */

export const LOCALES = [
  { code: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', dir: 'ltr' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', dir: 'ltr' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', dir: 'ltr' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', dir: 'ltr' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ', dir: 'ltr' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(x: string): x is Locale {
  return LOCALES.some((l) => l.code === x);
}

export interface Messages {
  title: string;
  tagline: string;
  placeholder: string;
  find: string;
  searching: string;
  listen: string;
  listening: string;
  autoSearchHint: string;
  aiSummary: string;
  aiWrittenBy: string;
  aiDeterministic: string;
  understood: string;
  understoodHelp: string;
  notStated: string;
  edit: string;
  save: string;
  cancel: string;
  eligible: string;
  eligibleHelp: string;
  likely: string;
  likelyHelp: string;
  notEligible: string;
  whyThis: string;
  hideWhy: string;
  satisfied: string;
  violated: string;
  unknown: string;
  unverified: string;
  unverifiedHelp: string;
  tellUs: string;
  documents: string;
  applyAt: string;
  noResults: string;
  noResultsHelp: string;
  nothingApproved: string;
  disclaimer: string;
  sourceNote: string;
  language: string;
  startOver: string;
  simulated: string;
  simulatedHelp: string;

  /* Optional accounts. Every string here has to make "optional" unmistakable. */
  optional: string;
  accountLink: string;
  accountTitle: string;
  accountNotNeeded: string;
  backToSearch: string;
  signIn: string;
  signOut: string;
  createAccount: string;
  haveAccount: string;
  noAccount: string;
  username: string;
  password: string;
  saveDetails: string;
  saveDetailsHelp: string;
  savingDetails: string;
  detailsSaved: string;
  useSavedDetails: string;
  savedNothingYet: string;
  forgetDetails: string;
  deleteAccount: string;
  deleteAccountHelp: string;
  whatWeStore: string;
  reviewerLink: string;

  /* Hero and the trust strip under it. */
  heroTitle: string;
  trustSource: string;
  trustQuote: string;
  trustNoAccount: string;
  speechCountdown: string;
  inputLabel: string;
  stopSpeaking: string;

  /* The welcome screen. */
  welcomeLead: string;
  continueWithout: string;
  continueWithoutHelp: string;
  signInHelp: string;
  createAccountHelp: string;
  or: string;
  summaryTitle: string;
  summaryNote: string;

  /* Speech. Every one of these is a sentence shown to a citizen whose
     microphone did not work, so each has to say what to do next. */
  speechBlocked: string;
  speechNoMic: string;
  speechNetwork: string;
  speechNotHeard: string;
  speechFailed: string;
  speechInsecure: string;
  clearInput: string;

  /* Hero examples — a citizen staring at an empty box is the commonest way
     this product fails, and one tap of a worked example fixes it. */
  examplesLabel: string;
  exampleOne: string;
  exampleTwo: string;
  exampleThree: string;

  /* Results furniture. */
  evidenceLabel: string;
  conditionsTitle: string;
}

const en: Messages = {
  title: 'YojanaMitra',
  tagline: 'Tell us about yourself. We will tell you which government schemes you qualify for — and exactly why.',
  placeholder: 'For example: I am 33, a farmer in Telangana with 1.5 acres, my yearly income is about 1.5 lakh',
  find: 'Find my schemes',
  searching: 'Checking schemes…',
  listen: 'Speak instead',
  listening: 'Listening — speak now',
  autoSearchHint: 'Take your time. We search on our own after 5 seconds of quiet.',
  aiSummary: 'In short',
  aiWrittenBy: 'Wording by',
  aiDeterministic: 'Wording generated without a language model.',
  understood: 'What we understood about you',
  understoodHelp: 'Change anything that is wrong. Results update as you correct them.',
  notStated: 'not stated',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  eligible: 'You qualify',
  eligibleHelp: 'Every condition we could check is met.',
  likely: 'You may qualify',
  likelyHelp: 'Nothing ruled you out, but something is still unverified.',
  notEligible: 'You do not qualify',
  whyThis: 'Why?',
  hideWhy: 'Hide',
  satisfied: 'Met',
  violated: 'Not met',
  unknown: 'Not known',
  unverified: 'Not yet verified by a person',
  unverifiedHelp: 'This condition has not been checked by a human reviewer, so it did not count either way.',
  tellUs: 'Tell us your',
  documents: 'Documents you will need',
  applyAt: 'Official page',
  noResults: 'No schemes matched',
  noResultsHelp: 'Try adding more about yourself — your state, work, income or family.',
  nothingApproved:
    'No eligibility condition in this corpus has been verified by a person yet, so nothing can be decided. This is deliberate: the system will not guess.',
  disclaimer: 'This is guidance, not an official decision. Always confirm on the official page.',
  sourceNote: 'Scheme information from',
  language: 'Language',
  startOver: 'Start over',
  simulated: 'Demonstration mode',
  simulatedHelp:
    'No person has approved these conditions. Results are for testing the system only and must not be relied on.',

  optional: 'Optional',
  accountLink: 'Saved details',
  accountTitle: 'Your saved details',
  accountNotNeeded:
    'You do not need an account. Searching works without one, and always will. An account only saves your details so you do not have to type them again next time.',
  backToSearch: '← Back to search',
  signIn: 'Sign in',
  signOut: 'Sign out',
  createAccount: 'Create an account',
  haveAccount: 'Already have one? Sign in',
  noAccount: 'No account yet? Create one',
  username: 'Username',
  password: 'Password',
  saveDetails: 'Save these details',
  saveDetailsHelp: 'So you do not have to type them again. You can delete them at any time.',
  savingDetails: 'Saving…',
  detailsSaved: 'Saved',
  useSavedDetails: 'Use my saved details',
  savedNothingYet: 'Nothing saved yet. Run a search, then press “Save these details”.',
  forgetDetails: 'Delete my saved details',
  deleteAccount: 'Close my account',
  deleteAccountHelp: 'This deletes the account and everything saved in it. It cannot be undone.',
  whatWeStore:
    'We store only the facts shown above — never the sentence you typed or spoke, and never a recording.',
  reviewerLink: 'Reviewer sign-in',

  heroTitle: 'Find the schemes you qualify for.',
  trustSource: 'Read from the official scheme documents',
  trustQuote: 'Every answer quotes the exact rule',
  trustNoAccount: 'No account needed',
  speechCountdown: 'Searching in',
  inputLabel: 'Tell us about yourself',
  stopSpeaking: 'Stop and search',

  welcomeLead: 'Describe your situation in your own words and find out which government schemes you qualify for — and exactly why.',
  continueWithout: 'Continue without signing in',
  continueWithoutHelp: 'Go straight to the search. Nothing is saved and nothing is asked.',
  signInHelp: 'Bring back the details you saved last time.',
  createAccountHelp: 'So you never have to type your details twice.',
  or: 'or',
  summaryTitle: 'What you qualify for',
  summaryNote: 'The schemes themselves were decided by the rule engine, not by a model.',

  speechBlocked:
    'Your browser is not letting us use the microphone. Tap the lock icon beside the web address, allow the microphone, then try again. You can also just type instead.',
  speechNoMic: 'We could not find a microphone on this device. Please type instead.',
  speechNetwork:
    'Speech needs an internet connection and yours seems to have dropped. Please try again, or type instead.',
  speechNotHeard: 'We did not hear anything, so nothing was searched. Tap “Speak instead” to try again.',
  speechFailed: 'Speech stopped working on this device. Please type instead — it works exactly the same.',
  speechInsecure: 'Speaking needs a secure (https) connection, so it is turned off here. Typing works normally.',
  clearInput: 'Clear',

  examplesLabel: 'Not sure what to write? Tap an example:',
  exampleOne: 'I am 33, a farmer in Telangana with 1.5 acres, my yearly income is about 1.5 lakh',
  exampleTwo: 'I am a 22-year-old woman, final year BSc student in Bihar, family income 80,000 a year',
  exampleThree: 'I am 64, a retired daily wage worker in Uttar Pradesh with no land and no pension',

  evidenceLabel: 'Quoted from the scheme document',
  conditionsTitle: 'Conditions we checked',
};

const hi: Messages = {
  ...en,
  tagline: 'अपने बारे में बताइए। हम बताएंगे कि आप किन सरकारी योजनाओं के लिए पात्र हैं — और क्यों।',
  placeholder: 'जैसे: मैं 33 साल का किसान हूँ, तेलंगाना में 1.5 एकड़ ज़मीन है, सालाना आय लगभग 1.5 लाख',
  find: 'मेरी योजनाएं खोजें',
  searching: 'योजनाएं देखी जा रही हैं…',
  listen: 'बोलकर बताएं',
  listening: 'सुन रहे हैं — अब बोलिए',
  autoSearchHint: 'आराम से बोलिए। 5 सेकंड चुप रहने पर हम अपने आप खोज लेंगे।',
  aiSummary: 'संक्षेप में',
  understood: 'हमने आपके बारे में यह समझा',
  understoodHelp: 'जो गलत हो उसे बदलिए। सुधार करते ही परिणाम बदल जाएंगे।',
  notStated: 'नहीं बताया',
  edit: 'बदलें',
  save: 'सहेजें',
  cancel: 'रद्द करें',
  eligible: 'आप पात्र हैं',
  eligibleHelp: 'जितनी शर्तें हम जांच सके, सब पूरी हैं।',
  likely: 'आप पात्र हो सकते हैं',
  likelyHelp: 'कोई शर्त फेल नहीं हुई, पर कुछ अभी अनिश्चित है।',
  notEligible: 'आप पात्र नहीं हैं',
  whyThis: 'क्यों?',
  hideWhy: 'छिपाएं',
  satisfied: 'पूरी',
  violated: 'पूरी नहीं',
  unknown: 'पता नहीं',
  unverified: 'अभी किसी व्यक्ति ने जांचा नहीं',
  tellUs: 'हमें बताइए आपका',
  documents: 'ज़रूरी दस्तावेज़',
  applyAt: 'आधिकारिक पेज',
  noResults: 'कोई योजना नहीं मिली',
  noResultsHelp: 'अपने बारे में और बताइए — राज्य, काम, आय या परिवार।',
  disclaimer: 'यह मार्गदर्शन है, आधिकारिक निर्णय नहीं। आधिकारिक पेज पर ज़रूर पुष्टि करें।',
  sourceNote: 'योजना जानकारी का स्रोत',
  language: 'भाषा',
  startOver: 'फिर से शुरू करें',

  optional: 'वैकल्पिक',
  accountLink: 'सहेजी गई जानकारी',
  accountTitle: 'आपकी सहेजी गई जानकारी',
  accountNotNeeded:
    'खाता बनाना ज़रूरी नहीं है। बिना खाते के भी खोज चलती है और हमेशा चलेगी। खाता सिर्फ़ आपकी जानकारी सहेजता है ताकि अगली बार दोबारा टाइप न करना पड़े।',
  backToSearch: '← खोज पर वापस',
  signIn: 'साइन इन',
  signOut: 'साइन आउट',
  createAccount: 'खाता बनाएं',
  haveAccount: 'पहले से खाता है? साइन इन करें',
  noAccount: 'खाता नहीं है? बनाएं',
  username: 'उपयोगकर्ता नाम',
  password: 'पासवर्ड',
  saveDetails: 'यह जानकारी सहेजें',
  saveDetailsHelp: 'ताकि दोबारा टाइप न करना पड़े। आप इसे कभी भी हटा सकते हैं।',
  savingDetails: 'सहेजा जा रहा है…',
  detailsSaved: 'सहेज लिया',
  useSavedDetails: 'मेरी सहेजी गई जानकारी इस्तेमाल करें',
  savedNothingYet: 'अभी कुछ सहेजा नहीं है। पहले खोजें, फिर “यह जानकारी सहेजें” दबाएं।',
  forgetDetails: 'सहेजी गई जानकारी हटाएं',
  deleteAccount: 'खाता बंद करें',
  deleteAccountHelp: 'इससे खाता और उसमें सहेजी सारी जानकारी मिट जाएगी। यह वापस नहीं आएगी।',
  whatWeStore:
    'हम सिर्फ़ ऊपर दिखाई गई बातें सहेजते हैं — आपने जो वाक्य लिखा या बोला वह नहीं, और कोई रिकॉर्डिंग नहीं।',
  reviewerLink: 'समीक्षक साइन इन',

  heroTitle: 'जानिए आप किन योजनाओं के पात्र हैं।',
  trustSource: 'आधिकारिक योजना दस्तावेज़ों से लिया गया',
  trustQuote: 'हर जवाब में असली नियम उद्धृत होता है',
  trustNoAccount: 'खाते की ज़रूरत नहीं',
  speechCountdown: 'खोज शुरू होगी',
  inputLabel: 'अपने बारे में बताइए',
  stopSpeaking: 'रोककर खोजें',

  welcomeLead: 'अपने शब्दों में अपनी स्थिति बताइए और जानिए आप किन सरकारी योजनाओं के पात्र हैं — और क्यों।',
  continueWithout: 'बिना साइन इन के आगे बढ़ें',
  continueWithoutHelp: 'सीधे खोज पर जाइए। कुछ सहेजा नहीं जाता, कुछ पूछा नहीं जाता।',
  signInHelp: 'पिछली बार सहेजी गई जानकारी वापस लाइए।',
  createAccountHelp: 'ताकि जानकारी दोबारा टाइप न करनी पड़े।',
  or: 'या',
  summaryTitle: 'आप किनके पात्र हैं',
  summaryNote: 'योजनाएं नियम-इंजन ने तय की हैं, किसी मॉडल ने नहीं।',

  speechBlocked:
    'ब्राउज़र माइक्रोफ़ोन इस्तेमाल करने नहीं दे रहा। पते के पास बने ताले के निशान पर टैप कर माइक्रोफ़ोन की अनुमति दें, फिर दोबारा कोशिश करें। आप टाइप भी कर सकते हैं।',
  speechNoMic: 'इस डिवाइस पर माइक्रोफ़ोन नहीं मिला। कृपया टाइप करें।',
  speechNetwork: 'बोलने के लिए इंटरनेट ज़रूरी है और वह टूट गया लगता है। दोबारा कोशिश करें या टाइप करें।',
  speechNotHeard: 'हमें कुछ सुनाई नहीं दिया, इसलिए कोई खोज नहीं हुई। “बोलकर बताइए” पर दोबारा टैप करें।',
  speechFailed: 'इस डिवाइस पर बोलना काम नहीं कर रहा। कृपया टाइप करें — नतीजा वही रहेगा।',
  speechInsecure: 'बोलने के लिए सुरक्षित (https) कनेक्शन चाहिए, इसलिए यह बंद है। टाइप करना सामान्य रूप से काम करता है।',
  clearInput: 'मिटाएं',

  examplesLabel: 'समझ नहीं आ रहा क्या लिखें? किसी उदाहरण पर टैप करें:',
  exampleOne: 'मैं 33 साल का किसान हूँ, तेलंगाना में 1.5 एकड़ ज़मीन है, सालाना आय लगभग 1.5 लाख',
  exampleTwo: 'मैं 22 साल की हूँ, बिहार में बीएससी अंतिम वर्ष की छात्रा, परिवार की सालाना आय 80,000',
  exampleThree: 'मैं 64 साल का हूँ, उत्तर प्रदेश में दिहाड़ी मज़दूरी करता था, ज़मीन नहीं है और पेंशन नहीं है',

  evidenceLabel: 'योजना दस्तावेज़ से उद्धृत',
  conditionsTitle: 'जिन शर्तों की जांच हुई',
};

const te: Messages = {
  ...en,
  tagline: 'మీ గురించి చెప్పండి. మీరు ఏ ప్రభుత్వ పథకాలకు అర్హులో — ఎందుకో సహా — చెబుతాం.',
  placeholder: 'ఉదాహరణ: నేను 33 ఏళ్ల రైతుని, తెలంగాణలో 1.5 ఎకరాలు, సంవత్సర ఆదాయం సుమారు 1.5 లక్ష',
  find: 'నా పథకాలు చూపించు',
  searching: 'పథకాలు చూస్తున్నాం…',
  listen: 'మాట్లాడి చెప్పండి',
  listening: 'వింటున్నాం — ఇప్పుడు మాట్లాడండి',
  autoSearchHint: 'తీరిగ్గా చెప్పండి. 5 సెకన్ల నిశ్శబ్దం తర్వాత మేమే వెతుకుతాం.',
  aiSummary: 'క్లుప్తంగా',
  understood: 'మీ గురించి మేము అర్థం చేసుకున్నది',
  understoodHelp: 'తప్పు ఉంటే మార్చండి. మార్చగానే ఫలితాలు మారతాయి.',
  notStated: 'చెప్పలేదు',
  edit: 'మార్చు',
  save: 'భద్రపరచు',
  cancel: 'రద్దు',
  eligible: 'మీరు అర్హులు',
  eligibleHelp: 'మేము తనిఖీ చేయగలిగిన అన్ని షరతులు నెరవేరాయి.',
  likely: 'మీరు అర్హులు కావచ్చు',
  likelyHelp: 'ఏదీ మిమ్మల్ని తిరస్కరించలేదు, కానీ కొంత ఇంకా నిర్ధారణ కాలేదు.',
  notEligible: 'మీరు అర్హులు కాదు',
  whyThis: 'ఎందుకు?',
  hideWhy: 'దాచు',
  satisfied: 'నెరవేరింది',
  violated: 'నెరవేరలేదు',
  unknown: 'తెలియదు',
  unverified: 'ఇంకా ఎవరూ ధృవీకరించలేదు',
  tellUs: 'మీ వివరాలు చెప్పండి',
  documents: 'కావలసిన పత్రాలు',
  applyAt: 'అధికారిక పేజీ',
  noResults: 'పథకాలు దొరకలేదు',
  noResultsHelp: 'మీ గురించి మరింత చెప్పండి — రాష్ట్రం, పని, ఆదాయం లేదా కుటుంబం.',
  disclaimer: 'ఇది మార్గదర్శకం మాత్రమే, అధికారిక నిర్ణయం కాదు. అధికారిక పేజీలో నిర్ధారించుకోండి.',
  sourceNote: 'పథక సమాచార మూలం',
  language: 'భాష',
  startOver: 'మళ్ళీ ప్రారంభించు',

  optional: 'ఐచ్ఛికం',
  accountLink: 'భద్రపరచిన వివరాలు',
  accountTitle: 'మీరు భద్రపరచిన వివరాలు',
  accountNotNeeded:
    'ఖాతా అవసరం లేదు. ఖాతా లేకుండానే వెతకవచ్చు, ఎప్పటికీ అలాగే ఉంటుంది. మళ్ళీ టైప్ చేయకుండా ఉండేందుకు మాత్రమే ఖాతా మీ వివరాలను భద్రపరుస్తుంది.',
  backToSearch: '← వెతుకులాటకు తిరిగి',
  signIn: 'సైన్ ఇన్',
  signOut: 'సైన్ అవుట్',
  createAccount: 'ఖాతా సృష్టించు',
  haveAccount: 'ఇప్పటికే ఖాతా ఉందా? సైన్ ఇన్ చేయండి',
  noAccount: 'ఖాతా లేదా? సృష్టించండి',
  username: 'వినియోగదారు పేరు',
  password: 'పాస్‌వర్డ్',
  saveDetails: 'ఈ వివరాలను భద్రపరచు',
  saveDetailsHelp: 'మళ్ళీ టైప్ చేయకుండా ఉండేందుకు. ఎప్పుడైనా తొలగించవచ్చు.',
  savingDetails: 'భద్రపరుస్తోంది…',
  detailsSaved: 'భద్రపరచబడింది',
  useSavedDetails: 'నా భద్రపరచిన వివరాలు వాడు',
  savedNothingYet: 'ఇంకా ఏమీ భద్రపరచలేదు. ముందు వెతకండి, తరువాత “ఈ వివరాలను భద్రపరచు” నొక్కండి.',
  forgetDetails: 'భద్రపరచిన వివరాలు తొలగించు',
  deleteAccount: 'ఖాతా మూసివేయి',
  deleteAccountHelp: 'ఇది ఖాతాను, అందులోని అన్ని వివరాలను తొలగిస్తుంది. తిరిగి పొందలేరు.',
  whatWeStore:
    'పైన చూపిన విషయాలు మాత్రమే భద్రపరుస్తాం — మీరు రాసిన లేదా చెప్పిన వాక్యం కాదు, రికార్డింగ్ అసలే కాదు.',
  reviewerLink: 'సమీక్షకుల సైన్ ఇన్',

  heroTitle: 'మీరు అర్హులైన పథకాలను తెలుసుకోండి.',
  trustSource: 'అధికారిక పథక పత్రాల నుండి తీసుకున్నది',
  trustQuote: 'ప్రతి సమాధానం అసలు నిబంధనను ఉటంకిస్తుంది',
  trustNoAccount: 'ఖాతా అవసరం లేదు',
  speechCountdown: 'వెతకడం మొదలవుతుంది',
  inputLabel: 'మీ గురించి చెప్పండి',
  stopSpeaking: 'ఆపి వెతుకు',

  welcomeLead: 'మీ మాటల్లో మీ పరిస్థితి చెప్పండి — మీరు ఏ ప్రభుత్వ పథకాలకు అర్హులో, ఎందుకో తెలుసుకోండి.',
  continueWithout: 'సైన్ ఇన్ లేకుండా కొనసాగండి',
  continueWithoutHelp: 'నేరుగా వెతుకులాటకు వెళ్లండి. ఏదీ భద్రపరచబడదు, ఏదీ అడగబడదు.',
  signInHelp: 'గత సారి భద్రపరచిన వివరాలను తిరిగి తెచ్చుకోండి.',
  createAccountHelp: 'వివరాలు మళ్ళీ టైప్ చేయకుండా ఉండేందుకు.',
  or: 'లేదా',
  summaryTitle: 'మీరు దేనికి అర్హులు',
  summaryNote: 'పథకాలను రూల్ ఇంజిన్ నిర్ణయించింది, ఏ మోడల్ కాదు.',

  speechBlocked:
    'మైక్రోఫోన్ వాడటానికి బ్రౌజర్ అనుమతించడం లేదు. చిరునామా పక్కన ఉన్న లాక్ గుర్తును నొక్కి మైక్రోఫోన్‌కు అనుమతి ఇవ్వండి, తర్వాత మళ్ళీ ప్రయత్నించండి. టైప్ చేయడం కూడా పని చేస్తుంది.',
  speechNoMic: 'ఈ పరికరంలో మైక్రోఫోన్ కనిపించలేదు. దయచేసి టైప్ చేయండి.',
  speechNetwork: 'మాట్లాడటానికి ఇంటర్నెట్ అవసరం, అది ఆగిపోయినట్టుంది. మళ్ళీ ప్రయత్నించండి లేదా టైప్ చేయండి.',
  speechNotHeard: 'మాకు ఏమీ వినిపించలేదు, అందుకే వెతుకులాట జరగలేదు. “మాట్లాడి చెప్పండి” మళ్ళీ నొక్కండి.',
  speechFailed: 'ఈ పరికరంలో మాట్లాడటం పని చేయడం లేదు. దయచేసి టైప్ చేయండి — ఫలితం అదే.',
  speechInsecure: 'మాట్లాడటానికి సురక్షిత (https) కనెక్షన్ కావాలి, అందుకే ఇది ఆఫ్‌లో ఉంది. టైపింగ్ సాధారణంగా పని చేస్తుంది.',
  clearInput: 'తొలగించు',

  examplesLabel: 'ఏమి రాయాలో తెలియలేదా? ఒక ఉదాహరణను నొక్కండి:',
  exampleOne: 'నేను 33 ఏళ్ల రైతుని, తెలంగాణలో 1.5 ఎకరాలు, సంవత్సర ఆదాయం సుమారు 1.5 లక్ష',
  exampleTwo: 'నేను 22 ఏళ్ల మహిళ, బీహార్‌లో బీఎస్సీ చివరి సంవత్సరం విద్యార్థిని, కుటుంబ ఆదాయం ఏడాదికి 80,000',
  exampleThree: 'నాకు 64 ఏళ్లు, ఉత్తరప్రదేశ్‌లో రోజు కూలీ పని చేసేవాడిని, భూమి లేదు, పెన్షన్ లేదు',

  evidenceLabel: 'పథకం పత్రం నుండి ఉటంకించబడింది',
  conditionsTitle: 'మేము పరిశీలించిన షరతులు',
};

/**
 * Tamil, Bengali, Marathi and Kannada currently fall back to English strings.
 *
 * Stated rather than hidden: a half-translated interface that silently mixes
 * languages is worse than an honest English one, and a machine translation of
 * eligibility wording is not something to ship without a speaker reviewing it.
 * The wiring is complete — these need a translator, not a code change.
 */
export const MESSAGES: Record<Locale, Messages> = {
  en,
  hi,
  te,
  ta: en,
  bn: en,
  mr: en,
  kn: en,
};

/** Locales whose strings are still English. The UI says so rather than pretending. */
export const UNTRANSLATED: Locale[] = ['ta', 'bn', 'mr', 'kn'];

export function messagesFor(locale: string): Messages {
  return isLocale(locale) ? MESSAGES[locale] : MESSAGES[DEFAULT_LOCALE];
}

/** Human-readable field labels for the "what we understood" panel. */
export const FIELD_LABELS: Record<string, Record<string, string>> = {
  en: {
    age: 'Age',
    annual_income_inr: 'Yearly income (₹)',
    occupation: 'Work',
    land_acres: 'Land (acres)',
    state: 'State',
    residence: 'Village or city',
    gender: 'Gender',
    category: 'Category',
    education_stage: 'Education',
    special_categories: 'Other circumstances',
    dependents: 'Family members',
  },
  hi: {
    age: 'उम्र',
    annual_income_inr: 'सालाना आय (₹)',
    occupation: 'काम',
    land_acres: 'ज़मीन (एकड़)',
    state: 'राज्य',
    residence: 'गांव या शहर',
    gender: 'लिंग',
    category: 'श्रेणी',
    education_stage: 'शिक्षा',
    special_categories: 'अन्य परिस्थितियां',
    dependents: 'परिवार के सदस्य',
  },
  te: {
    age: 'వయస్సు',
    annual_income_inr: 'సంవత్సర ఆదాయం (₹)',
    occupation: 'పని',
    land_acres: 'భూమి (ఎకరాలు)',
    state: 'రాష్ట్రం',
    residence: 'గ్రామం లేదా నగరం',
    gender: 'లింగం',
    category: 'కేటగిరీ',
    education_stage: 'చదువు',
    special_categories: 'ఇతర పరిస్థితులు',
    dependents: 'కుటుంబ సభ్యులు',
  },
};

export function fieldLabel(locale: string, field: string): string {
  return FIELD_LABELS[locale]?.[field] ?? FIELD_LABELS['en']![field] ?? field;
}
