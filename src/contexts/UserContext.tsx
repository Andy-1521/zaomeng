'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  avatar?: string;
  points: number;
  isAdmin?: boolean;
  createTime?: number;
  createdAt?: string;
}

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  updatePoints: (delta: number) => void;
  setPoints: (absolutePoints: number) => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

async function parseJsonApiResponse<T>(response: Response): Promise<T | null> {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function readCachedUser() {
  const userData = localStorage.getItem('user');
  if (!userData) return null;

  try {
    const parsed = JSON.parse(userData) as Partial<User>;
    return typeof parsed.id === 'string' && parsed.id.trim() ? parsed : null;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
}

function clearCachedUser() {
  localStorage.removeItem('user');
}

function writeCachedUser(nextUser: User) {
  localStorage.setItem('user', JSON.stringify(nextUser));
}

async function fetchCurrentUser() {
  const response = await fetch('/api/user/profile', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await parseJsonApiResponse<{ success?: boolean; data?: User }>(response);

  return {
    response,
    user: response.ok && data?.success ? data.data || null : null,
  };
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化必须以服务端签名 Cookie 为准；localStorage 只做展示缓存，不能作为登录凭据。
  useEffect(() => {
    let cancelled = false;

    const validateStoredSession = async () => {
      readCachedUser();

      try {
        const { user: verifiedUser } = await fetchCurrentUser();
        if (cancelled) return;

        if (verifiedUser?.id) {
          setUserState(verifiedUser);
          writeCachedUser(verifiedUser);
        } else {
          setUserState(null);
          clearCachedUser();
        }
      } catch (error) {
        console.error('[UserContext] 校验登录态失败:', error);
        if (!cancelled) {
          setUserState(null);
          clearCachedUser();
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void validateStoredSession();

    return () => {
      cancelled = true;
    };
  }, []);

  // 监听 taskEventHandler 发出的积分变更事件
  useEffect(() => {
    const handlePointsChanged = (e: Event) => {
      const { points } = (e as CustomEvent).detail;
      if (typeof points === 'number') {
        setUserState(prev => {
          if (!prev) return prev;
          const updated = { ...prev, points };
          writeCachedUser(updated);
          return updated;
        });
      }
    };
    window.addEventListener('userPointsChanged', handlePointsChanged);
    return () => window.removeEventListener('userPointsChanged', handlePointsChanged);
  }, []);

  const setUser = useCallback((newUser: User | null) => {
    setUserState(newUser);
    if (newUser) {
      writeCachedUser(newUser);
    } else {
      clearCachedUser();
    }
  }, []);

  const updatePoints = useCallback((delta: number) => {
    setUserState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, points: (prev.points || 0) + delta };
      writeCachedUser(updated);
      return updated;
    });
  }, []);

  const setPoints = useCallback((absolutePoints: number) => {
    setUserState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, points: absolutePoints };
      writeCachedUser(updated);
      return updated;
    });
  }, []);

  const refreshUser = useCallback(async () => {
    readCachedUser();

    try {
      const { response, user: refreshedUser } = await fetchCurrentUser();
      if (refreshedUser?.id) {
        setUserState(prev => {
          const updated = prev ? { ...prev, ...refreshedUser } : refreshedUser;
          const hasChanged = !prev ||
            updated.id !== prev.id ||
            updated.username !== prev.username ||
            updated.email !== prev.email ||
            updated.phone !== prev.phone ||
            updated.avatar !== prev.avatar ||
            updated.points !== prev.points ||
            updated.isAdmin !== prev.isAdmin;

          if (!hasChanged) return prev;

          writeCachedUser(updated);
          return updated;
        });
        return;
      }

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        setUserState(null);
        clearCachedUser();
      }
    } catch (error) {
      console.error('[UserContext] 刷新用户信息失败:', error);
    }
  }, []);

  const logout = useCallback(async () => {
    setUserState(null);
    clearCachedUser();

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('[UserContext] 退出登录失败:', error);
    }
  }, []);

  return (
    <UserContext.Provider value={{ user, isLoading, setUser, updatePoints, setPoints, refreshUser, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
