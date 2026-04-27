import { getDb } from '../storage/database/client.ts';
import { transactions } from '../storage/database/shared/schema.ts';
import { eq, desc } from 'drizzle-orm';

async function checkOrders() {
  console.log('========== 开始检查订单数据 ==========');

  const db = await getDb();

  try {
    // 查询最近5个彩绘提取订单
    const orders = await db
      .select()
      .from(transactions)
      .where(eq(transactions.toolPage, '彩绘提取'))
      .orderBy(desc(transactions.createdAt))
      .limit(5);

    console.log(`\n找到 ${orders.length} 个彩绘提取订单:\n`);

    for (const order of orders) {
      console.log(`订单号: ${order.orderNumber}`);
      console.log(`状态: ${order.status}`);
      console.log(`描述: ${order.description}`);
      console.log(`resultData类型: ${typeof order.resultData}`);
      console.log(`resultData值:`);

      if (order.resultData) {
        if (typeof order.resultData === 'string') {
          console.log(`  字符串: ${order.resultData.substring(0, 100)}...`);

          // 尝试解析为JSON
          try {
            const parsed = JSON.parse(order.resultData);
            if (Array.isArray(parsed)) {
              console.log(`  解析为数组，共 ${parsed.length} 张图片`);
              parsed.forEach((url, idx) => {
                console.log(`    图片 ${idx + 1}: ${url.substring(0, 60)}...`);
              });
            } else {
              console.log(`  解析结果不是数组: ${JSON.stringify(parsed)}`);
            }
          } catch (e) {
            console.log(`  无法解析为JSON: ${e.message}`);
          }
        } else if (typeof order.resultData === 'object') {
          console.log(`  对象: ${JSON.stringify(order.resultData)}`);
        }
      } else {
        console.log(`  (null)`);
      }

      console.log(`createdAt: ${order.createdAt}`);
      console.log('---');
    }
  } catch (error) {
    console.error('查询失败:', error);
  }

  process.exit(0);
}

checkOrders();
