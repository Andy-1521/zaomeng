'use client';

import { useState, useMemo, useEffect } from 'react';

// 使用种子生成一致的随机值
function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    verifyCode: '',
    newPassword: '',
  });
  const [errors, setErrors] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    verifyCode: '',
    newPassword: '',
  });

  // 确保只在客户端渲染粒子效果
  useEffect(() => {
    setIsClient(true);
  }, []);

  // 生成一致的粒子样式，避免 hydration 错误
  const particleStyles = useMemo(() => {
    if (!isClient) return [];

    return [...Array(80)].map((_, i) => ({
      top: `${seededRandom(i * 1234) * 100}%`,
      left: `${seededRandom(i * 5678) * 100}%`,
      animation: `float ${4 + seededRandom(i * 9012) * 8}s ease-in-out infinite`,
      animationDelay: `${seededRandom(i * 3456) * 4}s`,
      width: `${seededRandom(i * 7890) * 3 + 1}px`,
      height: `${seededRandom(i * 1122) * 3 + 1}px`,
      backgroundColor: i % 4 === 0 ? 'rgba(168, 85, 247, 0.5)' :
                     i % 4 === 1 ? 'rgba(59, 130, 246, 0.5)' :
                     i % 4 === 2 ? 'rgba(236, 72, 153, 0.5)' :
                     'rgba(139, 92, 246, 0.5)',
    }));
  }, [isClient]);

  const starStyles = useMemo(() => {
    if (!isClient) return [];

    return [...Array(30)].map((_, i) => ({
      top: `${seededRandom(i * 9999) * 100}%`,
      left: `${seededRandom(i * 8888) * 100}%`,
      animation: `twinkle ${2 + seededRandom(i * 7777) * 3}s ease-in-out infinite`,
      animationDelay: `${seededRandom(i * 6666) * 2}s`,
    }));
  }, [isClient]);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string) => {
    return password.length >= 6;
  };

  const handleSendCode = async () => {
    if (!validateEmail(formData.email)) {
      setErrors({ ...errors, email: '请先输入有效的邮箱' });
      return;
    }

    setErrors({ ...errors, email: '' });
    setCountdown(60);

    try {
      // 调用发送验证码API
      const response = await fetch('/api/auth/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert('验证码已发送');
      } else {
        alert(result.message || '发送失败');
        setCountdown(0);
      }
    } catch (error) {
      console.error('发送验证码失败:', error);
      // 开发模式下使用模拟验证码
      console.log('开发模式：验证码为 123456');
      alert('开发模式：验证码为 123456');
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    // 实时验证
    if (name === 'email' && value) {
      setErrors({
        ...errors,
        email: validateEmail(value) ? '' : '请输入有效的邮箱地址',
      });
    } else if (name === 'password' && value) {
      setErrors({
        ...errors,
        password: validatePassword(value) ? '' : '密码至少6位',
      });
    } else if (name === 'confirmPassword' && value && formData.password) {
      setErrors({
        ...errors,
        confirmPassword: value === formData.password ? '' : '两次密码不一致',
      });
    } else if (name === 'verifyCode' && value) {
      setErrors({
        ...errors,
        verifyCode: value.length === 6 ? '' : '请输入6位验证码',
      });
    } else if (name === 'newPassword' && value) {
      setErrors({
        ...errors,
        newPassword: validatePassword(value) ? '' : '密码至少6位',
      });
    }
  };

  const handleRegister = async () => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: formData.username,
          email: formData.email,
          password: formData.password,
          verifyCode: formData.verifyCode,
        }),
      });

      const result = await response.json();

      if (result.success) {
        localStorage.setItem('user', JSON.stringify(result.data));
        alert(`注册成功！欢迎${result.data.username}，您已获得 ${result.data.points} 积分！`);
        // 注册成功后跳转到首页
        window.location.href = '/home';
      } else {
        alert(result.message || '注册失败');
      }
    } catch (error) {
      console.error('注册失败:', error);
      alert('注册失败，请稍后重试');
    }
  };

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      const result = await response.json();

      if (result.success) {
        localStorage.setItem('user', JSON.stringify(result.data));
        alert(`登录成功！欢迎回来，${result.data.username}`);
        // 登录成功后跳转到首页
        window.location.href = '/home';
      } else {
        alert(result.message || '登录失败');
      }
    } catch (error) {
      console.error('登录失败:', error);
      alert('登录失败，请稍后重试');
    }
  };

  const handleResetPassword = async () => {
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          verifyCode: formData.verifyCode,
          newPassword: formData.newPassword,
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert('密码重置成功，请使用新密码登录');
        setMode('login');
        setFormData({ email: '', username: '', password: '', confirmPassword: '', verifyCode: '', newPassword: '' });
      } else {
        alert(result.message || '密码重置失败');
      }
    } catch (error) {
      console.error('密码重置失败:', error);
      alert('密码重置失败，请稍后重试');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let newErrors;

    if (mode === 'login') {
      newErrors = {
        email: formData.email ? (validateEmail(formData.email) ? '' : '请输入有效的邮箱地址') : '请输入邮箱',
        password: formData.password ? (validatePassword(formData.password) ? '' : '密码至少6位') : '请输入密码',
        username: '',
        confirmPassword: '',
        verifyCode: '',
        newPassword: '',
      };
    } else if (mode === 'register') {
      newErrors = {
        email: formData.email ? (validateEmail(formData.email) ? '' : '请输入有效的邮箱地址') : '请输入邮箱',
        username: formData.username ? '' : '请输入用户名',
        password: formData.password ? (validatePassword(formData.password) ? '' : '密码至少6位') : '请输入密码',
        confirmPassword: formData.confirmPassword ? (formData.confirmPassword === formData.password ? '' : '两次密码不一致') : '请确认密码',
        verifyCode: formData.verifyCode ? (formData.verifyCode.length === 6 ? '' : '请输入6位验证码') : '请输入验证码',
        newPassword: '',
      };
    } else {
      newErrors = {
        email: formData.email ? (validateEmail(formData.email) ? '' : '请输入有效的邮箱地址') : '请输入邮箱',
        verifyCode: formData.verifyCode ? (formData.verifyCode.length === 6 ? '' : '请输入6位验证码') : '请输入验证码',
        newPassword: formData.newPassword ? (validatePassword(formData.newPassword) ? '' : '密码至少6位') : '请输入新密码',
        username: '',
        password: '',
        confirmPassword: '',
      };
    }

    setErrors(newErrors);

    const hasErrors = Object.values(newErrors).some(error => error !== '');
    if (hasErrors) {
      return;
    }

    setLoading(true);

    if (mode === 'login') {
      await handleLogin();
    } else if (mode === 'register') {
      await handleRegister();
    } else {
      await handleResetPassword();
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black relative overflow-hidden">
      {/* 动态背景层 */}
      <div className="absolute inset-0">
        {/* 基础黑色渐变 */}
        <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-900 to-black" />

        {/* 梦幻紫色和蓝色光晕 - 更大更柔和 */}
        <div className="absolute top-1/4 left-1/4 w-[800px] h-[800px] bg-purple-600/12 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[700px] h-[700px] bg-blue-600/12 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-indigo-600/8 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2.5s' }} />

        {/* 梦幻星云效果 */}
        <div className="absolute top-20 right-20 w-96 h-96 bg-gradient-to-br from-purple-500/10 via-pink-500/10 to-blue-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-20 left-20 w-96 h-96 bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-purple-500/10 rounded-full blur-[100px]" />

        {/* 科技感网格线 - 更细腻 */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0" style={{
            backgroundImage: `
              linear-gradient(rgba(147, 51, 234, 0.2) 1px, transparent 1px),
              linear-gradient(90deg, rgba(147, 51, 234, 0.2) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px'
          }} />
        </div>

        {/* 更多梦幻粒子 - 增加到80个 */}
        {particleStyles.map((style, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={style}
          />
        ))}

        {/* 梦幻光点呼吸效果 */}
        <div className="absolute top-1/3 right-1/3 w-4 h-4 bg-purple-400 rounded-full animate-ping opacity-30" />
        <div className="absolute bottom-1/4 left-1/3 w-3 h-3 bg-blue-400 rounded-full animate-ping opacity-30" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-2/3 left-1/4 w-3 h-3 bg-pink-400 rounded-full animate-ping opacity-30" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/4 left-2/3 w-3 h-3 bg-indigo-400 rounded-full animate-ping opacity-30" style={{ animationDelay: '1.5s' }} />
        <div className="absolute bottom-1/3 right-1/4 w-3 h-3 bg-cyan-400 rounded-full animate-ping opacity-30" style={{ animationDelay: '2s' }} />

        {/* 星星闪烁效果 - 增加到30个 */}
        {starStyles.map((style, i) => (
          <div
            key={`star-${i}`}
            className="absolute"
            style={style}
          >
            <div className="w-1 h-1 bg-white rounded-full" />
          </div>
        ))}

        {/* 光束效果 */}
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-radial from-purple-900/10 via-transparent to-transparent" />
        <div className="absolute top-1/2 left-0 w-80 h-80 bg-gradient-to-r from-purple-600/8 to-transparent blur-3xl" />
        <div className="absolute top-1/2 right-0 w-80 h-80 bg-gradient-to-l from-blue-600/8 to-transparent blur-3xl" />
      </div>

      {/* 主内容区 */}
      <div className="relative z-10 w-full max-w-md px-6">
        {/* 深色玻璃态卡片 - 更白更通透 */}
        <div className="bg-white/10 backdrop-blur-2xl rounded-2xl p-8 border border-white/20 shadow-2xl">
          {/* Logo和标题 */}
          <div className="text-center mb-8">
            <div className="inline-block mb-4">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-600 via-purple-700 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30 overflow-hidden">
                <img src="/images/avatar.png" alt="造梦AI" className="w-full h-full object-cover" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              造梦Ai
            </h1>
            <p className="text-neutral-400 text-sm">
              {mode === 'login' ? '欢迎回来，继续创作' : mode === 'register' ? '开启你的AI创作之旅' : '重置密码'}
            </p>
          </div>

          {/* 切换标签 */}
          {mode !== 'reset' && (
            <div className="flex mb-6 bg-white/10 rounded-lg p-1 border border-white/20">
              <button
                onClick={() => setMode('login')}
                className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${
                  mode === 'login'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/30'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                登录
              </button>
              <button
                onClick={() => setMode('register')}
                className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${
                  mode === 'register'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/30'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                注册
              </button>
            </div>
          )}

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 邮箱 */}
            <div>
              <label className="block text-neutral-400 text-sm mb-1.5">邮箱</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="请输入邮箱"
                disabled={loading}
                className={`w-full px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  errors.email ? 'border-red-500/60' : ''
                }`}
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>

            {/* 用户名（仅注册时显示） */}
            {mode === 'register' && (
              <div>
                <label className="block text-neutral-400 text-sm mb-1.5">用户名</label>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  placeholder="请输入用户名"
                  disabled={loading}
                  className={`w-full px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    errors.username ? 'border-red-500/60' : ''
                  }`}
                />
                {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
              </div>
            )}

            {/* 密码（登录和注册时显示） */}
            {mode !== 'reset' && (
              <div>
                <label className="block text-neutral-400 text-sm mb-1.5">密码</label>
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="请输入密码（至少6位）"
                  disabled={loading}
                  className={`w-full px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    errors.password ? 'border-red-500/60' : ''
                  }`}
                />
                {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
              </div>
            )}

            {/* 确认密码（仅注册时显示） */}
            {mode === 'register' && (
              <div>
                <label className="block text-neutral-400 text-sm mb-1.5">确认密码</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  placeholder="请再次输入密码"
                  disabled={loading}
                  className={`w-full px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    errors.confirmPassword ? 'border-red-500/60' : ''
                  }`}
                />
                {errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{errors.confirmPassword}</p>}
              </div>
            )}

            {/* 新密码（仅找回密码时显示） */}
            {mode === 'reset' && (
              <div>
                <label className="block text-neutral-400 text-sm mb-1.5">新密码</label>
                <input
                  type="password"
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleInputChange}
                  placeholder="请输入新密码（至少6位）"
                  disabled={loading}
                  className={`w-full px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    errors.newPassword ? 'border-red-500/60' : ''
                  }`}
                />
                {errors.newPassword && <p className="text-red-500 text-xs mt-1">{errors.newPassword}</p>}
              </div>
            )}

            {/* 邮箱验证码（注册和找回密码时显示） */}
            {mode !== 'login' && (
              <div>
                <label className="block text-neutral-400 text-sm mb-1.5">邮箱验证码</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="verifyCode"
                    value={formData.verifyCode}
                    onChange={handleInputChange}
                    placeholder="请输入6位验证码"
                    maxLength={6}
                    disabled={loading}
                    className={`flex-1 px-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      errors.verifyCode ? 'border-red-500/60' : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={countdown > 0 || !validateEmail(formData.email) || loading}
                    className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium rounded-lg disabled:from-neutral-700 disabled:to-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed hover:from-purple-700 hover:to-blue-700 transition-all duration-300 whitespace-nowrap min-w-[100px] shadow-lg shadow-purple-500/20"
                  >
                    {countdown > 0 ? `${countdown}s` : '获取验证码'}
                  </button>
                </div>
                {errors.verifyCode && <p className="text-red-500 text-xs mt-1">{errors.verifyCode}</p>}
              </div>
            )}

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all duration-300 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '处理中...' : (mode === 'login' ? '登录' : mode === 'register' ? '注册' : '重置密码')}
            </button>
          </form>

          {/* 底部提示 */}
          <div className="mt-6 pt-5 border-t border-white/20">
            {mode === 'login' && (
              <>
                <p className="text-center text-neutral-500 text-sm mb-2">
                  还没有账号？
                  <button
                    onClick={() => setMode('register')}
                    disabled={loading}
                    className="text-purple-400 font-medium ml-1 hover:text-purple-300 transition-colors disabled:opacity-50"
                  >
                    立即注册
                  </button>
                </p>
                <p className="text-center text-neutral-500 text-sm">
                  忘记密码？
                  <button
                    onClick={() => setMode('reset')}
                    disabled={loading}
                    className="text-purple-400 font-medium ml-1 hover:text-purple-300 transition-colors disabled:opacity-50"
                  >
                    找回密码
                  </button>
                </p>
              </>
            )}
            {(mode === 'register' || mode === 'reset') && (
              <p className="text-center text-neutral-500 text-sm">
                {mode === 'register' ? '已有账号？' : '记起密码了？'}
                <button
                  onClick={() => setMode('login')}
                  disabled={loading}
                  className="text-purple-400 font-medium ml-1 hover:text-purple-300 transition-colors disabled:opacity-50"
                >
                  立即登录
                </button>
              </p>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) translateX(0px); opacity: 0.4; }
          25% { transform: translateY(-30px) translateX(15px); opacity: 0.7; }
          50% { transform: translateY(-15px) translateX(-10px); opacity: 0.5; }
          75% { transform: translateY(-40px) translateX(10px); opacity: 0.6; }
        }

        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.8); }
        }

        .bg-gradient-radial {
          background: radial-gradient(circle at 50% 50%, transparent, transparent);
        }
      `}</style>
    </div>
  );
}
