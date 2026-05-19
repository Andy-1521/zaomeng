const WEBSITE_ORIGIN = 'http://localhost:5000'
const WEBSITE_PATTERNS = [
  'http://localhost:5000/*',
]
const WORKSPACE_PATH = '/home'

const CONTEXT_MENU_ID = 'ZAOMENG_SAVE_IMAGE'

const isWebsiteUrl = (url = '') => {
  return url.startsWith('http://localhost:5000/')
}

const showTabTip = (tabId, message) => {
  if (!tabId) return
  chrome.tabs.sendMessage(tabId, { type: 'ZAOMENG_SHOW_TIP', message }, () => {
    void chrome.runtime.lastError
  })
}

const notifyWebsiteTabs = (payload) => {
  chrome.tabs.query({ url: WEBSITE_PATTERNS }, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.id) return
      chrome.tabs.sendMessage(tab.id, { type: 'ZAOMENG_CAPTURE_IMAGE_SAVED', payload }, () => {
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

const saveCaptureDirectly = async (payload) => {
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
  showTabTip(sourceTabId, '正在保存至造梦AI...')

  void saveCaptureDirectly(normalizedPayload)
    .then((data) => {
      notifyWebsiteTabs({ ...normalizedPayload, uploadedUrl: data.uploadedUrl, id: data.id })
      showTabTip(sourceTabId, '已保存至造梦AI素材库')
    })
    .catch((error) => {
      showTabTip(sourceTabId, error instanceof Error ? error.message : '保存失败，请打开造梦AI后重试')
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
