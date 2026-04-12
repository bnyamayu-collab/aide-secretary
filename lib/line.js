// =====================================================================
// LINE Messaging API helpers
// =====================================================================

const TOKEN = () => process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BASE = 'https://api.line.me/v2/bot';

/**
 * Reply to a LINE event
 */
export async function reply(replyToken, messages) {
  if (!Array.isArray(messages)) messages = [messages];
  const body = {
    replyToken,
    messages: messages.map(m =>
      typeof m === 'string' ? { type: 'text', text: m } : m
    ),
  };
  const res = await fetch(`${BASE}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('LINE reply error:', err);
  }
}

/**
 * Push a message to a user (for cron / notifications)
 */
export async function push(userId, messages) {
  if (!Array.isArray(messages)) messages = [messages];
  const body = {
    to: userId,
    messages: messages.map(m =>
      typeof m === 'string' ? { type: 'text', text: m } : m
    ),
  };
  const res = await fetch(`${BASE}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('LINE push error:', err);
  }
}

/**
 * Download content (image/audio/video) from LINE
 * Returns base64 encoded string
 */
export async function downloadContent(messageId) {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: { Authorization: `Bearer ${TOKEN()}` },
    }
  );
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

/**
 * Get user profile
 */
export async function getProfile(userId) {
  const res = await fetch(`${BASE}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${TOKEN()}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Confirm template message
 */
export function confirmMessage(text, yesLabel, yesData, noLabel, noData) {
  return {
    type: 'template',
    altText: text,
    template: {
      type: 'confirm',
      text,
      actions: [
        { type: 'postback', label: yesLabel, data: yesData },
        { type: 'postback', label: noLabel, data: noData },
      ],
    },
  };
}

/**
 * Quick reply buttons
 */
export function quickReply(text, items) {
  return {
    type: 'text',
    text,
    quickReply: {
      items: items.map(i => ({
        type: 'action',
        action: i.type === 'uri'
          ? { type: 'uri', label: i.label, uri: i.uri }
          : { type: 'message', label: i.label, text: i.text || i.label },
      })),
    },
  };
}

/**
 * Flex message card
 */
export function flexCard(altText, title, body, buttons = []) {
  const contents = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg', color: '#6366f1' }],
    },
    body: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: body, wrap: true, size: 'sm', color: '#333333' }],
    },
  };
  if (buttons.length) {
    contents.footer = {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: buttons.map(b => ({
        type: 'button',
        action: b.uri
          ? { type: 'uri', label: b.label, uri: b.uri }
          : { type: 'postback', label: b.label, data: b.data },
        style: 'primary',
        color: '#6366f1',
        height: 'sm',
      })),
    };
  }
  return { type: 'flex', altText, contents };
}
