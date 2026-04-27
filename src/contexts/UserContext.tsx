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
  refreshUser: () => void;
  logout: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化：从 localStorage 读取
  useEffect(() => {
    let nextUser: User | null = null;
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        nextUser = JSON.parse(userData) as User;
      } catch {
        localStorage.removeItem('user');
      }
    }

    queueMicrotask(() => {
      setUserState(nextUser);
      setIsLoading(false);
    });
  }, []);

  // 监听 taskEventHandler 发出的积分变更事件
  useEffect(() => {
    const handlePointsChanged = (e: Event) => {
      const { points } = (e as CustomEvent).detail;
      if (typeof points === 'number') {
        setUserState(prev => {
          if (!prev) return prev;
          return { ...prev, points };
        });
      }
    };
    window.addEventListener('userPointsChanged', handlePointsChanged);
    return () => window.removeEventListener('userPointsChanged', handlePointsChanged);
  }, []);

  const setUser = useCallback((newUser: User | null) => {
    setUserState(newUser);
    if (newUser) {
      localStorage.setItem('user', JSON.stringify(newUser));
    } else {
      localStorage.removeItem('user');
    }
  }, []);

  const updatePoints = useCallback((delta: number) => {
    setUserState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, points: (prev.points || 0) + delta };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const setPoints = useCallback((absolutePoints: number) => {
    setUserState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, points: absolutePoints };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const refreshUser = useCallback(async () => {
    // Read userId from localStorage to avoid stale closure
    const userData = localStorage.getItem('user');
    if (!userData) return;
    let userId: string;
    try {
      userId = JSON.parse(userData).id;
    } catch {
      return;
    }
    if (!userId) return;

    try {
      const response = await fetch(`/api/user/profile?userId=${encodeURIComponent(userId)}`, {
        method: 'GET',
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success && data.data) {
        setUserState(prev => {
          if (!prev) return data.data;
          const updated = { ...prev, ...data.data };
          localStorage.setItem('user', JSON.stringify(updated));
          return updated;
        });
      }
    } catch (error) {
      console.error('[UserContext] 刷新用户信息失败:', error);
    }
  }, []);

  const logout = useCallback(() => {
    setUserState(null);
    localStorage.removeItem('user');
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
