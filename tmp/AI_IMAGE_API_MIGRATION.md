# AI生图API迁移总结

## 📋 概述

将AI生图的主接口从Apimart API替换为Nano Banana绘画接口（Dakka API），实现三级降级策略：
- **主接口**：Dakka API（nano-banana-fast）
- **备用接口1**：Apimart API（gemini-3-pro-image-preview）
- **备用接口2**：302ai API（nano-banana-pro）

---

## 🔄 新工作流程

```
1. 调用Dakka API（主接口）
   ↓
2. 轮询Dakka API获取结果（最多200秒，40次轮询）
   ↓
3. 失败或超时 → 降级到Apimart API（备用接口1）
   ↓
4. 轮询Apimart API获取结果（最多200秒，40次轮询）
   ↓
5. 失败或超时 → 降级到302ai API（备用接口2）
   ↓
6. 轮询302ai API获取结果（最多200秒，40次轮询）
   ↓
7. 失败 → 返回失败状态
   成功 → 更新前端状态（订单状态=成功）
```

---

## 📊 API接口配置

### 1. Dakka API（主接口）

**配置信息：**
- Base URL: `https://grsai.dakka.com.cn/v1/draw`
- Token: `sk-f5aad61d12524eaead6f130b0839f31b`
- 模型: `nano-banana-fast`

**提交任务端点：**
- URL: `https://grsai.dakka.com.cn/v1/draw/nano-banana`
- Method: `POST`

**请求参数：**
```json
{
  "model": "nano-banana-fast",
  "prompt": "提示词",
  "aspectRatio": "auto",
  "imageSize": "1K",
  "urls": ["https://example.com/example.png"],
  "webHook": "",
  "shutProgress": false
}
```

**响应示例（提交任务）：**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "id": "id"
  }
}
```

**获取结果端点：**
- URL: `https://grsai.dakka.com.cn/v1/draw/result`
- Method: `POST`

**请求参数：**
```json
{
  "id": "xxxxx"
}
```

**响应示例（获取结果）：**
```json
{
  "code": 0,
  "data": {
    "id": "xxxxx",
    "results": [
      {
        "url": "https://example.com/example.png",
        "content": "这是一只可爱的猫咪在草地上玩耍"
      }
    ],
    "progress": 100,
    "status": "succeeded",
    "failure_reason": "",
    "error": ""
  },
  "msg": "success"
}
```

---

### 2. Apimart API（备用接口1）

**配置信息：**
- Base URL: `https://api.apimart.ai/v1`
- Token: `sk-AtjsDpqAwNKCGHUWJZ8qVfSaeJ94NtP43NtHZ1a7nEETJIpV`
- 模型: `gemini-3-pro-image-preview`

**端点：**
- 提交任务: `https://api.apimart.ai/v1/images/generations`
- 查询任务: `https://api.apimart.ai/v1/tasks/{taskId}`

---

### 3. 302ai API（备用接口2）

**配置信息：**
- Base URL: `https://api.302ai.cn/ws/api/v3`
- Token: `sk-ONDp2fHioAAfmdR9cQunWcVH39NPR6UxCarh8UclYyA8ftze`
- 模型: `nano-banana-pro`

**端点：**
- 提交任务: `https://api.302ai.cn/ws/api/v3/google/nano-banana-pro/edit`
- 查询任务: `https://api.302ai.cn/ws/api/v3/predictions/{id}/result`

---

## 🔧 代码修改

### 1. 更新API配置

```typescript
// Dakka API 配置（主接口 - Nano Banana绘画）
const DAKKA_API_BASE_URL = 'https://grsai.dakka.com.cn/v1/draw';
const DAKKA_API_TOKEN = 'sk-f5aad61d12524eaead6f130b0839f31b';
const DAKKA_API_MODEL = 'nano-banana-fast';

// Apimart API 配置（备用接口）
const APIMART_API_BASE_URL = 'https://api.apimart.ai/v1';
const APIMART_API_TOKEN = 'sk-AtjsDpqAwNKCGHUWJZ8qVfSaeJ94NtP43NtHZ1a7nEETJIpV';

// 302ai API 配置（备用接口2）
const THIRTYTWOAI_API_BASE_URL = 'https://api.302ai.cn/ws/api/v3';
const THIRTYTWOAI_API_TOKEN = 'sk-ONDp2fHioAAfmdR9cQunWcVH39NPR6UxCarh8UclYyA8ftze';
```

### 2. 实现Dakka API函数

**提交任务函数：**
```typescript
async function submitDakkaTask(prompt: string, aspectRatio: string, imageSize: string, urls: string[]): Promise<{ taskId: string }>
```

**查询任务状态函数：**
```typescript
async function pollDakkaTaskStatus(taskId: string): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string }>
```

**轮询直到完成函数：**
```typescript
async function pollDakkaTaskUntilComplete(taskId: string, workflowStartTime: number): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string }>
```

### 3. 更新主工作流函数

**新的降级策略：**
```typescript
async function generateImageWithFallback(...): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string }> {
  // 1. 尝试Dakka API（主接口）
  // 2. 失败 → 降级到Apimart API（备用接口1）
  // 3. 失败 → 降级到302ai API（备用接口2）
}
```

