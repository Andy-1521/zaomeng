#!/usr/bin/env python3
"""
生产环境用户数据替换脚本

用法:
  1. 确保应用已部署到生产环境
  2. 获取生产环境域名
  3. 执行: python3 scripts/replace_prod_users.py <生产域名>

示例:
  python3 scripts/replace_prod_users.py https://xxx.coze.site
"""

import sys
import json
import requests

# 来自 users_rows.sql 的用户数据
USERS_DATA = [
    {"id":"0d4d4c40-cd40-4484-b25a-254c281706a1","username":"su0108141389@gmail.com","phone":None,"password":"suping1100","points":90,"is_admin":False,"is_active":True,"created_at":"2026-01-23 17:06:32.157191+08","updated_at":"2026-01-23 17:12:39.452+08","email":"su0108141389@gmail.com","avatar":None},
    {"id":"0f8f07b6-ed6a-40ad-825e-b7c70801591e","username":"Y","phone":None,"password":"20050410","points":50,"is_admin":False,"is_active":True,"created_at":"2026-01-26 09:23:02.730912+08","updated_at":"2026-01-27 14:17:31.995+08","email":"1833520239@qq.com","avatar":None},
    {"id":"22d4efd1-86ff-4b9d-99e7-824b21b6a34a","username":"X","phone":None,"password":"Xjm200225","points":100,"is_admin":False,"is_active":True,"created_at":"2026-01-23 17:04:15.537518+08","updated_at":None,"email":"1805202947@qq.com","avatar":None},
    {"id":"28918825-8b28-4b72-b556-379741eddd17","username":"xxk","phone":None,"password":"123456xxk","points":100,"is_admin":False,"is_active":True,"created_at":"2026-01-23 16:58:33.447866+08","updated_at":None,"email":"1215299034@qq.com","avatar":None},
    {"id":"29d82fea-47b4-4dc7-ab1d-f2292b03911b","username":"haha","phone":None,"password":"123456","points":80,"is_admin":False,"is_active":True,"created_at":"2026-02-26 10:17:32.51228+08","updated_at":"2026-02-26 10:21:04.584195+08","email":"1440502237@qq.com","avatar":None},
    {"id":"3911ba03-d8bd-4f8b-a05c-1880bd4a3a64","username":"小诺","phone":None,"password":"sckj66666601212","points":400,"is_admin":False,"is_active":True,"created_at":"2026-02-25 18:01:15.527428+08","updated_at":"2026-02-25 18:37:44.239556+08","email":"2096177810@qq.com","avatar":None},
    {"id":"609b8ea6-f020-4f5d-b576-cead1a7e3e74","username":"美美美少女","phone":None,"password":"123123","points":50,"is_admin":False,"is_active":True,"created_at":"2026-01-14 22:57:00.663128+08","updated_at":"2026-01-15 11:17:41.776+08","email":"453687052@qq.com","avatar":None},
    {"id":"617a5fc6-8c63-4fe3-a6f2-ca209db9d7e9","username":"testuser","phone":"13800138000","password":"654321","points":80,"is_admin":False,"is_active":True,"created_at":"2026-01-06 17:30:17.301938+08","updated_at":"2026-01-06 17:38:02.714+08","email":None,"avatar":None},
    {"id":"66088947-fefa-4e1e-928b-13c00b7dbcaf","username":"yingcc","phone":None,"password":"yyx102030.","points":80,"is_admin":False,"is_active":True,"created_at":"2026-01-28 11:37:15.435495+08","updated_at":"2026-01-28 11:43:50.191+08","email":"986802452@qq.com","avatar":None},
    {"id":"67c6265a-396f-4c5b-86ef-d15c37d9c8a6","username":"小蒙奇","phone":None,"password":"Z3310457857zzz","points":0,"is_admin":False,"is_active":True,"created_at":"2026-01-17 16:09:52.989285+08","updated_at":"2026-03-10 16:40:00.519+08","email":"3310457857@qq.com","avatar":None},
    {"id":"67f2c6a0-a517-4b2f-a1b9-0e06540c526b","username":"李一","phone":None,"password":"123456","points":80,"is_admin":False,"is_active":True,"created_at":"2026-02-25 18:34:05.380372+08","updated_at":"2026-02-25 18:35:19.949646+08","email":"lishuyiplus@foxmail.com","avatar":None},
    {"id":"6e7a55a2-7f3b-438e-ad57-fad09d6dc4cf","username":"254060","phone":None,"password":"zhh254060","points":50,"is_admin":False,"is_active":True,"created_at":"2026-01-23 17:39:14.576142+08","updated_at":"2026-02-25 22:25:20.67131+08","email":"2540608162@qq.com","avatar":None},
    {"id":"7197d3c8-b64c-4ed6-a8d8-9e29117871f1","username":"wqwq10099","phone":None,"password":"3498328","points":100,"is_admin":False,"is_active":True,"created_at":"2026-03-03 11:33:45.993938+08","updated_at":None,"email":"578653766@qq.com","avatar":None},
    {"id":"78f48830-05ed-4686-ad74-a1619d8cddc7","username":"黄","phone":None,"password":"2387004139@qq.com","points":0,"is_admin":False,"is_active":True,"created_at":"2026-01-17 16:37:30.409943+08","updated_at":"2026-04-02 21:11:43.046614+08","email":"2387004139@qq.com","avatar":None},
    {"id":"b9b4a94c-47f4-450d-9a57-2726dd60e703","username":"蔡","phone":None,"password":"q1073515648","points":2300,"is_admin":False,"is_active":True,"created_at":"2026-01-15 17:10:56.902033+08","updated_at":"2026-04-16 01:22:13.561825+08","email":"1073515648@qq.com","avatar":None},
    {"id":"c535d14d-2164-4905-beb5-92a69f32aa0c","username":"1044348058","phone":None,"password":"Aa123456","points":3980,"is_admin":False,"is_active":True,"created_at":"2026-01-16 20:54:59.258923+08","updated_at":"2026-04-15 16:22:43.508093+08","email":"1044348058@qq.com","avatar":None},
    {"id":"c59573cb-1a2e-48ca-8737-f168a4f3804f","username":"xiejitao123","phone":None,"password":"xiejitao12345","points":1480,"is_admin":False,"is_active":True,"created_at":"2026-01-17 14:34:43.618735+08","updated_at":"2026-01-17 15:49:17.225+08","email":"13602555707@139.com","avatar":None},
    {"id":"d438504e-3f78-43f0-813f-ac3091d5adde","username":"Andy","phone":None,"password":"123123","points":4200,"is_admin":True,"is_active":True,"created_at":"2026-01-14 11:09:30.832806+08","updated_at":"2026-03-21 18:58:52.369972+08","email":"517469621@qq.com","avatar":None},
    {"id":"dab82e56-6279-4ce7-bd4c-e7f6d4feb7a5","username":"又见枝头绿","phone":None,"password":"582142","points":880,"is_admin":False,"is_active":True,"created_at":"2026-03-10 16:47:44.548326+08","updated_at":"2026-03-10 19:20:30.100896+08","email":"379899493@qq.com","avatar":None},
    {"id":"ddac58d0-3af4-44df-a9bc-9fad16bfadbc","username":"111","phone":None,"password":"1686696094ly","points":100,"is_admin":False,"is_active":True,"created_at":"2026-04-10 20:10:09.448011+08","updated_at":None,"email":"1686696094@qq.com","avatar":None},
    {"id":"de0a83f6-f7ea-412d-92d7-af9c26496502","username":"huawen","phone":None,"password":"huawen123.","points":90,"is_admin":False,"is_active":True,"created_at":"2026-01-23 17:02:18.865941+08","updated_at":"2026-01-23 17:06:12.73+08","email":"380123518@qq.com","avatar":None},
    {"id":"edf830c5-d74d-47c3-928f-e15f24862608","username":"三秋","phone":None,"password":"112233","points":800,"is_admin":False,"is_active":True,"created_at":"2026-01-15 17:09:46.01364+08","updated_at":"2026-01-15 17:34:05.571+08","email":"2855827073@qq.com","avatar":None},
    {"id":"f01d906b-0c0d-4981-937e-a5e5ffb44c11","username":"屋顶不赏月","phone":None,"password":"888888","points":20,"is_admin":False,"is_active":True,"created_at":"2026-01-23 14:46:04.295968+08","updated_at":"2026-01-24 16:13:03.969+08","email":"3211631968@qq.com","avatar":None},
    {"id":"f3cdd6fa-3755-45c8-8746-12166dc5f11d","username":"杜明杰","phone":None,"password":"998312dmj","points":400,"is_admin":False,"is_active":True,"created_at":"2026-03-05 16:28:13.732457+08","updated_at":"2026-03-28 18:05:16.350146+08","email":"2358879401@qq.com","avatar":None},
    {"id":"f3db657b-2c75-4962-a843-366b37d37fe6","username":"万海旭","phone":None,"password":"@whx152531","points":200,"is_admin":False,"is_active":True,"created_at":"2026-01-23 14:36:53.051896+08","updated_at":"2026-03-10 17:11:12.366375+08","email":"1543200876@qq.com","avatar":None},
    {"id":"f5c9e158-42ea-4d4f-bd3a-5a8c22ff2753","username":"悠真","phone":None,"password":"1996011505wxk","points":910,"is_admin":False,"is_active":True,"created_at":"2026-01-16 18:37:46.810309+08","updated_at":"2026-03-16 20:52:44.705708+08","email":"384716723@qq.com","avatar":None},
    {"id":"f91e9b7a-821c-44d8-84e7-e7bbbbf5b6bb","username":"LWL","phone":None,"password":"LWL079768","points":50,"is_admin":False,"is_active":True,"created_at":"2026-03-12 22:01:02.353879+08","updated_at":"2026-03-12 22:33:12.027076+08","email":"162239035@qq.com","avatar":None},
]


def main():
    if len(sys.argv) < 2:
        print("用法: python3 scripts/replace_prod_users.py <生产域名>")
        print("示例: python3 scripts/replace_prod_users.py https://xxx.coze.site")
        sys.exit(1)

    base_url = sys.argv[1].rstrip('/')
    api_url = f"{base_url}/api/user/replace-users"
    secret_key = "replace-users-2026"

    print(f"正在替换生产环境用户数据...")
    print(f"目标: {api_url}")
    print(f"用户数量: {len(USERS_DATA)}")

    try:
        resp = requests.post(
            api_url,
            json={"users": USERS_DATA},
            headers={
                "Content-Type": "application/json",
                "X-Admin-Secret": secret_key,
            },
            timeout=30,
        )

        result = resp.json()
        if result.get("success"):
            print(f"\n替换成功!")
            print(f"  插入: {result['data']['insertedCount']} 条")
            print(f"  数据库总数: {result['data']['totalCount']} 条")
        else:
            print(f"\n替换失败: {result.get('message', '未知错误')}")
            sys.exit(1)

    except Exception as e:
        print(f"\n请求失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
