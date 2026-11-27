import type { Lang } from './languages';

/**
 * Parallel test set: short face-to-face conversation sentences, same meaning in each language.
 * Used for (a) 12-direction translation tests (the other languages serve as references for manual review) and
 * (b) TTS tests. These are hand-written test items, not a standard benchmark; quality is judged by a human reviewer.
 */
export const SENTENCES: Record<Lang, string>[] = [
  { ko: '안녕하세요, 만나서 반갑습니다.', ja: 'こんにちは、お会いできてうれしいです。', en: 'Hello, nice to meet you.', zh: '你好，很高兴见到你。' },
  { ko: '화장실이 어디에 있나요?', ja: 'トイレはどこですか？', en: 'Where is the restroom?', zh: '洗手间在哪里？' },
  { ko: '이거 얼마예요?', ja: 'これはいくらですか？', en: 'How much is this?', zh: '这个多少钱？' },
  { ko: '역까지 걸어서 얼마나 걸리나요?', ja: '駅まで歩いてどのくらいかかりますか？', en: 'How long does it take to walk to the station?', zh: '走到车站要多长时间？' },
  { ko: '저는 땅콩 알레르기가 있어서 땅콩이 들어간 음식은 못 먹어요.', ja: '私はピーナッツアレルギーなので、ピーナッツが入った料理は食べられません。', en: "I'm allergic to peanuts, so I can't eat food that contains them.", zh: '我对花生过敏，所以不能吃含有花生的食物。' },
  { ko: '천천히 다시 한 번 말씀해 주시겠어요?', ja: 'もう一度ゆっくり言っていただけますか？', en: 'Could you say that again more slowly?', zh: '可以请您再慢慢说一遍吗？' },
  { ko: '내일 오후 세 시에 호텔 로비에서 만나요.', ja: '明日の午後三時にホテルのロビーで会いましょう。', en: "Let's meet in the hotel lobby at three tomorrow afternoon.", zh: '我们明天下午三点在酒店大堂见面吧。' },
  { ko: '카드로 결제해도 되나요?', ja: 'カードで支払ってもいいですか？', en: 'Can I pay by card?', zh: '可以刷卡吗？' },
  { ko: '길을 잃었는데 지하철역으로 가는 길을 알려 주실 수 있나요?', ja: '道に迷ってしまったのですが、地下鉄の駅への行き方を教えていただけますか？', en: "I'm lost. Could you tell me how to get to the subway station?", zh: '我迷路了，您能告诉我怎么去地铁站吗？' },
  { ko: '오늘 정말 즐거웠어요. 다음에 또 만나요.', ja: '今日は本当に楽しかったです。また会いましょう。', en: 'I really enjoyed today. Let’s meet again.', zh: '今天真的很开心，下次再见。' },
];

/** Short prompts for ASR recording tests (read aloud by the tester). */
export const ASR_PROMPTS: Record<Lang, string[]> = {
  ko: [SENTENCES[3].ko, SENTENCES[4].ko, SENTENCES[6].ko],
  ja: [SENTENCES[3].ja, SENTENCES[4].ja, SENTENCES[6].ja],
  en: [SENTENCES[3].en, SENTENCES[4].en, SENTENCES[6].en],
  zh: [SENTENCES[3].zh, SENTENCES[4].zh, SENTENCES[6].zh],
};

/** Voice-profile enrolment script (read aloud while recording a reference clip). */
export const ENROLL_SCRIPT: Record<Lang, string> = {
  ko: '오늘은 날씨가 맑고 바람이 조금 붑니다. 저는 아침에 커피를 마시고 친구와 함께 시장에 갔습니다. 사과와 빵을 사고 천천히 걸어서 집으로 돌아왔습니다.',
  ja: '今日は天気が良く、少し風があります。私は朝コーヒーを飲んで、友達と一緒に市場へ行きました。りんごとパンを買って、ゆっくり歩いて家に帰りました。',
  en: 'The weather is clear today with a light breeze. In the morning I had coffee and went to the market with a friend. We bought apples and bread and walked home slowly.',
  zh: '今天天气晴朗，有一点风。早上我喝了咖啡，和朋友一起去了市场。我们买了苹果和面包，然后慢慢走回家。',
};
