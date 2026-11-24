import type {
  ActivityLog,
  CurrencyCode,
  Membership,
  PaymentMethod,
  Transaction,
} from '../types/deloken';

export function generateStableUniqueCode(): number {
  return Math.floor(100 + Math.random() * 900); // 100..999
}

export function findExistingPendingQrisOrder(
  transactions: Transaction[],
  userId: string,
  projectId: string | null,
  isMembership: boolean
): Transaction | null {
  return (
    transactions.find(
      (tx) =>
        tx.userId === userId &&
        tx.method === 'qris' &&
        tx.status === 'pending_verification' &&
        (isMembership ? tx.membershipId !== null : tx.projectId === projectId)
    ) ?? null
  );
}

export function createQrisPendingTransaction(input: {
  userId: string;
  userName: string;
  projectId: string | null;
  targetTitle: string;
  baseAmountIdr: number;
  uniqueCode: number;
  isMembership: boolean;
}): {
  transaction: Transaction;
  membership: Membership | null;
  log: ActivityLog;
} {
  const now = new Date().toISOString();
  const txId = `DLK-QRIS-${Date.now().toString(36).toUpperCase()}`;
  const membershipId = input.isMembership
    ? `MEM-${Date.now().toString(36).toUpperCase()}`
    : null;

  const transaction: Transaction = {
    id: txId,
    userId: input.userId,
    userName: input.userName,
    projectId: input.isMembership ? null : input.projectId,
    membershipId,
    targetTitle: input.targetTitle,
    method: 'qris',
    currency: 'IDR',
    amount: input.baseAmountIdr,
    uniqueCode: input.uniqueCode,
    finalAmount: input.baseAmountIdr + input.uniqueCode,
    status: 'pending_verification',
    createdAt: now,
    verifiedAt: null,
  };

  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const membership: Membership | null = membershipId
    ? {
        id: membershipId,
        userId: input.userId,
        status: 'pending',
        currency: 'IDR',
        startDate: now,
        expiryDate: expiry,
        transactionId: txId,
      }
    : null;

  const log: ActivityLog = {
    id: `log_${txId}`,
    actorId: input.userId,
    actorName: input.userName,
    action: 'payment_created',
    entityId: txId,
    timestamp: now,
    details: `QRIS payment created (${input.targetTitle}) — Rp${transaction.finalAmount.toLocaleString('id-ID')} (Code: ${input.uniqueCode}) -> Pending Verification.`,
  };

  return { transaction, membership, log };
}

export function createInstantPaidTransaction(input: {
  userId: string;
  userName: string;
  projectId: string | null;
  targetTitle: string;
  method: PaymentMethod;
  currency: CurrencyCode;
  baseAmount: number;
  uniqueCode: number;
  isMembership: boolean;
  isSimulatedInstant?: boolean;
}): {
  transaction: Transaction;
  membership: Membership | null;
  logs: ActivityLog[];
} {
  const now = new Date().toISOString();
  const prefix =
    input.method === 'qris'
      ? 'DLK-QRIS-SIM'
      : input.method === 'paypal'
      ? 'DLK-PP'
      : 'DLK-CARD';
  const txId = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
  const membershipId = input.isMembership
    ? `MEM-${Date.now().toString(36).toUpperCase()}`
    : null;

  const effectiveUniqueCode = input.method === 'qris' ? input.uniqueCode : 0;
  const transaction: Transaction = {
    id: txId,
    userId: input.userId,
    userName: input.userName,
    projectId: input.isMembership ? null : input.projectId,
    membershipId,
    targetTitle: input.targetTitle,
    method: input.method,
    currency: input.currency,
    amount: input.baseAmount,
    uniqueCode: effectiveUniqueCode,
    finalAmount: input.baseAmount + effectiveUniqueCode,
    status: 'paid',
    isSimulatedInstant: Boolean(input.isSimulatedInstant),
    createdAt: now,
    verifiedAt: now,
  };

  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const membership: Membership | null = membershipId
    ? {
        id: membershipId,
        userId: input.userId,
        status: 'active',
        currency: input.currency,
        startDate: now,
        expiryDate: expiry,
        transactionId: txId,
      }
    : null;

  const logs: ActivityLog[] = [
    {
      id: `log_pay_${txId}`,
      actorId: input.userId,
      actorName: input.userName,
      action: 'payment_verified',
      entityId: txId,
      timestamp: now,
      details: `${input.method.toUpperCase()} simulated payment completed (${input.targetTitle}) -> Paid.`,
    },
  ];

  if (membership) {
    logs.push({
      id: `log_mem_${membership.id}`,
      actorId: input.userId,
      actorName: input.userName,
      action: 'membership_activated',
      entityId: membership.id,
      timestamp: now,
      details: `All-Access Membership ${membership.id} activated until ${expiry}.`,
    });
  }

  return { transaction, membership, logs };
}
