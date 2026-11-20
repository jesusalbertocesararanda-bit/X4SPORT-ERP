import type {
  AppState,
  BulkImportRecord,
  ExpenseCategory,
  ExpenseSource,
  InventoryItem,
  JerseySize,
  JerseyVersion,
  MatrixConfigParams,
  PaymentMethod,
  PaymentStatus,
  SellerName,
  ShippingType,
  SinglePaymentMethod,
} from '../types/erp';
import {
  detectExpenseCategoryFromDescription,
  extractTeamFromModel,
  normalizeExpenseCategory,
  normalizeVersionDisplay,
  registerImportBatch,
  registerManualInventoryAdjustment,
  registerMultiItemSale,
  registerOperatingExpense,
  round2,
} from './finance';
import type { SheetMatrix } from './excelImport';

export type BulkImportKind =
  | 'ventas'
  | 'compras'
  | 'ajustes'
  | 'gastos'
  | 'respaldo';

export type BulkRowStatus = 'valido' | 'duplicado' | 'error';

export const COMPRAS_MASIVAS_HEADERS = [
  'Fecha',
  'Lote / Referencia',
  'Tipo Importación',
  'Estatus',
  'Proveedor',
  'Modelo',
  'Versión',
  'Talla',
  'Cantidad',
  'Costo Fábrica (USDT)',
  'Flete Unit. (USDT)',
  'Precio Venta (USDT)',
  'Tasa USDT',
] as const;

export const VENTAS_MASIVAS_HEADERS = [
  'Fecha',
  'Referencia / Factura',
  'Cliente',
  'Ciudad',
  'Teléfono',
  'Modelo',
  'Versión',
  'Talla',
  'Cantidad',
  'Precio Unitario (USDT)',
  'Vendedor',
  'Condición Pago',
  'Método Pago',
] as const;

export const AJUSTES_MASIVOS_HEADERS = [
  'Fecha',
  'Tipo',
  'Modelo',
  'Versión',
  'Talla',
  'Cantidad',
  'Motivo',
  'Responsable',
] as const;

export const GASTOS_MASIVOS_HEADERS = [
  'Fecha',
  'Concepto',
  'Categoría',
  'Monto (USDT)',
  'Fondo Origen',
  'Vía de Pago',
] as const;

export interface BulkTemplateSpec {
  kind: Exclude<BulkImportKind, 'respaldo'>;
  sheetName: string;
  fileName: string;
  headers: readonly string[];
  sampleRows: (string | number)[][];
}

export function getBulkTemplateSpec(
  kind: Exclude<BulkImportKind, 'respaldo'>,
): BulkTemplateSpec {
  if (kind === 'ventas') {
    return {
      kind: 'ventas',
      sheetName: 'Ventas Masivas',
      fileName: 'X4SPORT_Plantilla_Ventas_Masivas.xlsx',
      headers: VENTAS_MASIVAS_HEADERS,
      sampleRows: [
        [
          '2026-11-18',
          'IMP-V-001',
          'Carlos Mendoza',
          'Guacara',
          '0414-1234567',
          'Real Madrid Local 25/26',
          'Player',
          'L',
          1,
          30,
          'Jesús',
          'Contado',
          'Efectivo ($)',
        ],
      ],
    };
  }

  if (kind === 'compras') {
    return {
      kind: 'compras',
      sheetName: 'Compras Masivas',
      fileName: 'X4SPORT_Plantilla_Compras_Masivas.xlsx',
      headers: COMPRAS_MASIVAS_HEADERS,
      sampleRows: [
        [
          '2026-11-18',
          'Lote Alibaba Nov #01',
          'Aéreo',
          'EN TRÁNSITO',
          '1688 / Alibaba',
          'Barcelona Local 25/26',
          'Fans',
          'M',
          10,
          5.8,
          1.2,
          25,
          54.2,
        ],
      ],
    };
  }

  if (kind === 'ajustes') {
    return {
      kind: 'ajustes',
      sheetName: 'Ajustes Masivos',
      fileName: 'X4SPORT_Plantilla_Ajustes_Inventario.xlsx',
      headers: AJUSTES_MASIVOS_HEADERS,
      sampleRows: [
        [
          '2026-11-18',
          'entrada',
          'Barcelona Local 25/26',
          'Fans',
          'M',
          2,
          'Conteo físico bodega central',
          'Jesús César',
        ],
      ],
    };
  }

  return {
    kind: 'gastos',
    sheetName: 'Gastos Masivos',
    fileName: 'X4SPORT_Plantilla_Gastos_Masivos.xlsx',
    headers: GASTOS_MASIVOS_HEADERS,
    sampleRows: [
      [
        '2026-11-18',
        'Bolsas y empaques personalizados X4SPORT',
        'Logística/Producción',
        18.5,
        'Fondo Operativo',
        'Binance USDT',
      ],
    ],
  };
}

