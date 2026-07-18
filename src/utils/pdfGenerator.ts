/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Project, BinAsset, Asset } from '../types';

export interface PDFGeneratorCallbacks {
  setLoading: (loading: boolean) => void;
  setLoadingText: (text: string) => void;
}

export interface PDFGeneratorOptions {
  includeAssetDirectory?: boolean;
}

export function getCableRecommendation(diameterStr: string) {
  const d = parseFloat(diameterStr) || 0;
  if (d < 24) {
    return { center: 1, radius: 0 };
  } else if (d <= 35) {
    return { center: 0, radius: 3 };
  } else if (d <= 41) {
    return { center: 1, radius: 3 };
  } else {
    return { center: 1, radius: 4 };
  }
}

/**
 * Draws a highly precise, crisp, vector-based 2D Side Plan (cross-section)
 * of a grain storage bin directly onto a jsPDF page.
 */
export function drawBinSidePlan(
  doc: jsPDF,
  bin: BinAsset,
  targetX: number,
  targetY: number,
  targetW: number,
  targetH: number,
  theme: 'light' | 'dark' = 'light'
) {
  const D = parseFloat(bin.diameter || '36') || 36;
  const H = parseFloat(bin.totalHeight || '42') || 42;
  const E = parseFloat(bin.eaveHeight || '32') || 32;
  const F = parseFloat(bin.floorThick || '1.5') || 1.5;

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

  const scaleX = targetW / 600;
  const scaleY = targetH / 800;

  const mapX = (x: number) => targetX + x * scaleX;
  const mapY = (y: number) => targetY + y * scaleY;

  // Draw background border / panel
  if (theme === 'dark') {
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(targetX, targetY, targetW, targetH, 'F');
  } else {
    // Elegant blueprint outline border
    doc.setFillColor(253, 253, 253);
    doc.rect(targetX, targetY, targetW, targetH, 'F');
    doc.setDrawColor(230, 230, 235);
    doc.setLineWidth(1);
    doc.rect(targetX, targetY, targetW, targetH, 'S');
  }

  // Draw Grid Dots for schematic look
  doc.setDrawColor(theme === 'dark' ? 50 : 235, theme === 'dark' ? 65 : 235, theme === 'dark' ? 85 : 235);
  for (let gxCoords = 25; gxCoords < 580; gxCoords += 30) {
    for (let gyCoords = 25; gyCoords < 780; gyCoords += 30) {
      doc.circle(mapX(gxCoords), mapY(gyCoords), 0.5, 'F');
    }
  }

  // 1. Foundation Block
  doc.setFillColor(theme === 'dark' ? 30 : 243, theme === 'dark' ? 41 : 244, theme === 'dark' ? 59 : 246);
  doc.setDrawColor(theme === 'dark' ? 71 : 180, theme === 'dark' ? 85 : 180, theme === 'dark' ? 105 : 180);
  doc.setLineWidth(1);
  doc.rect(mapX(wl - 30), mapY(gy), (wp + 60) * scaleX, 15 * scaleY, 'FD');

  // 2. Foundation text label
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(theme === 'dark' ? 148 : 130, theme === 'dark' ? 163 : 130, theme === 'dark' ? 184 : 130);
  doc.text('CONCRETE FOUNDATION BLOCK', mapX(cx), mapY(gy + 10), { align: 'center' });

  // 3. Aeration Floor (Dashed Line)
  doc.setDrawColor(theme === 'dark' ? 120 : 150);
  doc.setLineWidth(1);
  (doc as any).setLineDash([3, 3]);
  doc.line(mapX(wl), mapY(gy - fp), mapX(wr), mapY(gy - fp));
  (doc as any).setLineDash([]);

  // 4. Auger Sweep Buffer (Light red warning safety zone)
  const bufferHeight = (10 / 12) * pixelsPerFoot;
  doc.setFillColor(239, 68, 68, theme === 'dark' ? 0.06 : 0.04);
  doc.setDrawColor(239, 68, 68);
  doc.setLineWidth(0.5);
  (doc as any).setLineDash([2, 2]);
  doc.rect(mapX(wl), mapY(gy - fp - bufferHeight), wp * scaleX, bufferHeight * scaleY, 'FD');
  (doc as any).setLineDash([]);

  // 5. Core Bin Shell Outline
  doc.setDrawColor(217, 119, 6); // amber-600 (GrainLink Brand Color)
  doc.setLineWidth(1.8);
  doc.line(mapX(wl), mapY(gy), mapX(wl), mapY(ey));
  doc.line(mapX(wl), mapY(ey), mapX(cx - lw / 2), mapY(py));
  doc.line(mapX(cx - lw / 2), mapY(py), mapX(cx + lw / 2), mapY(py));
  doc.line(mapX(cx + lw / 2), mapY(py), mapX(wr), mapY(ey));
  doc.line(mapX(wr), mapY(ey), mapX(wr), mapY(gy));
  doc.line(mapX(wr), mapY(gy), mapX(wl), mapY(gy));

  // Peak Lid cap
  doc.rect(mapX(cx - lw / 2 - 2), mapY(py - 4), (lw + 4) * scaleX, 8 * scaleY, 'S');

  // 6. Eave Dashed Line
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.5);
  (doc as any).setLineDash([4, 4]);
  doc.line(mapX(wl), mapY(ey), mapX(wr), mapY(ey));
  (doc as any).setLineDash([]);

  // 7. Mid-Roof Marker Reference
  const midRoofY = (ey + py) / 2;
  const roofSlope = (ey - py) / Math.max(1, wp / 2 - lw / 2);
  const midRoofOffset = (ey - midRoofY) / Math.max(0.1, roofSlope);
  const mxLeft = wl + midRoofOffset;
  const mxRight = wr - midRoofOffset;
  doc.setDrawColor(16, 185, 129); // emerald-500
  doc.setLineWidth(0.5);
  (doc as any).setLineDash([3, 3]);
  doc.line(mapX(mxLeft), mapY(midRoofY), mapX(mxRight), mapY(midRoofY));
  (doc as any).setLineDash([]);

  doc.setTextColor(16, 185, 129);
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(5);
  doc.text('MID-ROOF REFERENCE LINE', mapX(cx), mapY(midRoofY - 3), { align: 'center' });

  // 8. Draw Cables (either custom measurements or standard recommendation)
  const measurements = bin.measurements || [];
  if (measurements.length > 0) {
    // Draw user-defined custom cables
    measurements.forEach((line) => {
      if (!line.p1 || !line.p2) return;
      const x1 = mapX(line.p1.x);
      const y1 = mapY(line.p1.y);
      const x2 = mapX(line.p2.x);
      const y2 = mapY(line.p2.y);

      const dx = line.p2.x - line.p1.x;
      const dy = line.p2.y - line.p1.y;
      const distFt = (Math.sqrt(dx * dx + dy * dy) / pixelsPerFoot).toFixed(1);

      const midLineX = (line.p1.x + line.p2.x) / 2;
      const isCenterCable = Math.abs(midLineX - cx) <= wp * 0.16;

      const cableColor = isCenterCable ? [217, 119, 6] : [6, 182, 212]; // amber vs cyan
      doc.setDrawColor(cableColor[0], cableColor[1], cableColor[2]);
      doc.setLineWidth(1.5);
      (doc as any).setLineDash([4, 3]);
      doc.line(x1, y1, x2, y2);
      (doc as any).setLineDash([]);

      // Terminal weight anchor
      doc.setFillColor(cableColor[0], cableColor[1], cableColor[2]);
      doc.circle(x2, y2, 2.5, 'F');
      doc.circle(x1, y1, 2, 'F');

      // Label floating text
      doc.setTextColor(cableColor[0], cableColor[1], cableColor[2]);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.text(`${distFt}'`, (x1 + x2) / 2 + 6, (y1 + y2) / 2 - 2);
    });
  } else {
    // Draw standard recommended cables
    const rec = getCableRecommendation(bin.diameter);
    const cablesTermY = gy - fp - 2 * pixelsPerFoot; // terminate 2' above floor

    // Center cable
    if (rec.center > 0) {
      const cx1 = mapX(cx);
      const cy1 = mapY(py + 4);
      const cx2 = mapX(cx);
      const cy2 = mapY(cablesTermY);

      doc.setDrawColor(217, 119, 6); // amber
      doc.setLineWidth(1.5);
      (doc as any).setLineDash([4, 3]);
      doc.line(cx1, cy1, cx2, cy2);
      (doc as any).setLineDash([]);

      doc.setFillColor(217, 119, 6);
      doc.circle(cx2, cy2, 2.5, 'F');
      doc.circle(cx1, cy1, 2, 'F');

      // Label
      const centerLength = Math.max(2, Math.round(H - F - 2));
      doc.setTextColor(217, 119, 6);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.text(`${centerLength}' (Center Cable)`, cx1 + 6, (cy1 + cy2) / 2);
    }

    // Radius cables
    if (rec.radius > 0) {
      const radDistance = wp * 0.35;
      const rxL = cx - radDistance;
      const rxR = cx + radDistance;

      const rxL_Y = ey + ((rxL - wl) / Math.max(1, cx - lw / 2 - wl)) * (py - ey);
      const rxR_Y = py + ((rxR - (cx + lw / 2)) / Math.max(1, wr - (cx + lw / 2))) * (ey - py);

      const rPoints = [
        { x1: mapX(rxL), y1: mapY(rxL_Y), x2: mapX(rxL), y2: mapY(cablesTermY) },
        { x1: mapX(rxR), y1: mapY(rxR_Y), x2: mapX(rxR), y2: mapY(cablesTermY) }
      ];

      rPoints.forEach((pt, rIdx) => {
        doc.setDrawColor(6, 182, 212); // cyan
        doc.setLineWidth(1.5);
        (doc as any).setLineDash([4, 3]);
        doc.line(pt.x1, pt.y1, pt.x2, pt.y2);
        (doc as any).setLineDash([]);

        doc.setFillColor(6, 182, 212);
        doc.circle(pt.x2, pt.y2, 2.5, 'F');
        doc.circle(pt.x1, pt.y1, 2, 'F');

        const radLength = Math.max(2, Math.round((gy - rxL_Y) / pixelsPerFoot - F - 2));
        if (rIdx === 0) {
          doc.setTextColor(6, 182, 212);
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(7);
          doc.text(`${radLength}' (Radius Cable)`, pt.x1 - 6, (pt.y1 + pt.y2) / 2, { align: 'right' });
        }
      });
    }
  }

  // 9. Dimensioning Arrows & Labels
  doc.setDrawColor(115, 115, 115);
  doc.setLineWidth(0.5);
  doc.setTextColor(115, 115, 115);
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(7);

  // Diameter dimension line
  const dDimY = gy + 30;
  doc.line(mapX(wl), mapY(dDimY), mapX(wr), mapY(dDimY));
  doc.line(mapX(wl), mapY(dDimY), mapX(wl + 5), mapY(dDimY - 2));
  doc.line(mapX(wl), mapY(dDimY), mapX(wl + 5), mapY(dDimY + 2));
  doc.line(mapX(wr), mapY(dDimY), mapX(wr - 5), mapY(dDimY - 2));
  doc.line(mapX(wr), mapY(dDimY), mapX(wr - 5), mapY(dDimY + 2));
  doc.text(`DIAMETER: ${D} FT`, mapX(cx), mapY(dDimY + 10), { align: 'center' });

  // Eave Height dimension line
  const eDimX = wr + 30;
  doc.line(mapX(eDimX), mapY(gy), mapX(eDimX), mapY(ey));
  doc.line(mapX(eDimX), mapY(gy), mapX(eDimX - 2), mapY(gy - 5));
  doc.line(mapX(eDimX), mapY(gy), mapX(eDimX + 2), mapY(gy - 5));
  doc.line(mapX(eDimX), mapY(ey), mapX(eDimX - 2), mapY(ey + 5));
  doc.line(mapX(eDimX), mapY(ey), mapX(eDimX + 2), mapY(ey + 5));
  doc.text(`EAVE: ${E} FT`, mapX(eDimX + 5), mapY((gy + ey) / 2 + 3));

  // Total Height dimension line
  const tDimX = wl - 30;
  doc.line(mapX(tDimX), mapY(gy), mapX(tDimX), mapY(py));
  doc.line(mapX(tDimX), mapY(gy), mapX(tDimX - 2), mapY(gy - 5));
  doc.line(mapX(tDimX), mapY(gy), mapX(tDimX + 2), mapY(gy - 5));
  doc.line(mapX(tDimX), mapY(py), mapX(tDimX - 2), mapY(py + 5));
  doc.line(mapX(tDimX), mapY(py), mapX(tDimX + 2), mapY(py + 5));
  doc.text(`TOTAL: ${H} FT`, mapX(tDimX - 5), mapY((gy + py) / 2 + 3), { align: 'right' });
}

