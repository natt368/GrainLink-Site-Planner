/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Project, Yard, Asset, BinAsset } from '../types';
import { getCableRecommendation } from '../utils/pdfGenerator';
import { Plus, Edit2, Trash2, FolderOpen, Save, MapPin, Cloud, LogOut, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import {
  initAuth,
  googleSignIn,
  logout,
  saveProjectToDrive,
  listProjectsFromDrive,
  loadProjectFromDrive,
  DriveFile
} from '../utils/googleDrive';

interface DashboardViewProps {
  project: Project;
  onUpdateProject: (updater: (prev: Project) => Project) => void;
  onSelectYard: (yardId: number) => void;
  onSwitchTab: (tabId: 'dashboard' | 'planner' | 'estimator') => void;
  onLocateAsset: (assetId: number) => void;
  lastSavedTime?: Date | null;
  onSaveComplete?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  project,
  onUpdateProject,
  onSelectYard,
  onSwitchTab,
  onLocateAsset,
  lastSavedTime,
  onSaveComplete,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [isSavingDrive, setIsSavingDrive] = useState(false);
  const [driveSuccessMessage, setDriveSuccessMessage] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (u, token) => {
        setUser(u);
        setAccessToken(token);
        fetchDriveFiles(token);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setDriveFiles([]);
      }
    );
    return () => unsubscribe();
  }, []);

  const fetchDriveFiles = async (tokenToUse?: string) => {
    const tok = tokenToUse || accessToken;
    if (!tok) return;
    setIsLoadingDrive(true);
    setDriveError(null);
    try {
      const files = await listProjectsFromDrive(tok);
      setDriveFiles(files);
    } catch (err: any) {
      console.error(err);
      setDriveError(err.message || 'Failed to list designs from Google Drive');
      if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
        logout().catch(console.error);
        setUser(null);
        setAccessToken(null);
        setDriveFiles([]);
      }
    } finally {
      setIsLoadingDrive(false);
    }
  };

  const handleConnectDrive = async () => {
    setDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        fetchDriveFiles(result.accessToken);
      }
    } catch (err: any) {
      setDriveError(err.message || 'Google Drive connection failed');
    }
  };

  const handleDisconnectDrive = async () => {
    setDriveError(null);
    try {
      await logout();
      setUser(null);
      setAccessToken(null);
      setDriveFiles([]);
    } catch (err: any) {
      setDriveError(err.message || 'Sign out failed');
    }
  };

  const handleSaveToDrive = async () => {
    if (!accessToken) return;
    const confirmed = window.confirm(`Save design "${project.name}" to the connected Google Drive folder?`);
    if (!confirmed) return;

    setIsSavingDrive(true);
    setDriveError(null);
    setDriveSuccessMessage(null);
    try {
      await saveProjectToDrive(accessToken, project);
      setDriveSuccessMessage('Saved to Google Drive successfully!');
      onSaveComplete?.();
      setTimeout(() => setDriveSuccessMessage(null), 4000);
      fetchDriveFiles(accessToken);
    } catch (err: any) {
      setDriveError(err.message || 'Failed to save to Google Drive');
      if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
        logout().catch(console.error);
        setUser(null);
        setAccessToken(null);
        setDriveFiles([]);
      }
    } finally {
      setIsSavingDrive(false);
    }
  };

  const handleBackupToDriveClick = async () => {
    let currentToken = accessToken;
    if (!currentToken) {
      setDriveError(null);
      try {
        const result = await googleSignIn();
        if (result) {
          setUser(result.user);
          setAccessToken(result.accessToken);
          currentToken = result.accessToken;
        } else {
          return;
        }
      } catch (err: any) {
        setDriveError(err.message || 'Google Drive connection failed');
        return;
      }
    }

    if (!currentToken) return;
    const confirmed = window.confirm(`Save design "${project.name}" to the connected Google Drive folder?`);
    if (!confirmed) return;

    setIsSavingDrive(true);
    setDriveError(null);
    setDriveSuccessMessage(null);
    try {
      await saveProjectToDrive(currentToken, project);
      setDriveSuccessMessage('Saved to Google Drive successfully!');
      onSaveComplete?.();
      setTimeout(() => setDriveSuccessMessage(null), 4000);
      fetchDriveFiles(currentToken);
    } catch (err: any) {
      setDriveError(err.message || 'Failed to save to Google Drive');
      if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
        logout().catch(console.error);
        setUser(null);
        setAccessToken(null);
        setDriveFiles([]);
      }
    } finally {
      setIsSavingDrive(false);
    }
  };

  const handleLoadFromDrive = async (fileId: string, fileName: string) => {
    if (!accessToken) return;
    const confirmed = window.confirm(`Load design "${fileName}" from Google Drive? This will replace your current unsaved workspace.`);
    if (!confirmed) return;

    setIsLoadingDrive(true);
    setDriveError(null);
    try {
      const loaded = await loadProjectFromDrive(accessToken, fileId);
      onUpdateProject(() => loaded);
      setDriveSuccessMessage(`Successfully loaded design "${fileName}"!`);
      setTimeout(() => setDriveSuccessMessage(null), 4000);
    } catch (err: any) {
      setDriveError(err.message || 'Failed to load design');
      if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
        logout().catch(console.error);
        setUser(null);
        setAccessToken(null);
        setDriveFiles([]);
      }
    } finally {
      setIsLoadingDrive(false);
    }
  };

  // Compute stats
  const totalYards = project.yards.length;
  let totalCapacity = 0;
  let totalChesterX = 0;
  let totalChesterX1 = 0;
  let totalJunctionBoxes = 0;
  const allBins: { yardName: string; bin: BinAsset }[] = [];

  project.yards.forEach((yard) => {
    yard.bins.forEach((b) => {
      if (b.type === 'bin') {
        allBins.push({ yardName: yard.name, bin: b as BinAsset });
        const D = parseFloat(b.diameter) || 0;
        const H = parseFloat(b.totalHeight) || 0;
        const E = parseFloat(b.eaveHeight) || 0;
        const F = parseFloat(b.floorThick) || 0;
        const cap = Math.round(
          Math.PI * Math.pow(D / 2, 2) * (Math.max(0, E - F) + (H - E) / 3) * 0.80356
        );
        totalCapacity += cap;
      } else if (b.type === 'chester-x') {
        totalChesterX++;
      } else if (b.type === 'chester-x1') {
        totalChesterX1++;
      } else if (b.type === 'junction-box') {
        totalJunctionBoxes++;
      }
    });
  });

  // Yards CRUD actions
  const handleCreateYard = () => {
    const name = prompt('Enter new yard name:', `Yard ${project.yards.length + 1}`);
    if (!name) return;

    const newId = Date.now();
    onUpdateProject((prev) => ({
      ...prev,
      activeYardId: newId,
      yards: [
        ...prev.yards,
        {
          id: newId,
          name,
          bins: [],
        },
      ],
    }));
  };

  const handleRenameYard = (yardId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const yard = project.yards.find((y) => y.id === yardId);
    if (!yard) return;

    const newName = prompt('Rename Yard:', yard.name);
    if (!newName) return;

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => (y.id === yardId ? { ...y, name: newName } : y)),
    }));
  };

  const handleEditLocation = (yardId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const yard = project.yards.find((y) => y.id === yardId);
    if (!yard) return;

    const newLocation = prompt('Enter Location Info for ' + yard.name + ':', yard.location || '');
    if (newLocation === null) return;

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => (y.id === yardId ? { ...y, location: newLocation } : y)),
    }));
  };

  const handleDeleteYard = (yardId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (project.yards.length <= 1) {
      alert('Projects must contain at least one yard layout.');
      return;
    }

    if (!confirm('Are you sure you want to delete this yard and all its placed assets?')) return;

    onUpdateProject((prev) => {
      const remainingYards = prev.yards.filter((y) => y.id !== yardId);
      const nextActiveId = prev.activeYardId === yardId ? remainingYards[0].id : prev.activeYardId;
      return {
        ...prev,
        activeYardId: nextActiveId,
        yards: remainingYards,
      };
    });
  };

  // JSON Save / Load
  const handleSaveProject = () => {
    const dataStr = JSON.stringify(project, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportName = project.name.replace(/\s+/g, '_').toLowerCase() + '_multiyard_project.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportName);
    linkElement.click();
  };

  const handleTriggerLoad = () => {
    fileInputRef.current?.click();
  };

  const handleLoadProjectJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        let loadedProject: Project;

        if (Array.isArray(imported)) {
          const mainYardId = Date.now();
          loadedProject = {
            name: 'Imported Legacy Layout',
            customer: { name: 'Legacy Cust', phone: '-' },
            date: new Date().toLocaleDateString(),
            activeYardId: mainYardId,
            yards: [{ id: mainYardId, name: 'Main Yard', bins: imported }],
          };
        } else if (imported.bins && !imported.yards) {
          const mainYardId = Date.now();
          loadedProject = {
            name: imported.name || 'Imported Legacy Layout',
            customer: { name: imported.client || 'Legacy Cust', phone: '-' },
            date: new Date().toLocaleDateString(),
            activeYardId: mainYardId,
            yards: [{ id: mainYardId, name: 'Main Yard', bins: imported.bins }],
          };
        } else {
          loadedProject = {
            name: imported.name || 'Miller Site Layout',
            customer: imported.customer || { name: 'John Miller', phone: '555-0199' },
            date: imported.date || new Date().toLocaleDateString(),
            activeYardId: imported.activeYardId || (imported.yards?.[0]?.id || null),
            yards: imported.yards || [],
          };
        }

        if (loadedProject.yards.length === 0) {
          const defId = Date.now();
          loadedProject.yards.push({ id: defId, name: 'Home Yard', bins: [] });
          loadedProject.activeYardId = defId;
        }

        onUpdateProject(() => loadedProject);
      } catch (err) {
        alert('Invalid project format. Make sure the JSON file is a valid GrainLink layout.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div id="view-dashboard" className="flex-1 flex flex-col md:flex-row p-4 md:p-8 overflow-hidden gap-6 md:gap-8 h-full custom-scrollbar">
      {/* Left Side: Dashboard Stats and Inventory */}
      <div className="flex-[2] flex flex-col space-y-6 h-full overflow-hidden pr-2">
        <div>
          <h2 id="dashboard-project-name" className="text-2xl md:text-3xl font-black text-neutral-900 tracking-tight uppercase">
            {project.name}
          </h2>
          <p className="text-xs text-neutral-600 font-bold uppercase tracking-widest mt-1">
            Multi-Yard Overview &amp; Statistics
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {/* Card 1: Combined Project Scope Overview */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between" style={{ background: '#0a0a0c', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <span className="text-[10px] text-neutral-500 font-black uppercase tracking-wider mb-2 block">Project Scope Overview</span>
            <div className="grid grid-cols-2 gap-4 h-full items-center">
              {/* Total Capacity */}
              <div className="border-r border-neutral-900 pr-2">
                <span className="text-[9px] text-neutral-600 font-bold uppercase tracking-wider block">Total Capacity</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span id="stat-total-capacity" className="text-2xl md:text-3xl font-bold text-amber-400 font-mono">
                    {totalCapacity.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold text-neutral-500">BU</span>
                </div>
              </div>
              {/* Yards Planned */}
              <div className="pl-2">
                <span className="text-[9px] text-neutral-600 font-bold uppercase tracking-wider block">Yards Planned</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span id="stat-total-yards" className="text-2xl md:text-3xl font-bold text-white font-mono">
                    {totalYards}
                  </span>
                  <span className="text-[10px] font-bold text-neutral-500">{totalYards === 1 ? 'Yard' : 'Yards'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Placed Hardware Summary */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between" style={{ background: '#0a0a0c', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <span className="text-[10px] text-neutral-500 font-black uppercase tracking-wider mb-2 block">Placed Hardware Summary</span>
            <div className="grid grid-cols-3 gap-1 h-full items-center text-center">
              {/* Chester-X */}
              <div className="border-r border-neutral-900 px-1">
                <span className="text-[9px] text-neutral-600 font-bold uppercase tracking-wider block mb-1">Chester-X</span>
                <div className="flex flex-col items-center justify-center">
                  <span className="text-xl md:text-2xl font-bold text-red-500 font-mono">
                    {totalChesterX}
                  </span>
                  <span className="text-[8px] font-black uppercase text-red-500/50 tracking-widest mt-0.5">Placed</span>
                </div>
              </div>
              {/* Chester-X1 */}
              <div className="border-r border-neutral-900 px-1">
                <span className="text-[9px] text-neutral-600 font-bold uppercase tracking-wider block mb-1">Chester-X1</span>
                <div className="flex flex-col items-center justify-center">
                  <span className="text-xl md:text-2xl font-bold text-blue-500 font-mono">
                    {totalChesterX1}
                  </span>
                  <span className="text-[8px] font-black uppercase text-blue-500/50 tracking-widest mt-0.5">Placed</span>
                </div>
              </div>
              {/* Junction Boxes */}
              <div className="px-1">
                <span className="text-[9px] text-neutral-600 font-bold uppercase tracking-wider block mb-1">Junction Box</span>
                <div className="flex flex-col items-center justify-center">
                  <span className="text-xl md:text-2xl font-bold text-emerald-400 font-mono">
                    {totalJunctionBoxes}
                  </span>
                  <span className="text-[8px] font-black uppercase text-emerald-400/50 tracking-widest mt-0.5">Placed</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cable Arrangement Reference Diagram */}
        <div className="glass-panel rounded-2xl overflow-hidden border border-neutral-900 bg-neutral-950">
          <div className="px-5 pt-5 pb-3 border-b border-neutral-900">
            <h3 className="text-xs font-black uppercase tracking-widest text-white">Recommended Cable Arrangement</h3>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[500px] grid grid-cols-[130px_1fr_1fr_1fr_1fr] text-center text-xs divide-x divide-neutral-900 border-b border-neutral-900">
              {/* Header Row */}
              <div className="bg-neutral-900/60 p-3 flex items-center justify-center">
                <span className="text-[10px] font-black uppercase text-neutral-400 tracking-wider">Bin Diameter</span>
              </div>
              <div className="bg-neutral-900/40 p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-white">Less than 24 ft</span>
              </div>
              <div className="bg-neutral-900/40 p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-white">24 ft to 35 ft</span>
              </div>
              <div className="bg-neutral-900/40 p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-white">36 ft to 41 ft</span>
              </div>
              <div className="bg-neutral-900/40 p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-white">42 ft to 47 ft+</span>
              </div>
            </div>

            <div className="min-w-[500px] grid grid-cols-[130px_1fr_1fr_1fr_1fr] text-center text-xs divide-x divide-neutral-900 divide-y-0 bg-neutral-950/10">
              {/* Diagram Row */}
              <div className="p-4 flex items-center justify-center border-b border-neutral-900 bg-neutral-900/20">
                <span className="text-[10px] font-black text-neutral-400 uppercase leading-snug tracking-wide text-center">
                  Cable Position
                  <br />
                  Arrangement
                </span>
              </div>

              {/* Less than 24 ft */}
              <div className="p-4 flex items-center justify-center border-b border-neutral-900">
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <defs>
                    <radialGradient id="binGrad1" cx="45%" cy="38%" r="60%">
                      <stop offset="0%" stopColor="#3a3020" />
                      <stop offset="100%" stopColor="#111108" />
                    </radialGradient>
                  </defs>
                  <circle cx="50" cy="50" r="44" fill="url(#binGrad1)" stroke="#fbbf24" strokeWidth="2.5" />
                  <circle cx="50" cy="50" r="6" fill="#fbbf24" />
                </svg>
              </div>

              {/* 24-35 ft */}
              <div className="p-4 flex items-center justify-center border-b border-neutral-900">
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <defs>
                    <radialGradient id="binGrad2" cx="45%" cy="38%" r="60%">
                      <stop offset="0%" stopColor="#3a3020" />
                      <stop offset="100%" stopColor="#111108" />
                    </radialGradient>
                  </defs>
                  <circle cx="50" cy="50" r="44" fill="url(#binGrad2)" stroke="#fbbf24" strokeWidth="2.5" />
                  <line x1="50" y1="50" x2="50" y2="24" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <line x1="50" y1="50" x2="72.5" y2="63" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <line x1="50" y1="50" x2="27.5" y2="63" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <circle cx="50" cy="24" r="5.5" fill="#fbbf24" />
                  <circle cx="72.5" cy="63" r="5.5" fill="#fbbf24" />
                  <circle cx="27.5" cy="63" r="5.5" fill="#fbbf24" />
                </svg>
              </div>

              {/* 36-41 ft */}
              <div className="p-4 flex items-center justify-center border-b border-neutral-900">
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <defs>
                    <radialGradient id="binGrad3" cx="45%" cy="38%" r="60%">
                      <stop offset="0%" stopColor="#3a3020" />
                      <stop offset="100%" stopColor="#111108" />
                    </radialGradient>
                  </defs>
                  <circle cx="50" cy="50" r="44" fill="url(#binGrad3)" stroke="#fbbf24" strokeWidth="2.5" />
                  <line x1="50" y1="50" x2="50" y2="24" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <line x1="50" y1="50" x2="72.5" y2="63" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <line x1="50" y1="50" x2="27.5" y2="63" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <circle cx="50" cy="50" r="6" fill="#fbbf24" />
                  <circle cx="50" cy="24" r="5.5" fill="#fbbf24" />
                  <circle cx="72.5" cy="63" r="5.5" fill="#fbbf24" />
                  <circle cx="27.5" cy="63" r="5.5" fill="#fbbf24" />
                </svg>
              </div>

              {/* 42-47 ft+ */}
              <div className="p-4 flex items-center justify-center border-b border-neutral-900">
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <defs>
                    <radialGradient id="binGrad4" cx="45%" cy="38%" r="60%">
                      <stop offset="0%" stopColor="#3a3020" />
                      <stop offset="100%" stopColor="#111108" />
                    </radialGradient>
                    <clipPath id="binClip4">
                      <circle cx="50" cy="50" r="43" />
                    </clipPath>
                  </defs>
                  <circle cx="50" cy="50" r="44" fill="url(#binGrad4)" stroke="#fbbf24" strokeWidth="2.5" />
                  <line x1="6" y1="50" x2="94" y2="50" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" clipPath="url(#binClip4)" />
                  <line x1="50" y1="6" x2="50" y2="94" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" clipPath="url(#binClip4)" />
                  <circle cx="50" cy="50" r="6" fill="#fbbf24" />
                  <circle cx="50" cy="25" r="5.5" fill="#fbbf24" />
                  <circle cx="75" cy="50" r="5.5" fill="#fbbf24" />
                  <circle cx="50" cy="75" r="5.5" fill="#fbbf24" />
                  <circle cx="25" cy="50" r="5.5" fill="#fbbf24" />
                </svg>
              </div>
            </div>

            <div className="min-w-[500px] grid grid-cols-[130px_1fr_1fr_1fr_1fr] text-center text-xs divide-x divide-neutral-900">
              {/* Cable Count Row */}
              <div className="bg-neutral-900/20 p-3 flex items-center justify-center">
                <span className="text-[10px] font-black text-neutral-400 uppercase leading-snug tracking-wide text-center">
                  Recommended
                  <br />
                  Number of
                  <br />
                  Cables
                </span>
              </div>
              <div className="p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-amber-400">1 Center</span>
              </div>
              <div className="p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-amber-400">3 Radius</span>
              </div>
              <div className="p-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[11px] font-black text-amber-400">1 Center</span>
                <span className="text-[11px] font-black text-amber-400">3 Radius</span>
              </div>
              <div className="p-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[11px] font-black text-amber-400">1 Center</span>
                <span className="text-[11px] font-black text-amber-400">4 Radius</span>
              </div>
            </div>
          </div>
        </div>

        {/* Assets Inventory Table */}
        <div className="glass-panel rounded-2xl flex-1 min-h-[180px] flex flex-col border border-neutral-900 bg-neutral-950 overflow-hidden">
          <div className="p-5 border-b border-neutral-900 flex justify-between items-center shrink-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">Asset List</h3>
            <button
              onClick={() => onSwitchTab('planner')}
              className="px-3.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 text-[10px] font-bold uppercase rounded-lg border border-neutral-850 transition-colors"
            >
              Draw Layout
            </button>
          </div>
          <div className="overflow-auto flex-1 custom-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-neutral-950/95 backdrop-blur-sm z-10">
                <tr className="border-b border-neutral-900 text-[9px] font-black uppercase text-neutral-500 tracking-wider bg-neutral-950/20">
                  <th className="p-4">Yard Location</th>
                  <th className="p-4">Asset Label</th>
                  <th className="p-4">Asset Type</th>
                  <th className="p-4">Dimensions</th>
                  <th className="p-4">Storage (BU)</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody id="dashboard-table-body" className="divide-y divide-neutral-900/40">
                {project.yards.some((y) => y.bins.length > 0) ? (
                  (() => {
                    const allAssets = project.yards.flatMap((yard) =>
                      yard.bins.map((bin) => ({ yard, bin }))
                    );
                    const getSortWeight = (type: string) => {
                      if (type === 'chester-x' || type === 'chester-x1') return 1;
                      if (type === 'bin') return 2;
                      if (type === 'junction-box') return 3;
                      if (type === 'zone') return 4;
                      return 5;
                    };
                    const sortedAssets = [...allAssets].sort((a, b) => {
                      const wA = getSortWeight(a.bin.type);
                      const wB = getSortWeight(b.bin.type);
                      if (wA !== wB) return wA - wB;
                      return (a.bin.name || '').localeCompare(b.bin.name || '');
                    });
                    const getBadgeColor = (type: string) => {
                      if (type === 'bin') return 'bg-amber-400/10 text-amber-400 border-amber-400/20';
                      if (type === 'chester-x') return 'bg-red-500/10 text-red-500 border-red-500/20';
                      if (type === 'chester-x1') return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
                      if (type === 'junction-box') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                      return 'bg-neutral-800 text-neutral-400 border-neutral-700';
                    };
                    const getBadgeLabel = (type: string) => {
                      if (type === 'bin') return 'Bin Unit';
                      if (type === 'chester-x') return 'Chester-X';
                      if (type === 'chester-x1') return 'Chester-X1';
                      if (type === 'junction-box') return 'Junction Box';
                      return 'Cable Zone';
                    };

                    return sortedAssets.map(({ yard, bin }) => {
                      let typeBadge = (
                        <span className={`px-2 py-0.5 border text-[9px] font-black uppercase rounded ${getBadgeColor(bin.type)}`}>
                          {getBadgeLabel(bin.type)}
                        </span>
                      );
                      let dimensionsStr = '';
                      let capacityStr = '-';

                      if (bin.type === 'bin') {
                        dimensionsStr = `${bin.diameter}' Dia | ${bin.eaveHeight}' Eave | ${bin.totalHeight}' Ht`;
                        const D = parseFloat(bin.diameter) || 0;
                        const H = parseFloat(bin.totalHeight) || 0;
                        const E = parseFloat(bin.eaveHeight) || 0;
                        const F = parseFloat(bin.floorThick) || 0;
                        const cap = Math.round(
                          Math.PI * Math.pow(D / 2, 2) * (Math.max(0, E - F) + (H - E) / 3) * 0.80356
                        );
                        capacityStr = `${cap.toLocaleString()} BU`;
                      } else if (bin.type === 'chester-x' || bin.type === 'chester-x1' || bin.type === 'junction-box') {
                        dimensionsStr = `${(bin as any).diameter || '10'}' Size`;
                      } else if (bin.type === 'zone') {
                        dimensionsStr = `${bin.width}' W x ${bin.height}' H`;
                      }

                      return (
                        <tr key={bin.id} className="hover:bg-neutral-900/20 transition-colors border-b border-neutral-900/30">
                          <td className="p-4 font-bold text-neutral-400 text-xs">{yard.name}</td>
                          <td className="p-4 font-bold text-white">{bin.name || 'Unnamed Asset'}</td>
                          <td className="p-4">{typeBadge}</td>
                          <td className="p-4 text-neutral-400 font-semibold">{dimensionsStr}</td>
                          <td className="p-4 font-mono">{capacityStr}</td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => onLocateAsset(bin.id)}
                              className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-[10px] font-black uppercase rounded transition-colors flex items-center gap-1.5 ml-auto"
                            >
                              <MapPin size={12} className="text-amber-400" />
                              Locate
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()
                ) : (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-neutral-500 uppercase text-xs font-bold tracking-widest">
                      No assets placed in any yard. Add units in the Site Planner.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Side: Yards Manager Panel + Project File Controls */}
      <div className="flex-1 max-w-sm flex flex-col gap-4 overflow-hidden shrink-0">
        {/* Save / Load Project File Actions */}
        <div className="bg-neutral-950 rounded-2xl border border-neutral-900 p-5 flex flex-col gap-3.5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-neutral-500">
              Design Actions
            </h3>
            {accessToken && (
              <button
                onClick={handleDisconnectDrive}
                className="text-[9px] font-bold text-neutral-500 hover:text-red-400 uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                title="Sign out of Google Drive"
              >
                <LogOut size={10} />
                Disconnect
              </button>
            )}
          </div>

          {driveError && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-[10px] text-red-400">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-500" />
              <span className="break-all">{driveError}</span>
            </div>
          )}

          {driveSuccessMessage && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2 text-[10px] text-emerald-400">
              <Check size={12} className="shrink-0 text-emerald-400" />
              <span>{driveSuccessMessage}</span>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {/* 1. Back up to drive */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleBackupToDriveClick}
                  disabled={isSavingDrive}
                  className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 border cursor-pointer transition-all ${
                    isSavingDrive
                      ? 'bg-neutral-900 border-neutral-800 text-neutral-500 pointer-events-none'
                      : 'bg-amber-400 border-amber-500 hover:bg-amber-300 text-black shadow-md'
                  }`}
                >
                  {isSavingDrive ? (
                    <>
                      <RefreshCw size={12} className="animate-spin text-neutral-500" />
                      Backing up...
                    </>
                  ) : (
                    <>
                      <Cloud size={14} />
                      Back up to Drive
                    </>
                  )}
                </button>

                {/* Status Circle Indicator */}
                <div className="flex items-center justify-center w-12 h-[46px] rounded-xl bg-neutral-900 border border-neutral-800 shrink-0" title="Google Drive Backup Status">
                  {isSavingDrive ? (
                    <div className="relative flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full border-2 border-neutral-800 border-t-amber-400 animate-spin"></div>
                      <div className="absolute w-1.5 h-1.5 rounded-full bg-amber-400/80 animate-pulse"></div>
                    </div>
                  ) : driveSuccessMessage ? (
                    <div className="flex items-center justify-center text-emerald-400" title="Backup Complete">
                      <div className="relative">
                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center animate-bounce">
                          <Check size={10} className="stroke-[3]" />
                        </div>
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                      </div>
                    </div>
                  ) : driveError ? (
                    <div className="flex items-center justify-center text-red-400" title="Backup Failed">
                      <div className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center">
                        <AlertTriangle size={10} className="stroke-[3]" />
                      </div>
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full border border-dashed border-neutral-800 flex items-center justify-center" title="Ready to Backup">
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-800"></div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Import JSON file */}
            <button
              onClick={handleTriggerLoad}
              className="w-full py-3 bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-800 text-xs font-bold uppercase rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              title="Import design from a local JSON file"
            >
              <FolderOpen size={14} className="text-amber-400" />
              Import JSON File
            </button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".json"
              onChange={handleLoadProjectJSON}
            />

            {/* 3. Export JSON file */}
            <button
              onClick={handleSaveProject}
              className="w-full py-3 bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-800 text-xs font-bold uppercase rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              title="Export design as a local JSON file"
            >
              <Save size={14} className="text-amber-400" />
              Export JSON File
            </button>
          </div>

          <p className="text-[9px] text-neutral-600 font-bold uppercase tracking-wider mt-1 text-center">
            Double-click a yard below to open in 2D Planner
          </p>
        </div>

        {/* Yards Manager */}
        <div className="bg-neutral-950 rounded-2xl border border-neutral-900 p-5 flex flex-col flex-grow overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Yards Manager</h3>
            <button
              onClick={handleCreateYard}
              className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black text-[10px] font-black uppercase rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Plus size={12} strokeWidth={3} />
              Add Yard
            </button>
          </div>
          <div id="yards-list" className="flex-grow overflow-y-auto space-y-3 pr-1 custom-scrollbar">
            {project.yards.map((yard) => {
              const isActive = yard.id === project.activeYardId;
              const totalBinsInYard = yard.bins.filter((b) => b.type === 'bin').length;
              const totalAssetsInYard = yard.bins.length;

              return (
                <div
                  key={yard.id}
                  onClick={() => onSelectYard(yard.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onSelectYard(yard.id);
                    onSwitchTab('planner');
                  }}
                  className={`p-4 rounded-xl border transition-all cursor-pointer select-none ${
                    isActive
                      ? 'bg-amber-400/5 border-amber-400/30'
                      : 'bg-neutral-900 border-neutral-850 hover:bg-neutral-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-sm ${isActive ? 'text-amber-400' : 'text-white'}`}>
                      {yard.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleEditLocation(yard.id, e)}
                        className="p-1 hover:text-white text-neutral-500 transition-colors"
                        title="Edit Yard Location"
                      >
                        <MapPin size={12} />
                      </button>
                      <button
                        onClick={(e) => handleRenameYard(yard.id, e)}
                        className="p-1 hover:text-white text-neutral-500 transition-colors"
                        title="Rename Yard"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteYard(yard.id, e)}
                        className="p-1 hover:text-red-400 text-neutral-500 transition-colors"
                        title="Delete Yard"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {yard.location ? (
                    <div className="text-[11px] text-amber-400/85 mt-1 flex items-center gap-1.5 font-medium leading-none">
                      <MapPin size={10} className="shrink-0 text-amber-400" />
                      <span className="truncate">{yard.location}</span>
                    </div>
                  ) : (
                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditLocation(yard.id, e);
                      }}
                      className="text-[10px] text-neutral-600 hover:text-neutral-400 italic mt-1 flex items-center gap-1 cursor-pointer select-none"
                    >
                      <MapPin size={10} className="shrink-0 text-neutral-700" />
                      <span>Add Location info...</span>
                    </div>
                  )}
                  <div className="text-[10px] text-neutral-500 font-bold uppercase mt-2.5 flex justify-between border-t border-neutral-900/40 pt-1.5">
                    <span>{totalBinsInYard} Bins</span>
                    <span>{totalAssetsInYard} Assets Total</span>
                  </div>
                  <p className="text-[9px] text-neutral-600 mt-1.5 font-bold">Double-click to open in planner</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
