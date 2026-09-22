import { db } from '../config/database';
import { UserModel } from '../models/UserModel';
import { hashPassword, verifyPassword, generateToken, hashToken, generateOTP } from '../utils/crypto';
import { createAppError } from '../middleware/errorHandler';
import { Role } from '../middleware/auth';
import { createRequestLogger } from '../utils/logger';

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
      const newUser = await UserModel.create({
        email: input.email.toLowerCase().trim(),
        mobile: input.mobile,
        password_hash: passwordHash,
        role: 'customer' as Role,
        status: 'active',
        email_verified: false,
        mobile_verified: false,
      });

      const userId = (newUser as any).id;

      await trx('customer_profiles').insert({
        user_id: userId,
        full_name: input.fullName,
        marketing_consent: input.marketingConsent || false,
        loyalty_consent: input.loyaltyConsent,
      });

      await trx('consents').insert([
        {
          user_id: userId,
          consent_type: 'loyalty_program',
          granted: input.loyaltyConsent,
        },
        {
          user_id: userId,
          consent_type: 'marketing',
          granted: input.marketingConsent || false,
        },
      ]);

      log.info('Customer registered', { userId });
      return newUser;
    });

    const userId = (user as any).id;
    await this.sendVerificationEmail(userId, input.email, requestId);
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
    await UserModel.update(userId, { password_hash: newHash });

    log.info('Password changed', { userId });
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
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    log.info('Password reset token created', { userId: user.id });
  }

  static async resetPassword(token: string, newPassword: string, requestId: string): Promise<void> {
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
    });

    log.info('Password reset completed', { userId: resetToken.user_id });
  }

  static async sendVerificationEmail(userId: string, email: string, requestId: string): Promise<string> {
    const log = createRequestLogger(requestId);

    const token = generateToken();
    const tokenHash = hashToken(token);

    await db('contact_verifications').insert({
      user_id: userId,
      type: 'email',
      token_hash: tokenHash,
      contact_value: email.toLowerCase().trim(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      max_attempts: 5,
    });

    log.info('Email verification token created', { userId });
    return token;
  }

  static async sendVerificationOTP(userId: string, mobile: string, requestId: string): Promise<string> {
    const log = createRequestLogger(requestId);

    const otp = generateOTP(6);
    const otpHash = hashToken(otp);

    await db('contact_verifications').insert({
      user_id: userId,
      type: 'mobile',
      token_hash: otpHash,
      contact_value: mobile,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      max_attempts: 5,
    });

    log.info('Mobile verification OTP created', { userId });
    return otp;
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
      await trx('users').where('id', userId).update({ [updateField]: true });
    });

    log.info(`Contact verified: ${type}`, { userId });
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
