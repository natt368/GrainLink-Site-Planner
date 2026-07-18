/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
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

  // Snap to Grid toggling state
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);

  // Snap to Object toggling state
  const [snapToObject, setSnapToObject] = useState<boolean>(true);

  // Hovered bin state for tooltip info
  const [hoveredBin, setHoveredBin] = useState<any | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // State for creating wire connections
  const [wiringState, setWiringState] = useState<{
    active: boolean;
    fromAssetId: number | null;
    toAssetId: number | null;
    showLabelInput?: boolean;
    tempLabel?: string;
  } | null>(null);

  const [mouseWorldPos, setMouseWorldPos] = useState<{ x: number; y: number } | null>(null);

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

  // Keyboard Shortcuts defined below after event handlers

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

    // Draw Snap Alignment Lines
    if (snapToObject && dragInfoRef.current.active && selectedAssetId !== null && selectedAsset) {
      activeYard.bins.forEach((b) => {
        if (b.id === selectedAssetId) return;

        // Check X alignment (with safe tolerance for floating point comparisons)
        if (Math.abs(selectedAsset.x - b.x) < 0.1) {
          ctx.beginPath();
          ctx.moveTo(b.x, top);
          ctx.lineTo(b.x, bottom);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)'; // Amber/Gold guidelines matching the yard styling
          ctx.lineWidth = 1.5 / view.scale;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw helper circle indicator around aligned target object to emphasize connection
          const isZone = b.type === 'zone';
          const defaultDia = (b.type === 'junction-box' || b.type === 'fan-control') ? 6 : 5;
          const dia = parseFloat((b as any).diameter) || defaultDia;
          const radius = isZone ? 0 : (dia / 2) * BASE_SCALE;
          if (!isZone) {
            ctx.beginPath();
            ctx.arc(b.x, b.y, radius + 5 / view.scale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
            ctx.lineWidth = 1 / view.scale;
            ctx.stroke();
          }
        }

        // Check Y alignment (with safe tolerance for floating point comparisons)
        if (Math.abs(selectedAsset.y - b.y) < 0.1) {
          ctx.beginPath();
          ctx.moveTo(left, b.y);
          ctx.lineTo(right, b.y);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)'; // Amber/Gold guidelines matching the yard styling
          ctx.lineWidth = 1.5 / view.scale;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw helper circle indicator around aligned target object to emphasize connection
          const isZone = b.type === 'zone';
          const defaultDia = (b.type === 'junction-box' || b.type === 'fan-control') ? 6 : 5;
          const dia = parseFloat((b as any).diameter) || defaultDia;
          const radius = isZone ? 0 : (dia / 2) * BASE_SCALE;
          if (!isZone) {
            ctx.beginPath();
            ctx.arc(b.x, b.y, radius + 5 / view.scale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
            ctx.lineWidth = 1 / view.scale;
            ctx.stroke();
          }
        }
      });
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
        const defaultDia = (bin.type === 'junction-box' || bin.type === 'fan-control') ? 6 : 5;
        const dia = parseFloat((bin as any).diameter) || defaultDia;
        const radius = (dia / 2) * BASE_SCALE;

        if (bin.type === 'chester-x' || bin.type === 'chester-x1' || bin.type === 'junction-box' || bin.type === 'fan-control') {
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
              : bin.type === 'junction-box'
              ? '#10b981'
              : '#a855f7'; // Purple/Violet for Fan Control
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

        if (bin.name && bin.type !== 'chester-x' && bin.type !== 'chester-x1' && bin.type !== 'junction-box' && bin.type !== 'fan-control') {
          ctx.font = `bold ${Math.max(12 / view.scale, 8)}px Inter`;
          ctx.fillStyle = isSelected ? '#f59e0b' : '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(bin.name, bin.x, bin.y + 4 / view.scale);
        }
      });

    // Draw Wire Connections
    const wires = activeYard.wires || [];
    wires.forEach((wire) => {
      const fromAsset = activeYard.bins.find((b) => b.id === wire.fromId);
      const toAsset = activeYard.bins.find((b) => b.id === wire.toId);
      if (!fromAsset || !toAsset) return;

      const x1 = fromAsset.x;
      const y1 = fromAsset.y;
      const x2 = toAsset.x;
      const y2 = toAsset.y;

      // Calculate control point for curved wires to bypass overlapping bins/markers
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const offset = Math.max(30, len * 0.25);
      const px = -dy / (len || 1);
      const py = dx / (len || 1);

      const ctrlX = midX + px * offset;
      const ctrlY = midY + py * offset;

      // Draw dashed purple wire curve
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(ctrlX, ctrlY, x2, y2);
      ctx.strokeStyle = '#c084fc'; // soft purple
      ctx.lineWidth = 2.5 / view.scale;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw wire label at the curve midpoint (t = 0.5 on Bezier)
      const curveMidX = 0.25 * x1 + 0.5 * ctrlX + 0.25 * x2;
      const curveMidY = 0.25 * y1 + 0.5 * ctrlY + 0.25 * y2;

      ctx.save();
      ctx.font = `bold ${Math.max(9 / view.scale, 8)}px Inter`;
      const labelText = wire.label || 'Wire';
      const textWidth = ctx.measureText(labelText).width;
      const paddingX = 5 / view.scale;
      const paddingY = 3 / view.scale;
      const rectW = textWidth + paddingX * 2;
      const rectH = Math.max(12 / view.scale, 11);

      // Draw pill background
      ctx.fillStyle = '#18181b';
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 1 / view.scale;
      ctx.beginPath();
      if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(curveMidX - rectW / 2, curveMidY - rectH / 2, rectW, rectH, 3 / view.scale);
      } else {
        ctx.rect(curveMidX - rectW / 2, curveMidY - rectH / 2, rectW, rectH);
      }
      ctx.fill();
      ctx.stroke();

      // Draw text
      ctx.fillStyle = '#f3e8ff'; // Light purple
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, curveMidX, curveMidY);
      ctx.restore();
    });

    // Draw active wiring preview line
    if (wiringState?.active && wiringState.fromAssetId !== null && mouseWorldPos) {
      const fromAsset = activeYard.bins.find((b) => b.id === wiringState.fromAssetId);
      if (fromAsset) {
        const x1 = fromAsset.x;
        const y1 = fromAsset.y;
        const x2 = mouseWorldPos.x;
        const y2 = mouseWorldPos.y;

        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const offset = Math.max(30, len * 0.25);
        const px = -dy / (len || 1);
        const py = dx / (len || 1);

        const ctrlX = midX + px * offset;
        const ctrlY = midY + py * offset;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(ctrlX, ctrlY, x2, y2);
        ctx.strokeStyle = '#d8b4fe'; // bright purple for preview
        ctx.lineWidth = 2 / view.scale;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw helper circle indicator on start asset
        ctx.beginPath();
        ctx.arc(fromAsset.x, fromAsset.y, 8 / view.scale, 0, Math.PI * 2);
        ctx.strokeStyle = '#d8b4fe';
        ctx.lineWidth = 1.5 / view.scale;
        ctx.stroke();
      }
    }

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
      x: snapToGrid ? Math.round(worldCenter.x / GRID_SIZE) * GRID_SIZE : worldCenter.x,
      y: snapToGrid ? Math.round(worldCenter.y / GRID_SIZE) * GRID_SIZE : worldCenter.y,
    };

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) =>
        y.id === prev.activeYardId ? { ...y, bins: [...y.bins, newBin] } : y
      ),
    }));
    onSelectAsset(newBin.id);
  };

  const handleAddSpecialMarker = (markerType: 'chester-x' | 'chester-x1' | 'junction-box' | 'fan-control') => {
    if (!activeYard) return;

    const worldCenter = screenToWorld(dimensions.width / 2, dimensions.height / 2);
    const labelPrefix = 
      markerType === 'chester-x' 
        ? 'Chester-X' 
        : markerType === 'chester-x1' 
        ? 'Chester-X1' 
        : markerType === 'junction-box'
        ? 'Junction Box'
        : 'Fan Control';
    const count = activeYard.bins.filter((b) => b.type === markerType).length + 1;

    const newMarker: MarkerAsset = {
      id: Date.now(),
      type: markerType,
      name: `${labelPrefix} ${count}`,
      diameter: (markerType === 'junction-box' || markerType === 'fan-control') ? '6' : '5',
      notes: '',
      x: snapToGrid ? Math.round(worldCenter.x / GRID_SIZE) * GRID_SIZE : worldCenter.x,
      y: snapToGrid ? Math.round(worldCenter.y / GRID_SIZE) * GRID_SIZE : worldCenter.y,
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
      x: snapToGrid ? Math.round(worldCenter.x / GRID_SIZE) * GRID_SIZE : worldCenter.x,
      y: snapToGrid ? Math.round(worldCenter.y / GRID_SIZE) * GRID_SIZE : worldCenter.y,
    };

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) =>
        y.id === prev.activeYardId ? { ...y, bins: [...y.bins, newZone] } : y
      ),
    }));
    onSelectAsset(newZone.id);
  };

  const handleDeleteAsset = useCallback(() => {
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
  }, [selectedAssetId, onUpdateProject, onSelectAsset]);

  const handleDuplicateAsset = useCallback(() => {
    if (selectedAssetId === null || !selectedAsset) return;

    let binCountInYard = 1;
    project.yards.forEach((y) => {
      binCountInYard += y.bins.filter((b) => b.type === 'bin').length;
    });

    let newName = '';
    if (selectedAsset.type === 'bin') {
      newName = `GB${binCountInYard}`;
    } else if (selectedAsset.type === 'chester-x' || selectedAsset.type === 'chester-x1' || selectedAsset.type === 'junction-box' || selectedAsset.type === 'fan-control') {
      const type = selectedAsset.type;
      const prefix = 
        type === 'chester-x' 
          ? 'Chester-X' 
          : type === 'chester-x1' 
          ? 'Chester-X1' 
          : type === 'junction-box'
          ? 'Junction Box'
          : 'Fan Control';
      
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
  }, [selectedAssetId, selectedAsset, project, activeYard, onUpdateProject, onSelectAsset]);

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
        const step = snapToGrid ? GRID_SIZE : 1;
        if (e.key === 'ArrowUp') {
          dy = -step;
        } else if (e.key === 'ArrowDown') {
          dy = step;
        } else if (e.key === 'ArrowLeft') {
          dx = -step;
        } else if (e.key === 'ArrowRight') {
          dx = step;
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
  }, [selectedAssetId, selectedAsset, onUpdateProject, handleDeleteAsset, handleDuplicateAsset]);

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

  const handleSaveWire = () => {
    if (!activeYard || !wiringState || wiringState.fromAssetId === null || !wiringState.toAssetId) return;
    const fromId = wiringState.fromAssetId;
    const toId = wiringState.toAssetId;
    const label = wiringState.tempLabel?.trim() || 'Wire Connection';

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => {
        if (y.id !== prev.activeYardId) return y;
        const currentWires = y.wires || [];
        const newWire = {
          id: Date.now(),
          fromId,
          toId,
          label,
        };
        return {
          ...y,
          wires: [...currentWires, newWire],
        };
      }),
    }));

    setWiringState(null);
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

    // If wiring mode is active, handle node selection
    if (wiringState?.active) {
      const nonZones = activeYard.bins.filter((b) => b.type !== 'zone');
      const zones = activeYard.bins.filter((b) => b.type === 'zone');
      let clickedBin = [...nonZones].reverse().find((b) => {
        const defaultDia = (b.type === 'junction-box' || b.type === 'fan-control') ? 6 : 5;
        const dia = parseFloat((b as any).diameter) || defaultDia;
        const r = (dia / 2) * BASE_SCALE;
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
        if (wiringState.fromAssetId === null) {
          setWiringState({ ...wiringState, fromAssetId: clickedBin.id });
        } else if (clickedBin.id !== wiringState.fromAssetId) {
          setWiringState({ ...wiringState, toAssetId: clickedBin.id, showLabelInput: true });
        }
      }
      return;
    }

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

    // If wiring is active, keep track of cursor world position for line previewing
    if (wiringState?.active) {
      setMouseWorldPos(worldPos);
    }

    // Track hover information if not actively dragging/panning/resizing
    const isInteracting = dragInfoRef.current.active || panInfoRef.current.active || resizeInfoRef.current.active;
    if (isInteracting) {
      setHoveredBin(null);
      setHoverPos(null);
    } else {
      const nonZones = activeYard.bins.filter((b) => b.type !== 'zone');
      const zones = activeYard.bins.filter((b) => b.type === 'zone');

      let hovered = [...nonZones].reverse().find((b) => {
        const r = (parseFloat((b as any).diameter) / 2) * BASE_SCALE;
        const dist = Math.sqrt(Math.pow(worldPos.x - b.x, 2) + Math.pow(worldPos.y - b.y, 2));
        return dist < r;
      });

      if (!hovered) {
        hovered = [...zones].reverse().find((b) => {
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

      if (hovered) {
        setHoveredBin(hovered);
        setHoverPos({ x: mouseX, y: mouseY });
      } else {
        setHoveredBin(null);
        setHoverPos(null);
      }
    }

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

    if (wiringState?.active) {
      canvasRef.current.style.cursor = 'crosshair';
    } else if (resizeInfoRef.current.active || hoverResizeHandle) {
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

      let newW = snapToGrid ? Math.round((worldPos.x - ax) / GRID_SIZE) * GRID_SIZE : (worldPos.x - ax);
      let newH = snapToGrid ? Math.round((worldPos.y - ay) / GRID_SIZE) * GRID_SIZE : (worldPos.y - ay);
      newW = Math.max(snapToGrid ? GRID_SIZE * 2 : 2, newW);
      newH = Math.max(snapToGrid ? GRID_SIZE * 2 : 2, newH);

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
      const nx = snapToGrid ? Math.round((worldPos.x - dragInfoRef.current.offset.x) / GRID_SIZE) * GRID_SIZE : (worldPos.x - dragInfoRef.current.offset.x);
      const ny = snapToGrid ? Math.round((worldPos.y - dragInfoRef.current.offset.y) / GRID_SIZE) * GRID_SIZE : (worldPos.y - dragInfoRef.current.offset.y);

      let targetX = nx;
      let targetY = ny;

      if (snapToObject) {
        const SNAP_DISTANCE = 15; // Snapping distance in world coordinates

        // Find closest X and Y coordinates to snap to
        let closestXDist = SNAP_DISTANCE;
        let closestYDist = SNAP_DISTANCE;

        activeYard.bins.forEach((b) => {
          if (b.id === selectedAssetId) return;

          const dx = Math.abs(nx - b.x);
          if (dx < closestXDist) {
            closestXDist = dx;
            targetX = b.x;
          }

          const dy = Math.abs(ny - b.y);
          if (dy < closestYDist) {
            closestYDist = dy;
            targetY = b.y;
          }
        });
      }

      onUpdateProject((prev) => ({
        ...prev,
        yards: prev.yards.map((y) =>
          y.id === prev.activeYardId
            ? {
                ...y,
                bins: y.bins.map((b) => (b.id === selectedAssetId ? { ...b, x: targetX, y: targetY } : b)),
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
    if (!activeYard || !activeYard.bins || activeYard.bins.length === 0) {
      setView({ x: 0, y: 0, scale: 1.0 });
      return;
    }

    // Prioritize centering on actual standard grain bins. If none, fall back to all items (markers, zones, etc.)
    let targetBins = activeYard.bins.filter((b) => b.type === 'bin');
    if (targetBins.length === 0) {
      targetBins = activeYard.bins;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    targetBins.forEach((b) => {
      let rX = 0;
      let rY = 0;
      if (b.type === 'zone') {
        rX = ((parseFloat((b as any).width) || 20) * BASE_SCALE) / 2;
        rY = ((parseFloat((b as any).height) || 20) * BASE_SCALE) / 2;
      } else {
        const dia = parseFloat((b as any).diameter) || (b.type === 'junction-box' ? 6 : 5);
        rX = (dia / 2) * BASE_SCALE;
        rY = (dia / 2) * BASE_SCALE;
      }

      minX = Math.min(minX, b.x - rX);
      maxX = Math.max(maxX, b.x + rX);
      minY = Math.min(minY, b.y - rY);
      maxY = Math.max(maxY, b.y + rY);
    });

    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;

    // Use a comfortable safety padding around the items
    const padding = 60;
    const targetWidth = dimensions.width - 2 * padding;
    const targetHeight = dimensions.height - 2 * padding;

    let scale = 1.0;
    if (boxWidth > 0 && boxHeight > 0) {
      const scaleX = targetWidth / boxWidth;
      const scaleY = targetHeight / boxHeight;
      // Clamp scale to a reasonable and usable visual range (e.g., 0.3x to 2.5x zoom)
      scale = Math.max(0.3, Math.min(2.5, Math.min(scaleX, scaleY)));
    }

    const boxCenterX = (minX + maxX) / 2;
    const boxCenterY = (minY + maxY) / 2;

    const viewX = dimensions.width / 2 - boxCenterX * scale;
    const viewY = dimensions.height / 2 - boxCenterY * scale;

    setView({ x: viewX, y: viewY, scale });
  };

  return (
    <div id="view-planner" className="flex-1 flex h-full w-full overflow-hidden">
      {/* Planner Sidebar */}
      <aside className="w-52 bg-neutral-950 border-r border-neutral-900 flex flex-col z-10 shrink-0">
        <div className="flex-grow overflow-y-auto p-3.5 space-y-4 bg-neutral-950 custom-scrollbar">
          {/* Markers and Zones */}
          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2 flex items-center gap-2">
              Markers &amp; Zones
            </h2>
            <div className="space-y-2">
              {/* Squeezed quick-add grid of stacked buttons */}
              <div className="flex flex-col gap-1.5 w-full">
                <button
                  onClick={() => handleAddSpecialMarker('chester-x')}
                  className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:border-red-500/50 hover:bg-red-500/5 text-red-500 text-xs font-bold transition-all cursor-pointer text-left"
                  title="Quick Add Chester-X"
                >
                  <span className="font-black text-sm w-4 text-center shrink-0">X</span>
                  <span className="text-neutral-300 font-bold text-[11px]">Chester-X</span>
                </button>
                <button
                  onClick={() => handleAddSpecialMarker('chester-x1')}
                  className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:border-blue-500/50 hover:bg-blue-500/5 text-blue-400 text-xs font-bold transition-all cursor-pointer text-left"
                  title="Quick Add Chester-X1"
                >
                  <span className="font-black text-sm w-4 text-center shrink-0">X1</span>
                  <span className="text-neutral-300 font-bold text-[11px]">Chester-X1</span>
                </button>
                <button
                  onClick={handleAddZoneBox}
                  className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:border-amber-500/50 hover:bg-amber-500/5 text-amber-500 text-xs font-bold transition-all cursor-pointer text-left"
                  title="Quick Add Zone Box"
                >
                  <div className="w-4 flex justify-center shrink-0">
                    <svg
                      className="w-3.5 h-3.5 text-amber-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3" />
                    </svg>
                  </div>
                  <span className="text-neutral-300 font-bold text-[11px]">Zone Box</span>
                </button>
                <button
                  onClick={() => handleAddSpecialMarker('junction-box')}
                  className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-emerald-400 text-xs font-bold transition-all cursor-pointer text-left"
                  title="Quick Add Junction Box"
                >
                  <span className="font-black text-[11px] w-4 text-center shrink-0">JB</span>
                  <span className="text-neutral-300 font-bold text-[11px]">Junction Box</span>
                </button>
                <button
                  onClick={() => handleAddSpecialMarker('fan-control')}
                  className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:border-purple-500/50 hover:bg-purple-500/5 text-purple-400 text-xs font-bold transition-all cursor-pointer text-left"
                  title="Quick Add Fan Control"
                >
                  <span className="font-black text-[11px] w-4 text-center shrink-0">FC</span>
                  <span className="text-neutral-300 font-bold text-[11px]">Fan Control</span>
                </button>
                <button
                  onClick={() => {
                    if (wiringState?.active) {
                      setWiringState(null);
                    } else {
                      setWiringState({ active: true, fromAssetId: null, toAssetId: null });
                      onSelectAsset(null);
                    }
                  }}
                  className={`flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-lg border transition-all text-xs font-bold text-left cursor-pointer ${
                    wiringState?.active
                      ? 'border-purple-500 bg-purple-500/20 text-purple-400'
                      : 'border-neutral-800 bg-neutral-900 hover:border-purple-500/50 hover:bg-purple-500/5 text-purple-400'
                  }`}
                  title="String electrical/signal wire from one bin or marker to a junction box"
                >
                  <span className="font-black text-sm w-4 text-center shrink-0">⚡</span>
                  <span className="text-neutral-300 font-bold text-[11px]">
                    {wiringState?.active ? 'Cancel Wiring' : 'String Wire Tool'}
                  </span>
                </button>
              </div>
            </div>
          </section>

          {/* Add Bin Presets */}
          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2 flex items-center gap-2">
              Add Bin Unit
            </h2>
            <div id="bin-presets" className="flex flex-col gap-1.5 w-full">
              {BIN_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => handleAddBin(size)}
                  className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:border-amber-500/50 hover:bg-amber-500/5 text-amber-500 transition-all cursor-pointer group text-left text-xs font-bold"
                  title={`Add ${size}' Grain Bin`}
                >
                  <div className="rounded-full border border-amber-500/40 group-hover:border-amber-500 transition-colors w-3 h-3 border-2 shrink-0"></div>
                  <span className="text-neutral-300 group-hover:text-amber-400 font-bold text-[11px]">{size}' Grain Bin</span>
                </button>
              ))}
            </div>
          </section>

          {/* Active Wires / Connections List */}
          {activeYard && activeYard.wires && activeYard.wires.length > 0 && (
            <section className="border-t border-neutral-900 pt-3.5">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2 flex items-center gap-1.5">
                <span>⚡</span> Yard Wires ({activeYard.wires.length})
              </h2>
              <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-0.5">
                {activeYard.wires.map((wire) => {
                  const fromAsset = activeYard.bins.find((b) => b.id === wire.fromId);
                  const toAsset = activeYard.bins.find((b) => b.id === wire.toId);
                  if (!fromAsset || !toAsset) return null;
                  return (
                    <div
                      key={wire.id}
                      className="bg-neutral-900 border border-neutral-800 rounded-lg p-2 flex items-center justify-between text-[11px] group"
                    >
                      <div className="truncate pr-1">
                        <div className="font-extrabold text-purple-400 truncate text-[11px]" title={wire.label}>
                          {wire.label || 'Wire Line'}
                        </div>
                        <div className="text-neutral-500 font-mono text-[9px] truncate">
                          {fromAsset.name} → {toAsset.name}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          onUpdateProject((prev) => ({
                            ...prev,
                            yards: prev.yards.map((y) => {
                              if (y.id !== prev.activeYardId) return y;
                              return {
                                ...y,
                                wires: (y.wires || []).filter((w) => w.id !== wire.id),
                              };
                            }),
                          }));
                        }}
                        className="p-1 hover:bg-neutral-800 hover:text-red-400 text-neutral-500 rounded transition-colors cursor-pointer shrink-0"
                        title="Delete wire"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}



          {/* Properties Panel */}
          <div id="properties-panel">
            {selectedAsset ? (
              <div className="bg-neutral-200 p-3.5 rounded-xl border border-neutral-350 space-y-3.5 text-neutral-900">
                <h2 className="text-xs font-black uppercase tracking-widest text-neutral-800">
                  {selectedAsset.type === 'bin'
                    ? 'Grain Bin Properties'
                    : selectedAsset.type === 'zone'
                    ? 'Zone Properties'
                    : selectedAsset.type === 'junction-box'
                    ? 'Junction Box Properties'
                    : selectedAsset.type === 'fan-control'
                    ? 'Fan Control Properties'
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
                  <span className={snapToGrid ? 'text-amber-600 font-bold' : 'text-neutral-500'}>
                    {snapToGrid ? 'Auto-snap active' : 'Snapping disabled'}
                  </span>
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
          onMouseLeave={() => {
            handleMouseUp();
            setHoveredBin(null);
            setHoverPos(null);
          }}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        />

        {/* Hover Information Tooltip */}
        {hoveredBin && hoverPos && (() => {
          let posX = hoverPos.x + 16;
          let posY = hoverPos.y + 16;
          if (posX + 256 > dimensions.width) {
            posX = hoverPos.x - 272;
          }
          if (posY + 220 > dimensions.height) {
            posY = Math.max(10, dimensions.height - 240);
          }
          return (
            <div
              className="absolute z-50 pointer-events-none bg-neutral-950/95 backdrop-blur-md border border-neutral-800 rounded-xl p-3 shadow-2xl text-white text-xs w-64 select-none animate-fade-in"
              style={{
                left: posX,
                top: posY,
              }}
            >
              {hoveredBin.type === 'bin' && (
                <>
                  <div className="flex items-center justify-between border-b border-neutral-800 pb-1.5 mb-2">
                    <span className="font-extrabold tracking-wide text-amber-400 text-sm">{hoveredBin.name || 'Unnamed Bin'}</span>
                    <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded font-mono uppercase tracking-wider">Grain Bin</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-semibold">Diameter:</span>
                      <span className="font-mono text-neutral-200 font-bold">{hoveredBin.diameter ? `${hoveredBin.diameter}'` : '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-semibold">Rings:</span>
                      <span className="font-mono text-neutral-200 font-bold">{hoveredBin.rings || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-semibold">Eave Ht:</span>
                      <span className="font-mono text-neutral-200 font-bold">{hoveredBin.eaveHeight ? `${hoveredBin.eaveHeight}'` : '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-semibold">Total Ht:</span>
                      <span className="font-mono text-neutral-200 font-bold">{hoveredBin.totalHeight ? `${hoveredBin.totalHeight}'` : '-'}</span>
                    </div>
                    <div className="flex items-center justify-between col-span-2 border-t border-neutral-900 pt-1 mt-1">
                      <span className="text-neutral-500 font-semibold">Center Cable:</span>
                      <span className="font-mono text-amber-500/90 font-bold">{hoveredBin.centerCable ? `${hoveredBin.centerCable}'` : '-'}</span>
                    </div>
                    <div className="flex items-center justify-between col-span-2">
                      <span className="text-neutral-500 font-semibold">Radius Cable:</span>
                      <span className="font-mono text-amber-500/90 font-bold">{hoveredBin.radiusCable ? `${hoveredBin.radiusCable}'` : '-'}</span>
                    </div>
                    {hoveredBin.floorThick && hoveredBin.floorThick !== '0' && (
                      <div className="flex items-center justify-between col-span-2">
                        <span className="text-neutral-500 font-semibold">Floor Thick:</span>
                        <span className="font-mono text-neutral-200 font-bold">{hoveredBin.floorThick}"</span>
                      </div>
                    )}
                  </div>

                  {hoveredBin.notes && (
                    <div className="mt-2 pt-1.5 border-t border-neutral-800 text-[10px] text-neutral-400 italic break-words leading-relaxed">
                      {hoveredBin.notes}
                    </div>
                  )}
                </>
              )}

              {hoveredBin.type === 'zone' && (
                <>
                  <div className="flex items-center justify-between border-b border-neutral-800 pb-1.5 mb-2">
                    <span className="font-extrabold tracking-wide text-amber-400 text-sm">{hoveredBin.name || 'Zone'}</span>
                    <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded font-mono uppercase tracking-wider">Zone</span>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-semibold">Width:</span>
                      <span className="font-mono text-neutral-200 font-bold">{hoveredBin.width ? `${hoveredBin.width}'` : '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-semibold">Height:</span>
                      <span className="font-mono text-neutral-200 font-bold">{hoveredBin.height ? `${hoveredBin.height}'` : '-'}</span>
                    </div>
                  </div>

                  {hoveredBin.notes && (
                    <div className="mt-2 pt-1.5 border-t border-neutral-800 text-[10px] text-neutral-400 italic break-words leading-relaxed">
                      {hoveredBin.notes}
                    </div>
                  )}
                </>
              )}

              {hoveredBin.type !== 'bin' && hoveredBin.type !== 'zone' && (
                <>
                  <div className="flex items-center justify-between border-b border-neutral-800 pb-1.5 mb-2">
                    <span className="font-extrabold tracking-wide text-amber-400 text-sm">{hoveredBin.name || 'Marker'}</span>
                    <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded font-mono uppercase tracking-wider">
                      {hoveredBin.type === 'chester-x' ? 'Chester-X' : hoveredBin.type === 'chester-x1' ? 'Chester-X1' : hoveredBin.type === 'junction-box' ? 'J-Box' : hoveredBin.type === 'fan-control' ? 'Fan Ctrl' : 'Marker'}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-semibold">Size:</span>
                      <span className="font-mono text-neutral-200 font-bold">{hoveredBin.diameter ? `${hoveredBin.diameter}'` : '-'}</span>
                    </div>
                  </div>

                  {hoveredBin.notes && (
                    <div className="mt-2 pt-1.5 border-t border-neutral-800 text-[10px] text-neutral-400 italic break-words leading-relaxed">
                      {hoveredBin.notes}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

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
          {wiringState?.active ? (
            <div className="bg-purple-950/85 backdrop-blur-md px-4 py-2.5 rounded-xl border border-purple-500/30 shadow-xl flex items-center gap-2 animate-pulse">
              <span className="text-purple-400">⚡</span>
              <span className="text-[10px] font-black text-purple-300 uppercase tracking-widest">
                {wiringState.fromAssetId === null
                  ? 'Wiring Mode: Click on any Unit to START'
                  : 'Wiring Mode: Click destination Unit to CONNECT'}
              </span>
              <button
                onClick={() => setWiringState(null)}
                className="ml-2 hover:bg-purple-900 text-purple-300 rounded px-1.5 py-0.5 text-[9px] font-black border border-purple-400/30 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="hidden sm:flex bg-neutral-950/85 backdrop-blur-md px-4 py-2.5 rounded-xl border border-neutral-900 shadow-xl items-center gap-2">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
                Click Bin to Design Cables
              </span>
            </div>
          )}
        </div>

        {/* Create Wire Connection Label Overlay */}
        {wiringState?.active && wiringState.showLabelInput && wiringState.fromAssetId !== null && wiringState.toAssetId !== null && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-neutral-950 border border-neutral-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl animate-fade-in text-white">
              <div className="flex items-center gap-2.5 mb-4 border-b border-neutral-900 pb-3">
                <span className="text-xl">⚡</span>
                <div>
                  <h3 className="font-extrabold text-sm tracking-wide text-purple-400">Label Your Wire Connection</h3>
                  <p className="text-[10px] text-neutral-500 font-medium">Create a wire path from unit to unit</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1.5">
                    Connection Label
                  </label>
                  <input
                    type="text"
                    value={wiringState.tempLabel || ''}
                    onChange={(e) => setWiringState({ ...wiringState, tempLabel: e.target.value })}
                    placeholder="e.g. Bin 1 to J-Box A, Signal Line"
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg py-2 px-3 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-purple-500 transition-colors"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveWire();
                      } else if (e.key === 'Escape') {
                        setWiringState(null);
                      }
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono bg-neutral-900/50 p-2 rounded-lg border border-neutral-900">
                  <span>From: {activeYard.bins.find((b) => b.id === wiringState.fromAssetId)?.name || 'Unit A'}</span>
                  <span>To: {activeYard.bins.find((b) => b.id === wiringState.toAssetId)?.name || 'Unit B'}</span>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setWiringState(null)}
                    className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 border border-neutral-800 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveWire}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-lg text-xs font-black transition-all cursor-pointer shadow-lg shadow-purple-600/10"
                  >
                    Save Connection
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="absolute bottom-6 left-6 flex flex-wrap items-center gap-3">
          <button
            onClick={resetView}
            className="bg-neutral-900 hover:bg-neutral-800 text-neutral-400 px-4 py-2.5 rounded-xl border border-neutral-800 transition-colors shadow-lg flex items-center gap-2 text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            Reset View
          </button>
          <button
            onClick={() => setSnapToGrid(!snapToGrid)}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all text-xs font-bold uppercase tracking-wider cursor-pointer shadow-lg ${
              snapToGrid
                ? 'bg-amber-400/10 border-amber-500/30 text-amber-400 hover:bg-amber-400/20'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800'
            }`}
            title="Toggle Snap to Grid Lines"
          >
            <div className={`w-1.5 h-1.5 rounded-full transition-colors ${snapToGrid ? 'bg-amber-400 animate-pulse' : 'bg-neutral-600'}`} />
            Grid Snap: {snapToGrid ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => setSnapToObject(!snapToObject)}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all text-xs font-bold uppercase tracking-wider cursor-pointer shadow-lg ${
              snapToObject
                ? 'bg-amber-400/10 border-amber-500/30 text-amber-400 hover:bg-amber-400/20'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800'
            }`}
            title="Toggle Snap to Other Objects and Alignment Guidelines"
          >
            <div className={`w-1.5 h-1.5 rounded-full transition-colors ${snapToObject ? 'bg-amber-400 animate-pulse' : 'bg-neutral-600'}`} />
            Object Snap: {snapToObject ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  );
};
