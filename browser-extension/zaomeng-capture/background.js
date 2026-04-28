const WEBSITE_PATTERNS = [
  'http://124.223.26.206/*',
  'http://localhost:5000/*',
  'http://10.0.4.6:5000/*',
]

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ZAOMENG_CAPTURE_IMAGE') {
    return false
  }

  const payload = message.payload
  chrome.storage.local.set({ latestCapture: payload }, () => {
    chrome.tabs.query({ url: WEBSITE_PATTERNS }, (tabs) => {
      tabs.forEach((tab) => {
        if (!tab.id) return
        chrome.tabs.sendMessage(tab.id, { type: 'ZAOMENG_CAPTURE_IMAGE', payload }, () => {
          void chrome.runtime.lastError
        })
      })
    })
  })

  sendResponse({ success: true })
  return true
})
