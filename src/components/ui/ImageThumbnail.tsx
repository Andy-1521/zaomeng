/**
 * 图片缩略图组件
 * 支持懒加载、占位图、加载状态、错误处理
 * 解决问题：
 * 1. 图片加载慢 - 只加载缩略图
 * 2. 内存占用高 - 懒加载机制
 * 3. 体验不佳 - 加载状态和错误处理
 */

'use client';

import { useState, useRef, useEffect } from 'react';

interface ImageThumbnailProps {
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  onClick?: () => void;
  placeholder?: string;
  thumbnailSize?: 'small' | 'medium' | 'large';
  onLoad?: () => void; // 图片加载成功回调
}

const THUMBNAIL_SIZES = {
  small: { width: 80, height: 80 },
  medium: { width: 200, height: 200 },
  large: { width: 400, height: 400 },
};

export function ImageThumbnail({
  src,
  alt = '图片',
  width,
  height,
  className = '',
  onClick,
  placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect width="200" height="200" fill="%23f0f0f0"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23999"%3E加载中...%3C/text%3E%3C/svg%3E',
  thumbnailSize = 'medium',
  onLoad,
}: ImageThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [inView, setInView] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // 使用Intersection Observer实现懒加载
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '50px',
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  // 超时检测：如果图片超过10秒没有加载完成，显示错误状态
  useEffect(() => {
    if (inView && !loaded && !error && src) {
      const timeoutId = setTimeout(() => {
        console.warn('[ImageThumbnail] 图片加载超时:', src.substring(0, 80));
        setLoadingTimeout(true);
        setError(true);
      }, 10000); // 10秒超时

      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [inView, loaded, error, src]);

  // 直接使用原图URL
  // 注意：Coze对象存储不支持图片处理参数，如需缩略图需要后端生成
  const thumbnailUrl = inView ? src : undefined;
  const displayWidth = width || THUMBNAIL_SIZES[thumbnailSize].width;
  const displayHeight = height || THUMBNAIL_SIZES[thumbnailSize].height;

  if (!src) {
    return (
      <div
        className={`bg-gray-100 flex items-center justify-center ${className}`}
        style={{ width: displayWidth, height: displayHeight }}
      >
        <svg
          className="w-8 h-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      ref={imgRef}
      className={`relative overflow-hidden bg-gray-100 ${className}`}
      style={{ width: displayWidth, height: displayHeight }}
      onClick={onClick}
    >
      {/* 占位图 */}
      {!loaded && !error && (
        <img
          src={placeholder}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* 实际图片 */}
      {inView && !error && (
        <img
          src={thumbnailUrl}
          alt={alt}
          loading="lazy"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => {
            setLoaded(true);
            setError(false);
            setLoadingTimeout(false);
            onLoad?.();
          }}
          onError={() => {
            setError(true);
            setLoaded(false);
            setLoadingTimeout(false);
          }}
        />
      )}

      {/* 错误状态 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}

      {/* 加载状态 */}
      {!loaded && !error && inView && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/10">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
