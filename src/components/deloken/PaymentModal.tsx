import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  QrCode,
  ShieldAlert,
  X,
} from 'lucide-react';
import { getTranslation } from '../../data/translations';
import { usePersistentState } from '../../hooks/usePersistentState';
import { findExistingPendingQrisOrder } from '../../services/delokenPaymentService';
import type { LanguageCode, Project } from '../../types/deloken';
import { formatIdr, formatUsd } from '../../utils/currency';

interface PaymentModalProps {
  isOpen: boolean;
  project: Project | null;
  defaultScope?: 'project' | 'membership';
  language: LanguageCode;
  onClose: () => void;
  onUnlocked: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  project,
  defaultScope = 'project',
  language,
  onClose,
  onUnlocked,
}) => {
  const {
    state,
    activeUserId,
    getOrCreateQrisUniqueCode,
    submitQrisPending,
    simulateInstantQris,
    submitSimulatedPayPalOrCard,
  } = usePersistentState();
  const t = getTranslation(language);

  // Manual method tab respected once user chooses; initializes according to active language
  const [methodTab, setMethodTab] = useState<'qris' | 'paypal'>(
    language === 'id' ? 'qris' : 'paypal'
  );
  const [hasManualMethodChoice, setHasManualMethodChoice] = useState(false);
  const [scope, setScope] = useState<'project' | 'membership'>(defaultScope);
  const [copiedNominal, setCopiedNominal] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!hasManualMethodChoice) {
      setMethodTab(language === 'id' ? 'qris' : 'paypal');
    }
  }, [language, hasManualMethodChoice]);

  useEffect(() => {
    if (isOpen) {
      setScope(project ? defaultScope : 'membership');
      setStatusMessage(null);
      setCopiedNominal(false);
    }
  }, [isOpen, defaultScope, project]);

  if (!isOpen) return null;

  const isMembership = scope === 'membership' || !project;
  const targetProjectId = isMembership ? null : project?.id ?? null;
  const targetTitle = isMembership
    ? language === 'id'
      ? 'DELOKEN All-Access Membership (30 Hari)'
      : 'DELOKEN All-Access Membership (30 Days)'
    : project?.title[language] ?? 'DELOKEN Project';

  const baseIdr = isMembership
    ? state.settings.membershipPriceIdr
    : project?.pricing.idr ?? 15000;
  const baseUsd = isMembership
    ? state.settings.membershipPriceUsd
    : project?.pricing.usd ?? 1.5;

  const uniqueCode = getOrCreateQrisUniqueCode(targetProjectId, isMembership);
  const finalIdr = baseIdr + uniqueCode;

  const existingPending = findExistingPendingQrisOrder(
    state.transactions,
    activeUserId,
    targetProjectId,
    isMembership
  );

  const handleCopyAmount = () => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(String(finalIdr));
    }
    setCopiedNominal(true);
    window.setTimeout(() => setCopiedNominal(false), 1800);
  };

  const handleConfirmQrisPaid = () => {
    const res = submitQrisPending({
      projectId: targetProjectId,
      targetTitle,
      baseAmountIdr: baseIdr,
      isMembership,
    });
    setStatusMessage(
      res.isDuplicate ? t.payment.duplicatePendingNote : t.payment.pendingCreated
    );
  };

  const handleSimInstantQris = () => {
    simulateInstantQris({
      projectId: targetProjectId,
      targetTitle,
      baseAmountIdr: baseIdr,
      isMembership,
    });
    onUnlocked();
    onClose();
  };

  const handleSimulatedPayPal = (method: 'paypal' | 'card') => {
    submitSimulatedPayPalOrCard({
      projectId: targetProjectId,
      targetTitle,
      method,
      baseAmountUsd: baseUsd,
      isMembership,
    });
    onUnlocked();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deloken-payment-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3
              id="deloken-payment-title"
              className="font-display text-base sm:text-lg font-bold text-slate-900"
            >
              {t.payment.title}
            </h3>
            <p className="text-xs text-slate-500">{t.payment.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment modal"
            className="w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[82dvh] overflow-y-auto">
          {/* Payment Method Tabs (Respects Manual Choice) */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setHasManualMethodChoice(true);
                setMethodTab('qris');
                setStatusMessage(null);
              }}
              className={`min-h-[40px] px-3 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                methodTab === 'qris'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <QrCode className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>{t.payment.tabQris}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setHasManualMethodChoice(true);
                setMethodTab('paypal');
                setStatusMessage(null);
              }}
              className={`min-h-[40px] px-3 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                methodTab === 'paypal'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>{t.payment.tabPaypal}</span>
            </button>
          </div>

          {/* Access Scope Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {project && (
              <button
                type="button"
                onClick={() => {
                  setScope('project');
                  setStatusMessage(null);
                }}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                  scope === 'project'
                    ? 'bg-emerald-50 border-emerald-400 text-slate-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-semibold">
                  {methodTab === 'qris' ? t.payment.optProjectIdr : t.payment.optProjectUsd}
                </div>
                <div className="font-mono tabular-nums text-sm font-bold text-emerald-700 mt-1">
                  {methodTab === 'qris'
                    ? formatIdr(project.pricing.idr)
                    : formatUsd(project.pricing.usd)}
                </div>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setScope('membership');
                setStatusMessage(null);
              }}
              className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                isMembership
                  ? 'bg-emerald-50 border-emerald-400 text-slate-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              } ${!project ? 'sm:col-span-2' : ''}`}
            >
              <div className="text-xs font-semibold">
                {methodTab === 'qris'
                  ? t.payment.optMembershipIdr
                  : t.payment.optMembershipUsd}
              </div>
              <div className="font-mono tabular-nums text-sm font-bold text-emerald-700 mt-1">
                {methodTab === 'qris'
                  ? `${formatIdr(state.settings.membershipPriceIdr)}/bln`
                  : `${formatUsd(state.settings.membershipPriceUsd)}/mo`}
              </div>
            </button>
          </div>

          {methodTab === 'qris' ? (
            <div className="space-y-4">
              {/* Unique Code Summary */}
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>{t.payment.baseAmount}</span>
                  <span className="font-mono tabular-nums">{formatIdr(baseIdr)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>{t.payment.uniqueCode}</span>
                  <span className="font-mono tabular-nums font-semibold text-emerald-700">
                    +{uniqueCode}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{t.payment.finalAmount}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-base font-bold text-slate-900">
                      {formatIdr(finalIdr)}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyAmount}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-medium text-slate-700 cursor-pointer"
                    >
                      {copiedNominal ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedNominal ? t.payment.copied : t.payment.copyNominal}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* QRIS Placeholder SVG */}
              <div className="p-4 rounded-lg border border-slate-200 bg-white flex flex-col items-center text-center gap-2.5">
                <div className="w-36 h-36 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center p-2">
                  <svg
                    viewBox="0 0 100 100"
                    className="w-full h-full text-slate-900"
                    aria-label="QRIS Merchant Placeholder"
                  >
                    <rect x="4" y="4" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="5" />
                    <rect x="11" y="11" width="12" height="12" fill="currentColor" />
                    <rect x="70" y="4" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="5" />
                    <rect x="77" y="11" width="12" height="12" fill="currentColor" />
                    <rect x="4" y="70" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="5" />
                    <rect x="11" y="77" width="12" height="12" fill="currentColor" />
                    <rect x="40" y="12" width="10" height="10" fill="currentColor" />
                    <rect x="54" y="20" width="8" height="8" fill="currentColor" />
                    <rect x="40" y="40" width="20" height="20" fill="#059669" />
                    <rect x="14" y="42" width="12" height="10" fill="currentColor" />
                    <rect x="72" y="42" width="14" height="10" fill="currentColor" />
                    <rect x="42" y="70" width="16" height="10" fill="currentColor" />
                    <rect x="70" y="70" width="22" height="14" fill="currentColor" />
                  </svg>
                </div>
                <p className="text-xs font-semibold text-slate-900">
                  {t.payment.qrisPlaceholderLabel}
                </p>
                <p className="text-[11px] text-slate-500 max-w-xs">
                  {t.payment.qrisPlaceholderDesc}
                </p>
              </div>

              {existingPending && !statusMessage && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{t.payment.duplicatePendingNote}</span>
                </div>
              )}

              {statusMessage && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{statusMessage}</span>
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={handleConfirmQrisPaid}
                  className="min-h-[44px] w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer transition-colors"
                >
                  {t.payment.btnPaidConfirm}
                </button>
                <button
                  type="button"
                  onClick={handleSimInstantQris}
                  className="min-h-[42px] w-full px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-xs font-semibold cursor-pointer transition-colors"
                >
                  {t.payment.btnSimInstant}
                </button>
                <p className="text-[11px] text-slate-500 text-center">
                  {t.payment.simInstantNote}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700 truncate pr-2">
                  {targetTitle}
                </span>
                <span className="font-mono tabular-nums font-bold text-slate-900 shrink-0">
                  {formatUsd(baseUsd)}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t.payment.paypalDisclaimer}</span>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => handleSimulatedPayPal('paypal')}
                  className="min-h-[44px] w-full px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold cursor-pointer transition-colors"
                >
                  {t.payment.btnPaypal} ({formatUsd(baseUsd)} · Simulated)
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulatedPayPal('card')}
                  className="min-h-[44px] w-full px-4 py-2.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-sm font-semibold cursor-pointer transition-colors"
                >
                  {t.payment.btnCard} ({formatUsd(baseUsd)} · Simulated)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
