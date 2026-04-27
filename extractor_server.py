#!/usr/bin/env python3
"""
天猫/淘宝商品图片提取器 - 独立版本
通过子进程调用
"""

import asyncio
import json
import re
import sys
from playwright.async_api import async_playwright, Browser, BrowserContext


class ProductImageExtractor:
    """商品图片提取器"""
    
    TAOBAO_DOMAINS = ['alicdn.com', 'taobao.com', 'tmall.com']
    FILTER_KEYS = ['logo', 'icon', 'qrcode', 'banner', 'avatar', 'watermark', 'ad-']
    
    def __init__(self):
        self.browser = None
        self.context = None
    
    async def __aenter__(self):
        p = await async_playwright().__aenter__()
        self.browser = await p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ]
        )
        self.context = await self.browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='zh-CN',
        )
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        return self
    
    async def __aexit__(self, *args):
        try:
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
        except Exception:
            pass
    
    def normalize_url(self, raw_url: str) -> dict:
        """URL 标准化"""
        try:
            from urllib.parse import urlparse, parse_qs
            url = urlparse(raw_url)
            params = parse_qs(url.query)
            
            item_id = params.get('id', [None])[0]
            sku_id = params.get('skuId', [None])[0]
            
            # 构建规范 URL
            normalized = f"https://detail.tmall.com/item.htm?id={item_id}"
            if sku_id:
                normalized += f"&skuId={sku_id}"
            
            return {'normalized': normalized, 'id': item_id, 'sku_id': sku_id}
        except Exception as e:
            return {'normalized': raw_url, 'id': None, 'sku_id': None, 'error': str(e)}
    
    def detect_platform(self, url: str) -> str:
        lower = url.lower()
        if 'tmall.com' in lower or 'taobao.com' in lower:
            return 'taobao'
        if 'pinduoduo.com' in lower or 'yangkeduo.com' in lower:
            return 'pinduoduo'
        return 'unknown'
    
    def is_valid_image(self, url: str, platform: str) -> bool:
        if not url or not url.startswith('http'):
            return False
        if 'data:image' in url:
            return False
        url_lower = url.lower()
        for key in self.FILTER_KEYS:
            if key in url_lower:
                return False
        if platform == 'taobao':
            return any(d in url_lower for d in self.TAOBAO_DOMAINS)
        return True
    
    def clean_url(self, url: str) -> str:
        if not url:
            return ''
        # 去除尺寸后缀
        url = re.sub(r'_\d+x\d+\.(jpg|jpeg|png|webp)', r'.\1', url, flags=re.I)
        url = re.sub(r'q\d+\.jpg_\.webp$', '.jpg', url)
        url = re.sub(r'\?.*$', '', url)
        return url.strip()
    
    async def extract(self, raw_url: str) -> dict:
        result = {
            'success': False,
            'platform': 'unknown',
            'final_url': '',
            'title': '',
            'main_image': '',
            'images': [],
            'error': ''
        }
        
        page = None
        try:
            # URL 标准化
            norm = self.normalize_url(raw_url)
            if not norm.get('id'):
                result['error'] = norm.get('error', '无法提取商品ID')
                return result
            
            normalized_url = norm['normalized']
            print(f"[提取器] 标准化URL: {normalized_url}", file=sys.stderr)
            
            page = await self.context.new_page()
            
            # 访问页面
            print(f"[提取器] 正在打开页面...", file=sys.stderr)
            await page.goto(normalized_url, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(3)
            
            final_url = page.url
            title = await page.title()
            platform = self.detect_platform(final_url)
            
            result['final_url'] = final_url
            result['title'] = title
            result['platform'] = platform
            
            print(f"[提取器] 最终URL: {final_url}", file=sys.stderr)
            print(f"[提取器] 标题: {title}", file=sys.stderr)
            
            # 检测登录/风控
            if '登录' in title or 'login' in title.lower() or 'login.taobao' in final_url:
                result['error'] = '页面需要登录或验证'
                return result
            
            # 提取图片
            all_images = []
            seen = set()
            add_image = lambda url: all_images.append(url) if url and url not in seen and not seen.add(url) else None
            
            # 策略1: og:image
            og_images = await page.query_selector_all('meta[property="og:image"]')
            for meta in og_images:
                content = await meta.get_attribute('content')
                if content:
                    add_image(content)
            
            # 策略2: script JSON
            html = await page.content()
            patterns = [
                r'"(?:images|pics|auctionImages|itemImages|mainPic)"\s*:\s*\[([^\]]+)\]',
                r'"(?:thumbUrl|hdThumbUrl|defaultPic)"\s*:\s*"([^"]+)"',
            ]
            for pattern in patterns:
                for match in re.findall(pattern, html, re.I):
                    if match.startswith('['):
                        urls = re.findall(r'["\']([^"\']+\.(?:jpg|jpeg|png|webp)[^"\']*)["\']', match, re.I)
                        for u in urls:
                            add_image(u)
                    else:
                        add_image(match)
            
            # 策略3: 主图区域选择器
            selectors = [
                '.tb-thumb img', '.J_UlThumb img', '.tb-gallery img',
                '#J_ImgBooth', '[class*="main-pic"] img', '[class*="mainPic"] img',
                '[class*="gallery"] img', '[class*="preview"] img', '[class*="thumb"] img',
            ]
            for sel in selectors:
                try:
                    imgs = await page.query_selector_all(sel)
                    for img in imgs:
                        for attr in ['src', 'data-src', 'data-original', 'data-normal']:
                            val = await img.get_attribute(attr)
                            if val:
                                add_image(self.clean_url(val))
                except:
                    pass
            
            # 策略4: 全页图片
            all_imgs = await page.query_selector_all('img')
            for img in all_imgs:
                for attr in ['src', 'data-src', 'data-original']:
                    val = await img.get_attribute(attr)
                    if val and self.is_valid_image(val, platform):
                        add_image(self.clean_url(val))
            
            # 过滤
            result['images'] = [
                u for u in all_images 
                if u and self.is_valid_image(u, platform) 
                and '100x100' not in u and '50x50' not in u
            ]
            
            if result['images']:
                result['main_image'] = result['images'][0]
                result['success'] = True
                print(f"[提取器] ✅ 成功提取 {len(result['images'])} 张图片", file=sys.stderr)
            else:
                result['error'] = '未能在页面中找到商品图片'
                print(f"[提取器] ❌ 未找到图片", file=sys.stderr)
            
        except asyncio.TimeoutError:
            result['error'] = '页面加载超时'
        except Exception as e:
            result['error'] = str(e)
            print(f"[提取器] ❌ 错误: {e}", file=sys.stderr)
        finally:
            if page:
                await page.close()
        
        return result


async def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': '请提供URL参数'}))
        return
    
    raw_url = sys.argv[1]
    
    async with ProductImageExtractor() as extractor:
        result = await extractor.extract(raw_url)
    
    # 输出 JSON 结果
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
