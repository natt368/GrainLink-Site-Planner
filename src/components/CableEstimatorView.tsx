/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Project, Yard, Asset, BinAsset, Point, MeasurementLine } from '../types';
import { getCableRecommendation } from '../utils/pdfGenerator';
import { ArrowLeft, RefreshCw, Trash2, Eye, EyeOff } from 'lucide-react';

interface CableEstimatorViewProps {
  project: Project;
  onUpdateProject: (updater: (prev: Project) => Project) => void;
  onSwitchTab: (tabId: 'dashboard' | 'planner' | 'estimator') => void;
  activeBinId: number | null;
}

export const CableEstimatorView: React.FC<CableEstimatorViewProps> = ({
  project,
  onUpdateProject,
  onSwitchTab,
  activeBinId,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  // Tools state
  const [measureToolActive, setMeasureToolActive] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [snapToFeatures, setSnapToFeatures] = useState(true);
  const [hoverCoords, setHoverCoords] = useState<Point | null>(null);

  // Viewport scale and pan state
  const [view, setView] = useState({ x: 0, y: 0, scale: 1.0 });

  // SVG interaction states
  const isPanningRef = useRef(false);
  const panningStartRef = useRef({ x: 0, y: 0 });

  const [draggingPoint, setDraggingPoint] = useState<{
    lineIdx: number;
    ptKey: 'p1' | 'p2';
  } | null>(null);

  const [draggingLine, setDraggingLine] = useState<{
    lineIdx: number;
    startCoords: Point;
    originalP1: Point;
    originalP2: Point;
  } | null>(null);

  const activeBin = useMemo(() => {
    if (activeBinId === null) return null;
    for (const yard of project.yards) {
      const b = yard.bins.find((bin) => bin.id === activeBinId);
      if (b && b.type === 'bin') return b as BinAsset;
    }
    return null;
  }, [project.yards, activeBinId]);

  // Dimension values
  const D = parseFloat(activeBin?.diameter || '36') || 36;
  const H = parseFloat(activeBin?.totalHeight || '42') || 42;
  const E = parseFloat(activeBin?.eaveHeight || '32') || 32;
  const F = parseFloat(activeBin?.floorThick || '1.5') || 1.5;

  const pixelsPerFoot = 400 / Math.max(H, D);
  const cx = 300;
  const gy = 520;
  const wp = D * pixelsPerFoot;
  const hp = E * pixelsPerFoot;
  const tp = H * pixelsPerFoot;
  const fp = F * pixelsPerFoot;
  const wl = cx - wp / 2;
  const wr = cx + wp / 2;
  const ey = gy - hp;
  const py = gy - tp;
  const lw = Math.max(20, wp * 0.1);

  // Compute bushels capacity
  const bushels = Math.round(
    Math.PI * Math.pow(D / 2, 2) * (Math.max(0, E - F) + (H - E) / 3) * 0.80356
  );

  // Compute cable recommendations
  const cables = getCableRecommendation(D.toString());

  // Convert screen coordinates to SVG viewport coordinates
  const getSVGCoords = (clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const pt = svgRef.current.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const viewportGroup = svgRef.current.getElementById('viewport-group');
    if (!viewportGroup) return { x: 0, y: 0 };
    const matrix = (viewportGroup as any).getScreenCTM().inverse();
    const transformed = pt.matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  };

  // Smart snapping to physical bin elements
  const getSnappedCoords = (rawX: number, rawY: number) => {
    let x = rawX;
    let y = rawY;

    const bufferHeight = (10 / 12) * pixelsPerFoot;
    const crossAugerHeightFt = 10 / 12;
    const safeTerminationFt = crossAugerHeightFt + 1.0; // 1 foot above cross auger (1.833 ft above floor)
    const safeTermY = gy - fp - safeTerminationFt * pixelsPerFoot;

    if (snapToFeatures && activeBin) {
      const snapThreshold = 15; // Snaps comfortably within 15 pixels of features
      let featureSnapped = false;

      // 1. Check vertical structural elements (X coordinates)
      // - Left wall (wl)
      if (Math.abs(x - wl) < snapThreshold) {
        x = wl;
        featureSnapped = true;
      }
      // - Right wall (wr)
      else if (Math.abs(x - wr) < snapThreshold) {
        x = wr;
        featureSnapped = true;
      }
      // - Horizontal Center Line (cx)
      else if (Math.abs(x - cx) < snapThreshold) {
        x = cx;
        featureSnapped = true;
      }

      // 2. Check horizontal structural elements (Y coordinates)
      // - Peak line (py)
      if (Math.abs(y - py) < snapThreshold) {
        if (Math.abs(x - cx) < 0.1) {
          y = py + 1.0 * pixelsPerFoot; // Snap to 1ft below peak height for the Center Cable
        } else {
          y = py;
        }
        featureSnapped = true;
      }
      // - Eave line (ey)
      else if (Math.abs(y - ey) < snapThreshold) {
        y = ey;
        featureSnapped = true;
      }
      // - Safe Cable Termination (1' above Cross/Sweep Auger)
      else if (Math.abs(y - safeTermY) < snapThreshold) {
        y = safeTermY;
        featureSnapped = true;
      }
      // - Auger Sweep Buffer Top (gy - fp - bufferHeight)
      else if (Math.abs(y - (gy - fp - bufferHeight)) < snapThreshold) {
        y = gy - fp - bufferHeight;
        featureSnapped = true;
      }
      // - Aeration floor line (gy - fp)
      else if (Math.abs(y - (gy - fp)) < snapThreshold) {
        y = gy - fp;
        featureSnapped = true;
      }
      // - Ground line (gy)
      else if (Math.abs(y - gy) < snapThreshold) {
        y = gy;
        featureSnapped = true;
      }

      // 3. Check roof slope lines if not snapped to peak or eave
      if (!featureSnapped) {
        // Left roof slope: line segment from (wl, ey) to (cx - lw/2, py)
        if (x >= wl - 5 && x <= cx - lw / 2 + 5) {
          const x1 = wl;
          const y1 = ey;
          const x2 = cx - lw / 2;
          const y2 = py;
          const l2 = Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2);
          if (l2 > 0) {
            const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / l2));
            const projX = x1 + t * (x2 - x1);
            const projY = y1 + t * (y2 - y1);
            const dist = Math.sqrt(Math.pow(x - projX, 2) + Math.pow(y - projY, 2));
            if (dist < snapThreshold) {
              x = projX;
              y = projY;
              featureSnapped = true;
            }
          }
        }
        // Right roof slope: line segment from (cx + lw/2, py) to (wr, ey)
        else if (x >= cx + lw / 2 - 5 && x <= wr + 5) {
          const x1 = cx + lw / 2;
          const y1 = py;
          const x2 = wr;
          const y2 = ey;
          const l2 = Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2);
          if (l2 > 0) {
            const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / l2));
            const projX = x1 + t * (x2 - x1);
            const projY = y1 + t * (y2 - y1);
            const dist = Math.sqrt(Math.pow(x - projX, 2) + Math.pow(y - projY, 2));
            if (dist < snapThreshold) {
              x = projX;
              y = projY;
              featureSnapped = true;
            }
          }
        }
      }

      if (featureSnapped) {
        return { x, y };
      }
    }

    // Default Grid snapping (falls back to 5px intervals)
    if (snapToGrid) {
      x = Math.round(x / 5) * 5;
      y = Math.round(y / 5) * 5;
    }

    return { x, y };
  };

  // Process measurement calculation
  const calculateCablesFromMeasurements = (measurements: MeasurementLine[]) => {
    const centerThresholdPx = (D / 2) * pixelsPerFoot * 0.33;
    const crossAugerHeightFt = 10 / 12; // 10 inches

    const validLines = measurements
      .filter((l) => l.p1 && l.p2)
      .map((line) => {
        const p1 = line.p1;
        const p2 = line.p2!;
        const midX = (p1.x + p2.x) / 2;
        const distFromCenterX = Math.abs(midX - cx);

        // Mount point height from ground
        const mountHeightFt = (gy - p1.y) / pixelsPerFoot;
        // Mount point height above aeration floor
        const mountHeightAboveFloor = mountHeightFt - F;
        // Target length to terminate 1' above cross auger
        const idealLength = mountHeightAboveFloor - (crossAugerHeightFt + 1.0);
        // Recommended standard cable length (nearest lower even integer, min 2')
        const recommendedLength = Math.max(2, Math.floor(idealLength / 2) * 2);

        return { recommendedLength, distFromCenterX };
      });

    if (validLines.length === 0) {
      handleUpdateCables('', '');
      return;
    }

    validLines.sort((a, b) => a.distFromCenterX - b.distFromCenterX);

    let centerLength: number | null = null;
    let radiusLength: number | null = null;

    if (validLines.length === 1) {
      if (validLines[0].distFromCenterX <= centerThresholdPx) {
        centerLength = validLines[0].recommendedLength;
      } else {
        radiusLength = validLines[0].recommendedLength;
      }
    } else {
      centerLength = validLines[0].recommendedLength;
      let maxRad = 0;
      for (let i = 1; i < validLines.length; i++) {
        maxRad = Math.max(maxRad, validLines[i].recommendedLength);
      }
      if (maxRad > 0) radiusLength = maxRad;
    }

    const centerCable = centerLength !== null ? centerLength.toString() : '';
    const radiusCable = radiusLength !== null ? radiusLength.toString() : '';

    handleUpdateCables(centerCable, radiusCable);
  };

  const handleUpdateCables = (centerCable: string, radiusCable: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => ({
        ...y,
        bins: y.bins.map((b) => {
          // Sync current bin
          if (b.id === activeBinId) {
            return { ...b, centerCable, radiusCable };
          }
          // Sync other bins with matching specification eaveHeight + totalHeight
          if (
            b.type === 'bin' &&
            b.eaveHeight === activeBin?.eaveHeight &&
            b.totalHeight === activeBin?.totalHeight
          ) {
            return { ...b, centerCable, radiusCable };
          }
          return b;
        }),
      })),
    }));
  };

  const handleUpdateDimension = (key: string, value: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => ({
        ...y,
        bins: y.bins.map((b) => {
          if (b.id !== activeBinId) return b;
          const updated = { ...b, [key]: value };
          if (key === 'eaveHeight') {
            updated.rings = Math.round(parseFloat(value) / 4).toString();
          }
          return updated;
        }),
      })),
    }));
  };

  const handleUpdateNotes = (notes: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => ({
        ...y,
        bins: y.bins.map((b) => (b.id === activeBinId ? { ...b, notes } : b)),
      })),
    }));
  };

  // Setup Keyboard Shortcuts for Side Planner (Measure Tool abort, delete last line)
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

      if (!activeBin) return;

      const measurements = activeBin.measurements || [];
      const lastLine = measurements[measurements.length - 1];

      // 1. Escape key cancels the active drawing line if it is in progress (i.e. has p1 but not p2)
      if (e.key === 'Escape') {
        if (lastLine && !lastLine.p2) {
          e.preventDefault();
          const newMeasurements = measurements.slice(0, -1);
          onUpdateProject((prev) => ({
            ...prev,
            yards: prev.yards.map((y) => ({
              ...y,
              bins: y.bins.map((b) => (b.id === activeBinId ? { ...b, measurements: newMeasurements } : b)),
            })),
          }));
          setHoverCoords(null);
          calculateCablesFromMeasurements(newMeasurements);
        }
      }

      // 2. Delete or Backspace key deletes the last line (complete or incomplete)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (measurements.length > 0) {
          e.preventDefault();
          const newMeasurements = measurements.slice(0, -1);
          onUpdateProject((prev) => ({
            ...prev,
            yards: prev.yards.map((y) => ({
              ...y,
              bins: y.bins.map((b) => (b.id === activeBinId ? { ...b, measurements: newMeasurements } : b)),
            })),
          }));
          setHoverCoords(null);
          calculateCablesFromMeasurements(newMeasurements);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeBin, activeBinId, onUpdateProject]);

  // SVG interactions
  const handleSVGMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey) || e.button === 2) {
      isPanningRef.current = true;
      panningStartRef.current = { x: e.clientX - view.x, y: e.clientY - view.y };
      svgContainerRef.current?.classList.add('panning');
      return;
    }

    const target = e.target as SVGElement;

    // Grab point dragging
    if (target.classList.contains('measurement-point')) {
      const lineIdx = parseInt(target.getAttribute('data-line-idx') || '0');
      const ptKey = target.getAttribute('data-pt-key') as 'p1' | 'p2';
      setDraggingPoint({ lineIdx, ptKey });
      return;
    }

    // Line dragging
    if (target.classList.contains('measurement-line')) {
      const lineIdx = parseInt(target.getAttribute('data-line-idx') || '0');
      const coords = getSVGCoords(e.clientX, e.clientY);
      const line = activeBin?.measurements?.[lineIdx];
      if (line && line.p1 && line.p2) {
        setDraggingLine({
          lineIdx,
          startCoords: coords,
          originalP1: { ...line.p1 },
          originalP2: { ...line.p2 },
        });
      }
      return;
    }

    if (target.classList.contains('measurement-label')) return;

    // Standard left-click drag to pan if the Measure Tool is not active (and we aren't dragging a line or point)
    if (e.button === 0 && !measureToolActive) {
      isPanningRef.current = true;
      panningStartRef.current = { x: e.clientX - view.x, y: e.clientY - view.y };
      svgContainerRef.current?.classList.add('panning');
      return;
    }

    // Measurement creation
    if (e.button === 0 && measureToolActive && activeBin) {
      const coords = getSVGCoords(e.clientX, e.clientY);
      let { x, y } = getSnappedCoords(coords.x, coords.y);

      const measurements = activeBin.measurements ? [...activeBin.measurements] : [];
      const lastLine = measurements[measurements.length - 1];

      if (!lastLine || (lastLine.p1 && lastLine.p2)) {
        measurements.push({ p1: { x, y }, p2: null });
      } else {
        // Auto-snap x to be perfectly vertical if it's very close
        const dx = Math.abs(x - lastLine.p1.x);
        if (dx < 18) {
          x = lastLine.p1.x;
        }
        lastLine.p2 = { x, y };
        setHoverCoords(null);
      }

      onUpdateProject((prev) => ({
        ...prev,
        yards: prev.yards.map((y) => ({
          ...y,
          bins: y.bins.map((b) => (b.id === activeBinId ? { ...b, measurements } : b)),
        })),
      }));

      calculateCablesFromMeasurements(measurements);
    }
  };

  const handleSVGMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanningRef.current) {
      setView({
        ...view,
        x: e.clientX - panningStartRef.current.x,
        y: e.clientY - panningStartRef.current.y,
      });
      return;
    }

    if (measureToolActive && activeBin) {
      const measurements = activeBin.measurements || [];
      const lastLine = measurements[measurements.length - 1];
      if (lastLine && !lastLine.p2) {
        const coords = getSVGCoords(e.clientX, e.clientY);
        const snapped = getSnappedCoords(coords.x, coords.y);
        
        // Auto-snap x to be perfectly vertical if it's very close
        const dx = Math.abs(snapped.x - lastLine.p1.x);
        if (dx < 18) {
          snapped.x = lastLine.p1.x;
        }
        
        setHoverCoords(snapped);
      } else {
        setHoverCoords(null);
      }
    } else {
      setHoverCoords(null);
    }

    if (draggingPoint && activeBin) {
      const coords = getSVGCoords(e.clientX, e.clientY);
      const { x, y } = getSnappedCoords(coords.x, coords.y);

      const measurements = activeBin.measurements.map((m, idx) => {
        if (idx !== draggingPoint.lineIdx) return m;
        
        let finalX = x;
        if (draggingPoint.ptKey === 'p2' && m.p1) {
          const dx = Math.abs(x - m.p1.x);
          if (dx < 18) finalX = m.p1.x;
        } else if (draggingPoint.ptKey === 'p1' && m.p2) {
          const dx = Math.abs(x - m.p2.x);
          if (dx < 18) finalX = m.p2.x;
        }

        return {
          ...m,
          [draggingPoint.ptKey]: { x: finalX, y },
        };
      });

      onUpdateProject((prev) => ({
        ...prev,
        yards: prev.yards.map((y) => ({
          ...y,
          bins: y.bins.map((b) => (b.id === activeBinId ? { ...b, measurements } : b)),
        })),
      }));

      calculateCablesFromMeasurements(measurements);
    } else if (draggingLine && activeBin) {
      const coords = getSVGCoords(e.clientX, e.clientY);
      const dx = coords.x - draggingLine.startCoords.x;
      const dy = coords.y - draggingLine.startCoords.y;

      const measurements = activeBin.measurements.map((line, idx) => {
        if (idx !== draggingLine.lineIdx) return line;

        let newP1X = draggingLine.originalP1.x + dx;
        let newP1Y = draggingLine.originalP1.y + dy;
        let newP2X = draggingLine.originalP2.x + dx;
        let newP2Y = draggingLine.originalP2.y + dy;

        if (snapToGrid) {
          newP1X = Math.round(newP1X / 5) * 5;
          newP1Y = Math.round(newP1Y / 5) * 5;
          newP2X = Math.round(newP2X / 5) * 5;
          newP2Y = Math.round(newP2Y / 5) * 5;
        }

        return {
          p1: { x: newP1X, y: newP1Y },
          p2: { x: newP2X, y: newP2Y },
        };
      });

      onUpdateProject((prev) => ({
        ...prev,
        yards: prev.yards.map((y) => ({
          ...y,
          bins: y.bins.map((b) => (b.id === activeBinId ? { ...b, measurements } : b)),
        })),
      }));

      calculateCablesFromMeasurements(measurements);
    }
  };

  const handleSVGMouseUp = () => {
    isPanningRef.current = false;
    setDraggingPoint(null);
    setDraggingLine(null);
    svgContainerRef.current?.classList.remove('panning');
  };

  const handleSVGMouseLeave = () => {
    handleSVGMouseUp();
    setHoverCoords(null);
  };

  const handleSVGWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const ptBefore = {
      x: (mouseX - view.x) / view.scale,
      y: (mouseY - view.y) / view.scale,
    };

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(0.1, view.scale * factor), 10);

    setView({
      x: mouseX - ptBefore.x * newScale,
      y: mouseY - ptBefore.y * newScale,
      scale: newScale,
    });
  };

  const resetViewport = () => {
    setView({ x: 0, y: 0, scale: 1.0 });
  };

  const clearMeasurements = () => {
    if (!activeBin) return;
    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => ({
        ...y,
        bins: y.bins.map((b) =>
          b.id === activeBinId ? { ...b, measurements: [], centerCable: '', radiusCable: '' } : b
        ),
      })),
    }));
  };

  // Grid tick calculations
  const wallTicks = useMemo(() => {
    const ticks: { y: number; height: number; text?: string }[] = [];
    for (let i = 0; i <= E; i++) {
      const ty = gy - i * pixelsPerFoot;
      ticks.push({
        y: ty,
        height: i % 5 === 0 ? 12 : 6,
        text: i % 5 === 0 && i !== 0 ? `${i}'` : undefined,
      });
    }
    return ticks;
  }, [E, pixelsPerFoot]);

  const midRoofY = (ey + py) / 2;
  const roofSlope = (ey - py) / (wp / 2 - lw / 2);
  const midRoofOffset = (ey - midRoofY) / roofSlope;
  const mxLeft = wl + midRoofOffset;
  const mxRight = wr - midRoofOffset;

  const bufferHeight = (10 / 12) * pixelsPerFoot;

  if (!activeBin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-neutral-100">
        <p className="text-neutral-500 font-bold uppercase tracking-wider text-sm">
          No active bin selected. Select a bin unit in 2D Planner.
        </p>
      </div>
    );
  }

  return (
    <div id="view-estimator" className="flex-1 flex flex-col lg:flex-row h-full w-full overflow-hidden select-none">
      {/* Estimator Sidebar */}
      <aside className="w-full lg:w-80 bg-black border-r border-neutral-900 flex flex-col shrink-0">
        <div className="flex-grow overflow-y-auto p-4 space-y-4 bg-black custom-scrollbar flex flex-col">
          <div className="flex items-center justify-between bg-neutral-200 border border-neutral-300 rounded-lg px-2.5 py-1.5 shadow-sm">
            <span className="text-[9px] font-black text-neutral-500 uppercase tracking-wider">Measuring Bin</span>
            <span id="estimator-bin-label" className="text-xs text-neutral-900 font-black truncate max-w-[160px]">
              {activeBin.name || '—'}
            </span>
          </div>

          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[8px] text-neutral-400 font-bold uppercase tracking-wider mb-1">
                  Diameter (ft)
                </label>
                <input
                  type="number"
                  value={activeBin.diameter}
                  onChange={(e) => handleUpdateDimension('diameter', e.target.value)}
                  className="w-full px-2 py-1 bg-neutral-200 border border-neutral-300 rounded-lg text-xs text-neutral-900 font-bold outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-sm"
                />
              </div>
              <div>
                <label className="block text-[8px] text-neutral-400 font-bold uppercase tracking-wider mb-1">
                  Floor Ht (ft)
                </label>
                <input
                  type="number"
                  value={activeBin.floorThick || '1.5'}
                  onChange={(e) => handleUpdateDimension('floorThick', e.target.value)}
                  className="w-full px-2 py-1 bg-neutral-200 border border-neutral-300 rounded-lg text-xs text-neutral-900 font-bold outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[8px] text-neutral-400 font-bold uppercase tracking-wider mb-1">
                  Eave Ht (ft)
                </label>
                <input
                  type="number"
                  value={activeBin.eaveHeight || '32'}
                  onChange={(e) => handleUpdateDimension('eaveHeight', e.target.value)}
                  className="w-full px-2 py-1 bg-neutral-200 border border-neutral-300 rounded-lg text-xs text-neutral-900 font-bold outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-sm"
                />
              </div>
              <div>
                <label className="block text-[8px] text-neutral-400 font-bold uppercase tracking-wider mb-1">
                  Total Ht (ft)
                </label>
                <input
                  type="number"
                  value={activeBin.totalHeight || '42'}
                  onChange={(e) => handleUpdateDimension('totalHeight', e.target.value)}
                  className="w-full px-2 py-1 bg-neutral-200 border border-neutral-300 rounded-lg text-xs text-neutral-900 font-bold outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-sm"
                />
              </div>
            </div>
          </section>

          <section className="bg-neutral-200 p-2.5 rounded-xl border border-neutral-300 border-l-4 border-l-amber-500 shadow-sm space-y-2">
            <p className="text-[9px] text-amber-800 uppercase font-black tracking-widest flex items-center justify-between">
              <span>Specs &amp; Cable Config</span>
              <span className="text-[8px] font-mono text-neutral-500">Auto</span>
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-neutral-700">
              <div className="bg-neutral-300/60 px-2 py-1 rounded-lg border border-neutral-300/30 shadow-inner">
                <span className="block text-[8px] text-neutral-600 font-black uppercase">Est. Capacity</span>
                <div className="flex items-baseline gap-0.5">
                  <span id="bushelCount" className="text-sm font-mono font-black text-amber-800">
                    {bushels.toLocaleString()}
                  </span>
                  <span className="text-[8px] font-black text-neutral-500">BU</span>
                </div>
              </div>
              <div className="bg-neutral-300/60 px-2 py-1 rounded-lg border border-neutral-300/30 shadow-inner">
                <span className="block text-[8px] text-neutral-600 font-black uppercase">Total Cables</span>
                <span id="totalCableCount" className="text-xs font-mono font-black text-neutral-900 block">
                  {cables.center + cables.radius} <span className="text-[8px] text-neutral-500 font-black uppercase">Qty</span>
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-neutral-300/60 px-2 py-1 rounded-lg border border-neutral-300/30 shadow-inner">
                <span className="block text-[8px] text-neutral-600 font-black uppercase">Center</span>
                <span id="centerCableCount" className="text-xs font-black text-neutral-800">
                  {cables.center}
                </span>
              </div>
              <div className="bg-neutral-300/60 px-2 py-1 rounded-lg border border-neutral-300/30 shadow-inner">
                <span className="block text-[8px] text-neutral-600 font-black uppercase">Radius</span>
                <span id="radiusCableCount" className="text-xs font-black text-neutral-800">
                  {cables.radius}
                </span>
              </div>
            </div>
          </section>

          {/* Clearance & Safety Audit Panel */}
          <section className="bg-neutral-200 border border-neutral-300 rounded-xl p-3 space-y-2.5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-[9px] font-black text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse"></span>
                Clearance &amp; Safety Audit
              </h3>
              <span className="text-[9px] font-mono text-neutral-600 uppercase bg-neutral-300 px-2 py-0.5 rounded font-bold">
                {(activeBin.measurements?.filter(m => m.p1 && m.p2).length || 0)} Cables
              </span>
            </div>

            {(!activeBin.measurements || activeBin.measurements.filter(m => m.p1 && m.p2).length === 0) ? (
              <div className="text-[10px] text-neutral-500 italic p-3 text-center border border-dashed border-neutral-300 rounded-lg">
                No custom lines drawn. Use the Measure Tool on the blueprint to place temperature cables.
              </div>
            ) : (
              <div className="space-y-2 max-h-[290px] overflow-y-auto pr-1 custom-scrollbar">
                {activeBin.measurements.map((line, idx) => {
                  if (!line.p1 || !line.p2) return null;
                  
                  const dx = line.p2.x - line.p1.x;
                  const dy = line.p2.y - line.p1.y;
                  const exactLength = Math.sqrt(dx * dx + dy * dy) / pixelsPerFoot;
                  
                  const midX = (line.p1.x + line.p2.x) / 2;
                  const distFromCenterX = Math.abs(midX - cx);
                  const centerThresholdPx = (D / 2) * pixelsPerFoot * 0.33;
                  const isCenter = distFromCenterX <= centerThresholdPx;
                  
                  const crossAugerHeightFt = 10 / 12; // 10 inches ~ 0.833 ft
                  const startHeightFt = (gy - line.p1.y) / pixelsPerFoot;
                  const mountHeightAboveFloor = startHeightFt - F;
                  const idealLength = mountHeightAboveFloor - (crossAugerHeightFt + 1.0);
                  const roundedLength = Math.max(2, Math.floor(idealLength / 2) * 2);
                  
                  // Calculate installed clearance of standard ordered cable
                  const installedEndHeightFt = startHeightFt - roundedLength;
                  const installedClearanceFloor = installedEndHeightFt - F;
                  const clearanceAboveCrossAuger = installedClearanceFloor - crossAugerHeightFt;

                  let statusColor = 'text-emerald-700';
                  let statusBg = 'bg-emerald-50 border-emerald-200 text-neutral-800';
                  let statusText = 'Optimal';
                  let statusIcon = '✓';
                  let recommendation = '';

                  if (installedClearanceFloor < 0) {
                    statusColor = 'text-red-700';
                    statusBg = 'bg-red-50 border-red-200 text-neutral-800';
                    statusText = 'CRITICAL: Tearing Risk';
                    statusIcon = '⚠️';
                    recommendation = `The standard ${roundedLength}' cable is too long! It will penetrate the aeration floor by ${Math.abs(installedClearanceFloor).toFixed(1)}'. Choose a shorter standard length to protect the equipment.`;
                  } else if (clearanceAboveCrossAuger < 0) {
                    statusColor = 'text-red-700';
                    statusBg = 'bg-red-50 border-red-200 text-neutral-800';
                    statusText = 'CRITICAL: Auger Risk';
                    statusIcon = '⚠️';
                    recommendation = `The standard ${roundedLength}' cable hangs below the top of the cross auger! High risk of $450 tearing damage during cleanout. Shorten the cable.`;
                  } else if (clearanceAboveCrossAuger < 1.0) {
                    statusColor = 'text-amber-700';
                    statusBg = 'bg-amber-50 border-amber-200 text-neutral-800';
                    statusText = 'Caution: Low Clearance';
                    statusIcon = '⚠️';
                    recommendation = `Standard ${roundedLength}' cable terminates only ${clearanceAboveCrossAuger.toFixed(1)}' above the cross auger (leaves less than 1' of safety clearance). Use extreme caution.`;
                  } else if (clearanceAboveCrossAuger > 3.0) {
                    statusColor = 'text-amber-700';
                    statusBg = 'bg-amber-50 border-amber-200 text-neutral-800';
                    statusText = 'Caution: Terminated High';
                    statusIcon = '⚠️';
                    recommendation = `Standard ${roundedLength}' cable terminates ${clearanceAboveCrossAuger.toFixed(1)}' above the cross auger, leaving over ${installedClearanceFloor.toFixed(1)}' of grain at the bottom unmonitored.`;
                  } else {
                    recommendation = `Standard ${roundedLength}' cable terminates perfectly ${clearanceAboveCrossAuger.toFixed(1)}' above the cross auger. Excellent safety clearance!`;
                  }

                  return (
                    <div key={idx} className={`p-2 rounded-lg border text-[11px] ${statusBg}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-extrabold text-neutral-800">
                          Cable #{idx + 1} ({isCenter ? 'Center' : 'Radius'})
                        </span>
                        <button
                          onClick={() => {
                            const newMeasurements = activeBin.measurements.filter((_, i) => i !== idx);
                            onUpdateProject((prev) => ({
                              ...prev,
                              yards: prev.yards.map((y) => ({
                                ...y,
                                bins: y.bins.map((b) => (b.id === activeBinId ? { ...b, measurements: newMeasurements } : b)),
                              })),
                            }));
                            calculateCablesFromMeasurements(newMeasurements);
                          }}
                          className="text-neutral-400 hover:text-red-600 transition-colors cursor-pointer p-0.5 text-center flex items-center"
                          title="Delete cable"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-medium text-neutral-600 my-1">
                        <div>Hanger Ht: <span className="text-neutral-900 font-mono font-bold">{startHeightFt.toFixed(1)}'</span></div>
                        <div>Standard Order: <span className="text-amber-800 font-mono font-black">{roundedLength}'</span></div>
                        <div>Auger Clear: <span className={`${clearanceAboveCrossAuger < 1.0 ? 'text-red-600' : 'text-emerald-600'} font-mono font-extrabold`}>{clearanceAboveCrossAuger.toFixed(1)}'</span></div>
                        <div>Status: <span className={`${statusColor} font-bold`}>{statusIcon} {statusText}</span></div>
                      </div>
                      
                      <p className="text-[9px] text-neutral-600 leading-normal mt-1 border-t border-neutral-300/60 pt-1 font-normal">
                        {recommendation}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="flex flex-col min-h-[300px] h-[300px] flex-none">
            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-1.5">
              Grain Bin Notes
            </label>
            <textarea
              id="userNotes"
              value={activeBin.notes || ''}
              onChange={(e) => handleUpdateNotes(e.target.value)}
              className="w-full h-full p-2.5 bg-neutral-200 border border-neutral-300 rounded-lg text-xs text-neutral-900 resize-none outline-none min-h-[80px] custom-scrollbar focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-sm font-semibold"
              placeholder="Enter custom notes or specifications for this bin..."
            ></textarea>
          </section>
        </div>
      </aside>

      {/* Estimator Workspace Canvas */}
      <div className="flex-grow flex flex-col bg-neutral-100 relative h-full">
        {/* SVG Blueprint Tools Header */}
        <div className="h-16 flex flex-wrap items-center justify-between px-6 border-b border-neutral-900 bg-neutral-950 shrink-0 gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-neutral-900 px-3 py-1.5 rounded-lg border border-neutral-800 h-9">
              <input
                type="checkbox"
                id="measureToggle"
                checked={measureToolActive}
                onChange={(e) => setMeasureToolActive(e.target.checked)}
                className="w-4 h-4 accent-amber-400 cursor-pointer"
              />
              <span className="text-[9px] text-zinc-400 font-bold uppercase whitespace-nowrap">Measure Tool</span>
            </div>
            <div className="flex items-center gap-2 bg-neutral-900 px-3 py-1.5 rounded-lg border border-neutral-800 h-9">
              <input
                type="checkbox"
                id="snapToggle"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.target.checked)}
                className="w-4 h-4 accent-amber-400 cursor-pointer"
              />
              <span className="text-[9px] text-zinc-400 font-bold uppercase whitespace-nowrap">Snap to Grid</span>
            </div>
            <div className="flex items-center gap-2 bg-neutral-900 px-3 py-1.5 rounded-lg border border-neutral-800 h-9">
              <input
                type="checkbox"
                id="featureSnapToggle"
                checked={snapToFeatures}
                onChange={(e) => setSnapToFeatures(e.target.checked)}
                className="w-4 h-4 accent-amber-400 cursor-pointer"
              />
              <span className="text-[9px] text-zinc-400 font-bold uppercase whitespace-nowrap">Smart Snap</span>
            </div>
            <button
              onClick={() => onSwitchTab('planner')}
              className="bg-neutral-900 hover:bg-neutral-800 text-amber-400 border border-neutral-800 rounded-lg px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer h-9"
            >
              <ArrowLeft size={14} />
              Back to 2D Map Layout
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={resetViewport}
              className="bg-neutral-900 hover:bg-neutral-800 text-white text-[10px] font-bold px-4 py-2 rounded-lg border border-neutral-800 transition-colors h-9 uppercase cursor-pointer"
            >
              Reset View
            </button>
            <button
              onClick={clearMeasurements}
              className="bg-neutral-900 hover:bg-neutral-850 text-zinc-400 text-[10px] font-bold px-4 py-2 rounded-lg border border-neutral-800 transition-colors h-9 uppercase cursor-pointer"
            >
              Clear Measurements
            </button>
          </div>
        </div>

        <div ref={svgContainerRef} className="flex-grow overflow-hidden relative w-full h-full">
          <svg
            id="bin-svg"
            ref={svgRef}
            viewBox="0 0 600 800"
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            onMouseDown={handleSVGMouseDown}
            onMouseMove={handleSVGMouseMove}
            onMouseUp={handleSVGMouseUp}
            onMouseLeave={handleSVGMouseLeave}
            onWheel={handleSVGWheel}
            className="touch-none bg-[#18181b] block h-full w-full"
            style={{ cursor: measureToolActive ? 'crosshair' : 'grab' }}
          >
            <g id="viewport-group" transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
              <defs>
                <pattern id="grid-large" width="50" height="50" patternUnits="userSpaceOnUse">
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#27272a" strokeWidth="1" />
                </pattern>
                <marker id="dot-marker" markerWidth="6" markerHeight="6" refX="3" refY="3" orientation="auto">
                  <circle cx="3" cy="3" r="1.5" fill="#3f3f46" />
                </marker>
              </defs>
              <rect x="-4000" y="-4000" width="8000" height="8000" fill="url(#grid-large)" />

              {/* Dimensions / Guides Layer */}
              <g id="dim-layer">
                {/* Diameter Dimension line */}
                <line x1={wl} y1={gy + 30} x2={wr} y2={gy + 30} stroke="#3f3f46" strokeWidth="1.2" />
                <polygon points={`${wl},${gy + 30} ${wl + 6},${gy + 27} ${wl + 6},${gy + 33}`} fill="#3f3f46" />
                <polygon points={`${wr},${gy + 30} ${wr - 6},${gy + 27} ${wr - 6},${gy + 33}`} fill="#3f3f46" />
                <rect x={cx - 20} y={gy + 20} width="40" height="14" fill="#0a0a0a" rx="2" />
                <text x={cx} y={gy + 31} textAnchor="middle" className="dim-text fill-zinc-400 font-bold text-[9px] uppercase tracking-wider font-sans">
                  {D}'
                </text>

                {/* Eave Height Dimension line */}
                <line x1={wr + 35} y1={gy} x2={wr + 35} y2={ey} stroke="#3f3f46" strokeWidth="1.2" />
                <polygon points={`${wr + 35},${gy} ${wr + 32},${gy - 6} ${wr + 38},${gy - 6}`} fill="#3f3f46" />
                <polygon points={`${wr + 35},${ey} ${wr + 32},${ey + 6} ${wr + 38},${ey + 6}`} fill="#3f3f46" />
                <rect x={wr + 15} y={ey + hp / 2 - 7} width="40" height="14" fill="#0a0a0a" rx="2" />
                <text x={wr + 35} y={ey + hp / 2 + 4} textAnchor="middle" className="dim-text fill-zinc-400 font-bold text-[9px] uppercase tracking-wider font-sans">
                  {E}'
                </text>

                {/* Total Height Dimension line */}
                <line x1={wl - 35} y1={gy} x2={wl - 35} y2={py} stroke="#3f3f46" strokeWidth="1.2" />
                <polygon points={`${wl - 35},${gy} ${wl - 38},${gy - 6} ${wl - 32},${gy - 6}`} fill="#3f3f46" />
                <polygon points={`${wl - 35},${py} ${wl - 38},${py + 6} ${wl - 32},${py + 6}`} fill="#3f3f46" />
                <rect x={wl - 55} y={py + tp / 2 - 7} width="40" height="14" fill="#0a0a0a" rx="2" />
                <text x={wl - 35} y={py + tp / 2 + 4} textAnchor="middle" className="dim-text fill-zinc-400 font-bold text-[9px] uppercase tracking-wider font-sans">
                  {H}'
                </text>
              </g>

              {/* Bin Layout Layer */}
              <g id="bin-layer">
                {/* Foundation */}
                <rect id="foundation" x={wl - 30} y={gy} width={wp + 60} height="15" className="foundation-stroke stroke-zinc-700 fill-[#a1a1aa]" />

                {/* Aeration ticks */}
                <g id="tick-layer">
                  {wallTicks.map((t, idx) => (
                    <g key={idx}>
                      <line x1={wl} y1={t.y} x2={wl + t.height} y2={t.y} className="tick-line stroke-neutral-800" strokeWidth="1" />
                      {t.text && (
                        <text x={wl + 16} y={t.y + 3} className="tick-text fill-zinc-600 font-bold text-[7px] font-sans">
                          {t.text}
                        </text>
                      )}
                    </g>
                  ))}
                </g>

                {/* Aeration Floor */}
                <line id="aeration-floor" x1={wl} y1={gy - fp} x2={wr} y2={gy - fp} className="floor-stroke stroke-zinc-700 stroke-[1.5] [stroke-dasharray:4_4] fill-none" />

                {/* Auger sweep buffer */}
                <rect id="auger-buffer-rect" x={wl} y={gy - fp - bufferHeight} width={wp} height={bufferHeight} className="auger-buffer fill-red-500/10 stroke-red-500/30 stroke-[1] [stroke-dasharray:2_2]" />

                {/* Core Bin Shell Outline */}
                <path
                  id="bin-outline"
                  d={`M ${wl} ${gy} L ${wl} ${ey} L ${cx - lw / 2} ${py} L ${cx + lw / 2} ${py} L ${wr} ${ey} L ${wr} ${gy} Z`}
                  className="blueprint-stroke stroke-amber-400 fill-none stroke-2"
                />

                {/* Eave line */}
                <line id="eave-dashed" x1={wl} y1={ey} x2={wr} y2={ey} className="eave-dashed-line stroke-amber-400/40 stroke-1 [stroke-dasharray:8_4]" />

                {/* Mid-Roof Marker line */}
                <line id="mid-roof-marker" x1={mxLeft} y1={midRoofY} x2={mxRight} y2={midRoofY} className="mid-roof-line stroke-emerald-500 stroke-1 [stroke-dasharray:4_4] opacity-80" />
                <text id="mid-roof-label" x={cx} y={midRoofY - 5} textAnchor="middle" className="mid-roof-text fill-emerald-500 text-[5px] font-bold uppercase tracking-wider font-sans">
                  Mid-Roof Ref
                </text>

                {/* Peak Lid */}
                <rect id="peak-lid" x={cx - lw / 2 - 2} y={py - 4} width={lw + 4} height="8" className="blueprint-stroke stroke-amber-400 fill-none stroke-2" />
              </g>

              {/* Measurements Interactive Layer */}
              <g id="measure-layer">
                {activeBin.measurements?.map((line, idx) => {
                  if (!line.p1) return null;

                  let isCenter = false;
                  let strokeColor = '#ffffff';
                  let pointColor = '#ffffff';
                  let labelText = '';
                  let distFt = '0';

                  if (line.p2) {
                    const dx = line.p2.x - line.p1.x;
                    const dy = line.p2.y - line.p1.y;
                    distFt = (Math.sqrt(dx * dx + dy * dy) / pixelsPerFoot).toFixed(1);

                    const midX = (line.p1.x + line.p2.x) / 2;
                    const distFromCenterX = Math.abs(midX - cx);
                    const centerThresholdPx = (D / 2) * pixelsPerFoot * 0.33;

                    isCenter = distFromCenterX <= centerThresholdPx;
                    strokeColor = isCenter ? '#facc15' : '#67e8f9';
                    pointColor = isCenter ? '#fbbf24' : '#22d3ee';
                    
                    labelText = `${distFt}'`;
                  }

                  const ptRadius = 5 / view.scale;
                  const labelSize = 13 / view.scale;

                  return (
                    <g key={idx}>
                      {/* Connector Line */}
                      {line.p2 && (
                        <>
                          <line
                            x1={line.p1.x}
                            y1={line.p1.y}
                            x2={line.p2.x}
                            y2={line.p2.y}
                            stroke={strokeColor}
                            strokeWidth={2.5 / view.scale}
                            strokeDasharray="6 3"
                            className="measurement-line cursor-grab active:cursor-grabbing"
                            data-line-idx={idx}
                          />
                          {/* Distance label floating text */}
                          <text
                            x={(line.p1.x + line.p2.x) / 2 + 8}
                            y={(line.p1.y + line.p2.y) / 2 - 6}
                            style={{
                              fontSize: `${labelSize}px`,
                              fill: pointColor,
                              paintOrder: 'stroke',
                              stroke: '#000000',
                              strokeWidth: '3px',
                              fontWeight: 'bold',
                            }}
                            className="measurement-label pointer-events-none font-mono"
                          >
                            {labelText}
                          </text>
                        </>
                      )}

                      {/* Start Point */}
                      <circle
                        cx={line.p1.x}
                        cy={line.p1.y}
                        r={ptRadius}
                        fill={line.p2 ? pointColor : '#fbbf24'}
                        stroke="#000000"
                        strokeWidth={1.5}
                        className="measurement-point cursor-move"
                        data-line-idx={idx}
                        data-pt-key="p1"
                      />

                      {/* End Point */}
                      {line.p2 && (
                        <circle
                          cx={line.p2.x}
                          cy={line.p2.y}
                          r={ptRadius}
                          fill={pointColor}
                          stroke="#000000"
                          strokeWidth={1.5}
                          className="measurement-point cursor-move"
                          data-line-idx={idx}
                          data-pt-key="p2"
                        />
                      )}
                    </g>
                  );
                })}

                {/* Real-time draw preview line */}
                {(() => {
                  const measurements = activeBin.measurements || [];
                  const lastLine = measurements[measurements.length - 1];
                  if (measureToolActive && lastLine && !lastLine.p2 && hoverCoords) {
                    const dx = hoverCoords.x - lastLine.p1.x;
                    const dy = hoverCoords.y - lastLine.p1.y;
                    const exactLength = Math.sqrt(dx * dx + dy * dy) / pixelsPerFoot;
                    
                    const midX = (lastLine.p1.x + hoverCoords.x) / 2;
                    const distFromCenterX = Math.abs(midX - cx);
                    const centerThresholdPx = (D / 2) * pixelsPerFoot * 0.33;
                    const isCenter = distFromCenterX <= centerThresholdPx;
                    
                    const strokeColor = isCenter ? 'rgba(250, 204, 21, 0.7)' : 'rgba(103, 232, 249, 0.7)';
                    const textColor = isCenter ? '#fbbf24' : '#22d3ee';
                    
                    const labelSize = 13 / view.scale;

                    return (
                      <g>
                        <line
                          x1={lastLine.p1.x}
                          y1={lastLine.p1.y}
                          x2={hoverCoords.x}
                          y2={hoverCoords.y}
                          stroke={strokeColor}
                          strokeWidth={2.5 / view.scale}
                          strokeDasharray="4 4"
                          className="pointer-events-none"
                        />
                        <circle
                          cx={hoverCoords.x}
                          cy={hoverCoords.y}
                          r={5 / view.scale}
                          fill={textColor}
                          fillOpacity={0.8}
                          stroke="#000000"
                          strokeWidth={1.5}
                          className="pointer-events-none animate-pulse"
                        />
                        <text
                          x={(lastLine.p1.x + hoverCoords.x) / 2 + 8}
                          y={(lastLine.p1.y + hoverCoords.y) / 2 - 6}
                          style={{
                            fontSize: `${labelSize}px`,
                            fill: textColor,
                            paintOrder: 'stroke',
                            stroke: '#000000',
                            strokeWidth: '3px',
                            fontWeight: 'bold',
                          }}
                          className="pointer-events-none font-mono"
                        >
                          {exactLength.toFixed(1)}'
                        </text>
                      </g>
                    );
                  }
                  return null;
                })()}
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
};
