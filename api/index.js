/**
 * 正式版 v2 —— 放喺 api/index.js
 *
 * 重要: HKJC 個 GraphQL endpoint 有白名單校驗,query 結構必須同官方前端
 * 用緊嗰條完全一致(包括我哋用唔著嘅欄位都唔可以刪),否則會俾佢
 * 用 WHITELIST_ERROR 拒絕。所以下面呢條 query 保持原汁原味,一個字都冇改,
 * 淨係將 $date / $venueCode 呢兩個變數換做我哋要嘅日期/場地。
 */

const { createClient } = require('@supabase/supabase-js');

const GRAPHQL_URL = "https://info.cld.hkjc.com/graphql/base/";
const SUPABASE_URL = "https://jwjtwezbhbtvzqrxrech.supabase.co";
const SUPABASE_KEY = "sb_publishable_yAXxo6A15U9Ox4XvrbnC4w__T9n9LDm";

// ⚠️ 呢條 query 一個字都唔可以改,原封不動抄自 HKJC 官方前端白名單
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
 raceTrack {
 description_en
 description_ch
 }
 raceCourse {
 description_en
 description_ch
 displayCode
 }
 claCode
 raceClass_en
 raceClass_ch
 judgeSigns {
 value_en
 }
}

fragment racingBlockFragment on RaceMeeting {
 jpEsts: pmPools( oddsTypes: [WIN, PLA, TCE, TRI, FF, QTT, DT, TT, SixUP] filters: ["jackpot", "estimatedDividend"]
 ) {
 leg {
 number
 races
 }
 oddsType
 jackpot
 estimatedDividend
 mergedPoolId
 }
 poolInvs: pmPools( oddsTypes: [WIN, PLA, QIN, QPL, CWA, CWB, CWC, IWN, FCT, TCE, TRI, FF, QTT, DBL, TBL, DT, TT, SixUP]
 ) {
 id
 leg {
 races
 }
 } penetrometerReadings(filters: ["first"]) {
 reading
 readingTime
 } hammerReadings(filters: ["first"]) {
 reading
 readingTime
 } changeHistories(filters: ["top3"]) {
 type
 time
 raceNo
 runnerNo
 horseName_ch
 horseName_en
 jockeyName_ch
 jockeyName_en
 scratchHorseName_ch
 scratchHorseName_en
 handicapWeight
 scrResvIndicator
 }
}

