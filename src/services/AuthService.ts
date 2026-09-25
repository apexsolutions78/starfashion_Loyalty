import { db } from '../config/database';
import { UserModel } from '../models/UserModel';
import { hashPassword, verifyPassword, generateToken, hashToken, generateOTP, newId } from '../utils/crypto';
import { createAppError } from '../middleware/errorHandler';
import { Role } from '../middleware/auth';
import { createRequestLogger } from '../utils/logger';
import { MailService } from './MailService';
import { SessionService } from './SessionService';

/**
 * Request facts worth keeping for audit rows and session handling.
 * `sessionId` is what lets a self-service change spare the caller's own session.
 */
export interface AuthContext {
  ip?: string;
  userAgent?: string;
  sessionId?: string;
}

interface RegisterInput {
  email: string;
  mobile: string;
  password: string;
  fullName: string;
  marketingConsent?: boolean;
  loyaltyConsent: boolean;
}

interface LoginInput {
  email: string;
  password: string;
}

interface AuthResult {
  user: {
    id: string;
    email: string;
    mobile: string;
    role: Role;
    emailVerified: boolean;
    mobileVerified: boolean;
  };
}

export class AuthService {
  static async register(input: RegisterInput, requestId: string): Promise<AuthResult> {
    const log = createRequestLogger(requestId);

    const existingEmail = await UserModel.findByEmail(input.email);
    if (existingEmail) {
      throw createAppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
    }

    const existingMobile = await UserModel.findByMobile(input.mobile);
    if (existingMobile) {
      throw createAppError('An account with this mobile number already exists', 409, 'MOBILE_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await db.transaction(async (trx) => {
      const userId = newId();
      await trx('users').insert({
        id: userId,
        email: input.email.toLowerCase().trim(),
        mobile: input.mobile,
        password_hash: passwordHash,
        role: 'customer' as Role,
        status: 'active',
        email_verified: false,
        mobile_verified: false,
      });

      await trx('customer_profiles').insert({
        id: newId(),
        user_id: userId,
        full_name: input.fullName,
        marketing_consent: input.marketingConsent || false,
        loyalty_consent: input.loyaltyConsent,
      });

      await trx('consents').insert([
        {
          id: newId(),
          user_id: userId,
          consent_type: 'loyalty_program',
          granted: input.loyaltyConsent,
        },
        {
          id: newId(),
          user_id: userId,
          consent_type: 'marketing',
          granted: input.marketingConsent || false,
        },
      ]);

      const newUser = await trx('users').where('id', userId).first();
      log.info('Customer registered', { userId });
      return newUser;
    });

    const userId = (user as any).id;
    const fullName = (user as any).full_name || input.fullName;
    await this.sendVerificationEmail(userId, input.email, requestId, fullName);
    await this.sendVerificationOTP(userId, input.mobile, requestId);

    return {
      user: {
        id: userId,
        email: (user as any).email,
        mobile: (user as any).mobile,
        role: (user as any).role,
        emailVerified: false,
        mobileVerified: false,
      },
    };
  }

