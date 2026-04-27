import { NextRequest, NextResponse } from 'next/server';
import { transactionManager, userManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

type ResultDataObject = {
  imageUrl?: string;
  image_url?: string;
  result_image_url?: string;
  [key: string]: unknown;
};

/**
 * 获取用户消费记录接口
 *
 * 功能说明：
 * - 根据 userId 获取用户的消费记录
 * - 支持多种获取用户ID的方式：cookie、查询参数、请求体
 * - 返回订单编号、工具页、消费积分、剩余积分、消费时间、提示词、请求参数、结果数据等信息
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');
    let userId = requestedUserId;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const cursor = searchParams.get('cursor'); // 游标分页：上一页最后一条的 createdAt
    let cookieUserId: string | null = null;

    // 如果未传 userId，从 cookie 获取用户信息
    const userCookie = request.cookies.get('user');
    if (userCookie) {
      try {
        const userData = JSON.parse(userCookie.value);
        if (typeof userData.id === 'string' && userData.id) {
          cookieUserId = userData.id;
          if (!userId) {
            userId = userData.id;
          }
        }
      } catch (e) {
        console.error('[API/Transactions] 解析 user cookie 失败:', e);
      }
    }

    // 如果还是没有 userId，尝试从请求头中获取（备用方案）
    if (!userId) {
      const headerUserId = request.headers.get('x-user-id');
      if (headerUserId) {
        userId = headerUserId;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, message: '用户ID不能为空' },
        { status: 401 }
      );
    }

    if (requestedUserId && !cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    if (requestedUserId && cookieUserId && requestedUserId !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权限访问其他用户的消费记录' },
        { status: 403 }
      );
    }

    // 获取用户消费记录（支持游标分页）
    const transactions = await transactionManager.getUserTransactions(userId, limit, cursor);

    // 格式化返回数据 - 一次性解析，避免前端重复解析
    const formattedTransactions = transactions.map(trans => {
      // 解析 resultData（可能是 JSON 字符串，也可能是普通字符串）
      let resultData: unknown = null;
      if (trans.resultData) {
        try {
          const parsed: unknown = JSON.parse(trans.resultData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            resultData = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            const parsedObject = parsed as ResultDataObject;
            resultData = parsedObject.imageUrl || parsedObject.image_url || parsedObject.result_image_url || parsedObject;
          } else {
            resultData = parsed;
          }
        } catch {
          resultData = trans.resultData;
        }
      }

      // 解析 requestParams（JSON 字符串）
      let requestParams = null;
      try {
        requestParams = trans.requestParams ? JSON.parse(trans.requestParams) : null;
      } catch {
        // 忽略解析失败
      }

      return {
        id: trans.id,
        orderNumber: trans.orderNumber,
        description: trans.description || trans.toolPage || '未知',
        points: trans.points || 0,
        actualPoints: trans.actualPoints ?? 0,
        remainingPoints: trans.remainingPoints || 0,
        time: trans.createdAt,
        status: trans.status || '未知',
        prompt: trans.prompt || '',
        requestParams,
        resultData,
        psdUrl: trans.psdUrl || '',
      };
    });

    // 返回数据 + 分页游标
    const lastItem = transactions[transactions.length - 1];
    const nextCursor = transactions.length >= limit && lastItem?.createdAt
      ? lastItem.createdAt
      : null;

    return NextResponse.json({
      success: true,
      data: formattedTransactions,
      nextCursor,
    });
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    console.error('[API/Transactions] 请求失败:', errorMessage);
    return NextResponse.json(
      { success: false, message: `获取消费记录失败: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * 创建消费记录接口
 *
 * 功能说明：
 * - 扣除用户积分
 * - 创建消费记录到数据库
 * - 支持记录提示词、请求参数、结果数据
 * - 返回消费后的积分余额
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      userId,
      description,
      points,
      toolPage = '彩绘提取',
      prompt = '',
      requestParams = '',
      resultData = '',
      status = '成功'
    } = body;

    if (!userId || !description || !points) {
      return NextResponse.json(
        { success: false, message: '用户ID、消费描述和消费积分不能为空' },
        { status: 400 }
      );
    }

    if (points <= 0) {
      return NextResponse.json(
        { success: false, message: '消费积分必须大于0' },
        { status: 400 }
      );
    }

    // 检查用户是否存在
    const user = await userManager.getUserById(userId);

    if (!user) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    const currentPoints = user.points || 0;

    // 检查积分是否足够
    if (currentPoints < points) {
      return NextResponse.json(
        { success: false, message: '积分不足' },
        { status: 400 }
      );
    }

    const updatedUser = await userManager.deductPointsAtomically(userId, points);

    if (!updatedUser) {
      return NextResponse.json(
        { success: false, message: '积分不足' },
        { status: 400 }
      );
    }

    const remainingPoints = updatedUser.points || 0;

    // 创建消费记录（包含提示词、请求参数、结果数据）
    await transactionManager.createTransaction({
      userId,
      orderNumber: transactionManager.generateOrderNumber(),
      toolPage,
      description,
      points,
      remainingPoints,
      status,
      prompt,
      requestParams,
      resultData,
    });

    return NextResponse.json({
      success: true,
      message: '积分扣除成功',
      data: {
        description,
        points,
        remainingPoints,
      },
    });
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    console.error('扣除积分失败:', error);
    return NextResponse.json(
      { success: false, message: `扣除积分失败: ${errorMessage}` },
      { status: 500 }
    );
  }
}
