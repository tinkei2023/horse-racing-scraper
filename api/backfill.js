/**
 * 歷史賽果 backfill —— 放喺 api/backfill.js
 * 用法: GET /api/backfill?date=2025-12-27
 *
 * 攞返 HKJC 官方(非 JS,伺服器直出)嘅「所有場次賽果」頁面,解析出:
 * - 每場嘅班次/途程/場地/賽事名
 * - 頭 4 名嘅名次/馬號/馬名/騎師/練馬師/負磅/檔位
 * - 各彩池派彩(獨贏/位置/連贏 等)
 * 然後 upsert 落 Supabase 嘅 result_races / result_placings / result_dividends
 *
 * ⚠️ 呢個係第一版,未實際見過真正 HTML tag 結構(靠估),
 * 第一次跑好大機會要根據實際錯誤再調整。
 */

const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://jwjtwezbhbtvzqrxrech.supabase.co";
const SUPABASE_KEY = "sb_publishable_yAXxo6A15U9Ox4XvrbnC4w__T9n9LDm";

function toSlashDate(dateStr) {
  return dateStr.replace(/-/g, '/');
}

async function fetchResultsHtml(dateStr) {
  const url = `https://racing.hkjc.com/zh-hk/local/information/archive/resultsall?racedate=${encodeURIComponent(toSlashDate(dateStr))}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} 攞唔到賽果頁面`);
  return { html: await resp.text(), url };
}

