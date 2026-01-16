import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Document, Customer, CompanySettings, DocType } from '../types';
import { formatCurrency, amountToWords, DOC_META } from '../constants';

const safeStr = (val: any, fallback: string = ''): string => {
  if (val === null || val === undefined) return fallback;
  return String(val);
};

export const generateDocumentPDF = (doc: Document, customer: Customer, settings: CompanySettings) => {
  const docPdf = new jsPDF();
  const meta = DOC_META[doc.type] || DOC_META[DocType.INVOICE];
  const isDO = doc.type === DocType.DELIVERY_ORDER;

  // --- 1. Header & Logo (保持原样) ---
  let headerStartY = 20;
  if (settings.logo) {
    try {
      docPdf.addImage(settings.logo, 'PNG', 20, 10, 25, 20, undefined, 'FAST');
      headerStartY = 35;
    } catch (e) { console.error(e); }
  }

  // Company Info
  docPdf.setFontSize(18).setTextColor(30, 41, 59).text(safeStr(settings.name), 20, headerStartY);
  docPdf.setFontSize(8).setTextColor(71, 85, 105).text(`(SSM: ${safeStr(settings.ssmNumber)})`, 20, headerStartY + 5);
  
  if (settings.sstRegNo) {
     docPdf.text(`SST ID: ${safeStr(settings.sstRegNo)}`, 20, headerStartY + 9);
  }

  const addrLines = docPdf.splitTextToSize(safeStr(settings.address), 75);
  docPdf.setFontSize(9).text(addrLines, 20, headerStartY + (settings.sstRegNo ? 14 : 10));
  
  const contactY = headerStartY + (settings.sstRegNo ? 14 : 10) + (addrLines.length * 4);
  docPdf.text(`Tel: ${safeStr(settings.phone)} | Email: ${safeStr(settings.email)}`, 20, contactY);

  // --- 2. Right Side Title (保持原样) ---
  docPdf.setFontSize(22).setTextColor(30, 41, 59).setFont('helvetica', 'bold');
  const title = meta.label.toUpperCase();
  docPdf.text(title, 190, headerStartY + 5, { align: 'right' });

  docPdf.setFontSize(10).setFont('helvetica', 'normal').setTextColor(71, 85, 105);
  docPdf.text(`No: ${safeStr(doc.number)}`, 190, headerStartY + 15, { align: 'right' });
  docPdf.text(`Date:   ${safeStr(doc.date)}`, 190, headerStartY + 20, { align: 'right' });

  // --- 3. BILL TO 区域 (✅ 保持：Attn 和 Tel 并列) ---
  
  docPdf.setFontSize(10).setFont('helvetica', 'bold').setTextColor(30, 41, 59);
  docPdf.text(isDO ? 'DELIVER TO:' : 'BILL TO:', 20, headerStartY + 35);

  docPdf.setFont('helvetica', 'bold'); 
  docPdf.text(safeStr(customer.name), 20, headerStartY + 40);

  docPdf.setFont('helvetica', 'normal'); 
  const custAddrLines = docPdf.splitTextToSize(safeStr(customer.address), 80);
  docPdf.text(custAddrLines, 20, headerStartY + 45);

  let custInfoY = headerStartY + 45 + (custAddrLines.length * 5); 

  // Attn 和 Tel 并列逻辑
  let contactLine = '';
  if (customer.attentionTo) {
      contactLine += `Attn: ${safeStr(customer.attentionTo)}`;
  }
  if (customer.phone) {
      if (contactLine) contactLine += '  '; 
      contactLine += `Tel: ${safeStr(customer.phone)}`;
  }

  if (contactLine) {
      docPdf.text(contactLine, 20, custInfoY);
      custInfoY += 5;
  }

  // --- 4. Table (✅ 保持：紧凑表格以容纳15行) ---
  
  // 保持间距：custInfoY + 10 (约2行)
  const tableStartY = Math.max(85, custInfoY + 10);

  const subtotal = doc.items.reduce((s, i) => s + (i.quantity * i.unitPrice), 0);
  const taxTotal = doc.items.reduce((s, i) => s + (i.quantity * i.unitPrice * (i.taxRate || 0)), 0);
  const grandTotal = subtotal + taxTotal - (doc.discount || 0);

  // 页面高度参数
  const pageHeight = docPdf.internal.pageSize.getHeight();
  const sigY = pageHeight - 65; // 保持底部 65mm 的签名空间

  autoTable(docPdf, {
    startY: tableStartY, 
    // 关键优化：底部 Margin 为 0，允许表格延伸
    margin: { bottom: 0 }, 
    // 关键优化：字体 8，Padding 1.5，节省垂直空间
    styles: { 
        fontSize: 8, 
        cellPadding: 1.5,
        valign: 'middle'
    },
    head: [['#', 'Description', 'Qty', isDO ? '' : 'Price', isDO ? '' : 'Tax', isDO ? '' : 'Total']],
    body: doc.items.map((item, idx) => [
      idx + 1, 
      item.description, 
      item.quantity, 
      !isDO ? formatCurrency(item.unitPrice) : '-',
      !isDO ? `${(item.taxRate * 100).toFixed(0)}%` : '-',
      !isDO ? formatCurrency(item.quantity * item.unitPrice) : '-'
    ]),
    theme: 'grid', 
    headStyles: { fillColor: [30, 41, 59], fontSize: 9, minCellHeight: 8 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 25, halign: 'right' },
      4: { cellWidth: 15, halign: 'center' },
      5: { cellWidth: 30, halign: 'right' }
    }
  });

  // @ts-ignore
  let finalY = docPdf.lastAutoTable.finalY + 10;
  
  // --- 5. Totals (保持原样) ---
  if (!isDO) {
    // 检查 Totals 是否会太靠近签名区 (保留 10mm 缓冲)
    if (finalY + 35 > sigY - 10) {
        docPdf.addPage();
        finalY = 20;
    }

    docPdf.setFontSize(5).setFont('helvetica', 'bold').setTextColor(30, 41, 59);
    docPdf.text(amountToWords(grandTotal), 20, finalY + 5);

    const labelX = 140; 
    const valueX = 190;
    
    docPdf.setFontSize(10);
    docPdf.text('Subtotal :', labelX, finalY);
    docPdf.text(formatCurrency(subtotal), valueX, finalY, { align: 'right' });

    docPdf.text('Tax Total :', labelX, finalY + 7);
    docPdf.text(formatCurrency(taxTotal), valueX, finalY + 7, { align: 'right' });

    if (doc.discount > 0) {
      docPdf.text('Discount :', labelX, finalY + 14);
      docPdf.text(`- ${formatCurrency(doc.discount)}`, valueX, finalY + 14, { align: 'right' });
    }

    docPdf.setFont('helvetica', 'bold').setFontSize(11);
    docPdf.text('TOTAL :', labelX, finalY + 22);
    docPdf.text(formatCurrency(grandTotal), valueX, finalY + 22, { align: 'right' });
    finalY += 35;
  }

  // --- 6. Footer & Signatures ---
  
  // ✅ 保持：Notes 并列显示逻辑
  if (doc.notes) {
    if (finalY > sigY - 10) { 
        docPdf.addPage(); 
        finalY = 20; 
    }
    
    // 1. 打印标签 "Notes:"
    docPdf.setFontSize(8).setFont('helvetica', 'bold');
    docPdf.text('Notes:', 20, finalY);
    
    // 2. 打印内容：紧接在标签后面 (加 1.5mm 间距)
    const labelWidth = docPdf.getTextWidth('Notes:');
    const contentX = 20 + labelWidth + 1.5; 
    const maxWidth = 190 - contentX;
    
    docPdf.setFont('helvetica', 'normal');
    const notesLines = docPdf.splitTextToSize(safeStr(doc.notes), maxWidth);
    docPdf.text(notesLines, contentX, finalY);
    
    finalY += (notesLines.length * 3.5); 
  }

  // 再次检查距离，确保和签名区有空隙
  if (finalY > sigY - 10) { 
      docPdf.addPage(); 
  }

  // ✅ 保持：签名区大空间逻辑
  docPdf.setFontSize(9).setFont('helvetica', 'bold');
  
  if (isDO || doc.type === DocType.QUOTATION) {
    docPdf.text(isDO ? 'RECEIVED BY:' : 'ACCEPTED BY:', 20, sigY);
    
    docPdf.line(20, sigY + 25, 85, sigY + 25); 
    
    docPdf.setFont('helvetica', 'normal').setFontSize(7);
    docPdf.text(isDO ? 'Authorized Signature & Stamp' : 'Authorized Signature & Chop', 20, sigY + 30);
    docPdf.text('Name / Date:', 20, sigY + 34);
  }

  if (!isDO && doc.type !== DocType.QUOTATION) {
     docPdf.text('PAYMENT INFO:', 20, sigY);
     docPdf.setFont('helvetica', 'normal').setFontSize(8);
     docPdf.text(`Bank: ${settings.bankName}`, 20, sigY + 5);
     docPdf.text(`Acc No: ${settings.bankAccount}`, 20, sigY + 10);
  }

  docPdf.setFont('helvetica', 'bold').setFontSize(9);
  docPdf.text('ISSUED BY:', 125, sigY);
  
  docPdf.line(125, sigY + 25, 190, sigY + 25);
  
  docPdf.setFont('helvetica', 'normal').setFontSize(7);
  docPdf.text(settings.name, 125, sigY + 30);

  docPdf.save(`${doc.type}_${doc.number}.pdf`);
};