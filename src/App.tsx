/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Project, Yard, Asset, BinAsset } from './types';
import landingBg from '../IMG_0538.jpeg';
import { DashboardView } from './components/DashboardView';
import { SitePlannerView } from './components/SitePlannerView';
import { CableEstimatorView } from './components/CableEstimatorView';
import { generateUnifiedPDF } from './utils/pdfGenerator';
import { LayoutDashboard, Map as MapIcon, Download, Loader2, Plus, FolderOpen, Cloud, RefreshCw, AlertTriangle, Play, ChevronRight, FileCode, LogOut, Search, X, Github, GitBranch, Home } from 'lucide-react';
import {
  initAuth,
  googleSignIn,
  listProjectsFromDrive,
  loadProjectFromDrive,
  DriveFile,
  logout,
  saveProjectToDrive,
} from './utils/googleDrive';
const DEFAULT_PROJECT: Project = {
  name: 'New Site Project',
  customer: {
    name: '',
    phone: '',
    email: '',
    location: '',
  },
  date: new Date().toLocaleDateString(),
  activeYardId: 1001,
  yards: [
    {
      id: 1001,
      name: 'Main Yard',
      bins: [],
    },
  ],
};

// Helper to synchronize cable lengths of grain bins sharing the same eaveHeight and totalHeight
function syncProjectCables(next: Project, prev: Project): Project {
  // Map of previous bins for lookup
  const prevBinsMap = new Map<number, BinAsset>();
  for (const y of prev.yards) {
    for (const b of y.bins) {
      if (b.type === 'bin') {
        prevBinsMap.set(b.id, b);
      }
    }
  }

  // Get all bins in next state
  const nextBins: BinAsset[] = [];
  for (const y of next.yards) {
    for (const b of y.bins) {
      if (b.type === 'bin') {
        nextBins.push(b);
      }
    }
  }

  // Group next bins by specifications: eaveHeight_totalHeight
  const groups = new Map<string, BinAsset[]>();
  for (const b of nextBins) {
    const key = `${b.eaveHeight}_${b.totalHeight}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(b);
  }

  const syncValues = new Map<string, { centerCable: string; radiusCable: string }>();

  for (const [key, bins] of groups.entries()) {
    let activeTruthBin: BinAsset | null = null;

    // 1. Check if any bin in this group had its cables updated to a non-empty value
    for (const b of bins) {
      const prevBin = prevBinsMap.get(b.id);
      if (prevBin) {
        const cablesChanged = prevBin.centerCable !== b.centerCable || prevBin.radiusCable !== b.radiusCable;
        const hasCables = b.centerCable || b.radiusCable;
        if (cablesChanged && hasCables) {
          activeTruthBin = b;
          break;
        }
      }
    }

    // 2. If no direct non-empty cable update, find an existing bin in this group with cables
    if (!activeTruthBin) {
      activeTruthBin = bins.find(b => b.centerCable || b.radiusCable) || null;
    }

    if (activeTruthBin) {
      syncValues.set(key, {
        centerCable: activeTruthBin.centerCable || '',
        radiusCable: activeTruthBin.radiusCable || '',
      });
    }
  }

  // Map the new project with synchronized cable lengths for matched bins
  return {
    ...next,
    yards: next.yards.map(y => ({
      ...y,
      bins: y.bins.map(b => {
        if (b.type === 'bin') {
          const key = `${b.eaveHeight}_${b.totalHeight}`;
          const syncVal = syncValues.get(key);
          if (syncVal) {
            return {
              ...b,
              centerCable: syncVal.centerCable,
              radiusCable: syncVal.radiusCable,
            };
          }
        }
        return b;
      }),
    })),
  };
}

export default function App() {
  // Load saved project from localStorage upon app initialization
  const [project, setProject] = useState<Project>(() => {
    try {
      const saved = localStorage.getItem('grainlink_project');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.yards) && typeof parsed.name === 'string') {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse saved project state from localStorage:', e);
    }
    return DEFAULT_PROJECT;
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'planner' | 'estimator'>('dashboard');
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [activeBinId, setActiveBinId] = useState<number | null>(null);
  const [includeAssetDirectory, setIncludeAssetDirectory] = useState<boolean>(false);

  // Undo history stack state
  const [history, setHistory] = useState<Project[]>([]);

  const updateProjectWithHistory = (updater: Project | ((prev: Project) => Project)) => {
    setProject((prev) => {
      let next = typeof updater === 'function' ? updater(prev) : updater;
      next = syncProjectCables(next, prev);
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        setHistory((prevHistory) => {
          const updated = [...prevHistory, prev];
          if (updated.length > 50) {
            updated.shift();
          }
          return updated;
        });
      }
      return next;
    });
  };

  const handleUndo = () => {
    setHistory((prevHistory) => {
      if (prevHistory.length === 0) return prevHistory;
      const copy = [...prevHistory];
      const previousState = copy.pop();
      if (previousState) {
        setProject(previousState);
      }
      return copy;
    });
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // PDF generation overlay loading state
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  // Landing page states
  const [showLanding, setShowLanding] = useState<boolean>(true);
  const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(false);
  const [landingUser, setLandingUser] = useState<any>(null);
  const [landingToken, setLandingToken] = useState<string | null>(null);
  const [landingDriveFiles, setLandingDriveFiles] = useState<DriveFile[]>([]);
  const [landingSearchQuery, setLandingSearchQuery] = useState<string>('');
  const [isLoadingLandingDrive, setIsLoadingLandingDrive] = useState(false);
  const [landingDriveError, setLandingDriveError] = useState<string | null>(null);

  // Auto-save states
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastAutoSaved, setLastAutoSaved] = useState<Date | null>(null);
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);

  // Git synchronization states
  const [gitStatus, setGitStatus] = useState<{ hasChanges: boolean; changes: string[] } | null>(null);
  const [isPushingToGit, setIsPushingToGit] = useState(false);
  const [gitPushMessage, setGitPushMessage] = useState<string>('Sync changes from AI Studio');
  const [gitResult, setGitResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showGitModal, setShowGitModal] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);

  // Check if current user is developer
  useEffect(() => {
    // Check url param
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === 'true') {
      localStorage.setItem('grainlink_dev_mode', 'true');
    } else if (params.get('dev') === 'false') {
      localStorage.removeItem('grainlink_dev_mode');
    }

    const isLocalDev = (import.meta as any).env?.DEV || 
                       window.location.hostname.includes('ais-dev') || 
                       window.location.hostname.includes('localhost') || 
                       window.location.hostname.includes('127.0.0.1');

    setIsDevMode(isLocalDev);
  }, [landingUser]);

  // Fetch git status
  const checkGitStatus = async () => {
    try {
      const res = await fetch("/api/github/status");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        throw new Error(text.slice(0, 100) || "Invalid JSON response");
      }
      if (data && data.success) {
        setGitStatus({
          hasChanges: data.hasChanges,
          changes: data.changes,
        });
      }
    } catch (err) {
      console.warn("Error fetching git status (rate limit or connection issue):", err);
    }
  };

  useEffect(() => {
    checkGitStatus();
    // Check periodically every 15 seconds
    const interval = setInterval(checkGitStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleGitPush = async (commitMessage: string) => {
    setIsPushingToGit(true);
    setGitResult(null);
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitMessage }),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        throw new Error(text.slice(0, 100) || "Invalid JSON response");
      }
      if (data && data.success) {
        setGitResult({ success: true, message: "Successfully pushed to GitHub! Your changes will be live shortly." });
        checkGitStatus(); // Refresh status
      } else {
        setGitResult({ success: false, message: `Failed: ${data?.error || "Unknown error"}` });
      }
    } catch (err: any) {
      setGitResult({ success: false, message: `Network/API error: ${err.message || err}` });
    } finally {
      setIsPushingToGit(false);
    }
  };

  const landingFileInputRef = useRef<HTMLInputElement>(null);

  // Refs for tracking the latest project and auto-saving state to avoid unnecessary interval rebuilds
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const isAutoSavingRef = useRef(false);
  useEffect(() => {
    isAutoSavingRef.current = isAutoSaving;
  }, [isAutoSaving]);

  // Global Auto-save effect: Runs every 1 minute if Google Drive is authorized and we are not on the landing page
  useEffect(() => {
    if (!landingToken || showLanding) {
      return;
    }

    const intervalId = setInterval(async () => {
      if (isAutoSavingRef.current) return;

      setIsAutoSaving(true);
      setAutoSaveError(null);
      try {
        await saveProjectToDrive(landingToken, projectRef.current);
        setLastAutoSaved(new Date());
      } catch (err: any) {
        console.error('Auto-save to Google Drive failed:', err);
        setAutoSaveError(err.message || 'Auto-save failed');
        if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
          logout().catch(console.error);
          setLandingToken(null);
          setLandingUser(null);
        }
      } finally {
        setIsAutoSaving(false);
      }
    }, 60000); // 1 minute

    return () => clearInterval(intervalId);
  }, [landingToken, showLanding]);

  // Save current project state to localStorage whenever the project object changes
  useEffect(() => {
    try {
      localStorage.setItem('grainlink_project', JSON.stringify(project));
      // Update saved draft status
      setHasSavedDraft(true);
    } catch (e) {
      console.error('Failed to save project state to localStorage:', e);
    }
  }, [project]);

  // Check if saved draft actually exists on init
  useEffect(() => {
    try {
      const saved = localStorage.getItem('grainlink_project');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.yards)) {
          setHasSavedDraft(true);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Google Drive Auth Listener for Landing Page
  useEffect(() => {
    const unsubscribe = initAuth(
      (u, token) => {
        setLandingUser(u);
        setLandingToken(token);
        fetchLandingDriveFiles(token);
      },
      () => {
        setLandingUser(null);
        setLandingToken(null);
        setLandingDriveFiles([]);
      }
    );
    return () => unsubscribe();
  }, []);

  const fetchLandingDriveFiles = async (tokenToUse?: string | null) => {
    const tok = tokenToUse || landingToken;
    if (!tok) return;
    setIsLoadingLandingDrive(true);
    setLandingDriveError(null);
    try {
      const files = await listProjectsFromDrive(tok);
      setLandingDriveFiles(files);
    } catch (err: any) {
      console.error(err);
      setLandingDriveError(err.message || 'Failed to list designs from Google Drive');
      if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
        logout().catch(console.error);
        setLandingToken(null);
        setLandingUser(null);
      }
    } finally {
      setIsLoadingLandingDrive(false);
    }
  };

  const handleConnectLandingDrive = async () => {
    setLandingDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setLandingUser(result.user);
        setLandingToken(result.accessToken);
        fetchLandingDriveFiles(result.accessToken);
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.message?.includes('popup-closed-by-user')) {
        setLandingDriveError('The sign-in window was closed. Please try again to connect Google Drive.');
      } else {
        setLandingDriveError(err.message || 'Google Drive connection failed');
      }
    }
  };

  const handleDisconnectLandingDrive = async () => {
    setLandingDriveError(null);
    try {
      await logout();
      setLandingUser(null);
      setLandingToken(null);
      setLandingDriveFiles([]);
    } catch (err: any) {
      setLandingDriveError(err.message || 'Sign out failed');
    }
  };

  const handleLoadFromLandingDrive = async (fileId: string, fileName: string) => {
    if (!landingToken) return;
    setIsLoadingLandingDrive(true);
    setLandingDriveError(null);
    try {
      const loaded = await loadProjectFromDrive(landingToken, fileId);
      setProject(loaded);
      setShowLanding(false);
    } catch (err: any) {
      setLandingDriveError(err.message || 'Failed to load design');
      if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
        logout().catch(console.error);
        setLandingToken(null);
        setLandingUser(null);
      }
    } finally {
      setIsLoadingLandingDrive(false);
    }
  };

  const handleLoadProjectJSONLanding = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (imported && typeof imported === 'object' && Array.isArray(imported.yards)) {
          setProject(imported);
          setShowLanding(false);
        } else {
          alert('Invalid project format. Make sure the JSON file is a valid GrainLink layout.');
        }
      } catch (err) {
        alert('Failed to read the JSON file. Ensure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
  };

  // Handle locating an asset from inventory table
  const handleLocateAsset = (assetId: number) => {
    // Find asset across all yards
    for (const y of project.yards) {
      const b = y.bins.find((bin) => bin.id === assetId);
      if (b) {
        updateProjectWithHistory((prev) => ({ ...prev, activeYardId: y.id }));
        setSelectedAssetId(assetId);
        setActiveTab('planner');
        break;
      }
    }
  };

  const handleSelectBinInEstimator = (binId: number) => {
    setActiveBinId(binId);
    setActiveTab('estimator');
  };

  const triggerPDFExport = () => {
    generateUnifiedPDF(project, { setLoading, setLoadingText }, { includeAssetDirectory });
  };

  return (
    <div className="flex h-screen w-full select-none overflow-hidden bg-black text-zinc-100 font-sans">
      {/* Immersive Landing Page View */}
      {showLanding ? (
        <div 
          className="fixed inset-0 z-50 flex flex-col items-center justify-center text-zinc-100 px-6 py-12 overflow-y-auto bg-cover bg-center"
          style={{ backgroundImage: `url(${landingBg})` }}
        >
          {/* Backdrop Blur & Elegant Dark Vignette Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-neutral-950/85 to-neutral-900/40 z-0 backdrop-blur-[1px]" />
          
          <div className={`${isDevMode ? 'max-w-6xl' : 'max-w-4xl'} w-full flex flex-col items-center animate-fade-in relative z-10`}>
            
            {/* Logo / Brand Accent */}
            <div className="flex items-center gap-3 mb-6">
              <span className="text-4xl font-black text-white tracking-tight">
                Grain<span className="text-amber-400">Link</span>
              </span>
            </div>

            <h1 className="text-3xl md:text-5xl font-light tracking-[0.25em] text-center text-white mb-12 uppercase">
              Site Planner
            </h1>

            <div className={`grid grid-cols-1 ${isDevMode ? 'lg:grid-cols-3' : 'md:grid-cols-2'} gap-6 w-full`}>
              
              {/* Left Box: New Site / Resume */}
              <div className="bg-neutral-950/80 border border-neutral-900/80 rounded-3xl p-8 flex flex-col justify-between hover:border-neutral-800 transition-all shadow-xl">
                <div className="space-y-4">
                  <div className="inline-flex p-3 bg-amber-400/10 text-amber-400 rounded-2xl border border-amber-400/20">
                    <Plus size={24} />
                  </div>
                  <h2 className="text-xl font-bold text-white">Start Planning</h2>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Create a brand new site plan layout or resume your session. You can also import any local JSON backup file to instantly load it.
                  </p>
                </div>

                <div className="space-y-3 mt-8">
                  <button
                    onClick={() => {
                      setProject(DEFAULT_PROJECT);
                      setShowLanding(false);
                    }}
                    className="w-full py-3.5 bg-amber-400 hover:bg-amber-300 text-black font-black text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-400/5"
                  >
                    <Plus size={14} strokeWidth={2.5} />
                    Create New Site Plan
                  </button>

                  {hasSavedDraft && (
                    <button
                      onClick={() => {
                        setShowLanding(false);
                      }}
                      className="w-full py-3.5 bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-800 font-bold text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer animate-pulse"
                    >
                      <Play size={12} className="text-amber-400 fill-amber-400" />
                      Resume Active Session
                    </button>
                  )}

                  <button
                    onClick={() => landingFileInputRef.current?.click()}
                    className="w-full py-3.5 bg-neutral-950 hover:bg-neutral-900 text-neutral-300 border border-neutral-900/80 font-bold text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <FileCode size={12} className="text-neutral-500" />
                    Import JSON File
                  </button>
                  <input
                    type="file"
                    ref={landingFileInputRef}
                    className="hidden"
                    accept=".json"
                    onChange={handleLoadProjectJSONLanding}
                  />
                </div>
              </div>

              {/* Right Box: Google Drive Cloud Sync */}
              <div className="bg-neutral-950/80 border border-neutral-900/80 rounded-3xl p-8 flex flex-col hover:border-neutral-800 transition-all shadow-xl">
                <div className="space-y-4">
                  <div className="inline-flex p-3 bg-amber-400/10 text-amber-400 rounded-2xl border border-amber-400/20">
                    <Cloud size={24} />
                  </div>
                  <h2 className="text-xl font-bold text-white">Google Drive Sync</h2>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Sign in to connect with Google Drive. Pull, sync, and load central layout designs directly from your cloud storage.
                  </p>
                </div>

                <div className="flex-1 flex flex-col justify-center space-y-3 min-h-[180px]">
                  {landingDriveError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-400">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-500" />
                      <span className="break-all">{landingDriveError}</span>
                    </div>
                  )}

                  {!landingToken ? (
                    <button
                      onClick={handleConnectLandingDrive}
                      className="w-full flex items-center justify-center gap-3 bg-white hover:bg-neutral-100 text-neutral-800 font-bold rounded-xl text-xs py-3.5 px-4 shadow-md transition-all cursor-pointer"
                    >
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4.5 h-4.5 shrink-0">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      </svg>
                      Connect Google Drive
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-neutral-900 rounded-xl border border-neutral-800">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">{landingUser?.displayName || 'Authorized Account'}</p>
                          <p className="text-[10px] text-zinc-500 truncate">{landingUser?.email}</p>
                        </div>
                        <button
                          onClick={handleDisconnectLandingDrive}
                          className="text-[10px] font-bold text-neutral-500 hover:text-red-400 uppercase tracking-wider pl-2 cursor-pointer"
                        >
                          Sign Out
                        </button>
                      </div>

                      <div className="border border-neutral-900 bg-neutral-950/60 rounded-2xl p-3 flex flex-col">
                        <div className="flex items-center justify-between pb-2 border-b border-neutral-900 mb-2">
                          <span className="text-[10px] font-black uppercase text-neutral-500 tracking-wider">Project File Library</span>
                          <button
                            onClick={() => {
                              fetchLandingDriveFiles(landingToken);
                              setLandingSearchQuery('');
                            }}
                            className="p-1 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                            title="Refresh list"
                          >
                            <RefreshCw size={12} className={isLoadingLandingDrive ? 'animate-spin' : ''} />
                          </button>
                        </div>

                        {/* Drive File Search Input */}
                        <div className="relative mb-2.5">
                          <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-neutral-500">
                            <Search size={12} />
                          </span>
                          <input
                            type="text"
                            value={landingSearchQuery}
                            onChange={(e) => setLandingSearchQuery(e.target.value)}
                            placeholder="Search file in Google Drive..."
                            className="w-full pl-8 pr-7 py-1.5 bg-neutral-900 hover:bg-neutral-900/80 focus:bg-neutral-900/60 text-[11px] text-white placeholder-neutral-500 border border-neutral-800 rounded-lg focus:outline-none focus:border-amber-400/50 transition-all font-medium"
                          />
                          {landingSearchQuery && (
                            <button
                              onClick={() => setLandingSearchQuery('')}
                              className="absolute inset-y-0 right-0 pr-2 flex items-center text-neutral-500 hover:text-white transition-colors cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>

                        <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                          {isLoadingLandingDrive ? (
                            <div className="text-[10px] text-neutral-500 italic py-4 text-center flex items-center justify-center gap-1.5">
                              <RefreshCw size={12} className="animate-spin" />
                              Fetching from Drive...
                            </div>
                          ) : landingDriveFiles.length > 0 ? (
                            (() => {
                              const filtered = landingDriveFiles.filter((file) =>
                                file.name.toLowerCase().includes(landingSearchQuery.toLowerCase())
                              );
                              if (filtered.length === 0) {
                                return (
                                  <div className="text-[10px] text-neutral-500 italic py-6 text-center">
                                    No matching files found
                                  </div>
                                );
                              }
                              return filtered.map((file) => (
                                <div
                                  key={file.id}
                                  onClick={() => handleLoadFromLandingDrive(file.id, file.name)}
                                  className="flex items-center justify-between p-2 hover:bg-neutral-900 rounded-xl cursor-pointer group transition-colors border border-transparent hover:border-neutral-800"
                                >
                                  <div className="min-w-0 flex-1 pr-2">
                                    <p className="text-xs font-bold text-white truncate group-hover:text-amber-400 transition-all">
                                      {file.name}
                                    </p>
                                    {file.modifiedTime && (
                                      <p className="text-[9px] text-neutral-500">
                                        Modified {new Date(file.modifiedTime).toLocaleDateString()}
                                      </p>
                                    )}
                                  </div>
                                  <ChevronRight size={14} className="text-neutral-600 group-hover:text-amber-400 transition-all" />
                                </div>
                              ));
                            })()
                          ) : (
                            <div className="text-[10px] text-neutral-600 italic py-6 text-center">
                              No plans found in folder
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Box 3: GitHub Deployment (Dev Mode Only) */}
              {isDevMode && (
                <div className="bg-neutral-950/80 border border-neutral-900/80 rounded-3xl p-8 flex flex-col justify-between hover:border-neutral-800 transition-all shadow-xl">
                  <div className="space-y-4">
                    <div className="inline-flex p-3 bg-amber-400/10 text-amber-400 rounded-2xl border border-amber-400/20">
                      <Github size={24} />
                    </div>
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold text-white">GitHub Sync</h2>
                      {gitStatus?.hasChanges ? (
                        <span className="text-[9px] bg-red-500/20 text-red-400 font-bold px-2 py-0.5 rounded-full border border-red-500/30 animate-pulse uppercase tracking-wider">
                          Pending
                        </span>
                      ) : (
                        <span className="text-[9px] bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-wider">
                          Synced
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      Only visible in AI Studio Preview (Dev Mode). Review pending modifications and manually deploy updates directly to the git repository.
                    </p>
                  </div>

                  <div className="space-y-3 mt-8">
                    {/* Change list preview inside the card */}
                    <div className="bg-neutral-950 border border-neutral-900 rounded-xl p-3 max-h-24 overflow-y-auto font-mono text-[9px] text-neutral-500 space-y-1">
                      {gitStatus?.changes && gitStatus.changes.length > 0 ? (
                        gitStatus.changes.map((change, i) => (
                          <div key={i} className="flex items-center gap-2 truncate">
                            <span className={`font-bold uppercase shrink-0 ${
                              change.startsWith('M') ? 'text-amber-400' :
                              change.startsWith('A') || change.includes('??') ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                              {change.slice(0, 2)}
                            </span>
                            <span className="truncate">{change.slice(2)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center text-neutral-700 py-3 uppercase tracking-wider">
                          All files synced
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        setGitResult(null);
                        setGitPushMessage('Sync changes from AI Studio');
                        setShowGitModal(true);
                      }}
                      className={`w-full py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        gitStatus?.hasChanges
                          ? 'bg-amber-400 hover:bg-amber-300 text-black shadow-lg shadow-amber-400/5'
                          : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-400 border border-neutral-800'
                      }`}
                    >
                      <GitBranch size={14} />
                      {gitStatus?.hasChanges ? 'Deploy to GitHub' : 'No Changes to Deploy'}
                    </button>
                  </div>
                </div>
              )}

            </div>

            <div className="mt-12 text-[10px] font-semibold text-neutral-600 uppercase tracking-widest text-center">
              GrainLink Suite © 2026 • Secure & Sandbox Compliant
            </div>
          </div>
        </div>
      ) : null}

      {/* Global Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center z-50 transition-all duration-300">
          <Loader2 className="w-16 h-16 text-amber-400 animate-spin mb-4" />
          <h3 className="text-xl font-bold tracking-tight text-white uppercase">Generating Multi-Yard Report</h3>
          <p id="loading-text" className="text-sm text-zinc-400 mt-2">
            {loadingText}
          </p>
        </div>
      )}

      {/* Main Sidebar */}
      <aside className="w-64 bg-neutral-950 border-r border-neutral-900 flex flex-col z-20 shadow-2xl shrink-0">
        <div 
          onClick={() => setShowLanding(true)}
          className="p-6 border-b border-neutral-900 flex flex-col items-start cursor-pointer hover:bg-neutral-900/20 transition-all group"
          title="Go to Switch Site / Project"
        >
          <div className="flex items-center gap-2">
            <span id="brand-logo-text" className="text-xl font-black text-white tracking-tight group-hover:text-amber-400 transition-colors">
              Grain<span className="text-amber-400">Link</span>
            </span>
          </div>

          {/* Minimalist Auto-Save Indicator */}
          <div 
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 mt-3 select-none text-[10px] font-medium tracking-wide"
            title={landingToken ? (lastAutoSaved ? `Last auto-saved to Google Drive at ${lastAutoSaved.toLocaleTimeString()}` : 'Auto-saves your plan every 1 minute') : 'Connect Google Drive to enable cloud auto-save'}
          >
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              {landingToken ? (
                autoSaveError ? (
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                ) : isAutoSaving ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                  </>
                ) : (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </>
                )
              ) : (
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neutral-700"></span>
              )}
            </span>
            <span className="text-[10px] font-semibold uppercase shrink-0 flex items-center gap-1">
              {isAutoSaving ? (
                <span className="text-amber-500 animate-pulse">saving...</span>
              ) : landingToken ? (
                autoSaveError ? (
                  <span className="text-red-500">error saving</span>
                ) : (
                  <span className="text-emerald-500">autosave</span>
                )
              ) : (
                <span className="text-neutral-600">autosave offline</span>
              )}
              {landingToken && lastAutoSaved && (
                <span className="text-[9px] text-neutral-600 font-mono shrink-0">
                  • {lastAutoSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }).toLowerCase()}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Navigation Tab selection */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 font-semibold text-sm">
          <button
            onClick={() => setShowLanding(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-neutral-400 hover:bg-neutral-900/50 hover:text-white transition-all text-left cursor-pointer font-semibold"
          >
            <Home size={16} className="text-amber-400" />
            Home
          </button>

          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-neutral-900 text-white border-l-4 border-amber-400 font-black'
                : 'text-neutral-400 hover:bg-neutral-900/50 hover:text-white'
            }`}
          >
            <LayoutDashboard size={16} className={activeTab === 'dashboard' ? 'text-amber-400' : ''} />
            Project Dashboard
          </button>
          <button
            onClick={() => setActiveTab('planner')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left cursor-pointer ${
              activeTab === 'planner'
                ? 'bg-neutral-900 text-white border-l-4 border-amber-400 font-black'
                : 'text-neutral-400 hover:bg-neutral-900/50 hover:text-white'
            }`}
          >
            <MapIcon size={16} className={activeTab === 'planner' ? 'text-amber-400' : ''} />
            2D Site Planner
          </button>

          {/* Shortcuts Help Panel */}
          <div className="pt-4 border-t border-neutral-900/50 mt-4 px-4 pb-2">
            <h2 className="text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500 mb-2.5">Shortcuts</h2>
            <div className="space-y-2 text-neutral-400 font-semibold text-[10px]">
              <div className="flex justify-between items-center">
                <span>Undo</span>
                <span className="text-[8px] text-neutral-500 font-mono bg-neutral-900/80 px-1 rounded border border-neutral-850">Cmd+Z</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Duplicate</span>
                <span className="text-[8px] text-neutral-500 font-mono bg-neutral-900/80 px-1 rounded border border-neutral-850">Cmd+D</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Delete</span>
                <span className="text-[8px] text-neutral-500 font-mono bg-neutral-900/80 px-1 rounded border border-neutral-850">Del</span>
              </div>
            </div>
          </div>
        </nav>

        {/* Customer & Project Metadata Inputs */}
        <div className="p-6 border-t border-neutral-900 bg-neutral-950/40 space-y-4">
          <div>
            <label className="block text-[9px] font-black uppercase text-neutral-500 tracking-wider mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={project.name}
              onChange={(e) => updateProjectWithHistory((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-400 outline-none transition-all font-semibold"
            />
          </div>

          <div>
            <label className="block text-[9px] font-black uppercase text-neutral-500 tracking-wider mb-1">
              Customer Name
            </label>
            <input
              type="text"
              value={project.customer.name}
              onChange={(e) =>
                updateProjectWithHistory((prev) => ({
                  ...prev,
                  customer: { ...prev.customer, name: e.target.value },
                }))
              }
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-400 outline-none transition-all font-semibold"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black uppercase text-neutral-500 tracking-wider mb-1">
              Customer Phone
            </label>
            <input
              type="text"
              value={project.customer.phone}
              onChange={(e) =>
                updateProjectWithHistory((prev) => ({
                  ...prev,
                  customer: { ...prev.customer, phone: e.target.value },
                }))
              }
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-400 outline-none transition-all font-semibold"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black uppercase text-neutral-500 tracking-wider mb-1">
              Customer Email
            </label>
            <input
              type="email"
              value={project.customer.email || ''}
              onChange={(e) =>
                updateProjectWithHistory((prev) => ({
                  ...prev,
                  customer: { ...prev.customer, email: e.target.value },
                }))
              }
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-400 outline-none transition-all font-semibold"
              placeholder="customer@email.com"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black uppercase text-neutral-500 tracking-wider mb-1">
              Customer Location / Address
            </label>
            <input
              type="text"
              value={project.customer.location || ''}
              onChange={(e) =>
                updateProjectWithHistory((prev) => ({
                  ...prev,
                  customer: { ...prev.customer, location: e.target.value },
                }))
              }
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-400 outline-none transition-all font-semibold"
              placeholder="e.g. Regina, SK"
            />
          </div>
        </div>

        {/* Global Unified PDF Report Export */}
        <div className="p-6 border-t border-neutral-900 bg-neutral-950 flex flex-col gap-3">
          <label className="flex items-center gap-2.5 text-[10px] font-black uppercase text-neutral-400 select-none cursor-pointer tracking-wider hover:text-white transition-colors">
            <input
              type="checkbox"
              checked={includeAssetDirectory}
              onChange={(e) => setIncludeAssetDirectory(e.target.checked)}
              className="accent-amber-400 h-3.5 w-3.5 rounded border-neutral-800 bg-neutral-900 text-amber-400 focus:ring-0 cursor-pointer"
            />
            Include Assets Directory Table
          </label>
          <button
            onClick={triggerPDFExport}
            className="w-full py-3.5 bg-amber-400 hover:bg-amber-300 text-black font-black text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-400/10 tracking-wider cursor-pointer"
          >
            GENERATE SUITE PDF
            <Download size={14} strokeWidth={2.5} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-screen relative flex flex-col bg-neutral-100 overflow-hidden">
        {activeTab === 'dashboard' && (
          <DashboardView
            project={project}
            onUpdateProject={updateProjectWithHistory}
            onSelectYard={(yardId) => updateProjectWithHistory((prev) => ({ ...prev, activeYardId: yardId }))}
            onSwitchTab={setActiveTab}
            onLocateAsset={handleLocateAsset}
            lastSavedTime={lastAutoSaved}
            onSaveComplete={() => setLastAutoSaved(new Date())}
          />
        )}

        {activeTab === 'planner' && (
          <SitePlannerView
            project={project}
            onUpdateProject={updateProjectWithHistory}
            onSwitchTab={setActiveTab}
            onSelectBinInEstimator={handleSelectBinInEstimator}
            selectedAssetId={selectedAssetId}
            onSelectAsset={setSelectedAssetId}
          />
        )}

        {activeTab === 'estimator' && (
          <CableEstimatorView
            project={project}
            onUpdateProject={updateProjectWithHistory}
            onSwitchTab={setActiveTab}
            activeBinId={activeBinId}
          />
        )}
      </main>

      {/* Hidden Rendering Area for html2canvas PDF Captures */}
      <div
        id="pdf-render-zone"
        className="fixed top-0 left-0 w-[800px] bg-white text-black z-[-1] opacity-0 pointer-events-none"
      />

      {/* GitHub Sync Modal */}
      {showGitModal && isDevMode && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-neutral-950 border border-neutral-900 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-neutral-900 flex items-center justify-between bg-neutral-950">
              <div className="flex items-center gap-2 text-white">
                <Github size={18} className="text-amber-400" />
                <span className="font-black text-sm uppercase tracking-wider">Push to GitHub</span>
              </div>
              {!isPushingToGit && (
                <button
                  onClick={() => setShowGitModal(false)}
                  className="text-neutral-500 hover:text-white transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {/* Content */}
            <div className="p-6">
              {isPushingToGit ? (
                <div className="py-10 flex flex-col items-center justify-center text-center space-y-4">
                  <Loader2 size={40} className="text-amber-400 animate-spin" />
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Deploying changes...</h3>
                    <p className="text-xs text-neutral-500 mt-1">Staging files and pushing to production repository branch.</p>
                  </div>
                </div>
              ) : gitResult ? (
                <div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
                  {gitResult.success ? (
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
                      <AlertTriangle size={24} />
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      {gitResult.success ? 'Sync Completed!' : 'Sync Failed'}
                    </h3>
                    <p className="text-xs text-neutral-400 mt-2 leading-relaxed px-4">
                      {gitResult.message}
                    </p>
                  </div>

                  <div className="pt-4 w-full">
                    <button
                      onClick={() => {
                        setShowGitModal(false);
                        setGitResult(null);
                      }}
                      className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-850 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors border border-neutral-800 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest block mb-2">
                      Modified Files ({gitStatus?.changes?.length || 0})
                    </span>
                    <div className="bg-neutral-900 border border-neutral-850 rounded-xl p-3 max-h-36 overflow-y-auto font-mono text-[10px] text-neutral-400 space-y-1">
                      {gitStatus?.changes && gitStatus.changes.length > 0 ? (
                        gitStatus.changes.map((change, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className={`font-bold uppercase ${
                              change.startsWith('M') ? 'text-amber-400' :
                              change.startsWith('A') || change.includes('??') ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                              {change.slice(0, 2)}
                            </span>
                            <span className="truncate">{change.slice(2)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center text-neutral-600 py-4 uppercase tracking-wider">
                          No pending changes
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1.5">
                      Commit Message
                    </label>
                    <input
                      type="text"
                      value={gitPushMessage}
                      onChange={(e) => setGitPushMessage(e.target.value)}
                      placeholder="e.g. Update grain bin dimensions"
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-xs text-white focus:border-amber-400 outline-none transition-all font-semibold"
                    />
                  </div>

                  <div className="pt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowGitModal(false)}
                      className="flex-1 py-2.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-400 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors border border-neutral-800 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGitPush(gitPushMessage)}
                      className="flex-1 py-2.5 bg-amber-400 hover:bg-amber-300 text-black rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-amber-400/10 cursor-pointer"
                    >
                      Push & Deploy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
