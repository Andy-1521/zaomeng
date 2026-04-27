#!/usr/bin/env python3
"""
天猫/淘宝商品链接主图提取器
支持：天猫、淘宝、兼容短链跳转
多策略提取主图，稳定性和成功率优先
"""

import asyncio
import json
import re
import time
from typing import Optional
from urllib.parse import urlparse, parse_qs, urljoin

from playwright.async_api import async_playwright, Page, Browser, BrowserContext


class ImageExtractor:
    """商品图片提取器"""
    
    # 图片域名白名单
    TAOBAO_IMAGE_DOMAINS = [
        'alicdn.com', 'taobao.com', 'tmall.com', '1688.com',
        'gw.alicdn.com', 'img.alicdn.com', 'cc.alicdn.com',
    ]
    
    # 需要过滤的图片关键词
    FILTER_KEYWORDS = [
        'logo', 'icon', 'qrcode', 'qr-code', 'banner', 'avatar',
        'sprite', 'logo', 'loading', 'placeholder', 'spacer',
        'watermark', 'wm', 'ad-', 'ads/', 'advertisement',
    ]
    
    # 小图阈值（像素）
    MIN_IMAGE_SIZE = 100
    
    def __init__(self):
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
    
    async def __aenter__(self):
        playwright = await async_playwright().__aenter__()
        self.browser = await playwright.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
            ]
        )
        self.context = await self.browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='zh-CN',
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
    
    def _is_valid_image_url(self, url: str) -> bool:
        """验证图片URL是否有效"""
        if not url or not isinstance(url, str):
            return False
        
        url_lower = url.lower()
        
        # 必须是http(s)开头
        if not url_lower.startswith(('http://', 'https://')):
            return False
        
        # 过滤data URI
        if url_lower.startswith('data:'):
            return False
        
        # 过滤关键字
        for keyword in self.FILTER_KEYWORDS:
            if keyword in url_lower:
                return False
        
        # 必须是淘宝系域名
        is_valid_domain = any(domain in url_lower for domain in self.TAOBAO_IMAGE_DOMAINS)
        
        # 或者是常见图片扩展名
        has_image_ext = any(f'.{ext}' in url_lower for ext in ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])
        
        return is_valid_domain or has_image_ext
    
    def _clean_image_url(self, url: str) -> str:
        """清洗图片URL，保留高清版本"""
        if not url:
            return ''
        
        # 去除尺寸后缀
        # 例如: https://img.alicdn.com/xxx_400x400.jpg -> https://img.alicdn.com/xxx.jpg
        url = re.sub(r'_\d+x\d+\.(jpg|jpeg|png|webp)', r'.\1', url, flags=re.IGNORECASE)
        
        # 去除查询参数中的缩放参数
        url = re.sub(r'(\.\w+)\?.*$', r'\1', url)
        
        # 去除常见的缩放参数
        url = re.sub(r'[?&](\w+)_s=\d+', '', url)
        url = re.sub(r'[?&]x-oss.*?(?=&|$)', '', url)
        
        # 清理末尾多余字符
        url = url.strip()
        
        return url
    
    def _detect_platform(self, url: str) -> str:
        """检测平台类型"""
        url_lower = url.lower()
        if 'tmall.com' in url_lower:
            return 'tmall'
        elif 'taobao.com' in url_lower:
            return 'taobao'
        elif '1688.com' in url_lower:
            return '1688'
        elif 'pinduoduo.com' in url_lower or 'yangkeduo.com' in url_lower:
            return 'pinduoduo'
        return 'unknown'
    
    def _normalize_url(self, url: str) -> str:
        """URL规范化"""
        if not url:
            return ''
        
        url = url.strip()
        
        # 补全 https
        if url.startswith('//'):
            url = 'https:' + url
        elif url.startswith('http:'):
            url = url.replace('http:', 'https:')
        elif not url.startswith('https://'):
            url = 'https://' + url
        
        return url
    
    async def _handle_short_url(self, page: Page, url: str) -> str:
        """处理短链接跳转"""
        try:
            response = await page.goto(url, wait_until='commit', timeout=10000)
            final_url = page.url
            
            # 如果有重定向，等待稳定
            if final_url != url:
                await asyncio.sleep(0.5)
                final_url = page.url
            
            return final_url
        except Exception:
            return url
    
    async def _extract_from_meta(self, page: Page) -> list[str]:
        """策略1: 从meta标签提取"""
        images = []
        
        # og:image
        og_images = await page.query_selector_all('meta[property="og:image"]')
        for meta in og_images:
            content = await meta.get_attribute('content')
            if content:
                images.append(self._clean_image_url(self._normalize_url(content)))
        
        # twitter:image
        twitter_images = await page.query_selector_all('meta[name="twitter:image"]')
        for meta in twitter_images:
            content = await meta.get_attribute('content')
            if content:
                images.append(self._clean_image_url(self._normalize_url(content)))
        
        return images
    
    async def _extract_from_script_json(self, page: Page) -> list[str]:
        """策略2: 从script标签中的JSON数据提取"""
        images = []
        
        # 获取页面HTML
        html = await page.content()
        
        # 多种图片字段模式
        patterns = [
            # 标准JSON字段
            r'"images"\s*:\s*\[([^\]]+)\]',
            r'"pics"\s*:\s*\[([^\]]+)\]',
            r'"pictures"\s*:\s*\[([^\]]+)\]',
            r'"auctionImages"\s*:\s*\[([^\]]+)\]',
            r'"mainPic"\s*:\s*"([^"]+)"',
            r'"thumbUrl"\s*:\s*"([^"]+)"',
            r'"hdThumbUrl"\s*:\s*"([^"]+)"',
            r'"itemImages"\s*:\s*\[([^\]]+)\]',
            r'"imageList"\s*:\s*\[([^\]]+)\]',
            r'"skuImages"\s*:\s*\{[^}]*\}',
            # Tmall特有
            r'"defaultPic"\s*:\s*"([^"]+)"',
            r'"mainImage"\s*:\s*"([^"]+)"',
            # 淘宝特有
            r'"picUrl"\s*:\s*"([^"]+)"',
            r'"pic_url"\s*:\s*"([^"]+)"',
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, html, re.IGNORECASE)
            for match in matches:
                # 如果是数组，提取其中的URL
                if match.startswith('['):
                    # 提取数组中的所有URL
                    urls = re.findall(r'["\']([^"\']+\.(?:jpg|jpeg|png|webp|gif)[^"\']*)["\']', match, re.IGNORECASE)
                    for url in urls:
                        images.append(self._clean_image_url(self._normalize_url(url)))
                else:
                    # 单个URL
                    if self._is_valid_image_url(match):
                        images.append(self._clean_image_url(self._normalize_url(match)))
        
        return images
    
    async def _extract_from_thumb_area(self, page: Page, platform: str) -> list[str]:
        """策略3: 从商品缩略图区域提取"""
        images = []
        
        if platform in ['taobao', 'tmall']:
            # 淘宝/天猫缩略图区域选择器（多个备选）
            selectors = [
                # 主图区域
                '.tb-thumb ul li img',
                '.main-thumb img',
                '.J_UlThumb img',
                '.tb-gallery img',
                # 淘宝主图
                '#J_ImgBooth',
                '#J_mainPic',
                '[class*="main-pic"] img',
                '[class*="mainPic"] img',
                '[class*="main-image"] img',
                '[class*="gallery"] img',
                '[class*="magnifier"] img',
                # 天猫主图
                '[class*="tb-wrapper"] img',
                '[class*="detail-content"] img',
                # 通用缩略图
                '[class*="thumb"] img',
                '[class*="Thumb"] img',
                '[class*="thumbnail"] img',
                '[class*="preview"] img',
                '[class*="gallery"] li img',
                # 图片列表
                '.spec-list img',
                '.img-list img',
                '[data-spm-anchor-id] img',
            ]
        elif platform == 'pinduoduo':
            selectors = [
                '[class*="goods-image"] img',
                '[class*="main-image"] img',
                '[class*="preview"] img',
                '[class*="thumb"] img',
                'img[class*="photo"]',
                '[class*="gallery"] img',
            ]
        else:
            selectors = ['img']
        
        for selector in selectors:
            try:
                elements = await page.query_selector_all(selector)
                for el in elements:
                    # 尝试多个属性
                    for attr in ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-a-src', 'data-r-src']:
                        url = await el.get_attribute(attr)
                        if url and self._is_valid_image_url(url):
                            images.append(self._clean_image_url(self._normalize_url(url)))
            except Exception:
                continue
        
        return images
    
    async def _extract_from_all_images(self, page: Page) -> list[tuple[str, int]]:
        """策略4: 遍历全页图片并评分"""
        images_with_score = []
        
        elements = await page.query_selector_all('img')
        
        for el in elements:
            try:
                # 获取多个属性
                url = None
                width = 0
                height = 0
                
                for attr in ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-normal']:
                    val = await el.get_attribute(attr)
                    if val and self._is_valid_image_url(val):
                        url = val
                        break
                
                if not url:
                    continue
                
                # 获取尺寸
                try:
                    box = await el.bounding_box()
                    if box:
                        width = box.get('width', 0)
                        height = box.get('height', 0)
                except Exception:
                    pass
                
                # 获取自然尺寸
                try:
                    nat_width = await el.get_attribute('naturalWidth')
                    nat_height = await el.get_attribute('naturalHeight')
                    if nat_width:
                        width = int(nat_width)
                    if nat_height:
                        height = int(nat_height)
                except Exception:
                    pass
                
                # 计算评分
                score = 0
                
                # 尺寸评分：越大分数越高
                if width >= 800 and height >= 800:
                    score += 50
                elif width >= 500 and height >= 500:
                    score += 30
                elif width >= 300 and height >= 300:
                    score += 10
                
                # 位置评分：在主图区域的高分
                try:
                    box = await el.bounding_box()
                    if box:
                        # 主图通常在页面左上区域
                        if box.get('x', 0) < 800 and box.get('y', 0) < 600:
                            score += 20
                except Exception:
                    pass
                
                # 属性评分
                src = await el.get_attribute('src') or ''
                if any(k in src.lower() for k in ['baike', 'wiki', 'tfscontent']):
                    score -= 10
                
                images_with_score.append((self._clean_image_url(self._normalize_url(url)), score))
            except Exception:
                continue
        
        # 按分数排序
        images_with_score.sort(key=lambda x: x[1], reverse=True)
        
        return images_with_score
    
    async def extract(self, url: str, max_retries: int = 2) -> dict:
        """
        提取商品主图
        
        Args:
            url: 商品链接
            max_retries: 最大重试次数
        
        Returns:
            dict: {
                success: bool,
                platform: str,
                final_url: str,
                title: str,
                main_image: str,
                images: list[str],
                error: str
            }
        """
        result = {
            'success': False,
            'platform': 'unknown',
            'final_url': '',
            'title': '',
            'main_image': '',
            'images': [],
            'error': ''
        }
        
        for attempt in range(max_retries):
            try:
                page = await self.context.new_page()
                
                # 处理短链接
                final_url = await self._handle_short_url(page, url)
                result['final_url'] = final_url
                result['platform'] = self._detect_platform(final_url)
                
                if result['platform'] == 'unknown':
                    result['error'] = '无法识别的平台'
                    await page.close()
                    continue
                
                # 等待页面加载
                await page.wait_for_load_state('networkidle', timeout=30000)
                await asyncio.sleep(2)  # 额外等待JS渲染
                
                # 获取标题
                try:
                    result['title'] = await page.title()
                except Exception:
                    pass
                
                # 多策略提取图片
                all_images = []
                
                # 策略1: meta标签
                meta_images = await self._extract_from_meta(page)
                all_images.extend(meta_images)
                
                # 策略2: script中的JSON
                script_images = await self._extract_from_script_json(page)
                all_images.extend(script_images)
                
                # 策略3: 缩略图区域
                thumb_images = await self._extract_from_thumb_area(page, result['platform'])
                all_images.extend(thumb_images)
                
                # 策略4: 全页图片评分
                scored_images = await self._extract_from_all_images(page)
                all_images.extend([img for img, _ in scored_images])
                
                # 去重
                seen = set()
                unique_images = []
                for img in all_images:
                    if img and img not in seen:
                        seen.add(img)
                        unique_images.append(img)
                
                result['images'] = unique_images
                
                # 取第一张作为主图（评分最高的）
                if unique_images:
                    result['main_image'] = unique_images[0]
                    result['success'] = True
                
                await page.close()
                return result
                
            except asyncio.TimeoutError:
                result['error'] = f'页面加载超时 (尝试 {attempt + 1}/{max_retries})'
            except Exception as e:
                result['error'] = f'提取失败: {str(e)} (尝试 {attempt + 1}/{max_retries})'
            finally:
                try:
                    await page.close()
                except Exception:
                    pass
            
            # 重试前等待
            if attempt < max_retries - 1:
                await asyncio.sleep(2)
        
        return result


