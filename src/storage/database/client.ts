import mysql, { type Pool } from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "./shared/schema";

let pool: Pool | null = null;
let db: MySql2Database<typeof schema> | null = null;

function getMysqlUrl() {
  const mysqlUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;

  if (!mysqlUrl) {
    throw new Error("缺少 MYSQL_URL 环境变量");
  }

  return mysqlUrl;
}

function createPool() {
  if (!pool) {
    pool = mysql.createPool({
      uri: getMysqlUrl(),
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60_000,
      enableKeepAlive: true,
      timezone: "Z",
    });
  }

  return pool;
}

export async function getDb() {
  if (!db) {
    db = drizzle(createPool(), { schema, mode: "default" });
  }

  return db;
}

export async function getMysqlPool() {
  return createPool();
}
