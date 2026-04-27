/**
 * 全局任务事件处理器
 *
 * 功能说明：
 * - 独立于 React 组件，切换页面不会中断
 * - 监听任务完成、失败、超时事件
 * - 自动更新历史记录缓存状态
 * - 清理 localStorage 中的任务数据
 */

import { updateTaskStatus } from '@/components/TaskHistory';

class TaskEventHandler {
  private isInitialized = false;

  /**
   * 初始化事件处理器
   * 只在首次调用时注册事件监听器
   */
  initialize() {
    if (this.isInitialized) {
      console.log('[TaskEventHandler] 已经初始化，跳过重复注册');
      return;
    }

    console.log('[TaskEventHandler] 初始化全局事件处理器');

    // 监听任务完成事件
    window.addEventListener('taskCompleted', this.handleTaskCompleted);

    // 监听任务失败事件
    window.addEventListener('taskFailed', this.handleTaskFailed);

    // 监听任务超时事件
    window.addEventListener('taskTimeout', this.handleTaskTimeout);

    this.isInitialized = true;
    console.log('[TaskEventHandler] 事件监听器已注册');
  }

  /**
   * 处理任务完成事件
   */
  private handleTaskCompleted = async (event: Event) => {
    const customEvent = event as CustomEvent;
    const { loadingMessageId, orderId, resultData, remainingPoints } = customEvent.detail;

    console.log('[TaskEventHandler] 收到任务完成事件:', { loadingMessageId, orderId, resultData, remainingPoints });

    // 计算运行时长
    const taskKey = `gen-${loadingMessageId}`;
    const taskData = localStorage.getItem(taskKey);
    let duration = 0;

    if (taskData) {
      try {
        const task = JSON.parse(taskData);
        const endTime = Date.now();
        duration = (endTime - task.startTime) / 1000;
        console.log('[TaskEventHandler] 计算运行时长:', duration, '秒');
      } catch (error) {
        console.error('[TaskEventHandler] 解析任务数据失败:', error);
      }
    }

    // 更新历史记录状态为"成功"
    try {
      console.log('[TaskEventHandler] 更新历史记录状态，订单状态：成功');
      await updateTaskStatus(orderId, '成功', resultData, duration);
    } catch (error) {
      console.error('[TaskEventHandler] 更新任务记录状态失败:', error);
    }

    // 清理 localStorage 中的任务数据
    localStorage.removeItem(taskKey);
    console.log('[TaskEventHandler] 已清理任务数据:', taskKey);

    // 更新用户积分（通知 UserContext 更新）
    if (remainingPoints !== undefined) {
      try {
        // 更新 localStorage 中的用户积分
        const userStr = localStorage.getItem('user');
        if (userStr) {
          const user = JSON.parse(userStr);
          user.points = remainingPoints;
          localStorage.setItem('user', JSON.stringify(user));
          console.log('[TaskEventHandler] 用户积分已更新:', remainingPoints);
        }
        // 通知 UserContext 同步更新
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('userPointsChanged', { detail: { points: remainingPoints } }));
        }
      } catch (error) {
        console.error('[TaskEventHandler] 更新用户积分失败:', error);
      }
    }
  };

  /**
   * 处理任务失败事件
   */
  private handleTaskFailed = async (event: Event) => {
    const customEvent = event as CustomEvent;
    const { loadingMessageId, orderId } = customEvent.detail;

    console.log('[TaskEventHandler] 收到任务失败事件:', { loadingMessageId, orderId });

    // 更新历史记录状态为"失败"
    try {
      console.log('[TaskEventHandler] 更新历史记录状态，订单状态：失败');
      await updateTaskStatus(orderId, '失败');
    } catch (error) {
      console.error('[TaskEventHandler] 更新任务记录状态失败:', error);
    }

    // 清理 localStorage 中的任务数据
    const taskKey = `gen-${loadingMessageId}`;
    localStorage.removeItem(taskKey);
    console.log('[TaskEventHandler] 已清理任务数据:', taskKey);
  };

  /**
   * 处理任务超时事件
   */
  private handleTaskTimeout = async (event: Event) => {
    const customEvent = event as CustomEvent;
    const { loadingMessageId, orderId } = customEvent.detail;

    console.log('[TaskEventHandler] 收到任务超时事件:', { loadingMessageId, orderId });

    // 更新历史记录状态为"超时"
    try {
      console.log('[TaskEventHandler] 更新历史记录状态，订单状态：超时');
      await updateTaskStatus(orderId, '超时');
    } catch (error) {
      console.error('[TaskEventHandler] 更新任务记录状态失败:', error);
    }

    // 清理 localStorage 中的任务数据
    const taskKey = `gen-${loadingMessageId}`;
    localStorage.removeItem(taskKey);
    console.log('[TaskEventHandler] 已清理任务数据:', taskKey);
  };
}

// 导出单例
export const taskEventHandler = new TaskEventHandler();