async def extract_product_images(url: str) -> dict:
    """
    提取商品图片的便捷函数
    
    Args:
        url: 商品链接
    
    Returns:
        dict: 提取结果
    """
    async with ImageExtractor() as extractor:
        return await extractor.extract(url)


# ==================== FastAPI 接口版本 ====================

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

app = FastAPI(
    title="商品图片提取API",
    description="天猫/淘宝商品链接主图提取器",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractRequest(BaseModel):
    url: str
    max_retries: int = 2


class ExtractResponse(BaseModel):
    success: bool
    platform: str
    final_url: str
    title: str
    main_image: str
    images: list[str]
    error: str


@app.post("/extract-image", response_model=ExtractResponse)
async def extract_image(request: ExtractRequest):
    """
    提取天猫/淘宝商品主图
    
    支持平台：
    - 天猫 (tmall.com)
    - 淘宝 (taobao.com)
    - 拼多多 (pinduoduo.com/yangkeduo.com)
    
    返回数据：
    - success: 是否成功
    - platform: 检测到的平台
    - final_url: 最终URL（处理了短链跳转）
    - title: 商品标题
    - main_image: 主图URL
    - images: 所有提取到的图片列表（按评分排序）
    - error: 错误信息（如果有）
    """
    if not request.url:
        raise HTTPException(status_code=400, detail="URL不能为空")
    
    try:
        result = await extract_product_images(request.url)
        return ExtractResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "ok"}


