/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Project, Yard, Asset, BinAsset, MarkerAsset, ZoneAsset } from '../types';
import { getCableRecommendation } from '../utils/pdfGenerator';
import { Trash2, Copy, Compass, Plus, Settings, RefreshCw, ZoomIn, Info, MapPin } from 'lucide-react';

interface SitePlannerViewProps {
  project: Project;
  onUpdateProject: (updater: (prev: Project) => Project) => void;
  onSwitchTab: (tabId: 'dashboard' | 'planner' | 'estimator') => void;
  onSelectBinInEstimator: (binId: number) => void;
  selectedAssetId: number | null;
  onSelectAsset: (assetId: number | null) => void;
}

const GRID_SIZE = 5;
const VISUAL_GRID_MAJOR = 50;
const BASE_SCALE = 3.0;
const BIN_SIZES = [18, 24, 30, 36, 42, 48, 50];

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const SitePlannerView: React.FC<SitePlannerViewProps> = ({
  project,
  onUpdateProject,
  onSwitchTab,
  onSelectBinInEstimator,
  selectedAssetId,
  onSelectAsset,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Canvas size state
  const [dimensions, setDimensions] = useState({ width: 600, height: 600 });

  // Navigation view state (zoom/pan)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1.0 });

  // Dragging / Interaction state
  const dragInfoRef = useRef<{
    active: boolean;
    offset: { x: number; y: number };
  }>({ active: false, offset: { x: 0, y: 0 } });

  const panInfoRef = useRef<{
    active: boolean;
    start: { x: number; y: number };
  }>({ active: false, start: { x: 0, y: 0 } });

  const resizeInfoRef = useRef<{
    active: boolean;
    anchorX?: number;
    anchorY?: number;
  }>({ active: false });

  const activeYard = useMemo(() => {
    return project.yards.find((y) => y.id === project.activeYardId) || project.yards[0];
  }, [project.yards, project.activeYardId]);

  const selectedAsset = useMemo(() => {
    if (!activeYard || selectedAssetId === null) return null;
    return activeYard.bins.find((b) => b.id === selectedAssetId) || null;
  }, [activeYard, selectedAssetId]);

  // Track resizing of container
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Helper coordinate conversion
  const screenToWorld = (sx: number, sy: number) => {
    return {
      x: (sx - view.x) / view.scale,
      y: (sy - view.y) / view.scale,
    };
  };

  // Setup Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in text inputs or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      ) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAssetId !== null) {
          handleDeleteAsset();
          e.preventDefault();
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        if (selectedAssetId !== null) {
          handleDuplicateAsset();
          e.preventDefault();
        }
      }

      // Arrow key movement for selected asset
      if (selectedAssetId !== null && selectedAsset) {
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') {
          dy = -GRID_SIZE;
        } else if (e.key === 'ArrowDown') {
          dy = GRID_SIZE;
        } else if (e.key === 'ArrowLeft') {
          dx = -GRID_SIZE;
        } else if (e.key === 'ArrowRight') {
          dx = GRID_SIZE;
        }

        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          onUpdateProject((prev) => ({
            ...prev,
            yards: prev.yards.map((y) =>
              y.id === prev.activeYardId
                ? {
                    ...y,
                    bins: y.bins.map((b) =>
                      b.id === selectedAssetId
                        ? { ...b, x: b.x + dx, y: b.y + dy }
                        : b
                    ),
                  }
                : y
            ),
          }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAssetId, selectedAsset, activeYard, onUpdateProject]);

  // Canvas Drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear and draw background
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    if (!activeYard) return;

    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    const left = -view.x / view.scale;
    const top = -view.y / view.scale;
    const right = left + dimensions.width / view.scale;
    const bottom = top + dimensions.height / view.scale;

    // Draw Grid Lines
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1 / view.scale;
    for (let x = Math.floor(left / VISUAL_GRID_MAJOR) * VISUAL_GRID_MAJOR; x < right; x += VISUAL_GRID_MAJOR) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = Math.floor(top / VISUAL_GRID_MAJOR) * VISUAL_GRID_MAJOR; y < bottom; y += VISUAL_GRID_MAJOR) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    // Draw Zones first (below bins)
    activeYard.bins
      .filter((b) => b.type === 'zone')
      .forEach((bin) => {
        const zoneBin = bin as ZoneAsset;
        const isSelected = selectedAssetId === zoneBin.id;
        const w = (parseFloat(zoneBin.width) || 20) * BASE_SCALE;
        const h = (parseFloat(zoneBin.height) || 20) * BASE_SCALE;

        ctx.beginPath();
        ctx.rect(zoneBin.x - w / 2, zoneBin.y - h / 2, w, h);
        ctx.strokeStyle = isSelected ? '#fbbf24' : '#f59e0b';
        ctx.lineWidth = (isSelected ? 4 : 2.5) / view.scale;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Resize handles
        if (isSelected) {
          const hx = zoneBin.x + w / 2;
          const hy = zoneBin.y + h / 2;
          const handleSize = 8 / view.scale;
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1 / view.scale;
          ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
        }

        if (zoneBin.name) {
          ctx.font = `bold ${Math.max(12 / view.scale, 10)}px Inter`;
          ctx.fillStyle = isSelected ? '#fbbf24' : '#f59e0b';
          ctx.textAlign = 'left';
          ctx.fillText(zoneBin.name, zoneBin.x - w / 2 + 4, zoneBin.y - h / 2 + 14);
        }
      });

    // Draw Bins & Markers
    activeYard.bins
      .filter((b) => b.type !== 'zone')
      .forEach((bin) => {
        const isSelected = selectedAssetId === bin.id;
        const defaultDia = bin.type === 'junction-box' ? 6 : 5;
        const dia = parseFloat((bin as any).diameter) || defaultDia;
        const radius = (dia / 2) * BASE_SCALE;

        if (bin.type === 'chester-x' || bin.type === 'chester-x1' || bin.type === 'junction-box') {
          ctx.beginPath();
          ctx.moveTo(bin.x - radius, bin.y - radius);
          ctx.lineTo(bin.x + radius, bin.y + radius);
          ctx.moveTo(bin.x + radius, bin.y - radius);
          ctx.lineTo(bin.x - radius, bin.y + radius);

          ctx.strokeStyle = 
            bin.type === 'chester-x' 
              ? '#ef4444' 
              : bin.type === 'chester-x1' 
              ? '#3b82f6' 
              : '#10b981'; // Green/Emerald for Junction Box
          ctx.lineWidth = (isSelected ? 10 : 6) / view.scale;
          ctx.stroke();

          if (isSelected) {
            ctx.beginPath();
            ctx.arc(bin.x, bin.y, radius * 1.5, 0, Math.PI * 2);
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 1.5 / view.scale;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        } else {
          // Standard Bin
          ctx.beginPath();
          ctx.arc(bin.x, bin.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#1e1b4b' : '#18181b';
          ctx.fill();
          ctx.strokeStyle = isSelected ? '#f59e0b' : '#b45309';
          ctx.lineWidth = (isSelected ? 4 : 2) / view.scale;
          ctx.stroke();
        }

        if (bin.name && bin.type !== 'chester-x' && bin.type !== 'chester-x1' && bin.type !== 'junction-box') {
          ctx.font = `bold ${Math.max(12 / view.scale, 8)}px Inter`;
          ctx.fillStyle = isSelected ? '#f59e0b' : '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(bin.name, bin.x, bin.y + 4 / view.scale);
        }
      });

    ctx.restore();

    // Draw Compass
    drawCompass(ctx, dimensions.width - 60, 60);
  }, [dimensions, view, activeYard, selectedAssetId]);

  const drawCompass = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#b45309';
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.lineTo(0, -11);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(0, -13);
    ctx.lineTo(4, 0);
    ctx.fill();
    ctx.font = 'bold 9px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -17);
    ctx.restore();
  };

  // Add Asset Presets
  const handleAddBin = (diameter: number) => {
    if (!activeYard) return;

    const worldCenter = screenToWorld(dimensions.width / 2, dimensions.height / 2);
    let binCountInYard = 1;
    project.yards.forEach((y) => {
      binCountInYard += y.bins.filter((b) => b.type === 'bin').length;
    });

    const newBin: BinAsset = {
      id: Date.now(),
      type: 'bin',
      name: `GB${binCountInYard}`,
      diameter: diameter.toString(),
      rings: Math.round(32 / 4).toString(),
      eaveHeight: '32',
      totalHeight: '42',
      floorThick: '1.5',
      notes: '',
      measurements: [],
      x: Math.round(worldCenter.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(worldCenter.y / GRID_SIZE) * GRID_SIZE,
    };

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) =>
        y.id === prev.activeYardId ? { ...y, bins: [...y.bins, newBin] } : y
      ),
    }));
    onSelectAsset(newBin.id);
  };

  const handleAddSpecialMarker = (markerType: 'chester-x' | 'chester-x1' | 'junction-box') => {
    if (!activeYard) return;

    const worldCenter = screenToWorld(dimensions.width / 2, dimensions.height / 2);
    const labelPrefix = 
      markerType === 'chester-x' 
        ? 'Chester-X' 
        : markerType === 'chester-x1' 
        ? 'Chester-X1' 
        : 'Junction Box';
    const count = activeYard.bins.filter((b) => b.type === markerType).length + 1;

    const newMarker: MarkerAsset = {
      id: Date.now(),
      type: markerType,
      name: `${labelPrefix} ${count}`,
      diameter: markerType === 'junction-box' ? '6' : '5',
      notes: '',
      x: Math.round(worldCenter.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(worldCenter.y / GRID_SIZE) * GRID_SIZE,
    };

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) =>
        y.id === prev.activeYardId ? { ...y, bins: [...y.bins, newMarker] } : y
      ),
    }));
    onSelectAsset(newMarker.id);
  };

  const handleAddZoneBox = () => {
    if (!activeYard) return;

    const worldCenter = screenToWorld(dimensions.width / 2, dimensions.height / 2);
    const newZone: ZoneAsset = {
      id: Date.now(),
      type: 'zone',
      name: '',
      width: '60',
      height: '40',
      notes: '',
      x: Math.round(worldCenter.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(worldCenter.y / GRID_SIZE) * GRID_SIZE,
    };

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) =>
        y.id === prev.activeYardId ? { ...y, bins: [...y.bins, newZone] } : y
      ),
    }));
    onSelectAsset(newZone.id);
  };

  const handleDeleteAsset = () => {
    if (selectedAssetId === null) return;
    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) =>
        y.id === prev.activeYardId
          ? { ...y, bins: y.bins.filter((b) => b.id !== selectedAssetId) }
          : y
      ),
    }));
    onSelectAsset(null);
  };

  const handleDuplicateAsset = () => {
    if (selectedAssetId === null || !selectedAsset) return;

    let binCountInYard = 1;
    project.yards.forEach((y) => {
      binCountInYard += y.bins.filter((b) => b.type === 'bin').length;
    });

    let newName = '';
    if (selectedAsset.type === 'bin') {
      newName = `GB${binCountInYard}`;
    } else if (selectedAsset.type === 'chester-x' || selectedAsset.type === 'chester-x1' || selectedAsset.type === 'junction-box') {
      const type = selectedAsset.type;
      const prefix = 
        type === 'chester-x' 
          ? 'Chester-X' 
          : type === 'chester-x1' 
          ? 'Chester-X1' 
          : 'Junction Box';
      
      if (activeYard) {
        const currentName = selectedAsset.name || prefix;
        // Clean trailing (Copy) indicators
        const cleanName = currentName.replace(/\s*\(?copy\)?\s*$/i, '').trim();
        const numberMatch = cleanName.match(/^(.*?)\s+(\d+)$/);
        
        let basePart = prefix;
        let originalNum = 0;
        if (numberMatch) {
          basePart = numberMatch[1];
          originalNum = parseInt(numberMatch[2], 10);
        } else {
          basePart = cleanName;
        }

        // Search the active yard for existing assets of the same type starting with the same base part
        const sameTypeBins = activeYard.bins.filter((b) => b.type === type);
        let maxNum = originalNum || 0;
        sameTypeBins.forEach((b) => {
          const bClean = b.name.replace(/\s*\(?copy\)?\s*$/i, '').trim();
          const match = bClean.match(new RegExp('^' + escapeRegExp(basePart) + '\\s+(\\d+)$', 'i'));
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) {
              maxNum = num;
            }
          }
        });

        const nextNum = maxNum > 0 ? maxNum + 1 : 2;
        newName = `${basePart} ${nextNum}`;
      } else {
        newName = `${prefix} 2`;
      }
    } else {
      newName = selectedAsset.name ? selectedAsset.name + ' (Copy)' : '';
    }

    const copy = {
      ...JSON.parse(JSON.stringify(selectedAsset)),
      id: Date.now(),
      x: selectedAsset.x + 40,
      y: selectedAsset.y + 40,
      name: newName,
    };

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) =>
        y.id === prev.activeYardId ? { ...y, bins: [...y.bins, copy] } : y
      ),
    }));
    onSelectAsset(copy.id);
  };

  const handleUpdateAssetProperty = (key: string, value: any) => {
    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) =>
        y.id === prev.activeYardId
          ? {
              ...y,
              bins: y.bins.map((b) => {
                if (b.id !== selectedAssetId) return b;
                const updated = { ...b, [key]: value };
                if (key === 'eaveHeight' && b.type === 'bin') {
                  updated.rings = Math.round(parseFloat(value) / 4).toString();
                }
                return updated;
              }),
            }
          : y
      ),
    }));
  };

  // Sync Shared Cable Lengths across bins with the same specifications
  const syncSharedCableLengths = (sourceBin: BinAsset) => {
    if (!sourceBin.centerCable && !sourceBin.radiusCable) return;
    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => ({
        ...y,
        bins: y.bins.map((b) => {
          if (
            b.type === 'bin' &&
            b.id !== sourceBin.id &&
            b.eaveHeight === sourceBin.eaveHeight &&
            b.totalHeight === sourceBin.totalHeight
          ) {
            return {
              ...b,
              centerCable: sourceBin.centerCable,
              radiusCable: sourceBin.radiusCable,
            };
          }
          return b;
        }),
      })),
    }));
  };

  // Mouse Interaction handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !activeYard) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldPos = screenToWorld(mouseX, mouseY);

    // 1. Zone Resize handle check
    if (selectedAsset && selectedAsset.type === 'zone') {
      const zoneBin = selectedAsset as ZoneAsset;
      const w = (parseFloat(zoneBin.width) || 20) * BASE_SCALE;
      const h = (parseFloat(zoneBin.height) || 20) * BASE_SCALE;
      const hx = zoneBin.x + w / 2;
      const hy = zoneBin.y + h / 2;

      const dx = (worldPos.x - hx) * view.scale;
      const dy = (worldPos.y - hy) * view.scale;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 15) {
        resizeInfoRef.current = {
          active: true,
          anchorX: zoneBin.x - w / 2,
          anchorY: zoneBin.y - h / 2,
        };
        return;
      }
    }

    // 2. Select / Click detection
    const nonZones = activeYard.bins.filter((b) => b.type !== 'zone');
    const zones = activeYard.bins.filter((b) => b.type === 'zone');

    let clickedBin = [...nonZones].reverse().find((b) => {
      const r = (parseFloat((b as any).diameter) / 2) * BASE_SCALE;
      const dist = Math.sqrt(Math.pow(worldPos.x - b.x, 2) + Math.pow(worldPos.y - b.y, 2));
      return dist < r;
    });

    if (!clickedBin) {
      clickedBin = [...zones].reverse().find((b) => {
        const zone = b as ZoneAsset;
        const w = (parseFloat(zone.width) || 20) * BASE_SCALE;
        const h = (parseFloat(zone.height) || 20) * BASE_SCALE;
        return (
          worldPos.x >= zone.x - w / 2 &&
          worldPos.x <= zone.x + w / 2 &&
          worldPos.y >= zone.y - h / 2 &&
          worldPos.y <= zone.y + h / 2
        );
      });
    }

    if (clickedBin) {
      onSelectAsset(clickedBin.id);
      dragInfoRef.current = {
        active: true,
        offset: { x: worldPos.x - clickedBin.x, y: worldPos.y - clickedBin.y },
      };
    } else {
      // Pan layout
      onSelectAsset(null);
      panInfoRef.current = {
        active: true,
        start: { x: mouseX - view.x, y: mouseY - view.y },
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !activeYard) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldPos = screenToWorld(mouseX, mouseY);

    // Set cursors
    let hoverResizeHandle = false;
    if (selectedAsset && selectedAsset.type === 'zone') {
      const zoneBin = selectedAsset as ZoneAsset;
      const w = (parseFloat(zoneBin.width) || 20) * BASE_SCALE;
      const h = (parseFloat(zoneBin.height) || 20) * BASE_SCALE;
      const hx = zoneBin.x + w / 2;
      const hy = zoneBin.y + h / 2;

      const dx = (worldPos.x - hx) * view.scale;
      const dy = (worldPos.y - hy) * view.scale;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 15) hoverResizeHandle = true;
    }

    if (resizeInfoRef.current.active || hoverResizeHandle) {
      canvasRef.current.style.cursor = 'se-resize';
    } else if (dragInfoRef.current.active) {
      canvasRef.current.style.cursor = 'grabbing';
    } else {
      canvasRef.current.style.cursor = 'grab';
    }

    // Process Drag / Resize / Pan
    if (resizeInfoRef.current.active && selectedAsset && resizeInfoRef.current.anchorX !== undefined && resizeInfoRef.current.anchorY !== undefined) {
      const ax = resizeInfoRef.current.anchorX;
      const ay = resizeInfoRef.current.anchorY;

      let newW = Math.round((worldPos.x - ax) / GRID_SIZE) * GRID_SIZE;
      let newH = Math.round((worldPos.y - ay) / GRID_SIZE) * GRID_SIZE;
      newW = Math.max(GRID_SIZE * 2, newW);
      newH = Math.max(GRID_SIZE * 2, newH);

      onUpdateProject((prev) => ({
        ...prev,
        yards: prev.yards.map((y) =>
          y.id === prev.activeYardId
            ? {
                ...y,
                bins: y.bins.map((b) =>
                  b.id === selectedAssetId
                    ? {
                        ...b,
                        width: (newW / BASE_SCALE).toFixed(1),
                        height: (newH / BASE_SCALE).toFixed(1),
                        x: ax + newW / 2,
                        y: ay + newH / 2,
                      }
                    : b
                ),
              }
            : y
        ),
      }));
    } else if (dragInfoRef.current.active && selectedAssetId !== null) {
      const nx = Math.round((worldPos.x - dragInfoRef.current.offset.x) / GRID_SIZE) * GRID_SIZE;
      const ny = Math.round((worldPos.y - dragInfoRef.current.offset.y) / GRID_SIZE) * GRID_SIZE;

      onUpdateProject((prev) => ({
        ...prev,
        yards: prev.yards.map((y) =>
          y.id === prev.activeYardId
            ? {
                ...y,
                bins: y.bins.map((b) => (b.id === selectedAssetId ? { ...b, x: nx, y: ny } : b)),
              }
            : y
        ),
      }));
    } else if (panInfoRef.current.active) {
      setView({
        ...view,
        x: mouseX - panInfoRef.current.start.x,
        y: mouseY - panInfoRef.current.start.y,
      });
    }
  };

  const handleMouseUp = () => {
    dragInfoRef.current.active = false;
    panInfoRef.current.active = false;
    resizeInfoRef.current.active = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldPos = screenToWorld(mouseX, mouseY);

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(view.scale * factor, 0.1), 10);
    setView({
      x: mouseX - worldPos.x * newScale,
      y: mouseY - worldPos.y * newScale,
      scale: newScale,
    });
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !activeYard) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldPos = screenToWorld(mouseX, mouseY);

    const clickedBin = [...activeYard.bins].reverse().find((b) => {
      if (b.type !== 'bin') return false;
      const r = (parseFloat(b.diameter) / 2) * BASE_SCALE;
      return Math.sqrt(Math.pow(worldPos.x - b.x, 2) + Math.pow(worldPos.y - b.y, 2)) < r;
    });

    if (clickedBin) {
      onSelectBinInEstimator(clickedBin.id);
    }
  };

  const resetView = () => {
    setView({ x: 0, y: 0, scale: 1.0 });
  };

  return (
    <div id="view-planner" className="flex-1 flex h-full w-full overflow-hidden">
      {/* Planner Sidebar */}
      <aside className="w-80 bg-neutral-950 border-r border-neutral-900 flex flex-col z-10 shrink-0">
        <div className="flex-grow overflow-y-auto p-6 space-y-6 bg-neutral-950 custom-scrollbar">
          {/* Markers and Zones */}
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-4 flex items-center gap-2">
              Markers &amp; Zones
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleAddSpecialMarker('chester-x')}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border border-neutral-350 bg-neutral-200 hover:border-red-500 hover:bg-red-500/5 transition-all group cursor-pointer"
                >
                  <span className="text-red-500 font-black text-2xl mb-2 group-hover:scale-110 transition-transform">X</span>
                  <span className="text-[11px] font-bold text-neutral-800 group-hover:text-red-600">Chester-X</span>
                </button>
                <button
                  onClick={() => handleAddSpecialMarker('chester-x1')}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border border-neutral-350 bg-neutral-200 hover:border-blue-500 hover:bg-blue-500/5 transition-all group cursor-pointer"
                >
                  <span className="text-blue-500 font-black text-2xl mb-2 group-hover:scale-110 transition-transform">X</span>
                  <span className="text-[11px] font-bold text-neutral-800 group-hover:text-blue-600">Chester-X1</span>
                </button>
              </div>
              <button
                onClick={handleAddZoneBox}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-neutral-350 bg-neutral-200 hover:border-amber-500 hover:bg-amber-500/5 transition-all group text-sm font-bold text-neutral-800 hover:text-amber-600 cursor-pointer"
              >
                <svg
                  className="w-4 h-4 text-amber-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3" />
                </svg>
                Zone Marker
              </button>
              <button
                onClick={() => handleAddSpecialMarker('junction-box')}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-neutral-350 bg-neutral-200 hover:border-emerald-500 hover:bg-emerald-500/5 transition-all group text-sm font-bold text-neutral-800 hover:text-emerald-600 cursor-pointer"
              >
                <span className="text-emerald-500 font-black text-lg leading-none group-hover:scale-110 transition-transform">X</span>
                Junction Box
              </button>
            </div>
          </section>

          {/* Add Bin Presets */}
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-4 flex items-center gap-2">
              Add Bin Unit
            </h2>
            <div id="bin-presets" className="grid grid-cols-2 gap-3">
              {BIN_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => handleAddBin(size)}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border border-neutral-350 bg-neutral-200 hover:border-amber-500 hover:bg-amber-500/5 transition-all group cursor-pointer"
                >
                  <div className="rounded-full border border-amber-500/40 group-hover:border-amber-500 mb-2 transition-colors w-7 h-7 border-2"></div>
                  <span className="text-xs font-bold text-neutral-800 group-hover:text-amber-600">{size}' Bin</span>
                </button>
              ))}
            </div>
          </section>

          {/* Properties Panel */}
          <div id="properties-panel">
            {selectedAsset ? (
              <div className="bg-neutral-200 p-5 rounded-2xl border border-neutral-350 space-y-4 text-neutral-900">
                <h2 className="text-xs font-black uppercase tracking-widest text-neutral-800">
                  {selectedAsset.type === 'bin'
                    ? 'Grain Bin Properties'
                    : selectedAsset.type === 'zone'
                    ? 'Zone Properties'
                    : selectedAsset.type === 'junction-box'
                    ? 'Junction Box Properties'
                    : 'Marker Properties'}
                </h2>

                <div>
                  <label className="text-[9px] uppercase font-bold text-neutral-600 mb-1 block">Label / Name</label>
                  <input
                    type="text"
                    value={selectedAsset.name}
                    onChange={(e) => handleUpdateAssetProperty('name', e.target.value)}
                    className="w-full bg-neutral-100 border border-neutral-300 rounded-lg p-2.5 text-neutral-900 focus:border-amber-500 outline-none text-sm font-bold shadow-sm"
                  />
                </div>

                {selectedAsset.type === 'bin' && (
                  <>
                    <div className="bg-neutral-300/60 rounded-xl p-4 border border-neutral-300/30 space-y-3">
                      <p className="text-[9px] font-black uppercase text-neutral-700 tracking-wider">Dimensions</p>
                      <div>
                        <label className="text-[9px] uppercase font-bold text-neutral-600 mb-1 block">Diameter (ft)</label>
                        <input
                          type="number"
                          value={(selectedAsset as BinAsset).diameter}
                          onChange={(e) => handleUpdateAssetProperty('diameter', e.target.value)}
                          className="w-full bg-neutral-100 border border-neutral-300 rounded-lg p-2.5 text-neutral-900 focus:border-amber-500 outline-none text-sm font-semibold"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-bold text-neutral-600 mb-1 block">
                          Eave Height (ft)
                        </label>
                        <input
                          type="number"
                          value={(selectedAsset as BinAsset).eaveHeight}
                          onChange={(e) => handleUpdateAssetProperty('eaveHeight', e.target.value)}
                          className="w-full bg-neutral-100 border border-neutral-300 rounded-lg p-2.5 text-neutral-900 focus:border-amber-500 outline-none text-sm font-semibold"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-bold text-neutral-600 mb-1 block">
                          Total Height (ft)
                        </label>
                        <input
                          type="number"
                          value={(selectedAsset as BinAsset).totalHeight}
                          onChange={(e) => handleUpdateAssetProperty('totalHeight', e.target.value)}
                          className="w-full bg-neutral-100 border border-neutral-300 rounded-lg p-2.5 text-neutral-900 focus:border-amber-500 outline-none text-sm font-semibold"
                        />
                      </div>
                    </div>

                     <div className="bg-amber-500/10 rounded-xl p-3 border border-amber-500/20 space-y-2">
                      <p className="text-[9px] font-black uppercase text-amber-800 tracking-wider">Cable Lengths</p>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-neutral-700 font-medium">Center Cable:</span>
                        <span id="prop-center-cable" className="text-xs font-black text-amber-800">
                          {(selectedAsset as BinAsset).centerCable
                             ? (selectedAsset as BinAsset).centerCable + "'"
                            : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-neutral-700 font-medium">Radius Cable:</span>
                        <span id="prop-radius-cable" className="text-xs font-black text-amber-800">
                          {(selectedAsset as BinAsset).radiusCable
                            ? (selectedAsset as BinAsset).radiusCable + "'"
                            : '—'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => onSelectBinInEstimator(selectedAsset.id)}
                      className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-black rounded-xl font-black text-[9px] uppercase flex items-center justify-center gap-1 transition-all shadow-lg shadow-amber-400/15 cursor-pointer"
                    >
                      Design Cables (Double-click Bin)
                    </button>
                  </>
                )}

                {selectedAsset.type === 'zone' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase font-bold text-neutral-600 mb-1.5 block">Width (ft)</label>
                      <input
                        type="number"
                        value={(selectedAsset as ZoneAsset).width}
                        onChange={(e) => handleUpdateAssetProperty('width', e.target.value)}
                        className="w-full bg-neutral-100 border border-neutral-300 rounded-lg p-2.5 text-neutral-900 focus:border-amber-500 outline-none text-sm font-semibold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-neutral-600 mb-1.5 block">Height (ft)</label>
                      <input
                        type="number"
                        value={(selectedAsset as ZoneAsset).height}
                        onChange={(e) => handleUpdateAssetProperty('height', e.target.value)}
                        className="w-full bg-neutral-100 border border-neutral-300 rounded-lg p-2.5 text-neutral-900 focus:border-amber-500 outline-none text-sm font-semibold"
                      />
                    </div>
                  </div>
                )}

                {selectedAsset.type !== 'bin' && selectedAsset.type !== 'zone' && (
                  <div>
                    <label className="text-[10px] uppercase font-bold text-neutral-600 mb-1.5 block">Marker Size</label>
                    <input
                      type="number"
                      value={(selectedAsset as MarkerAsset).diameter}
                      onChange={(e) => handleUpdateAssetProperty('diameter', e.target.value)}
                      className="w-full bg-neutral-100 border border-neutral-300 rounded-lg p-2.5 text-neutral-900 focus:border-amber-500 outline-none text-sm font-semibold"
                    />
                  </div>
                )}

                <div>
                  <label className="text-[9px] uppercase font-bold text-neutral-600 mb-1 block">Notes</label>
                  <textarea
                    rows={6}
                    value={selectedAsset.notes}
                    onChange={(e) => handleUpdateAssetProperty('notes', e.target.value)}
                    className="w-full bg-neutral-100 border border-neutral-300 rounded-lg p-2 text-neutral-900 focus:border-amber-500 outline-none text-xs resize-y min-h-[120px] font-semibold"
                  ></textarea>
                </div>
                <button
                  onClick={handleDeleteAsset}
                  className="w-full py-2 bg-red-100 text-red-600 border border-red-200 rounded-lg hover:bg-red-200 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Trash2 size={12} />
                  Remove Unit
                </button>
              </div>
            ) : (
              <div className="p-8 rounded-2xl border border-dashed border-neutral-300 text-center text-neutral-500 bg-neutral-200">
                <p className="text-xs font-medium uppercase tracking-wider leading-relaxed text-neutral-500">
                  Select item to configure
                  <br />
                  Auto-snap active
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Planner Workspace Canvas */}
      <div ref={containerRef} className="flex-grow relative bg-zinc-900 overflow-hidden h-full">
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        />

        {/* Yard Indicator / Quick Switcher HUD */}
        <div className="absolute top-6 left-6 flex flex-wrap items-center gap-3">
          <div className="bg-neutral-950/85 backdrop-blur-md px-4 py-2.5 rounded-xl border border-neutral-900 shadow-xl flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Yard:</span>
              <select
                value={project.activeYardId || ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  onUpdateProject((prev) => ({ ...prev, activeYardId: val }));
                  onSelectAsset(null);
                }}
                className="bg-transparent text-xs font-black text-white outline-none cursor-pointer"
              >
                {project.yards.map((yard) => (
                  <option key={yard.id} value={yard.id} className="bg-neutral-950 text-white">
                    {yard.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {activeYard?.location && (
            <div className="bg-neutral-950/85 backdrop-blur-md px-4 py-2.5 rounded-xl border border-neutral-900 shadow-xl flex items-center gap-2 max-w-[200px] sm:max-w-[300px]">
              <MapPin size={12} className="text-amber-400 shrink-0" />
              <span className="text-[10px] font-bold text-neutral-300 truncate uppercase tracking-widest">
                {activeYard.location}
              </span>
            </div>
          )}
          <div className="bg-neutral-950/85 backdrop-blur-md px-4 py-2.5 rounded-xl border border-neutral-900 shadow-xl flex items-center gap-2">
            <span id="scale-indicator" className="text-[10px] font-bold text-neutral-300 uppercase tracking-widest">
              {Math.round(view.scale * 100)}% Scale
            </span>
          </div>
          <div className="hidden sm:flex bg-neutral-950/85 backdrop-blur-md px-4 py-2.5 rounded-xl border border-neutral-900 shadow-xl items-center gap-2">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
              Click Bin to Design Cables
            </span>
          </div>
        </div>

        <div className="absolute bottom-6 left-6 flex items-center gap-4">
          <button
            onClick={resetView}
            className="bg-neutral-900 hover:bg-neutral-800 text-neutral-400 px-4 py-2.5 rounded-xl border border-neutral-800 transition-colors shadow-lg flex items-center gap-2 text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            Reset View
          </button>
          <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 bg-neutral-950/85 backdrop-blur-md px-3 py-2 rounded-lg border border-neutral-900">
            Snap-to-Grid: {GRID_SIZE}px
          </div>
        </div>
      </div>
    </div>
  );
};
