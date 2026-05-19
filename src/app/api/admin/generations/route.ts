import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { userManager } from '@/storage/database';

type GenerationFilters = {
  toolPage?: string;
  toolPages?: string[];
  status?: string;
  diagnostic?: string;
  startDate?: Date;
  endDate?: Date;
  includeUserIds?: string[];
  excludeSubOrders?: boolean;
};

function mapToolFilter(toolFilter: string): string[] {
  if (toolFilter === '彩绘提取') return ['彩绘提取', '彩绘提取2'];
  if (toolFilter === 'AI生图') return ['AI生图', 'AI生图（图生图）'];
  if (toolFilter === '智能改图') return ['智能改图', '局部改图'];
  if (toolFilter === '去除水印') return ['去除水印', '去水印'];
  return [toolFilter];
}

/**
 * 获取所有生图记录（管理员接口）- 性能优化版
 *
 * 优化点：
 * 1. 批量查询用户信息（替代N+1查询）
 * 2. 合并统计查询（一次SQL替代5次COUNT）
 * 3. DB层面过滤子订单和关键词（减少数据传输）
 * 4. 去除重复过滤逻辑
 */
export async function GET(request: NextRequest) {
  try {
    const userCookie = request.cookies.get('user');
    let currentUser: { id?: string } | null = null;

    if (userCookie) {
      try {
        currentUser = JSON.parse(userCookie.value);
      } catch (error) {
        console.error('[API] 解析 user cookie 失败:', error);
      }
    }

    if (!currentUser || !currentUser.id) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    // 从数据库重新查询用户完整信息
    const adminUser = await userManager.getUserById(currentUser.id);

    if (!adminUser) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    // 检查是否是管理员
    if (!adminUser.isAdmin) {
      return NextResponse.json(
        { success: false, message: '无权限访问' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const skip = parseInt(searchParams.get('skip') || '0');
    const limit = parseInt(searchParams.get('limit') || '50');

    // 获取筛选参数
    const keyword = searchParams.get('keyword') || '';
    const toolPage = searchParams.get('toolPage') || '';
    const status = searchParams.get('status') || '';
    const diagnostic = searchParams.get('diagnostic') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';

    // 构建基础筛选条件
    const baseFilters: GenerationFilters = {};
    if (toolPage) {
      const mapped = mapToolFilter(toolPage);
      if (mapped.length === 1) {
        baseFilters.toolPage = mapped[0];
      } else {
        baseFilters.toolPages = mapped;
      }
    }
    if (status) baseFilters.status = status;
    if (diagnostic) baseFilters.diagnostic = diagnostic;
    if (startDate) baseFilters.startDate = new Date(startDate);
    if (endDate) baseFilters.endDate = new Date(endDate);

    // 【优化1】如果有关键词搜索，先查匹配的用户ID列表
    let includeUserIds: string[] | undefined;
    if (keyword) {
      includeUserIds = await userManager.searchUserIdsByKeyword(keyword);
      // 如果关键词既不匹配用户名也不匹配订单号，可以提前返回
      // 但我们还需要检查订单号，所以不提前返回
      baseFilters.includeUserIds = includeUserIds.length > 0 ? includeUserIds : undefined;
    }

    // 【优化2】统计查询
    const statsFilters = { ...baseFilters, excludeSubOrders: true };
    const stats = keyword
      ? await transactionManager.getSearchStats(keyword, statsFilters)
      : await transactionManager.getStats(statsFilters);

    // 【优化3】获取记录 - 在DB层面过滤子订单
    const listFilters = { ...baseFilters, excludeSubOrders: true };

    let transactions;
    if (keyword) {
      // 关键词搜索：使用专用搜索方法，在DB层面同时搜索订单号和用户ID
      transactions = await transactionManager.searchByKeyword(keyword, listFilters, limit, skip);
    } else {
      transactions = await transactionManager.getAllTransactions(skip, limit, listFilters);
    }

    // 【优化4】批量查询用户信息（替代N+1查询）
    const userIds = [...new Set(transactions.map(t => t.userId))];
    const userMap = await userManager.getUsersByIds(userIds);

    // 组装返回数据
    const enrichedGenerations = transactions.map((transaction) => {
      const user = userMap.get(transaction.userId);

      // 解析requestParams，提取参考图片
      let uploadedImage: string | undefined;
      let parsedRequestParams: unknown = null;
      try {
        if (transaction.requestParams) {
          const params = JSON.parse(transaction.requestParams);
          parsedRequestParams = params;
          uploadedImage = params.uploadedImage;
        }
      } catch {
        // 解析失败忽略
      }

      // 解析 resultData
      let resultData = null;
      if (transaction.resultData) {
        try {
          const parsed = JSON.parse(transaction.resultData);
          if (Array.isArray(parsed)) {
            resultData = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            resultData = parsed;
          } else {
            resultData = parsed;
          }
        } catch {
          resultData = transaction.resultData;
        }
      }

      return {
        ...transaction,
        username: user?.username || '未知用户',
        userAvatar: user?.avatar || '/images/avatar.png',
        uploadedImage,
        requestParams: parsedRequestParams,
        resultData,
      };
    });

    const finalRecords = enrichedGenerations;

    return NextResponse.json({
      success: true,
      data: {
        total: stats.total,
        records: finalRecords,
        stats,
      },
    });
  } catch (error: unknown) {
    console.error('获取生图记录失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '获取生图记录失败，请稍后重试',
      },
      { status: 500 }
    );
  }
}
