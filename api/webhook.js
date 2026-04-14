// =====================================================================
// LINE Bot Webhook — Vercel Serverless Function
// =====================================================================
import crypto from 'crypto';
import { reply, downloadContent, getProfile, confirmMessage, quickReply, flexCard } from '../lib/line.js';
import { chat, describeImage, buildSystemPrompt } from '../lib/gemini.js';
import * as store from '../lib/store.js';
import { addEvent, getTodayEvents } from '../lib/calendar.js';

// ---------- Signature verification ----------
function verifySignature(body, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return false;
  const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64');
  return hash === signature;
}

// ---------- Helper: read raw body ----------
function getRawBody(req) {
  // When bodyParser is false, Vercel provides req.body as a Buffer
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf-8');
  }
  // If body is already a string
  if (typeof req.body === 'string') {
    return req.body;
  }
  // If body was parsed as object (bodyParser: false not applied due to ESM compilation),
  // reconstruct JSON from the parsed object. LINE sends compact JSON so this matches.
  if (typeof req.body === 'object' && req.body !== null) {
    return JSON.stringify(req.body);
  }
  return '';
}

// ---------- Main handler ----------
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Aide LINE Bot is running 🤖' });
  }
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  // Read raw body for signature verification
  const rawBody = getRawBody(req);

  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(rawBody, signature)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const body = typeof req.body === 'object' ? req.body : JSON.parse(rawBody);
  const events = body.events || [];

  // Process events in parallel
  await Promise.all(events.map(e => handleEvent(e)));

  return res.status(200).json({ ok: true });
}

// ---------- Event router ----------
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // Ensure user profile exists in Firestore
  const profile = await store.getProfile(userId);
  if (!profile.registered) {
    const lineProfile = await getProfile(userId);
    await store.updateProfile(userId, {
      registered: true,
      displayName: lineProfile?.displayName || '',
      location: '大分県津久見市',
      info: '',
    });
  }

  try {
    switch (event.type) {
      case 'message':
        await handleMessage(event, userId);
        break;
      case 'postback':
        await handlePostback(event, userId);
        break;
      case 'follow':
        await handleFollow(event, userId);
        break;
    }
  } catch (err) {
    console.error('Event handler error:', err);
    await reply(event.replyToken, `⚠️ エラーが発生しました: ${err.message?.slice(0, 100)}`);
  }
}

// ---------- Follow (friend added) ----------
async function handleFollow(event, userId) {
  const lineProfile = await getProfile(userId);
  const name = lineProfile?.displayName || '';
  await store.updateProfile(userId, { registered: true, displayName: name, location: '大分県津久見市', info: '' });
  await reply(event.replyToken, [
    `はじめまして、${name}さん！✨\n私はAide（エイド）、あなた専属のAI秘書です🤖\n\n何でもお気軽にどうぞ！`,
    quickReply('まず何をしましょうか？', [
      { label: '📝 メモを取る', text: 'メモの取り方を教えて' },
      { label: '📅 予定を追加', text: '予定の追加方法を教えて' },
      { label: '🗺 ルート検索', text: '渋谷から東京駅への行き方' },
      { label: '⚙ プロフィール設定', text: 'プロフィール設定の方法を教えて' },
    ]),
  ]);
}

// ---------- Message handler ----------
async function handleMessage(event, userId) {
  const msg = event.message;

  switch (msg.type) {
    case 'text':
      await handleText(event, userId, msg.text);
      break;
    case 'image':
      await handleImage(event, userId, msg.id);
      break;
    case 'audio':
      await handleAudio(event, userId, msg.id);
      break;
    case 'video':
      await reply(event.replyToken, '動画は現在サポートしていません。画像またはテキストを送ってください📸');
      break;
    case 'file':
      await handleFile(event, userId, msg);
      break;
    default:
      await reply(event.replyToken, 'このメッセージ形式にはまだ対応していません🙇');
  }
}

