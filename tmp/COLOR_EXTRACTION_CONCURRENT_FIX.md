# 彩绘提取2并发问题修复说明

## 问题描述

### 问题1：彩绘提取2同时丢三张图，结果两个调用Apimart API，一个调用302ai API

**原因分析：**

前端代码在处理多张图片上传时，使用 `forEach` 并发发起多个API请求：

```javascript
// 原代码（并发处理）
validFiles.forEach(file => {
  generateFromFile(file);
});
```

这导致三张图片会**同时**发起三个请求到 `/api/color-extraction2/workflow`。由于Apimart API可能有**并发限制**（速率限制、连接数限制等），或者某些请求提交时因网络问题失败，失败的请求就会自动降级到302ai API。

**影响：**
- 用户同时上传多张图片时，部分请求会降级到302ai API（备用接口）
- 302ai API是文生图模式，输出可能与输入图片不一致
- 用户体验不一致，部分使用高质量Apimart API，部分使用备用302ai API

---

### 问题2：AI生图直接调用302ai API（跳过Apimart API）

**原因分析：**

根据代码逻辑，AI生图会先尝试Apimart API，只有失败时才降级到302ai API。如果您观察到直接调用302ai API，说明Apimart API提交任务时就失败了。

**可能的原因：**
1. Apimart API token失效或过期
2. Apimart API服务暂时不可用或网络问题
3. Apimart API达到速率限制（并发请求过多）
4. Apimart API参数格式不匹配

---

## 修复方案

### 修复1：彩绘提取2改为串行处理

**修改文件：** `src/components/ColorExtraction2Page.tsx`

**修改内容：** 将并发处理改为串行处理，每个订单之间间隔500ms，避免同时发起多个请求导致Apimart API触发降级。

```javascript
// 新代码（串行处理）
for (const file of validFiles) {
  await generateFromFile(file);
  // 每个订单之间间隔500ms，进一步避免并发问题
  await new Promise(resolve => setTimeout(resolve, 500));
}
```

**效果：**
- 所有图片都会依次通过Apimart API处理
- 不会因为并发请求导致部分请求降级到302ai API
- 确保所有用户都使用高质量的主接口（Apimart API）
- 缺点：处理时间会增加（每个订单间隔500ms）

---

### 修复2：增强Apimart API错误日志

**修改文件：**
- `src/app/api/color-extraction2/workflow/route.ts`
- `src/app/api/generate-image/route.ts`

**修改内容：** 为Apimart API提交任务失败添加详细的错误日志，包括：
- HTTP状态码
- 错误响应内容（原始文本）
- 解析后的错误数据（如果响应是JSON格式）
- 明确标注"将触发降级到302ai API"

```javascript
console.error(`[Apimart API] ========== 提交任务失败 ==========`);
console.error(`[Apimart API] HTTP状态码: ${response.status}`);
console.error(`[Apimart API] 错误响应内容:`, errorText);
console.error(`[Apimart API] ⚠️ 将触发降级到302ai API`);
try {
  const errorData = JSON.parse(errorText);
  console.error(`[Apimart API] 解析后的错误数据:`, JSON.stringify(errorData, null, 2));
} catch (e) {
  // 无法解析为JSON
}
```

**效果：**
- 可以快速定位Apimart API失败的原因
- 了解是网络问题、速率限制、参数错误还是服务不可用
- 帮助优化Apimart API的使用策略

---

## 测试建议

### 测试1：彩绘提取2多图上传

**步骤：**
1. 选择3张图片同时上传到彩绘提取2
2. 观察历史记录中所有订单是否都显示"Apimart API"（通过日志确认）
3. 确认所有订单都成功生成且质量一致

**预期结果：**
- 所有订单都使用Apimart API（主接口）
- 不会降级到302ai API
- 处理时间增加（串行处理），但质量一致

---

### 测试2：AI生图单次生成

**步骤：**
1. 在AI生图页面输入提示词
2. 点击生成
3. 查看日志，确认是否调用Apimart API

**预期结果：**
- 优先调用Apimart API
- 如果失败，日志会显示详细的错误信息
- 可以根据错误信息定位问题

---

### 测试3：Apimart API失败场景

**步骤：**
1. 临时修改Apimart API token为错误值
2. 尝试彩绘提取2或AI生图
3. 查看日志，确认降级逻辑正常工作

**预期结果：**
- Apimart API提交失败，日志显示详细错误信息
- 自动降级到302ai API
- 用户看到友好的错误提示

---

## 后续优化建议

### 1. 监控Apimart API成功率

建议添加指标监控：
- Apimart API提交成功率
- Apimart API降级率
- Apimart API平均响应时间
- Apimart API错误类型分布

### 2. 动态调整串行间隔

根据Apimart API的速率限制，动态调整串行间隔：
- 如果Apimart API频繁失败，增加间隔时间
- 如果Apimart API稳定，减少间隔时间提升性能

### 3. 实现请求队列

更优雅的解决方案是实现一个请求队列：
- 使用队列管理所有待处理的图片
- 队列按照固定速率消费请求（如每秒1个）
- 避免并发同时发起多个请求
- 支持优先级和重试机制

### 4. Apimart API健康检查

定期检查Apimart API的健康状态：
- 每5分钟发送一次健康检查请求
- 如果连续失败，标记为不可用，直接降级到302ai API
- 避免用户等待Apimart API失败后再降级

---

## API接口说明

### Apimart API（主接口）

**特点：**
- 真正的图生图（支持image_urls参数）
- 质量高，输出与输入一致
- 支持彩绘提取和AI生图

**端点：**
- 提交任务：`https://api.apimart.ai/v1/images/generations`
- 查询任务：`https://api.apimart.ai/v1/tasks/{taskId}`

**模型：**
- `gemini-3-pro-image-preview`（彩绘提取、AI生图）

**参数：**
```json
{
  "model": "gemini-3-pro-image-preview",
  "prompt": "提示词",
  "size": "9:16",
  "n": 1,
  "resolution": "2K",
  "image_urls": ["图片URL"]
}
```

---

### 302ai API（备用接口）

**特点：**
- 文生图模式（支持图生图，但输出可能不一致）
- 作为Apimart API失败时的备用方案
- 支持彩绘提取和分层

**端点：**
- 提交任务：`https://api.302ai.cn/ws/api/v3/google/nano-banana-pro/edit`
- 查询任务：`https://api.302ai.cn/ws/api/v3/predictions/{id}/result`

**模型：**
- `nano-banana-pro`（彩绘提取、AI生图）

**参数：**
```json
{
  "aspect_ratio": "9:16",
  "enable_base64_output": false,
  "enable_sync_mode": false,
  "images": ["图片URL"],
  "prompt": "提示词",
  "resolution": "2K"
}
```

---

## 总结

1. **并发问题是主要原因**：前端同时发起多个请求导致Apimart API触发降级
2. **串行处理是有效解决方案**：避免并发请求，确保所有用户使用主接口
3. **增强日志帮助定位问题**：详细了解Apimart API失败的原因
4. **后续可进一步优化**：实现请求队列、健康检查、动态调整间隔等

---

## 修改记录

- **2024-01-XX**: 修复彩绘提取2并发问题，改为串行处理
- **2024-01-XX**: 增强Apimart API错误日志，帮助定位问题