/**
 * Main entrance to build a comprehensive landscape PDF report containing:
 * - Stunning blueprint-integrated cover page
 * - 2D Site Layout maps
 * - Technical directory databases
 * - Vector blueprints for each storage asset
 */
export async function generateUnifiedPDF(
  project: Project,
  callbacks: PDFGeneratorCallbacks,
  options?: PDFGeneratorOptions
) {
  const { setLoading, setLoadingText } = callbacks;
  setLoading(true);
  setLoadingText('Initializing Unified Suite PDF Generation...');

  try {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();

    const title = project.name || 'Grain Site Layout';
    const customerName = project.customer.name || 'Unnamed Customer';
    const customerPhone = project.customer.phone || 'No Phone';
    const customerEmail = project.customer.email || 'No Email';
    const customerLocation = project.customer.location || 'No Location Provided';
    const date = project.date || new Date().toLocaleDateString();

    const totalYards = project.yards.length;
    let totalBins = 0;
    let totalZones = 0;
    let totalCap = 0;
    let totalCables = 0;

    let totalChesterX = 0;
    let totalChesterX1 = 0;

    project.yards.forEach((y) => {
      y.bins.forEach((b) => {
        if (b.type === 'bin') {
          totalBins++;
          const D = parseFloat(b.diameter) || 0;
          const H = parseFloat(b.totalHeight) || 0;
          const E = parseFloat(b.eaveHeight) || 0;
          const F = parseFloat(b.floorThick) || 0;
          totalCap += Math.round(
            Math.PI * Math.pow(D / 2, 2) * (Math.max(0, E - F) + (H - E) / 3) * 0.80356
          );
          const rec = getCableRecommendation(b.diameter);
          totalCables += rec.center + rec.radius;
        } else if (b.type === 'zone') {
          totalZones++;
        } else if (b.type === 'chester-x') {
          totalChesterX++;
        } else if (b.type === 'chester-x1') {
          totalChesterX1++;
        }
      });
    });

    const totalSheets = 1 + totalYards * (options?.includeAssetDirectory ? 2 : 1);

    // ==========================================
    // PAGE 1: PROJECT COVER
    // ==========================================
    setLoadingText('Writing Sheet 1: Cover & Summary...');
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pw, ph, 'F');

    // Title Block
    doc.setTextColor(217, 119, 6); // Orange-amber
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(24);
    doc.text('GRAINLINK SITE PLAN', 50, 60);

    doc.setFontSize(9.5);
    doc.setTextColor(110, 110, 110);
    doc.text(`SHEET 1 OF ${totalSheets} (PROJECT COVER)`, pw - 50, 60, { align: 'right' });

    // Horizontal Accent Line
    doc.setDrawColor(217, 119, 6);
    doc.setLineWidth(1.5);
    doc.line(50, 85, pw - 50, 85);

    // Left Column: Customer Dossier
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.setFont('Helvetica', 'bold');
    doc.text('CUSTOMER INFORMATION', 50, 115);

    doc.setDrawColor(230, 230, 235);
    doc.setLineWidth(0.5);
    doc.line(50, 120, 460, 120);

    const dossierY = 135;
    doc.setFontSize(9.5);
    doc.setTextColor(50, 50, 50);

    doc.setFont('Helvetica', 'normal');
    doc.text('Project Name:', 50, dossierY);
    doc.setFont('Helvetica', 'bold');
    doc.text(title.toUpperCase(), 130, dossierY);

    doc.setFont('Helvetica', 'normal');
    doc.text('Customer Name:', 50, dossierY + 16);
    doc.setFont('Helvetica', 'bold');
    doc.text(customerName, 130, dossierY + 16);

    doc.setFont('Helvetica', 'normal');
    doc.text('Contact Phone:', 50, dossierY + 32);
    doc.setFont('Helvetica', 'bold');
    doc.text(customerPhone, 130, dossierY + 32);

    doc.setFont('Helvetica', 'normal');
    doc.text('Contact Email:', 50, dossierY + 48);
    doc.setFont('Helvetica', 'bold');
    doc.text(customerEmail, 130, dossierY + 48);

    doc.setFont('Helvetica', 'normal');
    doc.text('Yard Location:', 50, dossierY + 64);
    doc.setFont('Helvetica', 'bold');
    doc.text(customerLocation, 130, dossierY + 64);

    doc.setFont('Helvetica', 'normal');
    doc.text('Generated Date:', 50, dossierY + 80);
    doc.setFont('Helvetica', 'bold');
    doc.text(date, 130, dossierY + 80);

    // Left Column: Statistics Block
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.setFont('Helvetica', 'bold');
    doc.text('PROJECT METRICS & YARD STATISTICS', 50, 245);
    doc.line(50, 250, 460, 250);

    const drawMetricCard = (mx: number, my: number, mw: number, mh: number, label: string, val: string) => {
      doc.setFillColor(248, 248, 250);
      doc.rect(mx, my, mw, mh, 'F');
      doc.setDrawColor(225, 225, 228);
      doc.rect(mx, my, mw, mh, 'S');

      doc.setTextColor(110, 110, 110);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.text(label, mx + 10, my + 14);

      doc.setTextColor(0, 0, 0);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(val, mx + 10, my + 30);
    };

    drawMetricCard(50, 260, 126, 40, 'TOTAL PLANNED YARDS', `${totalYards}`);
    drawMetricCard(191, 260, 126, 40, 'CHESTER-X PLACED', `${totalChesterX}`);
    drawMetricCard(332, 260, 128, 40, 'CHESTER-X1 PLACED', `${totalChesterX1}`);

    // Left Column: Yards Directory
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.setFont('Helvetica', 'bold');
    doc.text('YARDS DIRECTORY REGISTER', 50, 365);
    doc.line(50, 370, 460, 370);

    const dirTableRows = project.yards.map((y) => {
      const yardBins = y.bins.filter((b) => b.type === 'bin') as BinAsset[];
      return [
        y.name,
        `${yardBins.length}`,
      ];
    });

    autoTable(doc, {
      startY: 380,
      head: [
        [
          'Yard Location Name',
          'Bin Count',
        ],
      ],
      body: dirTableRows,
      theme: 'grid',
      styles: {
        fillColor: [255, 255, 255],
        textColor: [40, 40, 40],
        fontSize: 8,
        cellPadding: 6,
        lineColor: [225, 225, 228],
      },
      headStyles: { fillColor: [217, 119, 6], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 252] },
      margin: { left: 50, right: pw - 460 },
    });

    // Right Column: Recommended Cable Arrangement Card
    doc.setFillColor(248, 248, 250);
    doc.rect(485, 115, 307, 425, 'F');
    doc.setDrawColor(220, 220, 225);
    doc.setLineWidth(1);
    doc.rect(485, 115, 307, 425, 'S');

    // Header inside the card
    doc.setFillColor(217, 119, 6); // amber-600
    doc.rect(485, 115, 307, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('RECOMMENDED CABLE ARRANGEMENT', 485 + 15, 115 + 19);

    // Divider lines
    doc.setDrawColor(220, 220, 225);
    doc.setLineWidth(1);
    doc.line(485 + 153.5, 145, 485 + 153.5, 540); // Vertical divider
    doc.line(485, 145 + 197.5, 792, 145 + 197.5); // Horizontal divider

    const drawArrangementCell = (
      cx: number,
      cy: number,
      cellTitle: string,
      description: string,
      patternType: 'center' | 'radius3' | 'center-radius3' | 'center-radius4'
    ) => {
      // Title
      doc.setTextColor(80, 80, 80);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(cellTitle, cx, cy - 65, { align: 'center' });

      // Bin circle outline
      doc.setFillColor(252, 252, 253);
      doc.setDrawColor(217, 119, 6); // amber-600
      doc.setLineWidth(1.5);
      doc.circle(cx, cy - 15, 30, 'FD');

      // Cable markers
      doc.setFillColor(217, 119, 6); // amber
      doc.setDrawColor(217, 119, 6);
      doc.setLineWidth(0.8);

      if (patternType === 'center') {
        doc.circle(cx, cy - 15, 4, 'F');
      } else if (patternType === 'radius3') {
        const r = 18;
        for (let i = 0; i < 3; i++) {
          const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
          const px = cx + r * Math.cos(angle);
          const py = (cy - 15) + r * Math.sin(angle);
          doc.line(cx, cy - 15, px, py);
          doc.circle(px, py, 3.5, 'F');
        }
      } else if (patternType === 'center-radius3') {
        doc.circle(cx, cy - 15, 4.5, 'F'); // Center cable
        const r = 18;
        for (let i = 0; i < 3; i++) {
          const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
          const px = cx + r * Math.cos(angle);
          const py = (cy - 15) + r * Math.sin(angle);
          doc.line(cx, cy - 15, px, py);
          doc.circle(px, py, 3.5, 'F');
        }
      } else if (patternType === 'center-radius4') {
        doc.circle(cx, cy - 15, 4.5, 'F'); // Center cable
        const r = 18;
        for (let i = 0; i < 4; i++) {
          const angle = (i * 2 * Math.PI) / 4;
          const px = cx + r * Math.cos(angle);
          const py = (cy - 15) + r * Math.sin(angle);
          doc.line(cx, cy - 15, px, py);
          doc.circle(px, py, 3.5, 'F');
        }
      }

      // Description text
      doc.setTextColor(217, 119, 6);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(description, cx, cy + 32, { align: 'center' });
    };

    // Render cells in 2x2 grid
    drawArrangementCell(561.75, 235, 'LESS THAN 24 FT', '1 Center Cable', 'center');
    drawArrangementCell(715.25, 235, '24 FT TO 35 FT', '3 Radius Cables', 'radius3');
    drawArrangementCell(561.75, 430, '36 FT TO 41 FT', '1 Center + 3 Radius', 'center-radius3');
    drawArrangementCell(715.25, 430, '42 FT TO 47 FT+', '1 Center + 4 Radius', 'center-radius4');

    let currentSheetIdx = 1;
    const BASE_SCALE = 3.0;

    // ==========================================
    // LOOP THROUGH SITES/YARDS
    // ==========================================
    for (let yIdx = 0; yIdx < project.yards.length; yIdx++) {
      const yard = project.yards[yIdx];

      // --- YARD PAGE 1: 2D MAP LAYOUT ---
      currentSheetIdx++;
      setLoadingText(`Drawing Map Layout for ${yard.name}...`);

      doc.addPage();
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, pw, ph, 'F');

      doc.setTextColor(217, 119, 6);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(20);
      doc.text(`${yard.name.toUpperCase()} - SITE LAYOUT PLAN`, 50, 60);

      doc.setFontSize(9);
      doc.setTextColor(110, 110, 110);
      doc.text(
        `CUSTOMER: ${customerName.toUpperCase()} | PROJECT: ${title.toUpperCase()}`,
        50,
        80
      );
      doc.text(`SHEET: ${currentSheetIdx} OF ${totalSheets} (LAYOUT MAP)`, pw - 130, 60, { align: 'right' });

      // Draw North compass icon
      const cX = pw - 60;
      const cY = 65;
      doc.setLineWidth(1.5);
      doc.setDrawColor(80, 80, 80);
      doc.circle(cX, cY, 15, 'S');
      doc.line(cX, cY + 10, cX, cY - 10);
      doc.setFillColor(80, 80, 80);
      doc.triangle(cX - 4, cY - 2, cX + 4, cY - 2, cX, cY - 11, 'F');
      doc.setFontSize(8);
      doc.text('N', cX - 3, cY - 18);

      // Draw legend
      const lgX = 50;
      const lgY = ph - 55;
      doc.setLineWidth(1);
      doc.setDrawColor(210, 210, 210);
      doc.setFillColor(252, 252, 253);
      doc.rect(lgX, lgY, 450, 35, 'FD');

      doc.setLineWidth(1.5);
      doc.setDrawColor(220, 38, 38);
      doc.line(lgX + 10, lgY + 10, lgX + 20, lgY + 25);
      doc.line(lgX + 20, lgY + 10, lgX + 10, lgY + 25);
      doc.setTextColor(50, 50, 50);
      doc.setFont('Helvetica', 'bold');
      doc.text('Chester-X', lgX + 25, lgY + 20);

      doc.setDrawColor(37, 99, 235);
      doc.line(lgX + 115, lgY + 10, lgX + 125, lgY + 25);
      doc.line(lgX + 125, lgY + 10, lgX + 115, lgY + 25);
      doc.text('Chester-X1', lgX + 130, lgY + 20);

      doc.setDrawColor(16, 185, 129);
      doc.line(lgX + 220, lgY + 10, lgX + 230, lgY + 25);
      doc.line(lgX + 230, lgY + 10, lgX + 220, lgY + 25);
      doc.text('Junction Box', lgX + 235, lgY + 20);

      doc.setDrawColor(168, 85, 247);
      doc.line(lgX + 330, lgY + 10, lgX + 340, lgY + 25);
      doc.line(lgX + 340, lgY + 10, lgX + 330, lgY + 25);
      doc.text('Fan Control', lgX + 345, lgY + 20);

      if (yard.bins.length > 0) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        yard.bins.forEach((b) => {
          const dimensionValue =
            b.type === 'zone'
              ? Math.max(parseFloat(b.width), parseFloat(b.height))
              : parseFloat(b.diameter);
          const r = (dimensionValue / 2) * BASE_SCALE;
          minX = Math.min(minX, b.x - r);
          minY = Math.min(minY, b.y - r);
          maxX = Math.max(maxX, b.x + r);
          maxY = Math.max(maxY, b.y + r);
        });

        const contentW = maxX - minX;
        const contentH = maxY - minY;
        const pdfAreaY = 110;
        const pdfAreaH = ph - pdfAreaY - 70;
        const pdfAreaW = pw - 100;

        const pdfScale = Math.min(pdfAreaW / contentW, pdfAreaH / contentH, 1.2);
        const offsetX = 50 + (pdfAreaW - contentW * pdfScale) / 2 - minX * pdfScale;
        const offsetY = pdfAreaY + (pdfAreaH - contentH * pdfScale) / 2 - minY * pdfScale;

        // Grid dots background
        doc.setDrawColor(230, 230, 230);
        for (let gx = 50; gx < pw - 50; gx += 30) {
          for (let gy = pdfAreaY; gy < ph - 70; gy += 30) {
            doc.circle(gx, gy, 0.4, 'F');
          }
        }

        yard.bins.forEach((bin) => {
          if (bin.type === 'zone') {
            const w = (parseFloat(bin.width) || 20) * BASE_SCALE * pdfScale;
            const h = (parseFloat(bin.height) || 20) * BASE_SCALE * pdfScale;
            const px = bin.x * pdfScale + offsetX;
            const py = bin.y * pdfScale + offsetY;

            doc.setLineWidth(1.5);
            doc.setDrawColor(180, 83, 9);
            (doc as any).setLineDash([4, 4]);
            doc.rect(px - w / 2, py - h / 2, w, h, 'S');
            (doc as any).setLineDash([]);

            if (bin.name) {
              doc.setTextColor(80, 80, 80);
              doc.setFontSize(Math.max(6, 8 * pdfScale));
              doc.text(bin.name, px - w / 2 + 4, py - h / 2 + 10);
            }
            return;
          }

          const d = parseFloat(bin.diameter) || 10;
          const r = (d / 2) * BASE_SCALE * pdfScale;
          const px = bin.x * pdfScale + offsetX;
          const py = bin.y * pdfScale + offsetY;

          if (bin.type === 'chester-x' || bin.type === 'chester-x1' || bin.type === 'junction-box' || bin.type === 'fan-control') {
            doc.setLineWidth(2.5);
            if (bin.type === 'chester-x') {
              doc.setDrawColor(220, 38, 38);
            } else if (bin.type === 'chester-x1') {
              doc.setDrawColor(37, 99, 235);
            } else if (bin.type === 'junction-box') {
              doc.setDrawColor(16, 185, 129); // Green/Emerald
            } else {
              doc.setDrawColor(168, 85, 247); // Purple/Violet for Fan Control
            }
            doc.line(px - r, py - r, px + r, py + r);
            doc.line(px + r, py - r, px - r, py + r);
          } else {
            doc.setLineWidth(1.5);
            doc.setDrawColor(180, 83, 9);
            doc.setFillColor(245, 245, 245);
            doc.circle(px, py, r, 'FD');

            if (bin.name) {
              doc.setTextColor(0, 0, 0);
              doc.setFontSize(Math.max(6, 8 * pdfScale));
              doc.text(bin.name, px, py + 2, { align: 'center' });
            }
          }
        });

        // Draw Wire Connections on PDF Layout
        const wires = yard.wires || [];
        wires.forEach((wire) => {
          const fromAsset = yard.bins.find((b) => b.id === wire.fromId);
          const toAsset = yard.bins.find((b) => b.id === wire.toId);
          if (!fromAsset || !toAsset) return;

          const p1x = fromAsset.x * pdfScale + offsetX;
          const p1y = fromAsset.y * pdfScale + offsetY;
          const p2x = toAsset.x * pdfScale + offsetX;
          const p2y = toAsset.y * pdfScale + offsetY;

          // Calculate control point for curved wires to bypass overlapping bins/markers
          const midX = (p1x + p2x) / 2;
          const midY = (p1y + p2y) / 2;

          const dx = p2x - p1x;
          const dy = p2y - p1y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const offset = Math.max(30 * pdfScale, len * 0.25);
          const px = -dy / (len || 1);
          const py = dx / (len || 1);

          const ctrlX = midX + px * offset;
          const ctrlY = midY + py * offset;

          doc.setLineWidth(1.0);
          doc.setDrawColor(147, 51, 234); // Purple/Violet wire line color
          if (typeof (doc as any).setLineDash === 'function') {
            (doc as any).setLineDash([3, 2]);
          }

          // Draw curved wire using short line segments for maximum compatibility
          const segments = 15;
          let lastX = p1x;
          let lastY = p1y;
          for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const cx = (1 - t) * (1 - t) * p1x + 2 * (1 - t) * t * ctrlX + t * t * p2x;
            const cy = (1 - t) * (1 - t) * p1y + 2 * (1 - t) * t * ctrlY + t * t * p2y;
            doc.line(lastX, lastY, cx, cy);
            lastX = cx;
            lastY = cy;
          }

          if (typeof (doc as any).setLineDash === 'function') {
            (doc as any).setLineDash([]);
          }

          // Draw midpoint label pill on the curved trajectory (t = 0.5)
          const curveMidX = 0.25 * p1x + 0.5 * ctrlX + 0.25 * p2x;
          const curveMidY = 0.25 * p1y + 0.5 * ctrlY + 0.25 * p2y;

          doc.setFontSize(5);
          doc.setTextColor(147, 51, 234);
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(147, 51, 234);
          doc.setLineWidth(0.3);

          const labelText = wire.label || 'Wire';
          const txtW = (doc as any).getTextWidth ? (doc as any).getTextWidth(labelText) : 10;
          doc.rect(curveMidX - txtW / 2 - 1.5, curveMidY - 3, txtW + 3, 6, 'FD');
          doc.text(labelText, curveMidX, curveMidY + 1.2, { align: 'center' });
        });
      }

      if (options?.includeAssetDirectory) {
        // --- YARD PAGE 2: ASSETS REGISTER TABLE ---
        currentSheetIdx++;
        setLoadingText(`Compiling asset registry for ${yard.name}...`);

        doc.addPage();
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pw, ph, 'F');

        doc.setTextColor(217, 119, 6);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(20);
        doc.text(`${yard.name.toUpperCase()} - ASSETS DIRECTORY`, 50, 60);

        doc.setFontSize(9);
        doc.setTextColor(110, 110, 110);
        doc.text(
          `CUSTOMER: ${customerName.toUpperCase()} | PROJECT: ${title.toUpperCase()}`,
          50,
          80
        );
        doc.text(`SHEET: ${currentSheetIdx} OF ${totalSheets} (TECHNICAL DATA)`, pw - 50, 60, { align: 'right' });

        const getAssetPriority = (type: string) => {
          if (type === 'chester-x' || type === 'chester-x1') return 1;
          if (type === 'junction-box') return 2;
          if (type === 'fan-control') return 3;
          if (type === 'bin') return 4;
          if (type === 'zone') return 5;
          return 6;
        };

        const sortedBins = [...yard.bins].sort((a, b) => {
          return getAssetPriority(a.type) - getAssetPriority(b.type);
        });

        const specTableRows = sortedBins.map((b) => {
          const fallbackName =
            b.name ||
            (b.type === 'chester-x'
              ? 'Chester-X'
              : b.type === 'chester-x1'
              ? 'Chester-X1'
              : b.type === 'junction-box'
              ? 'Junction Box'
              : b.type === 'fan-control'
              ? 'Fan Control'
              : b.type === 'zone'
              ? 'Zone Box'
              : 'Standard Bin');

          if (b.type === 'chester-x' || b.type === 'chester-x1' || b.type === 'junction-box' || b.type === 'fan-control') {
            return [
              fallbackName,
              b.type === 'chester-x'
                ? 'Chester-X'
                : b.type === 'chester-x1'
                ? 'Chester-X1'
                : b.type === 'junction-box'
                ? 'Junction Box'
                : 'Fan Control',
              `${b.diameter}' Size`,
              '-',
              '-',
              '-',
              b.notes || '-',
            ];
          }
          if (b.type === 'zone') {
            return [fallbackName, 'Zone Box', `${b.width}' x ${b.height}'`, '-', '-', '-', b.notes || '-'];
          }

          const binB = b as BinAsset;
          const D = parseFloat(binB.diameter) || 0;
          const H = parseFloat(binB.totalHeight) || 0;
          const E = parseFloat(binB.eaveHeight) || 0;
          const F = parseFloat(binB.floorThick) || 0;
          const cap = Math.round(
            Math.PI * Math.pow(D / 2, 2) * (Math.max(0, E - F) + (H - E) / 3) * 0.80356
          );
          const rec = getCableRecommendation(binB.diameter);

          return [
            fallbackName,
            'Standard Bin',
            `${binB.diameter}' Dia`,
            `${cap.toLocaleString()} BU`,
            binB.centerCable ? `${binB.centerCable}'` : `${rec.center} (Rec)`,
            binB.radiusCable ? `${binB.radiusCable}'` : `${rec.radius} (Rec)`,
            binB.notes || '-',
          ];
        });

        // Add wire connections as assets in the directory table
        const specTableWires = yard.wires || [];
        specTableWires.forEach((wire) => {
          const fromAsset = yard.bins.find((b) => b.id === wire.fromId);
          const toAsset = yard.bins.find((b) => b.id === wire.toId);
          const routeStr = fromAsset && toAsset ? `${fromAsset.name} -> ${toAsset.name}` : '-';
          specTableRows.push([
            wire.label || 'Wire Line',
            'Wire Connection',
            routeStr,
            '-',
            '-',
            '-',
            'Connected wire/cable between elements.',
          ]);
        });

        autoTable(doc, {
          startY: 110,
          head: [
            [
              'Asset Label',
              'Asset Type',
              'Dimensions',
              'Capacity',
              'Center Cable',
              'Radius Cable',
              'Technical Notes',
            ],
          ],
          body: specTableRows,
          theme: 'grid',
          styles: {
            fillColor: [255, 255, 255],
            textColor: [40, 40, 40],
            fontSize: 8,
            cellPadding: 7,
            lineColor: [220, 220, 220],
          },
          headStyles: { fillColor: [217, 119, 6], textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [248, 248, 248] },
          columnStyles: {
            6: { cellWidth: 180 },
          },
          margin: { left: 50, right: 50 },
        });
      }
    }

    doc.save(`GrainLink_SitePlannerReport_${title.replace(/\s+/g, '_')}.pdf`);
    setLoading(false);
  } catch (err) {
    console.error(err);
    alert('An error occurred while compiling the unified PDF.');
    setLoading(false);
  }
}
