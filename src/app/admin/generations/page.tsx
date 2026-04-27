'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { showToast } from '@/lib/toast';

interface GenerationRecord {
  id: string;
  userId: string;
  username: string;
  userAvatar: string;
  toolPage: string; // 彩绘提取
  description: string;
  points: number; // 预估积分
  actualPoints: number; // 实际扣除积分
  remainingPoints: number;
  status: string; // 成功、失败、处理中
  prompt: string;
  requestParams: RequestParamsValue;
  resultData: ResultDataValue;
  psdUrl?: string; // PSD文件下载链接
  createdAt: string;
  orderNumber: string;
  uploadedImage?: string;
}

interface UserInfo {
  id: string;
  username: string;
  email: string;
  avatar: string;
  points: number;
  isAdmin: boolean;
  createdAt: string;
}

type TabType = 'generations' | 'users';

type RequestParamsValue = Record<string, unknown> | null;

type ResultDataObject = {
  result_image_url?: string | string[];
  error?: string;
  message?: string;
  debug?: {
    error?: string;
  };
  [key: string]: unknown;
};

type ResultDataValue = string | string[] | ResultDataObject | null;

type EditModalValue = string | number | null;

type EditModalState = {
  open: boolean;
  type: 'points' | 'avatar' | null;
  userId: string;
  currentData: EditModalValue;
};

type RecordFilters = {
  keyword: string;
  toolPage: string;
  status: string;
  startDate: string;
  endDate: string;
};

function getResultImageUrls(data: ResultDataValue): string[] {
  if (!data) return [];
  if (typeof data === 'string') return [data];
  if (Array.isArray(data)) return data.filter((item): item is string => typeof item === 'string');
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data.result_image_url)) {
      return data.result_image_url.filter((item): item is string => typeof item === 'string');
    }
    if (typeof data.result_image_url === 'string') {
      return [data.result_image_url];
    }
  }
  return [];
}