query raceMeetings($date: String, $venueCode: String) {
 timeOffset {
 rc
 }
 activeMeetings: raceMeetings {
 id
 venueCode
 date
 status
 races {
 no
 postTime
 status
 wageringFieldSize
 }
 } raceMeetings(date: $date, venueCode: $venueCode) {
 id
 status
 venueCode
 date
 totalNumberOfRace
 currentNumberOfRace
 dateOfWeek
 meetingType
 totalInvestment
 country {
 code
 namech
 nameen
 seq
 }
 races {
 ...raceFragment
 runners {
 id
 no
 standbyNo
 status
 name_ch
 name_en
 horse {
 id
 code
 }
 color
 barrierDrawNumber
 handicapWeight
 currentWeight
 currentRating
 internationalRating
 gearInfo
 racingColorFileName
 allowance
 trainerPreference
 last6run
 saddleClothNo
 trumpCard
 priority
 finalPosition
 deadHeat
 winOdds
 jockey {
 code
 name_en
 name_ch
 }
 trainer {
 code
 name_en
 name_ch
 }
 }
 }
 obSt: pmPools(oddsTypes: [WIN, PLA]) {
 leg {
 races
 }
 oddsType
 comingleStatus
 }
 poolInvs: pmPools( oddsTypes: [WIN, PLA, QIN, QPL, CWA, CWB, CWC, IWN, FCT, TCE, TRI, FF, QTT, DBL, TBL, DT, TT, SixUP]
 ) {
 id
 leg {
 number
 races
 }
 status
 sellStatus
 oddsType
 investment
 mergedPoolId
 lastUpdateTime
 }
 ...racingBlockFragment pmPools(oddsTypes: []) {
 id
 }
 jkcInstNo: foPools(oddsTypes: [JKC], filters: ["top"]) {
 instNo
 }
 tncInstNo: foPools(oddsTypes: [TNC], filters: ["top"]) {
 instNo
 }
 }
}`;

const VENUE_NAME = { ST: '沙田', HV: '跑馬地' };

function getHKDateInfo() {
  const now = new Date();
  const hkMs = now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60000;
  const hk = new Date(hkMs);
  const yyyy = hk.getUTCFullYear();
  const mm = String(hk.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(hk.getUTCDate()).padStart(2, '0');
  return { dateStr: `${yyyy}-${mm}-${dd}`, weekday: hk.getUTCDay() };
}

function guessVenueCode(weekday) {
  if (weekday === 3) return 'HV';
  if (weekday === 6 || weekday === 0) return 'ST';
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
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

function calcAvgPlacing(last6run) {
  if (!last6run) return 5;
  const nums = last6run.split('/').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  if (nums.length === 0) return 5;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function parseWinOdds(winOdds) {
  if (!winOdds) return null;
  const v = parseFloat(winOdds);
  if (isNaN(v)) return null;
  return v;
}

module.exports = async (req, res) => {
  try {
    const { dateStr, weekday } = getHKDateInfo();
    const venueCode = guessVenueCode(weekday);

    if (!venueCode) {
      res.status(200).json({ status: 'skipped', message: `今日(${dateStr})唔係本地賽馬日`, weekday });
      return;
    }

    const gqlResult = await callHkjcGraphQL(horseQuery, { date: dateStr, venueCode });

    if (gqlResult.errors) {
      res.status(200).json({
        status: 'graphql_error',
        message: 'HKJC GraphQL 拒絕咗個 query,或者呢個日期/場地冇資料',
        queried_date: dateStr, queried_venue: venueCode, errors: gqlResult.errors
      });
      return;
    }

    const meeting = gqlResult.data && gqlResult.data.raceMeetings && gqlResult.data.raceMeetings[0];
    if (!meeting) {
      res.status(200).json({
        status: 'no_meeting_found',
        message: `喺 ${dateStr} 揾唔到 ${venueCode} 場嘅賽事`,
        queried_date: dateStr, queried_venue: venueCode,
        active_meetings_summary: gqlResult.data ? gqlResult.data.activeMeetings : null
      });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const venueName = VENUE_NAME[venueCode] || venueCode;

    const raceSummaries = [];
    let totalHorsesUpserted = 0;
    let totalOddsUpserted = 0;

    for (const race of meeting.races || []) {
      const runners = race.runners || [];

      if (runners.length === 0) {
        raceSummaries.push({ race_number: race.no, status: 'not_declared_yet' });
        continue;
      }

      const { data: raceRow, error: raceErr } = await supabase
        .from('races')
        .upsert(
          {
            race_date: dateStr,
            race_number: race.no,
            venue: venueName,
            distance: race.distance,
            ground_condition: race.go_ch || race.go_en || ''
          },
          { onConflict: 'race_date,race_number,venue' }
        )
        .select()
        .single();

      if (raceErr) {
        raceSummaries.push({ race_number: race.no, status: 'race_upsert_error', error: raceErr.message });
        continue;
      }

      const raceId = raceRow.id;
      let horsesInRace = 0;
      let oddsInRace = 0;

      for (const runner of runners) {
        if (runner.status === 'Scratched') continue;

        const horseNumber = parseInt(runner.no, 10);
        const avgPlacing = calcAvgPlacing(runner.last6run);

        const { data: horseRow, error: horseErr } = await supabase
          .from('horse_analysis')
          .upsert(
            {
              race_id: raceId,
              horse_number: horseNumber,
              horse_name: runner.name_ch || runner.name_en,
              jockey: runner.jockey ? (runner.jockey.name_ch || runner.jockey.name_en) : '',
              trainer: runner.trainer ? (runner.trainer.name_ch || runner.trainer.name_en) : '',
              draw: parseInt(runner.barrierDrawNumber, 10) || null,
              weight: parseInt(runner.handicapWeight, 10) || null,
              avg_placing: avgPlacing,
              avg_margin: 2,
              speed_score: 5,
              distance_score: 5,
              jockey_trainer_score: 5,
              draw_score: 5,
              workout_score: 5,
              composite_score: null,
              estimated_prob: null
            },
            { onConflict: 'race_id,horse_number' }
          )
          .select()
          .single();

        if (horseErr) continue;
        horsesInRace++;
        totalHorsesUpserted++;

        const winOdds = parseWinOdds(runner.winOdds);
        if (winOdds !== null) {
          const { error: oddsErr } = await supabase
            .from('odds')
            .upsert(
              { horse_analysis_id: horseRow.id, win_odds: winOdds },
              { onConflict: 'horse_analysis_id' }
            );
          if (!oddsErr) {
            oddsInRace++;
            totalOddsUpserted++;
          }
        }
      }

      raceSummaries.push({
        race_number: race.no,
        status: 'processed',
        horses: horsesInRace,
        odds_available: oddsInRace,
        odds_pending: horsesInRace - oddsInRace
      });
    }

    res.status(200).json({
      status: 'success',
      message: `已處理 ${dateStr} ${venueName} 場`,
      queried_date: dateStr,
      queried_venue: venueName,
      total_horses_upserted: totalHorsesUpserted,
      total_odds_upserted: totalOddsUpserted,
      races: raceSummaries
    });

  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, stack: err.stack });
  }
};