function parseResultsHtml(html) {
  const $ = cheerio.load(html);

  const raceHeaderLines = {};
  const placingsByRace = {};
  const dividendsByRace = {};
  const debugTableHeaders = []; // 診斷用:記低搵到嘅每個 table 嘅 header 文字

  let currentRaceNo = null;
  let currentVenue = null;
  let pendingHeaderLine = null;

  $('body *').each((_, el) => {
    const $el = $(el);
    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    if (tag === 'table') {
      const trs = $el.find('tr');
      const row0Text = trs.eq(0).find('th,td').map((i, c) => $(c).text().trim()).get().join('|');
      const row1Text = trs.length > 1 ? trs.eq(1).find('th,td').map((i, c) => $(c).text().trim()).get().join('|') : '';
      debugTableHeaders.push({ raceNo: currentRaceNo, row0Text, row1Text });

      if (row0Text.includes('名次')) {
        const headerText = row0Text;
        const rows = [];
        $el.find('tr').slice(1).each((i, tr) => {
          const cells = $(tr).find('td').map((j, td) => $(td).text().trim()).get();
          if (cells.length >= 7 && /^\d+$/.test(cells[0])) {
            rows.push({
              position: parseInt(cells[0], 10),
              horse_number: parseInt(cells[1], 10),
              horse_name: cells[2],
              jockey: cells[3],
              trainer: cells[4],
              weight: parseInt(cells[5], 10) || null,
              draw: parseInt(cells[6], 10) || null
            });
          }
        });
        if (currentRaceNo !== null && rows.length > 0) {
          placingsByRace[currentRaceNo] = rows;
          if (pendingHeaderLine) raceHeaderLines[currentRaceNo] = pendingHeaderLine;
        }
      } else if (row0Text.includes('彩池') || row1Text.includes('彩池')) {
        // "派彩" 呢個大標題可能自己佔咗第一行,真正欄位名(彩池/勝出組合/派彩)喺第二行,
        // 所以要判斷跳幾多行先開始讀數據
        const dataStartIdx = row0Text.includes('彩池') ? 1 : 2;
        const rawRowsForDebug = [];
        const rows = [];
        let lastPoolType = null;
        $el.find('tr').slice(dataStartIdx).each((i, tr) => {
          const cells = $(tr).find('td').map((j, td) => $(td).text().trim()).get();
          if (i < 5) rawRowsForDebug.push(cells);
          if (cells.length < 2) return;
          let poolType, combination, payoutRaw;
          if (cells.length >= 3 && cells[0]) {
            poolType = cells[0]; combination = cells[1]; payoutRaw = cells[2];
          } else if (cells.length >= 3) {
            poolType = lastPoolType; combination = cells[1]; payoutRaw = cells[2];
          } else {
            poolType = lastPoolType; combination = cells[0]; payoutRaw = cells[1];
          }
          const payout = parseFloat(String(payoutRaw || '').replace(/,/g, ''));
          if (poolType && combination && !isNaN(payout)) {
            lastPoolType = poolType;
            rows.push({ pool_type: poolType, combination, payout });
          }
        });
        if (currentRaceNo !== null && rows.length > 0) {
          dividendsByRace[currentRaceNo] = rows;
        }
      }
      return;
    }

    const directText = $el.contents().filter(function () { return this.type === 'text'; }).text().trim();
    if (!directText) return;

    if (/^(沙田|跑馬地)[:：]?$/.test(directText)) {
      currentVenue = directText.replace(/[:：]$/, '');
      return;
    }

    const raceNoMatch = directText.match(/^第\s*(\d+)\s*場$/);
    if (raceNoMatch) {
      currentRaceNo = parseInt(raceNoMatch[1], 10);
      pendingHeaderLine = null;
      return;
    }

    if (currentRaceNo !== null && !pendingHeaderLine && directText.includes('米') && directText.includes('-')) {
      pendingHeaderLine = directText;
    }
  });

  const races = [];
  for (const raceNoStr of Object.keys(placingsByRace)) {
    const raceNo = parseInt(raceNoStr, 10);
    const headerLine = raceHeaderLines[raceNo] || '';

    // 評分範圍 "(60-40)" 本身有個橫躟,唔可以成句直接 split('-'),
    // 要先用 regex 捉走呢部分,先再拆餘下部分
    const m = headerLine.match(/^(.+?)\s*-\s*(\d+)\s*米\s*-\s*\([^)]*\)\s*-\s*(.+)$/);
    let raceClass = null, distance = null, going = null, raceName = null;
    if (m) {
      raceClass = m[1].trim();
      distance = parseInt(m[2], 10);
      const restParts = m[3].split('-').map(s => s.trim()).filter(Boolean);
      going = restParts[0] || null;
      raceName = restParts[restParts.length - 1] || null;
    }

    races.push({
      raceNo,
      venue: currentVenue,
      raceClass,
      distance,
      going,
      raceName,
      placings: placingsByRace[raceNo],
      dividends: dividendsByRace[raceNo] || []
    });
  }

  return { venue: currentVenue, races, debugTableHeaders };
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const dateStr = url.searchParams.get('date');

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ status: 'error', message: '請帶 ?date=YYYY-MM-DD 參數' });
      return;
    }

    const { html, url: fetchedUrl } = await fetchResultsHtml(dateStr);
    const parsed = parseResultsHtml(html);

    if (parsed.races.length === 0) {
      res.status(200).json({
        status: 'no_races_found',
        message: `喺 ${dateStr} 解析唔到任何賽果(可能格式唔啱,或者嗰日冇賽事)`,
        fetched_url: fetchedUrl,
        html_length: html.length,
        html_sample: html.slice(0, 2000)
      });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const summary = [];

    for (const race of parsed.races) {
      const { data: raceRow, error: raceErr } = await supabase
        .from('result_races')
        .upsert(
          {
            race_date: dateStr,
            venue: race.venue,
            race_number: race.raceNo,
            distance: race.distance,
            race_class: race.raceClass,
            going: race.going,
            race_name: race.raceName
          },
          { onConflict: 'race_date,venue,race_number' }
        )
        .select()
        .single();

      if (raceErr) {
        summary.push({ race_number: race.raceNo, status: 'race_upsert_error', error: raceErr.message });
        continue;
      }

      const resultRaceId = raceRow.id;
      let placingCount = 0;
      let dividendCount = 0;

      for (const p of race.placings) {
        const { error } = await supabase
          .from('result_placings')
          .upsert(
            { result_race_id: resultRaceId, ...p },
            { onConflict: 'result_race_id,position' }
          );
        if (!error) placingCount++;
      }

      for (const d of race.dividends) {
        const { error } = await supabase
          .from('result_dividends')
          .upsert(
            { result_race_id: resultRaceId, ...d },
            { onConflict: 'result_race_id,pool_type,combination' }
          );
        if (!error) dividendCount++;
      }

      summary.push({
        race_number: race.raceNo,
        status: 'processed',
        placings: placingCount,
        dividends: dividendCount
      });
    }

    res.status(200).json({
      status: 'success',
      date: dateStr,
      venue: parsed.venue,
      races_found: parsed.races.length,
      races: summary,
      debug_table_headers: parsed.debugTableHeaders
    });

  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, stack: err.stack });
  }
};
