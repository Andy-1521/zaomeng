/**
 * 全局任务轮询管理器
 *
 * 功能说明：
 * - 管理所有正在进行的生图任务
 * - 独立于 React 组件，切换页面不会中断
 * - 通过自定义事件通知 UI 更新
 */

interface PollingTask {
  loadingMessageId: string;
  orderId: string;
  startTime: number;
  userId: string;
  intervalId: NodeJS.Timeout;
  isStopped: boolean; // 标记任务是否已停止
  failCount: number; // 连续失败次数，用于防止无限轮询
}

class TaskPollingManager {
  private tasks: Map<string, PollingTask> = new Map();
  private pollingInterval: number = 2000; // 每2秒检查一次
  private maxDuration: number = 720 * 1000; // 最多轮询12分钟（确保能覆盖彩绘提取2的完整流程：10分钟API超时 + 2分钟容错）
  private maxFailCount: number = 10; // 最多连续失败10次，防止无限轮询

  /**
   * 添加轮询任务
   */
  addTask(
    loadingMessageId: string,
    orderId: string,
    startTime: number,
    userId: string
  ) {
    console.log('[TaskPollingManager] ========== 添加轮询任务 ==========');
    console.log('[TaskPollingManager] 任务参数:', { loadingMessageId, orderId, startTime, userId });

    // 如果任务已存在，先停止旧的
    if (this.tasks.has(orderId)) {
      console.log('[TaskPollingManager] 订单已存在，停止旧任务:', orderId);
      console.log('[TaskPollingManager] 当前任务列表:', Array.from(this.tasks.keys()));
      this.stopTask(orderId);
    } else {
      console.log('[TaskPollingManager] 订单不存在，添加新任务:', orderId);
    }

    // 创建轮询定时器
    const intervalId = setInterval(async () => {
      await this.checkTaskStatus(loadingMessageId, orderId, startTime, userId);
    }, this.pollingInterval);

    // 保存任务
    this.tasks.set(orderId, {
      loadingMessageId,
      orderId,
      startTime,
      userId,
      intervalId,
      isStopped: false,
      failCount: 0,
    });

    console.log('[TaskPollingManager] 任务已添加，当前任务数:', this.tasks.size);
    console.log('[TaskPollingManager] 当前任务列表:', Array.from(this.tasks.keys()));
  }

  /**
   * 停止轮询任务
   */
  stopTask(orderId: string) {
    const task = this.tasks.get(orderId);
    if (task) {
      // 【关键修复】先设置标志位，防止后续的轮询继续执行
      task.isStopped = true;

      console.log('[TaskPollingManager] 设置停止标志:', orderId);

      // 清除定时器
      clearInterval(task.intervalId);

      // 删除任务
      this.tasks.delete(orderId);

      console.log('[TaskPollingManager] 任务已停止:', orderId);
    } else {
      console.warn('[TaskPollingManager] 任务不存在，无法停止:', orderId);
    }
  }

  /**
   * 停止所有任务
   */
  stopAllTasks() {
    this.tasks.forEach((task, orderId) => {
      clearInterval(task.intervalId);
      console.log('[TaskPollingManager] 停止任务:', orderId);
    });
    this.tasks.clear();
    console.log('[TaskPollingManager] 所有任务已停止');
  }

  /**
   * 【新增】检查任务是否正在轮询中
   */
  isTaskPolling(orderId: string): boolean {
    const task = this.tasks.get(orderId);
    if (!task) {
      return false;
    }
    // 如果任务存在且未停止，说明正在轮询中
    return !task.isStopped;
  }

  /**
   * 【新增】获取调试信息
   */
  getDebugInfo() {
    const tasks = Array.from(this.tasks.values()).map(task => ({
      orderId: task.orderId,
      startTime: task.startTime,
      userId: task.userId,
      isStopped: task.isStopped,
      age: Date.now() - task.startTime,
      ageMinutes: ((Date.now() - task.startTime) / 1000 / 60).toFixed(2),
    }));

    return tasks;
  }

