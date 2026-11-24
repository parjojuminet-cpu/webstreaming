import type {
  ActivityLog,
  DelokenStoreState,
  Membership,
  Transaction,
} from '../types/deloken';

export interface ProjectAccessResult {
  unlocked: boolean;
  reason: 'individual_purchase' | 'active_membership' | 'locked';
  transactionId?: string;
  membershipId?: string;
  membershipExpiry?: string;
}

/**
 * Evaluates all memberships against current timestamp.
 * Expired memberships transition to 'expired' cleanly without affecting
 * individual paid project transactions.
 */
export function evaluateMembershipExpirations(
  memberships: Membership[],
  nowMs: number = Date.now()
): { updated: Membership[]; newlyExpired: Membership[] } {
  const newlyExpired: Membership[] = [];
  const updated = memberships.map((m) => {
    if (m.status === 'active') {
      const expiryMs = new Date(m.expiryDate).getTime();
      if (Number.isFinite(expiryMs) && expiryMs <= nowMs) {
        const expiredItem: Membership = { ...m, status: 'expired' };
        newlyExpired.push(expiredItem);
        return expiredItem;
      }
    }
    return m;
  });
  return { updated, newlyExpired };
}

export function getActiveMembership(
  userId: string,
  memberships: Membership[],
  transactions: Transaction[],
  nowMs: number = Date.now()
): Membership | null {
  for (const m of memberships) {
    if (m.userId !== userId || m.status !== 'active') continue;
    const expiryMs = new Date(m.expiryDate).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) continue;
    const linkedTx = transactions.find((tx) => tx.id === m.transactionId);
    if (linkedTx && linkedTx.status === 'paid') {
      return m;
    }
  }
  return null;
}

export function getLatestExpiredMembership(
  userId: string,
  memberships: Membership[]
): Membership | null {
  const expired = memberships
    .filter((m) => m.userId === userId && m.status === 'expired')
    .sort((a, b) => new Date(b.expiryDate).getTime() - new Date(a.expiryDate).getTime());
  return expired[0] ?? null;
}

/**
 * Fungsi kontrol akses terpusat:
 * - Gratis: dapat mengakses ringkasan
 * - Belum lunas: hanya menonton maksimal 5 menit
 * - Pembelian proyek: membuka proyek terkait
 * - Membership aktif: membuka seluruh proyek
 * - Membership kedaluwarsa: akses tetap dihitung dari pembelian individual yang masih valid
 */
export function canAccessProject(
  userId: string,
  projectId: string,
  state: Pick<DelokenStoreState, 'transactions' | 'memberships'>,
  nowMs: number = Date.now()
): ProjectAccessResult {
  const paidIndividual = state.transactions.find(
    (tx) =>
      tx.userId === userId &&
      tx.projectId === projectId &&
      tx.status === 'paid'
  );

  if (paidIndividual) {
    return {
      unlocked: true,
      reason: 'individual_purchase',
      transactionId: paidIndividual.id,
    };
  }

  const activeMembership = getActiveMembership(
    userId,
    state.memberships,
    state.transactions,
    nowMs
  );

  if (activeMembership) {
    return {
      unlocked: true,
      reason: 'active_membership',
      membershipId: activeMembership.id,
      membershipExpiry: activeMembership.expiryDate,
    };
  }

  return { unlocked: false, reason: 'locked' };
}

export function buildExpiryLogs(
  newlyExpired: Membership[],
  actorName: string
): ActivityLog[] {
  return newlyExpired.map((m) => ({
    id: `log_exp_${m.id}_${Date.now()}`,
    actorId: m.userId,
    actorName,
    action: 'membership_expired',
    entityId: m.id,
    timestamp: new Date().toISOString(),
    details: `Membership ${m.id} expired (${m.expiryDate}). Individual project purchases preserved.`,
  }));
}
