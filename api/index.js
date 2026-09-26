/**
 * 診斷版 —— 放喺 api/index.js
 * 目的: 睇下 hkjc-api 套件真正攞返嚟嘅原始數據長咩樣,
 *       等我哋確認欄位名先至砌完整嘅 Supabase 上傳邏輯。
 * 呢個版本唔會寫入 Supabase,淨係讀取同顯示。
 */

const { HorseRacingAPI } = require('hkjc-api');

module.exports = async (req, res) => {
  try {
    const horseRacingAPI = new HorseRacingAPI();

    // 1. 攞返而家活躍緊嘅賽事(meeting)
    const activeMeetings = await horseRacingAPI.getActiveMeetings();

    if (!activeMeetings || activeMeetings.length === 0) {
      res.status(200).json({
        status: 'no_active_meeting',
        message: '而家冇活躍賽事(可能未開閘 / 已完場 / 今日冇馬)',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 2. 攞返完整賽事資料(包括馬匹名單)
    const allRaces = await horseRacingAPI.getAllRaces();
    const meeting = allRaces && allRaces[0];
    const firstRace = meeting && meeting.races && meeting.races[0];

    // 3. 試攞返第一場嘅 WIN 賠率
    let oddsSample = null;
    let oddsError = null;
    try {
      if (firstRace) {
        const raceNo = firstRace.no || 1;
        oddsSample = await horseRacingAPI.getRaceOdds(raceNo, ['WIN']);
      }
    } catch (e) {
      oddsError = e.message;
    }

    res.status(200).json({
      status: 'success',
      message: '診斷數據 —— 用嚟確認欄位結構,未上傳 Supabase',
      active_meetings_count: activeMeetings.length,
      active_meetings_raw: activeMeetings,
      meeting_raw_keys: meeting ? Object.keys(meeting) : null,
      first_race_raw: firstRace || null,
      first_runner_raw: firstRace && firstRace.runners ? firstRace.runners[0] : null,
      odds_sample_raw: oddsSample,
      odds_error: oddsError
    });

  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      stack: err.stack
    });
  }
};
