import { db } from '../config/database';

export class ReportsService {
  static async getDashboardStats(): Promise<{
    pendingClaims: number;
    approvedClaims: number;
    rejectedClaims: number;
    totalPointsIssued: number;
    totalPointsRedeemed: number;
    outstandingPoints: number;
    totalCustomers: number;
    totalRedemptions: number;
  }> {
    const [claimStats] = await db('receipt_claims')
      .select(
        db.raw(
          'SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) as pendingClaims',
          ['PENDING_REVIEW', 'REQUEST_CLEARER_IMAGE'],
        ),
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as approvedClaims', ['APPROVED']),
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as rejectedClaims', ['REJECTED']),
      );

    const [pointsStats] = await db('points_ledger')
      .select(
        db.raw('SUM(CASE WHEN points > 0 THEN points ELSE 0 END) as totalPointsIssued'),
        db.raw('SUM(CASE WHEN points < 0 THEN ABS(points) ELSE 0 END) as totalPointsRedeemed'),
      );

    const [customerStats] = await db('users')
      .where('role', 'customer')
      .count('* as totalCustomers');

    const [redemptionStats] = await db('redemption_vouchers')
      .count('* as totalRedemptions');

    return {
      pendingClaims: Number(claimStats?.pendingClaims || 0),
      approvedClaims: Number(claimStats?.approvedClaims || 0),
      rejectedClaims: Number(claimStats?.rejectedClaims || 0),
      totalPointsIssued: Number(pointsStats?.totalPointsIssued || 0),
      totalPointsRedeemed: Number(pointsStats?.totalPointsRedeemed || 0),
      outstandingPoints: Number(pointsStats?.totalPointsIssued || 0) - Number(pointsStats?.totalPointsRedeemed || 0),
      totalCustomers: Number(customerStats?.totalCustomers || 0),
      totalRedemptions: Number(redemptionStats?.totalRedemptions || 0),
    };
  }

  static async getClaimVolumeReport(startDate: Date, endDate: Date): Promise<any[]> {
    return db('receipt_claims')
      .select(
        db.raw('DATE(created_at) as date'),
        db.raw('COUNT(*) as total'),
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as approved', ['APPROVED']),
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as rejected', ['REJECTED']),
        db.raw(
          'SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) as pending',
          ['PENDING_REVIEW', 'REQUEST_CLEARER_IMAGE'],
        ),
      )
      .where('created_at', '>=', startDate)
      .where('created_at', '<=', endDate)
      .groupBy(db.raw('DATE(created_at)'))
      .orderBy('date', 'asc');
  }

  static async getPointsReport(startDate: Date, endDate: Date): Promise<any[]> {
    return db('points_ledger')
      .select(
        db.raw('DATE(created_at) as date'),
        db.raw('SUM(CASE WHEN points > 0 THEN points ELSE 0 END) as issued'),
        db.raw('SUM(CASE WHEN points < 0 THEN ABS(points) ELSE 0 END) as redeemed'),
      )
      .where('created_at', '>=', startDate)
      .where('created_at', '<=', endDate)
      .groupBy(db.raw('DATE(created_at)'))
      .orderBy('date', 'asc');
  }

  static async getReviewerWorkload(): Promise<any[]> {
    return db('receipt_claims')
      .join('users', 'receipt_claims.reviewed_by', 'users.id')
      .select(
        'users.id as reviewerId',
        'users.email as reviewerEmail',
        db.raw('COUNT(*) as totalReviewed'),
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as approved', ['APPROVED']),
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as rejected', ['REJECTED']),
      )
      .where('receipt_claims.reviewed_by', 'is not', null)
      .groupBy('users.id', 'users.email');
  }

  static async getTopCustomers(limit: number = 10): Promise<any[]> {
    return db('users')
      .join('customer_profiles', 'users.id', 'customer_profiles.user_id')
      .select(
        'users.id',
        'customer_profiles.full_name',
        'users.email',
        db.raw('(SELECT SUM(points) FROM points_ledger WHERE customer_id = users.id) as totalPoints'),
        db.raw('(SELECT COUNT(*) FROM receipt_claims WHERE customer_id = users.id AND status = ?) as approvedClaims', ['APPROVED']),
      )
      .where('users.role', 'customer')
      .orderBy('totalPoints', 'desc')
      .limit(limit);
  }
}