export default function AdminGenerationsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('generations');
  const [records, setRecords] = useState<GenerationRecord[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);
  const [sessionRefreshed, setSessionRefreshed] = useState(false);

  // 详情模态框状态
  const [detailModal, setDetailModal] = useState<{ open: boolean; record: GenerationRecord | null }>({
    open: false,
    record: null,
  });

  // 搜索和筛选参数
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterToolPage, setFilterToolPage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTimeRange, setFilterTimeRange] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // 统计数据
  const [totalStats, setTotalStats] = useState({
    total: 0,
    colorExtractionCount: 0,
    successCount: 0,
    failureCount: 0,
  });

  // 全局统计（不受筛选影响，首次加载时固定）
  const [globalStats, setGlobalStats] = useState({
    total: 0,
  });

  // 用户搜索参数
  const [userSearchKeyword, setUserSearchKeyword] = useState('');

  const [editModal, setEditModal] = useState<EditModalState>({
    open: false,
    type: null,
    userId: '',
    currentData: null,
  });
  const [editValue, setEditValue] = useState('');

  // 计算派生统计
  const successRate = totalStats.total > 0
    ? Math.round((totalStats.successCount / totalStats.total) * 100)
    : 0;
  const totalPointsConsumed = records.reduce((sum, r) => sum + (r.actualPoints > 0 ? r.actualPoints : 0), 0);

  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const hasRecordsRef = useRef(false);

  useEffect(() => {
    hasRecordsRef.current = records.length > 0;
  }, [records]);

  const loadRecords = useCallback(async (pageNum: number = 0, filters?: Partial<RecordFilters>) => {
    if (!hasRecordsRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const userId = currentAdminId || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!).id : '');

      const params = new URLSearchParams({
        skip: (pageNum * 50).toString(),
        limit: '50',
        userId,
      });

      const keyword = filters?.keyword !== undefined ? filters.keyword : searchKeyword;
      const toolPage = filters?.toolPage !== undefined ? filters.toolPage : filterToolPage;
      const status = filters?.status !== undefined ? filters.status : filterStatus;
      const startDate = filters?.startDate !== undefined ? filters.startDate : filterStartDate;
      const endDate = filters?.endDate !== undefined ? filters.endDate : filterEndDate;

      if (keyword) params.append('keyword', keyword);
      if (toolPage) params.append('toolPage', toolPage);
      if (status) params.append('status', status);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`/api/admin/generations?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        if (pageNum === 0) {
          setRecords(data.data.records);
          const newStats = {
            total: data.data.total || 0,
            colorExtractionCount: data.data.stats?.colorExtractionCount || 0,
            successCount: data.data.stats?.successCount || 0,
            failureCount: data.data.stats?.failureCount || 0,
          };
          setTotalStats(newStats);
          // 无筛选条件时缓存全局统计
          const hasFilter = keyword || toolPage || status || startDate || endDate;
          if (!hasFilter) {
            setGlobalStats({ total: newStats.total });
          }
        } else {
          // 按 id 去重，避免筛选条件下分页数据重叠导致 key 重复
          setRecords(prev => {
            const existingIds = new Set(prev.map(r => r.id));
            const newRecords = data.data.records.filter((r: { id: string }) => !existingIds.has(r.id));
            return [...prev, ...newRecords];
          });
        }
        setHasMore(data.data.records.length >= 50);
      } else {
        setError(data.message || '加载失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [currentAdminId, filterEndDate, filterStartDate, filterStatus, filterToolPage, searchKeyword]);

  const getCurrentFilters = useCallback((overrides?: Partial<RecordFilters>): RecordFilters => {
    return {
      keyword: overrides?.keyword ?? searchKeyword,
      toolPage: overrides?.toolPage ?? filterToolPage,
      status: overrides?.status ?? filterStatus,
      startDate: overrides?.startDate ?? filterStartDate,
      endDate: overrides?.endDate ?? filterEndDate,
    };
  }, [filterEndDate, filterStartDate, filterStatus, filterToolPage, searchKeyword]);

  const triggerRecordSearch = useCallback((overrides?: Partial<RecordFilters>) => {
    const filters = getCurrentFilters(overrides);
    setPage(0);
    void loadRecords(0, filters);
  }, [getCurrentFilters, loadRecords]);

  const extractImageUrl = (data: ResultDataValue): string | null => {
    return getResultImageUrls(data)[0] || null;
  };

  const getImageCount = (data: ResultDataValue): number => {
    return getResultImageUrls(data).length;
  };

  const loadUsers = useCallback(async (keyword?: string) => {
    setLoading(true);
    setError(null);

    try {
      const userId = currentAdminId || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!).id : '');
      const params = new URLSearchParams({ userId });
      if (keyword) {
        params.append('keyword', keyword);
      }

      const response = await fetch(`/api/user/users?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        setUsers(data.data);
      } else {
        setError(data.message || '加载失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [currentAdminId]);

  const handleToolPageChange = (value: string) => {
    setFilterToolPage(value);
    triggerRecordSearch({ toolPage: value });
  };

  const handleStatusChange = (value: string) => {
    setFilterStatus(value);
    triggerRecordSearch({ status: value });
  };

  const handleTimeRangeChange = (value: string) => {
    const now = new Date();
    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    let startDate = '';
    let endDate = '';

    switch (value) {
      case 'today':
        startDate = formatDate(now);
        endDate = startDate;
        break;
      case 'yesterday': {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = formatDate(yesterday);
        endDate = startDate;
        break;
      }
      case 'last7days': {
        const last7Days = new Date(now);
        last7Days.setDate(last7Days.getDate() - 6);
        startDate = formatDate(last7Days);
        endDate = formatDate(now);
        break;
      }
      case 'last30days': {
        const last30Days = new Date(now);
        last30Days.setDate(last30Days.getDate() - 29);
        startDate = formatDate(last30Days);
        endDate = formatDate(now);
        break;
      }
      case 'custom':
        startDate = filterStartDate;
        endDate = filterEndDate;
        break;
      default:
        break;
    }

    setFilterTimeRange(value);
    setFilterStartDate(startDate);
    setFilterEndDate(endDate);

    if (value !== 'custom') {
      triggerRecordSearch({ startDate, endDate });
    }
  };

  const refreshSession = useCallback(async () => {
    try {
      const userStr = localStorage.getItem('user');
      if (!userStr) {
        router.push('/login');
        return;
      }

      const user = JSON.parse(userStr);
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('user', JSON.stringify(data.data));
        setCurrentAdminId(data.data.id);
        setSessionRefreshed(true);

        if (!data.data.isAdmin) {
          router.push('/home');
          return;
        }
      } else {
        router.push('/login');
      }
    } catch {
      router.push('/login');
    }
  }, [router]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshSession();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refreshSession]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (sessionRefreshed && currentAdminId) {
      const timeoutId = window.setTimeout(() => {
        if (activeTab === 'generations') {
          void loadRecords(0);
        } else {
          void loadUsers();
        }
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [activeTab, sessionRefreshed, currentAdminId, loadRecords, loadUsers]);

  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean, username: string) => {
    const action = currentIsAdmin ? '取消' : '设置';
    if (!confirm(`确定要${action}用户 "${username}" 为管理员吗？`)) {
      return;
    }

    try {
      const response = await fetch('/api/admin/set-admin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: userId,
          isAdmin: !currentIsAdmin,
        }),
      });

      const data = await response.json();
      if (data.success) {
        loadUsers();
        showToast(data.message || '操作成功', 'success');
      } else {
        showToast(data.message || '操作失败', 'error');
      }
    } catch {
      showToast('操作失败，请稍后重试', 'error');
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadRecords(nextPage);
  };

  const handleResetFilters = () => {
    setSearchKeyword('');
    setFilterToolPage('');
    setFilterStatus('');
    setFilterTimeRange('');
    setFilterStartDate('');
    setFilterEndDate('');
    setPage(0);
    triggerRecordSearch({
      keyword: '',
      toolPage: '',
      status: '',
      startDate: '',
      endDate: ''
    });
  };

  // 快速筛选：点击统计卡片自动筛选
  const handleQuickFilter = (toolPage?: string) => {
    const newToolPage = (toolPage === filterToolPage) ? '' : (toolPage || '');
    setFilterToolPage(newToolPage);
    setPage(0);
    triggerRecordSearch({
      keyword: searchKeyword,
      toolPage: newToolPage,
      status: filterStatus,
      startDate: filterStartDate,
      endDate: filterEndDate
    });
  };

  // 防抖搜索：输入时自动搜索
  const handleSearchInput = (value: string) => {
    setSearchKeyword(value);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      triggerRecordSearch({
        keyword: value,
        toolPage: filterToolPage,
        status: filterStatus,
        startDate: filterStartDate,
        endDate: filterEndDate
      });
    }, 300);
  };

  // 获取状态标签
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { dotClass: string; labelClass: string }> = {
      '成功': { dotClass: 'bg-green-500', labelClass: 'text-green-600' },
      '失败': { dotClass: 'bg-red-500', labelClass: 'text-red-600' },
      '处理中': { dotClass: 'bg-amber-500', labelClass: 'text-amber-600' },
    };
    const config = statusConfig[status];
    if (!config) return <span className="text-white/60">{status}</span>;

    return (
      <div className="inline-flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${config.dotClass} ${status === '处理中' ? 'animate-pulse' : ''}`} />
        <span className={`text-sm font-medium ${config.labelClass}`}>{status}</span>
      </div>
    );
  };

  const openEditModal = (userId: string, type: 'points' | 'avatar', currentValue: EditModalValue) => {
    setEditModal({
      open: true,
      type,
      userId,
      currentData: currentValue,
    });
    setEditValue(type === 'points' ? currentValue.toString() : currentValue || '');
  };

  const closeEditModal = () => {
    setEditModal({
      open: false,
      type: null,
      userId: '',
      currentData: null,
    });
    setEditValue('');
  };

  const handleSaveEdit = async () => {
    const { userId, type } = editModal;
    if (!userId || !type) return;

    try {
      const updateData: { points?: number; avatar?: string } = {};

      if (type === 'points') {
        const points = parseInt(editValue);
        if (isNaN(points) || points < 0) {
          showToast('请输入有效的积分数值', 'error');
          return;
        }
        updateData.points = points;
      } else if (type === 'avatar') {
        updateData.avatar = editValue.trim();
      }

      const adminUserId = currentAdminId || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!).id : '');
      const response = await fetch(`/api/admin/update-user?userId=${adminUserId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...updateData,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showToast('更新成功', 'success');
        void loadUsers();
        closeEditModal();
      } else {
        showToast(data.message || '更新失败', 'error');
      }
    } catch {
      showToast('操作失败，请稍后重试', 'error');
    }
  };

  // 格式化时间（更简洁）
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `今天 ${time}`;
    if (isYesterday) return `昨天 ${time}`;
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + time;
  };

  if (loading && (activeTab === 'generations' ? records.length === 0 : users.length === 0)) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-900 to-black" />
          <div className="absolute top-1/4 left-1/4 w-[800px] h-[800px] bg-purple-600/12 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-[700px] h-[700px] bg-blue-600/12 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        </div>
        <div className="relative z-10 text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/20 border-t-white mx-auto mb-4" />
          <p className="text-white/60">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="h-screen bg-black text-white relative overflow-hidden flex flex-col">
        {/* 动态背景 */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-900 to-black" />
          <div className="absolute top-1/4 left-1/4 w-[800px] h-[800px] bg-purple-600/12 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-[700px] h-[700px] bg-blue-600/12 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        </div>

        <Navbar showUserMenu={false} />

        <div className="relative z-10 flex flex-col flex-1 min-h-0 px-6 py-4">
        <div className="max-w-7xl mx-auto w-full flex flex-col flex-1 min-h-0">
          {/* Page header */}
          <div className="mb-4 flex-shrink-0">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              管理员后台
            </h1>
          </div>

          {/* Tab switcher */}
          <div className="flex mb-4 bg-white/10 rounded-lg p-1 border border-white/20 flex-shrink-0">
            {[
              { key: 'generations' as TabType, label: '生图记录' },
              { key: 'users' as TabType, label: '用户管理' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setPage(0);
                }}
                className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/30'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-6">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* ===== Users Tab ===== */}
          {activeTab === 'users' && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
              {/* User search */}
              <div className="flex gap-3 flex-shrink-0">
                <div className="flex-1 max-w-md">
                  <input
                    type="text"
                    value={userSearchKeyword}
                    onChange={(e) => setUserSearchKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadUsers(userSearchKeyword)}
                    placeholder="搜索用户名或邮箱..."
                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                </div>
                <button
                  onClick={() => loadUsers(userSearchKeyword)}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  搜索
                </button>
                <button
                  onClick={() => {
                    setUserSearchKeyword('');
                    loadUsers('');
                  }}
                  className="px-4 py-2 border border-white/10 rounded-lg text-sm font-medium hover:bg-white/20 transition-colors"
                >
                  重置
                </button>
              </div>

              {users.length === 0 && !loading ? (
                <div className="flex-1 flex items-center justify-center bg-white/5 rounded-xl border border-white/10">
                  <p className="text-white/60">暂无用户</p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 bg-white/5 rounded-xl border border-white/10 overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 z-[1]">
                      <tr className="border-b border-white/10 bg-neutral-900/95 backdrop-blur">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">用户</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">邮箱</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">积分</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">角色</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user, idx) => (
                        <tr key={user.id} className={`border-b border-white/10 last:border-0 ${idx % 2 === 1 ? 'bg-white/[0.08]' : ''} hover:bg-white/20 transition-colors`}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="relative group cursor-pointer" onClick={() => openEditModal(user.id, 'avatar', user.avatar)}>
                                <img
                                  src={user.avatar || '/images/avatar.png'}
                                  alt={user.username}
                                  className="w-8 h-8 rounded-full object-cover"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </div>
                              </div>
                              <span className="text-sm font-medium">{user.username}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-white/60">{user.email}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <img src="/points-icon.png" alt="积分" className="w-4 h-4" />
                              <span className="text-sm font-medium text-amber-600">{user.points}</span>
                              <button
                                onClick={() => openEditModal(user.id, 'points', user.points)}
                                className="text-white/60 hover:text-white text-xs transition-colors"
                                title="修改积分"
                              >
                                ✎
                              </button>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {user.isAdmin ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-white">管理员</span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/20 text-white/60">普通用户</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {user.id !== currentAdminId && (
                              <button
                                onClick={() => handleToggleAdmin(user.id, user.isAdmin, user.username)}
                                className="text-sm text-white/60 hover:text-white transition-colors"
                              >
                                {user.isAdmin ? '取消管理员' : '设为管理员'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===== Generations Tab ===== */}
          {activeTab === 'generations' && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
              {/* Stats cards */}
              <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 flex-shrink-0">
                {/* Total records */}
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="text-xs text-white/60 font-medium mb-1">总记录</div>
                  <div className="text-2xl font-bold tabular-nums">{globalStats.total || totalStats.total}</div>
                </div>

                {/* Success count */}
                <div
                  className={`bg-white/5 border rounded-lg p-4 cursor-pointer transition-all ${
                    filterStatus === '成功'
                      ? 'border-green-500/50 bg-green-500/5'
                      : 'border-white/10 hover:border-green-500/30'
                  }`}
                  onClick={() => handleStatusChange(filterStatus === '成功' ? '' : '成功')}
                >
                  <div className="text-xs text-white/60 font-medium mb-1">成功</div>
                  <div className="text-2xl font-bold text-green-600 tabular-nums">{totalStats.successCount}</div>
                </div>

                {/* Failure count */}
                <div
                  className={`bg-white/5 border rounded-lg p-4 cursor-pointer transition-all ${
                    filterStatus === '失败'
                      ? 'border-red-500/50 bg-red-500/5'
                      : 'border-white/10 hover:border-red-500/30'
                  }`}
                  onClick={() => handleStatusChange(filterStatus === '失败' ? '' : '失败')}
                >
                  <div className="text-xs text-white/60 font-medium mb-1">失败</div>
                  <div className="text-2xl font-bold text-red-600 tabular-nums">{totalStats.failureCount}</div>
                </div>

                {/* Success rate */}
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="text-xs text-white/60 font-medium mb-1">成功率</div>
                  <div className="text-2xl font-bold tabular-nums">{successRate}<span className="text-base text-white/60">%</span></div>
                </div>

                {/* Color extraction count */}
                <div
                  className={`bg-white/5 border rounded-lg p-4 cursor-pointer transition-all ${
                    filterToolPage === '彩绘提取'
                      ? 'border-white/30 bg-white/5'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                  onClick={() => handleQuickFilter('彩绘提取')}
                >
                  <div className="text-xs text-white/60 font-medium mb-1">彩绘提取</div>
                  <div className="text-2xl font-bold tabular-nums">{totalStats.colorExtractionCount}</div>
                </div>

                {/* Total points consumed (current page) */}
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="text-xs text-white/60 font-medium mb-1">消耗积分</div>
                  <div className="text-2xl font-bold text-amber-600 tabular-nums">{totalPointsConsumed}</div>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                <div className="flex-1 min-w-[200px] max-w-sm">
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => handleSearchInput(e.target.value)}
                    placeholder="搜索用户名或订单号..."
                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                </div>

                <select
                  value={filterToolPage}
                  onChange={(e) => handleToolPageChange(e.target.value)}
                  className="bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                >
                  <option value="">全部类型</option>
                  <option value="彩绘提取">彩绘提取</option>
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  className="bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                >
                  <option value="">全部状态</option>
                  <option value="成功">成功</option>
                  <option value="失败">失败</option>
                  <option value="处理中">处理中</option>
                </select>

                <select
                  value={filterTimeRange}
                  onChange={(e) => handleTimeRangeChange(e.target.value)}
                  className="bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                >
                  <option value="">全部时间</option>
                  <option value="today">今天</option>
                  <option value="yesterday">昨天</option>
                  <option value="last7days">最近7天</option>
                  <option value="last30days">最近30天</option>
                  <option value="custom">自定义</option>
                </select>

                {filterTimeRange === 'custom' && (
                  <>
                    <input
                      type="date"
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                      className="bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                    />
                    <input
                      type="date"
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
                      className="bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                    />
                  </>
                )}

                <button
                  onClick={handleResetFilters}
                  className="px-3 py-2 border border-white/10 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/20 transition-colors"
                >
                  重置
                </button>
              </div>

              {/* Data table */}
              {records.length === 0 && !loading ? (
                <div className="flex-1 flex items-center justify-center bg-white/5 rounded-xl border border-white/10">
                  <p className="text-white/60">暂无生图记录</p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 bg-white/5 rounded-xl border border-white/10 overflow-hidden relative flex flex-col">
                  {/* Inline loading bar */}
                  {loading && records.length > 0 && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/20 z-10 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 animate-[loading_1.5s_ease-in-out_infinite]" style={{ width: '40%' }} />
                    </div>
                  )}
                  <div className="overflow-y-auto flex-1">
                    <table className="w-full">
                      <thead className="sticky top-0 z-[1]">
                        <tr className="border-b border-white/10 bg-neutral-900/95 backdrop-blur">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">用户</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">状态</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">提示词</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">积分</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">结果</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">PSD</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record, idx) => {
                          const imageUrl = extractImageUrl(record.resultData);
                          const imageCount = getImageCount(record.resultData);

                          let allImages: string[] = [];
                          if (record.resultData) {
                            if (typeof record.resultData === 'string') {
                              allImages = [record.resultData];
                            } else if (Array.isArray(record.resultData)) {
                              allImages = record.resultData;
                            } else if (typeof record.resultData === 'object' && record.resultData !== null) {
                              if (Array.isArray(record.resultData.result_image_url)) {
                                allImages = record.resultData.result_image_url;
                              } else if (record.resultData.result_image_url) {
                                allImages = [record.resultData.result_image_url];
                              }
                            }
                          }

                          return (
                            <tr
                              key={record.id}
                              className={`border-b border-white/10 last:border-0 cursor-pointer ${idx % 2 === 1 ? 'bg-white/[0.06]' : ''} hover:bg-white/20 transition-colors`}
                              onClick={() => setDetailModal({ open: true, record })}
                            >
                              {/* User */}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <img
                                    src={record.userAvatar || '/images/avatar.png'}
                                    alt={record.username}
                                    className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">{record.username}</div>
                                    <div className="text-xs text-white/60 truncate">{record.orderNumber}</div>
                                  </div>
                                </div>
                              </td>

                              {/* Status */}
                              <td className="px-4 py-3">
                                {getStatusBadge(record.status)}
                              </td>

                              {/* Prompt */}
                              <td className="px-4 py-3 max-w-[240px]">
                                <p className="text-sm text-white/80 truncate">
                                  {record.prompt || record.description || '-'}
                                </p>
                              </td>

                              {/* Points */}
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-sm font-medium tabular-nums">
                                    {record.actualPoints > 0 ? record.actualPoints : 0}
                                  </span>
                                  <img src="/points-icon.png" alt="积分" className="w-3.5 h-3.5" />
                                </div>
                                {record.points !== record.actualPoints && record.status === '成功' && (
                                  <div className="text-xs text-white/60 tabular-nums">
                                    预估 {record.points}
                                  </div>
                                )}
                              </td>

                              {/* Result image */}
                              <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                {imageUrl ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <img
                                      src={imageUrl}
                                      alt="结果"
                                      className="w-16 h-12 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                                      onClick={() => {
                                        setPreviewImages(allImages);
                                        setPreviewIndex(0);
                                      }}
                                    />
                                    {imageCount > 1 && (
                                      <span className="text-[10px] text-white/60">{imageCount}张</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-white/60">-</span>
                                )}
                              </td>

                              {/* PSD */}
                              <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                {record.toolPage === '彩绘提取' && record.status === '成功' && record.psdUrl ? (
                                  <button
                                    onClick={async () => {
                                      try {
                                        showToast('正在下载PSD文件...', 'info');
                                        const controller = new AbortController();
                                        const timeoutId = setTimeout(() => controller.abort(), 60000);
                                        const response = await fetch(record.psdUrl!, { signal: controller.signal });
                                        clearTimeout(timeoutId);
                                        if (!response.ok) throw new Error(`下载失败: ${response.status}`);
                                        const blob = await response.blob();
                                        const url = window.URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.href = url;
                                        link.download = `${record.orderNumber}.psd`;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        window.URL.revokeObjectURL(url);
                                        showToast('PSD文件下载成功', 'success');
                                      } catch (error: unknown) {
                                        if (error instanceof Error && error.name === 'AbortError') {
                                          showToast('下载超时，请重试', 'error');
                                        } else {
                                          showToast(`下载失败: ${error instanceof Error ? error.message : '请重试'}`, 'error');
                                        }
                                      }
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                                  >
                                    下载
                                  </button>
                                ) : (
                                  <span className="text-xs text-white/60">-</span>
                                )}
                              </td>

                              {/* Time */}
                              <td className="px-4 py-3">
                                <span className="text-xs text-white/60 whitespace-nowrap">
                                  {formatTime(record.createdAt)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {hasMore && records.length > 0 && (
                    <div className="text-center py-3 border-t border-white/10 flex-shrink-0">
                      <button
                        onClick={handleLoadMore}
                        disabled={loading}
                        className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {loading ? '加载中...' : '加载更多'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Image preview modal */}
          {previewImages.length > 0 && (
            <div
              className="fixed inset-0 z-50 flex flex-col items-center justify-center p-8"
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.9)' }}
              onClick={() => {
                setPreviewImages([]);
                setPreviewIndex(0);
              }}
            >
              <div className="text-white/80 mb-4 text-sm">
                图片 {previewIndex + 1} / {previewImages.length}
              </div>
              <div className="relative w-full max-w-5xl h-full max-h-[80vh] flex items-center justify-center">
                {previewImages.length > 1 && previewIndex > 0 && (
                  <button
                    className="absolute left-4 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewIndex(prev => Math.max(0, prev - 1));
                    }}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                <img
                  src={previewImages[previewIndex]}
                  alt={`预览 ${previewIndex + 1}`}
                  className="max-w-full max-h-full object-contain"
                />

                {previewImages.length > 1 && previewIndex < previewImages.length - 1 && (
                  <button
                    className="absolute right-4 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewIndex(prev => Math.min(previewImages.length - 1, prev + 1));
                    }}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>

              {previewImages.length > 1 && (
                <div className="flex gap-2 mt-4 overflow-x-auto max-w-full">
                  {previewImages.map((img, idx) => (
                    <button
                      key={idx}
                      className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                        idx === previewIndex ? 'border-white' : 'border-transparent hover:border-white/30'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewIndex(idx);
                      }}
                    >
                      <img src={img} alt={`缩略图 ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Edit modal */}
          {editModal.open && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-8"
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
            >
              <div className="bg-black border border-white/20 rounded-2xl p-6 max-w-md w-full shadow-xl">
                <h2 className="text-lg font-bold mb-4">
                  {editModal.type === 'points' ? '修改积分' : '修改头像'}
                </h2>

                {editModal.type === 'points' ? (
                  <div className="mb-6">
                    <label className="block text-white/60 text-sm mb-2">积分数值</label>
                    <input
                      type="number"
                      min="0"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                    />
                    <p className="text-white/60 text-xs mt-2">当前积分: {editModal.currentData}</p>
                  </div>
                ) : (
                  <div className="mb-6">
                    <label className="block text-white/60 text-sm mb-2">头像URL</label>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder="输入图片URL"
                      className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                    />
                    {editModal.currentData && (
                      <div className="mt-4">
                        <p className="text-white/60 text-xs mb-2">当前头像:</p>
                        <img
                          src={editModal.currentData}
                          alt="当前头像"
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={closeEditModal}
                    className="px-4 py-2 border border-white/10 rounded-lg text-sm hover:bg-white/20 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Detail modal */}
          {detailModal.open && detailModal.record && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-8"
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
              onClick={() => setDetailModal({ open: false, record: null })}
            >
              <div className="bg-black border border-white/20 rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-5">
                  <h2 className="text-lg font-bold">订单详情</h2>
                  <button
                    onClick={() => setDetailModal({ open: false, record: null })}
                    className="text-white/60 hover:text-white transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Order number */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-0.5">订单号</label>
                    <div className="text-sm font-mono">{detailModal.record.orderNumber}</div>
                  </div>

                  {/* User */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-1">用户</label>
                    <div className="flex items-center gap-2.5">
                      <img
                        src={detailModal.record.userAvatar || '/images/avatar.png'}
                        alt={detailModal.record.username}
                        className="w-7 h-7 rounded-full object-cover"
                      />
                      <span className="text-sm">{detailModal.record.username}</span>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-0.5">状态</label>
                    <div>{getStatusBadge(detailModal.record.status)}</div>
                  </div>

                  {/* Type */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-0.5">类型</label>
                    <span className="text-sm">{detailModal.record.toolPage}</span>
                  </div>

                  {/* Prompt */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-0.5">提示词</label>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm whitespace-pre-wrap break-words flex-1">
                      {detailModal.record.prompt || detailModal.record.description || '-'}
                    </div>
                  </div>

                  {/* Points */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-0.5">积分</label>
                    <div className="text-sm">
                      <span className="font-medium">{detailModal.record.actualPoints > 0 ? detailModal.record.actualPoints : 0}</span>
                      {detailModal.record.points !== detailModal.record.actualPoints && detailModal.record.status === '成功' && (
                        <span className="text-white/60 ml-2">预估: {detailModal.record.points}</span>
                      )}
                    </div>
                  </div>

                  {/* Request params */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-0.5">请求参数</label>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm overflow-auto max-h-40 flex-1">
                      <pre className="text-xs">{JSON.stringify(detailModal.record.requestParams, null, 2)}</pre>
                    </div>
                  </div>

                  {/* Result data */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-0.5">结果数据</label>
                    {detailModal.record.resultData ? (
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm overflow-auto max-h-40 flex-1">
                        <pre className="text-xs">{JSON.stringify(detailModal.record.resultData, null, 2)}</pre>
                      </div>
                    ) : (
                      <div className="text-white/60 text-sm">无</div>
                    )}
                  </div>

                  {/* Error reason */}
                  {detailModal.record.status === '失败' && (
                    <div className="flex items-start gap-4">
                      <label className="text-red-600 text-sm w-20 flex-shrink-0 pt-0.5">失败原因</label>
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-600 text-sm flex-1">
                        {typeof detailModal.record.resultData === 'string'
                          ? detailModal.record.resultData
                          : detailModal.record.resultData?.error ||
                            detailModal.record.resultData?.message ||
                            detailModal.record.resultData?.debug?.error ||
                            '未知错误'}
                      </div>
                    </div>
                  )}

                  {/* Time */}
                  <div className="flex items-start gap-4">
                    <label className="text-white/60 text-sm w-20 flex-shrink-0 pt-0.5">创建时间</label>
                    <div className="text-sm">{new Date(detailModal.record.createdAt).toLocaleString('zh-CN')}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </>
  );
}
