import puppeteer from 'puppeteer'

const FILTER_KEYS = ['logo', 'icon', 'qrcode', 'banner', 'avatar', 'watermark', 'ad-', 'sprite']
const TAOBAO_IMAGE_DOMAINS = ['alicdn.com', 'taobao.com', 'tmall.com', '1688.com']

function detectPlatform(url) {
  const lower = url.toLowerCase()
  if (lower.includes('tmall.com') || lower.includes('taobao.com')) return 'taobao'
  if (lower.includes('pinduoduo.com') || lower.includes('yangkeduo.com')) return 'pinduoduo'
  return 'unknown'
}

function normalizeImageUrl(url) {
  if (!url) return ''
  let normalized = url.trim()
  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`
  }
  normalized = normalized.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '.$1')
  normalized = normalized.replace(/q\d+\.jpg_\.webp$/i, '.jpg')
  normalized = normalized.replace(/\?.*$/, '')
  return normalized
}

function isValidImage(url, platform) {
  if (!url) return false
  const normalized = normalizeImageUrl(url)
  if (!normalized.startsWith('http')) return false
  if (normalized.startsWith('data:')) return false
  const lower = normalized.toLowerCase()
  if (FILTER_KEYS.some((key) => lower.includes(key))) return false
  if (lower.includes('100x100') || lower.includes('50x50')) return false

  if (platform === 'taobao') {
    return TAOBAO_IMAGE_DOMAINS.some((domain) => lower.includes(domain))
  }

  return /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(lower) || lower.includes('yangkeduo.com') || lower.includes('pinduoduo.com')
}

async function main() {
  const url = process.argv[2]
  const platform = detectPlatform(url)

  const result = {
    success: false,
    platform,
    final_url: url,
    title: '',
    main_image: '',
    images: [],
    error: '',
  }

  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    })

    const page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.setViewport({ width: 1920, height: 1080 })

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise((resolve) => setTimeout(resolve, 3000))

    result.final_url = page.url()
    result.title = await page.title()

    const html = await page.content()
    if (result.title.includes('登录') || result.title.toLowerCase().includes('login') || result.final_url.includes('login')) {
      result.error = '页面需要登录或验证'
      console.log(JSON.stringify(result, null, 0))
      return
    }

    if (result.title.includes('访问被拒绝') || result.final_url.includes('/punish/') || html.includes('FAIL_SYS_DENY') || html.includes('bxpunish')) {
      result.error = '商品页面被平台风控拦截，当前服务器无法直接提取主图，请改用图片上传方式'
      console.log(JSON.stringify(result, null, 0))
      return
    }

    const images = []
    const seen = new Set()
    const addImage = (candidate) => {
      if (!candidate) return
      const normalized = normalizeImageUrl(candidate)
      if (!isValidImage(normalized, platform)) return
      if (seen.has(normalized)) return
      seen.add(normalized)
      images.push(normalized)
    }

    const ogImage = await page.$eval('meta[property="og:image"]', (node) => node.getAttribute('content')).catch(() => null)
    addImage(ogImage)

    const patternMatches = [
      ...html.matchAll(/"(?:images|pics|pictures|auctionImages|itemImages|imageList)"\s*:\s*\[([^\]]+)\]/gi),
      ...html.matchAll(/"(?:mainPic|thumbUrl|hdThumbUrl|defaultPic|picUrl|pic_url|mainImage)"\s*:\s*"([^"]+)"/gi),
    ]

    for (const match of patternMatches) {
      const value = match[1]
      if (!value) continue
      if (value.includes(',')) {
        const nestedUrls = value.match(/https?:[^"'\]\s,]+|\/\/[^"'\]\s,]+/gi) || []
        nestedUrls.forEach(addImage)
      } else {
        addImage(value)
      }
    }

    const attrValues = await page.$$eval('img', (nodes) =>
      nodes.flatMap((node) => [
        node.getAttribute('src'),
        node.getAttribute('data-src'),
        node.getAttribute('data-original'),
        node.getAttribute('data-lazy-src'),
      ])
    )
    attrValues.forEach(addImage)

    if (images.length === 0) {
      result.error = '未能在页面中找到商品主图'
      console.log(JSON.stringify(result, null, 0))
      return
    }

    result.success = true
    result.main_image = images[0]
    result.images = images
    console.log(JSON.stringify(result, null, 0))
  } catch (error) {
    result.error = error instanceof Error ? error.message : '提取失败'
    console.log(JSON.stringify(result, null, 0))
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
  }
}

main()
