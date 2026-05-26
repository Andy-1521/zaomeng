(() => {
  const origin = window.location.origin
  let lastReadyAt = 0
  const extensionVersion = (chrome.runtime.getManifest?.() || {}).version || '0.0.0'

  const postToPage = (type, payload = null) => {
    window.postMessage({ source: 'zaomeng-extension', type, payload }, origin)
  }

  const postReady = () => {
    postToPage('ZAOMENG_EXTENSION_READY', { version: extensionVersion })
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'ZAOMENG_CAPTURE_IMAGE') {
      postToPage('ZAOMENG_CAPTURE_IMAGE', message.payload)
      return
    }

    if (message?.type === 'ZAOMENG_CAPTURE_IMAGE_SAVED') {
      postToPage('ZAOMENG_CAPTURE_IMAGE_SAVED', message.payload)
    }
  })

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== origin) {
      return
    }

    const data = event.data
    if (data?.source !== 'zaomeng-web') {
      return
    }

    if (data.type === 'ZAOMENG_EXTENSION_PING') {
      lastReadyAt = Date.now()
      postReady()
      return
    }

    if (data.type === 'ZAOMENG_REQUEST_LATEST_CAPTURE') {
      chrome.storage.local.get('latestCapture', ({ latestCapture }) => {
        postToPage('ZAOMENG_LATEST_CAPTURE', latestCapture || null)
      })
    }
  })

  window.setInterval(() => {
    if (Date.now() - lastReadyAt > 10000) {
      postReady()
      lastReadyAt = Date.now()
    }
  }, 5000)

  postReady()
  lastReadyAt = Date.now()
})()
