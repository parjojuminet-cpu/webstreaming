import React from 'react';

export const ContentCardSkeleton: React.FC = () => (
  <div className="bg-[#1B1C27] rounded-xl overflow-hidden border border-white/5 animate-pulse">
    <div className="aspect-video bg-[#242636]" />
    <div className="p-4 space-y-3">
      <div className="h-3 w-28 bg-[#242636] rounded" />
      <div className="h-5 w-4/5 bg-[#242636] rounded" />
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        <div className="h-4 w-20 bg-[#242636] rounded" />
        <div className="h-4 w-16 bg-[#242636] rounded" />
      </div>
    </div>
  </div>
);

export const CreatorCardSkeleton: React.FC = () => (
  <div className="bg-[#1B1C27] rounded-xl p-5 border border-white/5 animate-pulse flex flex-col items-start gap-4">
    <div className="flex items-center gap-3.5 w-full">
      <div className="w-14 h-14 rounded-full bg-[#242636] shrink-0" />
      <div className="space-y-2 flex-1">
        <div className="h-4 w-32 bg-[#242636] rounded" />
        <div className="h-3 w-24 bg-[#242636] rounded" />
      </div>
    </div>
    <div className="h-3 w-full bg-[#242636] rounded" />
    <div className="h-9 w-full bg-[#242636] rounded-lg" />
  </div>
);

export const HeroSkeleton: React.FC = () => (
  <div className="relative min-h-[540px] lg:min-h-[640px] bg-[#1B1C27] animate-pulse flex items-end">
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-16 space-y-4">
      <div className="h-4 w-36 bg-[#242636] rounded" />
      <div className="h-12 w-2/3 max-w-xl bg-[#242636] rounded" />
      <div className="h-5 w-1/2 max-w-lg bg-[#242636] rounded" />
      <div className="flex gap-3 pt-2">
        <div className="h-11 w-40 bg-[#242636] rounded-lg" />
        <div className="h-11 w-36 bg-[#242636] rounded-lg" />
      </div>
    </div>
  </div>
);

export const StatCardSkeleton: React.FC = () => (
  <div className="bg-[#1B1C27] border border-white/8 rounded-xl p-5 animate-pulse space-y-2.5">
    <div className="h-3 w-24 bg-[#242636] rounded" />
    <div className="h-7 w-20 bg-[#242636] rounded" />
  </div>
);

export const ListRowSkeleton: React.FC = () => (
  <div className="bg-[#1B1C27] border border-white/8 rounded-xl p-4 sm:p-5 animate-pulse flex items-center justify-between gap-4">
    <div className="space-y-2 flex-1">
      <div className="h-3 w-32 bg-[#242636] rounded" />
      <div className="h-4 w-56 bg-[#242636] rounded" />
    </div>
    <div className="h-8 w-24 bg-[#242636] rounded-lg shrink-0" />
  </div>
);

export const DashboardSkeleton: React.FC = () => (
  <div
    aria-busy="true"
    aria-label="Loading workspace"
    className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8"
  >
    <div className="flex items-center gap-4 pb-6 border-b border-white/8 animate-pulse">
      <div className="w-14 h-14 rounded-full bg-[#242636] shrink-0" />
      <div className="space-y-2 flex-1">
        <div className="h-3 w-28 bg-[#242636] rounded" />
        <div className="h-7 w-52 bg-[#242636] rounded" />
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </div>
  </div>
);
