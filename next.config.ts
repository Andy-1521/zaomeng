import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 设置 API 路由的 body 大小限制
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
