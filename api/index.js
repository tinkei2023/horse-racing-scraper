/**
 * 診斷版 v2 —— 放喺 api/index.js
 * 直接用 HKJC 官方 GraphQL endpoint,自己帶 date + venueCode 參數,
 * 確保攞返嘅係香港本地場(沙田 ST / 跑馬地 HV),唔會誤攞咗海外轉播場。
 * 呢個版本唔會寫入 Supabase,淨係讀取同顯示,方便我哋核對欄位。
 */

const GRAPHQL_URL = "https://info.cld.hkjc.com/graphql/base/";

// 從 hkjc-api 套件 source 裡面確認過嘅、HKJC 白名單接受嘅 query
const horseQuery = `
fragment raceFragment on Race {
  id
  no
  status
  raceName_en
  raceName_ch
  postTime
  country_en
  country_ch
  distance
  wageringFieldSize
  go_en
  go_ch
  ratingType
  raceTrack { description_en description_ch }
  raceCourse { description_en description_ch displayCode }
  claCode
  raceClass_en
  raceClass_ch
  judgeSigns { value_en }
}

query raceMeetings($date: String, $venueCode: String) {
  timeOffset { rc }
  activeMeetings: raceMeetings {
    id venueCode date status
    races { no postTime status wageringFieldSize }
  }
  raceMeetings(date: $date, venueCode: $venueCode) {
    id status venueCode date totalNumberOfRace currentNumberOfRace dateOfWeek meetingType
    races {
      ...raceFragment
      runners {
        id no standbyNo status name_ch name_en
        horse { id code }
        color barrierDrawNumber handicapWeight currentWeight currentRating
        internationalRating gearInfo racingColorFileName allowance trainerPreference
        last6run saddleClothNo trumpCard priority finalPosition deadHeat winOdds
        jockey { code name_en name_ch }
        trainer { code name_en name_ch }
      }
    }
  }
}`;

// 攞返香港時間(UTC+8)嘅「今日」日期字串 YYYY-MM-DD,同埋星期幾
function getHKDateInfo() {
  const now = new Date();
  const hkMs = now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60000;
  const hk = new Date(hkMs);
  const yyyy = hk.getUTCFullYear();
  const mm = String(hk.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(hk.getUTCDate()).padStart(2, '0');
  return { dateStr: `${yyyy}-${mm}-${dd}`, weekday: hk.getUTCDay() }; // 0=Sun,3=Wed,6=Sat
}

// 根據星期幾決定今日應該係邊個馬場(冇賽事嘅日子會冇對應場地)
function guessVenueCode(weekday) {
  if (weekday === 3) return 'HV'; // 星期三 跑馬地
  if (weekday === 6 || weekday === 0) return 'ST'; // 星期六/日 沙田
  return null;
}

async function callHkjcGraphQL(query, variables) {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://bet.hkjc.com',
      'Referer': 'https://bet.hkjc.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    },
    body: JSON.stringify({ query, variables })
  });

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`回應唔係合法 JSON (HTTP ${resp.status}): ${text.slice(0, 300)}`);
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

module.exports = async (req, res) => {
  try {
    const { dateStr, weekday } = getHKDateInfo();
    const venueCode = guessVenueCode(weekday);

    if (!venueCode) {
      res.status(200).json({
        status: 'skipped',
        message: `今日(${dateStr})唔係本地賽馬日(星期三/六/日),冇需要攞數據`,
        weekday
      });
      return;
    }

    const result = await callHkjcGraphQL(horseQuery, { date: dateStr, venueCode });

    if (result.errors) {
      res.status(200).json({
        status: 'graphql_error',
        message: 'HKJC GraphQL 回應咗 errors(可能個 query 被拒絕,或者呢個日期/場地冇賽事)',
        queried_date: dateStr,
        queried_venue: venueCode,
        errors: result.errors
      });
      return;
    }

    const meeting = result.data && result.data.raceMeetings && result.data.raceMeetings[0];

    if (!meeting) {
      res.status(200).json({
        status: 'no_meeting_found',
        message: `喺 ${dateStr} 揾唔到 ${venueCode} 場嘅賽事(可能改期/取消,或者資料重未出)`,
        queried_date: dateStr,
        queried_venue: venueCode,
        active_meetings_summary: result.data ? result.data.activeMeetings : null
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      message: `成功攞到 ${dateStr} ${venueCode} 場嘅完整資料`,
      queried_date: dateStr,
      queried_venue: venueCode,
      meeting_summary: {
        id: meeting.id,
        status: meeting.status,
        totalNumberOfRace: meeting.totalNumberOfRace,
        raceCount: meeting.races ? meeting.races.length : 0
      },
      first_race_raw: meeting.races ? meeting.races[0] : null,
      first_runner_raw: meeting.races && meeting.races[0] && meeting.races[0].runners
        ? meeting.races[0].runners[0]
        : null
    });

  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, stack: err.stack });
  }
};
