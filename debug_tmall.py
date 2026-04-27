#!/usr/bin/env python3
"""调试脚本：检查天猫页面真实状态"""

import asyncio
from playwright.async_api import async_playwright

async def debug_page():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ]
        )
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='zh-CN',
        )
        page = await context.new_page()
        
        url = "https://detail.tmall.com/item.htm?id=702426918805"
        
        print(f"访问: {url}")
        
        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)
            await asyncio.sleep(3)
            
            print(f"\n页面标题: {await page.title()}")
            print(f"当前URL: {page.url}")
            
            # 检查是否跳转到登录页
            if 'login' in page.url.lower() or 'login' in (await page.title()).lower():
                print("\n⚠️ 检测到登录页面!")
                
                # 检查页面内容
                content = await page.content()
                
                # 查找可能的错误信息
                if '请登录' in content:
                    print("- 提示: 请登录")
                if '验证' in content:
                    print("- 提示: 需要验证")
                if '账号' in content:
                    print("- 提示: 账号相关")
                
                # 截图保存
                await page.screenshot(path='/workspace/projects/debug_login.png')
                print("\n截图已保存到: /workspace/projects/debug_login.png")
            
            # 统计图片数量
            imgs = await page.query_selector_all('img')
            print(f"\n页面图片数量: {len(imgs)}")
            
            # 提取所有图片URL
            all_urls = []
            for img in imgs[:20]:  # 只看前20个
                src = await img.get_attribute('src')
                data_src = await img.get_attribute('data-src')
                if src:
                    all_urls.append(f"src: {src[:80]}...")
                if data_src:
                    all_urls.append(f"data-src: {data_src[:80]}...")
            
            print("\n前20个图片URL:")
            for url in all_urls[:10]:
                print(f"  {url}")
            
            # 检查meta标签
            og_image = await page.query_selector('meta[property="og:image"]')
            if og_image:
                content = await og_image.get_attribute('content')
                print(f"\nog:image: {content}")
            else:
                print("\nog:image: 未找到")
            
        except Exception as e:
            print(f"错误: {e}")
        finally:
            await browser.close()

if __name__ == '__main__':
    asyncio.run(debug_page())
