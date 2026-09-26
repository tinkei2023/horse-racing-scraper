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
from supabase import create_client, Client


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
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

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
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))"""
Vercel API 入口 - 直接複製到 api/scraper.py
"""

import os
import json
from datetime import datetime
import statistics

try:
    from supabase import create_client, Client
except ImportError:
    raise Exception("需要安裝 Supabase: pip install supabase")


# ============================================
# 環境變數
# ============================================
SUPABASE_URL = "https://jwjtwezbhbtvzqrxrech.supabase.co"
SUPABASE_KEY = "sb_publishable_yAXxo6A15U9Ox4XvrbnC4w__T9n9LDm"


# ============================================
# Vercel 無伺服器函數入口
# ============================================
def handler(request):
    """
    Vercel 函數入口
    URL: https://your-project.vercel.app/api/scraper
    Cron: 每日 06:00 自動運行
    """
    try:
        print("🚀 爬蟲開始運行...")
        
        # 連接 Supabase
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        # 判斷今日係咪賽日
        race_date = get_today_race_date()
        if not race_date:
            return success_response({
                "status": "no_racing_today",
                "message": "今日冇馬會賽事"
            })
        
        print(f"📅 賽日: {race_date}")
        
        # 爬取數據
        races_data = get_sample_races(race_date)  # 示範用
        
        # 上傳到 Supabase
        upload_count = upload_to_supabase(supabase, races_data, race_date)
        
        return success_response({
            "status": "success",
            "race_date": race_date,
            "races_uploaded": len(races_data['races']),
            "horses_uploaded": sum(len(r.get('horses', [])) for r in races_data['races']),
            "odds_uploaded": upload_count,
            "timestamp": datetime.now().isoformat(),
            "message": "✅ 爬蟲成功完成"
        })
        
    except Exception as e:
        print(f"❌ 錯誤: {e}")
        return error_response(str(e))


def get_today_race_date():
    """判斷今日是否有賽事"""
    from datetime import datetime
    today = datetime.now()
    weekday = today.weekday()
    
    # 星期三(2), 六(5), 日(6) 有賽
    race_days = [2, 5, 6]
    
    if weekday in race_days:
        return today.strftime("%Y-%m-%d")
    return None


def get_sample_races(race_date: str):
    """示範數據 - 實際會從馬會官網爬取"""
    return {
        "race_date": race_date,
        "venue": "跑馬地" if datetime.strptime(race_date, "%Y-%m-%d").weekday() == 2 else "沙田",
        "ground_condition": "好地",
        "races": [
            {
                "race_number": 1,
                "distance": 1200,
                "time": "19:15",
                "horses": [
                    {
                        "horse_number": 1,
                        "horse_name": "火焰騎士",
                        "draw": 1,
                        "weight": 130,
                        "jockey": "莫雷拉",
                        "trainer": "蔡約翰",
                        "win_odds": 2.45,
                        "place_odds": 1.35,
                        "recent_placings": [1, 1, 2],
                        "recent_margins": [0, 0.5, 1],
                    },
                    {
                        "horse_number": 2,
                        "horse_name": "快速閃電",
                        "draw": 3,
                        "weight": 131,
                        "jockey": "田泰安",
                        "trainer": "告東尼",
                        "win_odds": 3.2,
                        "place_odds": 1.8,
                        "recent_placings": [2, 1, 4],
                        "recent_margins": [1, 0, 3],
                    },
                ]
            },
        ]
    }


def upload_to_supabase(supabase: Client, races_data: dict, race_date: str):
    """上傳數據到 Supabase"""
    print("📤 上傳數據到 Supabase...")
    
    total_odds = 0
    venue = races_data['venue']
    ground = races_data['ground_condition']
    
    for race in races_data['races']:
        try:
            # 1. 插入賽事
            race_record = {
                'race_date': race_date,
                'race_number': race['race_number'],
                'venue': venue,
                'distance': race['distance'],
                'ground_condition': ground,
                'race_time': race.get('time', '')
            }
            
            response = supabase.table('races').insert(race_record).execute()
            race_id = response.data[0]['id'] if response.data else None
            
            if race_id:
                print(f"✅ 賽事 #{race['race_number']} ({race['distance']}m)")
            
            # 2. 插入馬匹
            for horse in race['horses']:
                avg_placing = statistics.mean(horse['recent_placings'])
                avg_margin = statistics.mean(horse['recent_margins'])
                
                horse_record = {
                    'race_id': race_id,
                    'horse_number': horse['horse_number'],
                    'horse_name': horse['horse_name'],
                    'jockey': horse['jockey'],
                    'trainer': horse['trainer'],
                    'draw': horse['draw'],
                    'weight': horse['weight'],
                    'avg_placing': round(avg_placing, 2),
                    'avg_margin': round(avg_margin, 2),
                    'speed_score': 7,
                    'distance_score': 7,
                    'jockey_trainer_score': 7,
                    'draw_score': 7,
                    'workout_score': 7,
                    'composite_score': 7.0,
                }
                
                supabase.table('horse_analysis').insert(horse_record).execute()
            
            # 3. 插入賠率
            for horse in race['horses']:
                odds_record = {
                    'horse_name': horse['horse_name'],
                    'race_id': race_id,
                    'win_odds': horse['win_odds'],
                    'place_odds': horse.get('place_odds', 0),
                    'odds_time': datetime.now().isoformat()
                }
                
                supabase.table('odds').insert(odds_record).execute()
                total_odds += 1
            
        except Exception as e:
            print(f"⚠️ 上傳第 {race['race_number']} 場賽事時出錯: {e}")
            continue
    
    print(f"✅ 上傳完成: {total_odds} 個賠率")
    return total_odds


def success_response(data: dict):
    """成功回應"""
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json; charset=utf-8"
        },
        "body": json.dumps(data, ensure_ascii=False, indent=2)
    }


def error_response(error: str):
    """錯誤回應"""
    return {
        "statusCode": 500,
        "headers": {
            "Content-Type": "application/json; charset=utf-8"
        },
        "body": json.dumps({"error": error}, ensure_ascii=False)
    }