# ==================== 命令行版本 ====================

async def main():
    """命令行入口"""
    import argparse
    
    parser = argparse.ArgumentParser(description='天猫/淘宝商品图片提取器')
    parser.add_argument('url', help='商品链接')
    parser.add_argument('--max-retries', '-r', type=int, default=2, help='最大重试次数')
    parser.add_argument('--output', '-o', help='输出文件路径')
    parser.add_argument('--pretty', '-p', action='store_true', help='格式化输出')
    
    args = parser.parse_args()
    
    print(f'正在提取图片: {args.url}')
    print('-' * 50)
    
    result = await extract_product_images(args.url)
    
    # 输出
    indent = 2 if args.pretty else None
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=indent)
        print(f'结果已保存到: {args.output}')
    else:
        print(json.dumps(result, ensure_ascii=False, indent=indent))
    
    # 显示摘要
    print('-' * 50)
    if result['success']:
        print(f"平台: {result['platform']}")
        print(f"标题: {result['title']}")
        print(f"主图: {result['main_image']}")
        print(f"图片数量: {len(result['images'])}")
    else:
        print(f"提取失败: {result['error']}")


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        asyncio.run(main())
    else:
        # 如果没有参数，启动FastAPI服务
        import uvicorn
        print("启动 FastAPI 服务...")
        print("API 地址: http://localhost:8000/extract-image")
        print("文档地址: http://localhost:8000/docs")
        uvicorn.run(app, host="0.0.0.0", port=8000)
