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
  <div className="flex flex-col items-center justify-center text-center py-16 px-6 bg-[#1B1C27] border border-white/10 rounded-xl">
    <div className="w-12 h-12 rounded-xl bg-[#11121A] border border-white/10 flex items-center justify-center text-[#A78BFA] mb-4">
      {icon ?? <SearchX className="w-6 h-6" aria-hidden="true" />}
    </div>
    <h3 className="text-lg font-semibold text-[#F5F5F7] mb-2">{title}</h3>
    <p className="text-sm text-[#A5A6B2] max-w-md mb-6 leading-relaxed">{description}</p>
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
    className="flex flex-col items-center justify-center text-center py-14 px-6 bg-[#1B1C27] border border-rose-500/25 rounded-xl"
  >
    <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-400 mb-4">
      <AlertCircle className="w-6 h-6" aria-hidden="true" />
    </div>
    <h3 className="text-lg font-semibold text-[#F5F5F7] mb-2">{title}</h3>
    <p className="text-sm text-[#A5A6B2] max-w-md mb-6 leading-relaxed">{description}</p>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        {retryLabel}
      </Button>
    )}
  </div>
);
