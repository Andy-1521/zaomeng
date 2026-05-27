import { randomUUID } from 'crypto'
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from './client'
import { capturedImages, insertCapturedImageSchema } from './shared/schema'
import type { CapturedImage, InsertCapturedImage } from './shared/schema'

export type CapturedImageFilters = {
  folderId?: string | null
  isFavorite?: boolean
  startDate?: Date
  endDate?: Date
  displayableOnly?: boolean
}

export type CapturedImageListOptions = {
  limit?: number
  offset?: number
  filters?: CapturedImageFilters
}

function formatMysqlDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function buildCapturedImageConditions(userId: string, filters?: CapturedImageFilters) {
  const conditions: SQL<unknown>[] = [eq(capturedImages.userId, userId)]

  if (filters?.displayableOnly) {
    conditions.push(sql`lower(substring_index(${capturedImages.imageUrl}, '?', 1)) regexp ${'\\.(jpg|jpeg|png|webp|gif|bmp|avif)$'}`)
  }

  if (filters && 'folderId' in filters) {
    if (filters.folderId === null) {
      conditions.push(isNull(capturedImages.folderId))
    } else if (filters.folderId) {
      conditions.push(eq(capturedImages.folderId, filters.folderId))
    }
  }

  if (typeof filters?.isFavorite === 'boolean') {
    conditions.push(eq(capturedImages.isFavorite, filters.isFavorite))
  }

  if (filters?.startDate) {
    conditions.push(sql`${capturedImages.createdAt} >= ${formatMysqlDateTime(filters.startDate)}`)
  }

  if (filters?.endDate) {
    conditions.push(sql`${capturedImages.createdAt} < ${formatMysqlDateTime(filters.endDate)}`)
  }

  return conditions
}

export class CapturedImageManager {
  async createCapturedImage(data: InsertCapturedImage): Promise<CapturedImage> {
    const db = await getDb()
    const validated = insertCapturedImageSchema.parse(data)
    const id = randomUUID()

    await db.insert(capturedImages).values({
      id,
      userId: validated.userId,
      imageUrl: validated.imageUrl,
      originalUrl: validated.originalUrl ?? null,
      pageUrl: validated.pageUrl ?? null,
      pageTitle: validated.pageTitle ?? null,
      sourceHost: validated.sourceHost ?? null,
      imageType: validated.imageType ?? 'main',
      folderId: validated.folderId ?? null,
      isFavorite: validated.isFavorite ?? false,
    })

    const [record] = await db.select().from(capturedImages).where(eq(capturedImages.id, id)).limit(1)
    if (!record) {
      throw new Error('创建素材库记录后读取失败')
    }

    return record
  }

  async getUserCapturedImages(userId: string, options?: CapturedImageListOptions): Promise<CapturedImage[]> {
    const db = await getDb()
    const limit = Math.max(1, Math.min(options?.limit ?? 60, 120))
    const offset = Math.max(0, options?.offset ?? 0)
    const conditions = buildCapturedImageConditions(userId, options?.filters)

    return db
      .select()
      .from(capturedImages)
      .where(and(...conditions))
      .orderBy(desc(capturedImages.createdAt))
      .limit(limit)
      .offset(offset)
  }

  async countUserCapturedImages(userId: string, filters?: CapturedImageFilters): Promise<number> {
    const db = await getDb()
    const conditions = buildCapturedImageConditions(userId, filters)
    const [result] = await db
      .select({ total: sql<number>`count(*)` })
      .from(capturedImages)
      .where(and(...conditions))

    return Number(result?.total ?? 0)
  }

  async deleteCapturedImage(id: string, userId: string): Promise<boolean> {
    const db = await getDb()
    const existing = await db
      .select({ id: capturedImages.id })
      .from(capturedImages)
      .where(and(eq(capturedImages.id, id), eq(capturedImages.userId, userId)))
      .limit(1)

    if (existing.length === 0) {
      return false
    }

    await db.delete(capturedImages).where(and(eq(capturedImages.id, id), eq(capturedImages.userId, userId)))
    return true
  }

  async updateCapturedImages(
    ids: string[],
    userId: string,
    updates: { folderId?: string | null; isFavorite?: boolean }
  ): Promise<number> {
    if (ids.length === 0) {
      return 0
    }

    const db = await getDb()
    const updateData: Record<string, string | boolean | null> = {}
    if ('folderId' in updates) {
      updateData.folderId = updates.folderId ?? null
    }
    if ('isFavorite' in updates && typeof updates.isFavorite === 'boolean') {
      updateData.isFavorite = updates.isFavorite
    }

    if (Object.keys(updateData).length === 0) {
      return 0
    }

    const result = await db
      .update(capturedImages)
      .set(updateData)
      .where(and(eq(capturedImages.userId, userId), inArray(capturedImages.id, ids)))

    return result[0].affectedRows ?? 0
  }

  async updateCapturedImagesByFolder(
    folderId: string,
    userId: string,
    updates: { folderId?: string | null; isFavorite?: boolean }
  ): Promise<number> {
    const db = await getDb()
    const updateData: Record<string, string | boolean | null> = {}
    if ('folderId' in updates) {
      updateData.folderId = updates.folderId ?? null
    }
    if ('isFavorite' in updates && typeof updates.isFavorite === 'boolean') {
      updateData.isFavorite = updates.isFavorite
    }

    if (Object.keys(updateData).length === 0) {
      return 0
    }

    const result = await db
      .update(capturedImages)
      .set(updateData)
      .where(and(eq(capturedImages.userId, userId), eq(capturedImages.folderId, folderId)))

    return result[0].affectedRows ?? 0
  }

  async clearUserCapturedImages(userId: string): Promise<number> {
    const db = await getDb()
    const existing = await db
      .select({ id: capturedImages.id })
      .from(capturedImages)
      .where(eq(capturedImages.userId, userId))

    if (existing.length === 0) {
      return 0
    }

    await db.delete(capturedImages).where(eq(capturedImages.userId, userId))
    return existing.length
  }
}

export const capturedImageManager = new CapturedImageManager()
