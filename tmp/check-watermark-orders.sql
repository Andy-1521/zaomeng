-- 查询最近的去水印订单
SELECT
    order_number,
    status,
    result_data,
    request_params,
    remaining_points,
    created_at
FROM transactions
WHERE tool_page = '去除水印'
ORDER BY created_at DESC
LIMIT 10;
