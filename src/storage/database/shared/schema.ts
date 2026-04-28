import {
  mysqlTable,
  index,
  uniqueIndex,
  varchar,
  text,
  int,
  boolean,
  timestamp,
  json,
} from "drizzle-orm/mysql-core";
import { createSchemaFactory } from "drizzle-zod";
import { z } from "zod";

const { createInsertSchema: createCoercedInsertSchema } = createSchemaFactory({
  coerce: { date: true },
});

export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    username: varchar("username", { length: 50 }).notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 11 }),
    password: text("password").notNull(),
    avatar: text("avatar"),
    points: int("points").default(100).notNull(),
    isAdmin: boolean("is_admin").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }),
  },
  (table) => [
    index("users_phone_idx").on(table.phone),
    index("users_email_idx").on(table.email),
    uniqueIndex("users_phone_unique").on(table.phone),
    uniqueIndex("users_email_unique").on(table.email),
  ]
);

export const insertUserSchema = createCoercedInsertSchema(users).pick({
  username: true,
  email: true,
  phone: true,
  password: true,
  avatar: true,
  points: true,
});

export const updateUserSchema = createCoercedInsertSchema(users)
  .pick({
    username: true,
    email: true,
    phone: true,
    avatar: true,
    points: true,
    isAdmin: true,
    isActive: true,
  })
  .partial();

export const transactions = mysqlTable(
  "transactions",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    orderNumber: varchar("order_number", { length: 50 }).notNull(),
    toolPage: varchar("tool_page", { length: 50 }).notNull(),
    description: text("description").notNull(),
    points: int("points").notNull(),
    actualPoints: int("actual_points").default(0).notNull(),
    remainingPoints: int("remaining_points").notNull(),
    status: varchar("status", { length: 30 }).default("成功").notNull(),
    prompt: text("prompt"),
    requestParams: text("request_params"),
    resultData: text("result_data"),
    psdUrl: varchar("psd_url", { length: 500 }),
    uploadedImage: text("uploaded_image"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("transactions_user_id_idx").on(table.userId),
    uniqueIndex("transactions_order_number_unique").on(table.orderNumber),
    index("transactions_order_number_idx").on(table.orderNumber),
    index("transactions_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(),
    content: text("content").notNull(),
    imageUrl: text("image_url"),
    uploadedImages: json("uploaded_images"),
    loading: boolean("loading").default(false).notNull(),
    orderId: varchar("order_id", { length: 50 }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("chat_messages_user_id_idx").on(table.userId),
    index("chat_messages_created_at_idx").on(table.createdAt),
  ]
);

export const capturedImages = mysqlTable(
  "captured_images",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    imageUrl: text("image_url").notNull(),
    originalUrl: text("original_url"),
    pageUrl: text("page_url"),
    pageTitle: text("page_title"),
    sourceHost: varchar("source_host", { length: 255 }),
    imageType: varchar("image_type", { length: 20 }).default("main").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("captured_images_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export const insertTransactionSchema = createCoercedInsertSchema(transactions).pick({
  userId: true,
  orderNumber: true,
  toolPage: true,
  description: true,
  points: true,
  actualPoints: true,
  remainingPoints: true,
  status: true,
  prompt: true,
  requestParams: true,
  resultData: true,
  psdUrl: true,
  uploadedImage: true,
});

export const insertChatMessageSchema = createCoercedInsertSchema(chatMessages).pick({
  userId: true,
  type: true,
  content: true,
  imageUrl: true,
  uploadedImages: true,
  loading: true,
  orderId: true,
});

export const insertCapturedImageSchema = createCoercedInsertSchema(capturedImages).pick({
  userId: true,
  imageUrl: true,
  originalUrl: true,
  pageUrl: true,
  pageTitle: true,
  sourceHost: true,
  imageType: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type CapturedImage = typeof capturedImages.$inferSelect;
export type InsertCapturedImage = z.infer<typeof insertCapturedImageSchema>;