// ---------- Text message ----------
async function handleText(event, userId, text) {
  const profile = await store.getProfile(userId);
  const trimmed = text.trim();

  // Special commands
  if (/^(メモ一覧|メモ見せて|メモリスト)$/i.test(trimmed)) {
    return await showMemos(event, userId);
  }
  if (/^(タスク一覧|やることリスト|タスク|TODO)$/i.test(trimmed)) {
    return await showTasks(event, userId);
  }
  if (/^(今日の予定|スケジュール)$/i.test(trimmed)) {
    return await showTodaySchedule(event, userId);
  }
  if (trimmed.startsWith('プロフィール設定:') || trimmed.startsWith('プロフィール設定：')) {
    const info = trimmed.replace(/^プロフィール設定[:：]\s*/, '');
    await store.updateProfile(userId, { info });
    return await reply(event.replyToken, `✅ プロフィールを更新しました！\n\n${info}\n\nこれを元に、よりあなたに合った提案をします😊`);
  }
  if (trimmed.startsWith('居住地設定:') || trimmed.startsWith('居住地設定：')) {
    const location = trimmed.replace(/^居住地設定[:：]\s*/, '');
    await store.updateProfile(userId, { location });
    return await reply(event.replyToken, `✅ 居住地を「${location}」に設定しました！天気通知もこの地域に対応します🌤`);
  }

  // Handle "save as memo" from quick reply buttons (image/audio/file results)
  if (trimmed.startsWith('メモ保存画像:') || trimmed.startsWith('メモ保存音声:') || trimmed.startsWith('メモ保存ファイル:')) {
    const content = trimmed.replace(/^メモ保存(画像|音声|ファイル):\s*/, '');
    const source = trimmed.startsWith('メモ保存画像') ? 'image' : trimmed.startsWith('メモ保存音声') ? 'audio' : 'file';
    await store.addMemo(userId, { text: content, source });
    return await reply(event.replyToken, `📝 メモに保存しました！\n\n「メモ一覧」で確認できます。`);
  }
  if (trimmed.startsWith('議事録保存:')) {
    const content = trimmed.replace(/^議事録保存:\s*/, '');
    // Re-process as minutes format via Gemini
    const result = await chat(
      '以下のテキストを議事録形式（日時・参加者・議題・決定事項・TODO/担当・期限）で構造化してまとめ直して。',
      content, []
    );
    await store.addMemo(userId, { text: result.text, source: 'audio' });
    return await reply(event.replyToken, `📋 議事録としてメモに保存しました！\n\n${result.text.slice(0, 500)}\n\n「メモ一覧」で確認できます。`);
  }

  // Check if user wants to memo something
  const isMemo = /^(メモ|覚えて|記録して|メモして|メモ：|メモ:)/.test(trimmed);
  if (isMemo) {
    const memoText = trimmed.replace(/^(メモ|覚えて|記録して|メモして|メモ：|メモ:)\s*/, '');
    if (memoText) {
      await store.addMemo(userId, { text: memoText, source: 'text' });
      return await reply(event.replyToken, `📝 メモしました！\n\n「${memoText}」\n\n「メモ一覧」で確認できます。`);
    }
    // User said "メモして" without content — next image will be saved as memo
    await store.updateProfile(userId, { _pendingImageMemo: true });
    return await reply(event.replyToken, '📝 了解！次に送ってくれた画像やテキストをメモに保存しますね。');
  }

  // AI response with Gemini
  const systemPrompt = buildSystemPrompt(profile);
  const needsSearch = /天気|ニュース|最新|今日|いつ|何時|価格|値段|為替|株|店|レストラン|カフェ|ルート|行き方/.test(trimmed);

  const result = await chat(systemPrompt, trimmed, [], { grounding: needsSearch });
  const messages = [result.text];

  // Auto-save tasks
  for (const task of result.tasks) {
    if (task?.title) {
      await store.addTask(userId, task);
    }
  }

  // Auto-add calendar events (with confirmation)
  for (const ev of result.calendarEvents) {
    if (ev?.title && ev?.date) {
      const confirmMsg = confirmMessage(
        `📅 Googleカレンダーに追加しますか？\n\n${ev.title}\n${ev.date} ${ev.startTime || ''}〜${ev.endTime || ''}${ev.location ? '\n📍 ' + ev.location : ''}`,
        '追加する',
        `cal_add:${JSON.stringify(ev)}`,
        'やめる',
        'cal_cancel'
      );
      messages.push(confirmMsg);
    }
  }

  // Task notification
  if (result.tasks.length) {
    messages[0] += `\n\n✅ タスクを${result.tasks.length}件登録しました。「タスク一覧」で確認できます。`;
  }

  await reply(event.replyToken, messages.slice(0, 5)); // LINE max 5 messages
}

