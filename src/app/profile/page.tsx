'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { useUser } from '@/contexts/UserContext';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue;
}

interface Transaction {
  id: string;
  orderNumber: string;
  description: string;
  points: number;
  remainingPoints: number;
  time: number;
  status: string;
  prompt: string;
  requestParams: JsonValue;
  resultData: JsonValue;
}

type ProfileTab = 'info' | 'security' | 'transactions';

export default function ProfilePage() {
  const router = useRouter();
  const { user, setUser, isLoading, refreshUser } = useUser();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('info');
  const [showCopySuccess, setShowCopySuccess] = useState(false);

  // 表单状态
  const [editUsername, setEditUsername] = useState('');
  const [showEditUsername, setShowEditUsername] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 错误和成功消息
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 获取用户信息和消费记录
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }

    const fetchData = async () => {
      try {
        // 刷新用户信息
        await refreshUser();

        // 获取消费记录
        const transResponse = await fetch(`/api/user/transactions?userId=${user!.id}`);
        const transResult = await transResponse.json();

        if (transResult.success) {
          setTransactions(transResult.data);
        }

        setEditUsername(user!.username);
      } catch (error) {
        console.error('获取用户信息失败:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [isLoading, refreshUser, router, user]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // 获取状态标签
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { className: string; icon: React.ReactNode }> = {
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

    // 如果状态不在配置中，使用默认的失败样式
    const config = statusConfig[status] || statusConfig['失败'];
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.className}`}>
        {config.icon}
        <span>{status}</span>
      </div>
    );
  };

  // 格式化时间
  const formatTime = (time: number | string) => {
    try {
      const date = new Date(typeof time === 'number' ? time : time);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(time);
    }
  };

  // 处理用户名修改
  const handleUpdateUsername = async () => {
    if (!user || !editUsername.trim()) {
      showMessage('error', '用户名不能为空');
      return;
    }

    try {
      const response = await fetch('/api/user/update-username', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          newUsername: editUsername.trim(),
        }),
      });

      const result = await response.json();

      if (result.success) {
        setUser({ ...user!, username: result.data.username });
        showMessage('success', '用户名修改成功');
        setShowEditUsername(false);
      } else {
        showMessage('error', result.message || '修改失败');
      }
    } catch {
      showMessage('error', '修改失败，请稍后重试');
    }
  };

  // 处理密码修改
  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      showMessage('error', '新密码至少6位');
      return;
    }

    if (newPassword !== confirmPassword) {
      showMessage('error', '两次密码不一致');
      return;
    }

    try {
      const response = await fetch('/api/user/update-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user!.id,
          oldPassword,
          newPassword,
        }),
      });

      const result = await response.json();

      if (result.success) {
        showMessage('success', '密码修改成功');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        showMessage('error', result.message || '修改失败');
      }
    } catch {
      showMessage('error', '修改失败，请稍后重试');
    }
  };

  // 处理头像修改
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showMessage('error', '仅支持 JPG、PNG、GIF、WEBP 格式的图片');
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showMessage('error', '图片大小不能超过 5MB');
      return;
    }

    const formData = new FormData();
    formData.append('userId', user!.id);
    formData.append('file', file);

    try {
      const response = await fetch('/api/user/update-avatar', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        setUser({ ...user!, avatar: result.data.avatar });
        showMessage('success', '头像修改成功');
      } else {
        showMessage('error', result.message || '修改失败');
      }
    } catch {
      showMessage('error', '修改失败，请稍后重试');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white text-lg">加载中...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* 动态背景层 */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-900 to-black" />
        <div className="absolute top-1/4 left-1/4 w-[800px] h-[800px] bg-purple-600/12 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[700px] h-[700px] bg-blue-600/12 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-indigo-600/8 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2.5s' }} />
      </div>

      {/* 主内容区 */}
      <div className="relative z-10">
        {/* 导航栏 */}
        <Navbar />

        {/* 内容容器 */}
        <div className="max-w-4xl mx-auto px-6 py-8">
          {/* 标题栏 */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              个人中心
            </h1>
            <p className="text-neutral-400">管理您的账号信息和设置</p>

            {/* 管理员入口 - 仅管理员可见 */}
            {user.isAdmin && (
              <div className="mt-4">
                <button
                  onClick={() => router.push('/admin/generations')}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-sm font-medium text-white hover:from-purple-700 hover:to-blue-700 transition-all shadow-lg shadow-purple-500/30 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  进入管理员后台
                </button>
              </div>
            )}
          </div>

          {/* 消息提示 */}
          {message && (
            <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-500/20 border border-green-500/30 text-green-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
              {message.text}
            </div>
          )}

          {/* 复制成功提示 */}
          {showCopySuccess && (
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-black/80 backdrop-blur-md text-white px-6 py-3 rounded-lg text-sm shadow-2xl">
              ✓ 订单号已复制
            </div>
          )}

          {/* 标签页切换 */}
          <div className="flex mb-6 bg-white/10 rounded-lg p-1 border border-white/20">
            {[
              { key: 'info', label: '基本信息' },
              { key: 'security', label: '安全设置' },
              { key: 'transactions', label: '消费记录' },
            ].map((tab: { key: ProfileTab; label: string }) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/30'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 基本信息标签页 */}
          {activeTab === 'info' && (
            <div className="bg-white/10 backdrop-blur-2xl rounded-2xl p-8 border border-white/20 shadow-2xl">
              {/* 头像区域 */}
              <div className="flex items-center mb-8">
                <div className="relative group">
                  <img
                    src={user.avatar}
                    alt="用户头像"
                    className="w-24 h-24 rounded-full object-cover border-4 border-white/20 shadow-lg shadow-purple-500/30"
                  />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
                  </label>
                </div>
                <div className="ml-6 flex-1">
                  <h2 className="text-2xl font-bold text-white mb-1">{user.username}</h2>
                  <p className="text-neutral-400 text-sm">{user.email}</p>
                </div>
              </div>

              {/* 用户信息列表 */}
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                  <div>
                    <label className="block text-neutral-400 text-sm mb-1">用户ID</label>
                    <p className="text-white font-mono text-sm">{user.id}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                  <div className="flex-1">
                    <label className="block text-neutral-400 text-sm mb-1">用户名</label>
                    {showEditUsername ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-purple-500/60"
                        />
                        <button
                          onClick={handleUpdateUsername}
                          className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:opacity-90 transition-opacity"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => {
                            setEditUsername(user.username);
                            setShowEditUsername(false);
                          }}
                          className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-opacity"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <p className="text-white">{user.username}</p>
                        <button onClick={() => setShowEditUsername(true)} className="px-3 py-1 text-sm text-purple-400 hover:text-purple-300">
                          修改
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                  <div>
                    <label className="block text-neutral-400 text-sm mb-1">邮箱</label>
                    <p className="text-white">{user.email}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                  <div>
                    <div className="flex items-center gap-2 text-neutral-400 text-sm mb-1">
                      <img src="/points-icon.png" alt="积分" className="w-4 h-4" />
                      <span>剩余积分</span>
                    </div>
                    <p className="text-2xl font-bold text-white bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
                      {user.points}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                  <div>
                    <label className="block text-neutral-400 text-sm mb-1">注册时间</label>
                    <p className="text-white">{formatTime(user.createTime ?? user.createdAt ?? '')}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 安全设置标签页 */}
          {activeTab === 'security' && (
            <div className="bg-white/10 backdrop-blur-2xl rounded-2xl p-8 border border-white/20 shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-6">修改密码</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-neutral-400 text-sm mb-1.5">当前密码</label>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="请输入当前密码"
                    className="w-full px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-neutral-400 text-sm mb-1.5">新密码</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="请输入新密码（至少6位）"
                    className="w-full px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-neutral-400 text-sm mb-1.5">确认新密码</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="请再次输入新密码"
                    className="w-full px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  />
                </div>

                <button
                  onClick={handleUpdatePassword}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:opacity-90 transition-opacity font-medium shadow-lg shadow-purple-500/30"
                >
                  修改密码
                </button>
              </div>
            </div>
          )}

          {/* 消费记录标签页 */}
          {activeTab === 'transactions' && (
            <div className="bg-white/10 backdrop-blur-2xl rounded-2xl p-8 border border-white/20 shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-6">消费记录</h3>

              {transactions.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-neutral-400">暂无消费记录</p>
                </div>
              ) : (
                <div className="max-h-[600px] overflow-y-auto space-y-3 pr-2 history-scrollbar">
                  {transactions.map((trans) => (
                    <div
                      key={trans.id}
                      className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm truncate">{trans.description}</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <svg className="w-3 h-3 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p className="text-neutral-500 text-xs truncate">{trans.orderNumber}</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (trans.orderNumber) {
                                navigator.clipboard.writeText(trans.orderNumber).then(() => {
                                  setShowCopySuccess(true);
                                  setTimeout(() => setShowCopySuccess(false), 2000);
                                }).catch((err) => {
                                  console.error('复制失败:', err);
                                });
                              }
                            }}
                            className="hover:bg-white/10 rounded p-1 transition-colors cursor-pointer text-neutral-500"
                            title="复制订单号"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="text-center mx-4 min-w-[120px]">
                        <div className="flex items-center gap-1.5 justify-center">
                          <svg className="w-3 h-3 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-neutral-500 text-xs whitespace-nowrap">{formatTime(trans.time)}</p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-3 min-w-fit">
                        <div className="text-right">
                          {trans.status === '成功' && (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-red-400 font-bold text-sm">-{trans.points}</span>
                              <img src="/points-icon.png" alt="积分" className="w-3 h-3" />
                            </div>
                          )}
                          <p className="text-neutral-500 text-xs">剩余: {trans.remainingPoints}</p>
                        </div>
                        {getStatusBadge(trans.status)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