export function downloadBulkTemplateWithSheetJS(
  kind: Exclude<BulkImportKind, 'respaldo'>,
): boolean {
  if (typeof window === 'undefined' || !window.XLSX) return false;
  const spec = getBulkTemplateSpec(kind);
  const XLSX = window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet([
    [...spec.headers],
    ...spec.sampleRows,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
  XLSX.writeFile(wb, spec.fileName);
  return true;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function norm(val: unknown): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseNumber(val: unknown): number | null {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const cleaned = String(val ?? '')
    .replace(/[$\s]/g, '')
    .replace(',', '.')
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDateIso(val: unknown, fallback: string): string {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const s = String(val ?? '').trim();
  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (isoMatch) return isoMatch[1];
  const dmyMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (typeof val === 'number' && val > 20000 && val < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30) + val * 86_400_000);
    if (!Number.isNaN(epoch.getTime())) return epoch.toISOString().slice(0, 10);
  }
  return fallback;
}

function parseVersionToken(raw: unknown, model = ''): JerseyVersion {
  const combined = `${norm(raw)} ${norm(model)}`;
  if (norm(raw).includes('retro') || (!norm(raw) && combined.includes('retro'))) {
    return 'Retro';
  }
  if (norm(raw).includes('player') || norm(raw).includes('jugador')) {
    return 'Player';
  }
  return 'Fans';
}

function parseSizeToken(raw: unknown): JerseySize {
  const clean = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!clean) return 'M';
  if (clean === '2XL' || clean === 'XXL') return 'XXL';
  return clean as JerseySize;
}

function parseSellerToken(raw: unknown): SellerName {
  const n = norm(raw);
  if (n.includes('jesus')) return 'Jesús';
  if (n.includes('josue')) return 'Josué';
  if (n.includes('gabriel')) return 'Gabriel';
  return 'Sin Asignar';
}

function parsePaymentMethodToken(raw: unknown): SinglePaymentMethod {
  const n = norm(raw);
  if (n.includes('binance') || n.includes('usdt')) return 'Binance USDT';
  if (n.includes('zelle')) return 'Zelle';
  if (n.includes('pago movil') || n.includes('movil') || n.includes('bs')) {
    return 'Pago Móvil / Bs';
  }
  return 'Efectivo ($)';
}

function parsePaymentConditionToken(raw: unknown): PaymentStatus {
  const n = norm(raw);
  if (n.includes('cred') || n.includes('pend')) return 'Pendiente';
  return 'Cobrado';
}

function parseShippingToken(raw: unknown): ShippingType {
  const n = norm(raw);
  if (n.includes('marit')) return 'Marítimo';
  return 'Aéreo';
}

function parseExpenseSourceToken(raw: unknown): ExpenseSource {
  const n = norm(raw);
  if (n.includes('reinv') || n.includes('crec')) return 'growthReinvestment';
  if (n.includes('repos')) return 'replacement';
  if (n.includes('divid')) return 'dividends';
  if (n.includes('caja')) return 'cashOnHand';
  return 'operatingFund';
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  const normHeaders = headers.map((h) => norm(h));
  for (const alias of aliases) {
    const exact = normHeaders.indexOf(norm(alias));
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const partial = normHeaders.findIndex((h) => h.includes(norm(alias)));
    if (partial >= 0) return partial;
  }
  return -1;
}

function findMatchingInventorySku(
  inventory: InventoryItem[],
  model: string,
  size: JerseySize,
  version: JerseyVersion | null,
): InventoryItem | undefined {
  const targetModel = norm(model);
  const targetSize = String(size).trim().toUpperCase();
  const targetVer = version ? normalizeVersionDisplay(version) : null;

  return inventory.find((item) => {
    const sameModel = norm(item.model) === targetModel;
    const sameSize = String(item.size).trim().toUpperCase() === targetSize;
    const sameVer = targetVer
      ? normalizeVersionDisplay(item.version) === targetVer
      : true;
    return sameModel && sameSize && sameVer;
  });
}

// ---------------------------------------------------------------------------
// Validated Preview Types
// ---------------------------------------------------------------------------

export interface ValidatedBulkRow {
  rowNumber: number;
  status: BulkRowStatus;
  statusReason: string;
  date: string;
  primaryLabel: string;
  detailLabel: string;
  units: number;
  amountUsd: number;
  payload: unknown;
}

export interface BulkUploadPreview {
  kind: Exclude<BulkImportKind, 'respaldo'>;
  fileName: string;
  sheetName: string;
  detectedColumns: string[];
  missingRequiredColumns: string[];
  rows: ValidatedBulkRow[];
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  validUnits: number;
  validTotalUsd: number;
}

export interface VentasBulkRowPayload {
  date: string;
  reference: string;
  customerName: string;
  customerCity: string;
  customerPhone: string;
  skuId: string;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  seller: SellerName;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  dedupKey: string;
}

export interface ComprasBulkRowPayload {
  date: string;
  referenceName: string;
  shippingType: ShippingType;
  batchStatus: 'EN TRÁNSITO' | 'RECIBIDO EN BODEGA';
  supplier: string;
  team: string;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  factoryUnitCost: number;
  freightUnitCost: number;
  landedUnitCost: number;
  salePrice?: number;
  usdtRate: number;
  dedupKey: string;
}

export interface AjustesBulkRowPayload {
  date: string;
  type: 'entrada' | 'salida';
  skuId: string;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  reason: string;
  userName: string;
  dedupKey: string;
}

export interface GastosBulkRowPayload {
  date: string;
  concept: string;
  category: ExpenseCategory;
  amount: number;
  source: ExpenseSource;
  paymentMethod: SinglePaymentMethod;
  dedupKey: string;
}

function isRowEmpty(row: unknown[]): boolean {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

/**
 * Analiza una matriz de Excel para una de las 4 cargas masivas incrementales,
 * validando columnas obligatorias, stock/montos y duplicados antes de guardar.
 */
export function parseBulkSheetMatrix(
  kind: Exclude<BulkImportKind, 'respaldo'>,
  matrix: SheetMatrix,
  state: AppState,
  fileName: string,
  sheetName: string,
): BulkUploadPreview {
  const today = new Date().toISOString().slice(0, 10);
  if (!matrix || matrix.length === 0) {
    return {
      kind,
      fileName,
      sheetName,
      detectedColumns: [],
      missingRequiredColumns: ['Archivo vacío sin encabezados'],
      rows: [],
      validCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      validUnits: 0,
      validTotalUsd: 0,
    };
  }

  // Locate header row (first non-empty row with >= 2 filled cells)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 10); i += 1) {
    const filled = (matrix[i] ?? []).filter((c) => String(c ?? '').trim() !== '').length;
    if (filled >= 2) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = (matrix[headerRowIdx] ?? []).map((h) => String(h ?? '').trim());
  const dataRows = matrix.slice(headerRowIdx + 1);
  const rows: ValidatedBulkRow[] = [];
  const missingRequiredColumns: string[] = [];

  if (kind === 'ventas') {
    const colDate = findColumnIndex(headers, ['fecha', 'date']);
    const colRef = findColumnIndex(headers, ['referencia', 'factura', 'ref']);
    const colCust = findColumnIndex(headers, ['cliente', 'comprador', 'customer']);
    const colCity = findColumnIndex(headers, ['ciudad', 'ubicacion', 'city']);
    const colPhone = findColumnIndex(headers, ['telefono', 'phone', 'whatsapp']);
    const colModel = findColumnIndex(headers, ['modelo', 'model', 'franela']);
    const colVer = findColumnIndex(headers, ['version', 'versión', 'calidad']);
    const colSize = findColumnIndex(headers, ['talla', 'size']);
    const colQty = findColumnIndex(headers, ['cantidad', 'cant', 'qty']);
    const colPrice = findColumnIndex(headers, ['precio unitario', 'precio venta', 'precio', 'unit price']);
    const colTotal = findColumnIndex(headers, ['total (usdt)', 'total', 'monto']);
    const colSeller = findColumnIndex(headers, ['vendedor', 'seller']);
    const colCond = findColumnIndex(headers, ['condicion pago', 'estatus', 'estado', 'condicion']);
    const colMethod = findColumnIndex(headers, ['metodo pago', 'via', 'metodo']);

    if (colModel < 0) missingRequiredColumns.push('Modelo');
    if (colSize < 0) missingRequiredColumns.push('Talla');
    if (colQty < 0) missingRequiredColumns.push('Cantidad');
    if (colPrice < 0 && colTotal < 0) {
      missingRequiredColumns.push('Precio Unitario (USDT)');
    }

    if (missingRequiredColumns.length > 0) {
      return {
        kind,
        fileName,
        sheetName,
        detectedColumns: headers.filter(Boolean),
        missingRequiredColumns,
        rows: [],
        validCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        validUnits: 0,
        validTotalUsd: 0,
      };
    }

    // Track working stock per SKU & existing sale fingerprints
    const workingStock = new Map<string, number>();
    state.inventory.forEach((it) => workingStock.set(it.id, it.stock));

    const existingKeys = new Set<string>();
    (state.sales ?? []).forEach((s) => {
      if (s.clientOperationId) existingKeys.add(norm(s.clientOperationId));
      const d = (s.saleDate || s.createdAt || '').slice(0, 10);
      existingKeys.add(
        `${d}|${norm(s.customerName)}|${norm(s.modelLabel)}|${norm(s.size)}|${s.quantity}|${round2(s.finalPrice)}`,
      );
      if (s.invoiceNumber && s.invoiceNumber !== 'S/N') {
        existingKeys.add(`ref:${norm(s.invoiceNumber)}`);
      }
    });
    const seenInFile = new Set<string>();

    dataRows.forEach((rawRow, idx) => {
      if (isRowEmpty(rawRow)) return;
      const rowNumber = headerRowIdx + idx + 2;
      const model = String(rawRow[colModel] ?? '').trim();
      const size = parseSizeToken(colSize >= 0 ? rawRow[colSize] : 'M');
      const version = colVer >= 0 ? parseVersionToken(rawRow[colVer], model) : null;
      const qtyRaw = parseNumber(rawRow[colQty]);
      const qty = qtyRaw !== null ? Math.floor(qtyRaw) : 0;
      const unitPriceRaw = colPrice >= 0 ? parseNumber(rawRow[colPrice]) : null;
      const totalRaw = colTotal >= 0 ? parseNumber(rawRow[colTotal]) : null;
      const unitPrice =
        unitPriceRaw !== null && unitPriceRaw > 0
          ? round2(unitPriceRaw)
          : totalRaw !== null && qty > 0
            ? round2(totalRaw / qty)
            : 0;
      const subtotal = round2(unitPrice * Math.max(0, qty));
      const date = colDate >= 0 ? parseDateIso(rawRow[colDate], today) : today;
      const reference = colRef >= 0 ? String(rawRow[colRef] ?? '').trim() : '';
      const customerName =
        colCust >= 0 && String(rawRow[colCust] ?? '').trim()
          ? String(rawRow[colCust]).trim()
          : 'Cliente Mostrador';
      const customerCity =
        colCity >= 0 ? String(rawRow[colCity] ?? '').trim() : '';
      const customerPhone =
        colPhone >= 0 ? String(rawRow[colPhone] ?? '').trim() : '';
      const seller = colSeller >= 0 ? parseSellerToken(rawRow[colSeller]) : 'Sin Asignar';
      const paymentStatus =
        colCond >= 0 ? parsePaymentConditionToken(rawRow[colCond]) : 'Cobrado';
      const paymentMethod =
        colMethod >= 0 ? parsePaymentMethodToken(rawRow[colMethod]) : 'Efectivo ($)';

      const sku = model
        ? findMatchingInventorySku(state.inventory, model, size, version)
        : undefined;

      const dedupKey = `${date}|${norm(customerName)}|${norm(sku?.model ?? model)}|${norm(size)}|${qty}|${subtotal}`;
      const opId = reference
        ? `bulk-sale-${norm(reference)}`
        : `bulk-sale-${dedupKey}`;

      let status: BulkRowStatus = 'valido';
      let statusReason = 'Listo para importar';

      if (!model) {
        status = 'error';
        statusReason = 'Modelo vacío';
      } else if (qty <= 0) {
        status = 'error';
        statusReason = 'Cantidad debe ser > 0';
      } else if (unitPrice <= 0) {
        status = 'error';
        statusReason = 'Precio unitario debe ser > $0.00';
      } else if (!sku) {
        status = 'error';
        statusReason = `SKU "${model} (${size})" no existe en inventario`;
      } else if (
        existingKeys.has(dedupKey) ||
        existingKeys.has(norm(opId)) ||
        (reference && existingKeys.has(`ref:${norm(reference)}`)) ||
        seenInFile.has(dedupKey)
      ) {
        status = 'duplicado';
        statusReason = 'Venta duplicada (ya registrada o repetida en archivo)';
      } else {
        const avail = workingStock.get(sku.id) ?? 0;
        if (qty > avail) {
          status = 'error';
          statusReason = `Stock insuficiente (disponible: ${avail} uds)`;
        } else {
          workingStock.set(sku.id, avail - qty);
          seenInFile.add(dedupKey);
        }
      }

      rows.push({
        rowNumber,
        status,
        statusReason,
        date,
        primaryLabel: `${model || 'Sin modelo'} (${sku?.version ?? version ?? 'Fans'} · ${size})`,
        detailLabel: `${customerName} · ${seller} · ${paymentStatus === 'Pendiente' ? 'Crédito' : 'Contado'}`,
        units: Math.max(0, qty),
        amountUsd: subtotal,
        payload: {
          date,
          reference,
          customerName,
          customerCity,
          customerPhone,
          skuId: sku?.id ?? '',
          model: sku?.model ?? model,
          version: sku?.version ?? version ?? 'Fans',
          size,
          quantity: qty,
          unitPrice,
          subtotal,
          seller,
          paymentStatus,
          paymentMethod,
          dedupKey: opId,
        } satisfies VentasBulkRowPayload,
      });
    });
  } else if (kind === 'compras') {
    const colDate = findColumnIndex(headers, ['fecha', 'date']);
    const colRef = findColumnIndex(headers, ['lote', 'referencia', 'ref']);
    const colShip = findColumnIndex(headers, ['tipo importacion', 'envio', 'tipo']);
    const colStatus = findColumnIndex(headers, ['estatus', 'estado']);
    const colSupplier = findColumnIndex(headers, ['proveedor', 'origen', 'supplier']);
    const colModel = findColumnIndex(headers, ['modelo', 'model']);
    const colVer = findColumnIndex(headers, ['version', 'versión']);
    const colSize = findColumnIndex(headers, ['talla', 'size']);
    const colQty = findColumnIndex(headers, ['cantidad', 'cant', 'qty']);
    const colFactory = findColumnIndex(headers, [
      'costo fabrica',
      'costo unitario',
      'costo',
      'factory',
    ]);
    const colFreight = findColumnIndex(headers, ['flete unit', 'flete']);
    const colSalePrice = findColumnIndex(headers, ['precio venta', 'pvp']);
    const colUsdt = findColumnIndex(headers, ['tasa usdt', 'usdt']);

    if (colModel < 0) missingRequiredColumns.push('Modelo');
    if (colSize < 0) missingRequiredColumns.push('Talla');
    if (colQty < 0) missingRequiredColumns.push('Cantidad');
    if (colFactory < 0) missingRequiredColumns.push('Costo Fábrica (USDT)');

    if (missingRequiredColumns.length > 0) {
      return {
        kind,
        fileName,
        sheetName,
        detectedColumns: headers.filter(Boolean),
        missingRequiredColumns,
        rows: [],
        validCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        validUnits: 0,
        validTotalUsd: 0,
      };
    }

    const existingBatchKeys = new Set<string>();
    (state.purchaseBatches ?? []).forEach((b) => {
      if (b.clientOperationId) existingBatchKeys.add(norm(b.clientOperationId));
      existingBatchKeys.add(
        `${norm(b.referenceName)}|${b.entryDate}|${norm(b.shippingType)}`,
      );
      b.items.forEach((it) => {
        existingBatchKeys.add(
          `line:${b.entryDate}|${norm(b.referenceName)}|${norm(it.model)}|${norm(it.version)}|${norm(it.size)}|${it.quantity}`,
        );
      });
    });
    const seenLineKeys = new Set<string>();
    let runningCash = state.cashOnHand;

    dataRows.forEach((rawRow, idx) => {
      if (isRowEmpty(rawRow)) return;
      const rowNumber = headerRowIdx + idx + 2;
      const date = colDate >= 0 ? parseDateIso(rawRow[colDate], today) : today;
      const referenceName =
        colRef >= 0 && String(rawRow[colRef] ?? '').trim()
          ? String(rawRow[colRef]).trim()
          : `Carga Masiva ${date}`;
      const shippingType =
        colShip >= 0 ? parseShippingToken(rawRow[colShip]) : 'Aéreo';
      const rawStatus = colStatus >= 0 ? norm(rawRow[colStatus]) : '';
      const batchStatus: 'EN TRÁNSITO' | 'RECIBIDO EN BODEGA' =
        rawStatus.includes('recib') || rawStatus.includes('bodega')
          ? 'RECIBIDO EN BODEGA'
          : 'EN TRÁNSITO';
      const supplier =
        colSupplier >= 0 && String(rawRow[colSupplier] ?? '').trim()
          ? String(rawRow[colSupplier]).trim()
          : '1688 / Alibaba';
      const model = String(rawRow[colModel] ?? '').trim();
      const version = colVer >= 0 ? parseVersionToken(rawRow[colVer], model) : 'Fans';
      const size = parseSizeToken(colSize >= 0 ? rawRow[colSize] : 'M');
      const qtyRaw = parseNumber(rawRow[colQty]);
      const qty = qtyRaw !== null ? Math.floor(qtyRaw) : 0;
      const factoryCost = round2(parseNumber(rawRow[colFactory]) ?? 0);
      const freightUnit =
        colFreight >= 0 ? round2(Math.max(0, parseNumber(rawRow[colFreight]) ?? 0)) : 0;
      const landedUnit = round2(factoryCost + freightUnit);
      const lineTotal = round2(landedUnit * Math.max(0, qty));
      const salePrice =
        colSalePrice >= 0 ? parseNumber(rawRow[colSalePrice]) ?? undefined : undefined;
      const usdtRate =
        colUsdt >= 0
          ? parseNumber(rawRow[colUsdt]) ?? state.exchangeRates.usdt
          : state.exchangeRates.usdt;

      const lineDedupKey = `line:${date}|${norm(referenceName)}|${norm(model)}|${norm(version)}|${norm(size)}|${qty}`;
      const batchKey = `${norm(referenceName)}|${date}|${norm(shippingType)}`;

      let status: BulkRowStatus = 'valido';
      let statusReason = 'Listo para importar';

      if (!model) {
        status = 'error';
        statusReason = 'Modelo vacío';
      } else if (qty <= 0) {
        status = 'error';
        statusReason = 'Cantidad debe ser > 0';
      } else if (factoryCost <= 0) {
        status = 'error';
        statusReason = 'Costo fábrica debe ser > $0.00';
      } else if (
        existingBatchKeys.has(lineDedupKey) ||
        existingBatchKeys.has(batchKey) ||
        seenLineKeys.has(lineDedupKey)
      ) {
        status = 'duplicado';
        statusReason = 'Compra / lote ya registrado previamente';
      } else if (lineTotal > runningCash) {
        status = 'error';
        statusReason = `Caja insuficiente ($${runningCash.toFixed(2)} disponibles para $${lineTotal.toFixed(2)})`;
      } else {
        runningCash = round2(runningCash - lineTotal);
        seenLineKeys.add(lineDedupKey);
      }

      rows.push({
        rowNumber,
        status,
        statusReason,
        date,
        primaryLabel: `${model || 'Sin modelo'} (${version} · ${size})`,
        detailLabel: `${referenceName} · ${shippingType} · ${batchStatus}`,
        units: Math.max(0, qty),
        amountUsd: lineTotal,
        payload: {
          date,
          referenceName,
          shippingType,
          batchStatus,
          supplier,
          team: extractTeamFromModel(model),
          model,
          version,
          size,
          quantity: qty,
          factoryUnitCost: factoryCost,
          freightUnitCost: freightUnit,
          landedUnitCost: landedUnit,
          salePrice: salePrice && salePrice > 0 ? round2(salePrice) : undefined,
          usdtRate: round2(usdtRate),
          dedupKey: `bulk-pur-${batchKey}`,
        } satisfies ComprasBulkRowPayload,
      });
    });
  } else if (kind === 'ajustes') {
    const colDate = findColumnIndex(headers, ['fecha', 'date']);
    const colType = findColumnIndex(headers, ['tipo', 'movimiento']);
    const colModel = findColumnIndex(headers, ['modelo', 'model']);
    const colVer = findColumnIndex(headers, ['version', 'versión']);
    const colSize = findColumnIndex(headers, ['talla', 'size']);
    const colQty = findColumnIndex(headers, ['cantidad', 'cant', 'variacion']);
    const colReason = findColumnIndex(headers, ['motivo', 'razon', 'reason']);
    const colUser = findColumnIndex(headers, ['responsable', 'usuario', 'user']);

    if (colType < 0) missingRequiredColumns.push('Tipo');
    if (colModel < 0) missingRequiredColumns.push('Modelo');
    if (colSize < 0) missingRequiredColumns.push('Talla');
    if (colQty < 0) missingRequiredColumns.push('Cantidad');
    if (colReason < 0) missingRequiredColumns.push('Motivo');

    if (missingRequiredColumns.length > 0) {
      return {
        kind,
        fileName,
        sheetName,
        detectedColumns: headers.filter(Boolean),
        missingRequiredColumns,
        rows: [],
        validCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        validUnits: 0,
        validTotalUsd: 0,
      };
    }

    const workingStock = new Map<string, number>();
    state.inventory.forEach((it) => workingStock.set(it.id, it.stock));

    const existingKeys = new Set<string>();
    (state.inventoryAdjustments ?? []).forEach((a) => {
      const d = (a.createdAt || '').slice(0, 10);
      const t = a.adjustmentType ?? (a.delta < 0 ? 'salida' : 'entrada');
      existingKeys.add(
        `${d}|${a.skuId}|${t}|${Math.abs(a.delta)}|${norm(a.reason)}`,
      );
    });
    const seenInFile = new Set<string>();

    dataRows.forEach((rawRow, idx) => {
      if (isRowEmpty(rawRow)) return;
      const rowNumber = headerRowIdx + idx + 2;
      const date = colDate >= 0 ? parseDateIso(rawRow[colDate], today) : today;
      const rawType = norm(rawRow[colType]);
      const adjType: 'entrada' | 'salida' = rawType.includes('sal')
        ? 'salida'
        : 'entrada';
      const model = String(rawRow[colModel] ?? '').trim();
      const version = colVer >= 0 ? parseVersionToken(rawRow[colVer], model) : null;
      const size = parseSizeToken(rawRow[colSize]);
      const qtyRaw = parseNumber(rawRow[colQty]);
      const qty = qtyRaw !== null ? Math.abs(Math.floor(qtyRaw)) : 0;
      const reason = String(rawRow[colReason] ?? '').trim();
      const userName =
        colUser >= 0 && String(rawRow[colUser] ?? '').trim()
          ? String(rawRow[colUser]).trim()
          : 'Admin';

      const sku = model
        ? findMatchingInventorySku(state.inventory, model, size, version)
        : undefined;
      const dedupKey = `${date}|${sku?.id ?? norm(model)}|${adjType}|${qty}|${norm(reason)}`;

      let status: BulkRowStatus = 'valido';
      let statusReason = 'Listo para importar';

      if (!model) {
        status = 'error';
        statusReason = 'Modelo vacío';
      } else if (!reason) {
        status = 'error';
        statusReason = 'Motivo obligatorio vacío';
      } else if (qty <= 0) {
        status = 'error';
        statusReason = 'Cantidad debe ser > 0';
      } else if (!sku) {
        status = 'error';
        statusReason = `SKU "${model} (${size})" no existe en inventario`;
      } else if (existingKeys.has(dedupKey) || seenInFile.has(dedupKey)) {
        status = 'duplicado';
        statusReason = 'Ajuste duplicado';
      } else {
        const avail = workingStock.get(sku.id) ?? 0;
        if (adjType === 'salida' && qty > avail) {
          status = 'error';
          statusReason = `Stock insuficiente (disponible: ${avail} uds)`;
        } else {
          workingStock.set(
            sku.id,
            adjType === 'salida' ? avail - qty : avail + qty,
          );
          seenInFile.add(dedupKey);
        }
      }

      rows.push({
        rowNumber,
        status,
        statusReason,
        date,
        primaryLabel: `${adjType === 'entrada' ? '+' : '-'}${qty} ${model || 'Sin modelo'} (${size})`,
        detailLabel: `${reason || 'Sin motivo'} · ${userName}`,
        units: qty,
        amountUsd: round2(qty * (sku?.cogs ?? 0)),
        payload: {
          date,
          type: adjType,
          skuId: sku?.id ?? '',
          model: sku?.model ?? model,
          version: sku?.version ?? version ?? 'Fans',
          size,
          quantity: qty,
          reason,
          userName,
          dedupKey,
        } satisfies AjustesBulkRowPayload,
      });
    });
  } else {
    // gastos
    const colDate = findColumnIndex(headers, ['fecha', 'date']);
    const colConcept = findColumnIndex(headers, ['concepto', 'descripcion', 'detalle']);
    const colCat = findColumnIndex(headers, ['categoria', 'categoría', 'category']);
    const colAmount = findColumnIndex(headers, ['monto', 'amount', 'total']);
    const colSource = findColumnIndex(headers, ['fondo', 'origen', 'source']);
    const colMethod = findColumnIndex(headers, ['via de pago', 'metodo', 'via']);

    if (colConcept < 0) missingRequiredColumns.push('Concepto');
    if (colAmount < 0) missingRequiredColumns.push('Monto (USDT)');

    if (missingRequiredColumns.length > 0) {
      return {
        kind,
        fileName,
        sheetName,
        detectedColumns: headers.filter(Boolean),
        missingRequiredColumns,
        rows: [],
        validCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        validUnits: 0,
        validTotalUsd: 0,
      };
    }

    const existingKeys = new Set<string>();
    (state.operatingExpenses ?? []).forEach((e) => {
      const d = (e.createdAt || '').slice(0, 10);
      existingKeys.add(
        `${d}|${norm(e.concept)}|${round2(e.amount)}|${norm(e.paymentMethod)}`,
      );
    });
    const seenInFile = new Set<string>();
    let runningCash = state.cashOnHand;

    dataRows.forEach((rawRow, idx) => {
      if (isRowEmpty(rawRow)) return;
      const rowNumber = headerRowIdx + idx + 2;
      const date = colDate >= 0 ? parseDateIso(rawRow[colDate], today) : today;
      const concept = String(rawRow[colConcept] ?? '').trim();
      const rawCategory = colCat >= 0 ? String(rawRow[colCat] ?? '').trim() : '';
      const detected = concept ? detectExpenseCategoryFromDescription(concept) : null;
      const category: ExpenseCategory =
        normalizeExpenseCategory(rawCategory) ??
        detected?.category ??
        'Logística/Producción';
      const amount = round2(parseNumber(rawRow[colAmount]) ?? 0);
      const source =
        colSource >= 0 ? parseExpenseSourceToken(rawRow[colSource]) : 'operatingFund';
      const paymentMethod =
        colMethod >= 0 ? parsePaymentMethodToken(rawRow[colMethod]) : 'Efectivo ($)';

      const dedupKey = `${date}|${norm(concept)}|${amount}|${norm(paymentMethod)}`;

      let status: BulkRowStatus = 'valido';
      let statusReason = detected
        ? `Auto-detectado ${detected.category} ("${detected.matchedKeyword}")`
        : 'Listo para importar';

      if (!concept) {
        status = 'error';
        statusReason = 'Concepto vacío';
      } else if (amount <= 0) {
        status = 'error';
        statusReason = 'Monto debe ser > $0.00';
      } else if (existingKeys.has(dedupKey) || seenInFile.has(dedupKey)) {
        status = 'duplicado';
        statusReason = 'Gasto duplicado';
      } else if (amount > runningCash) {
        status = 'error';
        statusReason = `Efectivo insuficiente en caja ($${runningCash.toFixed(2)})`;
      } else {
        runningCash = round2(runningCash - amount);
        seenInFile.add(dedupKey);
      }

      rows.push({
        rowNumber,
        status,
        statusReason,
        date,
        primaryLabel: concept || 'Sin concepto',
        detailLabel: `${category} · ${paymentMethod}`,
        units: 1,
        amountUsd: amount,
        payload: {
          date,
          concept,
          category,
          amount,
          source,
          paymentMethod,
          dedupKey,
        } satisfies GastosBulkRowPayload,
      });
    });
  }

  const validRows = rows.filter((r) => r.status === 'valido');
  const duplicateRows = rows.filter((r) => r.status === 'duplicado');
  const errorRows = rows.filter((r) => r.status === 'error');

  return {
    kind,
    fileName,
    sheetName,
    detectedColumns: headers.filter(Boolean),
    missingRequiredColumns,
    rows,
    validCount: validRows.length,
    duplicateCount: duplicateRows.length,
    errorCount: errorRows.length,
    validUnits: validRows.reduce((s, r) => s + r.units, 0),
    validTotalUsd: round2(validRows.reduce((s, r) => s + r.amountUsd, 0)),
  };
}

export async function parseBulkUploadFileWithSheetJS(
  kind: Exclude<BulkImportKind, 'respaldo'>,
  file: File,
  state: AppState,
): Promise<{ ok: boolean; error?: string; preview?: BulkUploadPreview }> {
  if (typeof window === 'undefined' || !window.XLSX) {
    return {
      ok: false,
      error: 'Librería SheetJS (xlsx) aún no disponible en este navegador.',
    };
  }
  try {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, {
      type: 'array',
      cellDates: true,
    });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return {
        ok: false,
        error: 'El archivo Excel no contiene pestañas válidas.',
      };
    }
    const ws = workbook.Sheets[firstSheetName];
    const matrix = window.XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      raw: true,
    }) as SheetMatrix;
    const preview = parseBulkSheetMatrix(
      kind,
      matrix,
      state,
      file.name,
      firstSheetName,
    );
    return { ok: true, preview };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `No se pudo leer el archivo Excel: ${err.message}`
          : 'Archivo Excel inválido o dañado.',
    };
  }
}