  /**
   * 检查任务状态
   */
  private async checkTaskStatus(
    loadingMessageId: string,
    orderId: string,
    startTime: number,
    userId: string
  ) {
    // 【关键修复】检查任务是否已停止
    const task = this.tasks.get(orderId);
    if (!task || task.isStopped) {
      console.log('[TaskPollingManager] 任务已不存在或已停止，跳过查询:', orderId);
      return;
    }

    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;

    try {
      // 【关键修复】检测异常时间戳
      if (isNaN(elapsedTime) || elapsedTime < 0) {
        console.log('[TaskPollingManager] 检测到异常时间戳:', {
          orderId,
          startTime,
          currentTime,
          elapsedTime,
        });
        console.log('[TaskPollingManager] 使用当前时间作为 startTime，重新计算');
        // 使用当前时间作为 startTime，从现在开始计算超时
        task.startTime = currentTime;
      }

      // 重新计算耗时
      const validElapsedTime = currentTime - task.startTime;

      // 【关键修复】检查是否超时
      if (validElapsedTime > this.maxDuration) {
        console.log('[TaskPollingManager] ========== 任务超时 ==========');
        console.log('[TaskPollingManager] 订单:', orderId, '已超时，停止轮询');
        console.log('[TaskPollingManager] 耗时:', (validElapsedTime / 1000).toFixed(0), '秒，最大允许:', (this.maxDuration / 1000), '秒');
        
        // 【新增】超时后查询一次订单状态，确认是否真的失败了
        console.log('[TaskPollingManager] 超时后查询订单状态...');
        try {
          const checkResponse = await fetch(`/api/task/check?orderId=${orderId}`, {
            credentials: 'include',
          });
          
          if (checkResponse.ok) {
            const checkData = await checkResponse.json();
            console.log('[TaskPollingManager] 超时查询结果:', checkData);
            
            // 如果订单状态仍是"处理中"，标记为失败
            if (checkData.success && checkData.data && checkData.data.status === '处理中') {
              console.log('[TaskPollingManager] 订单仍处于"处理中"状态，标记为失败');
              this.notifyFailure(loadingMessageId, orderId);
              this.stopTask(orderId);
              return;
            }
          }
        } catch (checkError) {
          console.error('[TaskPollingManager] 超时查询失败:', checkError);
        }
        
        // 默认超时通知
        this.notifyTimeout(loadingMessageId, orderId);
        this.stopTask(orderId);
        return;
      }

      console.log('[TaskPollingManager] 查询任务状态:', orderId, '(耗时:', (validElapsedTime / 1000).toFixed(0), '秒)');
      const response = await fetch(`/api/task/check?orderId=${orderId}`, {
        credentials: 'include',
      });

      console.log('[TaskPollingManager] 查询响应状态:', response.status);

      if (!response.ok) {
        console.warn('[TaskPollingManager] 查询请求失败，状态码:', response.status, '继续轮询...');
        // 【关键修复】增加失败计数，防止无限轮询
        task.failCount = (task.failCount || 0) + 1;
        console.log('[TaskPollingManager] 失败次数:', task.failCount, '/', this.maxFailCount);
        
        if (task.failCount >= this.maxFailCount) {
          console.log('[TaskPollingManager] 查询失败次数过多，停止轮询:', orderId);
          this.notifyFailure(loadingMessageId, orderId);
          this.stopTask(orderId);
        }
        return;
      }

      // 检查响应内容是否是JSON格式
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        // 如果不是JSON，先读取文本内容用于调试
        const text = await response.text();
        console.error('[TaskPollingManager] 响应不是JSON格式，内容:', text.substring(0, 500));
        
        // 【关键修复】增加失败计数，防止无限轮询
        task.failCount = (task.failCount || 0) + 1;
        console.log('[TaskPollingManager] 失败次数:', task.failCount, '/', this.maxFailCount);
        
        if (task.failCount >= this.maxFailCount) {
          console.log('[TaskPollingManager] 响应格式错误次数过多，停止轮询:', orderId);
          this.notifyFailure(loadingMessageId, orderId);
          this.stopTask(orderId);
        }
        return;
      }

      const data = await response.json();

      console.log('[TaskPollingManager] 查询响应数据:', JSON.stringify(data, null, 2));

      // 检查是否成功生成图片
      if (data.success && data.data) {
        const status = data.data.status;
        const resultData = data.data.resultData;

        console.log('[TaskPollingManager] ========== 订单状态 ==========:', orderId, status);

        if (status === '成功') {
          // 任务完成
          console.log('[TaskPollingManager] ========== 任务完成 ==========');
          console.log('[TaskPollingManager] 订单:', orderId, '已完成，停止轮询');
          console.log('[TaskPollingManager] 总耗时:', (elapsedTime / 1000).toFixed(0), '秒');
          this.notifySuccess(loadingMessageId, orderId, resultData, data.data.remainingPoints);
          this.stopTask(orderId);
          return;
        } else if (status === '失败') {
          // 任务失败
          console.log('[TaskPollingManager] ========== 任务失败 ==========');
          console.log('[TaskPollingManager] 订单:', orderId, '已失败，停止轮询');
          console.log('[TaskPollingManager] 总耗时:', (elapsedTime / 1000).toFixed(0), '秒');
          this.notifyFailure(loadingMessageId, orderId);
          this.stopTask(orderId);
          return;
        } else if (status === '处理中') {
          // 任务正在处理中，继续轮询
          console.log('[TaskPollingManager] 订单:', orderId, '处理中，继续轮询...');
          return;
        } else {
          // 未知状态，记录警告并继续轮询
          console.warn('[TaskPollingManager] 订单:', orderId, '未知状态:', status, '继续轮询...');
          return;
        }
      }

      // 订单不存在或查询失败，继续轮询（可能是后端还没创建订单）
      console.log('[TaskPollingManager] 订单不存在或查询失败，继续轮询...', orderId);
      
      // 【关键修复】增加失败计数，防止无限轮询
      task.failCount = (task.failCount || 0) + 1;
      console.log('[TaskPollingManager] 失败次数:', task.failCount, '/', this.maxFailCount);
      
      if (task.failCount >= this.maxFailCount) {
        console.log('[TaskPollingManager] 订单不存在次数过多，停止轮询:', orderId);
        this.notifyFailure(loadingMessageId, orderId);
        this.stopTask(orderId);
      }
    } catch (error) {
      console.error('[TaskPollingManager] 检查任务状态失败:', error, '继续轮询...');
      console.error('[TaskPollingManager] 错误详情:', error instanceof Error ? error.message : String(error));
      
      // 【关键修复】增加失败计数，防止无限轮询
      task.failCount = (task.failCount || 0) + 1;
      console.log('[TaskPollingManager] 失败次数:', task.failCount, '/', this.maxFailCount);
      
      if (task.failCount >= this.maxFailCount) {
        console.log('[TaskPollingManager] 检查任务状态失败次数过多，停止轮询:', orderId);
        this.notifyFailure(loadingMessageId, orderId);
        this.stopTask(orderId);
      }
    }
  }

  /**
   * 通知任务成功
   */
  private notifySuccess(
    loadingMessageId: string,
    orderId: string,
    resultData: string,
    remainingPoints?: number
  ) {
    console.log('[TaskPollingManager] ========== 准备触发 taskCompleted 事件 ==========');
    console.log('[TaskPollingManager] 事件参数:', {
      loadingMessageId,
      orderId,
      resultData,
      remainingPoints,
    });

    const event = new CustomEvent('taskCompleted', {
      detail: {
        loadingMessageId,
        orderId,
        resultData,
        remainingPoints,
      },
    });
    window.dispatchEvent(event);
    console.log('[TaskPollingManager] 已触发 taskCompleted 事件');

    // 【关键修复】同时触发 taskHistoryUpdated 事件，刷新历史记录
    console.log('[TaskPollingManager] 准备触发 taskHistoryUpdated 事件');
    window.dispatchEvent(new Event('taskHistoryUpdated'));
    console.log('[TaskPollingManager] 已触发 taskHistoryUpdated 事件');
  }

  /**
   * 通知任务失败
   */
  private async notifyFailure(loadingMessageId: string, orderId: string) {
    console.log('[TaskPollingManager] ========== 准备触发 taskFailed 事件 ==========');
    console.log('[TaskPollingManager] 事件参数:', { loadingMessageId, orderId });

    // 【关键修复】在触发失败事件之前，先查询一次任务状态，确认任务真的失败了
    // 避免因为临时订单号查询失败而误报失败，然后又因为实际订单号查询成功而变成成功
    try {
      console.log('[TaskPollingManager] 失败前最终查询任务状态:', orderId);
      const checkResponse = await fetch(`/api/task/check?orderId=${orderId}`, {
        credentials: 'include',
      });

      if (checkResponse.ok) {
        const checkData = await checkResponse.json();
        console.log('[TaskPollingManager] 失败前最终查询结果:', checkData);

        // 如果订单状态是成功，不触发失败事件
        if (checkData.success && checkData.data && checkData.data.status === '成功') {
          console.log('[TaskPollingManager] 订单实际已成功，不触发失败事件:', orderId);
          return;
        }
      }
    } catch (checkError) {
      console.error('[TaskPollingManager] 失败前最终查询异常:', checkError);
      // 查询失败时，仍然触发失败事件
    }

    const event = new CustomEvent('taskFailed', {
      detail: {
        loadingMessageId,
        orderId,
      },
    });
    window.dispatchEvent(event);
    console.log('[TaskPollingManager] 已触发 taskFailed 事件');

    // 【关键修复】同时触发 taskHistoryUpdated 事件，刷新历史记录
    console.log('[TaskPollingManager] 准备触发 taskHistoryUpdated 事件');
    window.dispatchEvent(new Event('taskHistoryUpdated'));
    console.log('[TaskPollingManager] 已触发 taskHistoryUpdated 事件');
  }

  /**
   * 通知任务超时
   */
  private async notifyTimeout(loadingMessageId: string, orderId: string) {
    console.log('[TaskPollingManager] ========== 准备触发 taskTimeout 事件 ==========');
    console.log('[TaskPollingManager] 事件参数:', { loadingMessageId, orderId });

    // 【关键修复】在触发超时事件之前，先查询一次任务状态，确认任务真的超时了
    try {
      console.log('[TaskPollingManager] 超时前最终查询任务状态:', orderId);
      const checkResponse = await fetch(`/api/task/check?orderId=${orderId}`, {
        credentials: 'include',
      });

      if (checkResponse.ok) {
        const checkData = await checkResponse.json();
        console.log('[TaskPollingManager] 超时前最终查询结果:', checkData);

        // 如果订单状态是成功，不触发超时事件
        if (checkData.success && checkData.data && checkData.data.status === '成功') {
          console.log('[TaskPollingManager] 订单实际已成功，不触发超时事件:', orderId);
          return;
        }
      }
    } catch (checkError) {
      console.error('[TaskPollingManager] 超时前最终查询异常:', checkError);
      // 查询失败时，仍然触发超时事件
    }

    const event = new CustomEvent('taskTimeout', {
      detail: {
        loadingMessageId,
        orderId,
      },
    });
    window.dispatchEvent(event);
    console.log('[TaskPollingManager] 触发 taskTimeout 事件');

    // 【关键修复】同时触发 taskHistoryUpdated 事件，刷新历史记录
    console.log('[TaskPollingManager] 准备触发 taskHistoryUpdated 事件');
    window.dispatchEvent(new Event('taskHistoryUpdated'));
    console.log('[TaskPollingManager] 已触发 taskHistoryUpdated 事件');
  }

  /**
   * 获取任务数量
   */
  getTaskCount(): number {
    return this.tasks.size;
  }

  /**
   * 检查任务是否存在
   */
  hasTask(orderId: string): boolean {
    return this.tasks.has(orderId);
  }

  /**
   * 【新增】检查任务是否正在运行
   */
  isTaskRunning(orderId: string): boolean {
    const task = this.tasks.get(orderId);
    return task !== undefined && !task.isStopped;
  }
}

// 导出单例
export const taskPollingManager = new TaskPollingManager();
