import React from 'react';
import { AlertCircle, SearchX } from 'lucide-react';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}) => (
  <div className="flex flex-col items-center justify-center text-center py-16 px-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
    <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-center text-emerald-700 dark:text-emerald-400 mb-4">
      {icon ?? <SearchX className="w-6 h-6" aria-hidden="true" />}
    </div>
    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{title}</h3>
    <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mb-6 leading-relaxed">{description}</p>
    {actionLabel && onAction && (
      <Button variant="secondary" size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);

interface ErrorStateProps {
  title: string;
  description: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  description,
  retryLabel = 'Try Again',
  onRetry,
}) => (
  <div
    role="alert"
    className="flex flex-col items-center justify-center text-center py-14 px-6 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/70 rounded-xl shadow-xs"
  >
    <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4">
      <AlertCircle className="w-6 h-6" aria-hidden="true" />
    </div>
    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{title}</h3>
    <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mb-6 leading-relaxed">{description}</p>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        {retryLabel}
      </Button>
    )}
  </div>
);
