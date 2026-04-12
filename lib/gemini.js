// =====================================================================
// Gemini API — server-side helper for LINE Bot
// =====================================================================

const API_KEY = () => process.env.GEMINI_API_KEY;
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.0-flash';

/**
 * Call Gemini with text + optional inline image/audio
 * @param {string} systemPrompt
 * @param {string} userText
 * @param {{ mime: string, data: string }[]} media - base64 encoded
 * @param {{ grounding?: boolean }} opts
 * @returns {{ text: string, tasks: object[], calendarEvents: object[] }}
 */
export async function chat(systemPrompt, userText, media = [], opts = {}) {
  const key = API_KEY();
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const parts = [];
  if (userText) parts.push({ text: userText });
  for (const m of media) {
    parts.push({ inlineData: { mimeType: m.mime, data: m.data } });
  }

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  if (opts.grounding) {
    body.tools = [{ google_search: {} }];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '')
    .join('')
    .trim() || '(応答なし)';

  // Extract structured data from response
  const tasks = [];
  const calendarEvents = [];
  let cleanText = text;

  // Parse task blocks
  cleanText = cleanText.replace(/```task\s*([\s\S]*?)```/g, (_, j) => {
    try { tasks.push(JSON.parse(j.trim())); } catch (e) {}
    return '';
  });

  // Parse calendar blocks
  cleanText = cleanText.replace(/```calendar\s*([\s\S]*?)```/g, (_, j) => {
    try { calendarEvents.push(JSON.parse(j.trim())); } catch (e) {}
    return '';
  });

  return { text: cleanText.trim(), tasks, calendarEvents };
}

/**
 * Describe an image for memo purposes
 */
export async function describeImage(imageBase64, mime = 'image/jpeg') {
  const result = await chat(
    'あなたは優秀な秘書。画像の内容を正確に読み取り、メモとして保存する用に要点を簡潔にまとめる。手書きメモ・名刺・レシート・書類は文字起こしもする。',
    'この画像の内容をメモ用にまとめて。文字があれば文字起こしも含めて。',
    [{ mime, data: imageBase64 }]
  );
  return result.text;
}

/**
 * Build the system prompt for the secretary bot
 */
export function buildSystemPrompt(profile = {}) {
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    timeZone: 'Asia/Tokyo',
  });
  const now = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  });

  return `あなたは「Aide」という超優秀な個人秘書AI。LINEを通じてユーザーの日常をサポートする。

【今日】${today} ${now}
【ユーザー情報】${profile.info || '(未設定)'}
【居住地】${profile.location || '大分県津久見市'}

【行動方針】
1. 日本語で、簡潔かつ実用的に回答（LINEなので短めに）
2. 絵文字を適度に使って親しみやすく
3. 具体的な提案や選択肢を出す
4. 最新情報が必要なら自動でWeb検索する

【重要：メモは頼まれた時だけ】
- 写真・音声・ファイルを受け取っても、自動でメモに保存してはいけない
- 「メモして」「覚えて」「記録して」「保存して」と明示的に言われた時だけメモに保存する
- それ以外は内容を分析・回答するだけでよい

【天気に関する質問】
- ユーザーが場所と天気について聞いたら（例:「東京の天気」「明日の大阪の天気は？」）、Web検索して正確に回答する
- 場所の指定がない場合はユーザーの居住地（${profile.location || '大分県津久見市'}）の天気を回答する
- 気温・降水確率・服装アドバイスも簡潔に添える

【タスク自動抽出】
ユーザーが「○○して」「○月○日に○○」等のタスク依頼をしたら、回答の最後に：
\`\`\`task
{"title":"歯医者の予約","due":"2026-04-15","note":"午後希望"}
\`\`\`

【Googleカレンダー登録】
ユーザーが予定・スケジュールを伝えたら、回答の最後に：
\`\`\`calendar
{"title":"歯医者","date":"2026-04-15","startTime":"14:00","endTime":"15:00","location":"○○歯科","description":"定期検診"}
\`\`\`
日時が不明確なら確認を求める。endTimeが不明なら1時間後をデフォルトに。

【特殊コマンド対応】
- 「メモ一覧」「メモ見せて」→ メモ一覧を表示
- 「タスク一覧」「やることリスト」→ タスク一覧を表示
- 「プロフィール設定: ○○」→ ユーザー情報を更新

【ルート・予約案内】
移動経路は Google Maps リンクを付ける：
https://www.google.com/maps/dir/?api=1&origin=出発地&destination=目的地&travelmode=transit

飲食店は食べログリンク：
https://tabelog.com/rstLst/?vs=1&sw=検索キーワード

【雑務対応】
ユーザーからの各種お願い（計算、翻訳、調べもの、比較、リスト作成、文章作成、スケジュール調整など）は何でも引き受ける。秘書として依頼されたことを正確にこなす。`;
}
