import type {
  AppState,
  BulkImportRecord,
  InventoryAdjustmentRecord,
  JerseySize,
  JerseyVersion,
  PurchaseBatchRecord,
  ReturnExchangeRecord,
  SaleRecord,
  SellerName,
  ShippingType,
  TeamCategory,
} from '../types/erp';
import {
  getInventorySizeMatrix,
  isUnassignedSeller,
  round2,
  type InventorySizeMatrixRow,
} from './finance';

export type ReportType =
  | 'ventas'
  | 'compras'
  | 'clientes'
  | 'devoluciones'
  | 'ajustes'
  | 'movimientos'
  | 'cargas'
  | 'inventario';

export interface ReportFilters {
  dateFrom: string;
  dateTo: string;
  search: string;
  size: string;
  version: string;
  customer: string;
  city: string;
  seller: string;
  paymentCondition: string; // 'ALL' | 'Contado' | 'Crédito'
  shippingType: string; // 'ALL' | 'Marítimo' | 'Aéreo'
  amountMin: string;
  amountMax: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  dateFrom: '',
  dateTo: '',
  search: '',
  size: 'ALL',
  version: 'ALL',
  customer: '',
  city: '',
  seller: 'ALL',
  paymentCondition: 'ALL',
  shippingType: 'ALL',
  amountMin: '',
  amountMax: '',
};

export interface SalesReportRow {
  id: string;
  saleId: string;
  invoiceNumber: string;
  date: string;
  createdAt: string;
  customerName: string;
  customerCity: string;
  customerPhone: string;
  team: string;
  modelLabel: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  unitCogs: number;
  seller: string;
  paymentCondition: 'Contado' | 'Crédito';
  paymentStatus: string;
  paymentMethod: string;
}

export interface PurchaseReportRow {
  id: string;
  batchId: string;
  referenceName: string;
  date: string;
  entryDate: string;
  receivedDate: string;
  status: string;
  shippingType: ShippingType;
  supplier: string;
  team: string;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  factoryUnitCost: number;
  proratedFreightPerUnit: number;
  landedUnitCost: number;
  lineLandedTotal: number;
  usdtRate: number;
}

export interface CustomerReportRow {
  id: string;
  customerName: string;
  city: string;
  phone: string;
  social: string;
  purchasesCount: number;
  unitsBought: number;
  totalSpentUsd: number;
  cashSpentUsd: number;
  creditSpentUsd: number;
  pendingCxcUsd: number;
  lastPurchaseDate: string;
  sellersSummary: string;
  favoriteModels: string;
}

export interface ReturnReportRow {
  id: string;
  date: string;
  createdAt: string;
  type: 'Cambio' | 'Devolución';
  invoiceNumber: string;
  customerName: string;
  customerCity: string;
  seller: string;
  returnedModelLabel: string;
  returnedVersion: JerseyVersion;
  returnedSize: JerseySize;
  returnedQuantity: number;
  returnedTotal: number;
  replacementModelLabel: string;
  replacementVersion: string;
  replacementSize: string;
  replacementQuantity: number;
  replacementTotal: number;
  differenceUsd: number;
  paymentMethod: string;
  reason: string;
}

export interface AdjustmentReportRow {
  id: string;
  date: string;
  createdAt: string;
  adjustmentType: 'entrada' | 'salida' | 'descruce';
  modelLabel: string;
  version: JerseyVersion;
  size: JerseySize;
  targetModelLabel: string;
  targetVersion: string;
  targetSize: string;
  previousStock: number;
  newStock: number;
  delta: number;
  fifoLossCost: number;
  reason: string;
  userName: string;
}

export interface StockMovementReportRow {
  id: string;
  date: string;
  createdAt: string;
  direction: 'Entrada' | 'Salida';
  sourceType:
    | 'Entrada · Compra'
    | 'Salida · Venta'
    | 'Entrada · Devolución'
    | 'Salida · Cambio'
    | 'Entrada · Ajuste'
    | 'Salida · Ajuste'
    | 'Entrada · Descruce'
    | 'Salida · Descruce';
  reference: string;
  team: string;
  modelLabel: string;
  version: string;
  size: string;
  signedUnits: number;
  absUnits: number;
  amountUsd: number;
  counterparty: string;
  city: string;
  seller: string;
  paymentCondition: string;
  shippingType: string;
  detail: string;
}

export interface BulkImportReportRow {
  id: string;
  importDate: string;
  createdAt: string;
  fileName: string;
  userName: string;
  status: string;
  sheetsText: string;
  comprasRows: number;
  comprasUnits: number;
  comprasCostUsd: number;
  ventasRows: number;
  ventasUnits: number;
  ventasRevenueUsd: number;
  resultingSkusCount: number;
  resultingStockUnits: number;
  cashOnHandUsd: number;
  usdtRate: number;
  bcvRate: number;
  notes: string;
}

export interface AvailableStockReportRow {
  key: string;
  team: TeamCategory;
  model: string;
  version: 'Fans' | 'Player' | 'Retro';
  sizes: InventorySizeMatrixRow['sizes'];
  trackedSizes: InventorySizeMatrixRow['trackedSizes'];
  extraSizes: InventorySizeMatrixRow['extraSizes'];
  extraSizesText: string;
  totalStock: number;
  salePrice: number;
  salePriceBs: number;
  avgCogs: number;
  totalFifoValue: number;
  isLowStock: boolean;
}

export interface ReportSummaryTotals {
  filteredCount: number;
  totalUnits: number;
  totalUsd: number;
  extraNote?: string;
}

export interface ExcelSheetPayload {
  sheetName: string;
  fileName: string;
  headers: string[];
  rows: (string | number)[][];
  totalsRow: (string | number)[];
}

