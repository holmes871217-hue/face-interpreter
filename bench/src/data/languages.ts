export type Lang = 'ko' | 'ja' | 'en' | 'zh';

export const LANGS: Lang[] = ['ko', 'ja', 'en', 'zh'];

export const LANG_LABEL: Record<Lang, string> = { ko: '한국어', ja: '일본어', en: '영어', zh: '중국어(간체)' };

/** Per-engine language codes. */
export const CODES = {
  whisper: { ko: 'korean', ja: 'japanese', en: 'english', zh: 'chinese' },
  m2m100: { ko: 'ko', ja: 'ja', en: 'en', zh: 'zh' },
  nllb: { ko: 'kor_Hang', ja: 'jpn_Jpan', en: 'eng_Latn', zh: 'zho_Hans' },
  hymtEn: { ko: 'Korean', ja: 'Japanese', en: 'English', zh: 'Chinese' },
  hymtZh: { ko: '韩语', ja: '日语', en: '英语', zh: '中文' },
  zonos: { ko: 'ko', ja: 'ja', en: 'en_us', zh: 'cmn' },
} as const;

/** The 12 translation directions. */
export const DIRECTIONS: [Lang, Lang][] = LANGS.flatMap(s => LANGS.filter(t => t !== s).map(t => [s, t] as [Lang, Lang]));
