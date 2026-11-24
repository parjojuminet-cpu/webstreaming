import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  EyeOff,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import {
  PUBLICATION_STATUS_LABELS,
  TRANSACTION_STATUS_LABELS,
} from '../../data/translations';
import type {
  LanguageCode,
  PublicationStatus,
  TransactionStatus,
} from '../../types/deloken';

export const PublicationStatusBadge: React.FC<{
  status: PublicationStatus;
  language: LanguageCode;
}> = ({ status, language }) => {
  const label = PUBLICATION_STATUS_LABELS[status][language];

  const styles: Record<PublicationStatus, { cls: string; icon: React.ReactNode }> = {
    published: {
      cls: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    pending_review: {
      cls: 'text-amber-700 bg-amber-50 border-amber-200',
      icon: <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    revision_requested: {
      cls: 'text-sky-700 bg-sky-50 border-sky-200',
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    rejected: {
      cls: 'text-rose-700 bg-rose-50 border-rose-200',
      icon: <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    unpublished: {
      cls: 'text-slate-700 bg-slate-100 border-slate-200',
      icon: <EyeOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
  };

  const cfg = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-xs font-medium whitespace-nowrap ${cfg.cls}`}
    >
      {cfg.icon}
      <span>{label}</span>
    </span>
  );
};

export const TransactionStatusBadge: React.FC<{
  status: TransactionStatus;
  language: LanguageCode;
}> = ({ status, language }) => {
  const label = TRANSACTION_STATUS_LABELS[status][language];

  const styles: Record<TransactionStatus, { cls: string; icon: React.ReactNode }> = {
    paid: {
      cls: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    pending_verification: {
      cls: 'text-amber-700 bg-amber-50 border-amber-200',
      icon: <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    rejected: {
      cls: 'text-rose-700 bg-rose-50 border-rose-200',
      icon: <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    refunded: {
      cls: 'text-slate-700 bg-slate-100 border-slate-200',
      icon: <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
  };

  const cfg = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-xs font-medium whitespace-nowrap ${cfg.cls}`}
    >
      {cfg.icon}
      <span>{label}</span>
    </span>
  );
};
