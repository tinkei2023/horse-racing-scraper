"""
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