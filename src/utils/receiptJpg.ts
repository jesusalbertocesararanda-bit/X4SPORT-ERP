import type { BrandIdentityConfig, SaleRecord } from '../types/erp';
import { DEFAULT_GENERAL_CONFIG, formatUSD, round2 } from './finance';
import { convertGoogleDriveUrlToDirect } from './publicCatalog';

export const X4SPORT_LOGO_SRC = '/assets/aistudio/image_992adf2a.jpg';

function loadLogoImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => {
      resolve(null);
    }, 2500);

    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function formatInvoiceSaleDate(sale: SaleRecord): string {
  const rawDate = sale.saleDate?.trim();
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const [y, m, d] = rawDate.split('-').map(Number);
    const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return utcDate.toLocaleDateString('es-VE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  return new Date(sale.createdAt).toLocaleDateString('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export async function renderSaleReceiptJpgDataUrl(
  sale: SaleRecord,
  _bcvRate?: number,
  brandConfig?: BrandIdentityConfig,
): Promise<string> {
  const brand = brandConfig ?? DEFAULT_GENERAL_CONFIG.brandIdentity;
  const resolvedLogoSrc = brand.logoUrl?.trim()
    ? convertGoogleDriveUrlToDirect(brand.logoUrl.trim())
    : X4SPORT_LOGO_SRC;
  const storeName = brand.storeName?.trim() || 'X4SPORT';
  const storeSubtitle = brand.storeSubtitle?.trim() || 'INDUMENTARIA DEPORTIVA';
  const storeLocation =
    brand.storeLocation?.trim() || 'Guacara, Edo. Carabobo · Venezuela';
  const footerMessage =
    brand.invoiceFooterMessage?.trim() || 'Gracias por comprar en X4SPORT';

  const lineItems =
    sale.items && sale.items.length > 0
      ? sale.items
      : [
          {
            skuId: sale.skuId,
            modelLabel: sale.modelLabel,
            team: sale.team,
            version: sale.version,
            size: sale.size,
            quantity: sale.quantity,
            unitCogs: sale.unitCogs,
            totalLineCogs: round2(sale.unitCogs * sale.quantity),
            unitPrice: round2(sale.finalPrice / Math.max(1, sale.quantity)),
            subtotal: sale.finalPrice,
          },
        ];

  const isCreditSale = sale.paymentStatus === 'Pendiente';
  const returnedAmount = round2(Math.max(0, sale.returnedAmount ?? 0));
  const hasReturn = returnedAmount > 0;
  const netFinalPrice = round2(Math.max(0, sale.finalPrice - returnedAmount));
  const paidAmount = round2(
    sale.paidAmount !== undefined
      ? sale.paidAmount
      : isCreditSale
        ? 0
        : netFinalPrice,
  );
  const pendingBalance = isCreditSale
    ? round2(Math.max(0, netFinalPrice - paidAmount))
    : 0;

  const width = 920;
  const pad = 40;
  const innerW = width - pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 980;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el lienzo para generar el comprobante JPG.');
  }

  // Pre-measure wrapped item titles before locking final canvas height
  ctx.font = '700 16px system-ui, -apple-system, sans-serif';
  const measuredRows = lineItems.map((item) => {
    const lines = wrapLines(ctx, item.modelLabel, innerW * 0.44).slice(0, 2);
    const rowH = lines.length > 1 ? 90 : 72;
    return { item, lines, rowH };
  });
  const rowsHeight = measuredRows.reduce((sum, r) => sum + r.rowH, 0);
  const splitExtraHeight =
    sale.paymentMethod === 'Pago Mixto' && sale.paymentSplits?.length
      ? sale.paymentSplits.length * 24 + 24
      : 0;
  const returnExtraHeight = hasReturn ? 28 : 0;
  const creditExtraHeight = isCreditSale ? 64 : 0;
  const height = Math.max(
    980,
    680 + rowsHeight + splitExtraHeight + returnExtraHeight + creditExtraHeight,
  );
  canvas.height = height;

  // Solid pure white background optimized for WhatsApp & printing
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Crisp subtle outer frame on white
  drawRoundedRect(ctx, 20, 20, width - 40, height - 40, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  // Top Header Area
  let logoImg = await loadLogoImage(resolvedLogoSrc);
  if (!logoImg && resolvedLogoSrc !== X4SPORT_LOGO_SRC) {
    logoImg = await loadLogoImage(X4SPORT_LOGO_SRC);
  }
  const logoSize = 96;
  const logoX = pad + 8;
  const logoY = pad + 8;

  ctx.save();
  drawRoundedRect(ctx, logoX, logoY, logoSize, logoSize, 16);
  ctx.clip();
  if (logoImg) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(logoX, logoY, logoSize, logoSize);
    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
  } else {
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(logoX, logoY, logoSize, logoSize);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 32px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      storeName.slice(0, 2).toUpperCase() || 'X4',
      logoX + logoSize / 2,
      logoY + logoSize / 2,
    );
  }
  ctx.restore();

  drawRoundedRect(ctx, logoX, logoY, logoSize, logoSize, 16);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  // Brand Title & Subtitle
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#0F172A';
  ctx.font = '800 32px system-ui, -apple-system, sans-serif';
  ctx.fillText(storeName, logoX + logoSize + 22, logoY + 38);

  ctx.fillStyle = '#2563EB';
  ctx.font = '700 14px system-ui, -apple-system, sans-serif';
  ctx.fillText(storeSubtitle, logoX + logoSize + 22, logoY + 62);

  ctx.fillStyle = '#475569';
  ctx.font = '500 14px system-ui, -apple-system, sans-serif';
  ctx.fillText(storeLocation, logoX + logoSize + 22, logoY + 86);

  // Invoice Number & Date Block (Top Right)
  const invoiceCode = sale.invoiceNumber || '#0001';
  const badgeW = 248;
  const badgeH = 96;
  const badgeX = width - pad - badgeW - 4;
  const badgeY = logoY;
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#475569';
  ctx.font = '700 12px system-ui, -apple-system, sans-serif';
  ctx.fillText('FACTURA DE COMPRA', badgeX + badgeW / 2, badgeY + 25);

  ctx.fillStyle = '#0F172A';
  ctx.font = '800 28px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(invoiceCode, badgeX + badgeW / 2, badgeY + 58);

  ctx.fillStyle = '#475569';
  ctx.font = '600 13px system-ui, -apple-system, sans-serif';
  ctx.fillText(formatInvoiceSaleDate(sale), badgeX + badgeW / 2, badgeY + 82);

  // Horizontal Accent Rule
  let cursorY = logoY + logoSize + 26;
  ctx.fillStyle = '#2563EB';
  ctx.fillRect(pad + 4, cursorY, innerW - 8, 3);
  cursorY += 24;

  // Customer & Operation Info Grid
  const infoBoxH = 132;
  drawRoundedRect(ctx, pad + 4, cursorY, innerW - 8, infoBoxH, 12);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  const colLeftX = pad + 26;
  const colRightX = pad + innerW / 2 + 12;

  const hasNamedCustomer =
    Boolean(sale.customerName?.trim()) &&
    sale.customerName.trim().toLowerCase() !== 'cliente mostrador';
  const displayCustomer = hasNamedCustomer
    ? sale.customerName.trim()
    : 'Cliente Mostrador';

  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748B';
  ctx.font = '700 12px system-ui, -apple-system, sans-serif';
  ctx.fillText('CLIENTE', colLeftX, cursorY + 28);

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 20px system-ui, -apple-system, sans-serif';
  ctx.fillText(displayCustomer, colLeftX, cursorY + 56);

  ctx.fillStyle = '#475569';
  ctx.font = '500 14px system-ui, -apple-system, sans-serif';
  const detailParts: string[] = [];
  if (sale.customerCity?.trim()) detailParts.push(sale.customerCity.trim());
  if (sale.customerPhone?.trim()) detailParts.push(sale.customerPhone.trim());
  ctx.fillText(
    detailParts.length > 0 ? detailParts.join(' · ') : 'Compra directa en tienda',
    colLeftX,
    cursorY + 84,
  );
  if (sale.deliveryDate?.trim()) {
    ctx.fillStyle = '#2563EB';
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(`Entrega programada: ${sale.deliveryDate}`, colLeftX, cursorY + 108);
  }

  ctx.fillStyle = '#64748B';
  ctx.font = '700 12px system-ui, -apple-system, sans-serif';
  ctx.fillText('DETALLE DE VENTA', colRightX, cursorY + 28);

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 17px system-ui, -apple-system, sans-serif';
  ctx.fillText(`Asesor: ${sale.seller}`, colRightX, cursorY + 56);

  ctx.fillStyle = isCreditSale ? '#B45309' : '#047857';
  ctx.font = '700 14px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    isCreditSale ? 'Condición: CRÉDITO (CxC)' : 'Condición: CONTADO (Pagado)',
    colRightX,
    cursorY + 84,
  );

  ctx.fillStyle = '#475569';
  ctx.font = '500 14px system-ui, -apple-system, sans-serif';
  ctx.fillText(`Método: ${sale.paymentMethod ?? 'Efectivo ($)'}`, colRightX, cursorY + 108);

  // Table Header
  cursorY += infoBoxH + 24;
  drawRoundedRect(ctx, pad + 4, cursorY, innerW - 8, 42, 8);
  ctx.fillStyle = '#0F172A';
  ctx.fill();

  const colItemX = pad + 22;
  const colSizeX = pad + innerW * 0.54;
  const colQtyX = pad + innerW * 0.67;
  const colUnitX = pad + innerW * 0.82;
  const colSubX = width - pad - 22;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 12px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('FRANELA', colItemX, cursorY + 25);
  ctx.textAlign = 'center';
  ctx.fillText('TALLA', colSizeX, cursorY + 25);
  ctx.textAlign = 'right';
  ctx.fillText('CANT.', colQtyX, cursorY + 25);
  ctx.fillText('PRECIO UNIT.', colUnitX, cursorY + 25);
  ctx.fillText('TOTAL', colSubX, cursorY + 25);

  cursorY += 48;

  // Item Rows (USD-only, zero COGS wording)
  measuredRows.forEach(({ item, lines, rowH }, index) => {
    if (index > 0) {
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad + 12, cursorY);
      ctx.lineTo(width - pad - 12, cursorY);
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 16px system-ui, -apple-system, sans-serif';
    lines.forEach((lineText, lineIdx) => {
      ctx.fillText(lineText, colItemX, cursorY + 26 + lineIdx * 20);
    });

    const subMetaY = lines.length > 1 ? cursorY + 68 : cursorY + 50;
    ctx.fillStyle = '#64748B';
    ctx.font = '500 13px system-ui, -apple-system, sans-serif';
    const verLabel = item.version === 'Fan' ? 'Fans' : item.version;
    const subMeta = `${verLabel}${item.discountLabel ? ` · ${item.discountLabel}` : ''}`;
    ctx.fillText(subMeta, colItemX, subMetaY);

    const midY = cursorY + Math.round(rowH / 2) + 4;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(item.size, colSizeX, midY);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#334155';
    ctx.font = '700 16px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(String(item.quantity), colQtyX, midY);

    ctx.fillStyle = '#475569';
    ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(formatUSD(item.unitPrice), colUnitX, midY);

    ctx.fillStyle = '#0F172A';
    ctx.font = '800 17px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(formatUSD(item.subtotal), colSubX, midY);

    cursorY += rowH;
  });

  // Payment Splits if Pago Mixto (USD-only clean breakdown)
  if (sale.paymentMethod === 'Pago Mixto' && sale.paymentSplits?.length) {
    cursorY += 8;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad + 12, cursorY);
    ctx.lineTo(width - pad - 12, cursorY);
    ctx.stroke();

    cursorY += 20;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748B';
    ctx.font = '700 12px system-ui, -apple-system, sans-serif';
    ctx.fillText('DESGLOSE DE PAGO:', colItemX, cursorY);
    cursorY += 22;

    for (const sp of sale.paymentSplits) {
      ctx.fillStyle = '#334155';
      ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`• ${sp.method}: ${formatUSD(sp.amountUsd)}`, colItemX, cursorY);
      cursorY += 22;
    }
  }

  // Totals Summary Box
  cursorY += 16;
  const totalBoxH =
    96 + (hasReturn ? 28 : 0) + (isCreditSale ? 52 : 0);
  drawRoundedRect(ctx, pad + 4, cursorY, innerW - 8, totalBoxH, 14);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#475569';
  ctx.font = '700 13px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    hasReturn ? 'TOTAL NETO DE LA COMPRA (USD)' : 'TOTAL DE LA COMPRA (USD)',
    pad + 26,
    cursorY + 38,
  );

  ctx.fillStyle = '#64748B';
  ctx.font = '500 14px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    `${lineItems.reduce((sum, l) => sum + l.quantity, 0)} prenda(s) · Precio en USD`,
    pad + 26,
    cursorY + 64,
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#0F172A';
  ctx.font = '800 34px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(
    `${formatUSD(hasReturn ? netFinalPrice : sale.finalPrice)} USD`,
    width - pad - 26,
    cursorY + 56,
  );

  let nextSummaryY = cursorY + 84;
  if (hasReturn) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#B45309';
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `Subtotal original: ${formatUSD(sale.finalPrice)} · Devolución aplicada: -${formatUSD(returnedAmount)}`,
      pad + 26,
      nextSummaryY + 4,
    );
    nextSummaryY += 28;
  }

  if (isCreditSale) {
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad + 26, nextSummaryY);
    ctx.lineTo(width - pad - 26, nextSummaryY);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#047857';
    ctx.font = '700 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(`Abono inicial: ${formatUSD(paidAmount)}`, pad + 26, nextSummaryY + 32);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#B45309';
    ctx.font = '800 16px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(
      `Saldo pendiente: ${formatUSD(pendingBalance)}`,
      width - pad - 26,
      nextSummaryY + 32,
    );
  }

  // Prominent Thank-You Footer
  const footerY = height - 84;
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad + 24, footerY - 28);
  ctx.lineTo(width - pad - 24, footerY - 28);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillText(footerMessage, width / 2, footerY + 4);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 13px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    `Factura ${invoiceCode} · ${storeLocation}`,
    width / 2,
    footerY + 30,
  );

  return canvas.toDataURL('image/jpeg', 0.95);
}

export function downloadJpgDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename.endsWith('.jpg') ? filename : `${filename}.jpg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
