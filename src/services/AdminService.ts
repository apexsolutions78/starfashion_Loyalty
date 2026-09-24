import { db } from '../config/database';
import { UserModel } from '../models/UserModel';
import { hashPassword, newId } from '../utils/crypto';
import { createAppError } from '../middleware/errorHandler';
import { Role } from '../middleware/auth';
import { createRequestLogger } from '../utils/logger';

interface CreateAdminInput {
  email: string;
  mobile: string;
  password: string;
  fullName: string;
  role: 'reviewer' | 'manager' | 'master_admin';
  department?: string;
}

export class AdminService {
  static async createAdmin(input: CreateAdminInput, createdBy: string, requestId: string) {
    const log = createRequestLogger(requestId);

    const existingEmail = await UserModel.findByEmail(input.email);
    if (existingEmail) {
      throw createAppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);

    const admin = await db.transaction(async (trx) => {
      const userId = newId();
      await trx('users').insert({
        id: userId,
        email: input.email.toLowerCase().trim(),
        mobile: input.mobile,
        password_hash: passwordHash,
        role: input.role as Role,
        status: 'active',
        email_verified: true,
        mobile_verified: true,
      });

      await trx('admin_profiles').insert({
        id: newId(),
        user_id: userId,
        full_name: input.fullName,
        department: input.department,
      });

      const newUser = await trx('users').where('id', userId).first();
      log.info('Admin created', { adminId: userId, role: input.role, createdBy });
      return newUser;
    });

    return {
      id: admin.id,
      email: admin.email,
      mobile: admin.mobile,
      role: admin.role,
      fullName: input.fullName,
    };
  }

  static async getAdmins() {
    return db('users')
      .leftJoin('admin_profiles', 'users.id', 'admin_profiles.user_id')
      .select(
        'users.id',
        'users.email',
        'users.mobile',
        'users.role',
        'users.status',
        'admin_profiles.full_name',
        'admin_profiles.department',
        'users.created_at',
      )
      .where('users.role', '!=', 'customer')
      .orderBy('users.created_at', 'desc');
  }

  static async updateAdminRole(adminId: string, newRole: Role, requestId: string) {
    const log = createRequestLogger(requestId);

    const admin = await UserModel.findById(adminId);
    if (!admin) {
      throw createAppError('Admin not found', 404, 'ADMIN_NOT_FOUND');
    }

    if (admin.role === 'customer') {
      throw createAppError('Cannot change customer role through admin management', 400, 'INVALID_ROLE');
    }

    await UserModel.update(adminId, { role: newRole });
    log.info('Admin role updated', { adminId, newRole });
  }

  static async suspendAdmin(adminId: string, requestId: string) {
    const log = createRequestLogger(requestId);

    const admin = await UserModel.findById(adminId);
    if (!admin) {
      throw createAppError('Admin not found', 404, 'ADMIN_NOT_FOUND');
    }

    await UserModel.update(adminId, { status: 'suspended' });
    log.info('Admin suspended', { adminId });
  }

  static async activateAdmin(adminId: string, requestId: string) {
    const log = createRequestLogger(requestId);

    const admin = await UserModel.findById(adminId);
    if (!admin) {
      throw createAppError('Admin not found', 404, 'ADMIN_NOT_FOUND');
    }

    await UserModel.update(adminId, { status: 'active' });
    log.info('Admin activated', { adminId });
  }

  static async getAuditLogs(filters: {
    userId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = db('audit_logs')
      .leftJoin('users', 'audit_logs.user_id', 'users.id')
      .select(
        'audit_logs.id',
        'audit_logs.user_id',
        'audit_logs.action',
        'audit_logs.entity_type',
        'audit_logs.entity_id',
        'audit_logs.ip_address',
        'audit_logs.created_at',
        'users.email as actorEmail',
        'users.role as actorRole',
      );

    if (filters.userId) query = query.where('audit_logs.user_id', filters.userId);
    if (filters.entityType) query = query.where('audit_logs.entity_type', filters.entityType);
    if (filters.entityId) query = query.where('audit_logs.entity_id', filters.entityId);
    if (filters.action) query = query.where('audit_logs.action', filters.action);
    if (filters.search) {
      const q = `%${filters.search.toLowerCase()}%`;
      query = query.where(function () {
        this.whereRaw('LOWER(audit_logs.action) LIKE ?', [q])
          .orWhereRaw('LOWER(COALESCE(users.email, ?)) LIKE ?', ['', q])
          .orWhereRaw('LOWER(COALESCE(audit_logs.entity_type, ?)) LIKE ?', ['', q])
          .orWhereRaw('LOWER(COALESCE(audit_logs.entity_id, ?)) LIKE ?', ['', q]);
      });
    }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const [countResult] = await query.clone().clearSelect().count('* as total');
    const logs = await query.orderBy('audit_logs.created_at', 'desc').limit(limit).offset(offset);

    return {
      logs,
      total: Number(countResult?.total || 0),
      limit,
      offset,
    };
  }

  static async createAuditLog(data: {
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return db('audit_logs').insert({
      id: newId(),
      user_id: data.userId,
      action: data.action,
      entity_type: data.entityType,
      entity_id: data.entityId,
      old_values: data.oldValues ? JSON.stringify(data.oldValues) : null,
      new_values: data.newValues ? JSON.stringify(data.newValues) : null,
      ip_address: data.ipAddress,
      user_agent: data.userAgent,
    });
  }
}
