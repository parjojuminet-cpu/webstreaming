import React from 'react';

interface DelokenLogoProps {
  size?: 'sm' | 'md';
  showWordmark?: boolean;
}

export const DelokenLogo: React.FC<DelokenLogoProps> = ({
  size = 'md',
  showWordmark = true,
}) => {
  const iconSize = size === 'sm' ? 24 : 28;
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0 rounded-lg dark:ring-1 dark:ring-slate-700"
      >
        <rect width="32" height="32" rx="8" fill="#0F172A" />
        <path
          d="M9 8.5H15.5C20.1944 8.5 23.5 11.634 23.5 16C23.5 20.366 20.1944 23.5 15.5 23.5H9V8.5Z"
          stroke="#10B981"
          strokeWidth="2.4"
        />
        <path d="M13.5 12.6L19.2 16L13.5 19.4V12.6Z" fill="#10B981" />
      </svg>
      {showWordmark && (
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white">
          DELOKEN
        </span>
      )}
    </span>
  );
};
