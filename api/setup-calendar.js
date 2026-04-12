// =====================================================================
// Google Calendar OAuth Setup Helper
// Visit /api/setup-calendar to get auth URL, then exchange code
// =====================================================================
import { getAuthUrl, exchangeCode } from '../lib/calendar.js';

export default async function handler(req, res) {
  const { code } = req.query;

  if (code) {
    // Step 2: Exchange code for tokens
    try {
      const tokens = await exchangeCode(code);
      return res.status(200).json({
        message: '✅ 成功！下の refresh_token を Vercel の環境変数 GOOGLE_REFRESH_TOKEN に設定してください。',
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        note: 'refresh_token は初回のみ表示されます。なくした場合は再度 consent を要求してください。',
      });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  // Step 1: Show auth URL
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({
      error: 'GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET が設定されていません。',
      help: 'README.md の「Googleカレンダー設定」を参照してください。',
    });
  }

  const authUrl = getAuthUrl();
  const html = `
<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aide — Googleカレンダー設定</title>
<style>
  body{font-family:Inter,-apple-system,sans-serif;max-width:600px;margin:60px auto;padding:20px;color:#0f172a;line-height:1.7}
  h1{font-size:24px;color:#6366f1}
  a.btn{display:inline-block;background:linear-gradient(135deg,#6366f1,#22d3ee);color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px;margin:20px 0}
  a.btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(99,102,241,.3)}
  code{background:#f1f5f9;padding:3px 8px;border-radius:6px;font-size:13px}
  ol{padding-left:20px}
</style>
</head>
<body>
<h1>📅 Googleカレンダー連携</h1>
<p>以下のボタンをクリックして、Googleアカウントでログインしてください。</p>
<a class="btn" href="${authUrl}">Googleでログイン →</a>
<h2>手順</h2>
<ol>
  <li>上のボタンをクリック → Googleアカウントを選択 → 許可</li>
  <li>表示された<strong>認証コード</strong>をコピー</li>
  <li>このURLの末尾に <code>?code=ここにコード</code> を追加してアクセス</li>
  <li>表示される <code>refresh_token</code> を Vercel の環境変数にセット</li>
</ol>
<p>例: <code>${req.headers?.host || 'your-app.vercel.app'}/api/setup-calendar?code=4/0A...</code></p>
</body></html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
