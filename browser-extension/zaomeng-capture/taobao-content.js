(() => {
  const MIN_DISPLAY_SIZE = 140
  let currentImage = null
  let hideTimer = null

  const button = document.createElement('button')
  button.textContent = '采集到造梦AI'
  button.style.position = 'fixed'
  button.style.zIndex = '2147483647'
  button.style.padding = '8px 10px'
  button.style.border = 'none'
  button.style.borderRadius = '999px'
  button.style.background = 'linear-gradient(135deg, #7c3aed, #2563eb)'
  button.style.color = '#fff'
  button.style.fontSize = '12px'
  button.style.cursor = 'pointer'
  button.style.boxShadow = '0 8px 24px rgba(0,0,0,0.22)'
  button.style.display = 'none'
  button.style.pointerEvents = 'auto'
  document.documentElement.appendChild(button)

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

  const getCandidateImage = (target) => {
    const image = target instanceof HTMLImageElement ? target : target.closest('img')
    if (!image) return null
    const rect = image.getBoundingClientRect()
    if (rect.width < MIN_DISPLAY_SIZE || rect.height < MIN_DISPLAY_SIZE) return null
    if (!image.currentSrc && !image.src) return null
    return image
  }

  const placeButton = () => {
    if (!currentImage) {
      button.style.display = 'none'
      return
    }

    const rect = currentImage.getBoundingClientRect()
    button.style.display = 'block'
    button.style.left = `${Math.max(16, rect.right - button.offsetWidth)}px`
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
    placeButton()
  }, true)

  window.addEventListener('scroll', placeButton, true)
  window.addEventListener('resize', placeButton)
  button.addEventListener('mouseenter', cancelHide)
  button.addEventListener('mouseleave', scheduleHide)

  button.addEventListener('click', () => {
    if (!currentImage) return

    const imageUrl = currentImage.currentSrc || currentImage.src
    if (!imageUrl) {
      showTip('未找到可采集的图片地址')
      return
    }

    const payload = {
      imageUrl,
      pageUrl: window.location.href,
      pageTitle: document.title,
      sourceHost: window.location.hostname,
      capturedAt: Date.now(),
      imageType: 'main',
    }

    chrome.runtime.sendMessage({ type: 'ZAOMENG_CAPTURE_IMAGE', payload }, () => {
      if (chrome.runtime.lastError) {
        showTip('采集失败，请打开造梦AI网站后重试')
        return
      }

      showTip('已采集，切回造梦AI页面查看')
      hideButton()
    })
  })
})()
