const WEBSITE_ORIGIN = 'https://zaomengai.icu'
const WEBSITE_PATTERNS = [
  'https://zaomengai.icu/*',
]
const WORKSPACE_PATH = '/home'

const CONTEXT_MENU_ID = 'ZAOMENG_SAVE_IMAGE'

const isWebsiteUrl = (url = '') => {
  return url.startsWith('https://zaomengai.icu/')
}

const showTabTip = (tabId, message, status = 'info', durationMs = 2600) => {
  if (!tabId) return
  chrome.tabs.sendMessage(tabId, { type: 'ZAOMENG_SHOW_TIP', message, status, durationMs }, () => {
    void chrome.runtime.lastError
  })
}

const notifyWebsiteTabs = (type, payload) => {
  chrome.tabs.query({ url: WEBSITE_PATTERNS }, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.id) return
      chrome.tabs.sendMessage(tab.id, { type, payload }, () => {
        void chrome.runtime.lastError
      })
    })
  })
}

const openOrFocusWorkspace = () => {
  chrome.tabs.query({ url: WEBSITE_PATTERNS }, (tabs) => {
    const existingTab = tabs.find((tab) => tab.id && isWebsiteUrl(tab.url || ''))
    if (existingTab?.id) {
      chrome.tabs.update(existingTab.id, { active: true, url: `${WEBSITE_ORIGIN}${WORKSPACE_PATH}` })
      if (existingTab.windowId) {
        chrome.windows.update(existingTab.windowId, { focused: true })
      }
      return
    }

    chrome.tabs.create({ url: `${WEBSITE_ORIGIN}${WORKSPACE_PATH}` })
  })
}

const getImageFileName = (imageUrl, contentType = '') => {
  try {
    const pathname = new URL(imageUrl).pathname
    const matched = pathname.match(/([^/]+)\.([a-zA-Z0-9]+)$/)
    if (matched) return `${matched[1]}.${matched[2].toLowerCase()}`
  } catch {
    // 使用 contentType 兜底
  }

  if (contentType.includes('png')) return 'captured-image.png'
  if (contentType.includes('webp')) return 'captured-image.webp'
  if (contentType.includes('gif')) return 'captured-image.gif'
  if (contentType.includes('avif')) return 'captured-image.avif'
  return 'captured-image.jpg'
}

const saveCaptureViaServer = async (payload, onProgress = () => {}) => {
  onProgress('正在使用兼容方式保存图片...', 'warning', 3200)
  const response = await fetch(`${WEBSITE_ORIGIN}/api/plugin/capture-image`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.success || !data?.data?.uploadedUrl) {
    throw new Error(data?.error || data?.message || '保存失败，请先确认已登录造梦AI')
  }

  return data.data
}

const saveCaptureDirectly = async (payload, onProgress = () => {}) => {
  try {
    onProgress('正在读取图片...', 'info', 2200)
    const imageResponse = await fetch(payload.imageUrl, {
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!imageResponse.ok) {
      throw new Error(`图片下载失败 (${imageResponse.status})`)
    }

    const contentType = (imageResponse.headers.get('content-type') || 'image/jpeg').split(';')[0].trim() || 'image/jpeg'
    if (!contentType.startsWith('image/')) {
      throw new Error('当前资源不是图片')
    }

    const blob = await imageResponse.blob()
    if (!blob.size) {
      throw new Error('图片内容为空')
    }

    onProgress('正在上传到造梦AI素材库...', 'info', 3200)
    const fileName = getImageFileName(payload.imageUrl, contentType)
    const policyResponse = await fetch(`${WEBSITE_ORIGIN}/api/upload/oss-policy`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        contentType,
        fileSize: blob.size,
        folder: 'plugin-capture',
      }),
    })
    const policyData = await policyResponse.json().catch(() => null)
    if (!policyResponse.ok || !policyData?.success || !policyData?.data) {
      throw new Error(policyData?.message || '生成上传凭证失败')
    }

    const formData = new FormData()
    formData.append('key', policyData.data.key)
    formData.append('policy', policyData.data.policy)
    formData.append('OSSAccessKeyId', policyData.data.accessId)
    formData.append('Signature', policyData.data.signature)
    formData.append('success_action_status', policyData.data.successActionStatus || '200')
    formData.append('Content-Type', contentType)
    formData.append('file', blob, fileName)

    const uploadResponse = await fetch(policyData.data.host, {
      method: 'POST',
      body: formData,
    })
    if (!uploadResponse.ok) {
      throw new Error(`OSS直传失败 (${uploadResponse.status})`)
    }

    onProgress('上传完成，正在写入图库...', 'info', 2600)
    const completeResponse = await fetch(`${WEBSITE_ORIGIN}/api/plugin/complete-capture`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: policyData.data.key,
        originalUrl: payload.imageUrl,
        pageUrl: payload.pageUrl || '',
        pageTitle: payload.pageTitle || '',
        sourceHost: payload.sourceHost || '',
        imageType: payload.imageType || 'main',
        capturedAt: payload.capturedAt || Date.now(),
        captureMethod: payload.captureMethod || 'extension-direct',
      }),
    })
    const completeData = await completeResponse.json().catch(() => null)
    if (!completeResponse.ok || !completeData?.success || !completeData?.data?.uploadedUrl) {
      throw new Error(completeData?.error || completeData?.message || '素材入库失败')
    }

    return completeData.data
  } catch (error) {
    console.warn('[造梦AI插件] 直传失败，回退服务器保存:', error)
    onProgress('直传未完成，正在自动切换兼容保存...', 'warning', 3600)
    return saveCaptureViaServer(payload, onProgress)
  }
}

