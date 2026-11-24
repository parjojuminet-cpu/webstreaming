import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Film, Lock, Paperclip } from 'lucide-react';
import { CATEGORY_LABELS, getTranslation, PROVIDER_LABELS } from '../../data/translations';
import type { LanguageCode, Project } from '../../types/deloken';
import { formatProjectPrice } from '../../utils/currency';

interface ProjectCardProps {
  project: Project;
  language: LanguageCode;
  isUnlocked: boolean;
  onSelectProject: (projectId: string) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  language,
  isUnlocked,
  onSelectProject,
}) => {
  const [imgError, setImgError] = useState(false);
  const t = getTranslation(language);
  const categoryLabel = CATEGORY_LABELS[project.category][language];
  const providerLabel = PROVIDER_LABELS[project.videoProvider][language];
  const priceLabel = formatProjectPrice(project.pricing, language);
  const title = project.title[language];
  const description = project.description[language];

  return (
    <article className="group bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col transition-colors duration-150 hover:border-slate-300">
      {/* 16:9 Thumbnail Frame */}
      <button
        type="button"
        onClick={() => onSelectProject(project.id)}
        className="relative aspect-video w-full bg-slate-100 overflow-hidden cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
      >
        {!imgError && project.thumbnailUrl ? (
          <img
            src={project.thumbnailUrl}
            alt={title}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600 p-4 text-center">
            <Film className="w-8 h-8 text-emerald-600 mb-2" aria-hidden="true" />
            <span className="text-xs font-medium text-slate-700 line-clamp-2">{title}</span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-slate-900/75 via-slate-900/25 to-transparent pointer-events-none" />
        <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between gap-2 text-xs font-medium text-white">
          <span className="font-mono tabular-nums bg-slate-900/80 px-2 py-0.5 rounded">
            {project.duration}
          </span>
          <span className="inline-flex items-center gap-1 bg-slate-900/80 px-2 py-0.5 rounded truncate">
            {isUnlocked ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>{t.viewer.unlockedLabel}</span>
              </>
            ) : (
              <>
                <Lock className="w-3 h-3 text-slate-200 shrink-0" aria-hidden="true" />
                <span>{t.viewer.lockedPreviewLabel}</span>
              </>
            )}
          </span>
        </div>
      </button>

      {/* Card Content */}
      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
        <div className="space-y-2">
          {/* Unboxed clean metadata with typographic separators (zero-pill) */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span className="font-medium text-emerald-700">{categoryLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{providerLabel}</span>
            {project.attachments.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <Paperclip className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>{t.viewer.attachmentsBadge}</span>
                </span>
              </>
            )}
          </div>

          <h3 className="font-display text-base sm:text-lg font-semibold text-slate-900 leading-snug line-clamp-2">
            {title}
          </h3>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed line-clamp-2">
            {description}
          </p>

          <p className="text-xs text-slate-500 pt-0.5">
            {project.creatorName}
          </p>
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <div>
            <span className="font-mono tabular-nums text-base font-bold text-slate-900">
              {priceLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onSelectProject(project.id)}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            <span>{t.viewer.viewDetails}</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
};
