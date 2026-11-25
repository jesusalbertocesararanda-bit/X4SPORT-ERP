import { getDefaultSalePrice } from '../data/initialState';
import type {
  AppState,
  JerseySize,
  JerseyVersion,
  ShippingType,
} from '../types/erp';
import {
  extractTeamFromModel,
  normalizeVersionDisplay,
  round2,
} from './finance';
import { COMPRAS_MASIVAS_HEADERS } from './bulkImport';

export type RankingPeriodMode = 'week' | 'month' | 'custom';

export interface TopModelRankingRow {
  key: string;
  modelLabel: string;
  version: JerseyVersion;
  team: string;
  unitsSold: number;
  pct: number;
  revenueUsd: number;
  avgSalePrice: number;
}

export interface SizeRankingRow {
  size: string;
  unitsSold: number;
  pct: number;
  revenueUsd: number;
}

export interface SalesRankingResult {
  dateFrom: string;
  dateTo: string;
  totalUnitsSold: number;
  totalRevenueUsd: number;
  topModels: TopModelRankingRow[];
  sizeRanking: SizeRankingRow[];
}

export interface ModelVersionOption {
  key: string;
  model: string;
  version: JerseyVersion;
  team: string;
}

export interface ModelCostHistoryEntry {
  id: string;
  entryDate: string;
  batchName: string;
  shippingType: ShippingType | 'Histórico';
  supplier: string;
  size: JerseySize;
  quantity: number;
  factoryUnitCost: number;
  freightPerUnit: number;
  landedUnitCost: number;
  salePrice: number;
  realMarginUsd: number;
  realMarginPct: number;
  usdtRate?: number;
}

export interface ModelCostHistorySummary {
  key: string;
  model: string;
  version: JerseyVersion;
  team: string;
  entries: ModelCostHistoryEntry[];
  firstLandedCost: number;
  lastLandedCost: number;
  costDeltaUsd: number;
  costDeltaPct: number;
  avgLandedCost: number;
  currentRetailPrice: number;
  realAvgSalePrice: number;
  unitsSoldTotal: number;
  currentMarginUsd: number;
  currentMarginPct: number;
}

export interface LowRotationAlertItem {
  skuId: string;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  currentStock: number;
  historicalSold: number;
  daysSinceLastSale: number | null;
  reason: string;
}

export interface RecommendedOrderLine {
  team: string;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  currentStock: number;
  historicalSold: number;
  salesSharePct: number;
  factoryUnitCost: number;
  freightUnitCost: number;
  landedUnitCost: number;
  recommendedQty: number;
  lineTotalCost: number;
  suggestedSalePrice: number;
}

export interface SmartOrderRecommendation {
  capitalUsd: number;
  shippingType: ShippingType;
  totalUnits: number;
  totalAllocatedUsd: number;
  remainingUsd: number;
  lines: RecommendedOrderLine[];
  sizeBreakdown: Array<{ size: string; units: number; pct: number }>;
  lowRotationAlerts: LowRotationAlertItem[];
  sourceNote: string;
}

const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;

