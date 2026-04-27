/**
 * Service Worker for Background Image Generation
 * 用于在页面切换时保持生图请求继续执行
 */

const CACHE_NAME = 'generation-v3';
const GENERATION_API = '/api/generate-image';

// 添加全局错误处理
self.addEventListener('error', (event) => {
  console.error('[SW] 全局错误:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] 未处理的 Promise 拒绝:', event.reason);
});

// 监听 fetch 请求
self.addEventListener('fetch', (event) => {
  // 暂时禁用拦截，让请求直接到达后端
  // 只处理生图 API 请求
  if (false && event.request.url.includes(GENERATION_API)) {
    console.log('[SW] 拦截生图请求:', event.request.url);
    console.log('[SW] 请求方法:', event.request.method);

    event.respondWith(
      (async () => {
        try {
          // 克隆请求以确保可以多次使用
          const request = event.request.clone();

          // 发起原始请求（使用 keepalive 确保请求在页面关闭后继续）
          const response = await fetch(request, {
            keepalive: true,
          });

          console.log('[SW] 生图请求完成，状态:', response.status);

          // 克隆响应以便多次读取
          const clonedResponse = response.clone();

          // 如果请求成功，保存结果到 IndexedDB
          if (response.ok) {
            try {
              const data = await clonedResponse.json();
              console.log('[SW] 生图成功，保存结果:', data);

              if (data.success && data.data?.imageUrl) {
                await saveGenerationResult({
                  imageUrl: data.data.imageUrl,
                  orderId: data.data.orderId,
                  remainingPoints: data.data.remainingPoints,
                  timestamp: Date.now(),
                });
              }
            } catch (error) {
              console.error('[SW] 保存结果失败:', error);
            }
          }

          return response;
        } catch (error) {
          console.error('[SW] 生图请求失败:', error);

          // 返回错误响应，而不是抛出异常
          return new Response(
            JSON.stringify({
              success: false,
              message: error?.message || '生图请求失败',
              debug: {
                error: String(error),
                timestamp: Date.now(),
              }
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      })()
    );
  }
});

/**
 * 打开 IndexedDB 数据库
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('GenerationDB', 1);

    request.onerror = () => {
      console.error('[SW] 打开数据库失败');
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('[SW] 数据库打开成功');
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 创建对象存储
      if (!db.objectStoreNames.contains('results')) {
        const store = db.createObjectStore('results', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('[SW] 创建对象存储: results');
      }
    };
  });
}

/**
 * 保存生图结果到 IndexedDB
 */
async function saveGenerationResult(result) {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['results'], 'readwrite');
      const store = transaction.objectStore('results');

      const request = store.add({
        id: 'gen-' + Date.now(),
        ...result,
      });

      request.onsuccess = () => {
        console.log('[SW] 结果已保存到 IndexedDB');
        resolve();
      };

      request.onerror = () => {
        console.error('[SW] 保存结果失败:', request.error);
        reject(request.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('[SW] 保存结果异常:', error);
    throw error;
  }
}

/**
 * 清理过期的结果（超过 10 分钟）
 */
async function cleanupOldResults() {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['results'], 'readwrite');
      const store = transaction.objectStore('results');
      const index = store.index('timestamp');
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

      const request = index.openCursor(IDBKeyRange.upperBound(tenMinutesAgo));

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor) {
          console.log('[SW] 清理过期结果:', cursor.value.id);
          cursor.delete();
          cursor.continue();
        } else {
          console.log('[SW] 清理完成');
        }
      };

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
    });
  } catch (error) {
    console.error('[SW] 清理过期结果失败:', error);
  }
}

// Service Worker 安装
self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker 安装中...');
  self.skipWaiting();
});

// Service Worker 激活
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker 激活中...');

  event.waitUntil(
    self.clients.claim().then(() => {
      console.log('[SW] Service Worker 已激活并控制所有客户端');

      // 使用更可靠的方式执行清理任务
      try {
        cleanupOldResults();
        // 定期清理（使用 setTimeout 链而不是 setInterval）
        const scheduleCleanup = () => {
          setTimeout(() => {
            try {
              cleanupOldResults();
            } catch (error) {
              console.error('[SW] 清理任务失败:', error);
            }
            scheduleCleanup();
          }, 60 * 1000);
        };
        scheduleCleanup();
      } catch (error) {
        console.error('[SW] 初始化清理任务失败:', error);
      }
    })
  );
});

// 监听消息
self.addEventListener('message', (event) => {
  console.log('[SW] 收到消息:', event.data);

  if (event.data.type === 'GET_RESULTS') {
    event.ports[0].postMessage({ type: 'RESULTS_FETCHED' });
  }
});
