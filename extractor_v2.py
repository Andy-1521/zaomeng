#!/usr/bin/env python3
"""
天猫/淘宝商品图片提取器 v2
增强版：绕过浏览器指纹检测
"""

import asyncio
import json
import re
from typing import Optional, Dict, Any

from playwright.async_api import async_playwright, Browser, BrowserContext


class StealthExtractor:
    """带反检测的商品图片提取器"""
    
    TAOBAO_DOMAINS = ['alicdn.com', 'taobao.com', 'tmall.com', '1688.com']
    FILTER_KEYS = ['logo', 'icon', 'qrcode', 'banner', 'avatar', 'watermark', 'ad-']
    
    def __init__(self):
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
    
    async def __aenter__(self):
        p = await async_playwright().__aenter__()
        
        # 启动带反检测的浏览器
        self.browser = await p.chromium.launch(
            headless=True,
            args=[
                # 禁用自动化特征
                '--disable-blink-features=AutomationControlled',
                '--disable-automation',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                
                # 伪装真实浏览器特征
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                
                # 禁用提示条
                '--disable-infobars',
                '--exclude-switches',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                
                # 伪装语言和时区
                '--lang=zh-CN',
            ]
        )
        
        # 创建上下文
        self.context = await self.browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            # 伪装 User-Agent
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='zh-CN',
            timezone_id='Asia/Shanghai',
            geolocation={'latitude': 30.5728, 'longitude': 114.2529},  # 武汉
            permissions=['geolocation'],
            # 忽略 https 错误
            ignore_https_errors=True,
        )
        
        # 注入反检测脚本 - 覆盖 navigator.webdriver
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
                configurable: true
            });
            
            // 伪装 plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin' }
                ],
                configurable: true
            });
            
            // 伪装 languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['zh-CN', 'zh', 'en-US', 'en'],
                configurable: true
            });
            
            // 伪装 permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission, onchange: null }) :
                    originalQuery(parameters)
            );
            
            // 删除自动化标识
            delete navigator.__proto__.webdriver;
        """)
        
        return self
    
    async def __aexit__(self, *args):
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        await async_playwright().__aexit__(*args)
    
    def clean_url(self, url: str) -> str:
        if not url:
            return ''
        # 去除尺寸后缀
        url = re.sub(r'_\d+x\d+\.(jpg|jpeg|png|webp)', r'.\1', url, flags=re.I)
        url = re.sub(r'q\d+\.jpg_\.webp', r'.jpg', url)
        url = re.sub(r'\?.*$', '', url)
        return url.strip()
    
    def is_valid_image(self, url: str) -> bool:
        if not url or not url.startswith('http'):
            return False
        url_lower = url.lower()
        if any(k in url_lower for k in self.FILTER_KEYS):
            return False
        if 'data:image' in url_lower:
            return False
        return any(d in url_lower for d in self.TAOBAO_DOMAINS)
    
    async def extract(self, url: str) -> Dict[str, Any]:
        """提取商品图片"""
        result = {
            'success': False,
            'platform': 'unknown',
            'final_url': '',
            'title': '',
            'main_image': '',
            'images': [],
            'error': '',
            'debug_info': {}
        }
        
        try:
            page = await self.context.new_page()
            
            # 拦截请求，模拟真实用户行为
            await page.route('**/*', lambda route: route.continue_())
            
            # 访问页面
            print(f"正在访问: {url}")
            response = await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            
            # 等待页面稳定
            await asyncio.sleep(3)
            
            result['final_url'] = page.url
            result['title'] = await page.title()
            
            # 检测平台
            if 'tmall.com' in page.url:
                result['platform'] = 'tmall'
            elif 'taobao.com' in page.url:
                result['platform'] = 'taobao'
            elif '1688.com' in page.url:
                result['platform'] = '1688'
            
            # 检测登录页
            title = await page.title()
            if '登录' in title or 'login' in title.lower():
                result['error'] = '需要登录'
                await page.close()
                return result
            
            # 提取策略1: meta og:image
            og_images = await page.query_selector_all('meta[property="og:image"]')
            for meta in og_images:
                content = await meta.get_attribute('content')
                if content and self.is_valid_image(content):
                    result['images'].append(self.clean_url(content))
            
            # 提取策略2: script中的JSON数据
            scripts = await page.query_selector_all('script')
            json_patterns = [
                r'"images"\s*:\s*\[([^\]]+)\]',
                r'"pics"\s*:\s*\[([^\]]+)\]',
                r'"auctionImages"\s*:\s*\[([^\]]+)\]',
                r'"mainPic"\s*:\s*"([^"]+)"',
                r'"thumbUrl"\s*:\s*"([^"]+)"',
                r'"itemImages"\s*:\s*\[([^\]]+)\]',
                r'"defaultPic"\s*:\s*"([^"]+)"',
            ]
            
            for script in scripts:
                text = await script.text_content()
                if not text:
                    continue
                for pattern in json_patterns:
                    matches = re.findall(pattern, text)
                    for match in matches:
                        if match.startswith('['):
                            urls = re.findall(r'["\']([^"\']+\.(?:jpg|jpeg|png|webp)[^"\']*)["\']', match, re.I)
                            for u in urls:
                                if self.is_valid_image(u):
                                    result['images'].append(self.clean_url(u))
                        elif self.is_valid_image(match):
                            result['images'].append(self.clean_url(match))
            
            # 提取策略3: 缩略图区域
            selectors = [
                '.tb-thumb img', '.J_UlThumb img', '.spec-list img',
                '[class*="thumb"] img', '[class*="gallery"] img',
                '[class*="main-pic"] img', '[class*="mainPic"] img',
                '#J_ImgBooth', '#main-pic', '[class*="preview"] img',
            ]
            
            for sel in selectors:
                try:
                    imgs = await page.query_selector_all(sel)
                    for img in imgs:
                        for attr in ['src', 'data-src', 'data-original', 'data-normal']:
                            val = await img.get_attribute(attr)
                            if val and self.is_valid_image(val):
                                result['images'].append(self.clean_url(val))
                except Exception:
                    continue
            
            # 提取策略4: 全页面所有图片
            all_imgs = await page.query_selector_all('img')
            for img in all_imgs:
                for attr in ['src', 'data-src', 'data-original', 'data-lazy-src']:
                    val = await img.get_attribute(attr)
                    if val and self.is_valid_image(val):
                        result['images'].append(self.clean_url(val))
            
            # 去重
            result['images'] = list(dict.fromkeys(result['images']))
            
            # 过滤小图（宽高小于100px的）
            valid_images = []
            for img_url in result['images']:
                # 简单过滤：保留较大尺寸的图片URL
                if '100x100' not in img_url and '50x50' not in img_url:
                    valid_images.append(img_url)
            result['images'] = valid_images
            
            if result['images']:
                result['main_image'] = result['images'][0]
                result['success'] = True
            
            await page.close()
            
        except asyncio.TimeoutError:
            result['error'] = '页面加载超时'
        except Exception as e:
            result['error'] = str(e)
        
        return result


async def main():
    import sys
    
    if len(sys.argv) < 2:
        print("用法: python extractor_v2.py <商品链接>")
        return
    
    url = sys.argv[1]
    print(f"=" * 60)
    print(f"提取器 v2 - 增强反检测版")
    print(f"=" * 60)
    
    async with StealthExtractor() as extractor:
        result = await extractor.extract(url)
        
        print(f"\n平台: {result['platform']}")
        print(f"标题: {result['title']}")
        print(f"最终URL: {result['final_url']}")
        print(f"\n提取到 {len(result['images'])} 张图片:")
        for i, img in enumerate(result['images'][:10], 1):
            print(f"  {i}. {img[:80]}...")
        
        if result['error']:
            print(f"\n错误: {result['error']}")
        
        print(f"\n{'=' * 60}")
        print(f"结果: {'✅ 成功' if result['success'] else '❌ 失败'}")


if __name__ == '__main__':
    asyncio.run(main())