  static async login(input: LoginInput, requestId: string): Promise<AuthResult> {
    const log = createRequestLogger(requestId);

    const user = await UserModel.findByEmail(input.email);
    if (!user) {
      throw createAppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (user.status !== 'active') {
      throw createAppError('Account is not active', 403, 'ACCOUNT_INACTIVE');
    }

    const validPassword = await verifyPassword(input.password, user.password_hash);
    if (!validPassword) {
      throw createAppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    log.info('User logged in', { userId: user.id, role: user.role });

    return {
      user: {
        id: user.id,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        emailVerified: user.email_verified,
        mobileVerified: user.mobile_verified,
      },
    };
  }

  static async logout(userId: string, requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);
    log.info('User logged out', { userId });
  }

  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    requestId: string,
    context?: AuthContext,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const user = await UserModel.findById(userId);
    if (!user) {
      throw createAppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const validPassword = await verifyPassword(currentPassword, user.password_hash);
    if (!validPassword) {
      throw createAppError('Current password is incorrect', 401, 'INVALID_PASSWORD');
    }

    const newHash = await hashPassword(newPassword);

    await db.transaction(async (trx) => {
      await trx('users').where('id', userId).update({ password_hash: newHash });
      await trx('audit_logs').insert({
        id: newId(),
        user_id: userId,
        action: 'PASSWORD_CHANGED',
        entity_type: 'users',
        entity_id: userId,
        ip_address: context?.ip ?? null,
        user_agent: context?.userAgent ? context.userAgent.slice(0, 500) : null,
      });
    });

    // Other devices stay signed in on the old password, so sign them out.
    // The caller's own session is kept so this page keeps working.
    const signedOut = await SessionService.invalidateUserSessions(userId, context?.sessionId);

    log.info('Password changed', { userId, sessionsSignedOut: signedOut });
  }

  static async forgotPassword(email: string, requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const user = await UserModel.findByEmail(email);
    if (!user) {
      log.warn('Password reset requested for non-existent email');
      return;
    }

    const token = generateToken();
    const tokenHash = hashToken(token);

    await db('password_reset_tokens').insert({
      id: newId(),
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const mail = await MailService.sendPasswordReset(user.email, token);
    log.info('Password reset email sent', { userId: user.id, mode: mail.mode });
  }

  static async resetPassword(
    token: string,
    newPassword: string,
    requestId: string,
    context?: AuthContext,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const tokenHash = hashToken(token);
    const resetToken = await db('password_reset_tokens')
      .where('token_hash', tokenHash)
      .where('used', false)
      .where('expires_at', '>', new Date())
      .first();

    if (!resetToken) {
      throw createAppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
    }

    const newHash = await hashPassword(newPassword);

    await db.transaction(async (trx) => {
      await trx('password_reset_tokens').where('id', resetToken.id).update({ used: true });
      await trx('users').where('id', resetToken.user_id).update({ password_hash: newHash });
      await trx('audit_logs').insert({
        id: newId(),
        user_id: resetToken.user_id,
        action: 'PASSWORD_RESET',
        entity_type: 'users',
        entity_id: resetToken.user_id,
        ip_address: context?.ip ?? null,
        user_agent: context?.userAgent ? context.userAgent.slice(0, 500) : null,
      });
    });

    // A reset means the old password was not available, so every session for
    // that account is suspect: sign it out everywhere, including this one.
    const signedOut = await SessionService.invalidateUserSessions(resetToken.user_id);

    log.info('Password reset completed', { userId: resetToken.user_id, sessionsSignedOut: signedOut });
  }

  /**
   * Manager-initiated reset for a customer. Skips current-password verification
   * (the admin does not know it), forces the target out of every session, and
   * is attributed to the admin in the audit log.
   */
  static async adminResetPassword(
    targetUserId: string,
    newPassword: string,
    actorId: string,
    requestId: string,
    context?: AuthContext,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const target = await UserModel.findById(targetUserId);
    if (!target) {
      throw createAppError('Customer not found', 404, 'USER_NOT_FOUND');
    }

    const newHash = await hashPassword(newPassword);

    await db.transaction(async (trx) => {
      await trx('users').where('id', targetUserId).update({ password_hash: newHash });
      await trx('audit_logs').insert({
        id: newId(),
        user_id: actorId,
        action: 'PASSWORD_RESET_BY_ADMIN',
        entity_type: 'users',
        entity_id: targetUserId,
        new_values: JSON.stringify({ targetEmail: target.email }),
        ip_address: context?.ip ?? null,
        user_agent: context?.userAgent ? context.userAgent.slice(0, 500) : null,
      });
    });

    const signedOut = await SessionService.invalidateUserSessions(targetUserId);

    log.info('Password reset by admin', { targetUserId, actorId, sessionsSignedOut: signedOut });
  }

  static async sendVerificationEmail(userId: string, email: string, requestId: string, fullName?: string): Promise<string> {
    const log = createRequestLogger(requestId);

    const token = generateToken();
    const tokenHash = hashToken(token);

    await db('contact_verifications').insert({
      id: newId(),
      user_id: userId,
      type: 'email',
      token_hash: tokenHash,
      contact_value: email.toLowerCase().trim(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      max_attempts: 5,
    });

    const mail = await MailService.sendVerificationEmail(email, fullName || '', token);
    log.info('Email verification sent', { userId, mode: mail.mode });
    return token;
  }

  static async sendVerificationOTP(userId: string, mobile: string, requestId: string): Promise<string> {
    const log = createRequestLogger(requestId);

    const otp = generateOTP(6);
    const otpHash = hashToken(otp);

    await db('contact_verifications').insert({
      id: newId(),
      user_id: userId,
      type: 'mobile',
      token_hash: otpHash,
      contact_value: mobile,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      max_attempts: 5,
    });

    const mail = await MailService.sendVerificationOtp(mobile, otp);
    log.info('Mobile OTP sent', { userId, mode: mail.mode });
    return otp;
  }

  static async resendVerification(userId: string, type: 'email' | 'mobile', requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const user = await UserModel.findById(userId);
    if (!user) {
      throw createAppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (type === 'email') {
      if (user.email_verified) {
        throw createAppError('Email already verified', 400, 'ALREADY_VERIFIED');
      }
      const profile = await db('customer_profiles').where('user_id', userId).first();
      await db('contact_verifications')
        .where('user_id', userId)
        .where('type', 'email')
        .where('used', false)
        .update({ used: true });
      await this.sendVerificationEmail(userId, user.email, requestId, profile?.full_name);
      return;
    }

    if (user.mobile_verified) {
      throw createAppError('Mobile already verified', 400, 'ALREADY_VERIFIED');
    }
    await db('contact_verifications')
      .where('user_id', userId)
      .where('type', 'mobile')
      .where('used', false)
      .update({ used: true });
    await this.sendVerificationOTP(userId, user.mobile, requestId);
    log.info('Verification resent', { userId, type });
  }

  static async verifyContact(userId: string, token: string, type: 'email' | 'mobile', requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const tokenHash = hashToken(token);
    const verification = await db('contact_verifications')
      .where('user_id', userId)
      .where('type', type)
      .where('token_hash', tokenHash)
      .where('used', false)
      .where('expires_at', '>', new Date())
      .first();

    await this.consumeVerification(verification, type);
    log.info(`Contact verified: ${type}`, { userId });
  }

  static async verifyContactByToken(token: string, type: 'email' | 'mobile', requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const tokenHash = hashToken(token);
    const verification = await db('contact_verifications')
      .where('type', type)
      .where('token_hash', tokenHash)
      .where('used', false)
      .where('expires_at', '>', new Date())
      .first();

    await this.consumeVerification(verification, type);
    log.info(`Contact verified by token: ${type}`, { userId: verification.user_id });
  }

  private static async consumeVerification(
    verification: { id: string; user_id: string; attempts: number; max_attempts: number } | undefined,
    type: 'email' | 'mobile',
  ): Promise<void> {
    if (!verification) {
      throw createAppError('Invalid or expired verification token', 400, 'INVALID_TOKEN');
    }

    if (verification.attempts >= verification.max_attempts) {
      throw createAppError('Maximum verification attempts exceeded', 429, 'MAX_ATTEMPTS');
    }

    await db.transaction(async (trx) => {
      await trx('contact_verifications')
        .where('id', verification.id)
        .increment('attempts', 1)
        .update({ used: true });

      const updateField = type === 'email' ? 'email_verified' : 'mobile_verified';
      await trx('users').where('id', verification.user_id).update({ [updateField]: true });
    });
  }

  static async getProfile(userId: string) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw createAppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const profile = await db('customer_profiles').where('user_id', userId).first();
    const consents = await db('consents').where('user_id', userId);

    return {
      id: user.id,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      status: user.status,
      emailVerified: user.email_verified,
      mobileVerified: user.mobile_verified,
      profile: profile
        ? {
            fullName: profile.full_name,
            avatarUrl: profile.avatar_url,
            dateOfBirth: profile.date_of_birth,
            gender: profile.gender,
          }
        : null,
      consents: consents.map((c) => ({
        type: c.consent_type,
        granted: c.granted,
      })),
      createdAt: user.created_at,
    };
  }

  static async updateProfile(userId: string, data: { fullName?: string; marketingConsent?: boolean }, requestId: string) {
    const log = createRequestLogger(requestId);

    await db.transaction(async (trx) => {
      if (data.fullName) {
        await trx('customer_profiles').where('user_id', userId).update({ full_name: data.fullName });
      }
      if (data.marketingConsent !== undefined) {
        await trx('consents')
          .where('user_id', userId)
          .where('consent_type', 'marketing')
          .update({ granted: data.marketingConsent });
        await trx('customer_profiles').where('user_id', userId).update({ marketing_consent: data.marketingConsent });
      }
    });

    log.info('Profile updated', { userId });
    return this.getProfile(userId);
  }
}
