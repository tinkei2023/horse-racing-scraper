/**
 * 正式版 v3 —— 放喺 api/index.js
 *
 * 關鍵發現: HKJC 個 GraphQL 嘅「詳細版」raceMeetings(date, venueCode) resolver
 * 唔會真正跟返我哋俾嘅 $date / $venueCode 篩選,佢會盲目返返「而家進行緊」嗰場
 * (例如海外轉播場),完全唔理我哋想要嘅係咪本地場。
 *
 * 但係「精簡版」activeMeetings(冇參數嗰個 field)就好可靠,會列晒所有現正
 * 生效嘅賽事(包括未開跑嘅),每個都帶埋真實嘅 date/venueCode。
 *
 * 所以做法分兩步:
 * 1. 攞 activeMeetings,喺入面搵返真正本地場(venueCode 係 ST 或 HV)嘅精確日期
 * 2. 用返嗰個精確日期再問一次「詳細版」,先至攞到有齊馬匹嘅完整資料
 * 3. 攞到之後仲會再核對一次 meeting.venueCode/meeting.date 係咪真係啱,
 *    唔啱就即刻停,唔會將錯誤場數據存落 Supabase
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
const LOCAL_VENUES = ['ST', 'HV'];

function getHKDateInfo() {
  const now = new Date();
  const hkMs = now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60000;
  const hk = new Date(hkMs);
  const yyyy = hk.getUTCFullYear();
  const mm = String(hk.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(hk.getUTCDate()).padStart(2, '0');
  return { dateStr: `${yyyy}-${mm}-${dd}` };
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
    const { dateStr } = getHKDateInfo();

    // ===== 第 1 步: 用 activeMeetings 搵返真正本地場(ST/HV)嘅精確日期 =====
    // (呢個 field 唔理 $date/$venueCode 參數,永遠準確,所以隨便帶個 dummy 值都得)
    const probeResult = await callHkjcGraphQL(horseQuery, { date: dateStr, venueCode: 'ST' });

    if (probeResult.errors) {
      res.status(200).json({
        status: 'graphql_error',
        message: 'HKJC GraphQL 拒絕咗個 query',
        errors: probeResult.errors
      });
      return;
    }

    const activeMeetings = (probeResult.data && probeResult.data.activeMeetings) || [];
    const localMeetingSummary = activeMeetings.find(m => LOCAL_VENUES.includes(m.venueCode));

    if (!localMeetingSummary) {
      res.status(200).json({
        status: 'no_local_meeting_active',
        message: '而家冇本地(沙田/跑馬地)賽事生效緊',
        active_meetings_summary: activeMeetings
      });
      return;
    }

    const targetDate = localMeetingSummary.date;
    const targetVenue = localMeetingSummary.venueCode;

    // ===== 第 2 步: 用返啱啱搵到嘅精確日期,再問一次攞詳細資料 =====
    const gqlResult = await callHkjcGraphQL(horseQuery, { date: targetDate, venueCode: targetVenue });

    if (gqlResult.errors) {
      res.status(200).json({
        status: 'graphql_error',
        message: '第二次查詢(攞詳細資料)被拒絕',
        target_date: targetDate, target_venue: targetVenue, errors: gqlResult.errors
      });
      return;
    }

    const meeting = gqlResult.data && gqlResult.data.raceMeetings && gqlResult.data.raceMeetings[0];

    if (!meeting || meeting.venueCode !== targetVenue || meeting.date !== targetDate) {
      res.status(200).json({
        status: 'venue_mismatch',
        message: '第二次查詢仍然攞唔到啱嘅場地/日期,已停止寫入,避免存錯數據',
        target_date: targetDate,
        target_venue: targetVenue,
        actual_returned_venue: meeting ? meeting.venueCode : null,
        actual_returned_date: meeting ? meeting.date : null
      });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const venueName = VENUE_NAME[meeting.venueCode] || meeting.venueCode;
    const actualDate = meeting.date;

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
            race_date: actualDate,
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

      const currentHorseNumbers = runners
        .filter(r => r.status !== 'Scratched' && !r.standbyNo)
        .map(r => parseInt(r.no, 10));

      for (const runner of runners) {
        if (runner.status === 'Scratched' || runner.standbyNo) continue;

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

      // 清走呢場入面「而家已經唔喺出賽名單」嘅殘留馬匹紀錄
      // (防止之前錯誤場數據殘留,同今次啱嘅數據疊埋一齊)
      if (currentHorseNumbers.length > 0) {
        await supabase
          .from('horse_analysis')
          .delete()
          .eq('race_id', raceId)
          .not('horse_number', 'in', `(${currentHorseNumbers.join(',')})`);
      }

      raceSummaries.push({
        race_number: race.no,
        status: 'processed',
        distance: race.distance,
        horses: horsesInRace,
        odds_available: oddsInRace,
        odds_pending: horsesInRace - oddsInRace
      });
    }

    res.status(200).json({
      status: 'success',
      message: `已處理 ${actualDate} ${venueName} 場`,
      actual_meeting_date: actualDate,
      actual_venue: venueName,
      total_horses_upserted: totalHorsesUpserted,
      total_odds_upserted: totalOddsUpserted,
      races: raceSummaries
    });

  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, stack: err.stack });
  }
};
