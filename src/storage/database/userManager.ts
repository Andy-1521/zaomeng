import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { ResultSetHeader } from "mysql2/promise";
import { getDb } from "./client";
import { users, insertUserSchema, updateUserSchema } from "./shared/schema";
import type { User, InsertUser, UpdateUser } from "./shared/schema";

export class UserManager {
  async getUsersByIds(ids: string[]): Promise<Map<string, User>> {
    if (ids.length === 0) {
      return new Map();
    }

    const db = await getDb();
    const uniqueIds = [...new Set(ids)];
    const result = await db.select().from(users).where(inArray(users.id, uniqueIds));

    return new Map(result.map((user) => [user.id, user]));
  }

  async searchUserIdsByKeyword(keyword: string): Promise<string[]> {
    if (!keyword) {
      return [];
    }

    const db = await getDb();
    const result = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.username, `%${keyword}%`));

    return result.map((row) => row.id);
  }

  async createUser(data: InsertUser): Promise<User> {
    const db = await getDb();
    const validated = insertUserSchema.parse(data);
    const id = randomUUID();

    await db.insert(users).values({
      id,
      username: validated.username,
      email: validated.email ?? null,
      phone: validated.phone ?? null,
      password: validated.password,
      avatar: validated.avatar ?? null,
      points: validated.points ?? 100,
    });

    const user = await this.getUserById(id);

    if (!user) {
      throw new Error("创建用户后读取失败");
    }

    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    const db = await getDb();
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const db = await getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  }

  async getUserByPhone(phone: string): Promise<User | null> {
    const db = await getDb();
    const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    return user ?? null;
  }

  async verifyUser(identifier: string, password: string): Promise<User | null> {
    const db = await getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          or(eq(users.email, identifier), eq(users.phone, identifier)),
          eq(users.password, password),
          eq(users.isActive, true)
        )
      )
      .limit(1);

    return user ?? null;
  }

  async updateUser(id: string, data: UpdateUser): Promise<User | null> {
    const db = await getDb();
    const validated = updateUserSchema.parse(data);

    await db
      .update(users)
      .set({ ...validated, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));

    return this.getUserById(id);
  }

  async updateUserCredits(id: string, points: number): Promise<User | null> {
    const db = await getDb();

    await db
      .update(users)
      .set({ points, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));

    return this.getUserById(id);
  }

  async deductPointsAtomically(id: string, pointsToDeduct: number): Promise<User | null> {
    const db = await getDb();
    const result = await db.execute(sql`
      UPDATE users
      SET points = points - ${pointsToDeduct},
          updated_at = UTC_TIMESTAMP()
      WHERE id = ${id}
        AND points >= ${pointsToDeduct}
    `);

    if ((result[0] as ResultSetHeader).affectedRows === 0) {
      return null;
    }

    return this.getUserById(id);
  }

  async addPointsAtomically(id: string, pointsToAdd: number): Promise<User | null> {
    const db = await getDb();
    const result = await db.execute(sql`
      UPDATE users
      SET points = points + ${pointsToAdd},
          updated_at = UTC_TIMESTAMP()
      WHERE id = ${id}
    `);

    if ((result[0] as ResultSetHeader).affectedRows === 0) {
      return null;
    }

    return this.getUserById(id);
  }

  async updateAvatar(id: string, avatar: string): Promise<User | null> {
    return this.updateUser(id, { avatar });
  }

  async updatePassword(id: string, password: string): Promise<User | null> {
    const db = await getDb();

    await db
      .update(users)
      .set({ password, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));

    return this.getUserById(id);
  }

  async getUsers(skip = 0, limit = 100): Promise<User[]> {
    const db = await getDb();
    return db.select().from(users).limit(limit).offset(skip);
  }

  async deleteUser(id: string): Promise<boolean> {
    const db = await getDb();
    const result = await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));

    return result[0].affectedRows !== 0;
  }
}

export const userManager = new UserManager();