const ensureContextMenu = () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: '保存至造梦AI',
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    })
  })
}

ensureContextMenu()
chrome.runtime.onInstalled.addListener(ensureContextMenu)
chrome.runtime.onStartup.addListener(ensureContextMenu)
chrome.action.onClicked.addListener(openOrFocusWorkspace)

const captureFromPayload = (payload, sourceTabId = null) => {
  if (!payload?.imageUrl) return

  const normalizedPayload = {
    imageUrl: payload.imageUrl,
    pageUrl: payload.pageUrl || '',
    pageTitle: payload.pageTitle || '',
    sourceHost: payload.sourceHost || '',
    capturedAt: Date.now(),
    imageType: payload.imageType || 'main',
    captureMethod: payload.captureMethod || 'context-menu',
  }

  chrome.storage.local.set({ latestCapture: normalizedPayload })
  showTabTip(sourceTabId, '已识别图片，准备保存至造梦AI...', 'info', 2200)
  const reportProgress = (message, status, durationMs) => showTabTip(sourceTabId, message, status, durationMs)

  void saveCaptureDirectly(normalizedPayload, reportProgress)
    .then((data) => {
      const material = data.material || null
      const savedPayload = {
        ...normalizedPayload,
        uploadedUrl: data.uploadedUrl || material?.imageUrl,
        id: data.id || material?.id,
        material,
      }
      chrome.storage.local.set({ latestCapture: savedPayload })
      notifyWebsiteTabs('ZAOMENG_CAPTURE_IMAGE_SAVED', savedPayload)
      showTabTip(sourceTabId, '保存成功：已加入造梦AI素材库', 'success', 3600)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : '保存失败，请打开造梦AI后重试'
      chrome.storage.local.set({ latestCapture: { ...normalizedPayload, error: message, failedAt: Date.now() } })
      notifyWebsiteTabs('ZAOMENG_CAPTURE_IMAGE_FAILED', { ...normalizedPayload, error: message, failedAt: Date.now() })
      showTabTip(sourceTabId, `保存失败：${message}`, 'error', 5200)
    })
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return
  }

  if (isWebsiteUrl(tab?.url || '')) {
    return
  }

  if (info.srcUrl) {
    captureFromPayload({
      imageUrl: info.srcUrl,
      pageUrl: info.pageUrl || tab?.url || '',
      pageTitle: tab?.title || '',
      sourceHost: (() => {
        try {
          return new URL(info.pageUrl || tab?.url || '').hostname
        } catch {
          return ''
        }
      })(),
      captureMethod: 'context-menu-image',
    }, tab?.id)
    return
  }

  if (!tab?.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'ZAOMENG_GET_HOVERED_IMAGE' }, (response) => {
    if (chrome.runtime.lastError || !response?.imageUrl) {
      showTabTip(tab.id, '未识别到图片，请先把鼠标移到目标图片上再右键')
      return
    }

    captureFromPayload({
      ...response,
      captureMethod: 'context-menu-hovered',
    }, tab.id)
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ZAOMENG_CAPTURE_IMAGE') {
    return false
  }

  const tabId = sender?.tab?.id || null
  captureFromPayload(message.payload, tabId)
  sendResponse({ success: true })
  return true
})
