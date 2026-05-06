import { randomUUID } from 'crypto'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from './client'
import { insertMaterialFolderSchema, materialFolders } from './shared/schema'
import type { InsertMaterialFolder, MaterialFolder } from './shared/schema'

export class MaterialFolderManager {
  async createFolder(data: InsertMaterialFolder): Promise<MaterialFolder> {
    const db = await getDb()
    const validated = insertMaterialFolderSchema.parse(data)
    const id = randomUUID()

    await db.insert(materialFolders).values({
      id,
      userId: validated.userId,
      name: validated.name,
      sortOrder: validated.sortOrder ?? 0,
    })

    const folder = await this.getFolderById(id, validated.userId)
    if (!folder) {
      throw new Error('创建文件夹后读取失败')
    }

    return folder
  }

  async getUserFolders(userId: string): Promise<MaterialFolder[]> {
    const db = await getDb()
    return db
      .select()
      .from(materialFolders)
      .where(eq(materialFolders.userId, userId))
      .orderBy(asc(materialFolders.sortOrder), asc(materialFolders.createdAt))
  }

  async getFolderById(id: string, userId: string): Promise<MaterialFolder | null> {
    const db = await getDb()
    const [folder] = await db
      .select()
      .from(materialFolders)
      .where(and(eq(materialFolders.id, id), eq(materialFolders.userId, userId)))
      .limit(1)

    return folder ?? null
  }

  async updateFolder(id: string, userId: string, name: string): Promise<MaterialFolder | null> {
    const db = await getDb()
    await db
      .update(materialFolders)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(and(eq(materialFolders.id, id), eq(materialFolders.userId, userId)))

    return this.getFolderById(id, userId)
  }

  async deleteFolder(id: string, userId: string): Promise<boolean> {
    const db = await getDb()
    const folder = await this.getFolderById(id, userId)
    if (!folder) {
      return false
    }

    await db.delete(materialFolders).where(and(eq(materialFolders.id, id), eq(materialFolders.userId, userId)))
    return true
  }
}

export const materialFolderManager = new MaterialFolderManager()