function norm(val: unknown): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractSaleDate(saleDate?: string, createdAt?: string): string {
  const raw = (saleDate || createdAt || '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

export function resolvePeriodRange(
  mode: RankingPeriodMode,
  options: {
    anchorDate?: string;
    monthStr?: string;
    customFrom?: string;
    customTo?: string;
  },
): { dateFrom: string; dateTo: string } {
  const today = options.anchorDate?.trim() || new Date().toISOString().slice(0, 10);

  if (mode === 'week') {
    const endMs = Date.parse(`${today}T00:00:00Z`);
    const startMs = Number.isFinite(endMs)
      ? endMs - 6 * 86_400_000
      : Date.now() - 6 * 86_400_000;
    const from = new Date(startMs).toISOString().slice(0, 10);
    return { dateFrom: from, dateTo: today };
  }

  if (mode === 'month') {
    const m =
      options.monthStr && /^\d{4}-\d{2}$/.test(options.monthStr)
        ? options.monthStr
        : today.slice(0, 7);
    const [yearNum, monthNum] = m.split('-').map(Number);
    const lastDay = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
    return {
      dateFrom: `${m}-01`,
      dateTo: `${m}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  return {
    dateFrom: options.customFrom?.trim() || '',
    dateTo: options.customTo?.trim() || '',
  };
}

// ---------------------------------------------------------------------------
// 1. RANKING SEMANAL Y MENSUAL
// ---------------------------------------------------------------------------

export function computeSalesRanking(
  state: AppState,
  mode: RankingPeriodMode,
  options: {
    anchorDate?: string;
    monthStr?: string;
    customFrom?: string;
    customTo?: string;
  } = {},
): SalesRankingResult {
  const { dateFrom, dateTo } = resolvePeriodRange(mode, options);

  const modelMap = new Map<
    string,
    {
      modelLabel: string;
      version: JerseyVersion;
      team: string;
      unitsSold: number;
      revenueUsd: number;
    }
  >();

  const sizeMap = new Map<string, { unitsSold: number; revenueUsd: number }>();
  for (const s of STANDARD_SIZES) {
    sizeMap.set(s, { unitsSold: 0, revenueUsd: 0 });
  }

  let totalUnitsSold = 0;
  let totalRevenueUsd = 0;

  for (const sale of state.sales ?? []) {
    if (sale.voided) continue;
    const sDate = extractSaleDate(sale.saleDate, sale.createdAt);
    if (dateFrom && (!sDate || sDate < dateFrom)) continue;
    if (dateTo && (!sDate || sDate > dateTo)) continue;

    const lines =
      sale.items && sale.items.length > 0
        ? sale.items.map((it) => ({
            modelLabel: it.modelLabel || sale.modelLabel,
            version: normalizeVersionDisplay(it.version || sale.version),
            team: it.team || sale.team || extractTeamFromModel(it.modelLabel),
            size: String(it.size || sale.size).trim().toUpperCase(),
            quantity: Math.max(0, Number(it.quantity) || 0),
            subtotal: round2(Number(it.subtotal) || 0),
          }))
        : [
            {
              modelLabel: sale.modelLabel,
              version: normalizeVersionDisplay(sale.version),
              team: sale.team || extractTeamFromModel(sale.modelLabel),
              size: String(sale.size).trim().toUpperCase(),
              quantity: Math.max(0, Number(sale.quantity) || 0),
              subtotal: round2(Number(sale.finalPrice) || 0),
            },
          ];

    for (const line of lines) {
      if (line.quantity <= 0) continue;
      totalUnitsSold += line.quantity;
      totalRevenueUsd = round2(totalRevenueUsd + line.subtotal);

      const mKey = `${norm(line.modelLabel)}|${line.version}`;
      const existingModel = modelMap.get(mKey);
      if (existingModel) {
        existingModel.unitsSold += line.quantity;
        existingModel.revenueUsd = round2(
          existingModel.revenueUsd + line.subtotal,
        );
      } else {
        modelMap.set(mKey, {
          modelLabel: line.modelLabel,
          version: line.version,
          team: line.team,
          unitsSold: line.quantity,
          revenueUsd: line.subtotal,
        });
      }

      const szEntry = sizeMap.get(line.size) ?? { unitsSold: 0, revenueUsd: 0 };
      szEntry.unitsSold += line.quantity;
      szEntry.revenueUsd = round2(szEntry.revenueUsd + line.subtotal);
      sizeMap.set(line.size, szEntry);
    }
  }

  const topModels: TopModelRankingRow[] = Array.from(modelMap.entries())
    .map(([key, m]) => ({
      key,
      modelLabel: m.modelLabel,
      version: m.version,
      team: m.team,
      unitsSold: m.unitsSold,
      pct:
        totalUnitsSold > 0
          ? round2((m.unitsSold / totalUnitsSold) * 100)
          : 0,
      revenueUsd: m.revenueUsd,
      avgSalePrice: m.unitsSold > 0 ? round2(m.revenueUsd / m.unitsSold) : 0,
    }))
    .sort((a, b) => {
      if (b.unitsSold !== a.unitsSold) return b.unitsSold - a.unitsSold;
      return b.revenueUsd - a.revenueUsd;
    });

  const sizeRanking: SizeRankingRow[] = Array.from(sizeMap.entries())
    .filter(([sz, data]) => (STANDARD_SIZES as readonly string[]).includes(sz) || data.unitsSold > 0)
    .map(([size, data]) => ({
      size,
      unitsSold: data.unitsSold,
      pct:
        totalUnitsSold > 0
          ? round2((data.unitsSold / totalUnitsSold) * 100)
          : 0,
      revenueUsd: data.revenueUsd,
    }))
    .sort((a, b) => {
      if (b.unitsSold !== a.unitsSold) return b.unitsSold - a.unitsSold;
      const idxA = (STANDARD_SIZES as readonly string[]).indexOf(a.size);
      const idxB = (STANDARD_SIZES as readonly string[]).indexOf(b.size);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

  return {
    dateFrom,
    dateTo,
    totalUnitsSold,
    totalRevenueUsd,
    topModels,
    sizeRanking,
  };
}

// ---------------------------------------------------------------------------
// 2. HISTORIAL DE PRECIOS Y COSTOS POR MODELO
// ---------------------------------------------------------------------------

export function getAvailableModelsForCostHistory(
  state: AppState,
): ModelVersionOption[] {
  const map = new Map<string, ModelVersionOption>();

  const register = (model: string, version: JerseyVersion, team?: string) => {
    const cleanModel = model.trim();
    if (!cleanModel) return;
    const ver = normalizeVersionDisplay(version);
    const key = `${norm(cleanModel)}|${ver}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        model: cleanModel,
        version: ver,
        team: team || extractTeamFromModel(cleanModel),
      });
    }
  };

  for (const pb of state.purchaseBatches ?? []) {
    for (const it of pb.items ?? []) {
      register(it.model, it.version, it.team);
    }
  }
  for (const item of state.inventory ?? []) {
    register(item.model, item.version, item.team);
  }
  for (const sale of state.sales ?? []) {
    if (sale.items && sale.items.length > 0) {
      for (const it of sale.items) {
        register(it.modelLabel, it.version, it.team);
      }
    } else {
      register(sale.modelLabel, sale.version, sale.team);
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.model.localeCompare(b.model),
  );
}

export function computeModelCostHistory(
  state: AppState,
  selectedKey: string,
): ModelCostHistorySummary | null {
  const options = getAvailableModelsForCostHistory(state);
  const selected =
    options.find((o) => o.key === selectedKey) ?? options[0] ?? null;
  if (!selected) return null;

  // Compute real average sale price & units sold from state.sales
  let unitsSoldTotal = 0;
  let revenueSoldTotal = 0;
  for (const sale of state.sales ?? []) {
    if (sale.voided) continue;
    const lines =
      sale.items && sale.items.length > 0
        ? sale.items
        : [
            {
              modelLabel: sale.modelLabel,
              version: sale.version,
              quantity: sale.quantity,
              unitPrice:
                sale.quantity > 0 ? round2(sale.finalPrice / sale.quantity) : 0,
              subtotal: sale.finalPrice,
            },
          ];
    for (const line of lines) {
      const k = `${norm(line.modelLabel)}|${normalizeVersionDisplay(line.version)}`;
      if (k !== selected.key) continue;
      unitsSoldTotal += Math.max(0, Number(line.quantity) || 0);
      revenueSoldTotal = round2(revenueSoldTotal + (Number(line.subtotal) || 0));
    }
  }

  // Current inventory retail price
  const matchingInv = (state.inventory ?? []).filter(
    (it) =>
      `${norm(it.model)}|${normalizeVersionDisplay(it.version)}` === selected.key,
  );
  const currentRetailPrice =
    matchingInv.find((it) => it.salePrice > 0)?.salePrice ??
    getDefaultSalePrice(selected.version, selected.model);

  const realAvgSalePrice =
    unitsSoldTotal > 0
      ? round2(revenueSoldTotal / unitsSoldTotal)
      : round2(currentRetailPrice);

  const entries: ModelCostHistoryEntry[] = [];
  const seenBatchIds = new Set<string>();

  for (const pb of state.purchaseBatches ?? []) {
    pb.items.forEach((it, idx) => {
      const k = `${norm(it.model)}|${normalizeVersionDisplay(it.version)}`;
      if (k !== selected.key) return;
      const qty = Math.max(0, Number(it.quantity) || 0);
      const factory = round2(Number(it.factoryUnitCost) || 0);
      const freight = round2(Number(it.proratedFreightPerUnit) || 0);
      const landed = round2(
        Number(it.landedUnitCost) || round2(factory + freight),
      );
      const effectiveSalePrice =
        it.salePrice && it.salePrice > 0
          ? round2(it.salePrice)
          : realAvgSalePrice;
      const marginUsd = round2(effectiveSalePrice - landed);
      const marginPct =
        effectiveSalePrice > 0
          ? round2((marginUsd / effectiveSalePrice) * 100)
          : 0;

      seenBatchIds.add(`${pb.referenceName}|${pb.entryDate}|${it.size}`);
      entries.push({
        id: `${pb.id}-${idx}`,
        entryDate: pb.entryDate,
        batchName: pb.referenceName,
        shippingType: pb.shippingType,
        supplier:
          pb.supplier ||
          (pb.referenceName.toLowerCase().includes('alibaba')
            ? 'Alibaba / 1688'
            : '1688 / Alibaba + Flete'),
        size: it.size,
        quantity: qty,
        factoryUnitCost: factory,
        freightPerUnit: freight,
        landedUnitCost: landed,
        salePrice: effectiveSalePrice,
        realMarginUsd: marginUsd,
        realMarginPct: marginPct,
        usdtRate: pb.usdtRate,
      });
    });
  }

  for (const item of matchingInv) {
    for (const fb of item.fifoBatches ?? []) {
      const dupKey = `${fb.batchName}|${fb.entryDate}|${item.size}`;
      if (seenBatchIds.has(dupKey)) continue;
      const landed = round2(fb.unitCost);
      const effectiveSalePrice =
        realAvgSalePrice > 0 ? realAvgSalePrice : item.salePrice;
      const marginUsd = round2(effectiveSalePrice - landed);
      const marginPct =
        effectiveSalePrice > 0
          ? round2((marginUsd / effectiveSalePrice) * 100)
          : 0;
      entries.push({
        id: `fifo-${item.id}-${fb.batchId}`,
        entryDate: fb.entryDate,
        batchName: fb.batchName,
        shippingType: 'Histórico',
        supplier: '1688 / Alibaba (FIFO)',
        size: item.size,
        quantity: fb.initialQuantity,
        factoryUnitCost: landed,
        freightPerUnit: 0,
        landedUnitCost: landed,
        salePrice: effectiveSalePrice,
        realMarginUsd: marginUsd,
        realMarginPct: marginPct,
        usdtRate: fb.usdtRate,
      });
    }
  }

  entries.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  const firstLandedCost = entries[0]?.landedUnitCost ?? 0;
  const lastLandedCost = entries[entries.length - 1]?.landedUnitCost ?? 0;
  const costDeltaUsd = round2(lastLandedCost - firstLandedCost);
  const costDeltaPct =
    firstLandedCost > 0 ? round2((costDeltaUsd / firstLandedCost) * 100) : 0;

  const totalCostQty = entries.reduce((s, e) => s + Math.max(1, e.quantity), 0);
  const totalCostSum = entries.reduce(
    (s, e) => s + e.landedUnitCost * Math.max(1, e.quantity),
    0,
  );
  const avgLandedCost =
    totalCostQty > 0 ? round2(totalCostSum / totalCostQty) : 0;

  const refCost = lastLandedCost > 0 ? lastLandedCost : avgLandedCost;
  const currentMarginUsd = round2(realAvgSalePrice - refCost);
  const currentMarginPct =
    realAvgSalePrice > 0
      ? round2((currentMarginUsd / realAvgSalePrice) * 100)
      : 0;

  return {
    key: selected.key,
    model: selected.model,
    version: selected.version,
    team: selected.team,
    entries,
    firstLandedCost,
    lastLandedCost,
    costDeltaUsd,
    costDeltaPct,
    avgLandedCost,
    currentRetailPrice: round2(currentRetailPrice),
    realAvgSalePrice,
    unitsSoldTotal,
    currentMarginUsd,
    currentMarginPct,
  };
}

// ---------------------------------------------------------------------------
// 3. RECOMENDADOR INTELIGENTE DE PEDIDOS
// ---------------------------------------------------------------------------

interface SkuStatsBucket {
  key: string;
  team: string;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  currentStock: number;
  historicalSold: number;
  lastSaleDate: string;
  factoryUnitCost: number;
  freightUnitCost: number;
  landedUnitCost: number;
  suggestedSalePrice: number;
}

export function computeSmartOrderRecommendation(
  state: AppState,
  capitalUsdRaw: number,
  shippingType: ShippingType = 'Aéreo',
  referenceDate = new Date().toISOString().slice(0, 10),
): SmartOrderRecommendation {
  const capitalUsd = round2(Math.max(0, Number(capitalUsdRaw) || 0));
  const buckets = new Map<string, SkuStatsBucket>();

  const makeKey = (model: string, ver: JerseyVersion, size: string) =>
    `${norm(model)}|${normalizeVersionDisplay(ver)}|${String(size).trim().toUpperCase()}`;

  // Build cost lookup from purchaseBatches (most recent or avg per model+version)
  const costLookup = new Map<
    string,
    { factory: number; freight: number; landed: number; count: number }
  >();
  for (const pb of state.purchaseBatches ?? []) {
    for (const it of pb.items ?? []) {
      const mKey = `${norm(it.model)}|${normalizeVersionDisplay(it.version)}`;
      const prev = costLookup.get(mKey) ?? {
        factory: 0,
        freight: 0,
        landed: 0,
        count: 0,
      };
      const q = Math.max(1, it.quantity);
      prev.factory += it.factoryUnitCost * q;
      prev.freight += it.proratedFreightPerUnit * q;
      prev.landed += it.landedUnitCost * q;
      prev.count += q;
      costLookup.set(mKey, prev);
    }
  }

  const getUnitCosts = (
    model: string,
    version: JerseyVersion,
    fallbackCogs = 6.5,
  ) => {
    const mKey = `${norm(model)}|${normalizeVersionDisplay(version)}`;
    const found = costLookup.get(mKey);
    if (found && found.count > 0) {
      const factory = round2(found.factory / found.count);
      const freight = round2(found.freight / found.count);
      const landed = round2(found.landed / found.count);
      return {
        factory: factory > 0 ? factory : landed,
        freight: Math.max(0, freight),
        landed: landed > 0 ? landed : round2(factory + freight),
      };
    }
    const base = fallbackCogs > 0 ? round2(fallbackCogs) : 6.5;
    const estFreight = shippingType === 'Aéreo' ? 1.5 : 0.8;
    const estFactory = round2(Math.max(1, base - estFreight));
    return {
      factory: estFactory,
      freight: round2(base - estFactory),
      landed: base,
    };
  };

  // Seed buckets from inventory
  for (const inv of state.inventory ?? []) {
    const ver = normalizeVersionDisplay(inv.version);
    const sz = String(inv.size).trim().toUpperCase() as JerseySize;
    const key = makeKey(inv.model, ver, sz);
    const costs = getUnitCosts(inv.model, ver, inv.cogs);
    const existing = buckets.get(key);
    if (existing) {
      existing.currentStock += Math.max(0, inv.stock);
    } else {
      buckets.set(key, {
        key,
        team: inv.team || extractTeamFromModel(inv.model),
        model: inv.model,
        version: ver,
        size: sz,
        currentStock: Math.max(0, inv.stock),
        historicalSold: 0,
        lastSaleDate: '',
        factoryUnitCost: costs.factory,
        freightUnitCost: costs.freight,
        landedUnitCost: costs.landed,
        suggestedSalePrice:
          inv.salePrice > 0
            ? round2(inv.salePrice)
            : getDefaultSalePrice(ver, inv.model),
      });
    }
  }

  // Accumulate historical sales
  for (const sale of state.sales ?? []) {
    if (sale.voided) continue;
    const sDate = extractSaleDate(sale.saleDate, sale.createdAt);
    const lines =
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
              unitPrice:
                sale.quantity > 0 ? round2(sale.finalPrice / sale.quantity) : 0,
            },
          ];

    for (const line of lines) {
      const qty = Math.max(0, Number(line.quantity) || 0);
      if (qty <= 0) continue;
      const ver = normalizeVersionDisplay(line.version);
      const sz = String(line.size).trim().toUpperCase() as JerseySize;
      const key = makeKey(line.modelLabel, ver, sz);
      let bucket = buckets.get(key);
      if (!bucket) {
        const costs = getUnitCosts(line.modelLabel, ver, line.unitCogs);
        bucket = {
          key,
          team: line.team || extractTeamFromModel(line.modelLabel),
          model: line.modelLabel,
          version: ver,
          size: sz,
          currentStock: 0,
          historicalSold: 0,
          lastSaleDate: '',
          factoryUnitCost: costs.factory,
          freightUnitCost: costs.freight,
          landedUnitCost: costs.landed,
          suggestedSalePrice:
            line.unitPrice > 0
              ? round2(line.unitPrice)
              : getDefaultSalePrice(ver, line.modelLabel),
        };
        buckets.set(key, bucket);
      }
      bucket.historicalSold += qty;
      if (sDate && (!bucket.lastSaleDate || sDate > bucket.lastSaleDate)) {
        bucket.lastSaleDate = sDate;
      }
    }
  }

  // Detect low-rotation / stagnant stock alerts ("No traer en exceso")
  const refMs = Date.parse(`${referenceDate}T00:00:00Z`);
  const lowRotationAlerts: LowRotationAlertItem[] = [];
  const lowRotationKeys = new Set<string>();

  for (const b of buckets.values()) {
    if (b.currentStock <= 0) continue;
    let daysSinceLastSale: number | null = null;
    if (b.lastSaleDate && Number.isFinite(refMs)) {
      const lastMs = Date.parse(`${b.lastSaleDate}T00:00:00Z`);
      if (Number.isFinite(lastMs)) {
        daysSinceLastSale = Math.max(
          0,
          Math.round((refMs - lastMs) / 86_400_000),
        );
      }
    }

    let reason = '';
    if (b.historicalSold === 0 && b.currentStock >= 1) {
      reason = `0 ventas históricas con ${b.currentStock} ud(s) estancadas en bodega`;
    } else if (b.currentStock >= Math.max(4, b.historicalSold * 2)) {
      reason = `Sobre-stock (${b.currentStock} uds en bodega vs ${b.historicalSold} vendidas)`;
    } else if (
      daysSinceLastSale !== null &&
      daysSinceLastSale >= 30 &&
      b.currentStock >= 3
    ) {
      reason = `Sin salidas en ${daysSinceLastSale} días (${b.currentStock} uds aún en stock)`;
    }

    if (reason) {
      lowRotationKeys.add(b.key);
      lowRotationAlerts.push({
        skuId: b.key,
        model: b.model,
        version: b.version,
        size: b.size,
        currentStock: b.currentStock,
        historicalSold: b.historicalSold,
        daysSinceLastSale,
        reason,
      });
    }
  }

  lowRotationAlerts.sort((a, b) => b.currentStock - a.currentStock);

  // Build candidate weights for recommendation
  const totalHistoricalSold = Array.from(buckets.values()).reduce(
    (s, b) => s + b.historicalSold,
    0,
  );

  interface WeightedCandidate {
    bucket: SkuStatsBucket;
    weight: number;
    salesSharePct: number;
  }

  const candidates: WeightedCandidate[] = [];

  if (totalHistoricalSold > 0) {
    for (const b of buckets.values()) {
      if (b.historicalSold <= 0) continue;
      if (lowRotationKeys.has(b.key)) continue;
      // Prioritize items where stock is low relative to historical demand
      const stockPenalty =
        b.currentStock > 0
          ? Math.max(0.25, 1 - b.currentStock / (b.historicalSold * 2 + 2))
          : 1.15;
      const weight = b.historicalSold * stockPenalty;
      candidates.push({
        bucket: b,
        weight,
        salesSharePct: round2((b.historicalSold / totalHistoricalSold) * 100),
      });
    }

    // Fallback if all sold SKUs were flagged low-rotation
    if (candidates.length === 0) {
      for (const b of buckets.values()) {
        if (b.historicalSold <= 0) continue;
        candidates.push({
          bucket: b,
          weight: b.historicalSold,
          salesSharePct: round2((b.historicalSold / totalHistoricalSold) * 100),
        });
      }
    }
  } else {
    // No sales yet -> use active inventory or standard size distribution curve
    const fallbackCurve: Record<string, number> = {
      M: 35,
      L: 30,
      XL: 15,
      S: 15,
      XXL: 5,
    };
    const invList = Array.from(buckets.values());
    if (invList.length > 0) {
      const totalInvW = invList.reduce(
        (s, b) => s + (fallbackCurve[b.size] ?? 10),
        0,
      );
      for (const b of invList) {
        const w = fallbackCurve[b.size] ?? 10;
        candidates.push({
          bucket: b,
          weight: w,
          salesSharePct: round2((w / totalInvW) * 100),
        });
      }
    }
  }

  if (capitalUsd <= 0 || candidates.length === 0) {
    return {
      capitalUsd,
      shippingType,
      totalUnits: 0,
      totalAllocatedUsd: 0,
      remainingUsd: capitalUsd,
      lines: [],
      sizeBreakdown: STANDARD_SIZES.map((s) => ({ size: s, units: 0, pct: 0 })),
      lowRotationAlerts,
      sourceNote:
        candidates.length === 0
          ? 'Registra ventas o inventario base para generar recomendaciones automáticas.'
          : 'Ingresa un capital mayor a $0.00 USDT para calcular el pedido.',
    };
  }

  candidates.sort((a, b) => b.weight - a.weight);
  const sumWeight = candidates.reduce((s, c) => s + c.weight, 0);

  const qtyMap = new Map<string, number>();
  let spentUsd = 0;

  // Pass 1: proportional floor allocation
  for (const c of candidates) {
    const unitCost = c.bucket.landedUnitCost;
    if (unitCost <= 0) continue;
    const shareBudget = (capitalUsd * c.weight) / sumWeight;
    const qty = Math.floor(shareBudget / unitCost);
    if (qty > 0 && round2(spentUsd + qty * unitCost) <= capitalUsd) {
      qtyMap.set(c.bucket.key, qty);
      spentUsd = round2(spentUsd + qty * unitCost);
    } else {
      qtyMap.set(c.bucket.key, 0);
    }
  }

  // Pass 2: greedy remainder fill by weight priority so capital is efficiently used
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;
    for (const c of candidates) {
      const unitCost = c.bucket.landedUnitCost;
      if (unitCost <= 0) continue;
      if (round2(spentUsd + unitCost) <= capitalUsd) {
        qtyMap.set(c.bucket.key, (qtyMap.get(c.bucket.key) ?? 0) + 1);
        spentUsd = round2(spentUsd + unitCost);
        madeProgress = true;
      }
    }
  }

  const lines: RecommendedOrderLine[] = candidates
    .map((c) => {
      const qty = qtyMap.get(c.bucket.key) ?? 0;
      return {
        team: c.bucket.team,
        model: c.bucket.model,
        version: c.bucket.version,
        size: c.bucket.size,
        currentStock: c.bucket.currentStock,
        historicalSold: c.bucket.historicalSold,
        salesSharePct: c.salesSharePct,
        factoryUnitCost: c.bucket.factoryUnitCost,
        freightUnitCost: c.bucket.freightUnitCost,
        landedUnitCost: c.bucket.landedUnitCost,
        recommendedQty: qty,
        lineTotalCost: round2(qty * c.bucket.landedUnitCost),
        suggestedSalePrice: c.bucket.suggestedSalePrice,
      };
    })
    .filter((l) => l.recommendedQty > 0);

  const totalUnits = lines.reduce((s, l) => s + l.recommendedQty, 0);
  const totalAllocatedUsd = round2(
    lines.reduce((s, l) => s + l.lineTotalCost, 0),
  );
  const remainingUsd = round2(Math.max(0, capitalUsd - totalAllocatedUsd));

  const sizeTotals = new Map<string, number>();
  for (const s of STANDARD_SIZES) sizeTotals.set(s, 0);
  for (const l of lines) {
    sizeTotals.set(l.size, (sizeTotals.get(l.size) ?? 0) + l.recommendedQty);
  }
  const sizeBreakdown = Array.from(sizeTotals.entries()).map(([size, units]) => ({
    size,
    units,
    pct: totalUnits > 0 ? round2((units / totalUnits) * 100) : 0,
  }));

  return {
    capitalUsd,
    shippingType,
    totalUnits,
    totalAllocatedUsd,
    remainingUsd,
    lines,
    sizeBreakdown,
    lowRotationAlerts,
    sourceNote:
      totalHistoricalSold > 0
        ? `Calculado sobre ${totalHistoricalSold} uds vendidas históricamente, descontando modelos de baja rotación.`
        : 'Calculado usando la curva estándar de tallas y costos actuales en bodega.',
  };
}

/**
 * Construye las filas del Pedido Recomendado usando EXACTAMENTE la plantilla
 * oficial de "Compras Masivas" para poder editarlo o subirlo directo en Cargas Masivas.
 */
export function buildRecommendedOrderExcelSheet(
  recommendation: SmartOrderRecommendation,
  usdtRate: number,
  date = new Date().toISOString().slice(0, 10),
): {
  sheetName: string;
  fileName: string;
  headers: readonly string[];
  rows: (string | number)[][];
} {
  const refName = `Pedido Recomendado ${date}`;
  const rows = recommendation.lines.map((line) => [
    date,
    refName,
    recommendation.shippingType,
    'EN TRÁNSITO',
    '1688 / Alibaba',
    line.model,
    line.version,
    line.size,
    line.recommendedQty,
    line.factoryUnitCost,
    line.freightUnitCost,
    line.suggestedSalePrice,
    round2(usdtRate),
  ]);

  return {
    sheetName: 'Compras Masivas',
    fileName: `X4SPORT_Pedido_Recomendado_${date}.xlsx`,
    headers: COMPRAS_MASIVAS_HEADERS,
    rows,
  };
}
