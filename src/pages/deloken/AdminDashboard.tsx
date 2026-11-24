import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  EyeOff,
  FileCheck2,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import {
  PublicationStatusBadge,
  TransactionStatusBadge,
} from '../../components/deloken/StatusBadge';
import {
  CATEGORY_LABELS,
  getTranslation,
  PROVIDER_LABELS,
} from '../../data/translations';
import { usePersistentState } from '../../hooks/usePersistentState';
import type { PublicationStatus, TransactionStatus } from '../../types/deloken';
import { formatIdr, formatUsd } from '../../utils/currency';

type AdminTab = 'curation' | 'payments' | 'logs';

export const AdminDashboard: React.FC = () => {
  const {
    state,
    adminCurateProject,
    adminApproveTransaction,
    adminRejectTransaction,
    adminRefundTransaction,
    simulateExpireActiveMemberships,
    resetDemoData,
  } = usePersistentState();

  const language = state.language;
  const t = getTranslation(language);

  const [activeTab, setActiveTab] = useState<AdminTab>('curation');
  const [curationFilter, setCurationFilter] = useState<PublicationStatus | 'all'>('all');
  const [paymentFilter, setPaymentFilter] = useState<TransactionStatus | 'all'>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    state.projects[0]?.id ?? null
  );
  const [curationNotes, setCurationNotes] = useState<Record<string, string>>({});
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [adminToast, setAdminToast] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    if (curationFilter === 'all') return state.projects;
    return state.projects.filter((p) => p.publicationStatus === curationFilter);
  }, [state.projects, curationFilter]);

  const inspectedProject = useMemo(
    () =>
      filteredProjects.find((p) => p.id === selectedProjectId) ??
      filteredProjects[0] ??
      null,
    [filteredProjects, selectedProjectId]
  );

  const filteredTransactions = useMemo(() => {
    if (paymentFilter === 'all') return state.transactions;
    return state.transactions.filter((tx) => tx.status === paymentFilter);
  }, [state.transactions, paymentFilter]);

  const pendingQrisCount = state.transactions.filter(
    (tx) => tx.status === 'pending_verification'
  ).length;
  const pendingProjectsCount = state.projects.filter(
    (p) => p.publicationStatus === 'pending_review'
  ).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-emerald-700">
            DELOKEN Governance & Verification
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
            {t.admin.title}
          </h1>
          <p className="text-sm text-slate-600">{t.admin.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => setConfirmResetOpen(true)}
          className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-800 cursor-pointer self-start sm:self-auto shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.admin.btnResetDemo}</span>
        </button>
      </div>

      {adminToast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
          <span>{adminToast}</span>
          <button
            type="button"
            onClick={() => setAdminToast(null)}
            className="font-semibold underline cursor-pointer"
          >
            OK
          </button>
        </div>
      )}

      {/* Main Admin Tabs */}
      <div
        role="tablist"
        aria-label="DELOKEN Admin tabs"
        className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'curation'}
          onClick={() => setActiveTab('curation')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors ${
            activeTab === 'curation'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          <span>
            {t.admin.tabCuration} ({pendingProjectsCount})
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'payments'}
          onClick={() => setActiveTab('payments')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors ${
            activeTab === 'payments'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>
            {t.admin.tabPayments} ({pendingQrisCount})
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'logs'}
          onClick={() => setActiveTab('logs')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors ${
            activeTab === 'logs'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>
            {t.admin.tabLogs} ({state.activityLogs.length})
          </span>
        </button>
      </div>

      {/* TAB 1: CURATION MANAGEMENT */}
      {activeTab === 'curation' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                'all',
                'pending_review',
                'published',
                'revision_requested',
                'rejected',
                'unpublished',
              ] as const
            ).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setCurationFilter(status)}
                className={`min-h-[36px] px-3 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${
                  curationFilter === status
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {status === 'all'
                  ? language === 'id'
                    ? 'Semua'
                    : 'All'
                  : status.replace('_', ' ')}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Queue List */}
            <div className="lg:col-span-5 space-y-2.5">
              {filteredProjects.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">
                  {language === 'id'
                    ? 'Tidak ada proyek pada filter status ini.'
                    : 'No projects in this status filter.'}
                </div>
              ) : (
                filteredProjects.map((proj) => {
                  const selected = inspectedProject?.id === proj.id;
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => setSelectedProjectId(proj.id)}
                      className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer space-y-2 ${
                        selected
                          ? 'bg-emerald-50/70 border-emerald-400'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-sm text-slate-900 line-clamp-1">
                          {proj.title[language]}
                        </span>
                        <PublicationStatusBadge
                          status={proj.publicationStatus}
                          language={language}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono">{proj.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{proj.creatorName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{PROVIDER_LABELS[proj.videoProvider][language]}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Detailed Curation Panel */}
            <div className="lg:col-span-7">
              {inspectedProject ? (
                <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className="font-mono text-xs text-slate-500">
                        {inspectedProject.id}
                      </span>
                      <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
                        {inspectedProject.title[language]}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {inspectedProject.creatorName} ·{' '}
                        {CATEGORY_LABELS[inspectedProject.category][language]} ·{' '}
                        {formatIdr(inspectedProject.pricing.idr)} /{' '}
                        {formatUsd(inspectedProject.pricing.usd)}
                      </p>
                    </div>
                    <PublicationStatusBadge
                      status={inspectedProject.publicationStatus}
                      language={language}
                    />
                  </div>

                  <div className="space-y-3 text-xs sm:text-sm text-slate-700">
                    <div>
                      <span className="font-semibold text-slate-900 block mb-1">
                        {language === 'id' ? 'Deskripsi' : 'Description'}
                      </span>
                      <p className="text-slate-600">
                        {inspectedProject.description[language]}
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-xs font-semibold text-slate-900 block">
                        {PROVIDER_LABELS[inspectedProject.videoProvider][language]}
                      </span>
                      <p className="font-mono text-xs text-slate-600 break-all">
                        {inspectedProject.videoUrl}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-xs font-semibold text-slate-900 block mb-1">
                          {language === 'id' ? 'Bahan' : 'Materials'} (
                          {inspectedProject.materials[language].length})
                        </span>
                        <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600">
                          {inspectedProject.materials[language].map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-xs font-semibold text-slate-900 block mb-1">
                          {language === 'id' ? 'Langkah' : 'Steps'} (
                          {inspectedProject.steps[language].length})
                        </span>
                        <ul className="space-y-1 text-xs text-slate-600">
                          {inspectedProject.steps[language].map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-xs font-semibold text-slate-900 block mb-1">
                        {language === 'id' ? 'Lampiran' : 'Attachments'} (
                        {inspectedProject.attachments.length})
                      </span>
                      {inspectedProject.attachments.length === 0 ? (
                        <p className="text-xs text-slate-500">None</p>
                      ) : (
                        inspectedProject.attachments.map((att) => (
                          <div key={att.id} className="text-xs text-slate-600 break-all">
                            {att.name} ({att.sizeLabel}) — {att.url}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Admin Moderation Note + Decision Controls */}
                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    <label className="block text-xs font-semibold text-slate-700">
                      {language === 'id'
                        ? 'Catatan Kurasi / Penolakan / Revisi'
                        : 'Curation / Rejection / Revision Note'}
                    </label>
                    <input
                      type="text"
                      value={
                        curationNotes[inspectedProject.id] ??
                        inspectedProject.adminNote ??
                        ''
                      }
                      onChange={(e) =>
                        setCurationNotes((prev) => ({
                          ...prev,
                          [inspectedProject.id]: e.target.value,
                        }))
                      }
                      placeholder={
                        language === 'id'
                          ? 'Opsional: alasan penolakan atau instruksi revisi...'
                          : 'Optional: rejection reason or revision feedback...'
                      }
                      className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900"
                    />

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          adminCurateProject(
                            inspectedProject.id,
                            'published',
                            curationNotes[inspectedProject.id]
                          );
                          setAdminToast(
                            `Project ${inspectedProject.id} published to Viewer catalog.`
                          );
                        }}
                        className="min-h-[40px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t.admin.btnApprovePublish}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          adminCurateProject(
                            inspectedProject.id,
                            'revision_requested',
                            curationNotes[inspectedProject.id] ||
                              'Please refine video source or materials.'
                          );
                          setAdminToast(
                            `Revision requested for ${inspectedProject.id}.`
                          );
                        }}
                        className="min-h-[40px] px-3.5 py-2 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>{t.admin.btnRequestRevision}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          adminCurateProject(
                            inspectedProject.id,
                            'rejected',
                            curationNotes[inspectedProject.id] ||
                              'Did not meet curation criteria.'
                          );
                          setAdminToast(`Project ${inspectedProject.id} rejected.`);
                        }}
                        className="min-h-[40px] px-3.5 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{t.admin.btnReject}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          adminCurateProject(
                            inspectedProject.id,
                            'unpublished',
                            curationNotes[inspectedProject.id]
                          );
                          setAdminToast(
                            `Project ${inspectedProject.id} unpublished from catalog (existing purchases preserved).`
                          );
                        }}
                        className="min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>{t.admin.btnUnpublish}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PAYMENT MANAGEMENT */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                'all',
                'pending_verification',
                'paid',
                'rejected',
                'refunded',
              ] as const
            ).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setPaymentFilter(status)}
                className={`min-h-[36px] px-3 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${
                  paymentFilter === status
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {status === 'all'
                  ? language === 'id'
                    ? 'Semua'
                    : 'All'
                  : status.replace('_', ' ')}
              </button>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Transaction ID</th>
                    <th className="py-3 px-4">{language === 'id' ? 'Pengguna' : 'User'}</th>
                    <th className="py-3 px-4">{language === 'id' ? 'Proyek / Paket' : 'Project / Plan'}</th>
                    <th className="py-3 px-4">{language === 'id' ? 'Metode' : 'Method'}</th>
                    <th className="py-3 px-4 text-right">{language === 'id' ? 'Nominal' : 'Amount'}</th>
                    <th className="py-3 px-4">{language === 'id' ? 'Tanggal' : 'Date'}</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">{language === 'id' ? 'Aksi' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 px-4 text-center text-slate-500">
                        {language === 'id'
                          ? 'Belum ada transaksi pada filter ini.'
                          : 'No transactions found for this filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-900 whitespace-nowrap">
                          {tx.id}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-800 whitespace-nowrap">
                          {tx.userName}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-medium text-slate-900">
                          {tx.targetTitle}
                        </td>
                        <td className="py-3.5 px-4 text-xs uppercase text-slate-600">
                          {tx.method}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-900 whitespace-nowrap">
                          {tx.currency === 'IDR'
                            ? formatIdr(tx.finalAmount)
                            : formatUsd(tx.finalAmount)}
                          {tx.uniqueCode > 0 && (
                            <span className="block text-[10px] text-emerald-700 font-normal">
                              code +{tx.uniqueCode}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleString(
                            language === 'id' ? 'id-ID' : 'en-US'
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <TransactionStatusBadge
                            status={tx.status}
                            language={language}
                          />
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {tx.status === 'pending_verification' && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  adminApproveTransaction(tx.id);
                                  setAdminToast(
                                    `Transaction ${tx.id} approved -> Paid & unlocked.`
                                  );
                                }}
                                className="min-h-[34px] px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                              >
                                {t.admin.btnApprovePayment}
                              </button>
                              <button
                                type="button"
                                onClick={() => adminRejectTransaction(tx.id)}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 text-xs font-semibold cursor-pointer"
                              >
                                {t.admin.btnRejectPayment}
                              </button>
                            </div>
                          )}
                          {tx.status === 'paid' && (
                            <button
                              type="button"
                              onClick={() => adminRefundTransaction(tx.id)}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                            >
                              {t.admin.btnRefundPayment}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ACTIVITY LOG & PROTOTYPE CONTROLS */}
      {activeTab === 'logs' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="font-display text-sm font-bold text-slate-900">
                {language === 'id'
                  ? 'Pengujian Siklus Membership (TEST 07)'
                  : 'Membership Lifecycle Tester (TEST 07)'}
              </h2>
              <p className="text-xs text-slate-500">
                {language === 'id'
                  ? 'Uji kedaluwarsa membership aktif untuk memastikan pembelian proyek individual tetap berlaku.'
                  : 'Simulate expiration of active memberships to verify individual project purchases remain unlocked.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const count = simulateExpireActiveMemberships();
                setAdminToast(
                  count > 0
                    ? `Simulated expiry for ${count} active membership(s).`
                    : 'No active membership to expire.'
                );
              }}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold cursor-pointer shrink-0"
            >
              {language === 'id'
                ? 'Simulasikan Membership Kedaluwarsa'
                : 'Simulate Membership Expiry'}
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Activity Log
              </h3>
              <span className="font-mono tabular-nums text-xs text-slate-500">
                {state.activityLogs.length} events
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
              {state.activityLogs.map((log) => (
                <div
                  key={log.id}
                  className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold text-emerald-700">
                        {log.action}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-medium text-slate-900">{log.actorName}</span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-mono text-slate-500">{log.entityId}</span>
                    </div>
                    <p className="text-slate-600">{log.details}</p>
                  </div>
                  <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                    {new Date(log.timestamp).toLocaleString(
                      language === 'id' ? 'id-ID' : 'en-US'
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Reset Demo Data */}
      {confirmResetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="font-display text-base font-bold text-slate-900">
                  {t.admin.resetConfirmTitle}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {t.admin.resetConfirmDesc}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmResetOpen(false)}
                className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {language === 'id' ? 'Batal' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetDemoData();
                  setConfirmResetOpen(false);
                  setAdminToast('Demo data reset to initial state.');
                }}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                {t.admin.btnResetDemo}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
