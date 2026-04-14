// =====================================================================
// Weather Cron — 毎朝6時JST (UTC 21:00前日)
// =====================================================================
const { push } = require('../../lib/line.js');
const { chat } = require('../../lib/gemini.js');
const { getAllUserIds, getProfile } = require('../../lib/store.js');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const userIds = await getAllUserIds();
    console.log(`Weather cron: checking for ${userIds.length} users`);

    for (const userId of userIds) {
      try {
        await checkAndNotifyWeather(userId);
      } catch (e) {
        console.error(`Failed for user ${userId}:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, users: userIds.length });
  } catch (e) {
    console.error('Cron error:', e);
    return res.status(500).json({ error: e.message });
  }
};

async function checkAndNotifyWeather(userId) {
  const profile = await getProfile(userId);
  const location = profile.location || '大分県津久見市';
  const name = profile.displayName || '';

  const checkPrompt = `${location}の今日・明日・明後日の3日間の天気予報を調べて、以下のJSON形式だけで返して。余計な説明は不要。

\`\`\`json
{
  "today": {"weather": "雨", "temp_high": 18, "temp_low": 12, "precipitation": 80, "detail": "午前中から本降り"},
  "tomorrow": {"weather": "曇り", "temp_high": 20, "temp_low": 13, "precipitation": 20, "detail": "曇り時々晴れ"},
  "day_after": {"weather": "晴れ", "temp_high": 22, "temp_low": 14, "precipitation": 10, "detail": "晴れ"}
}
\`\`\`

weatherは「晴れ」「曇り」「雨」「雪」「雷雨」「みぞれ」等。precipitationは降水確率%。`;

  const checkResult = await chat(
    'あなたは天気情報を正確にJSON形式で返すボット。',
    checkPrompt,
    [],
    { grounding: true }
  );

  let forecast;
  try {
    const jsonMatch = checkResult.text.match(/```json\s*([\s\S]*?)```/) ||
                      checkResult.text.match(/\{[\s\S]*"today"[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : checkResult.text;
    forecast = JSON.parse(jsonStr.trim());
  } catch (e) {
    console.error('Failed to parse weather JSON:', checkResult.text.slice(0, 300));
    const hasRainOrSnow = /雨|雪|みぞれ|雷/.test(checkResult.text);
    if (!hasRainOrSnow) {
      console.log(`${location}: No rain/snow detected, skipping notification`);
      return;
    }
    await push(userId, `☔ ${location}の天気情報:\n\n${checkResult.text.slice(0, 1500)}`);
    return;
  }

  const badWeatherPattern = /雨|雪|みぞれ|雷|暴風/;
  const todayBad = badWeatherPattern.test(forecast.today?.weather || '');
  const tomorrowBad = badWeatherPattern.test(forecast.tomorrow?.weather || '');
  const dayAfterBad = badWeatherPattern.test(forecast.day_after?.weather || '');

  if (!todayBad && !tomorrowBad && !dayAfterBad) {
    console.log(`${location}: All clear, no notification`);
    return;
  }

  const today = new Date().toLocaleDateString('ja-JP', {
    month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
  });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('ja-JP', {
    month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
  });
  const dayAfter = new Date(Date.now() + 172800000).toLocaleDateString('ja-JP', {
    month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
  });

  function weatherLine(date, day) {
    if (!day) return `${date}: 情報なし`;
    const icon = badWeatherPattern.test(day.weather) ? '☔' : day.weather === '曇り' ? '☁️' : '☀️';
    const alert = badWeatherPattern.test(day.weather) ? ' ⚠️' : '';
    return `${icon} ${date}\n   ${day.weather}${alert} ${day.temp_low || '?'}〜${day.temp_high || '?'}℃ 降水${day.precipitation || '?'}%\n   ${day.detail || ''}`;
  }

  let msg = `${name ? name + 'さん、' : ''}おはようございます！\n`;

  if (todayBad) {
    msg += `\n⚠️ 今日の${location}は${forecast.today.weather}です！傘をお忘れなく☂️\n`;
  }

  msg += `\n📅 3日間の天気（${location}）\n\n`;
  msg += weatherLine(today, forecast.today) + '\n\n';
  msg += weatherLine(tomorrow, forecast.tomorrow) + '\n\n';
  msg += weatherLine(dayAfter, forecast.day_after);

  if (todayBad) {
    msg += '\n\n💡 ';
    if (/雪|みぞれ/.test(forecast.today.weather)) {
      msg += '路面凍結に注意。暖かい服装で出かけましょう。';
    } else if (/雷/.test(forecast.today.weather)) {
      msg += '雷雨の可能性あり。外出時は天気の急変に注意。';
    } else {
      msg += '折り畳み傘があると安心です。';
    }
  } else {
    const futureBadDays = [];
    if (tomorrowBad) futureBadDays.push(`明日(${forecast.tomorrow.weather})`);
    if (dayAfterBad) futureBadDays.push(`明後日(${forecast.day_after.weather})`);
    msg += `\n\n💡 今日は大丈夫ですが、${futureBadDays.join('と')}に注意です。`;
  }

  await push(userId, msg);
  console.log(`Sent weather alert to ${userId}: ${todayBad ? 'TODAY' : 'UPCOMING'} bad weather`);
}