// ---------- Image message ----------
async function handleImage(event, userId, messageId) {
  // Store image data temporarily for context, but do NOT auto-save as memo
  const imageBase64 = await downloadContent(messageId);

  // Check if there's a pending memo request (user said "メモして" etc. before sending image)
  const profile = await store.getProfile(userId);
  const pendingMemo = profile._pendingImageMemo;

  if (pendingMemo) {
    // User explicitly asked to memo this image
    await store.updateProfile(userId, { _pendingImageMemo: false });
    const description = await describeImage(imageBase64);
    await store.addMemo(userId, { text: description, source: 'image', imageDescription: description });
    await reply(event.replyToken, `📸 画像の内容をメモしました！\n\n${description.slice(0, 400)}\n\n「メモ一覧」で確認できます。`);
  } else {
    // Just analyze and respond, don't save
    const description = await describeImage(imageBase64);
    await reply(event.replyToken, quickReply(
      `📸 画像の内容:\n\n${description.slice(0, 500)}`,
      [
        { label: '📝 メモに保存', text: `メモ保存画像: ${description.slice(0, 80)}` },
      ]
    ));
  }
}

// ---------- Audio message ----------
async function handleAudio(event, userId, messageId) {
  const audioBase64 = await downloadContent(messageId);

  const result = await chat(
    '音声を正確に文字起こしし、要点をまとめる。発言者が分かれば区別する。',
    '以下の音声を文字起こしして。',
    [{ mime: 'audio/m4a', data: audioBase64 }]
  );

  const summary = result.text.length > 1000
    ? result.text.slice(0, 1000) + '…'
    : result.text;

  // Respond with transcription but do NOT auto-save as memo
  await reply(event.replyToken, quickReply(
    `🎙 文字起こし:\n\n${summary}`,
    [
      { label: '📝 メモに保存', text: `メモ保存音声: ${result.text.slice(0, 60)}` },
      { label: '📋 議事録にして保存', text: `議事録保存: ${result.text.slice(0, 60)}` },
    ]
  ));
}

// ---------- File message ----------
async function handleFile(event, userId, msg) {
  const fileName = msg.fileName || 'file';
  if (/\.(pdf|txt|csv|md)$/i.test(fileName)) {
    const fileBase64 = await downloadContent(msg.id);
    const mime = /\.pdf$/i.test(fileName) ? 'application/pdf' : 'text/plain';

    const result = await chat(
      'ファイルの内容を読み取り、要点を簡潔にまとめる。重要な数字・固有名詞・結論を漏らさず。',
      `この「${fileName}」の内容を要約して。`,
      [{ mime, data: fileBase64 }]
    );

    // Respond with summary but do NOT auto-save as memo
    await reply(event.replyToken, quickReply(
      `📄 ${fileName} の内容:\n\n${result.text.slice(0, 1200)}`,
      [
        { label: '📝 メモに保存', text: `メモ保存ファイル: 【${fileName}】${result.text.slice(0, 50)}` },
      ]
    ));
  } else {
    await reply(event.replyToken, `⚠️ このファイル形式(${fileName})はまだ対応していません。PDF・TXT・CSV・MD・画像・音声に対応しています。`);
  }
}

