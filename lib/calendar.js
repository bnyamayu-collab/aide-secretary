// =====================================================================
// Google Calendar — OAuth2 + event creation
// =====================================================================
const { google } = require('googleapis');

function getAuth() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

/**
 * Add an event to Google Calendar
 */
async function addEvent(event) {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'Googleカレンダー未設定' };
  }

  const calendar = google.calendar({ version: 'v3', auth });

  const startDateTime = `${event.date}T${event.startTime || '09:00'}:00`;
  const endDateTime = event.endTime
    ? `${event.date}T${event.endTime}:00`
    : `${event.date}T${addHour(event.startTime || '09:00')}:00`;

  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: event.title,
        location: event.location || '',
        description: event.description || 'Aideが追加した予定',
        start: { dateTime: startDateTime, timeZone: 'Asia/Tokyo' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Tokyo' },
      },
    });

    return {
      success: true,
      link: res.data.htmlLink,
      eventId: res.data.id,
    };
  } catch (e) {
    console.error('Calendar error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get today's events
 */
async function getTodayEvents() {
  const auth = getAuth();
  if (!auth) return [];

  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const todayStart = new Date(now.toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo' }));
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: todayStart.toISOString(),
      timeMax: todayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: 'Asia/Tokyo',
    });
    return (res.data.items || []).map(e => ({
      title: e.summary,
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      location: e.location || '',
    }));
  } catch (e) {
    console.error('Calendar list error:', e.message);
    return [];
  }
}

function addHour(time) {
  const [h, m] = time.split(':').map(Number);
  return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Generate the auth URL for initial setup.
 */
function getAuthUrl() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  return auth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  });
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCode(code) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  const { tokens } = await auth.getToken(code);
  return tokens;
}

module.exports = { addEvent, getTodayEvents, getAuthUrl, exchangeCode };
