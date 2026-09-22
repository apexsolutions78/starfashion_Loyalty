import { db } from '../config/database';

export class BaseModel {
  protected static tableName: string;

  static async findById(id: string) {
    return db(this.tableName).where('id', id).first();
  }

  static async findAll(conditions: Record<string, unknown> = {}) {
    let query = db(this.tableName);
    for (const [key, value] of Object.entries(conditions)) {
      if (value !== undefined && value !== null) {
        query = query.where(key, value);
      }
    }
    return query;
  }

  static async create(data: Record<string, unknown>) {
    const [insertId] = await db(this.tableName).insert(data);
    const id = data.id || insertId;
    return this.findById(String(id));
  }

  static async update(id: string, data: Record<string, unknown>) {
    await db(this.tableName).where('id', id).update({ ...data, updated_at: new Date() });
    return this.findById(id);
  }

  static async delete(id: string) {
    return db(this.tableName).where('id', id).del();
  }

  static async count(conditions: Record<string, unknown> = {}) {
    let query = db(this.tableName);
    for (const [key, value] of Object.entries(conditions)) {
      if (value !== undefined && value !== null) {
        query = query.where(key, value);
      }
    }
    const result = await query.count('* as count').first();
    return Number(result?.count || 0);
  }
}
