import { randomUUID } from 'crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from './client'
import { capturedImages, insertCapturedImageSchema } from './shared/schema'
import type { CapturedImage, InsertCapturedImage } from './shared/schema'

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

  async getUserCapturedImages(userId: string): Promise<CapturedImage[]> {
    const db = await getDb()
    return db
      .select()
      .from(capturedImages)
      .where(eq(capturedImages.userId, userId))
      .orderBy(desc(capturedImages.createdAt))
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
