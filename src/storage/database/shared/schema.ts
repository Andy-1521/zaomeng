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
  decimal,
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
    folderId: varchar("folder_id", { length: 36 }),
    isFavorite: boolean("is_favorite").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("captured_images_user_created_idx").on(table.userId, table.createdAt),
    index("captured_images_user_folder_idx").on(table.userId, table.folderId),
    index("captured_images_user_favorite_idx").on(table.userId, table.isFavorite),
  ]
);

export const materialFolders = mysqlTable(
  "material_folders",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    sortOrder: int("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }),
  },
  (table) => [
    index("material_folders_user_idx").on(table.userId),
    uniqueIndex("material_folders_user_name_unique").on(table.userId, table.name),
  ]
);

export const marketItems = mysqlTable(
  "market_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    sellerId: varchar("seller_id", { length: 36 }).notNull(),
    sourceOrderNumber: varchar("source_order_number", { length: 50 }),
    sourceImageUrl: text("source_image_url").notNull(),
    previewImageUrl: text("preview_image_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 50 }).default("手机壳图案").notNull(),
    tags: json("tags"),
    pricePoints: int("price_points").notNull(),
    platformFeeRate: decimal("platform_fee_rate", { precision: 5, scale: 2 }).default("20.00").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    licenseType: varchar("license_type", { length: 30 }).default("standard").notNull(),
    allowCommercialUse: boolean("allow_commercial_use").default(true).notNull(),
    psdUrl: text("psd_url"),
    psdFileName: varchar("psd_file_name", { length: 255 }),
    psdFileSize: int("psd_file_size"),
    psdLayerCount: int("psd_layer_count").default(0).notNull(),
    psdLayers: json("psd_layers"),
    rejectionReason: text("rejection_reason"),
    approvedAt: timestamp("approved_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }),
  },
  (table) => [
    index("market_items_status_created_idx").on(table.status, table.createdAt),
    index("market_items_seller_created_idx").on(table.sellerId, table.createdAt),
    index("market_items_source_order_idx").on(table.sourceOrderNumber),
  ]
);

export const marketPurchases = mysqlTable(
  "market_purchases",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    itemId: varchar("item_id", { length: 36 }).notNull(),
    buyerId: varchar("buyer_id", { length: 36 }).notNull(),
    sellerId: varchar("seller_id", { length: 36 }).notNull(),
    orderNumber: varchar("order_number", { length: 50 }).notNull(),
    pricePoints: int("price_points").notNull(),
    sellerPoints: int("seller_points").notNull(),
    platformFeePoints: int("platform_fee_points").notNull(),
    buyerRemainingPoints: int("buyer_remaining_points").notNull(),
    sellerRemainingPoints: int("seller_remaining_points").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("market_purchases_buyer_item_unique").on(table.buyerId, table.itemId),
    uniqueIndex("market_purchases_order_unique").on(table.orderNumber),
    index("market_purchases_buyer_created_idx").on(table.buyerId, table.createdAt),
    index("market_purchases_seller_created_idx").on(table.sellerId, table.createdAt),
    index("market_purchases_item_idx").on(table.itemId),
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
  folderId: true,
  isFavorite: true,
});

export const insertMaterialFolderSchema = createCoercedInsertSchema(materialFolders).pick({
  userId: true,
  name: true,
  sortOrder: true,
});

export const insertMarketItemSchema = createCoercedInsertSchema(marketItems).pick({
  sellerId: true,
  sourceOrderNumber: true,
  sourceImageUrl: true,
  previewImageUrl: true,
  thumbnailUrl: true,
  title: true,
  description: true,
  category: true,
  tags: true,
  pricePoints: true,
  platformFeeRate: true,
  status: true,
  licenseType: true,
  allowCommercialUse: true,
  psdUrl: true,
  psdFileName: true,
  psdFileSize: true,
  psdLayerCount: true,
  psdLayers: true,
  rejectionReason: true,
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
export type MaterialFolder = typeof materialFolders.$inferSelect;
export type InsertMaterialFolder = z.infer<typeof insertMaterialFolderSchema>;
export type MarketItem = typeof marketItems.$inferSelect;
export type InsertMarketItem = z.infer<typeof insertMarketItemSchema>;
export type MarketPurchase = typeof marketPurchases.$inferSelect;
