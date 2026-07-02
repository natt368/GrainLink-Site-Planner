/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { Project, BinAsset, Asset } from '../types';

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

interface PDFGeneratorCallbacks {
  setLoading: (loading: boolean) => void;
  setLoadingText: (text: string) => void;
}

export async function generateUnifiedPDF(
  project: Project,
  callbacks: PDFGeneratorCallbacks
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
    const date = project.date || new Date().toLocaleDateString();

    const totalYards = project.yards.length;
    let totalBins = 0;
    let totalZones = 0;
    let totalCap = 0;
    let totalCables = 0;

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
        }
      });
    });

    const totalSheets = 1 + totalYards * 2 + totalBins;

    // PAGE 1: PROJECT COVER
    setLoadingText('Writing Sheet 1: Cover & Summary...');
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pw, ph, 'F');

    doc.setTextColor(217, 119, 6); // Orange-amber
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(26);
    doc.text('GRAINLINK MULTI-YARD SITE REPORT', 50, 60);

    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text(`PROJECT NAME: ${title.toUpperCase()}`, 50, 85);
    doc.text(`CUSTOMER: ${customerName.toUpperCase()}`, 50, 97);
    doc.text(`PHONE: ${customerPhone}`, 50, 109);
    doc.text(`GENERATED DATE: ${date}`, 50, 121);

    doc.text(`SHEET 1 OF ${totalSheets}`, pw - 120, 60);

    // Render Stats boxes
    doc.setFillColor(245, 245, 247);
    doc.rect(50, 140, 160, 60, 'F');
    doc.rect(230, 140, 160, 60, 'F');
    doc.rect(410, 140, 160, 60, 'F');
    doc.rect(590, 140, 160, 60, 'F');

    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text('TOTAL PLANNED YARDS', 60, 158);
    doc.text('COMBINED STORAGE', 240, 158);
    doc.text('TOTAL ASSETS REGISTERED', 420, 158);
    doc.text('ESTIMATED CABLES NEEDED', 600, 158);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.text(`${totalYards}`, 60, 185);
    doc.text(`${totalCap.toLocaleString()} BU`, 240, 185);
    doc.text(`${totalBins + totalZones} Units`, 420, 185);
    doc.text(`${totalCables} Cables`, 600, 185);

    doc.setFontSize(12);
    doc.setTextColor(217, 119, 6);
    doc.text('YARDS REGISTER SUMMARY', 50, 240);

    const dirTableRows = project.yards.map((y) => {
      const yardBins = y.bins.filter((b) => b.type === 'bin') as BinAsset[];
      let yardCap = 0;
      let yardCables = 0;

      yardBins.forEach((b) => {
        const D = parseFloat(b.diameter) || 0;
        const H = parseFloat(b.totalHeight) || 0;
        const E = parseFloat(b.eaveHeight) || 0;
        const F = parseFloat(b.floorThick) || 0;
        yardCap += Math.round(
          Math.PI * Math.pow(D / 2, 2) * (Math.max(0, E - F) + (H - E) / 3) * 0.80356
        );
        const rec = getCableRecommendation(b.diameter);
        yardCables += rec.center + rec.radius;
      });

      return [
        y.name,
        `${yardBins.length} Bins`,
        `${y.bins.filter((b) => b.type === 'zone').length} Zones`,
        `${y.bins.filter((b) => b.type !== 'bin' && b.type !== 'zone').length} Markers`,
        `${yardCap.toLocaleString()} BU`,
        `${yardCables} Cables`,
      ];
    });

    autoTable(doc, {
      startY: 255,
      head: [
        [
          'Yard Location',
          'Bin Count',
          'Zone Boxes',
          'Special Markers',
          'Storage Capacity',
          'Cables Required',
        ],
      ],
      body: dirTableRows,
      theme: 'grid',
      styles: {
        fillColor: [255, 255, 255],
        textColor: [40, 40, 40],
        fontSize: 8.5,
        cellPadding: 7,
        lineColor: [220, 220, 220],
      },
      headStyles: { fillColor: [251, 191, 36], textColor: [0, 0, 0], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      margin: { left: 50, right: 50 },
    });

    let currentSheetIdx = 1;
    const BASE_SCALE = 3.0;

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
      doc.text(`SHEET: ${currentSheetIdx} OF ${totalSheets} (LAYOUT MAP)`, pw - 180, 60);

      // Draw North compass icon
      const cX = pw - 80;
      const cY = 75;
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
      doc.setFillColor(252, 252, 252);
      doc.rect(lgX, lgY, 345, 35, 'FD');

      doc.setLineWidth(1.5);
      doc.setDrawColor(220, 38, 38);
      doc.line(lgX + 10, lgY + 10, lgX + 20, lgY + 25);
      doc.line(lgX + 20, lgY + 10, lgX + 10, lgY + 25);
      doc.setTextColor(50, 50, 50);
      doc.text('Chester-X', lgX + 25, lgY + 20);

      doc.setDrawColor(37, 99, 235);
      doc.line(lgX + 115, lgY + 10, lgX + 125, lgY + 25);
      doc.line(lgX + 125, lgY + 10, lgX + 115, lgY + 25);
      doc.text('Chester-X1', lgX + 130, lgY + 20);

      doc.setDrawColor(16, 185, 129);
      doc.line(lgX + 220, lgY + 10, lgX + 230, lgY + 25);
      doc.line(lgX + 230, lgY + 10, lgX + 220, lgY + 25);
      doc.text('Junction Box', lgX + 235, lgY + 20);

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
        for (let x = 50; x < pw - 50; x += 30) {
          for (let y = pdfAreaY; y < ph - 70; y += 30) {
            doc.circle(x, y, 0.4, 'F');
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

          if (bin.type === 'chester-x' || bin.type === 'chester-x1' || bin.type === 'junction-box') {
            doc.setLineWidth(2.5);
            if (bin.type === 'chester-x') {
              doc.setDrawColor(220, 38, 38);
            } else if (bin.type === 'chester-x1') {
              doc.setDrawColor(37, 99, 235);
            } else {
              doc.setDrawColor(16, 185, 129); // Green/Emerald
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
      }

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
      doc.text(`SHEET: ${currentSheetIdx} OF ${totalSheets} (TECHNICAL DATA)`, pw - 180, 60);

      const specTableRows = yard.bins.map((b) => {
        const fallbackName =
          b.name ||
          (b.type === 'chester-x'
            ? 'Chester-X'
            : b.type === 'chester-x1'
            ? 'Chester-X1'
            : b.type === 'junction-box'
            ? 'Junction Box'
            : 'Standard Bin');

        if (b.type === 'chester-x' || b.type === 'chester-x1' || b.type === 'junction-box') {
          return [
            fallbackName,
            b.type === 'chester-x'
              ? 'Chester-X'
              : b.type === 'chester-x1'
              ? 'Chester-X1'
              : 'Junction Box',
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
        headStyles: { fillColor: [251, 191, 36], textColor: [0, 0, 0], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: {
          6: { cellWidth: 180 },
        },
        margin: { left: 50, right: 50 },
      });
    }

    // Capture the blueprint diagram for each bin
    const yardBins = project.yards.flatMap((y) =>
      y.bins.filter((b) => b.type === 'bin').map((b) => ({ yardName: y.name, bin: b as BinAsset }))
    );

    const renderZone = document.getElementById('pdf-render-zone');

    for (let bIdx = 0; bIdx < yardBins.length; bIdx++) {
      const { yardName, bin } = yardBins[bIdx];
      currentSheetIdx++;
      setLoadingText(
        `Rendering cross-section blueprint for ${yardName} -> ${bin.name}...`
      );

      doc.addPage();
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, pw, ph, 'F');

      doc.setTextColor(217, 119, 6);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(`${yardName.toUpperCase()} - ${bin.name.toUpperCase()} BLUEPRINT`, 50, 50);

      doc.setFontSize(9);
      doc.setTextColor(110, 110, 110);
      doc.text(`CUSTOMER: ${customerName.toUpperCase()} | PROJECT ID: ${title.toUpperCase()}`, 50, 70);
      doc.text(`SHEET: ${currentSheetIdx} OF ${totalSheets}`, pw - 120, 50);

      // We clone the current SVG element from the DOM
      const originalSvg = document.getElementById('bin-svg');
      if (originalSvg && renderZone) {
        renderZone.innerHTML = '';
        const svgClone = originalSvg.cloneNode(true) as HTMLElement;
        svgClone.style.width = '420px';
        svgClone.style.height = '480px';
        svgClone.style.backgroundColor = '#050505';
        renderZone.appendChild(svgClone);

        await new Promise((r) => setTimeout(r, 150));
        const canvasSVG = await html2canvas(svgClone, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#050505',
        });

        const imgData = canvasSVG.toDataURL('image/png');

        const dx = 50;
        const dy = 100;

        doc.setFillColor(248, 248, 250);
        doc.rect(dx, dy, 280, 420, 'F');

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.setFont('Helvetica', 'bold');
        doc.text('ENGINEERING SPECIFICATIONS', dx + 20, dy + 30);

        doc.setFontSize(8.5);
        doc.setFont('Helvetica', 'normal');
        doc.setTextColor(80, 80, 80);

        let sy = dy + 65;
        const drawSpecLine = (label: string, val: string | number) => {
          doc.setFont('Helvetica', 'bold');
          doc.text(label, dx + 20, sy);
          doc.setFont('Helvetica', 'normal');
          doc.text(val.toString(), dx + 150, sy);
          doc.setDrawColor(220, 220, 222);
          doc.line(dx + 20, sy + 6, dx + 260, sy + 6);
          sy += 25;
        };

        const D = parseFloat(bin.diameter) || 0;
        const H = parseFloat(bin.totalHeight) || 0;
        const E = parseFloat(bin.eaveHeight) || 0;
        const F = parseFloat(bin.floorThick) || 0;
        const cap = Math.round(
          Math.PI * Math.pow(D / 2, 2) * (Math.max(0, E - F) + (H - E) / 3) * 0.80356
        );
        const rec = getCableRecommendation(bin.diameter);

        drawSpecLine('Yard Location:', yardName);
        drawSpecLine('Unit Label:', bin.name);
        drawSpecLine('Diameter:', `${D} FT`);
        drawSpecLine('Rings Count:', bin.rings || '-');
        drawSpecLine('Eave Height:', `${E} FT`);
        drawSpecLine('Total Height:', `${H} FT`);
        drawSpecLine('Floor thickness:', `${F} FT`);
        drawSpecLine('Capacity:', `${cap.toLocaleString()} BU`);
        drawSpecLine('Recommended Cables:', `${rec.center + rec.radius} Total`);
        drawSpecLine('Calculated Center:', bin.centerCable ? `${bin.centerCable} FT` : '-');
        drawSpecLine('Calculated Radius:', bin.radiusCable ? `${bin.radiusCable} FT` : '-');

        doc.setFont('Helvetica', 'bold');
        doc.text('Technical Notes:', dx + 20, sy + 10);
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(8);
        const splitNotes = doc.splitTextToSize(bin.notes || 'No custom notes.', 240);
        doc.text(splitNotes, dx + 20, sy + 25);

        doc.setFillColor(5, 5, 5);
        doc.rect(360, dy, 430, 420, 'F');
        doc.addImage(imgData, 'PNG', 365, dy + 10, 420, 400);
      }
    }

    doc.save(`GrainLink_CustomerReport_${customerName.replace(/\s+/g, '_')}.pdf`);
    if (renderZone) {
      renderZone.innerHTML = '';
    }
    setLoading(false);
  } catch (err) {
    console.error(err);
    alert('An error occurred while compiling the unified PDF.');
    setLoading(false);
  }
}
