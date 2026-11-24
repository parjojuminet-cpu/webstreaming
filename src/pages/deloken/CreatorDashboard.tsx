import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  FileUp,
  Link2,
  Send,
} from 'lucide-react';
import { PublicationStatusBadge } from '../../components/deloken/StatusBadge';
import {
  CATEGORY_LABELS,
  getTranslation,
  PROVIDER_LABELS,
} from '../../data/translations';
import { usePersistentState } from '../../hooks/usePersistentState';
import type {
  Project,
  ProjectAttachment,
  ProjectCategory,
  VideoProvider,
} from '../../types/deloken';
import { formatIdr, formatUsd } from '../../utils/currency';
import {
  validateDriveAttachmentUrl,
  validateLocalAttachmentFile,
  validateVideoProviderUrl,
} from '../../utils/validation';

import defaultThumbWood from '../../assets/images/deloken_woodworking_workshop_1795504288328.jpg';

const CATEGORIES: ProjectCategory[] = [
  'DIY & Crafts',
  'Culinary & Recipes',
  'Technical & Repair',
  'Documentary',
];

const PROVIDERS: VideoProvider[] = [
  'youtube_unlisted',
  'archive_org_mp4',
  'google_drive',
  'deloken_hosted',
];

export const CreatorDashboard: React.FC = () => {
  const { state, submitCreatorProject } = usePersistentState();
  const language = state.language;
  const t = getTranslation(language);

  const creatorUser =
    state.users.find((u) => u.role === 'creator') ?? state.users[1] ?? state.users[0];

  // Form state covering all 11 Master Prompt fields + Hybrid Video Source + Attachment
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleId, setTitleId] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('DIY & Crafts');
  const [priceIdr, setPriceIdr] = useState('15000');
  const [priceUsd, setPriceUsd] = useState('1.50');
  const [descriptionId, setDescriptionId] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [materialsIdText, setMaterialsIdText] = useState('');
  const [materialsEnText, setMaterialsEnText] = useState('');
  const [stepsIdText, setStepsIdText] = useState('');
  const [stepsEnText, setStepsEnText] = useState('');
  const [videoProvider, setVideoProvider] =
    useState<VideoProvider>('youtube_unlisted');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoNote, setVideoNote] = useState('');
  const [duration, setDuration] = useState('25:00');

  // Attachments (Google Drive Restricted OR Simulated Local File <= 10 MB)
  const [attachmentMode, setAttachmentMode] = useState<
    'google_drive_restricted' | 'simulated_local_file'
  >('google_drive_restricted');
  const [driveAttachmentUrl, setDriveAttachmentUrl] = useState('');
  const [driveAttachmentName, setDriveAttachmentName] = useState(
    'Project_Blueprint.pdf'
  );
  const [simulatedAttachment, setSimulatedAttachment] =
    useState<ProjectAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const urlValidation = useMemo(
    () =>
      videoUrl.trim()
        ? validateVideoProviderUrl(videoProvider, videoUrl)
        : null,
    [videoProvider, videoUrl]
  );

  // Creator Projects + Revenue strictly computed from Paid transactions
  const creatorProjects = useMemo(
    () => state.projects.filter((p) => p.creatorId === creatorUser.id),
    [state.projects, creatorUser.id]
  );

  const paidTxByProject = useMemo(() => {
    const map = new Map<
      string,
      { sales: number; idr: number; usd: number }
    >();
    for (const tx of state.transactions) {
      if (tx.status !== 'paid' || !tx.projectId) continue;
      const cur = map.get(tx.projectId) ?? { sales: 0, idr: 0, usd: 0 };
      cur.sales += 1;
      if (tx.currency === 'IDR') cur.idr += tx.amount;
      if (tx.currency === 'USD') cur.usd += tx.amount;
      map.set(tx.projectId, cur);
    }
    return map;
  }, [state.transactions]);

  const kpis = useMemo(() => {
    let totalIdr = 0;
    let totalUsd = 0;
    for (const p of creatorProjects) {
      const stats = paidTxByProject.get(p.id);
      if (stats) {
        totalIdr += stats.idr;
        totalUsd += stats.usd;
      }
    }
    return {
      totalIdr,
      totalUsd,
      totalProjects: creatorProjects.length,
      publishedCount: creatorProjects.filter(
        (p) => p.publicationStatus === 'published'
      ).length,
      pendingCount: creatorProjects.filter(
        (p) => p.publicationStatus === 'pending_review'
      ).length,
    };
  }, [creatorProjects, paidTxByProject]);

  const handleLoadForRevision = (proj: Project) => {
    setEditingId(proj.id);
    setTitleId(proj.title.id);
    setTitleEn(proj.title.en);
    setCategory(proj.category);
    setPriceIdr(String(proj.pricing.idr));
    setPriceUsd(String(proj.pricing.usd));
    setDescriptionId(proj.description.id);
    setDescriptionEn(proj.description.en);
    setMaterialsIdText(proj.materials.id.join('\n'));
    setMaterialsEnText(proj.materials.en.join('\n'));
    setStepsIdText(proj.steps.id.join('\n'));
    setStepsEnText(proj.steps.en.join('\n'));
    setVideoProvider(proj.videoProvider);
    setVideoUrl(proj.videoUrl);
    setVideoNote(proj.videoNote);
    setDuration(proj.duration);
    const firstAtt = proj.attachments[0];
    if (firstAtt) {
      setAttachmentMode(firstAtt.sourceType);
      if (firstAtt.sourceType === 'google_drive_restricted') {
        setDriveAttachmentUrl(firstAtt.url);
        setDriveAttachmentName(firstAtt.name);
        setSimulatedAttachment(null);
      } else {
        setSimulatedAttachment(firstAtt);
      }
    }
    setFormError(null);
    setFormSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLocalAttachmentChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setAttachmentError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const check = validateLocalAttachmentFile(file, language);
    if (!check.valid) {
      setSimulatedAttachment(null);
      setAttachmentError(check.error ?? 'Invalid attachment file.');
      return;
    }

    setSimulatedAttachment({
      id: `att_sim_${Date.now()}`,
      name: file.name,
      sizeBytes: file.size,
      sizeLabel: check.sizeLabel ?? `${file.size} B`,
      mimeType: file.type || 'application/octet-stream',
      sourceType: 'simulated_local_file',
      url: `simulated-local://${encodeURIComponent(file.name)}`,
      note: 'Simulated local attachment — not uploaded to server.',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setAttachmentError(null);

    if (
      !titleId.trim() ||
      !titleEn.trim() ||
      !descriptionId.trim() ||
      !descriptionEn.trim()
    ) {
      setFormError(
        language === 'id'
          ? 'Judul dan deskripsi dalam Bahasa Indonesia & Inggris wajib diisi.'
          : 'Indonesian and English titles and descriptions are required.'
      );
      return;
    }

    const parsedIdr = Number(priceIdr);
    const parsedUsd = Number(priceUsd);
    if (!Number.isFinite(parsedIdr) || parsedIdr < 0 || !Number.isFinite(parsedUsd) || parsedUsd < 0) {
      setFormError(
        language === 'id'
          ? 'Nominal harga IDR dan USD harus berupa angka valid.'
          : 'IDR and USD prices must be valid numbers.'
      );
      return;
    }

    const matId = materialsIdText.split('\n').map((s) => s.trim()).filter(Boolean);
    const matEn = materialsEnText.split('\n').map((s) => s.trim()).filter(Boolean);
    const stpId = stepsIdText.split('\n').map((s) => s.trim()).filter(Boolean);
    const stpEn = stepsEnText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (matId.length === 0 || matEn.length === 0 || stpId.length === 0 || stpEn.length === 0) {
      setFormError(
        language === 'id'
          ? 'Rincian bahan dan langkah teknik (ID & EN) wajib diisi minimal 1 baris.'
          : 'Materials and technical steps (ID & EN) require at least 1 line each.'
      );
      return;
    }

    const vCheck = validateVideoProviderUrl(videoProvider, videoUrl);
    if (!vCheck.valid) {
      setFormError(language === 'id' ? vCheck.messageId : vCheck.messageEn);
      return;
    }

    let finalAttachment: ProjectAttachment | null = null;
    if (attachmentMode === 'google_drive_restricted' && driveAttachmentUrl.trim()) {
      const driveCheck = validateDriveAttachmentUrl(driveAttachmentUrl, language);
      if (!driveCheck.valid) {
        setAttachmentError(driveCheck.error ?? 'Invalid Drive URL');
        setFormError(driveCheck.error ?? 'Invalid Drive URL');
        return;
      }
      finalAttachment = {
        id: `att_drv_${Date.now()}`,
        name: driveAttachmentName.trim() || 'Attachment_Restricted.pdf',
        sizeBytes: 1024 * 1024,
        sizeLabel: 'Google Drive Link',
        mimeType: 'application/pdf',
        sourceType: 'google_drive_restricted',
        url: driveAttachmentUrl.trim(),
        note: 'Google Drive Restricted — Requires matching Drive permission.',
      };
    } else if (attachmentMode === 'simulated_local_file') {
      finalAttachment = simulatedAttachment;
    }

    const saved = submitCreatorProject({
      editingProjectId: editingId,
      titleId,
      titleEn,
      category,
      priceIdr: parsedIdr,
      priceUsd: parsedUsd,
      descriptionId,
      descriptionEn,
      materialsId: matId,
      materialsEn: matEn,
      stepsId: stpId,
      stepsEn: stpEn,
      videoProvider,
      videoUrl,
      videoNote,
      duration,
      thumbnailUrl: defaultThumbWood,
      attachment: finalAttachment,
    });

    setEditingId(null);
    setTitleId('');
    setTitleEn('');
    setDescriptionId('');
    setDescriptionEn('');
    setMaterialsIdText('');
    setMaterialsEnText('');
    setStepsIdText('');
    setStepsEnText('');
    setVideoUrl('');
    setVideoNote('');
    setDriveAttachmentUrl('');
    setSimulatedAttachment(null);

    setFormSuccess(
      language === 'id'
        ? `Proyek ${saved.id} berhasil dikirim ke antrean Kurasi Admin (status: Pending Review). Belum muncul di katalog Penonton sebelum disetujui Admin.`
        : `Project ${saved.id} submitted to Admin Curation (Pending Review). It will not appear in the Viewer catalog until approved.`
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-8">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-emerald-700">Selected Creator Workflow</p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
          {t.creator.title}
        </h1>
        <p className="text-sm text-slate-600">{t.creator.subtitle}</p>
      </div>

      {/* KPI Summary (Strictly Paid Transactions) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">{t.creator.kpiRevenueIdr}</p>
          <p className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-1">
            {formatIdr(kpis.totalIdr)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">{t.creator.kpiRevenueUsd}</p>
          <p className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-1">
            {formatUsd(kpis.totalUsd)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">{t.creator.kpiTotalProjects}</p>
          <p className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-1">
            {kpis.totalProjects}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">{t.creator.kpiPublished}</p>
          <p className="font-mono tabular-nums text-xl font-bold text-emerald-700 mt-1">
            {kpis.publishedCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-slate-500">{t.creator.kpiPending}</p>
          <p className="font-mono tabular-nums text-xl font-bold text-amber-700 mt-1">
            {kpis.pendingCount}
          </p>
        </div>
      </div>

      {/* Submission Form */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-7 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-slate-900">
            {editingId ? t.creator.editingHeading : t.creator.formHeading}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {language === 'id' ? 'Batal Edit' : 'Cancel Edit'}
            </button>
          )}
        </div>

        {formError && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        {formSuccess && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formSuccess}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Titles ID & EN */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                1. Judul (Bahasa Indonesia)
              </label>
              <input
                type="text"
                value={titleId}
                onChange={(e) => setTitleId(e.target.value)}
                placeholder="Contoh: Merakit Meja Kerja Kayu Jati"
                className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                2. Title (English)
              </label>
              <input
                type="text"
                value={titleEn}
                onChange={(e) => setTitleEn(e.target.value)}
                placeholder="Example: Building a Reclaimed Teak Workbench"
                className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Category + Separate IDR & USD Prices + Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                3. {language === 'id' ? 'Kategori' : 'Category'}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ProjectCategory)}
                className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c][language]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                4. Harga IDR (Rp)
              </label>
              <input
                type="number"
                min={0}
                step={500}
                value={priceIdr}
                onChange={(e) => setPriceIdr(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                5. Price USD ($)
              </label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {language === 'id' ? 'Durasi (MM:SS)' : 'Duration (MM:SS)'}
              </label>
              <input
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="25:00"
                className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Descriptions ID & EN */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                6. Deskripsi (Bahasa Indonesia)
              </label>
              <textarea
                rows={3}
                value={descriptionId}
                onChange={(e) => setDescriptionId(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                7. Description (English)
              </label>
              <textarea
                rows={3}
                value={descriptionEn}
                onChange={(e) => setDescriptionEn(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Materials ID & EN */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                8. Rincian Bahan ID (1 baris per item)
              </label>
              <textarea
                rows={3}
                value={materialsIdText}
                onChange={(e) => setMaterialsIdText(e.target.value)}
                placeholder={'Kayu jati 2 batang\nPahat kayu 12 mm'}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                9. Materials List EN (1 line per item)
              </label>
              <textarea
                rows={3}
                value={materialsEnText}
                onChange={(e) => setMaterialsEnText(e.target.value)}
                placeholder={'2 seasoned teak stock pieces\n12 mm bevel-edge chisel'}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Steps ID & EN */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                10. Langkah Teknik ID (1 baris per langkah)
              </label>
              <textarea
                rows={3}
                value={stepsIdText}
                onChange={(e) => setStepsIdText(e.target.value)}
                placeholder={'01. Ukur kayu\n02. Potong sambungan tenon'}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                11. Technical Steps EN (1 line per step)
              </label>
              <textarea
                rows={3}
                value={stepsEnText}
                onChange={(e) => setStepsEnText(e.target.value)}
                placeholder={'01. Measure stock\n02. Cut tenon shoulders'}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Hybrid Video Source */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              {language === 'id' ? 'Sumber Video Hybrid' : 'Hybrid Video Source'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Provider
                </label>
                <select
                  value={videoProvider}
                  onChange={(e) => setVideoProvider(e.target.value as VideoProvider)}
                  className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  {PROVIDERS.map((pr) => (
                    <option key={pr} value={pr}>
                      {PROVIDER_LABELS[pr][language]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  URL Video
                </label>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            {urlValidation && (
              <div
                className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                  urlValidation.valid
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {urlValidation.valid ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>
                  {language === 'id' ? urlValidation.messageId : urlValidation.messageEn}
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {language === 'id' ? 'Catatan Sumber Video' : 'Video Source Note'}
              </label>
              <input
                type="text"
                value={videoNote}
                onChange={(e) => setVideoNote(e.target.value)}
                placeholder={
                  language === 'id'
                    ? 'Mis. Video Unlisted 1080p atau izin Drive sudah dibuka'
                    : 'E.g. 1080p Unlisted stream or verified Drive share link'
                }
                className="w-full min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Attachments (Google Drive Restricted OR Simulated Local File <=10 MB) */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              {language === 'id' ? 'Lampiran Proyek (Maks 10 MB)' : 'Project Attachments (Max 10 MB)'}
            </h3>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setAttachmentMode('google_drive_restricted');
                  setAttachmentError(null);
                }}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                  attachmentMode === 'google_drive_restricted'
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Google Drive Restricted</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttachmentMode('simulated_local_file');
                  setAttachmentError(null);
                }}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                  attachmentMode === 'simulated_local_file'
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>
                  {language === 'id'
                    ? 'Simulasi Unggah File Lokal (PDF/ZIP/PNG/JPG)'
                    : 'Simulated Local Upload (PDF/ZIP/PNG/JPG)'}
                </span>
              </button>
            </div>

            {attachmentMode === 'google_drive_restricted' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={driveAttachmentName}
                  onChange={(e) => setDriveAttachmentName(e.target.value)}
                  placeholder="Blueprint_Name.pdf"
                  className="min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-900"
                />
                <input
                  type="url"
                  value={driveAttachmentUrl}
                  onChange={(e) => setDriveAttachmentUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/..."
                  className="min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-900"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="file"
                  accept=".pdf,.zip,.png,.jpg,.jpeg"
                  onChange={handleLocalAttachmentChange}
                  className="block w-full text-xs text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-100 cursor-pointer"
                />
                <p className="text-[11px] text-slate-500">
                  {language === 'id'
                    ? 'Simulasi prototipe: validasi ukuran (<=10 MB), ekstensi, & MIME dilakukan di browser; berkas tidak benar-benar diunggah ke server.'
                    : 'Prototype simulation: size (<=10 MB), extension & MIME validated locally; file is not uploaded to a server.'}
                </p>
                {simulatedAttachment && (
                  <p className="text-xs font-medium text-emerald-700">
                    Selected: {simulatedAttachment.name} ({simulatedAttachment.sizeLabel})
                  </p>
                )}
              </div>
            )}

            {attachmentError && (
              <p className="text-xs font-medium text-rose-700">{attachmentError}</p>
            )}
          </div>

          <button
            type="submit"
            className="min-h-[44px] px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            <span>{editingId ? t.creator.resubmitBtn : t.creator.submitBtn}</span>
          </button>
        </form>
      </section>

      {/* Creator Submissions Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="font-display text-base font-bold text-slate-900">
            {t.creator.tableHeading}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">{language === 'id' ? 'Nama Proyek' : 'Project'}</th>
                <th className="py-3 px-4">{language === 'id' ? 'Tanggal' : 'Submitted'}</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">{language === 'id' ? 'Harga' : 'Price'}</th>
                <th className="py-3 px-4 text-right">{language === 'id' ? 'Penjualan' : 'Sales'}</th>
                <th className="py-3 px-4 text-right">{language === 'id' ? 'Pendapatan (Paid)' : 'Revenue (Paid)'}</th>
                <th className="py-3 px-4 text-right">{language === 'id' ? 'Aksi' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {creatorProjects.map((p) => {
                const stats = paidTxByProject.get(p.id) ?? { sales: 0, idr: 0, usd: 0 };
                return (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{p.title[language]}</div>
                      <div className="text-xs text-slate-500 font-mono">{p.id}</div>
                      {p.adminNote && (
                        <div className="mt-1 text-xs text-sky-700">
                          Admin Note: {p.adminNote}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                      {new Date(p.createdAt).toLocaleDateString(
                        language === 'id' ? 'id-ID' : 'en-US'
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <PublicationStatusBadge
                        status={p.publicationStatus}
                        language={language}
                      />
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                      {formatIdr(p.pricing.idr)} / {formatUsd(p.pricing.usd)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-800">
                      {stats.sales}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-emerald-700 whitespace-nowrap">
                      {formatIdr(stats.idr)} · {formatUsd(stats.usd)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {p.publicationStatus === 'revision_requested' && (
                        <button
                          type="button"
                          onClick={() => handleLoadForRevision(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-300 bg-sky-50 hover:bg-sky-100 text-xs font-semibold text-sky-800 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>{language === 'id' ? 'Revisi' : 'Revise'}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
