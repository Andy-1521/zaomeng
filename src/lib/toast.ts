/**
 * 全局 Toast 提示工具函数
 *
 * 功能：
 * - 统一的毛玻璃背景样式
 * - 支持显示积分图标
 * - 自动3秒后消失
 * - 支持多个Toast同时显示，以列表形式排列
 * - 居中显示在屏幕中央
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  showPointsIcon?: boolean; // 是否显示积分图标（用于积分变化提示）
}

// Toast管理器，用于管理多个Toast的显示
class ToastManager {
  private container: HTMLElement | null = null;
  private toastCount = 0;

  private getOrCreateContainer(): HTMLElement {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'fixed z-[10000] flex flex-col gap-3 items-center justify-center pointer-events-none';
      this.container.id = 'toast-container';
      // Use inline styles for positioning to avoid conflicts with Tailwind v4 translate property
      this.container.style.top = '50%';
      this.container.style.left = '50%';
      this.container.style.transform = 'translate(-50%, -50%)';
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  public addToastToContainer(toast: HTMLElement) {
    const container = this.getOrCreateContainer();
    container.appendChild(toast);
    this.toastCount++;

    // Toast元素需要可以交互（复制等）
    toast.style.pointerEvents = 'auto';

    // 始终保持在屏幕中央，多个Toast时从中心向上堆叠
    if (this.toastCount === 1) {
      // 单个Toast：完全居中
      container.style.top = '50%';
      container.style.transform = 'translate(-50%, -50%)';
    } else {
      // 多个Toast：稍微向上偏移，保持在视觉中心
      // 使用负的 translateY 让整体向上移动
      const offset = Math.min((this.toastCount - 1) * 20, 60); // 最多向上偏移60px
      container.style.top = '50%';
      container.style.transform = `translate(-50%, calc(-50% - ${offset}px))`;
    }
  }

  public removeToastFromContainer(toast: HTMLElement) {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease-out';
    toast.style.transform = 'scale(0.9)';
    setTimeout(() => {
      toast.remove();
      this.toastCount--;

      // 调整剩余Toast的位置
      if (this.toastCount > 0 && this.container) {
        // 重新计算位置，使Toast保持在视觉中心
        const offset = Math.min((this.toastCount - 1) * 20, 60);
        this.container.style.top = '50%';
        this.container.style.transform = `translate(-50%, calc(-50% - ${offset}px))`;
      } else if (this.toastCount === 0 && this.container) {
        // 没有Toast了，重置到完全居中
        this.container.style.top = '50%';
        this.container.style.transform = 'translate(-50%, -50%)';
      }
    }, 300);
  }
}

const toastManager = new ToastManager();

/**
 * 显示 Toast 提示
 *
 * @param message 提示消息
 * @param type 提示类型（目前统一样式，未来可扩展）
 * @param options 选项
 */
export function showToast(
  message: string,
  type: ToastType = 'info',
  options: ToastOptions = {}
) {
  const toast = document.createElement('div');

  // 统一使用毛玻璃背景
  toast.className = `bg-white/10 backdrop-blur-xl text-white px-6 py-3 rounded-2xl text-sm shadow-2xl border border-white/20 flex items-center gap-2 min-w-[200px]`;

  // 如果需要显示积分图标，在负数（如-30、-20）前插入积分图标
  if (options.showPointsIcon) {
    // 使用正则表达式匹配负数（如-30、-20等）
    const negativeNumberPattern = /-\d+/g;
    let lastIndex = 0;
    let match;

    while ((match = negativeNumberPattern.exec(message)) !== null) {
      // 添加负数前面的文本
      if (match.index > lastIndex) {
        const beforeText = message.substring(lastIndex, match.index);
        const textNode = document.createTextNode(beforeText);
        toast.appendChild(textNode);
      }

      // 添加积分图标
      const pointsIcon = document.createElement('img');
      pointsIcon.src = '/points-icon.png';
      pointsIcon.alt = '积分';
      pointsIcon.className = 'w-4 h-4';
      toast.appendChild(pointsIcon);

      // 添加负数
      const numberText = document.createTextNode(match[0]);
      toast.appendChild(numberText);

      lastIndex = negativeNumberPattern.lastIndex;
    }

    // 添加剩余的文本
    if (lastIndex < message.length) {
      const afterText = message.substring(lastIndex);
      const textNode = document.createTextNode(afterText);
      toast.appendChild(textNode);
    }
  } else {
    // 不显示积分图标，直接显示完整消息
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    toast.appendChild(messageSpan);
  }

  // 添加到容器
  toastManager.addToastToContainer(toast);

  // 3秒后淡出并移除
  setTimeout(() => {
    toastManager.removeToastFromContainer(toast);
  }, 3000);
}

/**
 * 显示成功提示（快捷方法）
 */
export function showSuccessToast(message: string) {
  showToast(message, 'success');
}

/**
 * 显示错误提示（快捷方法）
 */
export function showErrorToast(message: string) {
  showToast(message, 'error');
}

/**
 * 显示积分变化提示（快捷方法）
 *
 * @param message 提示消息（如"彩绘图提取成功 -30"）
 */
export function showPointsToast(message: string) {
  showToast(message, 'info', { showPointsIcon: true });
}
