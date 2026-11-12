import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';

const unitLabel: Record<string, string> = {
  KG: 'кг',
  PCS: 'шт',
  M3: 'м³',
  L: 'л',
  M: 'м',
  M2: 'м²',
  PACK: 'упак',
  SET: 'набор',
  TON: 'т',
  KIT: 'компл',
  HOUR: 'час',
  BOX: 'кор',
  PALLET: 'поддон',
  SHEET: 'лист',
};

type PdfLine = {
  title: string;
  quantity: string;
  unit: string;
};

export type OrderPdfSection = {
  authorName: string;
  createdAtLabel: string;
  lines: PdfLine[];
};

export type OrderPdfInput = {
  project: string;
  sections: OrderPdfSection[];
};

function fontFile() {
  const candidates = [
    join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
    join(__dirname, '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error('Не найден шрифт для PDF');
  }
  return found;
}

function quantity(value: string) {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

export function renderOrderPdf(input: OrderPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const font = fontFile();
  const left = doc.page.margins.left;
  const contentWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font(font).fontSize(20).fillColor('#000000').text('Заявка');
  doc.moveDown(0.6);
  doc.fontSize(12).text(`Объект: ${input.project}`);

  input.sections.forEach((section, sectionIndex) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 72) {
      doc.addPage();
    }
    doc.moveDown(sectionIndex === 0 ? 0.8 : 1.2);
    doc.font(font).fontSize(12).fillColor('#000000');
    doc.text(`От: ${section.authorName}`);
    doc.text(`Дата: ${section.createdAtLabel}`);
    doc.moveDown(0.4);

    section.lines.forEach((line, index) => {
      const unit = unitLabel[line.unit] ?? line.unit;
      const qty = `${quantity(line.quantity)} ${unit}`;
      doc.font(font).fontSize(13).fillColor('#000000');
      const qtyWidth = doc.widthOfString(qty);
      if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
        doc.addPage();
      }
      const y = doc.y;
      doc.text(`${index + 1}. ${line.title}`, left, y, {
        width: contentWidth - qtyWidth - 16,
        lineBreak: false,
        ellipsis: true,
      });
      doc.text(qty, left + contentWidth - qtyWidth, y, {
        width: qtyWidth,
        align: 'right',
        lineBreak: false,
      });
      doc.x = left;
      doc.y = y + 20;
    });
  });

  doc.end();
  return done;
}
