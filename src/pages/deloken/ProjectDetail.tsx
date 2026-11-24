import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Lock,
  Wrench,
} from 'lucide-react';
import { VideoPlayer } from '../../components/deloken/VideoPlayer';
import {
  CATEGORY_LABELS,
  getTranslation,
  PROVIDER_LABELS,
} from '../../data/translations';
import { usePersistentState } from '../../hooks/usePersistentState';
import type { Project } from '../../types/deloken';
import { formatProjectPrice } from '../../utils/currency';

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
  onOpenPaymentModal: (project: Project, resumeSeconds: number) => void;
}

type DetailTab = 'overview' | 'materials' | 'attachments';

export const ProjectDetail: React.FC<ProjectDetailProps> = ({
  project,
  onBack,
  onOpenPaymentModal,
}) => {
  const { state, checkProjectAccess } = usePersistentState();
  const language = state.language;
  const t = getTranslation(language);

  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [resumeSeconds, setResumeSeconds] = useState(0);
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);

  const access = checkProjectAccess(project.id);
  const priceLabel = formatProjectPrice(project.pricing, language);
  const categoryLabel = CATEGORY_LABELS[project.category][language];
  const providerLabel = PROVIDER_LABELS[project.videoProvider][language];

  const handleSelectTab = (tab: DetailTab) => {
    if ((tab === 'materials' || tab === 'attachments') && !access.unlocked) {
      onOpenPaymentModal(project, resumeSeconds);
      return;
    }
    setActiveTab(tab);
  };

  const handleDownloadAttachment = (
    attName: string,
    sourceType: 'google_drive_restricted' | 'simulated_local_file',
    url: string
  ) => {
    if (!access.unlocked) {
      onOpenPaymentModal(project, resumeSeconds);
      return;
    }
    if (sourceType === 'google_drive_restricted') {
      setDownloadFeedback(
        language === 'id'
          ? `Membuka referensi Google Drive Restricted "${attName}". Catatan: Akses unduh sebenarnya bergantung pada izin Google Drive akun Anda.`
          : `Opening Google Drive Restricted reference "${attName}". Note: Actual download depends on matching Google Drive permissions.`
      );
      if (url.startsWith('https://')) {
        // Trigger clean anchor download/navigation notice without window.open popup blocking inside iframe
      }
      return;
    }

    setDownloadFeedback(
      language === 'id'
        ? `Simulasi akses berkas "${attName}" berhasil diverifikasi (berkas tidak disimpan di server produksi).`
        : `Simulated file access verified for "${attName}" (prototype local reference, not hosted on server).`
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Top Breadcrumb & Back */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[40px] inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-xs font-semibold text-slate-700 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>{t.detail.backToCatalog}</span>
        </button>

        <span className="font-mono text-xs text-slate-500">
          ID: {project.id}
        </span>
      </div>

      {/* Main Split: Video Player + Purchase / Access Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-5">
          <VideoPlayer
            project={project}
            language={language}
            isUnlocked={access.unlocked}
            initialResumeSeconds={resumeSeconds}
            onSaveResumeSeconds={setResumeSeconds}
            onLockTriggered={(sec) => {
              setResumeSeconds(sec);
              onOpenPaymentModal(project, sec);
            }}
          />

          {/* Interactive Tabs */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div
              role="tablist"
              aria-label="Project content tabs"
              className="flex overflow-x-auto border-b border-slate-200 bg-slate-50"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'overview'}
                onClick={() => handleSelectTab('overview')}
                className={`min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'overview'
                    ? 'border-emerald-600 text-emerald-700 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.detail.tabOverview}
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'materials'}
                onClick={() => handleSelectTab('materials')}
                className={`min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 border-b-2 inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  activeTab === 'materials'
                    ? 'border-emerald-600 text-emerald-700 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {!access.unlocked && (
                  <Lock className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                )}
                <span>{t.detail.tabMaterials}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'attachments'}
                onClick={() => handleSelectTab('attachments')}
                className={`min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 border-b-2 inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  activeTab === 'attachments'
                    ? 'border-emerald-600 text-emerald-700 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {!access.unlocked && (
                  <Lock className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                )}
                <span>{t.detail.tabAttachments}</span>
              </button>
            </div>

            <div className="p-5 sm:p-6">
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-emerald-700">{categoryLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{providerLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{project.duration}</span>
                    <span aria-hidden="true">·</span>
                    <span>{project.creatorName}</span>
                  </div>
                  <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                    {project.title[language]}
                  </h1>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {project.description[language]}
                  </p>
                  {!access.unlocked && (
                    <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <p className="text-xs text-slate-600">
                        {t.detail.lockedTabHint}
                      </p>
                      <button
                        type="button"
                        onClick={() => onOpenPaymentModal(project, resumeSeconds)}
                        className="min-h-[40px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {t.detail.unlockNow}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'materials' && access.unlocked && (
                <div className="space-y-6">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2 mb-3">
                      <Wrench className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                      <span>{t.detail.materialsHeading}</span>
                    </h2>
                    <ul className="space-y-2">
                      {project.materials[language].map((mat, idx) => (
                        <li
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-800 flex items-start gap-2.5"
                        >
                          <span className="font-mono text-xs font-semibold text-emerald-700 mt-0.5">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span>{mat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 mb-3">
                      {t.detail.stepsHeading}
                    </h2>
                    <ol className="space-y-2.5">
                      {project.steps[language].map((step, idx) => (
                        <li
                          key={idx}
                          className="p-3.5 rounded-lg bg-white border border-slate-200 text-sm text-slate-800 leading-relaxed"
                        >
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}

              {activeTab === 'attachments' && access.unlocked && (
                <div className="space-y-4">
                  <h2 className="font-display text-base font-bold text-slate-900">
                    {t.detail.attachmentsHeading}
                  </h2>

                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{t.detail.driveRestrictedNotice}</span>
                  </div>

                  {project.attachments.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      {language === 'id'
                        ? 'Tidak ada lampiran pada proyek ini.'
                        : 'No attachments listed for this project.'}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {project.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                              <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span className="truncate">{att.name}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                              <span>{att.sizeLabel}</span>
                              <span aria-hidden="true">·</span>
                              <span>{att.mimeType}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {att.sourceType === 'google_drive_restricted'
                                  ? 'Google Drive Restricted'
                                  : 'Simulated Local Upload'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 break-all">{att.url}</p>
                            {att.sourceType === 'simulated_local_file' && (
                              <p className="text-[11px] text-amber-700">
                                {t.detail.simulatedAttachmentNotice}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleDownloadAttachment(
                                  att.name,
                                  att.sourceType,
                                  att.url
                                )
                              }
                              className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{t.detail.openAttachment}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {downloadFeedback && (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                      {downloadFeedback}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sticky Access Card */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4 lg:sticky lg:top-20">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">
              {language === 'id' ? 'Status Hak Akses' : 'Access Entitlement'}
            </span>
            {access.unlocked ? (
              <div className="flex items-start gap-2 text-emerald-700 font-semibold text-sm pt-1">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {access.reason === 'individual_purchase'
                    ? t.detail.accessActiveIndividual
                    : t.detail.accessActiveMembership}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-amber-700 font-semibold text-sm pt-1">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t.detail.accessPreviewOnly}</span>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-baseline justify-between">
            <span className="text-xs text-slate-500">
              {language === 'id' ? 'Harga Akses Proyek' : 'Project Access Price'}
            </span>
            <span className="font-mono tabular-nums text-2xl font-bold text-slate-900">
              {priceLabel}
            </span>
          </div>

          {!access.unlocked ? (
            <button
              type="button"
              onClick={() => onOpenPaymentModal(project, resumeSeconds)}
              className="min-h-[44px] w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              {t.detail.unlockNow}
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('materials')}
                className="min-h-[40px] px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
              >
                {t.detail.tabMaterials}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('attachments')}
                className="min-h-[40px] px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                {t.detail.tabAttachments}
              </button>
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>{language === 'id' ? 'Kreator' : 'Creator'}</span>
              <span className="font-medium text-slate-800">{project.creatorName}</span>
            </div>
            <div className="flex justify-between">
              <span>{language === 'id' ? 'Sumber Video' : 'Video Provider'}</span>
              <span className="font-medium text-slate-800">{providerLabel}</span>
            </div>
            <div className="flex justify-between">
              <span>{language === 'id' ? 'Lampiran' : 'Attachments'}</span>
              <span className="font-mono tabular-nums font-medium text-slate-800">
                {project.attachments.length} file
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
