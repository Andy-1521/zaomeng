import { randomBytes, randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { RECHARGE_TOOL_PAGE } from "@/lib/recharge";
import { getMysqlPool } from "./client";

export type RechargeCodeStatus = "unused" | "redeemed" | "voided";

export type RechargeCodeRecord = {
  id: string;
  code: string;
  amountYuan: number;
  points: number;
  status: RechargeCodeStatus;
  createdBy: string;
  createdByName: string | null;
  redeemedBy: string | null;
  redeemedByName: string | null;
  redeemedByEmail: string | null;
  transactionId: string | null;
  createdAt: string;
  redeemedAt: string | null;
};

type RechargeCodeRow = RowDataPacket & {
  id: string;
  code: string;
  amount_yuan: number;
  points: number;
  status: RechargeCodeStatus;
  created_by: string;
  created_by_name: string | null;
  redeemed_by: string | null;
  redeemed_by_name: string | null;
  redeemed_by_email: string | null;
  transaction_id: string | null;
  created_at: string;
  redeemed_at: string | null;
};

function mapRechargeCode(row: RechargeCodeRow): RechargeCodeRecord {
  return {
    id: row.id,
    code: row.code,
    amountYuan: Number(row.amount_yuan),
    points: Number(row.points),
    status: row.status,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    redeemedBy: row.redeemed_by,
    redeemedByName: row.redeemed_by_name,
    redeemedByEmail: row.redeemed_by_email,
    transactionId: row.transaction_id,
    createdAt: row.created_at,
    redeemedAt: row.redeemed_at,
  };
}

function generateCode() {
  const raw = randomBytes(9).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `ZM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export class RechargeCodeManager {
  async createCode(data: { amountYuan: number; points: number; createdBy: string }): Promise<RechargeCodeRecord> {
    const pool = await getMysqlPool();
    const id = randomUUID();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCode();

      try {
        await pool.query(
          `INSERT INTO recharge_codes (id, code, amount_yuan, points, status, created_by, created_at)
           VALUES (?, ?, ?, ?, 'unused', ?, UTC_TIMESTAMP())`,
          [id, code, data.amountYuan, data.points, data.createdBy]
        );

        const created = await this.getCodeById(id);
        if (!created) throw new Error("兑换码创建后读取失败");
        return created;
      } catch (error) {
        const mysqlError = error as { code?: string };
        if (mysqlError.code !== "ER_DUP_ENTRY" || attempt === 4) {
          throw error;
        }
      }
    }

    throw new Error("兑换码创建失败");
  }

  async listCodes(limit = 100): Promise<RechargeCodeRecord[]> {
    const pool = await getMysqlPool();
    const [rows] = await pool.query<RechargeCodeRow[]>(
      `SELECT
         rc.*,
         creator.username AS created_by_name,
         redeemer.username AS redeemed_by_name,
         redeemer.email AS redeemed_by_email
       FROM recharge_codes rc
       LEFT JOIN users creator ON creator.id = rc.created_by
       LEFT JOIN users redeemer ON redeemer.id = rc.redeemed_by
       ORDER BY rc.created_at DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map(mapRechargeCode);
  }

  async getCodeById(id: string): Promise<RechargeCodeRecord | null> {
    const pool = await getMysqlPool();
    const [rows] = await pool.query<RechargeCodeRow[]>(
      `SELECT
         rc.*,
         creator.username AS created_by_name,
         redeemer.username AS redeemed_by_name,
         redeemer.email AS redeemed_by_email
       FROM recharge_codes rc
       LEFT JOIN users creator ON creator.id = rc.created_by
       LEFT JOIN users redeemer ON redeemer.id = rc.redeemed_by
       WHERE rc.id = ?
       LIMIT 1`,
      [id]
    );

    return rows[0] ? mapRechargeCode(rows[0]) : null;
  }

  async voidCode(data: { id: string; adminUserId: string }): Promise<RechargeCodeRecord> {
    const pool = await getMysqlPool();

    const [result] = await pool.query(
      `UPDATE recharge_codes
       SET status = 'voided'
       WHERE id = ? AND status = 'unused'`,
      [data.id]
    );

    const affectedRows = Number((result as { affectedRows?: number }).affectedRows || 0);
    if (affectedRows === 0) {
      const existing = await this.getCodeById(data.id);
      if (!existing) {
        throw new Error("兑换码不存在");
      }
      if (existing.status !== "unused") {
        throw new Error(existing.status === "redeemed" ? "已兑换的兑换码不能作废" : "兑换码已作废");
      }
      throw new Error("兑换码作废失败");
    }

    const updated = await this.getCodeById(data.id);
    if (!updated) {
      throw new Error("兑换码作废后读取失败");
    }
    console.log(`[Admin] ${data.adminUserId} 作废兑换码 ${updated.code}`);
    return updated;
  }

  async redeemCode(data: { code: string; userId: string }): Promise<{ points: number; remainingPoints: number; transactionId: string }> {
    const pool = await getMysqlPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const normalizedCode = data.code.trim().toUpperCase();
      const [codeRows] = await connection.query<(RowDataPacket & { id: string; points: number; amount_yuan: number; status: string })[]>(
        `SELECT id, points, amount_yuan, status
         FROM recharge_codes
         WHERE code = ?
         FOR UPDATE`,
        [normalizedCode]
      );

      const rechargeCode = codeRows[0];
      if (!rechargeCode) {
        throw new Error("兑换码不存在");
      }

      if (rechargeCode.status !== "unused") {
        throw new Error("兑换码已被使用");
      }

      const [userRows] = await connection.query<(RowDataPacket & { points: number })[]>(
        `SELECT points FROM users WHERE id = ? AND is_active = TRUE FOR UPDATE`,
        [data.userId]
      );

      const user = userRows[0];
      if (!user) {
        throw new Error("用户不存在或已停用");
      }

      const points = Number(rechargeCode.points);
      const remainingPoints = Number(user.points) + points;
      const transactionId = randomUUID();
      const orderNumber = `REDEEM${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;

      await connection.query(`UPDATE users SET points = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [remainingPoints, data.userId]);
      await connection.query(
        `INSERT INTO transactions
          (id, user_id, order_number, tool_page, description, points, actual_points, remaining_points, status, prompt, request_params, result_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '成功', ?, ?, ?)`,
        [
          transactionId,
          data.userId,
          orderNumber,
          RECHARGE_TOOL_PAGE,
          `兑换码充值 ${Number(rechargeCode.amount_yuan)} 元`,
          points,
          points,
          remainingPoints,
          `兑换码充值 ${Number(rechargeCode.amount_yuan)} 元`,
          JSON.stringify({ kind: "recharge-code", codeId: rechargeCode.id }),
          JSON.stringify({ kind: "recharge-code", code: normalizedCode, amountYuan: Number(rechargeCode.amount_yuan), points }),
        ]
      );
      await connection.query(
        `UPDATE recharge_codes
         SET status = 'redeemed', redeemed_by = ?, transaction_id = ?, redeemed_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [data.userId, transactionId, rechargeCode.id]
      );

      await connection.commit();
      return { points, remainingPoints, transactionId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const rechargeCodeManager = new RechargeCodeManager();
