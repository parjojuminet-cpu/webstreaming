import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  buildExpiryLogs,
  canAccessProject,
  evaluateMembershipExpirations,
  type ProjectAccessResult,
} from '../services/accessService';
import {
  createInstantPaidTransaction,
  createQrisPendingTransaction,
  findExistingPendingQrisOrder,
  generateStableUniqueCode,
} from '../services/delokenPaymentService';
import {
  loadDelokenState,
  persistDelokenState,
  resetDelokenDemoData,
} from '../services/storageService';
import type {
  ActivityLog,
  CurrencyCode,
  DelokenStoreState,
  LanguageCode,
  PaymentMethod,
  Project,
  ProjectAttachment,
  ProjectCategory,
  PublicationStatus,
  RoleMode,
  Transaction,
  VideoProvider,
} from '../types/deloken';

export interface SubmitProjectInput {
  editingProjectId?: string | null;
  titleId: string;
  titleEn: string;
  category: ProjectCategory;
  priceIdr: number;
  priceUsd: number;
  descriptionId: string;
  descriptionEn: string;
  materialsId: string[];
  materialsEn: string[];
  stepsId: string[];
  stepsEn: string[];
  videoProvider: VideoProvider;
  videoUrl: string;
  videoNote: string;
  duration: string;
  thumbnailUrl: string;
  attachment: ProjectAttachment | null;
}

interface PendingUniqueDraft {
  key: string;
  uniqueCode: number;
}

interface DelokenContextValue {
  state: DelokenStoreState;
  activeUserId: string;
  activeUserName: string;
  setActiveRole: (role: RoleMode) => void;
  setLanguage: (lang: LanguageCode) => void;
  dismissStorageWarning: () => void;
  checkProjectAccess: (projectId: string) => ProjectAccessResult;
  getOrCreateQrisUniqueCode: (projectId: string | null, isMembership: boolean) => number;
  submitQrisPending: (input: {
    projectId: string | null;
    targetTitle: string;
    baseAmountIdr: number;
    isMembership: boolean;
  }) => { transaction: Transaction; isDuplicate: boolean };
  simulateInstantQris: (input: {
    projectId: string | null;
    targetTitle: string;
    baseAmountIdr: number;
    isMembership: boolean;
  }) => Transaction;
  submitSimulatedPayPalOrCard: (input: {
    projectId: string | null;
    targetTitle: string;
    method: Extract<PaymentMethod, 'paypal' | 'card'>;
    baseAmountUsd: number;
    isMembership: boolean;
  }) => Transaction;
  submitCreatorProject: (input: SubmitProjectInput) => Project;
  adminCurateProject: (
    projectId: string,
    nextStatus: Extract<PublicationStatus, 'published' | 'rejected' | 'revision_requested' | 'unpublished'>,
    adminNote?: string
  ) => void;
  adminApproveTransaction: (transactionId: string) => void;
  adminRejectTransaction: (transactionId: string) => void;
  adminRefundTransaction: (transactionId: string) => void;
  simulateExpireActiveMemberships: () => number;
  resetDemoData: () => void;
}

const DelokenContext = createContext<DelokenContextValue | null>(null);