export function normalizeReportText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function extractDateOnly(rawDate: unknown): string {
  const s = String(rawDate ?? '').trim();
  if (!s) return '';
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (match) return match[1];
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

function matchesDateRange(
  dateStr: string,
  dateFrom: string,
  dateTo: string,
): boolean {
  if (!dateFrom && !dateTo) return true;
  if (!dateStr) return false;
  if (dateFrom && dateStr < dateFrom) return false;
  if (dateTo && dateStr > dateTo) return false;
  return true;
}

function matchesVersionFilter(rawVersion: unknown, filterVersion: string): boolean {
  if (!filterVersion || filterVersion === 'ALL') return true;
  const v = normalizeReportText(rawVersion);
  const f = normalizeReportText(filterVersion);
  if (f === 'fans' || f === 'fan') {
    return v === 'fans' || v === 'fan';
  }
  return v === f;
}

function matchesSizeFilter(rawSize: unknown, filterSize: string): boolean {
  if (!filterSize || filterSize === 'ALL') return true;
  return String(rawSize ?? '').trim().toUpperCase() === filterSize.trim().toUpperCase();
}

function matchesSellerFilter(rawSeller: unknown, filterSeller: string): boolean {
  if (!filterSeller || filterSeller === 'ALL') return true;
  const s = String(rawSeller ?? '').trim();
  if (filterSeller === 'Sin Asignar') {
    return !s || isUnassignedSeller(s as SellerName);
  }
  return normalizeReportText(s) === normalizeReportText(filterSeller);
}

function parseAmountBound(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function matchesAmountBounds(
  values: number[],
  amountMin: string,
  amountMax: string,
): boolean {
  const min = parseAmountBound(amountMin);
  const max = parseAmountBound(amountMax);
  if (min === null && max === null) return true;
  return values.some((val) => {
    if (!Number.isFinite(val)) return false;
    if (min !== null && val < min - 0.0001) return false;
    if (max !== null && val > max + 0.0001) return false;
    return true;
  });
}

function matchesTextQuery(query: string, haystacks: unknown[]): boolean {
  const q = normalizeReportText(query);
  if (!q) return true;
  return haystacks.some((h) => normalizeReportText(h).includes(q));
}

export function countActiveReportFilters(
  filters: ReportFilters,
  applicableKeys?: (keyof ReportFilters)[],
): number {
  const keys = applicableKeys ?? (Object.keys(DEFAULT_REPORT_FILTERS) as (keyof ReportFilters)[]);
  let count = 0;
  for (const key of keys) {
    const val = filters[key];
    if (key === 'size' || key === 'version' || key === 'seller' || key === 'paymentCondition' || key === 'shippingType') {
      if (val && val !== 'ALL') count += 1;
    } else if (val && val.trim() !== '') {
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// 1) VENTAS
// ---------------------------------------------------------------------------

export function buildSalesReportRows(state: AppState): SalesReportRow[] {
  const rows: SalesReportRow[] = [];
  for (const s of state.sales ?? []) {
    if (s.voided) continue;
    const date = extractDateOnly(s.saleDate || s.createdAt);
    const paymentCondition: 'Contado' | 'Crédito' =
      s.paymentStatus === 'Pendiente' ? 'Crédito' : 'Contado';
    const customerName = s.customerName || s.debtorName || 'Cliente Mostrador';
    const customerCity = s.customerCity || 'N/D';
    const customerPhone = s.customerPhone || 'N/D';
    const invoiceNumber = s.invoiceNumber || 'S/N';

    if (s.items && s.items.length > 0) {
      s.items.forEach((it, idx) => {
        const qty = Math.max(1, Number(it.quantity) || 1);
        const subtotal = round2(Number(it.subtotal) || 0);
        const unitPrice = round2(
          Number(it.unitPrice) || (qty > 0 ? subtotal / qty : 0),
        );
        rows.push({
          id: `${s.id}-line-${idx}`,
          saleId: s.id,
          invoiceNumber,
          date,
          createdAt: s.createdAt,
          customerName,
          customerCity,
          customerPhone,
          team: it.team || s.team || '',
          modelLabel: it.modelLabel || s.modelLabel,
          version: it.version || s.version,
          size: it.size || s.size,
          quantity: qty,
          unitPrice,
          subtotal,
          unitCogs: round2(Number(it.unitCogs) || s.unitCogs || 0),
          seller: s.seller || 'Sin Asignar',
          paymentCondition,
          paymentStatus: s.paymentStatus,
          paymentMethod: s.paymentMethod,
        });
      });
    } else {
      const qty = Math.max(1, Number(s.quantity) || 1);
      const subtotal = round2(Number(s.finalPrice) || 0);
      rows.push({
        id: s.id,
        saleId: s.id,
        invoiceNumber,
        date,
        createdAt: s.createdAt,
        customerName,
        customerCity,
        customerPhone,
        team: s.team || '',
        modelLabel: s.modelLabel,
        version: s.version,
        size: s.size,
        quantity: qty,
        unitPrice: round2(subtotal / qty),
        subtotal,
        unitCogs: round2(Number(s.unitCogs) || 0),
        seller: s.seller || 'Sin Asignar',
        paymentCondition,
        paymentStatus: s.paymentStatus,
        paymentMethod: s.paymentMethod,
      });
    }
  }
  return rows;
}

export function filterSalesReportRows(
  state: AppState,
  filters: ReportFilters,
): { rows: SalesReportRow[]; totals: ReportSummaryTotals } {
  const all = buildSalesReportRows(state);
  const rows = all.filter((r) => {
    if (!matchesDateRange(r.date, filters.dateFrom, filters.dateTo)) return false;
    if (
      !matchesTextQuery(filters.search, [
        r.modelLabel,
        r.team,
        r.invoiceNumber,
        r.customerName,
        r.customerCity,
        r.paymentMethod,
      ])
    ) {
      return false;
    }
    if (!matchesSizeFilter(r.size, filters.size)) return false;
    if (!matchesVersionFilter(r.version, filters.version)) return false;
    if (!matchesTextQuery(filters.customer, [r.customerName])) return false;
    if (!matchesTextQuery(filters.city, [r.customerCity])) return false;
    if (!matchesSellerFilter(r.seller, filters.seller)) return false;
    if (
      filters.paymentCondition !== 'ALL' &&
      r.paymentCondition !== filters.paymentCondition
    ) {
      return false;
    }
    if (
      !matchesAmountBounds(
        [r.unitPrice, r.subtotal],
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      return false;
    }
    return true;
  });

  const totalUnits = rows.reduce((sum, r) => sum + r.quantity, 0);
  const totalUsd = round2(rows.reduce((sum, r) => sum + r.subtotal, 0));

  return {
    rows,
    totals: {
      filteredCount: rows.length,
      totalUnits,
      totalUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// 2) COMPRAS
// ---------------------------------------------------------------------------

export function buildPurchasesReportRows(state: AppState): PurchaseReportRow[] {
  const rows: PurchaseReportRow[] = [];
  for (const b of state.purchaseBatches ?? []) {
    const date = extractDateOnly(b.receivedDate || b.entryDate || b.createdAt);
    const supplier = b.supplier || 'Proveedor Asia';
    const usdtRate = round2(Number(b.usdtRate) || state.exchangeRates.usdt || 0);

    if (b.items && b.items.length > 0) {
      b.items.forEach((it, idx) => {
        const qty = Math.max(0, Number(it.quantity) || 0);
        const landedUnit = round2(Number(it.landedUnitCost) || 0);
        const lineLanded = round2(
          Number(it.lineLandedTotal) || qty * landedUnit,
        );
        rows.push({
          id: `${b.id}-item-${idx}`,
          batchId: b.id,
          referenceName: b.referenceName,
          date,
          entryDate: b.entryDate,
          receivedDate: b.receivedDate || '',
          status: b.status,
          shippingType: b.shippingType,
          supplier,
          team: it.team || '',
          model: it.model,
          version: it.version,
          size: it.size,
          quantity: qty,
          factoryUnitCost: round2(Number(it.factoryUnitCost) || 0),
          proratedFreightPerUnit: round2(Number(it.proratedFreightPerUnit) || 0),
          landedUnitCost: landedUnit,
          lineLandedTotal: lineLanded,
          usdtRate,
        });
      });
    } else {
      rows.push({
        id: b.id,
        batchId: b.id,
        referenceName: b.referenceName,
        date,
        entryDate: b.entryDate,
        receivedDate: b.receivedDate || '',
        status: b.status,
        shippingType: b.shippingType,
        supplier,
        team: '',
        model: b.referenceName,
        version: 'Fans',
        size: 'M',
        quantity: b.totalUnits,
        factoryUnitCost: 0,
        proratedFreightPerUnit: b.freightPerUnit,
        landedUnitCost:
          b.totalUnits > 0 ? round2(b.totalLandedCost / b.totalUnits) : 0,
        lineLandedTotal: round2(b.totalLandedCost),
        usdtRate,
      });
    }
  }
  return rows;
}

export function filterPurchasesReportRows(
  state: AppState,
  filters: ReportFilters,
): { rows: PurchaseReportRow[]; totals: ReportSummaryTotals } {
  const all = buildPurchasesReportRows(state);
  const rows = all.filter((r) => {
    if (!matchesDateRange(r.date, filters.dateFrom, filters.dateTo)) return false;
    if (
      !matchesTextQuery(filters.search, [
        r.model,
        r.team,
        r.referenceName,
        r.supplier,
        r.status,
      ])
    ) {
      return false;
    }
    if (!matchesSizeFilter(r.size, filters.size)) return false;
    if (!matchesVersionFilter(r.version, filters.version)) return false;
    if (
      filters.shippingType !== 'ALL' &&
      normalizeReportText(r.shippingType) !== normalizeReportText(filters.shippingType)
    ) {
      return false;
    }
    if (
      !matchesAmountBounds(
        [r.landedUnitCost, r.lineLandedTotal],
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      return false;
    }
    return true;
  });

  const totalUnits = rows.reduce((sum, r) => sum + r.quantity, 0);
  const totalUsd = round2(rows.reduce((sum, r) => sum + r.lineLandedTotal, 0));

  return {
    rows,
    totals: {
      filteredCount: rows.length,
      totalUnits,
      totalUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// 3) CLIENTES
// ---------------------------------------------------------------------------

interface ClientBucket {
  id: string;
  customerName: string;
  city: string;
  phone: string;
  social: string;
  createdDate: string;
  sales: SaleRecord[];
  pendingCxcUsd: number;
  receivableDates: string[];
}

export function filterCustomersReportRows(
  state: AppState,
  filters: ReportFilters,
): { rows: CustomerReportRow[]; totals: ReportSummaryTotals } {
  const buckets = new Map<string, ClientBucket>();

  const ensureBucket = (rawName: string, fallbackId: string, createdDate = ''): ClientBucket => {
    const cleanName = rawName.trim() || 'Cliente Mostrador';
    const key = normalizeReportText(cleanName);
    const existing = buckets.get(key);
    if (existing) {
      if (!existing.createdDate && createdDate) existing.createdDate = createdDate;
      return existing;
    }
    const created: ClientBucket = {
      id: fallbackId,
      customerName: cleanName,
      city: '',
      phone: '',
      social: '',
      createdDate,
      sales: [],
      pendingCxcUsd: 0,
      receivableDates: [],
    };
    buckets.set(key, created);
    return created;
  };

  for (const c of state.customers ?? []) {
    const b = ensureBucket(c.name, c.id, extractDateOnly(c.createdAt));
    if (c.city) b.city = c.city;
    if (c.phone) b.phone = c.phone;
    if (c.social) b.social = c.social;
  }

  for (const s of state.sales ?? []) {
    if (s.voided) continue;
    const name = s.customerName || s.debtorName || 'Cliente Mostrador';
    const b = ensureBucket(name, `cust-sale-${s.id}`, extractDateOnly(s.saleDate || s.createdAt));
    if (!b.city && s.customerCity) b.city = s.customerCity;
    if (!b.phone && s.customerPhone) b.phone = s.customerPhone;
    if (!b.social && s.customerSocial) b.social = s.customerSocial;
    b.sales.push(s);
  }

  for (const r of state.receivables ?? []) {
    if ((r.amount ?? 0) <= 0) continue;
    const b = ensureBucket(r.debtor, `cust-rec-${r.id}`, extractDateOnly(r.createdAt));
    b.pendingCxcUsd = round2(b.pendingCxcUsd + r.amount);
    const rDate = extractDateOnly(r.createdAt);
    if (rDate) b.receivableDates.push(rDate);
  }

  const hasProductOrSellerFilter =
    filters.size !== 'ALL' ||
    filters.version !== 'ALL' ||
    filters.seller !== 'ALL';

  const rows: CustomerReportRow[] = [];

  for (const bucket of buckets.values()) {
    const displayCity = bucket.city || 'N/D';
    const displayPhone = bucket.phone || 'N/D';
    const displaySocial = bucket.social || 'N/D';

    if (!matchesTextQuery(filters.customer, [bucket.customerName])) continue;
    if (!matchesTextQuery(filters.city, [displayCity])) continue;

    const identityMatchesSearch =
      !filters.search.trim() ||
      matchesTextQuery(filters.search, [
        bucket.customerName,
        displayCity,
        displayPhone,
        displaySocial,
      ]);

    // Filter customer sales according to active AND criteria
    const matchingSalesData: Array<{
      sale: SaleRecord;
      date: string;
      units: number;
      amount: number;
      models: string[];
    }> = [];

    for (const s of bucket.sales) {
      const sDate = extractDateOnly(s.saleDate || s.createdAt);
      if (!matchesDateRange(sDate, filters.dateFrom, filters.dateTo)) continue;
      if (!matchesSellerFilter(s.seller, filters.seller)) continue;
      const cond: 'Contado' | 'Crédito' =
        s.paymentStatus === 'Pendiente' ? 'Crédito' : 'Contado';
      if (
        filters.paymentCondition !== 'ALL' &&
        cond !== filters.paymentCondition
      ) {
        continue;
      }

      if (s.items && s.items.length > 0) {
        const matchedItems = s.items.filter((it) => {
          if (!matchesSizeFilter(it.size, filters.size)) return false;
          if (!matchesVersionFilter(it.version, filters.version)) return false;
          if (
            !identityMatchesSearch &&
            !matchesTextQuery(filters.search, [
              it.modelLabel,
              it.team,
              s.invoiceNumber,
            ])
          ) {
            return false;
          }
          return true;
        });
        if (matchedItems.length === 0) continue;
        matchingSalesData.push({
          sale: s,
          date: sDate,
          units: matchedItems.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0),
          amount: round2(
            matchedItems.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0),
          ),
          models: matchedItems.map((it) => `${it.modelLabel} (${it.size})`),
        });
      } else {
        if (!matchesSizeFilter(s.size, filters.size)) continue;
        if (!matchesVersionFilter(s.version, filters.version)) continue;
        if (
          !identityMatchesSearch &&
          !matchesTextQuery(filters.search, [
            s.modelLabel,
            s.team,
            s.invoiceNumber,
          ])
        ) {
          continue;
        }
        matchingSalesData.push({
          sale: s,
          date: sDate,
          units: Math.max(1, Number(s.quantity) || 1),
          amount: round2(Number(s.finalPrice) || 0),
          models: [`${s.modelLabel} (${s.size})`],
        });
      }
    }

    if (matchingSalesData.length === 0) {
      if (hasProductOrSellerFilter) continue;
      if (!identityMatchesSearch) continue;
      if (filters.paymentCondition === 'Contado') continue;
      if (filters.paymentCondition === 'Crédito' && bucket.pendingCxcUsd <= 0) {
        continue;
      }
      const fallbackDate =
        bucket.receivableDates[0] || bucket.createdDate || '';
      if (!matchesDateRange(fallbackDate, filters.dateFrom, filters.dateTo)) {
        continue;
      }
    }

    const totalSpentUsd = round2(
      matchingSalesData.reduce((sum, item) => sum + item.amount, 0),
    );
    const unitsBought = matchingSalesData.reduce(
      (sum, item) => sum + item.units,
      0,
    );
    const cashSpentUsd = round2(
      matchingSalesData
        .filter((i) => i.sale.paymentStatus !== 'Pendiente')
        .reduce((sum, i) => sum + i.amount, 0),
    );
    const creditSpentUsd = round2(
      matchingSalesData
        .filter((i) => i.sale.paymentStatus === 'Pendiente')
        .reduce((sum, i) => sum + i.amount, 0),
    );

    if (
      !matchesAmountBounds(
        totalSpentUsd > 0
          ? [totalSpentUsd, ...(bucket.pendingCxcUsd > 0 ? [bucket.pendingCxcUsd] : [])]
          : [bucket.pendingCxcUsd],
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      continue;
    }

    const allDates = [
      ...matchingSalesData.map((i) => i.date),
      ...bucket.receivableDates,
      bucket.createdDate,
    ].filter(Boolean);
    allDates.sort((a, b) => b.localeCompare(a));

    const sellers = Array.from(
      new Set(
        matchingSalesData
          .map((i) => i.sale.seller)
          .filter((s) => s && !isUnassignedSeller(s)),
      ),
    );

    const models = Array.from(
      new Set(matchingSalesData.flatMap((i) => i.models)),
    ).slice(0, 4);

    rows.push({
      id: bucket.id,
      customerName: bucket.customerName,
      city: displayCity,
      phone: displayPhone,
      social: displaySocial,
      purchasesCount: matchingSalesData.length,
      unitsBought,
      totalSpentUsd,
      cashSpentUsd,
      creditSpentUsd,
      pendingCxcUsd: bucket.pendingCxcUsd,
      lastPurchaseDate: allDates[0] || 'N/D',
      sellersSummary:
        sellers.length > 0
          ? sellers.join(', ')
          : matchingSalesData.length > 0
            ? 'Sin Asignar'
            : 'CxC Histórica',
      favoriteModels: models.length > 0 ? models.join(' · ') : 'Saldo inicial CxC',
    });
  }

  rows.sort((a, b) => {
    if (b.totalSpentUsd !== a.totalSpentUsd) return b.totalSpentUsd - a.totalSpentUsd;
    return b.pendingCxcUsd - a.pendingCxcUsd;
  });

  const totalUnits = rows.reduce((sum, r) => sum + r.unitsBought, 0);
  const totalUsd = round2(rows.reduce((sum, r) => sum + r.totalSpentUsd, 0));
  const totalCxc = round2(rows.reduce((sum, r) => sum + r.pendingCxcUsd, 0));

  return {
    rows,
    totals: {
      filteredCount: rows.length,
      totalUnits,
      totalUsd,
      extraNote: totalCxc > 0 ? `CxC Pendiente: $${totalCxc.toFixed(2)} USDT` : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// 4) DEVOLUCIONES Y CAMBIOS
// ---------------------------------------------------------------------------

export function buildReturnsReportRows(state: AppState): ReturnReportRow[] {
  const saleById = new Map<string, SaleRecord>();
  for (const s of state.sales ?? []) {
    saleById.set(s.id, s);
  }

  return (state.returns ?? []).map((r: ReturnExchangeRecord) => {
    const linkedSale = r.saleId ? saleById.get(r.saleId) : undefined;
    return {
      id: r.id,
      date: extractDateOnly(r.createdAt),
      createdAt: r.createdAt,
      type: r.type,
      invoiceNumber: r.invoiceNumber || linkedSale?.invoiceNumber || 'S/N',
      customerName: r.customerName || linkedSale?.customerName || 'N/D',
      customerCity: linkedSale?.customerCity || 'N/D',
      seller: linkedSale?.seller || 'Sin Asignar',
      returnedModelLabel: r.returnedModelLabel,
      returnedVersion: r.returnedVersion,
      returnedSize: r.returnedSize,
      returnedQuantity: r.returnedQuantity,
      returnedTotal: round2(r.returnedTotal),
      replacementModelLabel: r.replacementModelLabel || '',
      replacementVersion: r.replacementVersion || '',
      replacementSize: r.replacementSize || '',
      replacementQuantity: r.replacementQuantity ?? 0,
      replacementTotal: round2(r.replacementTotal ?? 0),
      differenceUsd: round2(r.differenceUsd),
      paymentMethod: r.paymentMethod,
      reason: r.reason,
    };
  });
}

export function filterReturnsReportRows(
  state: AppState,
  filters: ReportFilters,
): { rows: ReturnReportRow[]; totals: ReportSummaryTotals } {
  const all = buildReturnsReportRows(state);
  const rows = all.filter((r) => {
    if (!matchesDateRange(r.date, filters.dateFrom, filters.dateTo)) return false;
    if (
      !matchesTextQuery(filters.search, [
        r.returnedModelLabel,
        r.replacementModelLabel,
        r.customerName,
        r.invoiceNumber,
        r.reason,
        r.type,
      ])
    ) {
      return false;
    }
    if (
      filters.size !== 'ALL' &&
      !matchesSizeFilter(r.returnedSize, filters.size) &&
      !matchesSizeFilter(r.replacementSize, filters.size)
    ) {
      return false;
    }
    if (
      filters.version !== 'ALL' &&
      !matchesVersionFilter(r.returnedVersion, filters.version) &&
      !matchesVersionFilter(r.replacementVersion, filters.version)
    ) {
      return false;
    }
    if (!matchesTextQuery(filters.customer, [r.customerName])) return false;
    if (!matchesTextQuery(filters.city, [r.customerCity])) return false;
    if (!matchesSellerFilter(r.seller, filters.seller)) return false;
    if (
      !matchesAmountBounds(
        [r.returnedTotal, r.differenceUsd, Math.abs(r.differenceUsd)],
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      return false;
    }
    return true;
  });

  const totalUnits = rows.reduce((sum, r) => sum + r.returnedQuantity, 0);
  const totalUsd = round2(rows.reduce((sum, r) => sum + r.differenceUsd, 0));

  return {
    rows,
    totals: {
      filteredCount: rows.length,
      totalUnits,
      totalUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// 5) AJUSTES DE INVENTARIO
// ---------------------------------------------------------------------------

export function buildAdjustmentsReportRows(state: AppState): AdjustmentReportRow[] {
  return (state.inventoryAdjustments ?? []).map((a: InventoryAdjustmentRecord) => ({
    id: a.id,
    date: extractDateOnly(a.createdAt),
    createdAt: a.createdAt,
    adjustmentType:
      a.adjustmentType ?? (a.delta < 0 ? 'salida' : 'entrada'),
    modelLabel: a.modelLabel,
    version: a.version,
    size: a.size,
    targetModelLabel: a.targetModelLabel || '',
    targetVersion: a.targetVersion || '',
    targetSize: a.targetSize || '',
    previousStock: a.previousStock,
    newStock: a.newStock,
    delta: a.delta,
    fifoLossCost: round2(a.fifoLossCost ?? 0),
    reason: a.reason,
    userName: a.userName || 'Admin',
  }));
}

export function filterAdjustmentsReportRows(
  state: AppState,
  filters: ReportFilters,
): { rows: AdjustmentReportRow[]; totals: ReportSummaryTotals } {
  const all = buildAdjustmentsReportRows(state);
  const rows = all.filter((r) => {
    if (!matchesDateRange(r.date, filters.dateFrom, filters.dateTo)) return false;
    if (
      !matchesTextQuery(filters.search, [
        r.modelLabel,
        r.targetModelLabel,
        r.reason,
        r.userName,
        r.adjustmentType,
      ])
    ) {
      return false;
    }
    if (
      filters.size !== 'ALL' &&
      !matchesSizeFilter(r.size, filters.size) &&
      !matchesSizeFilter(r.targetSize, filters.size)
    ) {
      return false;
    }
    if (
      filters.version !== 'ALL' &&
      !matchesVersionFilter(r.version, filters.version) &&
      !matchesVersionFilter(r.targetVersion, filters.version)
    ) {
      return false;
    }
    if (
      !matchesAmountBounds(
        [r.fifoLossCost],
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      return false;
    }
    return true;
  });

  const totalUnits = rows.reduce((sum, r) => sum + r.delta, 0);
  const totalMoved = rows.reduce((sum, r) => sum + Math.abs(r.delta), 0);
  const totalUsd = round2(rows.reduce((sum, r) => sum + r.fifoLossCost, 0));

  return {
    rows,
    totals: {
      filteredCount: rows.length,
      totalUnits,
      totalUsd,
      extraNote: `Unidades movidas: ${totalMoved} uds`,
    },
  };
}

// ---------------------------------------------------------------------------
// 6) SALIDAS Y ENTRADAS (Movimientos Consolidados de Stock)
// ---------------------------------------------------------------------------

export function buildStockMovementsReportRows(
  state: AppState,
): StockMovementReportRow[] {
  const rows: StockMovementReportRow[] = [];

  // 1) Entradas por Compras recibidas en bodega
  for (const b of state.purchaseBatches ?? []) {
    if (b.status !== 'RECIBIDO EN BODEGA') continue;
    const date = extractDateOnly(b.receivedDate || b.entryDate || b.createdAt);
    const createdAt = b.receivedAt || b.createdAt;
    for (let idx = 0; idx < (b.items ?? []).length; idx += 1) {
      const it = b.items[idx];
      const qty = Math.max(0, Number(it.quantity) || 0);
      if (qty === 0) continue;
      rows.push({
        id: `mov-pur-${b.id}-${idx}`,
        date,
        createdAt,
        direction: 'Entrada',
        sourceType: 'Entrada · Compra',
        reference: b.referenceName,
        team: it.team || '',
        modelLabel: it.model,
        version: it.version,
        size: it.size,
        signedUnits: qty,
        absUnits: qty,
        amountUsd: round2(Number(it.lineLandedTotal) || qty * it.landedUnitCost),
        counterparty: b.supplier || 'Proveedor Asia',
        city: 'Bodega',
        seller: '',
        paymentCondition: '',
        shippingType: b.shippingType,
        detail: `Recepción FIFO (${b.shippingType})`,
      });
    }
  }

  // 2) Salidas por Ventas
  for (const s of state.sales ?? []) {
    if (s.voided) continue;
    const date = extractDateOnly(s.saleDate || s.createdAt);
    const paymentCondition: 'Contado' | 'Crédito' =
      s.paymentStatus === 'Pendiente' ? 'Crédito' : 'Contado';
    const customer = s.customerName || s.debtorName || 'Cliente Mostrador';
    const city = s.customerCity || 'N/D';
    const ref = s.invoiceNumber || 'S/N';

    if (s.items && s.items.length > 0) {
      s.items.forEach((it, idx) => {
        const qty = Math.max(1, Number(it.quantity) || 1);
        rows.push({
          id: `mov-sale-${s.id}-${idx}`,
          date,
          createdAt: s.createdAt,
          direction: 'Salida',
          sourceType: 'Salida · Venta',
          reference: ref,
          team: it.team || s.team || '',
          modelLabel: it.modelLabel || s.modelLabel,
          version: it.version || s.version,
          size: it.size || s.size,
          signedUnits: -qty,
          absUnits: qty,
          amountUsd: round2(Number(it.subtotal) || 0),
          counterparty: customer,
          city,
          seller: s.seller || 'Sin Asignar',
          paymentCondition,
          shippingType: '',
          detail: `${s.paymentMethod} (${paymentCondition})`,
        });
      });
    } else {
      const qty = Math.max(1, Number(s.quantity) || 1);
      rows.push({
        id: `mov-sale-${s.id}`,
        date,
        createdAt: s.createdAt,
        direction: 'Salida',
        sourceType: 'Salida · Venta',
        reference: ref,
        team: s.team || '',
        modelLabel: s.modelLabel,
        version: s.version,
        size: s.size,
        signedUnits: -qty,
        absUnits: qty,
        amountUsd: round2(Number(s.finalPrice) || 0),
        counterparty: customer,
        city,
        seller: s.seller || 'Sin Asignar',
        paymentCondition,
        shippingType: '',
        detail: `${s.paymentMethod} (${paymentCondition})`,
      });
    }
  }

  // 3) Entradas y Salidas por Devoluciones y Cambios
  const saleById = new Map((state.sales ?? []).map((s) => [s.id, s]));
  for (const r of state.returns ?? []) {
    const linkedSale = r.saleId ? saleById.get(r.saleId) : undefined;
    const date = extractDateOnly(r.createdAt);
    const ref = r.invoiceNumber || linkedSale?.invoiceNumber || r.type;
    const customer = r.customerName || linkedSale?.customerName || 'N/D';
    const city = linkedSale?.customerCity || 'N/D';
    const seller = linkedSale?.seller || '';

    rows.push({
      id: `mov-ret-in-${r.id}`,
      date,
      createdAt: r.createdAt,
      direction: 'Entrada',
      sourceType: 'Entrada · Devolución',
      reference: ref,
      team: '',
      modelLabel: r.returnedModelLabel,
      version: r.returnedVersion,
      size: r.returnedSize,
      signedUnits: r.returnedQuantity,
      absUnits: r.returnedQuantity,
      amountUsd: round2(r.returnedTotal),
      counterparty: customer,
      city,
      seller,
      paymentCondition: '',
      shippingType: '',
      detail: `${r.type}: ${r.reason}`,
    });

    if (r.replacementModelLabel && (r.replacementQuantity ?? 0) > 0) {
      const repQty = r.replacementQuantity ?? 0;
      rows.push({
        id: `mov-ret-out-${r.id}`,
        date,
        createdAt: r.createdAt,
        direction: 'Salida',
        sourceType: 'Salida · Cambio',
        reference: ref,
        team: '',
        modelLabel: r.replacementModelLabel,
        version: r.replacementVersion || r.returnedVersion,
        size: r.replacementSize || r.returnedSize,
        signedUnits: -repQty,
        absUnits: repQty,
        amountUsd: round2(r.replacementTotal ?? 0),
        counterparty: customer,
        city,
        seller,
        paymentCondition: '',
        shippingType: '',
        detail: `Reemplazo por ${r.type}`,
      });
    }
  }

  // 4) Entradas, Salidas y Descruces por Ajustes de Inventario
  for (const a of state.inventoryAdjustments ?? []) {
    const date = extractDateOnly(a.createdAt);
    const isUncross = a.adjustmentType === 'descruce';
    const isEntry = a.delta >= 0;
    const absDelta = Math.abs(a.delta);

    rows.push({
      id: `mov-adj-${a.id}`,
      date,
      createdAt: a.createdAt,
      direction: isEntry ? 'Entrada' : 'Salida',
      sourceType: isUncross
        ? isEntry
          ? 'Entrada · Descruce'
          : 'Salida · Descruce'
        : isEntry
          ? 'Entrada · Ajuste'
          : 'Salida · Ajuste',
      reference: 'Ajuste Inv.',
      team: '',
      modelLabel: a.modelLabel,
      version: a.version,
      size: a.size,
      signedUnits: a.delta,
      absUnits: absDelta,
      amountUsd: round2(a.fifoLossCost ?? 0),
      counterparty: a.userName || 'Admin',
      city: 'Bodega',
      seller: '',
      paymentCondition: '',
      shippingType: '',
      detail: a.reason,
    });

    if (isUncross && a.targetModelLabel && absDelta > 0) {
      rows.push({
        id: `mov-adj-target-${a.id}`,
        date,
        createdAt: a.createdAt,
        direction: 'Entrada',
        sourceType: 'Entrada · Descruce',
        reference: 'Descruce Inv.',
        team: '',
        modelLabel: a.targetModelLabel,
        version: a.targetVersion ?? a.version,
        size: a.targetSize ?? a.size,
        signedUnits: absDelta,
        absUnits: absDelta,
        amountUsd: 0,
        counterparty: a.userName || 'Admin',
        city: 'Bodega',
        seller: '',
        paymentCondition: '',
        shippingType: '',
        detail: `Compensación descruce desde ${a.modelLabel} (${a.size})`,
      });
    }
  }

  rows.sort((a, b) => {
    const dCmp = b.date.localeCompare(a.date);
    if (dCmp !== 0) return dCmp;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return rows;
}

export function filterStockMovementsReportRows(
  state: AppState,
  filters: ReportFilters,
): { rows: StockMovementReportRow[]; totals: ReportSummaryTotals } {
  const all = buildStockMovementsReportRows(state);
  const rows = all.filter((r) => {
    if (!matchesDateRange(r.date, filters.dateFrom, filters.dateTo)) return false;
    if (
      !matchesTextQuery(filters.search, [
        r.modelLabel,
        r.team,
        r.reference,
        r.counterparty,
        r.sourceType,
        r.detail,
      ])
    ) {
      return false;
    }
    if (!matchesSizeFilter(r.size, filters.size)) return false;
    if (!matchesVersionFilter(r.version, filters.version)) return false;
    if (!matchesTextQuery(filters.customer, [r.counterparty])) return false;
    if (!matchesTextQuery(filters.city, [r.city])) return false;
    if (filters.seller !== 'ALL' && !matchesSellerFilter(r.seller, filters.seller)) {
      return false;
    }
    if (
      filters.paymentCondition !== 'ALL' &&
      r.paymentCondition !== filters.paymentCondition
    ) {
      return false;
    }
    if (
      filters.shippingType !== 'ALL' &&
      normalizeReportText(r.shippingType) !== normalizeReportText(filters.shippingType)
    ) {
      return false;
    }
    if (
      !matchesAmountBounds(
        [r.amountUsd],
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      return false;
    }
    return true;
  });

  const entriesUnits = rows
    .filter((r) => r.signedUnits > 0)
    .reduce((sum, r) => sum + r.signedUnits, 0);
  const exitsUnits = rows
    .filter((r) => r.signedUnits < 0)
    .reduce((sum, r) => sum + Math.abs(r.signedUnits), 0);
  const totalMoved = rows.reduce((sum, r) => sum + r.absUnits, 0);
  const netUnits = entriesUnits - exitsUnits;
  const totalUsd = round2(rows.reduce((sum, r) => sum + r.amountUsd, 0));

  return {
    rows,
    totals: {
      filteredCount: rows.length,
      totalUnits: totalMoved,
      totalUsd,
      extraNote: `+${entriesUnits} entradas / -${exitsUnits} salidas (Neto: ${netUnits >= 0 ? `+${netUnits}` : netUnits})`,
    },
  };
}

// ---------------------------------------------------------------------------
// 7) CARGAS MASIVAS (Historial de Importaciones por Excel)
// ---------------------------------------------------------------------------

export function buildBulkImportsReportRows(state: AppState): BulkImportReportRow[] {
  const explicit: BulkImportReportRow[] = (state.bulkImports ?? []).map(
    (b: BulkImportRecord) => ({
      id: b.id,
      importDate: b.importDate || extractDateOnly(b.createdAt),
      createdAt: b.createdAt,
      fileName: b.fileName,
      userName: b.userName || 'Admin',
      status: b.status || 'Aplicada',
      sheetsText: (b.sheetsDetected ?? []).join(', ') || 'Compras, Ventas',
      comprasRows: b.comprasRows,
      comprasUnits: b.comprasUnits,
      comprasCostUsd: round2(b.comprasCostUsd),
      ventasRows: b.ventasRows,
      ventasUnits: b.ventasUnits,
      ventasRevenueUsd: round2(b.ventasRevenueUsd),
      resultingSkusCount: b.resultingSkusCount,
      resultingStockUnits: b.resultingStockUnits,
      cashOnHandUsd: round2(b.cashOnHandUsd),
      usdtRate: round2(b.usdtRate),
      bcvRate: round2(b.bcvRate),
      notes: b.notes || 'Sincronización Excel FIFO',
    }),
  );

  if (explicit.length > 0) return explicit;

  // Fallback si existen importaciones previas en movimientos sin registro en bulkImports
  const legacySyncMovs = (state.movements ?? []).filter((m) =>
    m.id.startsWith('mov-xlsx-sync-'),
  );
  if (legacySyncMovs.length === 0) return [];

  const xlsxBatches = (state.purchaseBatches ?? []).filter((b) =>
    b.id.startsWith('batch-xlsx-'),
  );
  const xlsxSales = (state.sales ?? []).filter(
    (s) => !s.voided && s.id.startsWith('sale-xlsx-'),
  );
  const comprasUnits = xlsxBatches.reduce((sum, b) => sum + b.totalUnits, 0);
  const comprasCostUsd = round2(
    xlsxBatches.reduce((sum, b) => sum + b.totalLandedCost, 0),
  );
  const ventasUnits = xlsxSales.reduce((sum, s) => sum + s.quantity, 0);
  const ventasRevenueUsd = round2(
    xlsxSales.reduce((sum, s) => sum + s.finalPrice, 0),
  );

  return legacySyncMovs.map((m) => ({
    id: m.id,
    importDate: extractDateOnly(m.createdAt),
    createdAt: m.createdAt,
    fileName: 'Respaldo Excel Histórico (.xlsx)',
    userName: 'Admin',
    status: 'Aplicada',
    sheetsText: 'Compras, Ventas, Finanzas',
    comprasRows: xlsxBatches.length,
    comprasUnits,
    comprasCostUsd,
    ventasRows: xlsxSales.length,
    ventasUnits,
    ventasRevenueUsd,
    resultingSkusCount: (state.inventory ?? []).length,
    resultingStockUnits: (state.inventory ?? []).reduce((s, i) => s + i.stock, 0),
    cashOnHandUsd: round2(m.amount || state.cashOnHand),
    usdtRate: round2(state.exchangeRates.usdt),
    bcvRate: round2(state.exchangeRates.bcv),
    notes: m.description,
  }));
}

export function filterBulkImportsReportRows(
  state: AppState,
  filters: ReportFilters,
): { rows: BulkImportReportRow[]; totals: ReportSummaryTotals } {
  const all = buildBulkImportsReportRows(state);
  const rows = all.filter((r) => {
    if (!matchesDateRange(r.importDate, filters.dateFrom, filters.dateTo)) {
      return false;
    }
    if (
      !matchesTextQuery(filters.search, [
        r.fileName,
        r.userName,
        r.sheetsText,
        r.notes,
        r.status,
      ])
    ) {
      return false;
    }
    if (
      !matchesAmountBounds(
        [
          r.comprasCostUsd,
          r.ventasRevenueUsd,
          round2(r.comprasCostUsd + r.ventasRevenueUsd),
          r.cashOnHandUsd,
        ],
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      return false;
    }
    return true;
  });

  const totalUnits = rows.reduce(
    (sum, r) => sum + r.comprasUnits + r.ventasUnits,
    0,
  );
  const totalUsd = round2(
    rows.reduce((sum, r) => sum + r.comprasCostUsd + r.ventasRevenueUsd, 0),
  );

  return {
    rows,
    totals: {
      filteredCount: rows.length,
      totalUnits,
      totalUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// 8) STOCK DISPONIBLE (Franelas con Stock > 0 por Talla y Valor FIFO)
// ---------------------------------------------------------------------------

export function formatExtraSizesSummary(
  extraSizes: InventorySizeMatrixRow['extraSizes'],
): string {
  const positive = extraSizes.filter((e) => e.stock > 0);
  if (positive.length === 0) return '—';
  return positive.map((e) => `${e.size}: ${e.stock}`).join(', ');
}

export function buildAvailableStockReportRows(
  state: AppState,
): AvailableStockReportRow[] {
  const usdtRate = Number(state.exchangeRates?.usdt) || 0;
  const matrix = getInventorySizeMatrix(state.inventory ?? []);

  return matrix
    .filter((row) => row.totalStock > 0)
    .map((row) => ({
      key: row.key,
      team: row.team,
      model: row.model,
      version: row.version,
      sizes: row.sizes,
      trackedSizes: row.trackedSizes,
      extraSizes: row.extraSizes,
      extraSizesText: formatExtraSizesSummary(row.extraSizes),
      totalStock: row.totalStock,
      salePrice: round2(row.salePrice),
      salePriceBs: round2(row.salePrice * usdtRate),
      avgCogs: round2(row.avgCogs),
      totalFifoValue: round2(row.totalFifoValue),
      isLowStock: row.isLowStock,
    }))
    .sort(
      (a, b) =>
        a.team.localeCompare(b.team) ||
        a.model.localeCompare(b.model) ||
        a.version.localeCompare(b.version),
    );
}

export function filterAvailableStockReportRows(
  state: AppState,
  filters: ReportFilters,
): { rows: AvailableStockReportRow[]; totals: ReportSummaryTotals } {
  const all = buildAvailableStockReportRows(state);
  const rows = all.filter((r) => {
    if (
      !matchesTextQuery(filters.search, [
        r.team,
        r.model,
        r.version,
        r.extraSizesText,
      ])
    ) {
      return false;
    }
    if (!matchesVersionFilter(r.version, filters.version)) return false;
    if (filters.size && filters.size !== 'ALL') {
      const targetSize = filters.size.trim().toUpperCase();
      if (targetSize in r.sizes) {
        if ((r.sizes[targetSize as keyof typeof r.sizes] ?? 0) <= 0) {
          return false;
        }
      } else {
        const hasExtra = r.extraSizes.some(
          (ex) => ex.size.trim().toUpperCase() === targetSize && ex.stock > 0,
        );
        if (!hasExtra) return false;
      }
    }
    if (
      !matchesAmountBounds(
        [r.salePrice, r.totalFifoValue],
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      return false;
    }
    return true;
  });

  const sumS = rows.reduce((s, r) => s + r.sizes.S, 0);
  const sumM = rows.reduce((s, r) => s + r.sizes.M, 0);
  const sumL = rows.reduce((s, r) => s + r.sizes.L, 0);
  const sumXL = rows.reduce((s, r) => s + r.sizes.XL, 0);
  const sumXXL = rows.reduce((s, r) => s + r.sizes.XXL, 0);
  const totalUnits = rows.reduce((s, r) => s + r.totalStock, 0);
  const totalUsd = round2(rows.reduce((s, r) => s + r.totalFifoValue, 0));

  return {
    rows,
    totals: {
      filteredCount: rows.length,
      totalUnits,
      totalUsd,
      extraNote: `S: ${sumS} · M: ${sumM} · L: ${sumL} · XL: ${sumXL} · XXL: ${sumXXL}`,
    },
  };
}

export function buildAvailableStockExcelPayload(
  matrixRows: Pick<
    InventorySizeMatrixRow,
    'team' | 'model' | 'version' | 'sizes' | 'extraSizes' | 'totalStock' | 'salePrice' | 'totalFifoValue'
  >[],
  usdtRate: number,
  dateIso: string = new Date().toISOString().slice(0, 10),
): ExcelSheetPayload {
  const safeRate = Number.isFinite(usdtRate) && usdtRate > 0 ? usdtRate : 0;
  const availableRows = matrixRows.filter((row) => row.totalStock > 0);

  const headers = [
    'Equipo',
    'Modelo',
    'Versión',
    'S',
    'M',
    'L',
    'XL',
    'XXL',
    'Otras Tallas',
    'Total Disponible',
    'Precio Venta (USDT)',
    'Precio Ref. (Bs)',
    'Valor Inventario FIFO (USDT)',
  ];

  const body = availableRows.map((row) => {
    const salePrice = round2(row.salePrice);
    const salePriceBs = round2(salePrice * safeRate);
    const fifoValue = round2(row.totalFifoValue);
    return [
      row.team,
      row.model,
      row.version,
      row.sizes.S,
      row.sizes.M,
      row.sizes.L,
      row.sizes.XL,
      row.sizes.XXL,
      formatExtraSizesSummary(row.extraSizes),
      row.totalStock,
      salePrice,
      salePriceBs,
      fifoValue,
    ];
  });

  const sumS = availableRows.reduce((s, r) => s + r.sizes.S, 0);
  const sumM = availableRows.reduce((s, r) => s + r.sizes.M, 0);
  const sumL = availableRows.reduce((s, r) => s + r.sizes.L, 0);
  const sumXL = availableRows.reduce((s, r) => s + r.sizes.XL, 0);
  const sumXXL = availableRows.reduce((s, r) => s + r.sizes.XXL, 0);
  const sumTotal = availableRows.reduce((s, r) => s + r.totalStock, 0);
  const sumFifo = round2(
    availableRows.reduce((s, r) => s + r.totalFifoValue, 0),
  );

  const totalsRow: (string | number)[] = [
    'TOTALES',
    `${availableRows.length} modelos`,
    '',
    sumS,
    sumM,
    sumL,
    sumXL,
    sumXXL,
    '',
    sumTotal,
    '',
    '',
    sumFifo,
  ];

  return {
    sheetName: 'Franelas Disponibles',
    fileName: `X4SPORT_Franelas_Disponibles_${dateIso}.xlsx`,
    headers,
    rows: body,
    totalsRow,
  };
}

// ---------------------------------------------------------------------------
// CONSTRUCCIÓN EXACTA PARA EXPORTACIÓN EXCEL (.XLSX) CON FILA DE TOTALES
// ---------------------------------------------------------------------------

export function buildReportExcelSheetData(
  reportType: ReportType,
  state: AppState,
  filters: ReportFilters,
): ExcelSheetPayload {
  const today = new Date().toISOString().slice(0, 10);

  if (reportType === 'inventario') {
    const { rows } = filterAvailableStockReportRows(state, filters);
    return buildAvailableStockExcelPayload(
      rows,
      state.exchangeRates?.usdt ?? 0,
      today,
    );
  }

  if (reportType === 'ventas') {
    const { rows, totals } = filterSalesReportRows(state, filters);
    const headers = [
      'Factura',
      'Fecha',
      'Cliente',
      'Ciudad / Ubicación',
      'Teléfono',
      'Equipo',
      'Modelo',
      'Versión',
      'Talla',
      'Cantidad',
      'Precio Unit. (USDT)',
      'Total (USDT)',
      'Vendedor',
      'Condición Pago',
      'Estatus',
      'Método Pago',
    ];
    const body = rows.map((r) => [
      r.invoiceNumber,
      r.date,
      r.customerName,
      r.customerCity,
      r.customerPhone,
      r.team,
      r.modelLabel,
      r.version,
      r.size,
      r.quantity,
      r.unitPrice,
      r.subtotal,
      r.seller,
      r.paymentCondition,
      r.paymentStatus,
      r.paymentMethod,
    ]);
    const totalsRow = [
      'TOTALES',
      `${totals.filteredCount} registros`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      totals.totalUnits,
      '',
      totals.totalUsd,
      '',
      '',
      '',
      '',
    ];
    return {
      sheetName: 'Reporte Ventas',
      fileName: `X4SPORT_Reporte_Ventas_${today}.xlsx`,
      headers,
      rows: body,
      totalsRow,
    };
  }

  if (reportType === 'compras') {
    const { rows, totals } = filterPurchasesReportRows(state, filters);
    const headers = [
      'Lote / Referencia',
      'Fecha',
      'Tipo Importación',
      'Estatus',
      'Proveedor',
      'Equipo',
      'Modelo',
      'Versión',
      'Talla',
      'Cantidad',
      'Costo Fábrica (USDT)',
      'Flete Prorr. (USDT)',
      'Costo Landed Unit. (USDT)',
      'Total Landed (USDT)',
      'Tasa USDT',
    ];
    const body = rows.map((r) => [
      r.referenceName,
      r.date,
      r.shippingType,
      r.status,
      r.supplier,
      r.team,
      r.model,
      r.version,
      r.size,
      r.quantity,
      r.factoryUnitCost,
      r.proratedFreightPerUnit,
      r.landedUnitCost,
      r.lineLandedTotal,
      r.usdtRate,
    ]);
    const totalsRow = [
      'TOTALES',
      `${totals.filteredCount} registros`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      totals.totalUnits,
      '',
      '',
      '',
      totals.totalUsd,
      '',
    ];
    return {
      sheetName: 'Reporte Compras',
      fileName: `X4SPORT_Reporte_Compras_${today}.xlsx`,
      headers,
      rows: body,
      totalsRow,
    };
  }

  if (reportType === 'clientes') {
    const { rows, totals } = filterCustomersReportRows(state, filters);
    const sumPurchases = rows.reduce((s, r) => s + r.purchasesCount, 0);
    const sumCash = round2(rows.reduce((s, r) => s + r.cashSpentUsd, 0));
    const sumCredit = round2(rows.reduce((s, r) => s + r.creditSpentUsd, 0));
    const sumCxc = round2(rows.reduce((s, r) => s + r.pendingCxcUsd, 0));
    const headers = [
      'Cliente',
      'Ciudad / Ubicación',
      'Teléfono',
      'Red Social',
      'Compras (#)',
      'Unidades',
      'Contado (USDT)',
      'Crédito (USDT)',
      'Total Comprado (USDT)',
      'Saldo CxC Pendiente (USDT)',
      'Última Compra',
      'Vendedores',
    ];
    const body = rows.map((r) => [
      r.customerName,
      r.city,
      r.phone,
      r.social,
      r.purchasesCount,
      r.unitsBought,
      r.cashSpentUsd,
      r.creditSpentUsd,
      r.totalSpentUsd,
      r.pendingCxcUsd,
      r.lastPurchaseDate,
      r.sellersSummary,
    ]);
    const totalsRow = [
      'TOTALES',
      `${totals.filteredCount} clientes`,
      '',
      '',
      sumPurchases,
      totals.totalUnits,
      sumCash,
      sumCredit,
      totals.totalUsd,
      sumCxc,
      '',
      '',
    ];
    return {
      sheetName: 'Reporte Clientes',
      fileName: `X4SPORT_Reporte_Clientes_${today}.xlsx`,
      headers,
      rows: body,
      totalsRow,
    };
  }

  if (reportType === 'devoluciones') {
    const { rows, totals } = filterReturnsReportRows(state, filters);
    const sumReturnedUsd = round2(
      rows.reduce((s, r) => s + r.returnedTotal, 0),
    );
    const headers = [
      'Fecha',
      'Tipo',
      'Factura Ref.',
      'Cliente',
      'Ciudad',
      'Prenda Devuelta',
      'Versión',
      'Talla',
      'Cant. Devuelta',
      'Valor Devuelto (USDT)',
      'Reemplazo',
      'Diferencia Neta (USDT)',
      'Método Pago',
      'Motivo',
    ];
    const body = rows.map((r) => [
      r.date,
      r.type,
      r.invoiceNumber,
      r.customerName,
      r.customerCity,
      r.returnedModelLabel,
      r.returnedVersion,
      r.returnedSize,
      r.returnedQuantity,
      r.returnedTotal,
      r.replacementModelLabel
        ? `${r.replacementQuantity}x ${r.replacementModelLabel} (${r.replacementSize})`
        : 'Reembolso',
      r.differenceUsd,
      r.paymentMethod,
      r.reason,
    ]);
    const totalsRow = [
      'TOTALES',
      `${totals.filteredCount} operaciones`,
      '',
      '',
      '',
      '',
      '',
      '',
      totals.totalUnits,
      sumReturnedUsd,
      '',
      totals.totalUsd,
      '',
      '',
    ];
    return {
      sheetName: 'Devoluciones y Cambios',
      fileName: `X4SPORT_Reporte_Devoluciones_${today}.xlsx`,
      headers,
      rows: body,
      totalsRow,
    };
  }

  if (reportType === 'ajustes') {
    const { rows, totals } = filterAdjustmentsReportRows(state, filters);
    const headers = [
      'Fecha',
      'Tipo Ajuste',
      'Modelo',
      'Versión',
      'Talla',
      'Destino (Descruce)',
      'Stock Previo',
      'Nuevo Stock',
      'Variación (uds)',
      'Costo Merma FIFO (USDT)',
      'Motivo',
      'Responsable',
    ];
    const body = rows.map((r) => [
      r.date,
      r.adjustmentType,
      r.modelLabel,
      r.version,
      r.size,
      r.targetModelLabel
        ? `${r.targetModelLabel} (${r.targetVersion || r.version} · ${r.targetSize})`
        : 'N/A',
      r.previousStock,
      r.newStock,
      r.delta,
      r.fifoLossCost,
      r.reason,
      r.userName,
    ]);
    const totalsRow = [
      'TOTALES',
      `${totals.filteredCount} ajustes`,
      '',
      '',
      '',
      '',
      '',
      '',
      totals.totalUnits,
      totals.totalUsd,
      '',
      '',
    ];
    return {
      sheetName: 'Ajustes de Inventario',
      fileName: `X4SPORT_Reporte_Ajustes_${today}.xlsx`,
      headers,
      rows: body,
      totalsRow,
    };
  }

  if (reportType === 'movimientos') {
    const { rows, totals } = filterStockMovementsReportRows(state, filters);
    const netUnits = rows.reduce((s, r) => s + r.signedUnits, 0);
    const headers = [
      'Fecha',
      'Dirección',
      'Origen',
      'Referencia',
      'Modelo',
      'Versión',
      'Talla',
      'Variación (+/-)',
      'Unidades Movidas',
      'Valor (USDT)',
      'Cliente / Proveedor',
      'Ciudad',
      'Vendedor',
      'Condición Pago',
      'Importación',
      'Detalle',
    ];
    const body = rows.map((r) => [
      r.date,
      r.direction,
      r.sourceType,
      r.reference,
      r.modelLabel,
      r.version,
      r.size,
      r.signedUnits,
      r.absUnits,
      r.amountUsd,
      r.counterparty,
      r.city,
      r.seller || 'N/A',
      r.paymentCondition || 'N/A',
      r.shippingType || 'N/A',
      r.detail,
    ]);
    const totalsRow = [
      'TOTALES',
      `${totals.filteredCount} movimientos`,
      '',
      '',
      '',
      '',
      '',
      netUnits,
      totals.totalUnits,
      totals.totalUsd,
      '',
      '',
      '',
      '',
      '',
      '',
    ];
    return {
      sheetName: 'Salidas y Entradas',
      fileName: `X4SPORT_Reporte_Salidas_Entradas_${today}.xlsx`,
      headers,
      rows: body,
      totalsRow,
    };
  }

  // cargas
  const { rows, totals } = filterBulkImportsReportRows(state, filters);
  const sumComprasUnits = rows.reduce((s, r) => s + r.comprasUnits, 0);
  const sumComprasUsd = round2(rows.reduce((s, r) => s + r.comprasCostUsd, 0));
  const sumVentasUnits = rows.reduce((s, r) => s + r.ventasUnits, 0);
  const sumVentasUsd = round2(rows.reduce((s, r) => s + r.ventasRevenueUsd, 0));

  const headers = [
    'Fecha Carga',
    'Archivo (.xlsx)',
    'Usuario',
    'Estado',
    'Hojas Detectadas',
    'Filas Compras',
    'Uds Compras',
    'Costo Compras (USDT)',
    'Filas Ventas',
    'Uds Ventas',
    'Ingresos Ventas (USDT)',
    'SKUs Resultantes',
    'Stock Final (uds)',
    'Caja (USDT)',
    'Tasa USDT',
    'Notas',
  ];
  const body = rows.map((r) => [
    r.importDate,
    r.fileName,
    r.userName,
    r.status,
    r.sheetsText,
    r.comprasRows,
    r.comprasUnits,
    r.comprasCostUsd,
    r.ventasRows,
    r.ventasUnits,
    r.ventasRevenueUsd,
    r.resultingSkusCount,
    r.resultingStockUnits,
    r.cashOnHandUsd,
    r.usdtRate,
    r.notes,
  ]);
  const totalsRow = [
    'TOTALES',
    `${totals.filteredCount} cargas`,
    '',
    '',
    '',
    '',
    sumComprasUnits,
    sumComprasUsd,
    '',
    sumVentasUnits,
    sumVentasUsd,
    '',
    '',
    '',
    '',
    `Volumen Total: $${totals.totalUsd.toFixed(2)} USDT (${totals.totalUnits} uds)`,
  ];
  return {
    sheetName: 'Cargas Masivas',
    fileName: `X4SPORT_Reporte_Cargas_Masivas_${today}.xlsx`,
    headers,
    rows: body,
    totalsRow,
  };
}
