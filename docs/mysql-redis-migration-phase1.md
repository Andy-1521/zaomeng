# 造梦AI MySQL / Redis 第一阶段重构记录

## 当前目标

1. 保留现有业务功能主链路。
2. 将用户、订单、认证相关数据库能力迁移到本机 MySQL。
3. 将验证码存储迁移到 Redis。
4. 为后续从 Coze/PostgreSQL 彻底迁移提供基础设施与文档。

## 本机运行环境

- MySQL: `8.0`
- Redis: `7.0`
- MySQL 数据库: `zaomeng_ai`
- MySQL 业务账号: `zaomeng_app@localhost`

## 本阶段已落地内容

- 新增项目内 MySQL Drizzle 客户端：`src/storage/database/client.ts`
- 将 schema 从 `drizzle-orm/pg-core` 切换到 `drizzle-orm/mysql-core`
- 将 `userManager` 与 `transactionManager` 改为面向 MySQL 的实现
- 将验证码存储从进程内 `Map` 切换到 Redis
- 在应用初始化阶段加入 MySQL 表自动初始化
- 将认证与订单查询主链路改为使用项目内数据库客户端

## 环境变量

建议新增：

```env
MYSQL_URL=mysql://zaomeng_app:YOUR_PASSWORD@127.0.0.1:3306/zaomeng_ai
REDIS_URL=redis://127.0.0.1:6379
```

## 下一阶段建议

1. 清理剩余直接依赖 `coze-coding-dev-sdk` 的 `getDb` 调用。
2. 将现有调试/迁移脚本全部改写为 MySQL 方言。
3. 增加 PostgreSQL 到 MySQL 的一次性数据搬迁脚本。
4. 为 Redis 增加通用缓存封装，并把热点缓存逐步迁移过去。
