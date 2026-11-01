/**
 * Local unit words + quantity phrasing for vendor messages and UI.
 * Pure module — no Firebase imports — shared by Cloud Functions and the web client.
 */
export type Lang = 'en' | 'hi' | 'mr';
export type Unit = 'kg' | 'g' | 'pc' | 'bunch' | 'dozen';

export const UNIT_WORDS: Record<Lang, Record<Unit, string>> = {
  en: { kg: 'kg', g: 'g', pc: 'pc', bunch: 'bunch', dozen: 'dozen' },
  hi: { kg: 'किलो', g: 'ग्राम', pc: 'पीस', bunch: 'गड्डी', dozen: 'दर्जन' },
  mr: { kg: 'किलो', g: 'ग्रॅम', pc: 'नग', bunch: 'जुडी', dozen: 'डझन' },
};

/** Spoken fractions of a kilo (value in grams). */
const KILO_PHRASES: Record<Exclude<Lang, 'en'>, Record<number, string>> = {
  hi: { 250: 'पाव', 500: 'आधा किलो', 750: 'पौना किलो', 1500: 'डेढ़ किलो', 2500: 'ढाई किलो' },
  mr: { 250: 'पाव', 500: 'अर्धा किलो', 750: 'पाऊण किलो', 1500: 'दीड किलो', 2500: 'अडीच किलो' },
};

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Convert to grams if weight-based, else null. */
function toGrams(qty: number, unit: Unit): number | null {
  if (unit === 'kg') return Math.round(qty * 1000);
  if (unit === 'g') return Math.round(qty);
  return null;
}

/**
 * "2 किलो", "पाव", "अर्धा किलो", "3 जुडी", "500 g".
 * Weight-based quantities that match a spoken phrase use it; otherwise number + unit word.
 */
export function formatQty(qty: number, unit: Unit, lang: Lang): string {
  const grams = toGrams(qty, unit);
  if (lang !== 'en' && grams !== null && KILO_PHRASES[lang][grams]) {
    return KILO_PHRASES[lang][grams];
  }
  if (lang !== 'en' && unit === 'g' && grams !== null && grams >= 1000 && grams % 1000 === 0) {
    return `${grams / 1000} ${UNIT_WORDS[lang].kg}`;
  }
  return `${trimNum(qty)} ${UNIT_WORDS[lang][unit]}`;
}

export const DAY_NAMES: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  hi: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
  mr: ['रविवार', 'सोमवार', 'मंगळवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
};

/** "HH:mm" → "10" / "10:30" for message copy. */
export function spokenTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}` : String(h12);
}

export interface MessageLine {
  name: string;
  qty: number;
  unit: Unit;
}

export function buildOrderText(opts: {
  lang: Lang;
  vendorName: string;
  dayIndex: number;
  time: string;
  lines: MessageLine[];
}): string {
  const { lang, vendorName, dayIndex, time, lines } = opts;
  const day = DAY_NAMES[lang][dayIndex];
  const list = lines.map((l, i) => `${i + 1}. ${l.name} – ${formatQty(l.qty, l.unit, lang)}`).join('\n');
  const t = spokenTime(time);
  switch (lang) {
    case 'mr':
      return `नमस्कार ${vendorName} 🙏 ${day} ची यादी:\n${list}\nसकाळी ${t} पर्यंत पाठवा. धन्यवाद!`;
    case 'hi':
      return `नमस्ते ${vendorName} 🙏 ${day} की लिस्ट:\n${list}\nसुबह ${t} तक भेज दीजिए। धन्यवाद!`;
    default:
      return `Hello ${vendorName} 🙏 List for ${day}:\n${list}\nPlease deliver by ${t} am. Thank you!`;
  }
}

export function buildReminderText(lang: Lang, vendorName: string): string {
  switch (lang) {
    case 'mr':
      return `${vendorName}, आजची भाजी अजून आली नाही. कधी पर्यंत येईल? 🙏`;
    case 'hi':
      return `${vendorName}, आज की सब्ज़ी अभी तक नहीं आई। कब तक आएगी? 🙏`;
    default:
      return `${vendorName}, today's vegetables haven't arrived yet. When will they come? 🙏`;
  }
}

export function buildShortageText(lang: Lang, itemNames: string[]): string {
  const items = itemNames.join(', ');
  switch (lang) {
    case 'mr':
      return `भाऊ, ${items} आले नाहीत. पुढच्या वेळी पाठवा.`;
    case 'hi':
      return `भैया, ${items} नहीं आए। अगली बार भेज दीजिए।`;
    default:
      return `Bhaiya, ${items} didn't come. Please send next time.`;
  }
}

export function localName(item: { nameEn: string; nameHi: string; nameMr: string }, lang: Lang): string {
  if (lang === 'hi') return item.nameHi || item.nameEn;
  if (lang === 'mr') return item.nameMr || item.nameEn;
  return item.nameEn;
}
