(() => {
  const MIN_DISPLAY_SIZE = 140
  const WEBSITE_HOSTS = new Set(['124.223.26.206', 'localhost', '10.0.4.6'])
  if (WEBSITE_HOSTS.has(window.location.hostname)) return

  let currentImage = null
  let lastHoveredImagePayload = null
  let hideTimer = null

  const button = document.createElement('button')
  button.innerHTML = `<span class="zaomeng-capture-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.9 6.2L21 11l-6.1 2.1L12 19l-2.9-5.9L3 11l6.1-2.8L12 2z"/></svg></span><span class="zaomeng-capture-text">采集</span>`
  button.style.position = 'fixed'
  button.style.zIndex = '2147483647'
  button.style.display = 'none'
  button.style.alignItems = 'center'
  button.style.gap = '6px'
  button.style.height = '32px'
  button.style.padding = '4px 10px 4px 5px'
  button.style.border = '1px solid rgba(255,255,255,0.28)'
  button.style.borderRadius = '999px'
  button.style.background = 'rgba(15, 23, 42, 0.78)'
  button.style.backdropFilter = 'blur(10px)'
  button.style.color = '#fff'
  button.style.fontSize = '12px'
  button.style.fontWeight = '600'
  button.style.lineHeight = '1'
  button.style.cursor = 'pointer'
  button.style.boxShadow = '0 10px 28px rgba(0,0,0,0.26)'
  button.style.pointerEvents = 'auto'
  button.style.transition = 'transform 120ms ease, background 120ms ease, box-shadow 120ms ease'
  document.documentElement.appendChild(button)

  const logo = button.querySelector('.zaomeng-capture-logo')
  logo.style.width = '24px'
  logo.style.height = '24px'
  logo.style.borderRadius = '999px'
  logo.style.display = 'inline-flex'
  logo.style.alignItems = 'center'
  logo.style.justifyContent = 'center'
  logo.style.overflow = 'hidden'
  logo.style.background = 'linear-gradient(135deg, #a855f7, #2563eb)'
  logo.style.color = '#fff'

  const logoSvg = logo.querySelector('svg')
  logoSvg.style.display = 'block'

  const text = button.querySelector('.zaomeng-capture-text')
  text.style.letterSpacing = '0.02em'

  const tip = document.createElement('div')
  tip.style.position = 'fixed'
  tip.style.zIndex = '2147483647'
  tip.style.left = '50%'
  tip.style.top = '24px'
  tip.style.transform = 'translateX(-50%)'
  tip.style.padding = '10px 14px'
  tip.style.borderRadius = '999px'
  tip.style.background = 'rgba(15, 23, 42, 0.92)'
  tip.style.color = '#fff'
  tip.style.fontSize = '12px'
  tip.style.display = 'none'
  tip.style.boxShadow = '0 8px 24px rgba(0,0,0,0.22)'
  document.documentElement.appendChild(tip)

  const showTip = (message) => {
    tip.textContent = message
    tip.style.display = 'block'
    clearTimeout(showTip.timer)
    showTip.timer = setTimeout(() => {
      tip.style.display = 'none'
    }, 2200)
  }

  button.addEventListener('mouseenter', () => {
    cancelHide()
    button.style.transform = 'translateY(-1px)'
    button.style.background = 'rgba(88, 28, 135, 0.88)'
    button.style.boxShadow = '0 14px 34px rgba(88,28,135,0.32)'
  })

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)'
    button.style.background = 'rgba(15, 23, 42, 0.78)'
    button.style.boxShadow = '0 10px 28px rgba(0,0,0,0.26)'
    scheduleHide()
  })

  const buildPayload = (image, captureMethod) => {
    if (!image) return null
    const imageUrl = normalizeImageUrl(image.currentSrc || image.src || image.dataset?.src || image.dataset?.original || '')
    if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return null

    return {
      imageUrl,
      pageUrl: window.location.href,
      pageTitle: document.title,
      sourceHost: window.location.hostname,
      capturedAt: Date.now(),
      imageType: 'main',
      captureMethod,
    }
  }

  const normalizeImageUrl = (url) => {
    if (!url) return ''
    try {
      return new URL(url, window.location.href).toString()
    } catch {
      return url
    }
  }

  const getCandidateImage = (target) => {
    const image = target instanceof HTMLImageElement ? target : target.closest('img')
    if (!image) return null
    const rect = image.getBoundingClientRect()
    if (rect.width < MIN_DISPLAY_SIZE || rect.height < MIN_DISPLAY_SIZE) return null
    const imageUrl = normalizeImageUrl(image.currentSrc || image.src || image.dataset?.src || image.dataset?.original || '')
    if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return null
    return image
  }

  const placeButton = () => {
    if (!currentImage) {
      button.style.display = 'none'
      return
    }

    const rect = currentImage.getBoundingClientRect()
    button.style.display = 'inline-flex'
    button.style.left = `${Math.max(16, rect.right - button.offsetWidth - 10)}px`
    button.style.top = `${Math.max(16, rect.top + 12)}px`
  }

  const hideButton = () => {
    currentImage = null
    button.style.display = 'none'
  }

  const scheduleHide = () => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      hideButton()
    }, 120)
  }

  const cancelHide = () => {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  document.addEventListener('mousemove', (event) => {
    if (button.contains(event.target)) {
      cancelHide()
      return
    }

    const nextImage = getCandidateImage(event.target)
    if (!nextImage) {
      scheduleHide()
      return
    }

    cancelHide()
    currentImage = nextImage
    lastHoveredImagePayload = buildPayload(nextImage, 'hovered-image')
    placeButton()
  }, true)

  document.addEventListener('contextmenu', (event) => {
    const image = getCandidateImage(event.target)
    if (image) {
      lastHoveredImagePayload = buildPayload(image, 'contextmenu-target')
    }
  }, true)

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ZAOMENG_GET_HOVERED_IMAGE') {
      sendResponse(lastHoveredImagePayload || null)
      return true
    }

    if (message?.type === 'ZAOMENG_SHOW_TIP') {
      showTip(message.message || '未识别到图片')
      sendResponse({ success: true })
      return true
    }

    return false
  })

  window.addEventListener('scroll', placeButton, true)
  window.addEventListener('resize', placeButton)

  button.addEventListener('click', () => {
    if (!currentImage) return

    const payload = buildPayload(currentImage, 'hover-button')
    if (!payload?.imageUrl) {
      showTip('未找到可采集的图片地址')
      return
    }

    showTip('正在采集到造梦AI...')
    chrome.runtime.sendMessage({ type: 'ZAOMENG_CAPTURE_IMAGE', payload }, () => {
      if (chrome.runtime.lastError) {
        showTip('采集失败，请打开造梦AI网站后重试')
        return
      }

      showTip('已发送至造梦AI，正在保存...')
      hideButton()
    })
  })
})()
