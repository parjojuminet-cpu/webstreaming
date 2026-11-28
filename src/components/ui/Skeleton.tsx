import React from 'react';

export const ContentCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 animate-pulse">
    <div className="aspect-video bg-slate-200 dark:bg-slate-800" />
    <div className="p-2 sm:p-2.5 space-y-1.5">
      <div className="h-3 sm:h-3.5 w-11/12 bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="h-3 sm:h-3.5 w-3/5 bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="h-2.5 sm:h-3 w-28 bg-slate-200 dark:bg-slate-800 rounded pt-0.5" />
    </div>
  </div>
);

export const CreatorCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 animate-pulse flex flex-col items-start gap-4">
    <div className="flex items-center gap-3.5 w-full">
      <div className="w-14 h-14 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
      <div className="space-y-2 flex-1">
        <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
      </div>
    </div>
    <div className="h-3 w-full bg-slate-200 dark:bg-slate-800 rounded" />
    <div className="h-9 w-full bg-slate-200 dark:bg-slate-800 rounded-lg" />
  </div>
);

export const HeroSkeleton: React.FC = () => (
  <div className="relative min-h-[540px] lg:min-h-[640px] bg-slate-100 dark:bg-slate-900 animate-pulse flex items-end">
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-16 space-y-4">
      <div className="h-4 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="h-12 w-2/3 max-w-xl bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="h-5 w-1/2 max-w-lg bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="flex gap-3 pt-2">
        <div className="h-11 w-40 bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-11 w-36 bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </div>
    </div>
  </div>
);

export const StatCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 animate-pulse space-y-2.5">
    <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
    <div className="h-7 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
  </div>
);

export const ListRowSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 animate-pulse flex items-center justify-between gap-4">
    <div className="space-y-2 flex-1">
      <div className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="h-4 w-56 bg-slate-200 dark:bg-slate-800 rounded" />
    </div>
    <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 rounded-lg shrink-0" />
  </div>
);

export const DashboardSkeleton: React.FC = () => (
  <div
    aria-busy="true"
    aria-label="Loading workspace"
    className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5 sm:space-y-7"
  >
    <div className="flex items-center gap-3.5 sm:gap-4 pb-4 sm:pb-5 border-b border-slate-200 dark:border-slate-800 animate-pulse">
      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
      <div className="space-y-2 flex-1">
        <div className="h-3 w-28 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-6 sm:h-7 w-48 sm:w-52 bg-slate-200 dark:bg-slate-800 rounded" />
      </div>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
    <div className="space-y-2.5 sm:space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </div>
  </div>
);
