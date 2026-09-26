"""
Vercel Python Serverless Function
放喺: api/index.py

功能: 檢查係咪賽馬日,如果係就將示範數據上傳去 Supabase
(真正 HKJC 網站爬蟲需要 Selenium,Vercel 免費版唔支援headless browser,
 所以呢個版本先用示範數據,等成個管道跑通)
"""

from http.server import BaseHTTPRequestHandler
import json
from datetime import datetime, timedelta


# ⚠️ 暫時直接寫死做測試用,穩定之後應該搬去 Vercel Environment Variables
SUPABASE_URL = "https://jwjtwezbhbtvzqrxrech.supabase.co"
SUPABASE_KEY = "sb_publishable_yAXxo6A15U9Ox4XvrbnC4w__T9n9LDm"


def is_race_day(date):
    """香港賽馬日: 週三(跑馬地夜馬)、週六、週日(沙田)"""
    # Python weekday(): 週一=0 ... 週日=6
    return date.weekday() in (2, 5, 6)  # 三=2, 六=5, 日=6


def get_sample_race_data(race_date_str):
    """示範賽事數據(真正版本應該由爬蟲提供)"""
    race_info = {
        "race_date": race_date_str,
        "race_number": 1,
        "venue": "沙田",
        "distance": 1400,
        "ground_condition": "好地",
    }

    horses = [
        {
            "horse_number": 1,
            "horse_name": "福逸",
            "jockey": "潘頓",
            "trainer": "文家良",
            "draw": 3,
            "weight": 128,
            "avg_placing": 2.3,
            "avg_margin": 1.2,
            "speed_score": 8,
            "distance_score": 7,
            "jockey_trainer_score": 9,
            "draw_score": 7,
            "workout_score": 8,
            "composite_score": 7.9,
            "estimated_prob": 0.28,
            "win_odds": 3.8,
        },
        {
            "horse_number": 2,
            "horse_name": "駿俠",
            "jockey": "何澤堯",
            "trainer": "沈集成",
            "draw": 5,
            "weight": 126,
            "avg_placing": 3.1,
            "avg_margin": 2.0,
            "speed_score": 7,
            "distance_score": 6,
            "jockey_trainer_score": 7,
            "draw_score": 6,
            "workout_score": 6,
            "composite_score": 6.5,
            "estimated_prob": 0.19,
            "win_odds": 5.5,
        },
        {
            "horse_number": 3,
            "horse_name": "天下爭鋒",
            "jockey": "潘明輝",
            "trainer": "羅富全",
            "draw": 1,
            "weight": 130,
            "avg_placing": 1.8,
            "avg_margin": 0.8,
            "speed_score": 9,
            "distance_score": 8,
            "jockey_trainer_score": 8,
            "draw_score": 9,
            "workout_score": 9,
            "composite_score": 8.7,
            "estimated_prob": 0.35,
            "win_odds": 2.9,
        },
    ]

    return race_info, horses


def upload_to_supabase(race_info, horses):
    """上傳賽事同馬匹數據去 Supabase"""
    from supabase import create_client  # lazy import: 避免 Vercel 檢測 entrypoint 嗰陣未裝好依賴就爆錯

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. 插入賽事
    race_result = supabase.table("races").insert(race_info).execute()
    race_id = race_result.data[0]["id"]

    horse_count = 0
    odds_count = 0

    for horse in horses:
        # 拆開 horse_analysis 同 odds 兩張表嘅欄位
        win_odds = horse.pop("win_odds")

        horse_row = {**horse, "race_id": race_id}
        horse_result = supabase.table("horse_analysis").insert(horse_row).execute()
        horse_analysis_id = horse_result.data[0]["id"]
        horse_count += 1

        odds_row = {
            "horse_analysis_id": horse_analysis_id,
            "win_odds": win_odds,
        }
        supabase.table("odds").insert(odds_row).execute()
        odds_count += 1

    return race_id, horse_count, odds_count


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            today = datetime.now()
            race_day = is_race_day(today)

            if not race_day:
                response = {
                    "status": "skipped",
                    "message": "今日唔係賽馬日,冇上傳數據",
                    "date": today.strftime("%Y-%m-%d"),
                }
                self._send_json(200, response)
                return

            race_date_str = today.strftime("%Y-%m-%d")
            race_info, horses = get_sample_race_data(race_date_str)

            race_id, horse_count, odds_count = upload_to_supabase(race_info, horses)

            response = {
                "status": "success",
                "message": "示範數據上傳成功",
                "race_id": race_id,
                "race_date": race_date_str,
                "horses_uploaded": horse_count,
                "odds_uploaded": odds_count,
            }
            self._send_json(200, response)

        except Exception as e:
            response = {
                "status": "error",
                "message": str(e),
            }
            self._send_json(500, response)

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