export const DelokenProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<DelokenStoreState>(() => loadDelokenState());
  const [draftUniqueCodes, setDraftUniqueCodes] = useState<PendingUniqueDraft[]>([]);

  // Active simulated user account stays stable across role switches (Viewer / Creator / Admin)
  const viewerUser = state.users.find((u) => u.role === 'viewer') ?? state.users[0];
  const creatorUser = state.users.find((u) => u.role === 'creator') ?? state.users[1] ?? viewerUser;
  const adminUser = state.users.find((u) => u.role === 'admin') ?? state.users[2] ?? viewerUser;

  const activeUserId = viewerUser.id;
  const activeUserName = viewerUser.name;

  // Persist every centralized state change immediately
  useEffect(() => {
    persistDelokenState(state);
  }, [state]);

  // Evaluate membership expirations cleanly on mount & periodically
  useEffect(() => {
    const checkExpiry = () => {
      setState((prev) => {
        const { updated, newlyExpired } = evaluateMembershipExpirations(prev.memberships);
        if (newlyExpired.length === 0) return prev;
        return {
          ...prev,
          memberships: updated,
          activityLogs: [
            ...buildExpiryLogs(newlyExpired, 'System Scheduler'),
            ...prev.activityLogs,
          ],
        };
      });
    };
    checkExpiry();
    const timer = window.setInterval(checkExpiry, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const setActiveRole = useCallback((role: RoleMode) => {
    setState((prev) => ({ ...prev, activeRole: role }));
  }, []);

  const setLanguage = useCallback((language: LanguageCode) => {
    setState((prev) => ({ ...prev, language }));
  }, []);

  const dismissStorageWarning = useCallback(() => {
    setState((prev) => ({ ...prev, storageWarning: null }));
  }, []);

  const checkProjectAccess = useCallback(
    (projectId: string) => canAccessProject(activeUserId, projectId, state),
    [activeUserId, state]
  );

  const getOrCreateQrisUniqueCode = useCallback(
    (projectId: string | null, isMembership: boolean): number => {
      const existingPending = findExistingPendingQrisOrder(
        state.transactions,
        activeUserId,
        projectId,
        isMembership
      );
      if (existingPending) return existingPending.uniqueCode;

      const key = `${activeUserId}:${isMembership ? 'membership' : projectId ?? 'none'}`;
      const existingDraft = draftUniqueCodes.find((d) => d.key === key);
      if (existingDraft) return existingDraft.uniqueCode;

      const code = generateStableUniqueCode();
      setDraftUniqueCodes((prev) => [...prev.filter((d) => d.key !== key), { key, uniqueCode: code }]);
      return code;
    },
    [activeUserId, draftUniqueCodes, state.transactions]
  );

  const submitQrisPending = useCallback(
    (input: {
      projectId: string | null;
      targetTitle: string;
      baseAmountIdr: number;
      isMembership: boolean;
    }) => {
      const existingPending = findExistingPendingQrisOrder(
        state.transactions,
        activeUserId,
        input.projectId,
        input.isMembership
      );
      if (existingPending) {
        return { transaction: existingPending, isDuplicate: true };
      }

      const uniqueCode = getOrCreateQrisUniqueCode(input.projectId, input.isMembership);
      const created = createQrisPendingTransaction({
        userId: activeUserId,
        userName: activeUserName,
        projectId: input.projectId,
        targetTitle: input.targetTitle,
        baseAmountIdr: input.baseAmountIdr,
        uniqueCode,
        isMembership: input.isMembership,
      });

      setState((prev) => ({
        ...prev,
        transactions: [created.transaction, ...prev.transactions],
        memberships: created.membership
          ? [created.membership, ...prev.memberships]
          : prev.memberships,
        activityLogs: [created.log, ...prev.activityLogs],
      }));

      return { transaction: created.transaction, isDuplicate: false };
    },
    [activeUserId, activeUserName, getOrCreateQrisUniqueCode, state.transactions]
  );

  const simulateInstantQris = useCallback(
    (input: {
      projectId: string | null;
      targetTitle: string;
      baseAmountIdr: number;
      isMembership: boolean;
    }) => {
      const uniqueCode = getOrCreateQrisUniqueCode(input.projectId, input.isMembership);
      const created = createInstantPaidTransaction({
        userId: activeUserId,
        userName: activeUserName,
        projectId: input.projectId,
        targetTitle: input.targetTitle,
        method: 'qris',
        currency: 'IDR',
        baseAmount: input.baseAmountIdr,
        uniqueCode,
        isMembership: input.isMembership,
        isSimulatedInstant: true,
      });

      setState((prev) => {
        // Resolve any duplicate pending order for this exact item if user clicks instant test
        const cleanedTx = prev.transactions.filter(
          (tx) =>
            !(
              tx.userId === activeUserId &&
              tx.status === 'pending_verification' &&
              (input.isMembership ? tx.membershipId !== null : tx.projectId === input.projectId)
            )
        );
        return {
          ...prev,
          transactions: [created.transaction, ...cleanedTx],
          memberships: created.membership
            ? [created.membership, ...prev.memberships]
            : prev.memberships,
          activityLogs: [...created.logs, ...prev.activityLogs],
        };
      });

      return created.transaction;
    },
    [activeUserId, activeUserName, getOrCreateQrisUniqueCode]
  );

  const submitSimulatedPayPalOrCard = useCallback(
    (input: {
      projectId: string | null;
      targetTitle: string;
      method: Extract<PaymentMethod, 'paypal' | 'card'>;
      baseAmountUsd: number;
      isMembership: boolean;
    }) => {
      const created = createInstantPaidTransaction({
        userId: activeUserId,
        userName: activeUserName,
        projectId: input.projectId,
        targetTitle: input.targetTitle,
        method: input.method,
        currency: 'USD' as CurrencyCode,
        baseAmount: input.baseAmountUsd,
        uniqueCode: 0,
        isMembership: input.isMembership,
        isSimulatedInstant: true,
      });

      setState((prev) => ({
        ...prev,
        transactions: [created.transaction, ...prev.transactions],
        memberships: created.membership
          ? [created.membership, ...prev.memberships]
          : prev.memberships,
        activityLogs: [...created.logs, ...prev.activityLogs],
      }));

      return created.transaction;
    },
    [activeUserId, activeUserName]
  );

  const submitCreatorProject = useCallback(
    (input: SubmitProjectInput): Project => {
      const now = new Date().toISOString();
      const isEdit = Boolean(input.editingProjectId);
      const id = input.editingProjectId || `DLK-PRJ-${Date.now().toString(36).toUpperCase()}`;

      const project: Project = {
        id,
        creatorId: creatorUser.id,
        creatorName: creatorUser.name,
        title: {
          id: input.titleId.trim(),
          en: input.titleEn.trim(),
        },
        description: {
          id: input.descriptionId.trim(),
          en: input.descriptionEn.trim(),
        },
        category: input.category,
        pricing: {
          idr: Math.max(0, Math.round(input.priceIdr)),
          usd: Math.max(0, Number(input.priceUsd.toFixed(2))),
        },
        videoProvider: input.videoProvider,
        videoUrl: input.videoUrl.trim(),
        videoNote: input.videoNote.trim(),
        thumbnailUrl: input.thumbnailUrl,
        attachments: input.attachment ? [input.attachment] : [],
        materials: {
          id: input.materialsId,
          en: input.materialsEn,
        },
        steps: {
          id: input.stepsId,
          en: input.stepsEn,
        },
        duration: input.duration || '25:00',
        durationSeconds: 1500,
        publicationStatus: 'pending_review',
        adminNote: '',
        createdAt: isEdit
          ? state.projects.find((p) => p.id === id)?.createdAt ?? now
          : now,
        updatedAt: now,
      };

      const log: ActivityLog = {
        id: `log_sub_${id}_${Date.now()}`,
        actorId: creatorUser.id,
        actorName: creatorUser.name,
        action: isEdit ? 'project_resubmitted' : 'project_submitted',
        entityId: id,
        timestamp: now,
        details: `${isEdit ? 'Project updated and resubmitted' : 'New project submitted'}: "${project.title.en}" (${project.videoProvider}) -> Pending Review.`,
      };

      setState((prev) => ({
        ...prev,
        projects: isEdit
          ? prev.projects.map((p) => (p.id === id ? project : p))
          : [project, ...prev.projects],
        activityLogs: [log, ...prev.activityLogs],
      }));

      return project;
    },
    [creatorUser.id, creatorUser.name, state.projects]
  );

  const adminCurateProject = useCallback(
    (
      projectId: string,
      nextStatus: Extract<
        PublicationStatus,
        'published' | 'rejected' | 'revision_requested' | 'unpublished'
      >,
      adminNote?: string
    ) => {
      const now = new Date().toISOString();
      const actionMap: Record<typeof nextStatus, ActivityLog['action']> = {
        published: 'project_published',
        rejected: 'project_rejected',
        revision_requested: 'project_revision_requested',
        unpublished: 'project_unpublished',
      };

      setState((prev) => {
        const target = prev.projects.find((p) => p.id === projectId);
        if (!target) return prev;

        const updatedProjects = prev.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                publicationStatus: nextStatus,
                adminNote:
                  typeof adminNote === 'string' ? adminNote.trim() : p.adminNote,
                updatedAt: now,
              }
            : p
        );

        const log: ActivityLog = {
          id: `log_cur_${projectId}_${Date.now()}`,
          actorId: adminUser.id,
          actorName: adminUser.name,
          action: actionMap[nextStatus],
          entityId: projectId,
          timestamp: now,
          details: `Admin set "${target.title.en}" status -> ${nextStatus}${
            adminNote ? ` (Note: ${adminNote.trim()})` : ''
          }.`,
        };

        return {
          ...prev,
          projects: updatedProjects,
          activityLogs: [log, ...prev.activityLogs],
        };
      });
    },
    [adminUser.id, adminUser.name]
  );

  const adminApproveTransaction = useCallback(
    (transactionId: string) => {
      const now = new Date().toISOString();
      setState((prev) => {
        const targetTx = prev.transactions.find((t) => t.id === transactionId);
        if (!targetTx) return prev;

        const updatedTransactions = prev.transactions.map((t) =>
          t.id === transactionId
            ? { ...t, status: 'paid' as const, verifiedAt: now }
            : t
        );

        let extraLogs: ActivityLog[] = [
          {
            id: `log_adm_pay_${transactionId}_${Date.now()}`,
            actorId: adminUser.id,
            actorName: adminUser.name,
            action: 'payment_verified',
            entityId: transactionId,
            timestamp: now,
            details: `Admin approved transaction ${transactionId} (${targetTx.targetTitle}) -> Paid.`,
          },
        ];

        const updatedMemberships = prev.memberships.map((m) => {
          if (m.transactionId === transactionId) {
            const expiry = new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000
            ).toISOString();
            extraLogs = [
              ...extraLogs,
              {
                id: `log_mem_act_${m.id}_${Date.now()}`,
                actorId: adminUser.id,
                actorName: adminUser.name,
                action: 'membership_activated',
                entityId: m.id,
                timestamp: now,
                details: `All-Access Membership ${m.id} activated after QRIS approval until ${expiry}.`,
              },
            ];
            return {
              ...m,
              status: 'active' as const,
              startDate: now,
              expiryDate: expiry,
            };
          }
          return m;
        });

        return {
          ...prev,
          transactions: updatedTransactions,
          memberships: updatedMemberships,
          activityLogs: [...extraLogs, ...prev.activityLogs],
        };
      });
    },
    [adminUser.id, adminUser.name]
  );

  const adminRejectTransaction = useCallback(
    (transactionId: string) => {
      const now = new Date().toISOString();
      setState((prev) => {
        const targetTx = prev.transactions.find((t) => t.id === transactionId);
        if (!targetTx) return prev;
        return {
          ...prev,
          transactions: prev.transactions.map((t) =>
            t.id === transactionId
              ? { ...t, status: 'rejected' as const, verifiedAt: now }
              : t
          ),
          memberships: prev.memberships.map((m) =>
            m.transactionId === transactionId
              ? { ...m, status: 'expired' as const }
              : m
          ),
          activityLogs: [
            {
              id: `log_adm_rej_${transactionId}_${Date.now()}`,
              actorId: adminUser.id,
              actorName: adminUser.name,
              action: 'payment_rejected',
              entityId: transactionId,
              timestamp: now,
              details: `Admin rejected transaction ${transactionId} (${targetTx.targetTitle}).`,
            },
            ...prev.activityLogs,
          ],
        };
      });
    },
    [adminUser.id, adminUser.name]
  );

  const adminRefundTransaction = useCallback(
    (transactionId: string) => {
      const now = new Date().toISOString();
      setState((prev) => {
        const targetTx = prev.transactions.find((t) => t.id === transactionId);
        if (!targetTx) return prev;
        return {
          ...prev,
          transactions: prev.transactions.map((t) =>
            t.id === transactionId ? { ...t, status: 'refunded' as const } : t
          ),
          memberships: prev.memberships.map((m) =>
            m.transactionId === transactionId
              ? { ...m, status: 'expired' as const }
              : m
          ),
          activityLogs: [
            {
              id: `log_adm_ref_${transactionId}_${Date.now()}`,
              actorId: adminUser.id,
              actorName: adminUser.name,
              action: 'payment_refunded',
              entityId: transactionId,
              timestamp: now,
              details: `Admin refunded transaction ${transactionId} (${targetTx.targetTitle}).`,
            },
            ...prev.activityLogs,
          ],
        };
      });
    },
    [adminUser.id, adminUser.name]
  );

  const simulateExpireActiveMemberships = useCallback((): number => {
    let expiredCount = 0;
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
    setState((prev) => {
      const activeIds = prev.memberships
        .filter((m) => m.status === 'active')
        .map((m) => m.id);
      expiredCount = activeIds.length;
      if (activeIds.length === 0) return prev;

      const updatedMemberships = prev.memberships.map((m) =>
        m.status === 'active'
          ? { ...m, status: 'expired' as const, expiryDate: pastDate }
          : m
      );
      const logs: ActivityLog[] = activeIds.map((id) => ({
        id: `log_sim_exp_${id}_${Date.now()}`,
        actorId: adminUser.id,
        actorName: adminUser.name,
        action: 'membership_expired',
        entityId: id,
        timestamp: new Date().toISOString(),
        details: `Simulated membership expiry for ${id}. Individual project purchases remain active.`,
      }));
      return {
        ...prev,
        memberships: updatedMemberships,
        activityLogs: [...logs, ...prev.activityLogs],
      };
    });
    return expiredCount;
  }, [adminUser.id, adminUser.name]);

  const resetDemoData = useCallback(() => {
    setDraftUniqueCodes([]);
    setState((prev) => resetDelokenDemoData(prev.activeRole, prev.language));
  }, []);

  return React.createElement(
    DelokenContext.Provider,
    {
      value: {
        state,
        activeUserId,
        activeUserName,
        setActiveRole,
        setLanguage,
        dismissStorageWarning,
        checkProjectAccess,
        getOrCreateQrisUniqueCode,
        submitQrisPending,
        simulateInstantQris,
        submitSimulatedPayPalOrCard,
        submitCreatorProject,
        adminCurateProject,
        adminApproveTransaction,
        adminRejectTransaction,
        adminRefundTransaction,
        simulateExpireActiveMemberships,
        resetDemoData,
      },
    },
    children
  );
};

export function usePersistentState(): DelokenContextValue {
  const ctx = useContext(DelokenContext);
  if (!ctx) {
    throw new Error('usePersistentState must be used inside DelokenProvider');
  }
  return ctx;
}
