import { createHash } from 'crypto';
import { getMysqlPool } from '@/storage/database';

function getStorageLockName(scope: string, userId: string, key: string) {
  const digest = createHash('sha1').update(`${scope}:${userId}:${key}`).digest('hex').slice(0, 32);
  return `zm:${scope}:${digest}`;
}

export async function withStorageKeyLock<T>(
  scope: string,
  userId: string,
  key: string,
  callback: () => Promise<T>
): Promise<T> {
  const pool = await getMysqlPool();
  const connection = await pool.getConnection();
  const lockName = getStorageLockName(scope, userId, key);

  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 10) AS locked', [lockName]);
    const locked = Array.isArray(lockRows) && Number((lockRows[0] as { locked?: number })?.locked) === 1;
    if (!locked) {
      throw new Error('素材入库正在处理中，请稍后重试');
    }

    return await callback();
  } finally {
    try {
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } finally {
      connection.release();
    }
  }
}
