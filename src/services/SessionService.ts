import { db } from '../config/database';

/**
 * express-session persists whole sessions as JSON in `sessions.sess`, and only
 * `userId` / `userRole` / `csrfToken` identify the owner. There is no user_id
 * column, so signing a user out everywhere means matching that JSON blob.
 * `CAST(sess AS CHAR)` keeps the LIKE portable (MySQL JSON columns reject a bare
 * LIKE, SQLite accepts the cast).
 */
function ownedBy(userId: string): [string, string[]] {
  return ['CAST(sess AS CHAR) LIKE ?', [`%"userId":"${userId}"%`]];
}

export class SessionService {
  /**
   * Destroys every session row for a user. Pass `keepSid` to leave the caller's
   * own session alive (used when a user changes their own password).
   * Returns the number of sessions signed out.
   */
  static async invalidateUserSessions(userId: string, keepSid?: string): Promise<number> {
    if (!(await db.schema.hasTable('sessions'))) return 0;

    const [clause, params] = ownedBy(userId);
    const query = db('sessions').whereRaw(clause, params);
    if (keepSid) query.whereNot('sid', keepSid);

    const removed = await query.del();
    return Number(removed || 0);
  }
}