**Apimart降级函数：**
```typescript
async function tryApimartFallback(...): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string }> {
  // Apimart API失败后，再次降级到302ai API
}
```

**302ai降级函数：**
```typescript
async function tryThirtyTwoAiFallback(...): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string }> {
  // 最后的备用接口，无进一步降级
}
```

---

## 🔍 降级触发条件

### Dakka API降级到Apimart API

以下情况会触发降级：
1. ✅ 提交任务失败（HTTP非2xx状态）
2. ✅ 轮询超时（超过200秒）
3. ✅ 任务状态为失败
4. ✅ 提交任务异常（网络错误等）

### Apimart API降级到302ai API

以下情况会触发降级：
1. ✅ 提交任务失败（HTTP非2xx状态）
2. ✅ 轮询超时（超过200秒）
3. ✅ 任务状态为失败
4. ✅ 提交任务异常（网络错误等）

---

## 📝 日志输出

### Dakka API日志

```
[AI生图] ========== 步骤1: 调用Dakka API（主接口） ==========
[AI生图 - Dakka API] 提交任务
[AI生图 - Dakka API] 模型: nano-banana-fast
[AI生图 - Dakka API] 请求参数: {...}
[AI生图 - Dakka API] 响应状态: 200 OK
[AI生图 - Dakka API] 提交任务成功: {...}
[AI生图 - Dakka API] 提取的任务ID: xxx

[AI生图] ========== 步骤2: 轮询Dakka API任务状态 ==========
[AI生图 - Dakka API] 查询任务状态: xxx
[AI生图 - Dakka API] 任务状态: succeeded (normalized: succeeded), 进度: 100%
[AI生图 - Dakka API] 状态判定: 任务成功，resultUrl: https://...

[AI生图] ========== Dakka API生图成功 ==========
[AI生图] ✅ Dakka API成功，不降级
```

### Dakka API失败日志

```
[AI生图 - Dakka API] ========== 提交任务失败 ==========
[AI生图 - Dakka API] HTTP状态码: 401
[AI生图 - Dakka API] 错误响应内容: {...}
[AI生图 - Dakka API] ⚠️ 将降级到Apimart API

[AI生图] ========== 步骤3: 降级到Apimart API（备用接口1） ==========
```

---

## ✅ 测试建议

### 测试1：Dakka API正常生图

**步骤：**
1. 在AI生图页面输入提示词
2. 点击生成
3. 查看日志，确认调用Dakka API
4. 验证生成成功

**预期结果：**
- 优先调用Dakka API
- 生成成功，不降级
- 日志显示"Dakka API成功"

---

### 测试2：Dakka API失败降级

**步骤：**
1. 临时修改Dakka API token为错误值
2. 尝试AI生图
3. 查看日志，确认降级到Apimart API
4. 验证Apimart API成功

**预期结果：**
- Dakka API提交失败
- 自动降级到Apimart API
- 日志显示"将降级到Apimart API"

---

### 测试3：三级降级测试

**步骤：**
1. 临时修改Dakka API和Apimart API token为错误值
2. 尝试AI生图
3. 查看日志，确认三级降级
4. 验证302ai API成功

**预期结果：**
- Dakka API失败 → 降级到Apimart API
- Apimart API失败 → 降级到302ai API
- 日志显示完整的降级链路

---

## 📌 注意事项

### 1. Token管理

- Dakka API Token: `sk-f5aad61d12524eaead6f130b0839f31b`
- Apimart API Token: `sk-AtjsDpqAwNKCGHUWJZ8qVfSaeJ94NtP43NtHZ1a7nEETJIpV`
- 302ai API Token: `sk-ONDp2fHioAAfmdR9cQunWcVH39NPR6UxCarh8UclYyA8ftze`

建议将Token存储在环境变量中，避免硬编码。

### 2. 超时配置

- 单次请求超时: 60秒
- 轮询间隔: 5秒
- 最大轮询时间: 200秒（40次轮询）
- 后端总超时: 20分钟

### 3. 状态映射

Dakka API状态需要映射：
- `succeeded` → 成功
- `failed` → 失败
- `processing` → 处理中

### 4. 参数差异

各API的参数格式略有不同：
- Dakka API: `aspectRatio`, `imageSize`, `urls`
- Apimart API: `size`, `resolution`, `image_urls`
- 302ai API: `aspect_ratio`, `resolution`, `images`

---

## 🎯 总结

### 优点

1. **高可用性**: 三级降级策略，确保服务稳定
2. **快速响应**: Dakka API作为主接口，响应速度快
3. **容错能力强**: 任何一个API失败都有备用方案
4. **详细日志**: 便于排查问题和监控

### 后续优化

1. **健康检查**: 定期检查各API的健康状态
2. **动态切换**: 根据成功率动态调整主接口
3. **监控告警**: 监控各API的成功率和响应时间
4. **成本优化**: 根据成本选择最优API

---

## 📄 修改记录

- **2024-01-XX**: 将AI生图主接口从Apimart API迁移到Dakka API（nano-banana-fast）
- **2024-01-XX**: 实现三级降级策略（Dakka → Apimart → 302ai）
- **2024-01-XX**: 添加详细的错误日志和降级提示