export interface ApplyBulkImportOutcome {
  ok: boolean;
  error?: string;
  state: AppState;
  record?: BulkImportRecord;
  appliedCount: number;
  skippedDuplicatesCount: number;
}

/**
 * Aplica únicamente las filas válidas (omitiendo duplicados y errores),
 * actualiza inventario/finanzas/caja con las reglas oficiales del ERP
 * y genera el registro auditable para Reportes > Cargas Masivas.
 */
export function applyBulkUploadPreview(
  state: AppState,
  preview: BulkUploadPreview,
  userName: string,
  matrixParams?: MatrixConfigParams,
): ApplyBulkImportOutcome {
  if (preview.missingRequiredColumns.length > 0) {
    return {
      ok: false,
      error: `Faltan columnas obligatorias: ${preview.missingRequiredColumns.join(', ')}`,
      state,
      appliedCount: 0,
      skippedDuplicatesCount: preview.duplicateCount,
    };
  }

  const validRows = preview.rows.filter((r) => r.status === 'valido');
  if (validRows.length === 0) {
    return {
      ok: false,
      error:
        'No hay filas válidas nuevas para guardar (todas son duplicadas o contienen errores).',
      state,
      appliedCount: 0,
      skippedDuplicatesCount: preview.duplicateCount,
    };
  }

  let working = state;
  let appliedCount = 0;
  let comprasRows = 0;
  let comprasUnits = 0;
  let comprasCostUsd = 0;
  let ventasRows = 0;
  let ventasUnits = 0;
  let ventasRevenueUsd = 0;

  if (preview.kind === 'ventas') {
    for (const row of validRows) {
      const p = row.payload as VentasBulkRowPayload;
      const res = registerMultiItemSale(
        working,
        {
          items: [{ skuId: p.skuId, quantity: p.quantity, unitPrice: p.unitPrice }],
          saleDate: p.date,
          customerName: p.customerName,
          customerCity: p.customerCity || undefined,
          customerPhone: p.customerPhone || undefined,
          seller: p.seller,
          paymentStatus: p.paymentStatus,
          paymentMethod: p.paymentMethod,
          clientOperationId: p.dedupKey,
        },
        matrixParams,
      );
      if (!res.ok) {
        return {
          ok: false,
          error: `Fila ${row.rowNumber}: ${res.error ?? 'Error al registrar venta.'}`,
          state,
          appliedCount: 0,
          skippedDuplicatesCount: preview.duplicateCount,
        };
      }
      working = res.state;
      appliedCount += 1;
      ventasRows += 1;
      ventasUnits += p.quantity;
      ventasRevenueUsd = round2(ventasRevenueUsd + p.subtotal);
    }
  } else if (preview.kind === 'compras') {
    // Group rows by referenceName + date + shippingType + batchStatus
    const groups = new Map<string, ComprasBulkRowPayload[]>();
    for (const row of validRows) {
      const p = row.payload as ComprasBulkRowPayload;
      const key = `${p.referenceName}|${p.date}|${p.shippingType}|${p.batchStatus}`;
      const list = groups.get(key) ?? [];
      list.push(p);
      groups.set(key, list);
    }

    for (const [, items] of groups.entries()) {
      const first = items[0];
      const totalFreightCost = round2(
        items.reduce((s, it) => s + it.freightUnitCost * it.quantity, 0),
      );
      const totalBatchUnits = items.reduce((s, it) => s + it.quantity, 0);
      const totalBatchLanded = round2(
        items.reduce((s, it) => s + it.landedUnitCost * it.quantity, 0),
      );

      const res = registerImportBatch(working, {
        entryDate: first.date,
        receivedDate:
          first.batchStatus === 'RECIBIDO EN BODEGA' ? first.date : undefined,
        referenceName: first.referenceName,
        shippingType: first.shippingType,
        supplier: first.supplier,
        totalFreightCost,
        isDirectReception: first.batchStatus === 'RECIBIDO EN BODEGA',
        retailPricingMode: 'per-item',
        usdtRate: first.usdtRate,
        clientOperationId: first.dedupKey,
        items: items.map((it) => ({
          team: it.team,
          model: it.model,
          version: it.version,
          size: it.size,
          quantity: it.quantity,
          factoryUnitCost: it.factoryUnitCost,
          salePrice: it.salePrice,
        })),
      });

      if (!res.ok) {
        return {
          ok: false,
          error: `Lote "${first.referenceName}": ${res.error ?? 'Error al registrar compra.'}`,
          state,
          appliedCount: 0,
          skippedDuplicatesCount: preview.duplicateCount,
        };
      }

      working = res.state;
      appliedCount += items.length;
      comprasRows += items.length;
      comprasUnits += totalBatchUnits;
      comprasCostUsd = round2(comprasCostUsd + totalBatchLanded);
    }
  } else if (preview.kind === 'ajustes') {
    for (const row of validRows) {
      const p = row.payload as AjustesBulkRowPayload;
      const res = registerManualInventoryAdjustment(working, {
        type: p.type,
        skuId: p.skuId,
        quantity: p.quantity,
        reason: p.reason,
      });
      if (!res.ok) {
        return {
          ok: false,
          error: `Fila ${row.rowNumber}: ${res.error ?? 'Error al aplicar ajuste.'}`,
          state,
          appliedCount: 0,
          skippedDuplicatesCount: preview.duplicateCount,
        };
      }
      working = res.state;
      appliedCount += 1;
    }
  } else {
    // gastos
    for (const row of validRows) {
      const p = row.payload as GastosBulkRowPayload;
      const res = registerOperatingExpense(working, {
        concept: p.concept,
        category: p.category,
        amount: p.amount,
        source: p.source,
        paymentMethod: p.paymentMethod,
      });
      if (!res.ok) {
        return {
          ok: false,
          error: `Fila ${row.rowNumber}: ${res.error ?? 'Error al registrar gasto.'}`,
          state,
          appliedCount: 0,
          skippedDuplicatesCount: preview.duplicateCount,
        };
      }
      working = res.state;
      appliedCount += 1;
    }
  }

  const nowIso = new Date().toISOString();
  const kindLabel =
    preview.kind === 'ventas'
      ? 'Ventas Masivas'
      : preview.kind === 'compras'
        ? 'Compras Masivas'
        : preview.kind === 'ajustes'
          ? 'Ajustes de Inventario'
          : 'Gastos Masivos';

  const record: BulkImportRecord = {
    id: `imp-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fileName: preview.fileName,
    importDate: nowIso.slice(0, 10),
    userName: userName || 'Admin',
    sheetsDetected: [preview.sheetName || kindLabel],
    comprasRows,
    comprasUnits,
    comprasCostUsd,
    ventasRows,
    ventasUnits,
    ventasRevenueUsd,
    resultingSkusCount: working.inventory.length,
    resultingStockUnits: working.inventory.reduce((s, i) => s + i.stock, 0),
    cashOnHandUsd: round2(working.cashOnHand),
    usdtRate: round2(working.exchangeRates.usdt),
    bcvRate: round2(working.exchangeRates.bcv),
    status: 'Aplicada',
    notes: `${kindLabel}: ${appliedCount} fila(s) aplicada(s), ${preview.duplicateCount} duplicada(s) omitida(s)`,
    createdAt: nowIso,
  };

  return {
    ok: true,
    state: {
      ...working,
      bulkImports: [record, ...(working.bulkImports ?? [])],
    },
    record,
    appliedCount,
    skippedDuplicatesCount: preview.duplicateCount,
  };
}
