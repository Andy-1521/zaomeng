/**
 * 状态徽章组件
 * 用于显示任务状态（处理中、成功、失败、超时）
 * 复用历史记录的样式设计
 */

export type TaskStatus = '处理中' | '成功' | '失败' | '超时';

interface StatusBadgeProps {
  status: TaskStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const statusConfig = {
    '处理中': {
      className: 'bg-blue-500/20 text-blue-300',
      icon: (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ),
    },
    '成功': {
      className: 'bg-green-500/20 text-green-300',
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    '失败': {
      className: 'bg-red-500/20 text-red-300',
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
    },
    '超时': {
      className: 'bg-yellow-500/20 text-yellow-300',
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  };

  const config = statusConfig[status];

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.className} ${className}`}>
      {config.icon}
      <span>{status}</span>
    </div>
  );
}
