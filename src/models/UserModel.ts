import { db } from '../config/database';
import { BaseModel } from './BaseModel';

export class UserModel extends BaseModel {
  protected static tableName = 'users';

  static async findByEmail(email: string) {
    return db(this.tableName).where('email', email.toLowerCase().trim()).first();
  }

  static async findByMobile(mobile: string) {
    return db(this.tableName).where('mobile', mobile).first();
  }

  static async findOrCreateByEmail(email: string, data: Record<string, unknown>) {
    const existing = await this.findByEmail(email);
    if (existing) return existing;
    return this.create(data);
  }

  static async findOrCreateByMobile(mobile: string, data: Record<string, unknown>) {
    const existing = await this.findByMobile(mobile);
    if (existing) return existing;
    return this.create(data);
  }

  static async updateLastLogin(id: string) {
    return db(this.tableName).where('id', id).update({ updated_at: new Date() });
  }
}
