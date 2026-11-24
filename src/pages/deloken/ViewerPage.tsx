import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { ProjectCard } from '../../components/deloken/ProjectCard';
import { CATEGORY_LABELS, getTranslation } from '../../data/translations';
import { usePersistentState } from '../../hooks/usePersistentState';
import {
  getActiveMembership,
  getLatestExpiredMembership,
} from '../../services/accessService';
import type { ProjectCategory } from '../../types/deloken';
import { formatIdr, formatUsd } from '../../utils/currency';

interface ViewerPageProps {
  onSelectProject: (projectId: string) => void;
  onOpenMembershipCheckout: () => void;
}

const CATEGORIES: (ProjectCategory | 'All')[] = [
  'All',
  'DIY & Crafts',
  'Culinary & Recipes',
  'Technical & Repair',
  'Documentary',
];

export const ViewerPage: React.FC<ViewerPageProps> = ({
  onSelectProject,
  onOpenMembershipCheckout,
}) => {
  const {
    state,
    activeUserId,
    checkProjectAccess,
    dismissStorageWarning,
  } = usePersistentState();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ProjectCategory | 'All'>('All');

  const language = state.language;
  const t = getTranslation(language);

  const publishedProjects = useMemo(
    () => state.projects.filter((p) => p.publicationStatus === 'published'),
    [state.projects]
  );

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return publishedProjects.filter((p) => {
      const catMatch =
        selectedCategory === 'All' || p.category === selectedCategory;
      if (!catMatch) return false;
      if (!q) return true;
      return (
        p.title.id.toLowerCase().includes(q) ||
        p.title.en.toLowerCase().includes(q) ||
        p.description.id.toLowerCase().includes(q) ||
        p.description.en.toLowerCase().includes(q) ||
        p.creatorName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [publishedProjects, searchQuery, selectedCategory]);

  const activeMembership = getActiveMembership(
    activeUserId,
    state.memberships,
    state.transactions
  );
  const expiredMembership = !activeMembership
    ? getLatestExpiredMembership(activeUserId, state.memberships)
    : null;

  const membershipPriceLabel =
    language === 'id'
      ? `${formatIdr(state.settings.membershipPriceIdr)}/bulan`
      : `${formatUsd(state.settings.membershipPriceUsd)}/month`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-8">
      {/* Storage Recovery Warning if corrupted JSON was repaired */}
      {state.storageWarning && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{state.storageWarning}</span>
          </div>
          <button
            type="button"
            onClick={dismissStorageWarning}
            aria-label="Dismiss warning"
            className="p-1 rounded hover:bg-amber-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Editorial Hero + Membership Card */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-between gap-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-emerald-700">
              {t.brandTagline}
            </p>
            <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
              {t.viewer.heroTitle}
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
              {t.viewer.heroSubtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span className="font-mono tabular-nums font-semibold text-slate-700">
              {publishedProjects.length} {t.viewer.publishedCountSuffix}
            </span>
            <span aria-hidden="true">·</span>
            <span>YouTube Unlisted</span>
            <span aria-hidden="true">·</span>
            <span>Archive.org MP4</span>
            <span aria-hidden="true">·</span>
            <span>Google Drive</span>
          </div>
        </div>

        <aside className="lg:col-span-4 bg-slate-900 text-white rounded-xl p-6 flex flex-col justify-between gap-5 border border-slate-800">
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <Crown className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.viewer.membershipBannerTitle}</span>
            </div>

            {activeMembership ? (
              <div className="space-y-1.5">
                <p className="font-display text-lg font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span>All-Access Active</span>
                </p>
                <p className="text-xs text-slate-300">
                  {t.viewer.membershipActive}{' '}
                  <span className="font-mono tabular-nums text-white">
                    {new Date(activeMembership.expiryDate).toLocaleDateString(
                      language === 'id' ? 'id-ID' : 'en-US'
                    )}
                  </span>
                </p>
              </div>
            ) : expiredMembership ? (
              <div className="space-y-1.5">
                <p className="font-display text-lg font-bold text-amber-300">
                  Membership Expired
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {t.viewer.membershipExpired}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="font-display text-xl font-bold font-mono tabular-nums text-white">
                  {membershipPriceLabel}
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {t.viewer.membershipInactive}
                </p>
              </div>
            )}
          </div>

          {!activeMembership && (
            <button
              type="button"
              onClick={onOpenMembershipCheckout}
              className="min-h-[44px] w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.viewer.getMembershipBtn}</span>
            </button>
          )}
        </aside>
      </section>

      {/* Search & Category Filter Controls */}
      <section className="space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="relative flex-1 max-w-xl">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.viewer.searchPlaceholder}
              aria-label={t.viewer.searchPlaceholder}
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
            />
          </div>

          <div
            className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0"
            role="tablist"
            aria-label="Category filter"
          >
            {CATEGORIES.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedCategory(cat)}
                  className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    active
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900'
                  }`}
                >
                  {CATEGORY_LABELS[cat][language]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Published Catalog Grid */}
        {filteredProjects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              {t.viewer.emptyCatalogTitle}
            </h2>
            <p className="text-sm text-slate-500">{t.viewer.emptyCatalogDesc}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => {
              const access = checkProjectAccess(project.id);
              return (
                <ProjectCard
                  key={project.id}
                  project={project}
                  language={language}
                  isUnlocked={access.unlocked}
                  onSelectProject={onSelectProject}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