// ---------- Postback handler ----------
async function handlePostback(event, userId) {
  const data = event.postback?.data || '';

  if (data.startsWith('cal_add:')) {
    const eventData = JSON.parse(data.slice(8));
    const result = await addEvent(eventData);
    if (result.success) {
      await reply(event.replyToken, [
        `✅ Googleカレンダーに追加しました！\n\n📅 ${eventData.title}\n🕐 ${eventData.date} ${eventData.startTime || ''}〜${eventData.endTime || ''}${eventData.location ? '\n📍 ' + eventData.location : ''}`,
        quickReply('他に何かありますか？', [
          { label: '📅 今日の予定', text: '今日の予定' },
          { label: '📝 タスク一覧', text: 'タスク一覧' },
        ]),
      ]);
    } else {
      await reply(event.replyToken,
        result.error === 'Googleカレンダー未設定'
          ? '⚠️ Googleカレンダーがまだ設定されていません。README.mdの「Googleカレンダー設定」を参照してください。'
          : `❌ カレンダー追加に失敗しました: ${result.error}`
      );
    }
  } else if (data === 'cal_cancel') {
    await reply(event.replyToken, 'わかりました、カレンダーへの追加はキャンセルしました。');
  } else if (data === 'show_memos') {
    await showMemos(event, userId);
  } else if (data.startsWith('del_memo:')) {
    const memoId = data.slice(9);
    await store.deleteMemo(userId, memoId);
    await reply(event.replyToken, '🗑 メモを削除しました。');
  } else if (data.startsWith('done_task:')) {
    const taskId = data.slice(10);
    await store.completeTask(userId, taskId);
    await reply(event.replyToken, '✅ タスクを完了にしました！');
  }
}

// ---------- Show memos ----------
async function showMemos(event, userId) {
  const memos = await store.getMemos(userId);
  if (!memos.length) {
    return await reply(event.replyToken, '📝 メモはまだありません。\n\n「メモ ○○」で保存、写真を送って画像メモもできます。');
  }
  const list = memos.slice(0, 5).map((m, i) => {
    const icon = m.source === 'image' ? '📸' : m.source === 'audio' ? '🎙' : m.source === 'file' ? '📄' : '📝';
    const preview = m.text.slice(0, 60).replace(/\n/g, ' ');
    return `${icon} ${i + 1}. ${preview}`;
  }).join('\n\n');

  await reply(event.replyToken, `📝 最新メモ（${memos.length}件）\n\n${list}\n\n「メモ ○○」で保存できます。`);
}

// ---------- Show tasks ----------
async function showTasks(event, userId) {
  const tasks = await store.getTasks(userId, true);
  if (!tasks.length) {
    return await reply(event.replyToken, '✅ 未完了のタスクはありません！\n\n「来週月曜に○○」のように頼むと自動でタスク化されます。');
  }
  const list = tasks.slice(0, 10).map((t, i) => {
    const due = t.due ? ` (〆${t.due})` : '';
    return `${i + 1}. ${t.title}${due}`;
  }).join('\n');

  await reply(event.replyToken, quickReply(
    `📋 タスク一覧（${tasks.length}件）\n\n${list}`,
    tasks.slice(0, 4).map((t, i) => ({
      label: `✅ ${(i + 1)}を完了`,
      text: `タスク完了: ${t.id}`,
    }))
  ));
}

// ---------- Show today's schedule ----------
async function showTodaySchedule(event, userId) {
  const events = await getTodayEvents();
  if (!events.length) {
    return await reply(event.replyToken, '📅 今日の予定はありません。ゆっくりできますね😊');
  }
  const list = events.map(e => {
    const time = e.start?.includes('T')
      ? new Date(e.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
      : '終日';
    return `🕐 ${time}  ${e.title}${e.location ? '\n   📍 ' + e.location : ''}`;
  }).join('\n\n');

  await reply(event.replyToken, `📅 今日の予定\n\n${list}`);
}

// Vercel config: disable body parsing (we need raw body for signature verification)
export const config = {
  api: { bodyParser: false },
};
