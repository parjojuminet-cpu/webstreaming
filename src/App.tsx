import React, { useMemo, useState } from 'react';
import { DelokenLogo } from './components/deloken/DelokenLogo';
import { Navbar } from './components/deloken/Navbar';
import { PaymentModal } from './components/deloken/PaymentModal';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { getTranslation } from './data/translations';
import {
  DelokenProvider,
  usePersistentState,
} from './hooks/usePersistentState';
import { AdminDashboard } from './pages/deloken/AdminDashboard';
import { CreatorDashboard } from './pages/deloken/CreatorDashboard';
import { ProjectDetail } from './pages/deloken/ProjectDetail';
import { ViewerPage } from './pages/deloken/ViewerPage';
import type { Project } from './types/deloken';

function DelokenWorkspace() {
  const {
    state,
    activeUserName,
    setActiveRole,
    setLanguage,
  } = usePersistentState();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentScope, setPaymentScope] = useState<'project' | 'membership'>('project');
  const [paymentProject, setPaymentProject] = useState<Project | null>(null);

  const language = state.language;
  const t = getTranslation(language);

  const selectedProject = useMemo(
    () =>
      selectedProjectId
        ? state.projects.find((p) => p.id === selectedProjectId) ?? null
        : null,
    [selectedProjectId, state.projects]
  );

  // If project was unpublished or rejected while open in Viewer Mode, return cleanly to catalog
  const activeDetailProject =
    state.activeRole === 'viewer' &&
    selectedProject &&
    selectedProject.publicationStatus === 'published'
      ? selectedProject
      : null;

  const handleOpenProjectPayment = (project: Project) => {
    setPaymentProject(project);
    setPaymentScope('project');
    setPaymentModalOpen(true);
  };

  const handleOpenMembershipCheckout = () => {
    setPaymentProject(null);
    setPaymentScope('membership');
    setPaymentModalOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 overflow-x-clip">
      <Navbar
        activeRole={state.activeRole}
        language={language}
        userName={activeUserName}
        onSelectRole={(role) => {
          setActiveRole(role);
          if (role !== 'viewer') {
            setSelectedProjectId(null);
          }
        }}
        onChangeLanguage={setLanguage}
        onGoCatalogHome={() => setSelectedProjectId(null)}
      />

      {/* Prototype Simulation Clarity Strip */}
      <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-center text-[11px] sm:text-xs text-slate-600">
        {t.prototypeNotice}
      </div>

      <main className="flex-1">
        {state.activeRole === 'viewer' &&
          (activeDetailProject ? (
            <ProjectDetail
              project={activeDetailProject}
              onBack={() => setSelectedProjectId(null)}
              onOpenPaymentModal={(proj) => handleOpenProjectPayment(proj)}
            />
          ) : (
            <ViewerPage
              onSelectProject={(projectId) => {
                setSelectedProjectId(projectId);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenMembershipCheckout={handleOpenMembershipCheckout}
            />
          ))}

        {state.activeRole === 'creator' && <CreatorDashboard />}

        {state.activeRole === 'admin' && <AdminDashboard />}
      </main>

      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <DelokenLogo size="sm" />
            <span>· {t.brandTagline}</span>
          </div>
          <p>
            © {new Date().getFullYear()} DELOKEN.{' '}
            {language === 'id'
              ? 'Prototipe kurasi konten hybrid & pembelajaran praktis.'
              : 'Hybrid content curation & practical learning prototype.'}
          </p>
        </div>
      </footer>

      <PaymentModal
        isOpen={paymentModalOpen}
        project={paymentProject}
        defaultScope={paymentScope}
        language={language}
        onClose={() => setPaymentModalOpen(false)}
        onUnlocked={() => setPaymentModalOpen(false)}
      />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <DelokenProvider>
        <DelokenWorkspace />
      </DelokenProvider>
    </ErrorBoundary>
  );
}

export default App;
