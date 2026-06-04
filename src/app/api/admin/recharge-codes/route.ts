import { NextRequest, NextResponse } from 'next/server';
import { calculateRechargePoints } from '@/lib/recharge';
import { rechargeCodeManager, userManager } from '@/storage/database';
import { getCookieUser } from '@/lib/serverAuth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

async function getAdminUser(request: NextRequest) {
  const currentUser = getCookieUser(request);
  if (!currentUser?.id) return null;

  const adminUser = await userManager.getUserById(currentUser.id);
  return adminUser?.isAdmin ? adminUser : null;
}

export async function GET(request: NextRequest) {
  try {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return NextResponse.json({ success: false, message: '无权限访问' }, { status: 403 });
    }

    const records = await rechargeCodeManager.listCodes(200);
    return NextResponse.json({ success: true, data: records });
  } catch (error: unknown) {
    console.error('[Admin] 加载兑换码失败:', error);
    return NextResponse.json(
      { success: false, message: `加载兑换码失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return NextResponse.json({ success: false, message: '无权限操作' }, { status: 403 });
    }

    const body = await request.json();
    const amountYuan = Number(body.amountYuan);

    if (!Number.isInteger(amountYuan) || amountYuan < 1 || amountYuan > 5000) {
      return NextResponse.json({ success: false, message: '充值额度需为 1 - 5000 元的整数' }, { status: 400 });
    }

    const points = calculateRechargePoints(amountYuan);
    const record = await rechargeCodeManager.createCode({
      amountYuan,
      points,
      createdBy: adminUser.id,
    });

    console.log(`[Admin] ${adminUser.username}(${adminUser.id}) 生成兑换码 ${record.code}，额度 ${amountYuan} 元 / ${points} 积分`);

    return NextResponse.json({
      success: true,
      message: '兑换码已生成',
      data: record,
    });
  } catch (error: unknown) {
    console.error('[Admin] 创建兑换码失败:', error);
    return NextResponse.json(
      { success: false, message: `创建兑换码失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return NextResponse.json({ success: false, message: '无权限操作' }, { status: 403 });
    }

    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const action = typeof body.action === 'string' ? body.action : '';

    if (!id || action !== 'void') {
      return NextResponse.json({ success: false, message: '缺少有效的兑换码操作' }, { status: 400 });
    }

    const record = await rechargeCodeManager.voidCode({
      id,
      adminUserId: adminUser.id,
    });

    return NextResponse.json({
      success: true,
      message: '兑换码已作废',
      data: record,
    });
  } catch (error: unknown) {
    console.error('[Admin] 作废兑换码失败:', error);
    return NextResponse.json(
      { success: false, message: `作废兑换码失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
