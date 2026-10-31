import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export function makePdf({ title, subtitle, school, head, body, filename, orientation = 'portrait', footer }) {
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'letter' });
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(11, 11, 26); doc.rect(0, 0, w, 74, 'F');
  doc.setFillColor(124, 92, 255); doc.rect(0, 74, w, 3, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.text(school || 'Colegio', 40, 34);
  doc.setFontSize(11); doc.setTextColor(180, 190, 255); doc.text(title, 40, 54);
  doc.setTextColor(60, 60, 80); doc.setFontSize(10);
  if (subtitle) doc.text(doc.splitTextToSize(subtitle, w - 80), 40, 100);
  autoTable(doc, {
    startY: subtitle ? 118 : 96, head: [head], body,
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [124, 92, 255], textColor: 255 },
    alternateRowStyles: { fillColor: [244, 243, 255] },
    margin: { left: 40, right: 40 },
  });
  const y = doc.lastAutoTable.finalY + 24;
  if (footer) { doc.setFontSize(9); doc.text(doc.splitTextToSize(footer, w - 80), 40, y); }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`Generado el ${new Date().toLocaleString('es-CO')} · Página ${i} de ${pages}`, 40, doc.internal.pageSize.getHeight() - 20);
  }
  doc.save(filename);
}
