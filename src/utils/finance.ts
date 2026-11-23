import {
  createInitialState,
  DEMO_INVENTORY_IDS,
  getDefaultSalePrice,
  INITIAL_CAPITAL_INJECTIONS,
  INITIAL_CASH_ON_HAND,
  INITIAL_HISTORICAL_NET_PROFIT,
  INITIAL_OPERATING_EXPENSES,
  INITIAL_RECEIVABLES,
  PARTNER_SHARES,
} from '../data/initialState';
import { getMergedAuthorizedUsers } from './auth';
import type {
  AlertThresholdsConfig,
  AppState,
  AuditMovement,
  AuthorizedUserRecord,
  BulkImportRecord,
  CapitalInjectionDestination,
  CapitalInjectionRecord,
  CustomerProfile,
  ExpenseCategory,
  ExpenseSource,
  FifoBatch,
  FifoConsumptionDetail,
  FinancialFunds,
  FourLayerBreakdown,
  GeneralConfig,
  InventoryAdjustmentRecord,
  InventoryAdjustmentType,
  InventoryAuditCrossAlert,
  InventoryAuditSession,
  InventoryAuditSummaryMetrics,
  InventoryItem,
  JerseySize,
  JerseyVersion,
  MatrixConfigParams,
  OperatingExpenseRecord,
  PartnerName,
  PaymentMethod,
  PaymentSplit,
  PaymentStatus,
  PurchaseBatchItemRecord,
  PurchaseBatchRecord,
  PurchaseFundingSource,
  PurchasePricingMode,
  PurchaseRecord,
  ReceivableInstallment,
  ReceivableItem,
  ReturnExchangeRecord,
  ReturnExchangeType,
  SaleLineItem,
  SaleRecord,
  SellerName,
  ShippingType,
  SinglePaymentMethod,
  StandardJerseySize,
  SubModuleId,
  TeamCategory,
} from '../types/erp';
import {
  isWalkInCustomerName,
  normalizeCustomerText,
  normalizePhoneDigits,
} from './customers';

export const MAX_RECENT_MOVEMENTS = 300;

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Logística/Producción',
  'Comercialización/Publicidad',
  'Personales/Retiros de Socios',
];

export function normalizeExpenseCategory(
  raw: unknown,
): ExpenseCategory | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if ((EXPENSE_CATEGORIES as string[]).includes(trimmed)) {
    return trimmed as ExpenseCategory;
  }
  const norm = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (
    norm.includes('logistica') ||
    norm.includes('produccion') ||
    norm.includes('empaque')
  ) {
    return 'Logística/Producción';
  }
  if (
    norm.includes('comercializacion') ||
    norm.includes('publicidad') ||
    norm.includes('ads')
  ) {
    return 'Comercialización/Publicidad';
  }
  if (
    norm.includes('personal') ||
    norm.includes('retiro') ||
    norm.includes('socio')
  ) {
    return 'Personales/Retiros de Socios';
  }
  return undefined;
}

const LOGISTICS_AUTODETECT_KEYWORDS = [
  'bolsas',
  'bolsa',
  'empaque',
  'etiqueta',
  'flete',
  'delivery',
  'envio',
] as const;

export function detectExpenseCategoryFromDescription(
  description: string,
): { category: ExpenseCategory; matchedKeyword: string } | null {
  const norm = description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!norm.trim()) return null;

  for (const kw of LOGISTICS_AUTODETECT_KEYWORDS) {
    const regex = new RegExp(`(^|[^a-z0-9])${kw}(s)?([^a-z0-9]|$)`, 'i');
    if (regex.test(norm)) {
      return {
        category: 'Logística/Producción',
        matchedKeyword: kw === 'envio' ? 'envío' : kw,
      };
    }
  }
  return null;
}

export const DEFAULT_GENERAL_CONFIG: GeneralConfig = {
  matrixParams: {
    commissionPct: 4,
    operatingFundPct: 10,
    growthReinvestmentPct: 80,
    dividendsPct: 20,
    partnerSharesPct: {
      Jesús: 53.65,
      Josué: 40.43,
      Gabriel: 5.92,
    },
    vitalReserveMinUsd: 150,
    airRotationSharePct: 50,
    maritimeGoalUsd: 1500,
  },
  alertThresholds: {
    lowStockThreshold: 2,
    receivableOverdueDays: 30,
    maritimeTransitMaxDays: 80,
    airTransitMaxDays: 15,
  },
  brandIdentity: {
    storeName: 'X4SPORT',
    storeSubtitle: 'INDUMENTARIA DEPORTIVA',
    storeLocation: 'Guacara, Edo. Carabobo · Venezuela',
    logoUrl: '/assets/aistudio/image_992adf2a.jpg',
    invoiceFooterMessage: 'Gracias por comprar en X4SPORT',
  },
};

export function normalizeGeneralConfig(raw: unknown): GeneralConfig {
  const def = DEFAULT_GENERAL_CONFIG;
  if (!raw || typeof raw !== 'object') {
    return {
      matrixParams: {
        ...def.matrixParams,
        partnerSharesPct: { ...def.matrixParams.partnerSharesPct },
      },
      alertThresholds: { ...def.alertThresholds },
      brandIdentity: { ...def.brandIdentity },
    };
  }
  const obj = raw as Partial<GeneralConfig>;
  const rawMatrix = obj.matrixParams ?? ({} as Partial<MatrixConfigParams>);
  const rawPartners =
    rawMatrix.partnerSharesPct ??
    ({} as Partial<Record<PartnerName, number>>);

  const safeNum = (v: unknown, fallback: number, min = 0, max = 100) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? round2(n) : fallback;
  };
  const safeInt = (v: unknown, fallback: number, min = 0, max = 3650) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  const growthPct = safeNum(
    rawMatrix.growthReinvestmentPct,
    def.matrixParams.growthReinvestmentPct,
    0,
    100,
  );
  const dividendsPct = round2(100 - growthPct);

  const jesusPct = safeNum(
    rawPartners.Jesús,
    def.matrixParams.partnerSharesPct.Jesús,
    0,
    100,
  );
  const josuePct = safeNum(
    rawPartners.Josué,
    def.matrixParams.partnerSharesPct.Josué,
    0,
    100,
  );
  const gabrielPct = safeNum(
    rawPartners.Gabriel,
    def.matrixParams.partnerSharesPct.Gabriel,
    0,
    100,
  );
  const partnerSum = round2(jesusPct + josuePct + gabrielPct);
  const partnerSharesPct =
    Math.abs(partnerSum - 100) <= 0.05
      ? {
          Jesús: jesusPct,
          Josué: josuePct,
          Gabriel: gabrielPct,
        }
      : { ...def.matrixParams.partnerSharesPct };

  const rawAlerts = obj.alertThresholds ?? ({} as Partial<AlertThresholdsConfig>);
  const rawBrand = obj.brandIdentity ?? ({} as Partial<GeneralConfig['brandIdentity']>);

  return {
    matrixParams: {
      commissionPct: safeNum(
        rawMatrix.commissionPct,
        def.matrixParams.commissionPct,
        0,
        50,
      ),
      operatingFundPct: safeNum(
        rawMatrix.operatingFundPct,
        def.matrixParams.operatingFundPct,
        0,
        50,
      ),
      growthReinvestmentPct: growthPct,
      dividendsPct,
      partnerSharesPct,
      vitalReserveMinUsd: safeNum(
        rawMatrix.vitalReserveMinUsd,
        def.matrixParams.vitalReserveMinUsd ?? 150,
        0,
        100000,
      ),
      airRotationSharePct: safeNum(
        rawMatrix.airRotationSharePct,
        def.matrixParams.airRotationSharePct ?? 50,
        0,
        100,
      ),
      maritimeGoalUsd: safeNum(
        rawMatrix.maritimeGoalUsd,
        def.matrixParams.maritimeGoalUsd ?? 1500,
        1,
        1000000,
      ),
    },
    alertThresholds: {
      lowStockThreshold: safeInt(
        rawAlerts.lowStockThreshold,
        def.alertThresholds.lowStockThreshold,
        0,
        500,
      ),
      receivableOverdueDays: safeInt(
        rawAlerts.receivableOverdueDays,
        def.alertThresholds.receivableOverdueDays,
        1,
        365,
      ),
      maritimeTransitMaxDays: safeInt(
        rawAlerts.maritimeTransitMaxDays,
        def.alertThresholds.maritimeTransitMaxDays,
        1,
        365,
      ),
      airTransitMaxDays: safeInt(
        rawAlerts.airTransitMaxDays,
        def.alertThresholds.airTransitMaxDays,
        1,
        365,
      ),
    },
    brandIdentity: {
      storeName:
        typeof rawBrand.storeName === 'string' && rawBrand.storeName.trim()
          ? rawBrand.storeName.trim()
          : def.brandIdentity.storeName,
      storeSubtitle:
        typeof rawBrand.storeSubtitle === 'string' && rawBrand.storeSubtitle.trim()
          ? rawBrand.storeSubtitle.trim()
          : def.brandIdentity.storeSubtitle,
      storeLocation:
        typeof rawBrand.storeLocation === 'string' && rawBrand.storeLocation.trim()
          ? rawBrand.storeLocation.trim()
          : def.brandIdentity.storeLocation,
      logoUrl:
        typeof rawBrand.logoUrl === 'string' && rawBrand.logoUrl.trim()
          ? rawBrand.logoUrl.trim()
          : def.brandIdentity.logoUrl,
      invoiceFooterMessage:
        typeof rawBrand.invoiceFooterMessage === 'string' &&
        rawBrand.invoiceFooterMessage.trim()
          ? rawBrand.invoiceFooterMessage.trim()
          : def.brandIdentity.invoiceFooterMessage,
    },
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    updatedBy: typeof obj.updatedBy === 'string' ? obj.updatedBy : undefined,
  };
}

export function formatInvoiceNumber(seq: number): string {
  const safe = Math.max(1, Math.floor(Number.isFinite(seq) ? seq : 1));
  return `#${String(safe).padStart(4, '0')}`;
}

export function resolveNextInvoiceSeq(state: AppState): number {
  let maxExisting = 0;
  for (const sale of state.sales ?? []) {
    const match = String(sale.invoiceNumber ?? '').match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > maxExisting) {
        maxExisting = num;
      }
    }
  }
  const stored = Number(state.nextInvoiceSeq ?? 1);
  return Math.max(
    maxExisting + 1,
    Number.isFinite(stored) && stored >= 1 ? Math.floor(stored) : 1,
  );
}

export function getTotalAllocatedFunds(funds: FinancialFunds): number {
  const dividendsTotal =
    (funds.dividendsByPartner?.Jesús ?? 0) +
    (funds.dividendsByPartner?.Josué ?? 0) +
    (funds.dividendsByPartner?.Gabriel ?? 0);
  const commissionsBySellerSum =
    (funds.commissionsBySeller?.Jesús ?? 0) +
    (funds.commissionsBySeller?.Josué ?? 0) +
    (funds.commissionsBySeller?.Gabriel ?? 0);
  const commissionsTotal = funds.commissionsBySeller
    ? commissionsBySellerSum
    : (funds.commissions ?? 0);
  return round2(
    Math.max(0, funds.replacement ?? 0) +
      Math.max(0, commissionsTotal) +
      Math.max(0, funds.operatingAndAds ?? 0) +
      Math.max(0, funds.growthReinvestment ?? 0) +
      Math.max(0, dividendsTotal),
  );
}

/**
 * Resta un déficit o excedente de forma estrictamente proporcional entre todos
 * los fondos activos positivos de la Matriz de 4 Capas, reconciliando redondeos
 * al centavo para que nunca queden saldos negativos.
 */
export function deductProportionalFromFunds(
  funds: FinancialFunds,
  amountToDeduct: number,
): FinancialFunds {
  const targetDeduct = round2(Math.max(0, amountToDeduct));
  if (targetDeduct <= 0) {
    return {
      ...funds,
      commissionsBySeller: { ...funds.commissionsBySeller },
      dividendsByPartner: { ...funds.dividendsByPartner },
    };
  }

  const buckets = [
    { key: 'replacement', value: round2(Math.max(0, funds.replacement)) },
    {
      key: 'comm_Jesús',
      value: round2(Math.max(0, funds.commissionsBySeller.Jesús)),
    },
    {
      key: 'comm_Josué',
      value: round2(Math.max(0, funds.commissionsBySeller.Josué)),
    },
    {
      key: 'comm_Gabriel',
      value: round2(Math.max(0, funds.commissionsBySeller.Gabriel)),
    },
    { key: 'operatingAndAds', value: round2(Math.max(0, funds.operatingAndAds)) },
    {
      key: 'growthReinvestment',
      value: round2(Math.max(0, funds.growthReinvestment)),
    },
    {
      key: 'div_Jesús',
      value: round2(Math.max(0, funds.dividendsByPartner.Jesús)),
    },
    {
      key: 'div_Josué',
      value: round2(Math.max(0, funds.dividendsByPartner.Josué)),
    },
    {
      key: 'div_Gabriel',
      value: round2(Math.max(0, funds.dividendsByPartner.Gabriel)),
    },
  ];

  const totalAvailable = round2(buckets.reduce((s, b) => s + b.value, 0));
  if (totalAvailable <= 0) {
    return {
      ...funds,
      commissionsBySeller: { ...funds.commissionsBySeller },
      dividendsByPartner: { ...funds.dividendsByPartner },
    };
  }

  const effectiveDeduct = round2(Math.min(totalAvailable, targetDeduct));

  if (effectiveDeduct >= totalAvailable) {
    return {
      ...funds,
      replacement: 0,
      commissions: 0,
      commissionsBySeller: { Jesús: 0, Josué: 0, Gabriel: 0 },
      operatingAndAds: 0,
      growthReinvestment: 0,
      dividendsByPartner: { Jesús: 0, Josué: 0, Gabriel: 0 },
    };
  }

  const deductions = buckets.map((b) =>
    b.value > 0
      ? Math.min(b.value, round2((b.value / totalAvailable) * effectiveDeduct))
      : 0,
  );

  // Reconcile 1-cent rounding drift against largest remaining bucket(s)
  let drift = round2(
    effectiveDeduct - deductions.reduce((s, d) => s + d, 0),
  );
  if (Math.abs(drift) >= 0.01) {
    const order = buckets
      .map((b, idx) => ({ idx, room: round2(b.value - deductions[idx]) }))
      .sort((a, b) => b.room - a.room);
    for (const entry of order) {
      if (Math.abs(drift) < 0.01) break;
      if (drift > 0 && entry.room > 0) {
        const step = Math.min(entry.room, drift);
        deductions[entry.idx] = round2(deductions[entry.idx] + step);
        drift = round2(drift - step);
      } else if (drift < 0 && deductions[entry.idx] > 0) {
        const step = Math.min(deductions[entry.idx], Math.abs(drift));
        deductions[entry.idx] = round2(deductions[entry.idx] - step);
        drift = round2(drift + step);
      }
    }
  }

  const nextVal = (i: number) =>
    round2(Math.max(0, buckets[i].value - deductions[i]));

  const nextCommBySeller = {
    Jesús: nextVal(1),
    Josué: nextVal(2),
    Gabriel: nextVal(3),
  };

  return {
    ...funds,
    replacement: nextVal(0),
    commissions: round2(
      nextCommBySeller.Jesús + nextCommBySeller.Josué + nextCommBySeller.Gabriel,
    ),
    commissionsBySeller: nextCommBySeller,
    operatingAndAds: nextVal(4),
    growthReinvestment: nextVal(5),
    dividendsByPartner: {
      Jesús: nextVal(6),
      Josué: nextVal(7),
      Gabriel: nextVal(8),
    },
  };
}

/**
 * Regla de respaldo mutuo entre Fondo de Reposición y Fondo de Reinversión:
 * a) Descuenta primero todo lo posible del fondo primario elegido.
 * b) Si queda remanente, lo cubre con el fondo hermano (Reposición <-> Reinversión).
 * c) Si ambos llegan a $0.00 y aún queda déficit, lo prorratea entre los demás fondos positivos.
 */
export function deductWithRepoReinvestmentBridge(
  funds: FinancialFunds,
  primary: 'replacement' | 'growthReinvestment',
  amount: number,
): FinancialFunds {
  const target = round2(Math.max(0, amount));
  const nextFunds: FinancialFunds = {
    ...funds,
    commissionsBySeller: { ...funds.commissionsBySeller },
    dividendsByPartner: { ...funds.dividendsByPartner },
  };
  if (target <= 0) {
    return nextFunds;
  }

  let remaining = target;
  const sibling: 'replacement' | 'growthReinvestment' =
    primary === 'replacement' ? 'growthReinvestment' : 'replacement';

  // a) Descontar primero todo lo posible del fondo primario
  const primaryAvail = round2(Math.max(0, nextFunds[primary] ?? 0));
  const primaryDeducted = round2(Math.min(primaryAvail, remaining));
  nextFunds[primary] = round2(primaryAvail - primaryDeducted);
  remaining = round2(remaining - primaryDeducted);

  // b) Si queda remanente sin cubrir, descontar del fondo hermano
  if (remaining > 0) {
    const siblingAvail = round2(Math.max(0, nextFunds[sibling] ?? 0));
    const siblingDeducted = round2(Math.min(siblingAvail, remaining));
    nextFunds[sibling] = round2(siblingAvail - siblingDeducted);
    remaining = round2(remaining - siblingDeducted);
  }

  // c) Si tras llevar ambos a $0.00 aún queda déficit, descontar proporcionalmente de los demás fondos positivos
  if (remaining > 0) {
    return deductProportionalFromFunds(nextFunds, remaining);
  }

  return nextFunds;
}

export function reconcileFundsToPhysicalCash(
  funds: FinancialFunds,
  physicalCash: number,
): { funds: FinancialFunds; deficitApplied: number } {
  const safeCash = round2(Math.max(0, physicalCash));
  const totalAllocated = getTotalAllocatedFunds(funds);
  if (totalAllocated <= safeCash + 0.001) {
    return {
      funds: {
        ...funds,
        commissionsBySeller: { ...funds.commissionsBySeller },
        dividendsByPartner: { ...funds.dividendsByPartner },
      },
      deficitApplied: 0,
    };
  }
  const excess = round2(totalAllocated - safeCash);
  return {
    funds: deductProportionalFromFunds(funds, excess),
    deficitApplied: excess,
  };
}

export function getCashBackedFundsSummary(state: AppState): {
  totalAllocatedFunds: number;
  cashOnHand: number;
  excessFundsOverCash: number;
  cashBackedTotal: number;
  isStrictlyCashBacked: boolean;
} {
  const totalAllocatedFunds = getTotalAllocatedFunds(state.funds);
  const cashOnHand = round2(Math.max(0, state.cashOnHand));
  const excessFundsOverCash = round2(Math.max(0, totalAllocatedFunds - cashOnHand));
  return {
    totalAllocatedFunds,
    cashOnHand,
    excessFundsOverCash,
    cashBackedTotal: round2(Math.min(totalAllocatedFunds, cashOnHand)),
    isStrictlyCashBacked: excessFundsOverCash <= 0.01,
  };
}

export const WHOLESALE_DISCOUNT_PCT = 20;

export type PricingAdjustMode =
  | 'normal'
  | 'wholesale'
  | 'discount_pct'
  | 'discount_usd'
  | 'manual';

export function calculateDiscountedUnitPrice(
  basePrice: number,
  mode: PricingAdjustMode,
  adjustValue = 0,
): { unitPrice: number; discountLabel?: string } {
  const safeBase = round2(Math.max(0.01, basePrice));
  if (mode === 'wholesale') {
    const unitPrice = round2(
      Math.max(0.01, safeBase * (1 - WHOLESALE_DISCOUNT_PCT / 100)),
    );
    return {
      unitPrice,
      discountLabel: `Al Mayor (-${WHOLESALE_DISCOUNT_PCT}%)`,
    };
  }
  if (mode === 'discount_pct') {
    const pct = Math.min(99, Math.max(0, round2(adjustValue)));
    const unitPrice = round2(Math.max(0.01, safeBase * (1 - pct / 100)));
    return {
      unitPrice,
      discountLabel: pct > 0 ? `Rebaja -${pct}%` : undefined,
    };
  }
  if (mode === 'discount_usd') {
    const usdOff = Math.max(0, round2(adjustValue));
    const unitPrice = round2(Math.max(0.01, safeBase - usdOff));
    return {
      unitPrice,
      discountLabel: usdOff > 0 ? `Rebaja -${formatUSD(usdOff)}` : undefined,
    };
  }
  return { unitPrice: safeBase };
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function formatUSD(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatUSDT(amount: number): string {
  return `${formatUSD(amount)} USDT`;
}

export function formatVES(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `Bs. ${new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe)}`;
}

export function getTotalUnits(state: AppState): number {
  return state.inventory.reduce((sum, item) => sum + item.stock, 0);
}

export function getTotalInventoryCostValue(state: AppState): number {
  return round2(
    state.inventory.reduce((sum, item) => {
      if (item.fifoBatches && item.fifoBatches.length > 0) {
        return (
          sum +
          item.fifoBatches.reduce(
            (bSum, b) => bSum + b.remainingQuantity * b.unitCost,
            0,
          )
        );
      }
      return sum + item.stock * item.cogs;
    }, 0),
  );
}

export function getTotalReceivables(state: AppState): number {
  return round2(state.receivables.reduce((sum, item) => sum + item.amount, 0));
}

export function getLowStockItems(state: AppState, threshold = 2) {
  return state.inventory
    .filter((item) => item.stock <= threshold)
    .sort((a, b) => a.stock - b.stock || a.model.localeCompare(b.model));
}

export function getNextFifoUnitCost(item: InventoryItem): number {
  if (!item.fifoBatches || item.fifoBatches.length === 0) return item.cogs;
  const sorted = [...item.fifoBatches]
    .filter((b) => b.remainingQuantity > 0)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return sorted.length > 0 ? round2(sorted[0].unitCost) : item.cogs;
}

/**
 * Simulates or executes FIFO consumption across chronological batches for a SKU.
 * Oldest entryDate batches are consumed first.
 */
export function previewFifoConsumption(
  item: InventoryItem,
  quantityToSell: number,
): {
  totalCost: number;
  effectiveUnitCogs: number;
  consumedDetails: FifoConsumptionDetail[];
  updatedBatches: FifoBatch[];
} {
  const batches: FifoBatch[] =
    item.fifoBatches && item.fifoBatches.length > 0
      ? item.fifoBatches.map((b) => ({ ...b }))
      : [
          {
            batchId: `fifo-legacy-${item.id}`,
            batchName: 'Lote Base',
            entryDate: '2026-11-01',
            initialQuantity: item.stock,
            remainingQuantity: item.stock,
            unitCost: item.cogs,
          },
        ];

  // Sort chronological order (stable by original order if entryDate ties)
  const indexed = batches.map((b, idx) => ({ b, idx }));
  indexed.sort((a, b) => {
    const cmp = a.b.entryDate.localeCompare(b.b.entryDate);
    return cmp !== 0 ? cmp : a.idx - b.idx;
  });

  let remainingToTake = quantityToSell;
  let totalCostRaw = 0;
  const consumedDetails: FifoConsumptionDetail[] = [];

  for (const entry of indexed) {
    if (remainingToTake <= 0) break;
    const batch = entry.b;
    if (batch.remainingQuantity <= 0) continue;

    const take = Math.min(batch.remainingQuantity, remainingToTake);
    batch.remainingQuantity -= take;
    remainingToTake -= take;

    const lineCost = round2(take * batch.unitCost);
    totalCostRaw += take * batch.unitCost;

    consumedDetails.push({
      batchId: batch.batchId,
      batchName: batch.batchName,
      quantity: take,
      unitCost: round2(batch.unitCost),
      totalCost: lineCost,
    });
  }

  const totalCost = round2(totalCostRaw);
  const effectiveUnitCogs =
    quantityToSell > 0 ? round2(totalCost / quantityToSell) : item.cogs;

  // Keep batches in chronological order, retaining history or active batches
  const updatedBatches = indexed.map((entry) => entry.b);

  return {
    totalCost,
    effectiveUnitCogs,
    consumedDetails,
    updatedBatches,
  };
}

export function calculateFourLayerMatrixConsolidated(
  finalSalePrice: number,
  totalBaseCost: number,
  seller: SellerName,
  matrixParams?: MatrixConfigParams,
): FourLayerBreakdown {
  const commissionRate = matrixParams
    ? Math.max(0, matrixParams.commissionPct) / 100
    : 0.04;
  const operatingRate = matrixParams
    ? Math.max(0, matrixParams.operatingFundPct) / 100
    : 0.1;
  const growthRate = matrixParams
    ? Math.min(1, Math.max(0, matrixParams.growthReinvestmentPct / 100))
    : 0.8;
  const jesusShare = matrixParams
    ? Math.max(0, matrixParams.partnerSharesPct.Jesús) / 100
    : PARTNER_SHARES.Jesús;
  const josueShare = matrixParams
    ? Math.max(0, matrixParams.partnerSharesPct.Josué) / 100
    : PARTNER_SHARES.Josué;

  const grossRevenue = round2(Math.max(0, finalSalePrice));
  const rawCostRecovery = round2(Math.max(0, totalBaseCost));

  // Capa 1 · Recuperación del Costo Base (100% Retención)
  const layer1CostRecovery = round2(Math.min(grossRevenue, rawCostRecovery));
  const grossProfit = round2(Math.max(0, grossRevenue - layer1CostRecovery));

  // Capa 2 · Comisión por Venta Directa (4%). Si no tiene vendedor asignado, pasa directo a Reinversión.
  const rawCommission = round2(grossRevenue * commissionRate);
  const effectiveCommission = round2(Math.min(rawCommission, grossProfit));
  const unassigned = isUnassignedSeller(seller);
  const layer2Commission = unassigned ? 0 : effectiveCommission;
  const layer2ToReinvestment = unassigned ? effectiveCommission : 0;

  const netProfit = round2(Math.max(0, grossProfit - effectiveCommission));

  // Capa 3 · Fondo de Operaciones y Mantenimiento (10% Utilidad Neta)
  const layer3OperatingFund = round2(netProfit * operatingRate);
  const remainingNetProfit = round2(netProfit - layer3OperatingFund);

  // Capa 4 · Utilidad Neta Remanente (80% Reinversión + 4% sin vendedor / 20% Dividendos)
  const baseGrowthFromRemainder = round2(remainingNetProfit * growthRate);
  const layer4TotalDividends = round2(
    remainingNetProfit - baseGrowthFromRemainder,
  );
  const layer4GrowthReinvestment = round2(
    baseGrowthFromRemainder + layer2ToReinvestment,
  );

  const jesus = round2(layer4TotalDividends * jesusShare);
  const josue = round2(layer4TotalDividends * josueShare);
  const gabriel = round2(Math.max(0, layer4TotalDividends - jesus - josue));

  return {
    grossRevenue,
    layer1CostRecovery,
    grossProfit,
    layer2Commission,
    layer2ToReinvestment,
    netProfit,
    layer3OperatingFund,
    remainingNetProfit,
    layer4GrowthReinvestment,
    layer4TotalDividends,
    partnerSplits: {
      Jesús: jesus,
      Josué: josue,
      Gabriel: gabriel,
    },
  };
}

export function calculateFourLayerMatrix(
  finalSalePrice: number,
  unitCogs: number,
  quantity: number,
  seller: SellerName,
  matrixParams?: MatrixConfigParams,
): FourLayerBreakdown {
  const rawCostRecovery = round2(Math.max(0, unitCogs) * Math.max(0, quantity));
  return calculateFourLayerMatrixConsolidated(
    finalSalePrice,
    rawCostRecovery,
    seller,
    matrixParams,
  );
}

/**
 * Escala proporcionalmente un desglose de 4 Capas a un monto efectivamente cobrado en caja física,
 * reconciliando cualquier diferencia de redondeo al centavo para que la suma asignada a fondos
 * coincida exactamente con `cashAmount`.
 */
export function scaleBreakdownToCashAmount(
  breakdown: FourLayerBreakdown,
  cashAmount: number,
): FourLayerBreakdown {
  const targetCash = round2(Math.max(0, cashAmount));
  if (targetCash <= 0 || breakdown.grossRevenue <= 0) {
    return {
      grossRevenue: 0,
      layer1CostRecovery: 0,
      grossProfit: 0,
      layer2Commission: 0,
      layer2ToReinvestment: 0,
      netProfit: 0,
      layer3OperatingFund: 0,
      remainingNetProfit: 0,
      layer4GrowthReinvestment: 0,
      layer4TotalDividends: 0,
      partnerSplits: { Jesús: 0, Josué: 0, Gabriel: 0 },
    };
  }

  if (targetCash >= round2(breakdown.grossRevenue - 0.005)) {
    return {
      ...breakdown,
      partnerSplits: { ...breakdown.partnerSplits },
    };
  }

  const ratio = targetCash / breakdown.grossRevenue;
  const buckets = [
    round2(breakdown.layer1CostRecovery * ratio),
    round2(breakdown.layer2Commission * ratio),
    round2(breakdown.layer3OperatingFund * ratio),
    round2(breakdown.layer4GrowthReinvestment * ratio),
    round2(breakdown.partnerSplits.Jesús * ratio),
    round2(breakdown.partnerSplits.Josué * ratio),
    round2(breakdown.partnerSplits.Gabriel * ratio),
  ];

  let drift = round2(targetCash - buckets.reduce((s, v) => s + v, 0));
  if (Math.abs(drift) >= 0.01) {
    const order = buckets
      .map((val, idx) => ({ idx, val }))
      .sort((a, b) => b.val - a.val);
    for (const item of order) {
      if (Math.abs(drift) < 0.01) break;
      if (drift > 0) {
        buckets[item.idx] = round2(buckets[item.idx] + drift);
        drift = 0;
      } else if (buckets[item.idx] > 0) {
        const step = Math.min(buckets[item.idx], Math.abs(drift));
        buckets[item.idx] = round2(buckets[item.idx] - step);
        drift = round2(drift + step);
      }
    }
  }

  const layer1CostRecovery = buckets[0];
  const layer2Commission = buckets[1];
  const layer3OperatingFund = buckets[2];
  const layer4GrowthReinvestment = buckets[3];
  const partnerSplits = {
    Jesús: buckets[4],
    Josué: buckets[5],
    Gabriel: buckets[6],
  };
  const layer4TotalDividends = round2(
    partnerSplits.Jesús + partnerSplits.Josué + partnerSplits.Gabriel,
  );
  const layer2ToReinvestment = round2(
    (breakdown.layer2ToReinvestment ?? 0) * ratio,
  );
  const remainingNetProfit = round2(
    Math.max(
      0,
      layer4GrowthReinvestment + layer4TotalDividends - layer2ToReinvestment,
    ),
  );
  const netProfit = round2(layer3OperatingFund + remainingNetProfit);

  return {
    grossRevenue: targetCash,
    layer1CostRecovery,
    grossProfit: round2(Math.max(0, targetCash - layer1CostRecovery)),
    layer2Commission,
    layer2ToReinvestment,
    netProfit,
    layer3OperatingFund,
    remainingNetProfit,
    layer4GrowthReinvestment,
    layer4TotalDividends,
    partnerSplits,
  };
}

function applyScaledBreakdownToFunds(
  funds: FinancialFunds,
  delta: FourLayerBreakdown,
  seller: SellerName,
): FinancialFunds {
  const nextCommissionsBySeller = { ...funds.commissionsBySeller };
  if (!isUnassignedSeller(seller) && delta.layer2Commission > 0) {
    const partner = seller as PartnerName;
    nextCommissionsBySeller[partner] = round2(
      nextCommissionsBySeller[partner] + delta.layer2Commission,
    );
  }

  return {
    ...funds,
    replacement: round2(funds.replacement + delta.layer1CostRecovery),
    commissions: round2(funds.commissions + delta.layer2Commission),
    commissionsBySeller: nextCommissionsBySeller,
    operatingAndAds: round2(funds.operatingAndAds + delta.layer3OperatingFund),
    growthReinvestment: round2(
      funds.growthReinvestment + delta.layer4GrowthReinvestment,
    ),
    dividendsByPartner: {
      Jesús: round2(funds.dividendsByPartner.Jesús + delta.partnerSplits.Jesús),
      Josué: round2(funds.dividendsByPartner.Josué + delta.partnerSplits.Josué),
      Gabriel: round2(
        funds.dividendsByPartner.Gabriel + delta.partnerSplits.Gabriel,
      ),
    },
  };
}

function deductReversedBreakdownFromFunds(
  funds: FinancialFunds,
  delta: FourLayerBreakdown,
  seller: SellerName,
): FinancialFunds {
  const nextCommissionsBySeller = { ...funds.commissionsBySeller };
  if (!isUnassignedSeller(seller) && delta.layer2Commission > 0) {
    const partner = seller as PartnerName;
    nextCommissionsBySeller[partner] = round2(
      Math.max(
        0,
        (nextCommissionsBySeller[partner] ?? 0) - delta.layer2Commission,
      ),
    );
  }
  const nextCommissionsTotal = funds.commissionsBySeller
    ? round2(
        nextCommissionsBySeller.Jesús +
          nextCommissionsBySeller.Josué +
          nextCommissionsBySeller.Gabriel,
      )
    : round2(Math.max(0, funds.commissions - delta.layer2Commission));

  return {
    ...funds,
    replacement: round2(Math.max(0, funds.replacement - delta.layer1CostRecovery)),
    commissions: nextCommissionsTotal,
    commissionsBySeller: nextCommissionsBySeller,
    operatingAndAds: round2(
      Math.max(0, funds.operatingAndAds - delta.layer3OperatingFund),
    ),
    growthReinvestment: round2(
      Math.max(0, funds.growthReinvestment - delta.layer4GrowthReinvestment),
    ),
    dividendsByPartner: {
      Jesús: round2(
        Math.max(0, funds.dividendsByPartner.Jesús - delta.partnerSplits.Jesús),
      ),
      Josué: round2(
        Math.max(0, funds.dividendsByPartner.Josué - delta.partnerSplits.Josué),
      ),
      Gabriel: round2(
        Math.max(
          0,
          funds.dividendsByPartner.Gabriel - delta.partnerSplits.Gabriel,
        ),
      ),
    },
  };
}

export interface CartSaleItemInput {
  skuId: string;
  quantity: number;
  unitPrice: number;
  baseUnitPrice?: number;
  discountLabel?: string;
}

export interface RegisterMultiSaleInput {
  items: CartSaleItemInput[];
  saleDate?: string; // YYYY-MM-DD editable date
  customerName?: string;
  customerCity?: string;
  customerPhone?: string;
  customerSocial?: string;
  customerIdDoc?: string;
  seller: SellerName;
  paymentStatus: PaymentStatus;
  paidAmount?: number; // Monto pagado al momento (100% en Contado; abono inicial >=0 en Crédito)
  paymentMethod?: PaymentMethod;
  paymentSplits?: PaymentSplit[];
  debtorName?: string;
  deliveryDate?: string;
  clientOperationId?: string;
  actorName?: string;
}

export interface RegisterSaleInput {
  skuId: string;
  quantity: number;
  finalPrice: number;
  customerName?: string;
  customerCity?: string;
  customerPhone?: string;
  customerSocial?: string;
  customerIdDoc?: string;
  seller: SellerName;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  paymentSplits?: PaymentSplit[];
  debtorName?: string;
  deliveryDate?: string;
  actorName?: string;
}

export interface UpsertCustomerInput {
  name: string;
  phone?: string;
  city?: string;
  social?: string;
  idDoc?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  state: AppState;
  createdSale?: SaleRecord;
  createdBatch?: PurchaseBatchRecord;
}

function mergeCustomerProfileIntoList(
  existingList: CustomerProfile[] | undefined,
  input: UpsertCustomerInput,
  now: string,
): CustomerProfile[] | undefined {
  const cleanName = input.name.trim();
  if (!cleanName || isWalkInCustomerName(cleanName)) {
    return existingList;
  }

  const cleanPhone = input.phone?.trim() || undefined;
  const cleanCity = input.city?.trim() || undefined;
  const cleanSocial = input.social?.trim() || undefined;
  const cleanIdDoc = input.idDoc?.trim() || undefined;

  const list = [...(existingList ?? [])];
  const normName = normalizeCustomerText(cleanName);
  const phoneDigits = normalizePhoneDigits(cleanPhone);

  const matchIdx = list.findIndex((c) => {
    const cName = normalizeCustomerText(c.name);
    const cPhone = normalizePhoneDigits(c.phone);
    return (
      (Boolean(normName) && cName === normName) ||
      (phoneDigits.length >= 7 && cPhone.length >= 7 && cPhone === phoneDigits)
    );
  });

  if (matchIdx >= 0) {
    const prev = list[matchIdx];
    list[matchIdx] = {
      ...prev,
      name: cleanName,
      phone: cleanPhone ?? prev.phone,
      city: cleanCity ?? prev.city,
      social: cleanSocial ?? prev.social,
      idDoc: cleanIdDoc ?? prev.idDoc,
      updatedAt: now,
    };
    return list;
  }

  return [
    {
      id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      phone: cleanPhone,
      city: cleanCity,
      social: cleanSocial,
      idDoc: cleanIdDoc,
      createdAt: now,
      updatedAt: now,
    },
    ...list,
  ];
}

export function upsertCustomerProfile(
  state: AppState,
  input: UpsertCustomerInput,
): ActionResult {
  const cleanName = input.name.trim();
  if (!cleanName || isWalkInCustomerName(cleanName)) {
    return {
      ok: false,
      error: 'Ingresa el nombre completo del cliente para guardar su ficha.',
      state,
    };
  }

  const now = new Date().toISOString();
  const nextCustomers = mergeCustomerProfileIntoList(state.customers, input, now);
  return {
    ok: true,
    state: {
      ...state,
      customers: nextCustomers,
    },
  };
}

export function isUnassignedSeller(seller: SellerName): boolean {
  return seller === 'Sin Vendedor' || seller === 'Sin Asignar';
}

export function registerMultiItemSale(
  state: AppState,
  input: RegisterMultiSaleInput,
  matrixParams?: MatrixConfigParams,
): ActionResult {
  const opId = input.clientOperationId?.trim();
  if (opId && (state.sales ?? []).some((s) => s.clientOperationId === opId)) {
    return {
      ok: false,
      error:
        'Esta venta ya fue registrada previamente (prevención automática de duplicados).',
      state,
    };
  }

  if (!input.items || input.items.length === 0) {
    return {
      ok: false,
      error: 'Agrega al menos un producto al carrito antes de registrar la venta.',
      state,
    };
  }

  const rawCustomer = input.customerName?.trim() ?? '';
  const cleanCustomer = rawCustomer || 'Cliente Mostrador';
  const cleanCity = input.customerCity?.trim() || undefined;
  const cleanPhone = input.customerPhone?.trim() || undefined;
  const cleanSocial = input.customerSocial?.trim() || undefined;
  const cleanIdDoc = input.customerIdDoc?.trim() || undefined;
  const cleanDebtor = (input.debtorName?.trim() || cleanCustomer).trim();
  const paymentMethod: PaymentMethod = input.paymentMethod ?? 'Efectivo ($)';

  // Working copy of inventory so multiple lines of the same SKU consume FIFO sequentially
  const workingInventory: InventoryItem[] = state.inventory.map((item) => ({
    ...item,
    fifoBatches: (item.fifoBatches ?? []).map((b) => ({ ...b })),
  }));

  const resolvedLines: SaleLineItem[] = [];

  for (const line of input.items) {
    const skuIdx = workingInventory.findIndex((item) => item.id === line.skuId);
    if (skuIdx < 0) {
      return {
        ok: false,
        error: 'Uno de los productos del carrito ya no existe en el inventario.',
        state,
      };
    }

    const sku = workingInventory[skuIdx];
    const quantity = Math.floor(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return {
        ok: false,
        error: `La cantidad para ${sku.model} debe ser un número entero mayor a 0.`,
        state,
      };
    }

    const unitPrice = round2(line.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return {
        ok: false,
        error: `El precio unitario para ${sku.model} debe ser mayor a $0.00.`,
        state,
      };
    }

    if (quantity > sku.stock) {
      return {
        ok: false,
        error: `Stock insuficiente para ${sku.model} (${sku.version} · ${sku.size}). Disponible: ${sku.stock} ud(s), solicitado: ${quantity}.`,
        state,
      };
    }

    const fifoResult = previewFifoConsumption(sku, quantity);
    const nextStock = sku.stock - quantity;
    const nextActiveBatch = fifoResult.updatedBatches.find(
      (b) => b.remainingQuantity > 0,
    );

    workingInventory[skuIdx] = {
      ...sku,
      stock: nextStock,
      fifoBatches: fifoResult.updatedBatches,
      cogs: nextActiveBatch ? round2(nextActiveBatch.unitCost) : sku.cogs,
    };

    resolvedLines.push({
      skuId: sku.id,
      modelLabel: sku.model,
      team: sku.team,
      version: sku.version,
      size: sku.size,
      quantity,
      unitCogs: fifoResult.effectiveUnitCogs,
      totalLineCogs: fifoResult.totalCost,
      baseUnitPrice:
        line.baseUnitPrice !== undefined
          ? round2(line.baseUnitPrice)
          : sku.salePrice,
      discountLabel: line.discountLabel,
      unitPrice,
      subtotal: round2(quantity * unitPrice),
      fifoConsumed: fifoResult.consumedDetails,
    });
  }

  const totalFinalPrice = round2(
    resolvedLines.reduce((sum, l) => sum + l.subtotal, 0),
  );
  const totalBaseCost = round2(
    resolvedLines.reduce((sum, l) => sum + l.totalLineCogs, 0),
  );
  const totalUnits = resolvedLines.reduce((sum, l) => sum + l.quantity, 0);

  let resolvedSplits: PaymentSplit[];
  let bcvEquivalent: number | undefined;

  if (paymentMethod === 'Pago Mixto') {
    const nonZeroSplits = (input.paymentSplits ?? [])
      .map((sp) => ({
        method: sp.method,
        amountUsd: round2(Number(sp.amountUsd) || 0),
      }))
      .filter((sp) => sp.amountUsd > 0);

    if (nonZeroSplits.length === 0) {
      return {
        ok: false,
        error: 'Ingresa los montos del Pago Mixto por cada método utilizado.',
        state,
      };
    }

    const splitSum = round2(
      nonZeroSplits.reduce((acc, sp) => acc + sp.amountUsd, 0),
    );
    if (Math.abs(round2(splitSum - totalFinalPrice)) > 0.01) {
      return {
        ok: false,
        error: `La suma del Pago Mixto (${formatUSD(splitSum)}) debe coincidir con el total de la venta (${formatUSD(totalFinalPrice)}).`,
        state,
      };
    }

    resolvedSplits = nonZeroSplits.map((sp) => ({
      method: sp.method,
      amountUsd: sp.amountUsd,
      bcvEquivalent:
        sp.method === 'Pago Móvil / Bs'
          ? round2(sp.amountUsd * state.exchangeRates.bcv)
          : undefined,
    }));

    const pagoMovilTotalBs = round2(
      resolvedSplits.reduce((sum, sp) => sum + (sp.bcvEquivalent ?? 0), 0),
    );
    bcvEquivalent = pagoMovilTotalBs > 0 ? pagoMovilTotalBs : undefined;
  } else {
    bcvEquivalent =
      paymentMethod === 'Pago Móvil / Bs'
        ? round2(totalFinalPrice * state.exchangeRates.bcv)
        : undefined;
    resolvedSplits = [
      {
        method: paymentMethod,
        amountUsd: totalFinalPrice,
        bcvEquivalent,
      },
    ];
  }

  const rawSaleDate = input.saleDate?.trim() ?? '';
  if (rawSaleDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawSaleDate)) {
    return {
      ok: false,
      error: 'La fecha de la venta debe tener un formato válido (AAAA-MM-DD).',
      state,
    };
  }

  const realNow = new Date();
  const todayLocalIso = `${realNow.getFullYear()}-${String(realNow.getMonth() + 1).padStart(2, '0')}-${String(realNow.getDate()).padStart(2, '0')}`;
  const effectiveSaleDate = rawSaleDate || todayLocalIso;
  const now =
    effectiveSaleDate === todayLocalIso
      ? realNow.toISOString()
      : `${effectiveSaleDate}T12:00:00.000Z`;

  // Validar monto pagado según condición (Contado = 100%, Crédito = abono inicial opcional < total)
  let paidAtSale = totalFinalPrice;
  if (input.paymentStatus === 'Pendiente') {
    const requestedPaid =
      input.paidAmount !== undefined ? round2(Number(input.paidAmount)) : 0;
    if (!Number.isFinite(requestedPaid) || requestedPaid < 0) {
      return {
        ok: false,
        error: 'El monto pagado inicial no puede ser negativo.',
        state,
      };
    }
    if (requestedPaid > round2(totalFinalPrice + 0.01)) {
      return {
        ok: false,
        error: `El monto pagado (${formatUSD(requestedPaid)}) no puede superar el total de la venta (${formatUSD(totalFinalPrice)}).`,
        state,
      };
    }
    if (requestedPaid >= round2(totalFinalPrice - 0.009)) {
      return {
        ok: false,
        error:
          'El monto pagado cubre el 100% de la venta; selecciona condición Contado.',
        state,
      };
    }
    paidAtSale = requestedPaid;
  }

  const pendingReceivableAmount =
    input.paymentStatus === 'Pendiente'
      ? round2(Math.max(0, totalFinalPrice - paidAtSale))
      : 0;

  const invoiceSeq = resolveNextInvoiceSeq(state);
  const invoiceNumber = formatInvoiceNumber(invoiceSeq);
  const saleId = `sale-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const breakdown = calculateFourLayerMatrixConsolidated(
    totalFinalPrice,
    totalBaseCost,
    input.seller,
    matrixParams,
  );

  const nextCash = round2(state.cashOnHand + paidAtSale);

  const summaryItemsText = resolvedLines
    .map((l) => `${l.quantity}x ${l.modelLabel} (${l.version} ${l.size})`)
    .join(', ');

  const initialInstallments: ReceivableInstallment[] =
    input.paymentStatus === 'Pendiente' && paidAtSale > 0
      ? [
          {
            id: `inst-init-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            amount: paidAtSale,
            paymentMethod,
            createdAt: now,
          },
        ]
      : [];

  const nextReceivables =
    input.paymentStatus === 'Pendiente' && pendingReceivableAmount > 0
      ? [
          {
            id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            debtor: cleanDebtor,
            amount: pendingReceivableAmount,
            originalAmount: totalFinalPrice,
            paidAmount: paidAtSale,
            ...(initialInstallments.length > 0
              ? { installments: initialInstallments }
              : {}),
            createdAt: now,
            note: `${invoiceNumber} · ${summaryItemsText}`,
            saleId,
            paymentMethod,
          },
          ...state.receivables,
        ]
      : state.receivables;

  const cashFundedBreakdown = scaleBreakdownToCashAmount(breakdown, paidAtSale);
  const nextFunds = applyScaledBreakdownToFunds(
    state.funds,
    cashFundedBreakdown,
    input.seller,
  );

  const currentUserName = input.actorName?.trim() || 'Jesús César';

  const firstLine = resolvedLines[0];
  const saleRecord: SaleRecord = {
    id: saleId,
    invoiceNumber,
    saleDate: effectiveSaleDate,
    skuId: firstLine.skuId,
    modelLabel:
      resolvedLines.length === 1
        ? firstLine.modelLabel
        : `Venta múltiple (${resolvedLines.length} modelos)`,
    team: firstLine.team,
    version: firstLine.version,
    size: firstLine.size,
    quantity: totalUnits,
    unitCogs: round2(totalBaseCost / totalUnits),
    finalPrice: totalFinalPrice,
    paidAmount: paidAtSale,
    items: resolvedLines,
    customerName: cleanCustomer,
    customerCity: cleanCity,
    customerPhone: cleanPhone,
    customerSocial: cleanSocial,
    customerIdDoc: cleanIdDoc,
    seller: input.seller,
    paymentStatus: input.paymentStatus,
    paymentMethod,
    paymentSplits: resolvedSplits,
    bcvEquivalent,
    debtorName: input.paymentStatus === 'Pendiente' ? cleanDebtor : undefined,
    deliveryDate: input.deliveryDate?.trim() || undefined,
    breakdown,
    userName: currentUserName,
    ...(opId ? { clientOperationId: opId } : {}),
    createdAt: now,
  };

  const nextCustomers = mergeCustomerProfileIntoList(
    state.customers,
    {
      name: cleanCustomer,
      phone: cleanPhone,
      city: cleanCity,
      social: cleanSocial,
      idDoc: cleanIdDoc,
    },
    now,
  );

  const nextSales = [saleRecord, ...state.sales].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  const nextState: AppState = {
    ...state,
    cashOnHand: nextCash,
    inventory: workingInventory,
    receivables: nextReceivables,
    sales: nextSales,
    ...(nextCustomers ? { customers: nextCustomers } : {}),
    nextInvoiceSeq: invoiceSeq + 1,
    funds: nextFunds,
    movements: [
      {
        id: `mov-${Date.now()}`,
        type: 'sale',
        description: `${invoiceNumber} · Venta a ${cleanCustomer}: ${summaryItemsText} · ${paymentMethod} · ${
          input.paymentStatus === 'Cobrado'
            ? 'Cobrado'
            : paidAtSale > 0
              ? `Crédito (${cleanDebtor} · Abono ${formatUSD(paidAtSale)}, resta ${formatUSD(pendingReceivableAmount)})`
              : `Crédito (${cleanDebtor})`
        }`,
        amount: totalFinalPrice,
        createdAt: now,
      },
      ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
    ],
  };

  return { ok: true, state: nextState, createdSale: saleRecord };
}

export function registerSale(
  state: AppState,
  input: RegisterSaleInput,
): ActionResult {
  const quantity = Math.floor(input.quantity);
  const unitPrice = quantity > 0 ? input.finalPrice / quantity : 0;
  return registerMultiItemSale(state, {
    items: [
      {
        skuId: input.skuId,
        quantity: input.quantity,
        unitPrice,
      },
    ],
    customerName: input.customerName?.trim() || input.debtorName?.trim(),
    customerCity: input.customerCity,
    customerPhone: input.customerPhone,
    customerSocial: input.customerSocial,
    customerIdDoc: input.customerIdDoc,
    seller: input.seller,
    paymentStatus: input.paymentStatus,
    paymentMethod: input.paymentMethod,
    paymentSplits: input.paymentSplits,
    debtorName: input.debtorName,
    deliveryDate: input.deliveryDate,
    actorName: input.actorName,
  });
}

export interface BatchPurchaseLineInput {
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  factoryUnitCost: number;
  salePrice?: number;
}

export interface RegisterImportBatchInput {
  entryDate: string;
  estimatedArrivalDate?: string;
  receivedDate?: string;
  supplier?: string;
  referenceName: string;
  shippingType: ShippingType;
  totalFreightCost: number;
  fundingSource?: PurchaseFundingSource;
  retailPricingMode?: PurchasePricingMode;
  isDirectReception?: boolean;
  clientOperationId?: string;
  usdtRate?: number;
  actorName?: string;
  items: BatchPurchaseLineInput[];
}

export interface ReceiveBatchLineInput {
  itemIndex: number;
  receivedQuantity: number;
  salePrice?: number;
}

export interface ReceiveImportBatchInput {
  batchId: string;
  receivedDate?: string;
  actualFreightCost: number;
  retailPricingMode?: PurchasePricingMode;
  clientOperationId?: string;
  receivedItems: ReceiveBatchLineInput[];
}

export function calculateElapsedTransitDays(
  entryDate?: string,
  receivedDate?: string,
): number {
  const startStr = (entryDate ?? '').trim().slice(0, 10);
  const endStr = (receivedDate ?? '').trim().slice(0, 10);
  if (!startStr || !endStr) return 0;
  const startMs = Date.parse(`${startStr}T00:00:00Z`);
  const endMs = Date.parse(`${endStr}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000));
}

export function getTransitCapitalSummary(state: AppState): {
  transitBatches: PurchaseBatchRecord[];
  receivedBatches: PurchaseBatchRecord[];
  transitCount: number;
  transitUnits: number;
  transitCapital: number;
} {
  const all = state.purchaseBatches ?? [];
  const transitBatches = all.filter((b) => b.status === 'EN TRÁNSITO');
  const receivedBatches = all.filter((b) => b.status !== 'EN TRÁNSITO');
  const transitUnits = transitBatches.reduce((sum, b) => sum + b.totalUnits, 0);
  const transitCapital = round2(
    transitBatches.reduce((sum, b) => sum + b.totalLandedCost, 0),
  );
  return {
    transitBatches,
    receivedBatches,
    transitCount: transitBatches.length,
    transitUnits,
    transitCapital,
  };
}

/**
 * ETAPA 1: Crea una orden de compra en tránsito.
 * Descuenta inmediatamente de Caja General o Fondo de Reinversión y guarda como "EN TRÁNSITO"
 * SIN ingresar aún las unidades al inventario disponible.
 */
export function createImportOrder(
  state: AppState,
  input: RegisterImportBatchInput,
): ActionResult {
  const opId = input.clientOperationId?.trim();
  if (
    opId &&
    (state.purchaseBatches ?? []).some((b) => b.clientOperationId === opId)
  ) {
    return {
      ok: false,
      error:
        'Esta orden de compra ya fue registrada previamente (prevención automática de duplicados).',
      state,
    };
  }

  const refName = input.referenceName.trim();
  if (!refName) {
    return {
      ok: false,
      error: 'Ingresa el nombre o referencia de la orden de envío.',
      state,
    };
  }

  const entryDate = input.entryDate.trim() || new Date().toISOString().slice(0, 10);
  const estimatedFreightCost = round2(input.totalFreightCost);
  if (!Number.isFinite(estimatedFreightCost) || estimatedFreightCost < 0) {
    return {
      ok: false,
      error: 'El costo estimado del flete no puede ser negativo.',
      state,
    };
  }

  if (!input.items || input.items.length === 0) {
    return {
      ok: false,
      error: 'Agrega al menos un modelo a la orden de importación.',
      state,
    };
  }

  let totalUnits = 0;
  let totalFactoryCostRaw = 0;

  for (const item of input.items) {
    if (!item.model.trim()) {
      return {
        ok: false,
        error: 'Todos los ítems de la orden deben tener un nombre de modelo.',
        state,
      };
    }
    const qty = Math.floor(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return {
        ok: false,
        error: `La cantidad para ${item.model} debe ser mayor a 0.`,
        state,
      };
    }
    const fCost = round2(item.factoryUnitCost);
    if (!Number.isFinite(fCost) || fCost <= 0) {
      return {
        ok: false,
        error: `El precio unitario de fábrica para ${item.model} debe ser mayor a $0.00.`,
        state,
      };
    }
    totalUnits += qty;
    totalFactoryCostRaw += qty * fCost;
  }

  const fundingSource: PurchaseFundingSource =
    input.fundingSource ?? 'cashOnHand';
  const totalFactoryCost = round2(totalFactoryCostRaw);
  const totalLandedCost = round2(totalFactoryCost + estimatedFreightCost);

  if (totalLandedCost > state.cashOnHand) {
    return {
      ok: false,
      error: `Efectivo insuficiente en caja (${formatUSD(state.cashOnHand)}) para cubrir el desembolso de la orden (${formatUSD(totalLandedCost)}).`,
      state,
    };
  }

  const freightPerUnitExact = estimatedFreightCost / totalUnits;
  const freightPerUnitDisplay = round2(freightPerUnitExact);

  const now = new Date().toISOString();
  const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const batchItems: PurchaseBatchItemRecord[] = input.items.map((line) => {
    const cleanModel = line.model.trim();
    const qty = Math.floor(line.quantity);
    const factoryUnitCost = round2(line.factoryUnitCost);
    const exactLandedUnitCost = round4(factoryUnitCost + freightPerUnitExact);
    const landedUnitCostDisplay = round2(exactLandedUnitCost);
    return {
      team: line.team,
      model: cleanModel,
      version: line.version,
      size: line.size,
      orderedQuantity: qty,
      quantity: qty,
      salePrice:
        line.salePrice && line.salePrice > 0
          ? round2(line.salePrice)
          : undefined,
      factoryUnitCost,
      proratedFreightPerUnit: freightPerUnitDisplay,
      landedUnitCost: landedUnitCostDisplay,
      lineFactoryTotal: round2(qty * factoryUnitCost),
      lineLandedTotal: round2(qty * exactLandedUnitCost),
    };
  });

  const batchUsdtRate =
    input.usdtRate && Number.isFinite(input.usdtRate) && input.usdtRate > 0
      ? round2(input.usdtRate)
      : state.exchangeRates.usdt;

  const estimatedArrivalDate = input.estimatedArrivalDate?.trim() || undefined;
  const cleanSupplier = input.supplier?.trim() || undefined;

  const currentUserName = input.actorName?.trim() || 'Jesús César';

  const batchRecord: PurchaseBatchRecord = {
    id: batchId,
    status: 'EN TRÁNSITO',
    fundingSource,
    entryDate,
    ...(estimatedArrivalDate ? { estimatedArrivalDate } : {}),
    ...(cleanSupplier ? { supplier: cleanSupplier } : {}),
    ...(input.retailPricingMode ? { retailPricingMode: input.retailPricingMode } : {}),
    ...(input.isDirectReception ? { isDirectReception: true } : {}),
    ...(opId ? { clientOperationId: opId } : {}),
    referenceName: refName,
    shippingType: input.shippingType,
    orderedTotalUnits: totalUnits,
    totalUnits,
    totalFactoryCost,
    estimatedFreightCost,
    totalFreightCost: estimatedFreightCost,
    freightPerUnit: freightPerUnitDisplay,
    totalLandedCost,
    usdtRate: batchUsdtRate,
    items: batchItems,
    userName: currentUserName,
    createdAt: now,
  };

  const fundingLabel =
    fundingSource === 'replacement'
      ? 'Fondo Reposición'
      : fundingSource === 'growthReinvestment'
        ? 'Fondo Reinversión'
        : 'Caja General';

  const nextCashAfterOrder = round2(state.cashOnHand - totalLandedCost);
  const rawOrderFunds: FinancialFunds =
    fundingSource === 'replacement' || fundingSource === 'growthReinvestment'
      ? deductWithRepoReinvestmentBridge(
          state.funds,
          fundingSource,
          totalLandedCost,
        )
      : {
          ...state.funds,
          commissionsBySeller: { ...state.funds.commissionsBySeller },
          dividendsByPartner: { ...state.funds.dividendsByPartner },
        };
  const reconciledOrderFunds = reconcileFundsToPhysicalCash(
    rawOrderFunds,
    nextCashAfterOrder,
  ).funds;

  const nextState: AppState = {
    ...state,
    cashOnHand: nextCashAfterOrder,
    funds: reconciledOrderFunds,
    purchaseBatches: [batchRecord, ...(state.purchaseBatches ?? [])],
    movements: [
      {
        id: `mov-${Date.now()}`,
        type: 'purchase',
        description: `Orden EN TRÁNSITO: ${refName} (${input.shippingType}) · ${totalUnits} uds · Pago ${fundingLabel} (Fábrica ${formatUSD(totalFactoryCost)} + Flete est. ${formatUSD(estimatedFreightCost)})`,
        amount: -totalLandedCost,
        createdAt: now,
      },
      ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
    ],
  };

  return { ok: true, state: nextState, createdBatch: batchRecord };
}

export function attachSaleCalendarMetadata(
  state: AppState,
  saleId: string,
  calendarEventId: string,
  calendarEventLink?: string,
): AppState {
  return {
    ...state,
    sales: state.sales.map((s) =>
      s.id === saleId
        ? {
            ...s,
            calendarEventId,
            ...(calendarEventLink ? { calendarEventLink } : {}),
          }
        : s,
    ),
  };
}

export function attachPurchaseBatchCalendarMetadata(
  state: AppState,
  batchId: string,
  calendarEventId: string,
  calendarEventLink?: string,
): AppState {
  return {
    ...state,
    purchaseBatches: state.purchaseBatches.map((b) =>
      b.id === batchId
        ? {
            ...b,
            calendarEventId,
            ...(calendarEventLink ? { calendarEventLink } : {}),
          }
        : b,
    ),
  };
}

/**
 * ETAPA 2: Recepción y auditoría de ingreso a bodega.
 * Recalcula Landed Cost con flete real prorrateado sobre las piezas recibidas,
 * ajusta la diferencia de flete en caja/fondo, ingresa al inventario FIFO con fecha de recepción
 * y cambia el estatus del lote a "RECIBIDO EN BODEGA".
 */
export function receiveImportBatch(
  state: AppState,
  input: ReceiveImportBatchInput,
): ActionResult {
  const existingBatches = state.purchaseBatches ?? [];
  const batchIdx = existingBatches.findIndex((b) => b.id === input.batchId);
  if (batchIdx < 0) {
    return {
      ok: false,
      error: 'Orden de importación no encontrada.',
      state,
    };
  }

  const targetBatch = existingBatches[batchIdx];
  if (targetBatch.status !== 'EN TRÁNSITO') {
    return {
      ok: false,
      error: 'Este lote ya fue recibido y auditado en bodega.',
      state,
    };
  }

  const actualFreightCost = round2(input.actualFreightCost);
  if (!Number.isFinite(actualFreightCost) || actualFreightCost < 0) {
    return {
      ok: false,
      error: 'El costo real del flete debe ser mayor o igual a $0.00.',
      state,
    };
  }

  const receivedDate =
    input.receivedDate?.trim() || new Date().toISOString().slice(0, 10);

  const qtyByIndex = new Map<number, number>();
  const priceByIndex = new Map<number, number>();
  for (const item of input.receivedItems ?? []) {
    qtyByIndex.set(item.itemIndex, Math.floor(Number(item.receivedQuantity) || 0));
    if (
      typeof item.salePrice === 'number' &&
      Number.isFinite(item.salePrice) &&
      item.salePrice > 0
    ) {
      priceByIndex.set(item.itemIndex, round2(item.salePrice));
    }
  }

  const receivedCounts: number[] = [];
  let totalReceivedUnits = 0;
  let actualTotalFactoryCostRaw = 0;

  for (let i = 0; i < targetBatch.items.length; i++) {
    const orderedItem = targetBatch.items[i];
    const qty = qtyByIndex.has(i)
      ? qtyByIndex.get(i)!
      : orderedItem.orderedQuantity;
    if (!Number.isFinite(qty) || qty < 0) {
      return {
        ok: false,
        error: `La cantidad recibida para ${orderedItem.model} no puede ser negativa.`,
        state,
      };
    }
    receivedCounts.push(qty);
    totalReceivedUnits += qty;
    actualTotalFactoryCostRaw += qty * orderedItem.factoryUnitCost;
  }

  if (totalReceivedUnits <= 0) {
    return {
      ok: false,
      error: 'Debes confirmar al menos 1 prenda recibida para ingresar el lote a bodega.',
      state,
    };
  }

  const estimatedFreight =
    targetBatch.estimatedFreightCost ?? targetBatch.totalFreightCost;
  const freightDiff = round2(actualFreightCost - estimatedFreight);
  const arrivedFactoryCost = round2(actualTotalFactoryCostRaw);
  const factoryShortageUsd = round2(
    Math.max(0, targetBatch.totalFactoryCost - arrivedFactoryCost),
  );
  const fundingSource = targetBatch.fundingSource ?? 'cashOnHand';

  if (freightDiff > 0 && freightDiff > state.cashOnHand) {
    return {
      ok: false,
      error: `Efectivo insuficiente en caja (${formatUSD(state.cashOnHand)}) para cubrir la diferencia adicional de flete (+${formatUSD(freightDiff)}).`,
      state,
    };
  }

  const shortagePerUnitExact = factoryShortageUsd / totalReceivedUnits;
  const freightPerUnitExact = actualFreightCost / totalReceivedUnits;
  const freightPerUnitDisplay = round2(freightPerUnitExact);

  const now = new Date().toISOString();
  const nextInventory: InventoryItem[] = state.inventory.map((item) => ({
    ...item,
    fifoBatches: (item.fifoBatches ?? []).map((b) => ({ ...b })),
  }));

  const updatedItems: PurchaseBatchItemRecord[] = [];
  const nextLegacyPurchases = [...state.purchases];

  for (let i = 0; i < targetBatch.items.length; i++) {
    const line = targetBatch.items[i];
    const receivedQty = receivedCounts[i];
    const exactLandedUnitCost = round4(
      line.factoryUnitCost + shortagePerUnitExact + freightPerUnitExact,
    );
    const landedUnitCostDisplay = round2(exactLandedUnitCost);
    const lineFactoryTotal = round2(receivedQty * line.factoryUnitCost);
    const lineLandedTotal = round2(receivedQty * exactLandedUnitCost);

    const effectiveSalePrice = priceByIndex.has(i)
      ? priceByIndex.get(i)!
      : line.salePrice && line.salePrice > 0
        ? round2(line.salePrice)
        : undefined;

    let skuId = line.skuId;

    if (receivedQty > 0) {
      const normalizedModel = line.model.trim().toLowerCase();
      const targetCanonicalVer = normalizeVersionDisplay(line.version);
      const existingIdx = nextInventory.findIndex(
        (item) =>
          item.model.trim().toLowerCase() === normalizedModel &&
          normalizeVersionDisplay(item.version) === targetCanonicalVer &&
          item.size === line.size,
      );

      const fifoBatchEntry: FifoBatch = {
        batchId: `${targetBatch.id}-line-${i}`,
        batchName: targetBatch.referenceName,
        entryDate: receivedDate,
        initialQuantity: receivedQty,
        remainingQuantity: receivedQty,
        unitCost: exactLandedUnitCost,
        usdtRate: targetBatch.usdtRate ?? state.exchangeRates.usdt,
      };

      let previousCogs: number | null = null;

      if (existingIdx >= 0) {
        const existing = nextInventory[existingIdx];
        skuId = existing.id;
        previousCogs = existing.cogs;
        const updatedBatches = [
          ...(existing.fifoBatches ?? []),
          fifoBatchEntry,
        ].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
        const nextStock = existing.stock + receivedQty;
        const firstActive = updatedBatches.find((b) => b.remainingQuantity > 0);
        nextInventory[existingIdx] = {
          ...existing,
          stock: nextStock,
          fifoBatches: updatedBatches,
          cogs: firstActive ? round2(firstActive.unitCost) : landedUnitCostDisplay,
          salePrice: effectiveSalePrice ?? existing.salePrice,
        };
      } else {
        skuId = `sku-imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`;
        nextInventory.unshift({
          id: skuId,
          team: line.team,
          model: line.model.trim(),
          version: line.version,
          size: line.size,
          stock: receivedQty,
          cogs: landedUnitCostDisplay,
          salePrice:
            effectiveSalePrice ?? getDefaultSalePrice(line.version, line.model),
          fifoBatches: [fifoBatchEntry],
        });
      }

      nextLegacyPurchases.unshift({
        id: `pur-${Date.now()}-${i}`,
        skuId,
        team: line.team,
        model: line.model.trim(),
        version: line.version,
        size: line.size,
        quantity: receivedQty,
        unitCostWithFreight: landedUnitCostDisplay,
        totalCost: lineLandedTotal,
        previousCogs,
        resultingCogs: landedUnitCostDisplay,
        createdAt: now,
      });
    }

    updatedItems.push({
      ...line,
      skuId,
      ...(effectiveSalePrice ? { salePrice: effectiveSalePrice } : {}),
      quantity: receivedQty,
      receivedQuantity: receivedQty,
      proratedFreightPerUnit: freightPerUnitDisplay,
      landedUnitCost: landedUnitCostDisplay,
      lineFactoryTotal,
      lineLandedTotal,
    });
  }

  const totalLandedCost = round2(targetBatch.totalFactoryCost + actualFreightCost);
  const diasTranscurridos = targetBatch.isDirectReception
    ? 0
    : calculateElapsedTransitDays(targetBatch.entryDate, receivedDate);

  const updatedBatch: PurchaseBatchRecord = {
    ...targetBatch,
    status: 'RECIBIDO EN BODEGA',
    receivedDate,
    diasTranscurridos,
    ...(input.retailPricingMode
      ? { retailPricingMode: input.retailPricingMode }
      : {}),
    receivedAt: now,
    totalUnits: totalReceivedUnits,
    totalFactoryCost: targetBatch.totalFactoryCost,
    totalFreightCost: actualFreightCost,
    freightAdjustment: freightDiff,
    freightPerUnit: freightPerUnitDisplay,
    totalLandedCost,
    items: updatedItems,
  };

  const nextBatches = existingBatches.map((b, idx) =>
    idx === batchIdx ? updatedBatch : b,
  );

  const nextCashOnHand = round2(state.cashOnHand - freightDiff);
  let rawBatchFunds: FinancialFunds = {
    ...state.funds,
    commissionsBySeller: { ...state.funds.commissionsBySeller },
    dividendsByPartner: { ...state.funds.dividendsByPartner },
  };
  if (freightDiff > 0) {
    if (fundingSource === 'replacement' || fundingSource === 'growthReinvestment') {
      rawBatchFunds = deductWithRepoReinvestmentBridge(
        rawBatchFunds,
        fundingSource,
        freightDiff,
      );
    }
  } else if (freightDiff < 0) {
    const refund = round2(Math.abs(freightDiff));
    if (fundingSource === 'replacement') {
      rawBatchFunds.replacement = round2(rawBatchFunds.replacement + refund);
    } else if (fundingSource === 'growthReinvestment') {
      rawBatchFunds.growthReinvestment = round2(
        rawBatchFunds.growthReinvestment + refund,
      );
    }
  }
  const reconciledBatchFunds = reconcileFundsToPhysicalCash(
    rawBatchFunds,
    nextCashOnHand,
  ).funds;

  const adjustmentNote =
    freightDiff === 0
      ? 'sin ajuste de flete'
      : freightDiff > 0
        ? `cargo adicional flete +${formatUSD(freightDiff)}`
        : `reembolso flete -${formatUSD(Math.abs(freightDiff))}`;
  const shortageNote =
    factoryShortageUsd > 0
      ? ` · faltante fábrica ${formatUSD(factoryShortageUsd)} prorrateado (+${formatUSD(round2(shortagePerUnitExact))}/ud)`
      : '';

  return {
    ok: true,
    createdBatch: updatedBatch,
    state: {
      ...state,
      cashOnHand: nextCashOnHand,
      inventory: nextInventory,
      purchases: nextLegacyPurchases,
      purchaseBatches: nextBatches,
      funds: reconciledBatchFunds,
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'purchase',
          description: `${
            targetBatch.isDirectReception
              ? 'Recepción Directa EN BODEGA'
              : 'Recepción EN BODEGA'
          }: ${targetBatch.referenceName} · ${totalReceivedUnits}/${targetBatch.orderedTotalUnits} uds · Flete real ${formatUSD(actualFreightCost)} (${adjustmentNote}${shortageNote})`,
          amount: freightDiff !== 0 ? -freightDiff : 0,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

/**
 * Recepción Directa: registra una compra nueva e ingresa inmediatamente todas sus tallas
 * al inventario FIFO con status RECIBIDO EN BODEGA y diasTranscurridos = 0.
 */
export function registerDirectPurchaseBatch(
  state: AppState,
  input: RegisterImportBatchInput,
): ActionResult {
  const stage1 = createImportOrder(state, {
    ...input,
    isDirectReception: true,
  });
  if (!stage1.ok || !stage1.createdBatch) {
    return stage1;
  }

  const receivedDate = input.receivedDate?.trim() || input.entryDate;
  const stage2 = receiveImportBatch(stage1.state, {
    batchId: stage1.createdBatch.id,
    receivedDate,
    actualFreightCost: stage1.createdBatch.estimatedFreightCost,
    retailPricingMode: input.retailPricingMode,
    receivedItems: stage1.createdBatch.items.map((item, idx) => ({
      itemIndex: idx,
      receivedQuantity: item.orderedQuantity,
      salePrice: item.salePrice,
    })),
  });

  if (!stage2.ok) {
    return {
      ok: false,
      error: stage2.error,
      state,
    };
  }

  return stage2;
}

export function registerImportBatch(
  state: AppState,
  input: RegisterImportBatchInput,
): ActionResult {
  if (input.isDirectReception) {
    return registerDirectPurchaseBatch(state, input);
  }
  return createImportOrder(state, input);
}

export interface RegisterPurchaseInput {
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  unitCostWithFreight: number;
}

export function registerPurchase(
  state: AppState,
  input: RegisterPurchaseInput,
): ActionResult {
  const today = new Date().toISOString().slice(0, 10);
  const stage1 = createImportOrder(state, {
    entryDate: today,
    referenceName: `Compra Directa · ${input.model.trim()}`,
    shippingType: 'Aéreo',
    totalFreightCost: 0,
    items: [
      {
        team: input.team,
        model: input.model,
        version: input.version,
        size: input.size,
        quantity: input.quantity,
        factoryUnitCost: input.unitCostWithFreight,
      },
    ],
  });
  if (!stage1.ok) return stage1;
  const createdBatch = stage1.state.purchaseBatches[0];
  return receiveImportBatch(stage1.state, {
    batchId: createdBatch.id,
    receivedDate: today,
    actualFreightCost: 0,
    receivedItems: [{ itemIndex: 0, receivedQuantity: input.quantity }],
  });
}

export function collectReceivable(
  state: AppState,
  receivableId: string,
  paymentMethod: PaymentMethod = 'Efectivo ($)',
  amountPaid?: number,
  clientOperationId?: string,
): ActionResult {
  const target = state.receivables.find((r) => r.id === receivableId);
  if (!target) {
    return { ok: false, error: 'Cuenta por cobrar no encontrada.', state };
  }

  const opId = clientOperationId?.trim();
  if (opId && target.clientLastOpId === opId) {
    return {
      ok: false,
      error:
        'Este abono ya fue procesado (prevención automática de duplicados).',
      state,
    };
  }

  const payAmount =
    amountPaid === undefined ? target.amount : round2(amountPaid);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    return {
      ok: false,
      error: 'El monto del pago o abono debe ser mayor a $0.00.',
      state,
    };
  }
  if (payAmount > round2(target.amount + 0.01)) {
    return {
      ok: false,
      error: `El abono (${formatUSD(payAmount)}) supera el saldo pendiente de ${target.debtor} (${formatUSD(target.amount)}).`,
      state,
    };
  }

  const effectivePayment = round2(Math.min(target.amount, payAmount));
  const remainingAmount = round2(Math.max(0, target.amount - effectivePayment));
  const isFullLiquidation = remainingAmount <= 0.009;
  const now = new Date().toISOString();

  const originalAmount = round2(target.originalAmount ?? target.amount);
  const previousPaid = round2(
    target.paidAmount ?? Math.max(0, originalAmount - target.amount),
  );
  const nextPaid = round2(previousPaid + effectivePayment);

  const installment: ReceivableInstallment = {
    id: `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    amount: effectivePayment,
    paymentMethod,
    createdAt: now,
  };

  const nextReceivables = isFullLiquidation
    ? state.receivables.filter((r) => r.id !== receivableId)
    : state.receivables.map((r) =>
        r.id === receivableId
          ? {
              ...r,
              amount: remainingAmount,
              originalAmount,
              paidAmount: nextPaid,
              installments: [installment, ...(r.installments ?? [])],
              ...(opId ? { clientLastOpId: opId } : {}),
            }
          : r,
      );

  // Sincronizar estado de liquidación y monto abonado de la venta asociada
  const nextSales = target.saleId
    ? state.sales.map((s) => {
        if (s.id !== target.saleId) return s;
        if (isFullLiquidation) {
          return {
            ...s,
            paymentStatus: 'Cobrado' as const,
            paidAmount: round2(Math.max(0, s.finalPrice - (s.returnedAmount ?? 0))),
          };
        }
        return {
          ...s,
          paidAmount: round2(
            Math.min(
              Math.max(0, s.finalPrice - (s.returnedAmount ?? 0)),
              (s.paidAmount ?? Math.max(0, s.finalPrice - (s.returnedAmount ?? 0) - target.amount)) +
                effectivePayment,
            ),
          ),
        };
      })
    : state.sales;

  const linkedSale = target.saleId
    ? state.sales.find((s) => s.id === target.saleId)
    : undefined;
  const nextFunds = linkedSale
    ? applyScaledBreakdownToFunds(
        state.funds,
        scaleBreakdownToCashAmount(linkedSale.breakdown, effectivePayment),
        linkedSale.seller,
      )
    : state.funds;

  const movementDescription = isFullLiquidation
    ? `Liquidación total recibida de ${target.debtor} (${paymentMethod})`
    : `Abono recibido de ${target.debtor} (${paymentMethod}) · Resta ${formatUSD(remainingAmount)}`;

  const nextState: AppState = {
    ...state,
    cashOnHand: round2(state.cashOnHand + effectivePayment),
    receivables: nextReceivables,
    sales: nextSales,
    collectedReceivablesCount: isFullLiquidation
      ? state.collectedReceivablesCount + 1
      : state.collectedReceivablesCount,
    funds: nextFunds,
    movements: [
      {
        id: `mov-${Date.now()}`,
        type: 'collection',
        description: movementDescription,
        amount: effectivePayment,
        createdAt: now,
      },
      ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
    ],
  };

  return { ok: true, state: nextState };
}

export function reinvestPartnerDividends(
  state: AppState,
  partner: PartnerName,
): ActionResult {
  const available = round2(state.funds.dividendsByPartner[partner]);
  if (available <= 0) {
    return {
      ok: false,
      error: `${partner} no tiene dividendos acumulados disponibles para reinvertir.`,
      state,
    };
  }

  const now = new Date().toISOString();
  const nextState: AppState = {
    ...state,
    funds: {
      ...state.funds,
      growthReinvestment: round2(state.funds.growthReinvestment + available),
      reinvestedFromDividendsTotal: round2(
        state.funds.reinvestedFromDividendsTotal + available,
      ),
      dividendsByPartner: {
        ...state.funds.dividendsByPartner,
        [partner]: 0,
      },
    },
    movements: [
      {
        id: `mov-${Date.now()}`,
        type: 'reinvestment',
        description: `Reinversión de dividendos de ${partner} al Fondo de Crecimiento`,
        amount: available,
        createdAt: now,
      },
      ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
    ],
  };

  return { ok: true, state: nextState };
}

export function withdrawPartnerDividends(
  state: AppState,
  partner: PartnerName,
  vitalReserveMinUsd = 150,
  amount?: number,
): ActionResult {
  const minReserve = round2(Math.max(0, vitalReserveMinUsd));
  if (state.cashOnHand < round2(minReserve - 0.001)) {
    return {
      ok: false,
      error: `Bloqueado por Mínimo Vital de Reserva: el Efectivo Físico en Caja (${formatUSD(state.cashOnHand)}) está por debajo del mínimo requerido (${formatUSD(minReserve)}).`,
      state,
    };
  }

  const available = round2(Math.max(0, state.funds.dividendsByPartner[partner] ?? 0));
  if (available <= 0) {
    return {
      ok: false,
      error: `${partner} no tiene dividendos acumulados disponibles para retirar.`,
      state,
    };
  }

  const withdrawAmount = amount !== undefined ? round2(amount) : available;
  if (!Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
    return {
      ok: false,
      error: 'El monto del retiro de dividendos debe ser mayor a $0.00.',
      state,
    };
  }
  if (withdrawAmount > round2(available + 0.001)) {
    return {
      ok: false,
      error: `El retiro (${formatUSD(withdrawAmount)}) supera los dividendos disponibles de ${partner} (${formatUSD(available)}).`,
      state,
    };
  }
  if (withdrawAmount > round2(state.cashOnHand + 0.001)) {
    return {
      ok: false,
      error: `Efectivo físico insuficiente en caja (${formatUSD(state.cashOnHand)}) para retirar ${formatUSD(withdrawAmount)}.`,
      state,
    };
  }

  const nextCashOnHand = round2(Math.max(0, state.cashOnHand - withdrawAmount));
  const rawNextFunds: FinancialFunds = {
    ...state.funds,
    commissionsBySeller: { ...state.funds.commissionsBySeller },
    dividendsByPartner: {
      ...state.funds.dividendsByPartner,
      [partner]: round2(Math.max(0, available - withdrawAmount)),
    },
  };
  const nextFunds = reconcileFundsToPhysicalCash(
    rawNextFunds,
    nextCashOnHand,
  ).funds;
  const now = new Date().toISOString();

  return {
    ok: true,
    state: {
      ...state,
      cashOnHand: nextCashOnHand,
      funds: nextFunds,
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'dividend_withdrawal',
          description: `Retiro de dividendos de ${partner} (-${formatUSD(withdrawAmount)})`,
          amount: -withdrawAmount,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

export function syncUnassignedCashToGrowthFund(state: AppState): ActionResult {
  const totalAllocated = getTotalAllocatedFunds(state.funds);
  const unassignedCash = round2(Math.max(0, state.cashOnHand - totalAllocated));
  if (unassignedCash <= 0) {
    return {
      ok: false,
      error: 'La suma de fondos ya coincide con el Efectivo Físico en Caja.',
      state,
    };
  }

  const now = new Date().toISOString();
  return {
    ok: true,
    state: {
      ...state,
      funds: {
        ...state.funds,
        growthReinvestment: round2(
          state.funds.growthReinvestment + unassignedCash,
        ),
      },
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'funds_sync',
          description: `Sincronización de efectivo libre en caja (+${formatUSD(unassignedCash)}) al Fondo de Reinversión`,
          amount: unassignedCash,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

export function updateExchangeRates(
  state: AppState,
  bcv: number,
  usdt: number,
  source: 'api' | 'manual' | 'excel' = 'manual',
): ActionResult {
  const cleanBcv = round2(bcv);
  const cleanUsdt = round2(usdt);

  if (
    !Number.isFinite(cleanBcv) ||
    cleanBcv <= 0 ||
    !Number.isFinite(cleanUsdt) ||
    cleanUsdt <= 0
  ) {
    return {
      ok: false,
      error: 'Las tasas BCV y USDT deben ser valores numéricos mayores a 0.',
      state,
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      exchangeRates: {
        bcv: cleanBcv,
        usdt: cleanUsdt,
        updatedAt: new Date().toISOString(),
        source,
      },
    },
  };
}

export interface RegisterOperatingExpenseInput {
  concept: string;
  category: ExpenseCategory;
  amount: number;
  source: ExpenseSource;
  paymentMethod?: SinglePaymentMethod;
}

export function registerOperatingExpense(
  state: AppState,
  input: RegisterOperatingExpenseInput,
): ActionResult {
  const concept = input.concept.trim();
  if (!concept) {
    return {
      ok: false,
      error: 'Ingresa el concepto o descripción del gasto operativo.',
      state,
    };
  }

  const normalizedCategory = normalizeExpenseCategory(input.category);
  if (!normalizedCategory) {
    return {
      ok: false,
      error: 'Selecciona una categoría obligatoria para clasificar el gasto.',
      state,
    };
  }

  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      error: 'El monto del gasto debe ser mayor a $0.00.',
      state,
    };
  }

  if (amount > state.cashOnHand) {
    return {
      ok: false,
      error: `Efectivo físico insuficiente en caja (${formatUSD(state.cashOnHand)}) para cubrir el gasto de ${formatUSD(amount)}.`,
      state,
    };
  }

  const nextCashOnHand = round2(state.cashOnHand - amount);
  let nextFunds: FinancialFunds = {
    ...state.funds,
    commissionsBySeller: { ...state.funds.commissionsBySeller },
    dividendsByPartner: { ...state.funds.dividendsByPartner },
  };
  let deficitCoveredByFunds = 0;

  if (input.source === 'operatingFund') {
    const available = round2(Math.max(0, nextFunds.operatingAndAds));
    const covered = round2(Math.min(available, amount));
    nextFunds.operatingAndAds = round2(available - covered);

    const deficit = round2(amount - covered);
    if (deficit > 0) {
      nextFunds = deductProportionalFromFunds(nextFunds, deficit);
      deficitCoveredByFunds = deficit;
    }
  } else if (
    input.source === 'growthReinvestment' ||
    input.source === 'replacement'
  ) {
    const primaryAvailable = round2(
      Math.max(
        0,
        input.source === 'replacement'
          ? nextFunds.replacement
          : nextFunds.growthReinvestment,
      ),
    );
    nextFunds = deductWithRepoReinvestmentBridge(
      nextFunds,
      input.source,
      amount,
    );
    const deficit = round2(Math.max(0, amount - primaryAvailable));
    if (deficit > 0) {
      deficitCoveredByFunds = deficit;
    }
  } else if (input.source === 'dividends') {
    const jVal = round2(Math.max(0, nextFunds.dividendsByPartner.Jesús));
    const joVal = round2(Math.max(0, nextFunds.dividendsByPartner.Josué));
    const gVal = round2(Math.max(0, nextFunds.dividendsByPartner.Gabriel));
    const totalDivs = round2(jVal + joVal + gVal);
    const covered = round2(Math.min(totalDivs, amount));

    if (totalDivs > 0 && covered > 0) {
      if (covered >= totalDivs) {
        nextFunds.dividendsByPartner = { Jesús: 0, Josué: 0, Gabriel: 0 };
      } else {
        const ratio = covered / totalDivs;
        let dJ = Math.min(jVal, round2(jVal * ratio));
        let dJo = Math.min(joVal, round2(joVal * ratio));
        let dG = Math.min(gVal, round2(gVal * ratio));
        const drift = round2(covered - (dJ + dJo + dG));
        if (Math.abs(drift) >= 0.01) {
          if (jVal - dJ >= drift && dJ + drift >= 0) dJ = round2(dJ + drift);
          else if (joVal - dJo >= drift && dJo + drift >= 0)
            dJo = round2(dJo + drift);
          else dG = round2(Math.max(0, Math.min(gVal, dG + drift)));
        }
        nextFunds.dividendsByPartner = {
          Jesús: round2(Math.max(0, jVal - dJ)),
          Josué: round2(Math.max(0, joVal - dJo)),
          Gabriel: round2(Math.max(0, gVal - dG)),
        };
      }
    }

    const deficit = round2(amount - covered);
    if (deficit > 0) {
      nextFunds = deductProportionalFromFunds(nextFunds, deficit);
      deficitCoveredByFunds = deficit;
    }
  } else {
    // 'cashOnHand': Si hay fondos asignados cubriendo el efectivo físico, descontar proporcionalmente si excede
    const reconciledCash = reconcileFundsToPhysicalCash(
      nextFunds,
      nextCashOnHand,
    );
    nextFunds = reconciledCash.funds;
    if (reconciledCash.deficitApplied > 0) {
      deficitCoveredByFunds = reconciledCash.deficitApplied;
    }
  }

  // Estricta conciliación con efectivo físico en caja: Suma de Fondos <= Efectivo Físico en Caja
  const reconciled = reconcileFundsToPhysicalCash(nextFunds, nextCashOnHand);
  nextFunds = reconciled.funds;
  if (input.source !== 'cashOnHand' && reconciled.deficitApplied > 0) {
    deficitCoveredByFunds = round2(
      deficitCoveredByFunds + reconciled.deficitApplied,
    );
  }

  const paymentMethod: SinglePaymentMethod = input.paymentMethod ?? 'Efectivo ($)';
  const now = new Date().toISOString();

  const expenseRecord: OperatingExpenseRecord = {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    concept,
    category: normalizedCategory,
    amount,
    source: input.source,
    paymentMethod,
    deficitCoveredByFunds:
      deficitCoveredByFunds > 0 ? deficitCoveredByFunds : undefined,
    createdAt: now,
  };

  const sourceLabelMap: Record<ExpenseSource, string> = {
    operatingFund: 'Fondo Operativo 10%',
    growthReinvestment: 'Fondo Reinversión',
    replacement: 'Fondo Reposición',
    dividends: 'Reparto de Dividendos',
    cashOnHand: 'Caja General',
  };

  const deficitNote =
    deficitCoveredByFunds > 0
      ? ` · Regla de Déficit aplicada (-${formatUSD(deficitCoveredByFunds)} proporcional en fondos)`
      : '';

  return {
    ok: true,
    state: {
      ...state,
      cashOnHand: nextCashOnHand,
      operatingExpenses: [expenseRecord, ...(state.operatingExpenses ?? [])],
      funds: nextFunds,
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'expense',
          description: `Gasto [${normalizedCategory}]: ${concept} (${paymentMethod} · ${sourceLabelMap[input.source]}${deficitNote})`,
          amount: -amount,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

export interface ProcessReturnExchangeInput {
  type: ReturnExchangeType;
  saleId?: string;
  invoiceNumber?: string;
  returnedSkuId: string;
  returnedQuantity: number;
  returnedUnitPrice: number;
  replacementSkuId?: string;
  replacementQuantity?: number;
  replacementUnitPrice?: number;
  paymentMethod?: SinglePaymentMethod;
  reason?: string;
  customerName?: string;
  seller?: SellerName;
  clientOperationId?: string;
}

/**
 * Procesa devoluciones y cambios de mercancía:
 * - Restaura al inventario + capa FIFO la(s) franela(s) devuelta(s).
 * - En caso de Cambio, descuenta por FIFO la(s) prenda(s) de reemplazo.
 * - Calcula automáticamente la diferencia de precio:
 *     > 0: Cliente paga diferencia (+caja y distribución 4 Capas sobre diferencial de precio/costo FIFO)
 *     < 0: Se reembolsa al cliente (-deuda pendiente si aplica y -caja con reverso proporcional de fondos)
 *     = 0: Cambio parejo
 */
export function processReturnOrExchange(
  state: AppState,
  input: ProcessReturnExchangeInput,
  matrixParams?: MatrixConfigParams,
): ActionResult {
  const opId = input.clientOperationId?.trim();
  if (opId && (state.returns ?? []).some((r) => r.clientOperationId === opId)) {
    return {
      ok: false,
      error:
        'Esta devolución o cambio ya fue procesada (prevención automática de duplicados).',
      state,
    };
  }

  const returnedQty = Math.floor(input.returnedQuantity);
  if (!Number.isFinite(returnedQty) || returnedQty <= 0) {
    return {
      ok: false,
      error: 'La cantidad devuelta debe ser un entero mayor a 0.',
      state,
    };
  }

  const returnedUnitPrice = round2(input.returnedUnitPrice);
  if (!Number.isFinite(returnedUnitPrice) || returnedUnitPrice <= 0) {
    return {
      ok: false,
      error: 'El precio de la prenda devuelta debe ser mayor a $0.00.',
      state,
    };
  }

  const workingInventory: InventoryItem[] = state.inventory.map((item) => ({
    ...item,
    fifoBatches: (item.fifoBatches ?? []).map((b) => ({ ...b })),
  }));

  const retSkuIdx = workingInventory.findIndex(
    (i) => i.id === input.returnedSkuId,
  );
  if (retSkuIdx < 0) {
    return {
      ok: false,
      error: 'El producto devuelto no se encontró en el inventario actual.',
      state,
    };
  }

  const retSku = workingInventory[retSkuIdx];
  const linkedSale = input.saleId
    ? state.sales.find((s) => s.id === input.saleId)
    : undefined;
  const linkedLine = linkedSale?.items?.find(
    (l) => l.skuId === input.returnedSkuId,
  );
  const restoreUnitCogs = linkedLine
    ? round4(linkedLine.unitCogs)
    : getNextFifoUnitCost(retSku);

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // 1. Restaurar prenda devuelta al inventario y a capas FIFO
  const restoredBatch: FifoBatch = {
    batchId: `fifo-ret-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    batchName:
      input.type === 'Cambio'
        ? `Cambio recibido (${input.invoiceNumber || linkedSale?.invoiceNumber || 'Mostrador'})`
        : `Devolución (${input.invoiceNumber || linkedSale?.invoiceNumber || 'Mostrador'})`,
    entryDate: today,
    initialQuantity: returnedQty,
    remainingQuantity: returnedQty,
    unitCost: restoreUnitCogs,
  };

  const nextRetBatches = [...(retSku.fifoBatches ?? []), restoredBatch].sort(
    (a, b) => a.entryDate.localeCompare(b.entryDate),
  );
  const firstActiveRet = nextRetBatches.find((b) => b.remainingQuantity > 0);
  workingInventory[retSkuIdx] = {
    ...retSku,
    stock: retSku.stock + returnedQty,
    fifoBatches: nextRetBatches,
    cogs: firstActiveRet ? round2(firstActiveRet.unitCost) : round2(restoreUnitCogs),
  };

  // 2. Si es Cambio, validar y consumir prenda de reemplazo
  let repSku: InventoryItem | undefined;
  let replacementQty = 0;
  let replacementUnitPrice = 0;
  let replacementTotal = 0;
  let repFifoCost = 0;

  if (input.type === 'Cambio') {
    if (!input.replacementSkuId) {
      return {
        ok: false,
        error: 'Selecciona la franela de reemplazo para procesar el cambio.',
        state,
      };
    }

    replacementQty = Math.floor(input.replacementQuantity ?? 1);
    if (!Number.isFinite(replacementQty) || replacementQty <= 0) {
      return {
        ok: false,
        error: 'La cantidad de la prenda de reemplazo debe ser mayor a 0.',
        state,
      };
    }

    const repIdx = workingInventory.findIndex(
      (i) => i.id === input.replacementSkuId,
    );
    if (repIdx < 0) {
      return {
        ok: false,
        error: 'El producto de reemplazo no existe en el inventario.',
        state,
      };
    }

    const targetRep = workingInventory[repIdx];
    if (replacementQty > targetRep.stock) {
      return {
        ok: false,
        error: `Stock insuficiente para reemplazo de ${targetRep.model} (${targetRep.version} · ${targetRep.size}). Disponible: ${targetRep.stock}.`,
        state,
      };
    }

    replacementUnitPrice = round2(
      input.replacementUnitPrice ?? targetRep.salePrice,
    );
    if (!Number.isFinite(replacementUnitPrice) || replacementUnitPrice <= 0) {
      return {
        ok: false,
        error: 'El precio de la prenda de reemplazo debe ser mayor a $0.00.',
        state,
      };
    }

    const fifoOut = previewFifoConsumption(targetRep, replacementQty);
    repFifoCost = fifoOut.totalCost;
    const nextRepActive = fifoOut.updatedBatches.find(
      (b) => b.remainingQuantity > 0,
    );
    workingInventory[repIdx] = {
      ...targetRep,
      stock: targetRep.stock - replacementQty,
      fifoBatches: fifoOut.updatedBatches,
      cogs: nextRepActive ? round2(nextRepActive.unitCost) : targetRep.cogs,
    };
    repSku = workingInventory[repIdx];
    replacementTotal = round2(replacementQty * replacementUnitPrice);
  }

  const returnedTotal = round2(returnedQty * returnedUnitPrice);
  const differenceUsd = round2(replacementTotal - returnedTotal);

  let nextCash = state.cashOnHand;
  let nextReceivables = [...state.receivables];
  let nextSales = [...state.sales];
  const nextCollectedCount = state.collectedReceivablesCount;
  let nextFunds = {
    ...state.funds,
    commissionsBySeller: { ...state.funds.commissionsBySeller },
    dividendsByPartner: { ...state.funds.dividendsByPartner },
  };

  if (differenceUsd > 0) {
    // Cliente paga diferencia a favor de la tienda -> +caja y Matriz de 4 Capas sobre diferencial
    nextCash = round2(state.cashOnHand + differenceUsd);
    const returnedFifoCost = round2(restoreUnitCogs * returnedQty);
    const costDiff = round2(Math.max(0, repFifoCost - returnedFifoCost));
    const sellerForUpgrade: SellerName =
      input.seller ?? linkedSale?.seller ?? 'Sin Vendedor';
    const upgradeBreakdown = calculateFourLayerMatrixConsolidated(
      differenceUsd,
      costDiff,
      sellerForUpgrade,
      matrixParams,
    );
    nextFunds = applyScaledBreakdownToFunds(
      nextFunds,
      upgradeBreakdown,
      sellerForUpgrade,
    );
  } else if (differenceUsd < 0) {
    const refundTotal = round2(Math.abs(differenceUsd));
    let remainingCashRefund = refundTotal;
    let debtOffset = 0;
    let recIdx = -1;
    let newRecAmt = 0;

    // Si la venta original tiene saldo pendiente en CxC, reducir esa deuda primero
    if (linkedSale) {
      recIdx = nextReceivables.findIndex((r) => r.saleId === linkedSale.id);
      if (recIdx >= 0) {
        const rec = nextReceivables[recIdx];
        debtOffset = round2(Math.min(rec.amount, remainingCashRefund));
        newRecAmt = round2(rec.amount - debtOffset);
        remainingCashRefund = round2(remainingCashRefund - debtOffset);
      }
    }

    if (remainingCashRefund > state.cashOnHand) {
      return {
        ok: false,
        error: `Efectivo físico insuficiente en caja (${formatUSD(state.cashOnHand)}) para reembolsar ${formatUSD(remainingCashRefund)} al cliente.`,
        state,
      };
    }

    if (linkedSale) {
      const originalSaleUnits =
        linkedSale.items && linkedSale.items.length > 0
          ? linkedSale.items.reduce((sum, l) => sum + l.quantity, 0)
          : linkedSale.quantity;
      const previouslyReturnedUnits = (state.returns ?? [])
        .filter((r) => r.saleId === linkedSale.id && r.type === 'Devolución')
        .reduce((sum, r) => sum + r.returnedQuantity, 0);
      const remainingActiveUnits = Math.max(
        0,
        originalSaleUnits -
          previouslyReturnedUnits -
          (input.type === 'Devolución' ? returnedQty : 0),
      );
      const hasRemainingActiveItems =
        input.type === 'Cambio' ? true : remainingActiveUnits > 0;
      const nextReturnStatus: 'Parcial' | 'Total' = hasRemainingActiveItems
        ? 'Parcial'
        : 'Total';

      const prevReturnedAmount = round2(linkedSale.returnedAmount ?? 0);
      const nextReturnedAmount = round2(prevReturnedAmount + refundTotal);

      if (recIdx >= 0) {
        const rec = nextReceivables[recIdx];
        const currentPaid = round2(
          linkedSale.paidAmount !== undefined
            ? linkedSale.paidAmount
            : Math.max(
                0,
                linkedSale.finalPrice - prevReturnedAmount - rec.amount,
              ),
        );
        const netCashPaid = round2(
          Math.max(0, currentPaid - remainingCashRefund),
        );

        if (newRecAmt <= 0.009) {
          nextReceivables = nextReceivables.filter((r) => r.id !== rec.id);
          nextSales = nextSales.map((s) =>
            s.id === linkedSale.id
              ? {
                  ...s,
                  paymentStatus: 'Cobrado' as const,
                  paidAmount: netCashPaid,
                  returnedAmount: nextReturnedAmount,
                  returnStatus: nextReturnStatus,
                }
              : s,
          );
        } else {
          const nextRecOriginal = round2(
            Math.max(newRecAmt, (rec.originalAmount ?? rec.amount) - debtOffset),
          );
          nextReceivables = nextReceivables.map((r, idx) =>
            idx === recIdx
              ? { ...r, amount: newRecAmt, originalAmount: nextRecOriginal }
              : r,
          );
          nextSales = nextSales.map((s) =>
            s.id === linkedSale.id
              ? {
                  ...s,
                  paidAmount: netCashPaid,
                  returnedAmount: nextReturnedAmount,
                  returnStatus: nextReturnStatus,
                }
              : s,
          );
        }
      } else {
        const currentPaid = round2(
          linkedSale.paidAmount !== undefined
            ? linkedSale.paidAmount
            : Math.max(0, linkedSale.finalPrice - prevReturnedAmount),
        );
        const netCashPaid = round2(
          Math.max(0, currentPaid - remainingCashRefund),
        );
        nextSales = nextSales.map((s) =>
          s.id === linkedSale.id
            ? {
                ...s,
                paidAmount: netCashPaid,
                returnedAmount: nextReturnedAmount,
                returnStatus: nextReturnStatus,
              }
            : s,
        );
      }
    }

    nextCash = round2(state.cashOnHand - remainingCashRefund);
    if (remainingCashRefund > 0) {
      if (linkedSale?.breakdown) {
        const reversedBreakdown = scaleBreakdownToCashAmount(
          linkedSale.breakdown,
          remainingCashRefund,
        );
        nextFunds = deductReversedBreakdownFromFunds(
          nextFunds,
          reversedBreakdown,
          linkedSale.seller,
        );
      }
      nextFunds = reconcileFundsToPhysicalCash(nextFunds, nextCash).funds;
    }
  }

  const paymentMethod: SinglePaymentMethod = input.paymentMethod ?? 'Efectivo ($)';
  const reason =
    input.reason?.trim() ||
    (input.type === 'Cambio' ? 'Cambio de talla / modelo' : 'Devolución de cliente');
  const invoiceRef = input.invoiceNumber?.trim() || linkedSale?.invoiceNumber;

  const returnRecord: ReturnExchangeRecord = {
    id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: input.type,
    saleId: linkedSale?.id ?? input.saleId,
    invoiceNumber: invoiceRef,
    returnedSkuId: retSku.id,
    returnedModelLabel: retSku.model,
    returnedVersion: retSku.version,
    returnedSize: retSku.size,
    returnedQuantity: returnedQty,
    returnedUnitPrice,
    returnedTotal,
    replacementSkuId: repSku?.id,
    replacementModelLabel: repSku?.model,
    replacementVersion: repSku?.version,
    replacementSize: repSku?.size,
    replacementQuantity: repSku ? replacementQty : undefined,
    replacementUnitPrice: repSku ? replacementUnitPrice : undefined,
    replacementTotal: repSku ? replacementTotal : undefined,
    differenceUsd,
    paymentMethod,
    reason,
    customerName: input.customerName?.trim() || linkedSale?.customerName,
    ...(opId ? { clientOperationId: opId } : {}),
    createdAt: now,
  };

  const diffDesc =
    differenceUsd > 0
      ? `Cliente pagó +${formatUSD(differenceUsd)}`
      : differenceUsd < 0
        ? `Reembolso -${formatUSD(Math.abs(differenceUsd))}`
        : 'Cambio parejo ($0.00)';

  const movementDesc =
    input.type === 'Cambio' && repSku
      ? `Cambio${invoiceRef ? ` (${invoiceRef})` : ''}: ${returnedQty}x ${retSku.model} (${retSku.size}) → ${replacementQty}x ${repSku.model} (${repSku.size}) · ${diffDesc}`
      : `Devolución${invoiceRef ? ` (${invoiceRef})` : ''}: ${returnedQty}x ${retSku.model} (${retSku.size}) · ${diffDesc}`;

  return {
    ok: true,
    state: {
      ...state,
      cashOnHand: nextCash,
      inventory: workingInventory,
      receivables: nextReceivables,
      sales: nextSales,
      collectedReceivablesCount: nextCollectedCount,
      returns: [returnRecord, ...(state.returns ?? [])],
      funds: nextFunds,
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'return_exchange',
          description: movementDesc,
          amount: differenceUsd,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

export interface RegisterCapitalInjectionInput {
  contributor: string;
  concept: string;
  amount: number;
  paymentMethod?: SinglePaymentMethod;
  destination?: CapitalInjectionDestination;
}

/**
 * Registra una inyección de capital / aporte de liquidez externa.
 * Incrementa la caja operativa y el patrimonio líquido SIN alterar costos ni capas FIFO del inventario.
 */
export function registerCapitalInjection(
  state: AppState,
  input: RegisterCapitalInjectionInput,
): ActionResult {
  const contributor = input.contributor.trim();
  if (!contributor) {
    return {
      ok: false,
      error: 'Indica quién realiza el aporte o el origen de la inyección de dinero.',
      state,
    };
  }

  const concept = input.concept.trim() || 'Inyección de liquidez';
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      error: 'El monto de la inyección de dinero debe ser mayor a $0.00.',
      state,
    };
  }

  const paymentMethod: SinglePaymentMethod = input.paymentMethod ?? 'Efectivo ($)';
  const destination: CapitalInjectionDestination =
    input.destination ?? 'cashOnly';
  const now = new Date().toISOString();

  const record: CapitalInjectionRecord = {
    id: `inj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    contributor,
    concept,
    amount,
    paymentMethod,
    destination,
    createdAt: now,
  };

  const destLabel =
    destination === 'growthReinvestment'
      ? 'Caja + Fondo Reinversión'
      : destination === 'operatingFund'
        ? 'Caja + Fondo Operativo 10%'
        : 'Caja Operativa General';

  return {
    ok: true,
    state: {
      ...state,
      cashOnHand: round2(state.cashOnHand + amount),
      capitalInjections: [record, ...(state.capitalInjections ?? [])],
      funds: {
        ...state.funds,
        operatingAndAds:
          destination === 'operatingFund'
            ? round2(state.funds.operatingAndAds + amount)
            : state.funds.operatingAndAds,
        growthReinvestment:
          destination === 'growthReinvestment'
            ? round2(state.funds.growthReinvestment + amount)
            : state.funds.growthReinvestment,
      },
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'capital_injection',
          description: `Inyección de capital (${contributor}): ${concept} · ${paymentMethod} · ${destLabel}`,
          amount,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

export interface ReconcileCashInput {
  countedCash: number;
  reason?: string;
}

/**
 * Concilia el efectivo físico en caja contra el arqueo real contado
 * sin modificar el inventario ni sus capas de costo FIFO.
 */
export function reconcileCashOnHand(
  state: AppState,
  input: ReconcileCashInput,
): ActionResult {
  const counted = round2(input.countedCash);
  if (!Number.isFinite(counted) || counted < 0) {
    return {
      ok: false,
      error: 'El efectivo físico contado debe ser mayor o igual a $0.00.',
      state,
    };
  }

  const diff = round2(counted - state.cashOnHand);
  if (diff === 0) {
    return {
      ok: false,
      error: `La caja física ya coincide exactamente con ${formatUSD(state.cashOnHand)}.`,
      state,
    };
  }

  const reason = input.reason?.trim() || 'Conciliación / arqueo de caja';
  const now = new Date().toISOString();
  const reconciledFunds = reconcileFundsToPhysicalCash(state.funds, counted);

  return {
    ok: true,
    state: {
      ...state,
      cashOnHand: counted,
      funds: reconciledFunds.funds,
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'reconciliation',
          description: `Conciliación de caja (${reason}): ${formatUSD(state.cashOnHand)} → ${formatUSD(counted)}${
            reconciledFunds.deficitApplied > 0
              ? ` · Fondos ajustados -${formatUSD(reconciledFunds.deficitApplied)}`
              : ''
          }`,
          amount: diff,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

export interface AdjustInventoryCountInput {
  skuId: string;
  newStock: number;
  reason: string;
  actorName?: string;
}

export function adjustInventoryPhysicalCount(
  state: AppState,
  input: AdjustInventoryCountInput,
): ActionResult {
  const idx = state.inventory.findIndex((i) => i.id === input.skuId);
  if (idx < 0) {
    return { ok: false, error: 'SKU no encontrado en el catálogo.', state };
  }

  const newStock = Math.floor(input.newStock);
  if (!Number.isFinite(newStock) || newStock < 0) {
    return {
      ok: false,
      error: 'El conteo físico debe ser un número entero mayor o igual a 0.',
      state,
    };
  }

  const reason = input.reason.trim() || 'Conteo físico de inventario';
  const target = state.inventory[idx];
  const previousStock = target.stock;
  const delta = newStock - previousStock;

  if (delta === 0) {
    return {
      ok: false,
      error: `El conteo físico (${newStock} uds) coincide con el stock actual en sistema.`,
      state,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  let nextBatches: FifoBatch[];
  let nextCogs = target.cogs;
  let fifoLossCost: number | undefined;

  if (delta < 0) {
    const res = previewFifoConsumption(target, Math.abs(delta));
    nextBatches = res.updatedBatches;
    fifoLossCost = res.totalCost;
    const firstActive = nextBatches.find((b) => b.remainingQuantity > 0);
    nextCogs = firstActive ? round2(firstActive.unitCost) : target.cogs;
  } else {
    const unitCost = getNextFifoUnitCost(target);
    const adjustmentBatch: FifoBatch = {
      batchId: `fifo-adj-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      batchName: `Ajuste Físico (${reason})`,
      entryDate: today,
      initialQuantity: delta,
      remainingQuantity: delta,
      unitCost,
    };
    nextBatches = [...(target.fifoBatches ?? []), adjustmentBatch].sort((a, b) =>
      a.entryDate.localeCompare(b.entryDate),
    );
    const firstActive = nextBatches.find((b) => b.remainingQuantity > 0);
    nextCogs = firstActive ? round2(firstActive.unitCost) : unitCost;
  }

  const nextInventory = state.inventory.map((item, i) =>
    i === idx
      ? {
          ...item,
          stock: newStock,
          cogs: nextCogs,
          fifoBatches: nextBatches,
        }
      : item,
  );

  const currentUserName = input.actorName?.trim() || 'Jesús César';

  const adjustmentRecord: InventoryAdjustmentRecord = {
    id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    skuId: target.id,
    modelLabel: target.model,
    version: target.version,
    size: target.size,
    previousStock,
    newStock,
    delta,
    fifoLossCost,
    auditMode: 'manual',
    reason,
    userName: currentUserName,
    createdAt: now,
  };

  return {
    ok: true,
    state: {
      ...state,
      inventory: nextInventory,
      inventoryAdjustments: [
        adjustmentRecord,
        ...(state.inventoryAdjustments ?? []),
      ],
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'adjustment',
          description: `Ajuste físico ${target.model} (${target.version} ${target.size}): ${previousStock} → ${newStock} uds (${delta > 0 ? `+${delta}` : delta}) · ${reason}`,
          amount: fifoLossCost ? -fifoLossCost : 0,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

export interface RegisterManualAdjustmentInput {
  type: 'entrada' | 'salida';
  skuId: string;
  quantity: number;
  reason: string;
  actorName?: string;
}

export interface RegisterUncrossAdjustmentInput {
  sourceSkuId: string;
  targetSkuId: string;
  quantity: number;
  reason: string;
  actorName?: string;
}

/**
 * Registra una entrada manual (+X) o salida manual (-X) de inventario
 * preservando la trazabilidad de capas FIFO, motivos obligatorios y registro de auditoría.
 */
export function registerManualInventoryAdjustment(
  state: AppState,
  input: RegisterManualAdjustmentInput,
): ActionResult {
  const cleanReason = input.reason?.trim() ?? '';
  if (!cleanReason) {
    return {
      ok: false,
      error: 'Es obligatorio indicar el motivo del ajuste (ej. Error de ingreso, Daño/Merma).',
      state,
    };
  }

  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      ok: false,
      error: 'La cantidad a ajustar debe ser un número entero mayor a 0.',
      state,
    };
  }

  const idx = state.inventory.findIndex((i) => i.id === input.skuId);
  if (idx < 0) {
    return {
      ok: false,
      error: 'SKU seleccionado no encontrado en el inventario.',
      state,
    };
  }

  const target = state.inventory[idx];
  const previousStock = target.stock;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const currentUserName = input.actorName?.trim() || 'Jesús César';

  if (input.type === 'salida') {
    if (target.stock < quantity) {
      return {
        ok: false,
        error: `Stock insuficiente en bodega (${target.stock} uds) para retirar ${quantity} uds.`,
        state,
      };
    }

    const consumption = previewFifoConsumption(target, quantity);
    const newStock = target.stock - quantity;
    const firstActive = consumption.updatedBatches.find((b) => b.remainingQuantity > 0);
    const nextCogs = firstActive ? round2(firstActive.unitCost) : target.cogs;

    const nextInventory = state.inventory.map((item, i) =>
      i === idx
        ? {
            ...item,
            stock: newStock,
            cogs: nextCogs,
            fifoBatches: consumption.updatedBatches,
          }
        : item,
    );

    const adjustmentRecord: InventoryAdjustmentRecord = {
      id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      skuId: target.id,
      modelLabel: target.model,
      version: target.version,
      size: target.size,
      previousStock,
      newStock,
      delta: -quantity,
      fifoLossCost: consumption.totalCost,
      auditMode: 'manual',
      adjustmentType: 'salida',
      reason: cleanReason,
      userName: currentUserName,
      createdAt: now,
    };

    return {
      ok: true,
      state: {
        ...state,
        inventory: nextInventory,
        inventoryAdjustments: [
          adjustmentRecord,
          ...(state.inventoryAdjustments ?? []),
        ],
        movements: [
          {
            id: `mov-${Date.now()}`,
            type: 'adjustment',
            description: `Salida manual: -${quantity} uds de ${target.model} (${target.version} ${target.size}) · ${cleanReason}`,
            amount: consumption.totalCost ? -consumption.totalCost : 0,
            createdAt: now,
          },
          ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
        ],
      },
    };
  }

  // Entrada manual (+quantity)
  const newStock = target.stock + quantity;
  const unitCost = getNextFifoUnitCost(target);
  const adjustmentBatch: FifoBatch = {
    batchId: `fifo-adj-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    batchName: `Entrada Manual (${cleanReason})`,
    entryDate: today,
    initialQuantity: quantity,
    remainingQuantity: quantity,
    unitCost,
  };
  const nextBatches = [...(target.fifoBatches ?? []), adjustmentBatch].sort((a, b) =>
    a.entryDate.localeCompare(b.entryDate),
  );
  const firstActive = nextBatches.find((b) => b.remainingQuantity > 0);
  const nextCogs = firstActive ? round2(firstActive.unitCost) : unitCost;

  const nextInventory = state.inventory.map((item, i) =>
    i === idx
      ? {
          ...item,
          stock: newStock,
          cogs: nextCogs,
          fifoBatches: nextBatches,
        }
      : item,
  );

  const adjustmentRecord: InventoryAdjustmentRecord = {
    id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    skuId: target.id,
    modelLabel: target.model,
    version: target.version,
    size: target.size,
    previousStock,
    newStock,
    delta: quantity,
    auditMode: 'manual',
    adjustmentType: 'entrada',
    reason: cleanReason,
    userName: currentUserName,
    createdAt: now,
  };

  return {
    ok: true,
    state: {
      ...state,
      inventory: nextInventory,
      inventoryAdjustments: [
        adjustmentRecord,
        ...(state.inventoryAdjustments ?? []),
      ],
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'adjustment',
          description: `Entrada manual: +${quantity} uds a ${target.model} (${target.version} ${target.size}) · ${cleanReason}`,
          amount: 0,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

/**
 * Ejecuta un descruce de mercancía atómico:
 * Resta unidades de Modelo/Talla A (origen) y suma las mismas unidades a Modelo/Talla B (destino)
 * manteniendo la conservación de capital FIFO y registrando la trazabilidad completa.
 */
export function performInventoryUncross(
  state: AppState,
  input: RegisterUncrossAdjustmentInput,
): ActionResult {
  const cleanReason = input.reason?.trim() ?? '';
  if (!cleanReason) {
    return {
      ok: false,
      error: 'Es obligatorio indicar el motivo del descruce (ej. Descruce de tallas, Error de etiquetado).',
      state,
    };
  }

  if (input.sourceSkuId === input.targetSkuId) {
    return {
      ok: false,
      error: 'El modelo/talla origen y destino deben ser distintos para un descruce.',
      state,
    };
  }

  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      ok: false,
      error: 'La cantidad a descruzar debe ser un número entero mayor a 0.',
      state,
    };
  }

  const sourceIdx = state.inventory.findIndex((i) => i.id === input.sourceSkuId);
  const targetIdx = state.inventory.findIndex((i) => i.id === input.targetSkuId);

  if (sourceIdx < 0 || targetIdx < 0) {
    return {
      ok: false,
      error: 'Uno de los modelos/tallas seleccionados no existe en el catálogo.',
      state,
    };
  }

  const sourceItem = state.inventory[sourceIdx];
  const targetItem = state.inventory[targetIdx];

  if (sourceItem.stock < quantity) {
    return {
      ok: false,
      error: `Stock insuficiente en el origen (${sourceItem.model} ${sourceItem.size}: ${sourceItem.stock} uds) para transferir ${quantity} uds.`,
      state,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const currentUserName = input.actorName?.trim() || 'Jesús César';

  const sourceConsumption = previewFifoConsumption(sourceItem, quantity);
  const sourceNewStock = sourceItem.stock - quantity;
  const sourceFirstActive = sourceConsumption.updatedBatches.find(
    (b) => b.remainingQuantity > 0,
  );
  const sourceNextCogs = sourceFirstActive
    ? round2(sourceFirstActive.unitCost)
    : sourceItem.cogs;

  const unitCostTransferred =
    quantity > 0
      ? round2(sourceConsumption.totalCost / quantity)
      : sourceItem.cogs;

  const targetNewStock = targetItem.stock + quantity;
  const uncrossBatch: FifoBatch = {
    batchId: `fifo-uncross-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    batchName: `Descruce desde ${sourceItem.model} (${sourceItem.size}) · ${cleanReason}`,
    entryDate: today,
    initialQuantity: quantity,
    remainingQuantity: quantity,
    unitCost: unitCostTransferred > 0 ? unitCostTransferred : targetItem.cogs,
  };

  const targetNextBatches = [
    ...(targetItem.fifoBatches ?? []),
    uncrossBatch,
  ].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const targetFirstActive = targetNextBatches.find(
    (b) => b.remainingQuantity > 0,
  );
  const targetNextCogs = targetFirstActive
    ? round2(targetFirstActive.unitCost)
    : unitCostTransferred;

  const nextInventory = state.inventory.map((item, i) => {
    if (i === sourceIdx) {
      return {
        ...item,
        stock: sourceNewStock,
        cogs: sourceNextCogs,
        fifoBatches: sourceConsumption.updatedBatches,
      };
    }
    if (i === targetIdx) {
      return {
        ...item,
        stock: targetNewStock,
        cogs: targetNextCogs,
        fifoBatches: targetNextBatches,
      };
    }
    return item;
  });

  const adjustmentRecord: InventoryAdjustmentRecord = {
    id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    skuId: sourceItem.id,
    modelLabel: sourceItem.model,
    version: sourceItem.version,
    size: sourceItem.size,
    previousStock: sourceItem.stock,
    newStock: sourceNewStock,
    delta: -quantity,
    auditMode: 'uncross',
    adjustmentType: 'descruce',
    targetSkuId: targetItem.id,
    targetModelLabel: targetItem.model,
    targetVersion: targetItem.version,
    targetSize: targetItem.size,
    reason: cleanReason,
    userName: currentUserName,
    createdAt: now,
  };

  let nextAuditSession = state.activeAuditSession;
  if (nextAuditSession && nextAuditSession.status === 'draft') {
    const counts = { ...nextAuditSession.counts };
    if (counts[sourceItem.id] !== null && counts[sourceItem.id] !== undefined) {
      counts[sourceItem.id] = Math.max(0, Math.floor(counts[sourceItem.id]!) - quantity);
    }
    if (counts[targetItem.id] !== null && counts[targetItem.id] !== undefined) {
      counts[targetItem.id] = Math.floor(counts[targetItem.id]!) + quantity;
    }
    nextAuditSession = {
      ...nextAuditSession,
      counts,
      updatedAt: now,
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      inventory: nextInventory,
      inventoryAdjustments: [
        adjustmentRecord,
        ...(state.inventoryAdjustments ?? []),
      ],
      activeAuditSession: nextAuditSession,
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'adjustment',
          description: `Descruce de mercancía: -${quantity} uds de ${sourceItem.model} (${sourceItem.size}) → +${quantity} uds a ${targetItem.model} (${targetItem.size}) · ${cleanReason}`,
          amount: 0,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

/**
 * Calcula el tablero resumen con los 6 indicadores exactos de la auditoría física
 * expresados tanto en CANTIDAD como en PORCENTAJE (%):
 * 1) Ítems conciliados (cant y %)
 * 2) Ítems no conciliados (cant y %)
 * 3) Ítems no contados (cant y %)
 * 4) Unidades conciliadas (cant y %)
 * 5) Unidades no conciliadas (cant y %)
 * 6) Unidades no contadas (cant y %)
 */
export function calculateAuditMetrics(
  inventory: InventoryItem[],
  counts: Record<string, number | null | undefined>,
): InventoryAuditSummaryMetrics {
  const totalItems = inventory.length;
  const totalSystemUnits = inventory.reduce((sum, item) => sum + item.stock, 0);

  let reconciledItems = 0;
  let unreconciledItems = 0;
  let uncountedItems = 0;

  let reconciledUnits = 0;
  let unreconciledUnits = 0;
  let uncountedUnits = 0;

  for (const item of inventory) {
    const rawCount = counts[item.id];
    if (rawCount === null || rawCount === undefined || !Number.isFinite(rawCount)) {
      uncountedItems += 1;
      uncountedUnits += item.stock;
    } else {
      const counted = Math.floor(rawCount);
      const diff = counted - item.stock;
      if (diff === 0) {
        reconciledItems += 1;
        reconciledUnits += item.stock;
      } else {
        unreconciledItems += 1;
        unreconciledUnits += item.stock;
      }
    }
  }

  const reconciledItemsPct = totalItems > 0 ? round2((reconciledItems / totalItems) * 100) : 0;
  const unreconciledItemsPct = totalItems > 0 ? round2((unreconciledItems / totalItems) * 100) : 0;
  const uncountedItemsPct = totalItems > 0 ? round2((uncountedItems / totalItems) * 100) : 0;

  const reconciledUnitsPct = totalSystemUnits > 0 ? round2((reconciledUnits / totalSystemUnits) * 100) : 0;
  const unreconciledUnitsPct = totalSystemUnits > 0 ? round2((unreconciledUnits / totalSystemUnits) * 100) : 0;
  const uncountedUnitsPct = totalSystemUnits > 0 ? round2((uncountedUnits / totalSystemUnits) * 100) : 0;

  return {
    totalItems,
    reconciledItems,
    reconciledItemsPct,
    unreconciledItems,
    unreconciledItemsPct,
    uncountedItems,
    uncountedItemsPct,
    totalSystemUnits,
    reconciledUnits,
    reconciledUnitsPct,
    unreconciledUnits,
    unreconciledUnitsPct,
    uncountedUnits,
    uncountedUnitsPct,
  };
}

/**
 * Detector inteligente de cruce de mercancía:
 * En un mismo modelo y versión, si el conteo físico detecta un sobrante en una talla
 * (ej. +1 en talla M) y un faltante en otra talla del mismo modelo (ej. -1 en talla L),
 * identifica el cruce para alertar y posibilitar el descruce en un clic.
 */
export function detectSizeDiscrepancyCrosses(
  inventory: InventoryItem[],
  counts: Record<string, number | null | undefined>,
): InventoryAuditCrossAlert[] {
  const groups = new Map<string, Array<{ item: InventoryItem; delta: number }>>();

  for (const item of inventory) {
    const rawCount = counts[item.id];
    if (rawCount === null || rawCount === undefined || !Number.isFinite(rawCount)) {
      continue;
    }
    const counted = Math.floor(rawCount);
    const delta = counted - item.stock;
    if (delta === 0) continue;

    const groupKey = `${item.model.toLowerCase().trim()}__${normalizeVersionDisplay(item.version)}`;
    const list = groups.get(groupKey) ?? [];
    list.push({ item, delta });
    groups.set(groupKey, list);
  }

  const alerts: InventoryAuditCrossAlert[] = [];

  for (const [, entries] of groups.entries()) {
    const surpluses = entries.filter((e) => e.delta > 0);
    const shortages = entries.filter((e) => e.delta < 0);

    for (const s of surpluses) {
      for (const sh of shortages) {
        const uncrossQty = Math.min(s.delta, Math.abs(sh.delta));
        if (uncrossQty > 0) {
          alerts.push({
            id: `cross-${s.item.id}-${sh.item.id}`,
            model: s.item.model,
            version: s.item.version,
            surplusSkuId: s.item.id,
            surplusSize: s.item.size,
            surplusDelta: s.delta,
            shortageSkuId: sh.item.id,
            shortageSize: sh.item.size,
            shortageDelta: sh.delta,
            uncrossQuantity: uncrossQty,
          });
        }
      }
    }
  }

  return alerts;
}

/**
 * Guarda el progreso actual del conteo físico sin cerrar la auditoría,
 * persistiendo el avance en Firebase/localStorage para que el usuario pueda
 * continuar después sin perder nada.
 */
export function saveAuditProgress(
  state: AppState,
  counts: Record<string, number | null>,
  notes?: string,
): ActionResult {
  const now = new Date().toISOString();
  const existing = state.activeAuditSession;

  const updatedSession: InventoryAuditSession = {
    id: existing?.id || `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'draft',
    startedAt: existing?.startedAt || now,
    updatedAt: now,
    notes: notes !== undefined ? notes : existing?.notes,
    counts: { ...(existing?.counts ?? {}), ...counts },
  };

  return {
    ok: true,
    state: {
      ...state,
      activeAuditSession: updatedSession,
    },
  };
}

/**
 * Cierra el recuento físico, bloquea la edición, calcula los 6 indicadores exactos
 * y opcionalmente aplica los ajustes físicos a inventario con cálculo FIFO.
 */
export function closeAuditSession(
  state: AppState,
  counts: Record<string, number | null>,
  applyAdjustmentsToInventory = true,
  reason = 'Cierre de auditoría física de inventario',
  actorName?: string,
): ActionResult {
  const now = new Date().toISOString();
  const metrics = calculateAuditMetrics(state.inventory, counts);
  const currentUserName = actorName?.trim() || 'Jesús César';

  let nextInventory = state.inventory;
  let newAdjustments = [...(state.inventoryAdjustments ?? [])];
  let newMovements = [...state.movements];

  if (applyAdjustmentsToInventory) {
    const adjustmentItems = state.inventory
      .filter((i) => counts[i.id] !== null && counts[i.id] !== undefined)
      .filter((i) => Math.floor(counts[i.id]!) !== i.stock)
      .map((i) => ({ skuId: i.id, newStock: Math.floor(counts[i.id]!) }));

    if (adjustmentItems.length > 0) {
      const adjRes = applyAuditAdjustments(state, {
        items: adjustmentItems,
        reason,
        auditMode: 'sku',
        actorName: currentUserName,
      });
      if (!adjRes.ok) {
        return { ok: false, error: adjRes.error, state };
      }
      nextInventory = adjRes.state.inventory;
      newAdjustments = adjRes.state.inventoryAdjustments ?? [];
      newMovements = adjRes.state.movements ?? [];
    }
  }

  const closedSession: InventoryAuditSession = {
    id: state.activeAuditSession?.id || `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'closed',
    startedAt: state.activeAuditSession?.startedAt || now,
    updatedAt: now,
    closedAt: now,
    notes: state.activeAuditSession?.notes,
    counts,
    summary: metrics,
    closedBy: currentUserName,
  };

  const nextAuditHistory = [
    closedSession,
    ...(state.auditHistory ?? []).filter((s) => s.id !== closedSession.id),
  ].slice(0, 30);

  return {
    ok: true,
    state: {
      ...state,
      inventory: nextInventory,
      inventoryAdjustments: newAdjustments,
      movements: newMovements,
      activeAuditSession: closedSession,
      auditHistory: nextAuditHistory,
    },
  };
}

/**
 * Inicia una nueva sesión de conteo físico borrando el recuento activo previo
 * y dejándolo listo en estado 'draft'.
 */
export function startNewAuditSession(state: AppState): ActionResult {
  const now = new Date().toISOString();
  const newSession: InventoryAuditSession = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'draft',
    startedAt: now,
    updatedAt: now,
    counts: {},
  };

  return {
    ok: true,
    state: {
      ...state,
      activeAuditSession: newSession,
    },
  };
}

export interface InventoryCascadeGroup {
  key: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  expectedStock: number;
  items: InventoryItem[];
}

export const ALL_JERSEY_SIZES: StandardJerseySize[] = [
  'S',
  'M',
  'L',
  'XL',
  'XXL',
];

export const EXTRA_JERSEY_SIZE_PRESETS: JerseySize[] = ['XS', '3XL', 'Niño'];

export function normalizeVersionDisplay(
  version: JerseyVersion,
): 'Fans' | 'Player' | 'Retro' {
  if (version === 'Player') return 'Player';
  if (version === 'Retro') return 'Retro';
  return 'Fans';
}

const KNOWN_PHRASE_TEAMS: Array<[string, string]> = [
  ['real madrid', 'Real Madrid'],
  ['manchester city', 'Manchester City'],
  ['manchester united', 'Manchester United'],
  ['atletico madrid', 'Atlético Madrid'],
  ['inter miami', 'Inter Miami'],
  ['inter milan', 'Inter Milán'],
  ['ac milan', 'AC Milan'],
  ['bayern munich', 'Bayern Munich'],
  ['borussia dortmund', 'Borussia Dortmund'],
  ['aston villa', 'Aston Villa'],
  ['real betis', 'Real Betis'],
  ['real sociedad', 'Real Sociedad'],
  ['paris saint germain', 'PSG'],
  ['paris saint-germain', 'PSG'],
  ['paris saint', 'PSG'],
  ['fc barcelona', 'Barcelona'],
  ['al nassr', 'Al Nassr'],
  ['al hilal', 'Al Hilal'],
  ['river plate', 'River Plate'],
  ['boca juniors', 'Boca Juniors'],
];

const KNOWN_KEYWORD_TEAMS: Array<[string, string]> = [
  ['barcelona', 'Barcelona'],
  ['barca', 'Barcelona'],
  ['fcb', 'Barcelona'],
  ['culer', 'Barcelona'],
  ['madrid', 'Real Madrid'],
  ['rma', 'Real Madrid'],
  ['merengue', 'Real Madrid'],
  ['psg', 'PSG'],
  ['paris', 'PSG'],
  ['mci', 'Manchester City'],
  ['citizens', 'Manchester City'],
  ['liverpool', 'Liverpool'],
  ['arsenal', 'Arsenal'],
  ['chelsea', 'Chelsea'],
  ['tottenham', 'Tottenham'],
  ['juventus', 'Juventus'],
  ['bayern', 'Bayern Munich'],
  ['dortmund', 'Borussia Dortmund'],
  ['leverkusen', 'Bayer Leverkusen'],
  ['napoli', 'Napoli'],
  ['milan', 'AC Milan'],
  ['benfica', 'Benfica'],
  ['porto', 'Porto'],
  ['ajax', 'Ajax'],
  ['flamengo', 'Flamengo'],
  ['palmeiras', 'Palmeiras'],
];

const SELECTION_KEYWORDS = [
  'seleccion',
  'argentina',
  'venezuela',
  'vinotinto',
  'brasil',
  'brazil',
  'espana',
  'spain',
  'colombia',
  'portugal',
  'francia',
  'france',
  'alemania',
  'germany',
  'inglaterra',
  'england',
  'italia',
  'italy',
  'uruguay',
  'ecuador',
  'mexico',
  'japon',
  'japan',
  'chile',
  'peru',
  'paraguay',
  'croacia',
  'croatia',
  'holanda',
  'paises bajos',
  'netherlands',
  'belgica',
  'belgium',
  'estados unidos',
  'usa',
  'corea',
  'marruecos',
  'morocco',
  'senegal',
  'nigeria',
];

const GENERIC_MODEL_NOISE_WORDS = new Set([
  'camiseta',
  'franela',
  'jersey',
  'camisa',
  'kit',
  'uniforme',
  'local',
  'visitante',
  'tercera',
  'cuarta',
  'retro',
  'player',
  'fan',
  'fans',
  'edicion',
  'especial',
  'version',
]);

function stripAccentsLower(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function containsKeywordWord(normalizedText: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[\\s\\-_/.,()]+)${escaped}(?:$|[\\s\\-_/.,()]+)`, 'i');
  return pattern.test(normalizedText);
}

function toTitleWord(word: string): string {
  if (!word) return '';
  if (word.toUpperCase() === 'PSG' || word.toUpperCase() === 'USA') {
    return word.toUpperCase();
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function detectExplicitKnownTeam(text: string): TeamCategory | null {
  const normalized = stripAccentsLower(text);
  if (!normalized) return null;

  for (const [phrase, canonical] of KNOWN_PHRASE_TEAMS) {
    if (containsKeywordWord(normalized, phrase)) {
      return canonical;
    }
  }

  for (const [kw, canonical] of KNOWN_KEYWORD_TEAMS) {
    if (containsKeywordWord(normalized, kw)) {
      return canonical;
    }
  }

  if (normalized === 'selecciones' || normalized === 'seleccion') {
    return 'Selecciones';
  }

  for (const selKw of SELECTION_KEYWORDS) {
    if (containsKeywordWord(normalized, selKw)) {
      return 'Selecciones';
    }
  }

  return null;
}

/**
 * Detecta y asigna automáticamente el equipo/categoría analizando palabras clave
 * en cualquier parte del nombre del modelo/franela (ej. "Real Madrid Local 26/27",
 * "PSG Retro 2002", "Japón Edición Especial", "Camiseta Barcelona Visitante").
 */
export function extractTeamFromModel(modelName: string): TeamCategory {
  const trimmed = modelName.trim();
  if (!trimmed) return 'Otro';

  const explicit = detectExplicitKnownTeam(trimmed);
  if (explicit) return explicit;

  const rawTokens = trimmed.split(/[\s\-_/.,()]+/).filter(Boolean);
  for (const rawTok of rawTokens) {
    const normTok = stripAccentsLower(rawTok);
    if (!normTok || /^\d+$/.test(normTok)) continue;
    if (!GENERIC_MODEL_NOISE_WORDS.has(normTok)) {
      return toTitleWord(rawTok);
    }
  }

  const firstRawToken = rawTokens[0] ?? '';
  if (!firstRawToken) return 'Otro';
  return toTitleWord(firstRawToken);
}

/**
 * Normaliza el equipo canónico de un ítem de inventario evitando que clubes distintos
 * (ej. Real Madrid vs Paris Saint-Germain / PSG) se mezclen por etiquetas erróneas o parciales.
 */
export function normalizeCanonicalTeam(
  rawTeam?: string,
  modelName = '',
): TeamCategory {
  const explicitFromModel = detectExplicitKnownTeam(modelName);
  if (explicitFromModel) {
    return explicitFromModel;
  }

  const raw = (rawTeam ?? '').trim();
  const normRaw = stripAccentsLower(raw);

  if (normRaw && normRaw !== 'otro') {
    const explicitFromRaw = detectExplicitKnownTeam(raw);
    if (explicitFromRaw) {
      return explicitFromRaw;
    }
    return raw;
  }

  return extractTeamFromModel(modelName);
}

const SALES_PLAYER_ALIASES: Array<{ team: string; aliases: string[] }> = [
  {
    team: 'Real Madrid',
    aliases: [
      'bellingham',
      'mbappe',
      'vinicius',
      'vini',
      'rodrygo',
      'valverde',
      'camavinga',
      'modric',
      'guler',
      'courtois',
      'carvajal',
      'merengue',
      'rma',
    ],
  },
  {
    team: 'Barcelona',
    aliases: [
      'lamine',
      'yamal',
      'pedri',
      'gavi',
      'lewandowski',
      'raphinha',
      'cubarsi',
      'olmo',
      'ter stegen',
      'barca',
      'fcb',
      'culer',
    ],
  },
  {
    team: 'PSG',
    aliases: [
      'dembele',
      'barcola',
      'hakimi',
      'vitinha',
      'neymar',
      'kvaratskhelia',
      'paris',
      'paris saint germain',
      'paris saint-germain',
    ],
  },
  {
    team: 'Manchester City',
    aliases: [
      'haaland',
      'foden',
      'de bruyne',
      'rodri',
      'grealish',
      'bernardo',
      'guardiola',
      'mci',
      'citizens',
    ],
  },
  {
    team: 'Selecciones',
    aliases: [
      'messi',
      'di maria',
      'lautaro',
      'albiceleste',
      'soteldo',
      'rondon',
      'vinotinto',
      'canarinha',
      'roja',
    ],
  },
];

export function doesItemMatchTeamFilter(
  item: Pick<InventoryItem, 'team' | 'model'>,
  selectedTeam: 'Todos' | TeamCategory,
): boolean {
  if (selectedTeam === 'Todos') return true;
  const canonicalItemTeam = normalizeCanonicalTeam(item.team, item.model);
  const canonicalTarget = normalizeCanonicalTeam(selectedTeam, selectedTeam);
  return stripAccentsLower(canonicalItemTeam) === stripAccentsLower(canonicalTarget);
}

export function doesSaleMatchSearchQuery(
  sale: SaleRecord,
  rawQuery: string,
): boolean {
  const q = stripAccentsLower(rawQuery);
  if (!q) return true;

  const invoiceNorm = stripAccentsLower(sale.invoiceNumber ?? '');
  const invoiceDigits = invoiceNorm.replace(/^(fac-|#)/, '');
  const queryCleanInvoice = q.replace(/^(fac-|#)/, '');

  if (
    invoiceNorm.includes(q) ||
    (queryCleanInvoice.length > 0 && invoiceDigits.includes(queryCleanInvoice))
  ) {
    return true;
  }

  const customerFields = [
    sale.customerName,
    sale.debtorName,
    sale.customerCity,
    sale.customerPhone,
    sale.seller,
    sale.saleDate,
    sale.createdAt.slice(0, 10),
    formatUSD(sale.finalPrice),
    sale.finalPrice.toFixed(2),
    String(sale.finalPrice),
  ]
    .filter(Boolean)
    .map((v) => stripAccentsLower(String(v)));

  if (customerFields.some((f) => f.includes(q))) {
    return true;
  }

  const lines =
    sale.items && sale.items.length > 0
      ? sale.items
      : [
          {
            modelLabel: sale.modelLabel,
            team: sale.team,
            version: sale.version,
            size: sale.size,
            unitPrice: round2(sale.finalPrice / Math.max(1, sale.quantity)),
            subtotal: sale.finalPrice,
          },
        ];

  for (const line of lines) {
    const canonicalTeam = normalizeCanonicalTeam(line.team, line.modelLabel);
    const lineText = stripAccentsLower(
      `${line.modelLabel} ${canonicalTeam} ${line.version} ${line.size} ${line.unitPrice.toFixed(2)} ${line.subtotal.toFixed(2)}`,
    );
    if (lineText.includes(q)) return true;

    const teamMatch = SALES_PLAYER_ALIASES.find(
      (entry) =>
        stripAccentsLower(entry.team) === stripAccentsLower(canonicalTeam) &&
        entry.aliases.some((alias) => alias.includes(q) || q.includes(alias)),
    );
    if (teamMatch) return true;
  }

  return false;
}

export interface TransitAlertStatus {
  daysInTransit: number;
  thresholdDays: number;
  isDelayed: boolean;
}

export function getTransitAlertStatus(
  batch: PurchaseBatchRecord,
  referenceDate?: string,
  thresholds?: Pick<
    AlertThresholdsConfig,
    'maritimeTransitMaxDays' | 'airTransitMaxDays'
  >,
): TransitAlertStatus {
  const thresholdDays =
    batch.shippingType === 'Marítimo'
      ? (thresholds?.maritimeTransitMaxDays ?? 80)
      : (thresholds?.airTransitMaxDays ?? 15);
  if (batch.status !== 'EN TRÁNSITO') {
    return { daysInTransit: 0, thresholdDays, isDelayed: false };
  }

  const refStr = (referenceDate ?? new Date().toISOString().slice(0, 10)).slice(
    0,
    10,
  );
  const startStr = (batch.entryDate || refStr).slice(0, 10);
  const startMs = Date.parse(`${startStr}T00:00:00Z`);
  const endMs = Date.parse(`${refStr}T00:00:00Z`);
  const diffDays =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24)))
      : 0;

  return {
    daysInTransit: diffDays,
    thresholdDays,
    isDelayed: diffDays > thresholdDays,
  };
}

export const SIZE_ORDER: Record<string, number> = {
  XS: -1,
  S: 0,
  M: 1,
  L: 2,
  XL: 3,
  XXL: 4,
  '3XL': 5,
  XXXL: 5,
  NIÑO: 6,
  NINO: 6,
};

export function compareJerseySizes(a: string, b: string): number {
  const ra = SIZE_ORDER[a.trim().toUpperCase()] ?? 100;
  const rb = SIZE_ORDER[b.trim().toUpperCase()] ?? 100;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}

export interface InventorySizeMatrixRow {
  key: string;
  team: TeamCategory;
  model: string;
  version: 'Fans' | 'Player' | 'Retro';
  sizes: Record<StandardJerseySize, number>;
  trackedSizes: Record<StandardJerseySize, boolean>;
  extraSizes: Array<{ size: JerseySize; stock: number; isLowStock: boolean }>;
  totalStock: number;
  salePrice: number;
  avgCogs: number;
  totalFifoValue: number;
  isLowStock: boolean;
  lowSizes: JerseySize[];
  items: InventoryItem[];
}

export function getInventorySizeMatrix(
  inventory: InventoryItem[],
  lowStockThreshold = 5,
): InventorySizeMatrixRow[] {
  const map = new Map<
    string,
    InventorySizeMatrixRow & { extraMap: Map<string, number> }
  >();

  for (const item of inventory) {
    const cleanModel = item.model.trim();
    const displayVer = normalizeVersionDisplay(item.version);
    const key = `${cleanModel.toLowerCase()}__${displayVer}`;
    const itemFifoValue =
      item.fifoBatches && item.fifoBatches.length > 0
        ? item.fifoBatches.reduce(
            (sum, b) => sum + b.remainingQuantity * b.unitCost,
            0,
          )
        : item.stock * item.cogs;

    let row = map.get(key);
    if (!row) {
      row = {
        key,
        team: item.team,
        model: cleanModel,
        version: displayVer,
        sizes: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 },
        trackedSizes: { S: false, M: false, L: false, XL: false, XXL: false },
        extraSizes: [],
        extraMap: new Map(),
        totalStock: 0,
        salePrice: item.salePrice,
        avgCogs: item.cogs,
        totalFifoValue: 0,
        isLowStock: false,
        lowSizes: [],
        items: [],
      };
      map.set(key, row);
    }

    if (ALL_JERSEY_SIZES.includes(item.size as StandardJerseySize)) {
      const stdSz = item.size as StandardJerseySize;
      row.sizes[stdSz] = (row.sizes[stdSz] ?? 0) + item.stock;
      row.trackedSizes[stdSz] = true;
    } else {
      const extraSz = item.size.trim();
      row.extraMap.set(extraSz, (row.extraMap.get(extraSz) ?? 0) + item.stock);
    }

    row.totalStock += item.stock;
    row.totalFifoValue = round2(row.totalFifoValue + itemFifoValue);
    row.salePrice = item.salePrice > 0 ? item.salePrice : row.salePrice;
    row.items.push(item);
  }

  const rows = Array.from(map.values()).map(({ extraMap, ...row }) => {
    row.items.sort((a, b) => compareJerseySizes(a.size, b.size));
    const extraSizes = Array.from(extraMap.entries())
      .sort(([sa], [sb]) => compareJerseySizes(sa, sb))
      .map(([sz, stock]) => ({
        size: sz as JerseySize,
        stock,
        isLowStock: stock <= lowStockThreshold,
      }));
    const lowStandardSizes = ALL_JERSEY_SIZES.filter(
      (s) => row.trackedSizes[s] && row.sizes[s] <= lowStockThreshold,
    );
    const lowExtraSizes = extraSizes
      .filter((e) => e.isLowStock)
      .map((e) => e.size);
    const lowSizes: JerseySize[] = [...lowStandardSizes, ...lowExtraSizes];
    const avgCogs =
      row.totalStock > 0
        ? round2(row.totalFifoValue / row.totalStock)
        : round2(row.items[0]?.cogs ?? 0);

    return {
      ...row,
      extraSizes,
      avgCogs,
      lowSizes,
      isLowStock: row.totalStock <= lowStockThreshold,
    };
  });

  rows.sort(
    (a, b) =>
      a.team.localeCompare(b.team) ||
      a.model.localeCompare(b.model) ||
      a.version.localeCompare(b.version),
  );

  return rows;
}

export interface OperationalAlert {
  id: string;
  kind: 'low_stock' | 'transit_delay' | 'overdue_receivable';
  severity: 'critical' | 'warning';
  title: string;
  description: string;
  targetTab: 'inventario' | 'compras' | 'finanzas';
  targetSubModule?: SubModuleId;
}

export function getActiveOperationalAlerts(
  state: AppState,
  referenceDate?: string,
  thresholds?: AlertThresholdsConfig,
): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  const refDateStr = (referenceDate ?? new Date().toISOString().slice(0, 10)).slice(
    0,
    10,
  );
  const refMs = Date.parse(`${refDateStr}T00:00:00Z`);
  const overdueDaysLimit = thresholds?.receivableOverdueDays ?? 30;

  // 1. Pedidos en tránsito retrasados (Marítimo > 80d / Aéreo > 15d o configurado)
  for (const batch of state.purchaseBatches ?? []) {
    if (batch.status !== 'EN TRÁNSITO') continue;
    const status = getTransitAlertStatus(batch, referenceDate, thresholds);
    if (status.isDelayed) {
      alerts.push({
        id: `alert-transit-${batch.id}`,
        kind: 'transit_delay',
        severity: 'critical',
        title: `Envío en retraso: ${batch.referenceName}`,
        description: `${batch.shippingType} · ${status.daysInTransit} días en tránsito (límite ${status.thresholdDays} días · ${batch.totalUnits} uds)`,
        targetTab: 'compras',
        targetSubModule: 'compras-transito',
      });
    }
  }

  // 2. Cuentas por Cobrar vencidas (> 30 días o umbral configurado)
  for (const rec of state.receivables ?? []) {
    if (rec.amount <= 0) continue;
    const createdStr = (rec.createdAt || refDateStr).slice(0, 10);
    const createdMs = Date.parse(`${createdStr}T00:00:00Z`);
    const ageDays =
      Number.isFinite(createdMs) && Number.isFinite(refMs)
        ? Math.max(0, Math.floor((refMs - createdMs) / (1000 * 60 * 60 * 24)))
        : 0;
    if (ageDays > overdueDaysLimit) {
      alerts.push({
        id: `alert-cxc-${rec.id}`,
        kind: 'overdue_receivable',
        severity: 'critical',
        title: `CxC vencida: ${rec.debtor}`,
        description: `${formatUSD(rec.amount)} pendiente · ${ageDays} días vencida (límite ${overdueDaysLimit}d)`,
        targetTab: 'finanzas',
        targetSubModule: 'ventas-cxc',
      });
    }
  }

  // 3. Stock bajo (umbral configurado <= lowStockThreshold o legado < 5)
  const matrix = getInventorySizeMatrix(
    state.inventory,
    thresholds ? thresholds.lowStockThreshold + 1 : 5,
  );
  for (const row of matrix) {
    const hasCriticalSku = thresholds
      ? row.items.some((item) => item.stock <= thresholds.lowStockThreshold)
      : false;
    if (row.isLowStock || hasCriticalSku) {
      const limitLabel = thresholds
        ? `<= ${thresholds.lowStockThreshold}`
        : '< 5';
      const criticalSizesText =
        thresholds && row.lowSizes.length > 0 && !row.isLowStock
          ? ` (Tallas críticas: ${row.lowSizes.join(', ')})`
          : '';
      alerts.push({
        id: `alert-stock-${row.key}`,
        kind: 'low_stock',
        severity: 'critical',
        title: `Stock bajo: ${row.model} (${row.version})`,
        description:
          row.totalStock === 0
            ? 'Agotado (0 unidades totales en bodega)'
            : `${row.totalStock} ${row.totalStock === 1 ? 'unidad' : 'unidades'} totales (${limitLabel})${criticalSizesText}`,
        targetTab: 'inventario',
        targetSubModule: 'inventario-stock',
      });
    }
  }

  return alerts;
}

export function getInventoryCascadeGroups(
  inventory: InventoryItem[],
): InventoryCascadeGroup[] {
  const groupMap = new Map<string, InventoryCascadeGroup>();

  for (const item of inventory) {
    const cleanModel = item.model.trim();
    const canonicalVer = normalizeVersionDisplay(item.version);
    const key = `${cleanModel.toLowerCase()}__${canonicalVer}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.expectedStock += item.stock;
      existing.items.push(item);
    } else {
      groupMap.set(key, {
        key,
        team: item.team,
        model: cleanModel,
        version: canonicalVer,
        expectedStock: item.stock,
        items: [item],
      });
    }
  }

  const groups = Array.from(groupMap.values());
  for (const group of groups) {
    group.items.sort((a, b) => compareJerseySizes(a.size, b.size));
  }
  groups.sort(
    (a, b) =>
      a.team.localeCompare(b.team) ||
      a.model.localeCompare(b.model) ||
      a.version.localeCompare(b.version),
  );
  return groups;
}

export interface AuditAdjustmentItemInput {
  skuId: string;
  newStock: number;
}

export interface ApplyAuditAdjustmentsInput {
  items: AuditAdjustmentItemInput[];
  reason?: string;
  auditMode?: 'cascade' | 'sku';
  actorName?: string;
}

export function applyAuditAdjustments(
  state: AppState,
  input: ApplyAuditAdjustmentsInput,
): ActionResult {
  if (!input.items || input.items.length === 0) {
    return {
      ok: false,
      error: 'No hay ajustes pendientes por aplicar.',
      state,
    };
  }

  const reason = input.reason?.trim() || 'Conteo físico de auditoría';
  const auditMode = input.auditMode ?? 'sku';
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const workingInventory = state.inventory.map((item) => ({
    ...item,
    fifoBatches: (item.fifoBatches ?? []).map((b) => ({ ...b })),
  }));

  const newAdjustmentRecords: InventoryAdjustmentRecord[] = [];
  let totalShortageUnits = 0;
  let totalSurplusUnits = 0;
  let totalFifoLossCost = 0;

  for (const entry of input.items) {
    const idx = workingInventory.findIndex((i) => i.id === entry.skuId);
    if (idx < 0) {
      return {
        ok: false,
        error: 'Uno de los SKUs auditados ya no existe en el inventario.',
        state,
      };
    }

    const newStock = Math.floor(entry.newStock);
    if (!Number.isFinite(newStock) || newStock < 0) {
      return {
        ok: false,
        error: 'El conteo físico debe ser un número entero mayor o igual a 0.',
        state,
      };
    }

    const target = workingInventory[idx];
    const previousStock = target.stock;
    const delta = newStock - previousStock;
    if (delta === 0) continue;

    let nextBatches: FifoBatch[];
    let nextCogs = target.cogs;
    let fifoLossCost: number | undefined;

    if (delta < 0) {
      const res = previewFifoConsumption(target, Math.abs(delta));
      nextBatches = res.updatedBatches;
      fifoLossCost = res.totalCost;
      totalShortageUnits += Math.abs(delta);
      totalFifoLossCost = round2(totalFifoLossCost + res.totalCost);
      const firstActive = nextBatches.find((b) => b.remainingQuantity > 0);
      nextCogs = firstActive ? round2(firstActive.unitCost) : target.cogs;
    } else {
      const unitCost = getNextFifoUnitCost(target);
      const adjustmentBatch: FifoBatch = {
        batchId: `fifo-audit-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        batchName: `Sobrante Auditoría (${reason})`,
        entryDate: today,
        initialQuantity: delta,
        remainingQuantity: delta,
        unitCost,
      };
      nextBatches = [...(target.fifoBatches ?? []), adjustmentBatch].sort((a, b) =>
        a.entryDate.localeCompare(b.entryDate),
      );
      totalSurplusUnits += delta;
      const firstActive = nextBatches.find((b) => b.remainingQuantity > 0);
      nextCogs = firstActive ? round2(firstActive.unitCost) : unitCost;
    }

    workingInventory[idx] = {
      ...target,
      stock: newStock,
      cogs: nextCogs,
      fifoBatches: nextBatches,
    };

    newAdjustmentRecords.unshift({
      id: `adj-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      skuId: target.id,
      modelLabel: target.model,
      version: target.version,
      size: target.size,
      previousStock,
      newStock,
      delta,
      fifoLossCost,
      auditMode,
      reason,
      ...(input.actorName?.trim() ? { userName: input.actorName.trim() } : {}),
      createdAt: now,
    });
  }

  if (newAdjustmentRecords.length === 0) {
    return {
      ok: false,
      error: 'Todos los conteos ingresados coinciden con el stock actual en sistema.',
      state,
    };
  }

  const summaryParts: string[] = [];
  if (totalShortageUnits > 0) {
    summaryParts.push(
      `Merma -${totalShortageUnits} uds (Costo FIFO ${formatUSD(totalFifoLossCost)})`,
    );
  }
  if (totalSurplusUnits > 0) {
    summaryParts.push(`Sobrante +${totalSurplusUnits} uds`);
  }

  return {
    ok: true,
    state: {
      ...state,
      inventory: workingInventory,
      inventoryAdjustments: [
        ...newAdjustmentRecords,
        ...(state.inventoryAdjustments ?? []),
      ],
      movements: [
        {
          id: `mov-${Date.now()}`,
          type: 'adjustment',
          description: `Auditoría (${newAdjustmentRecords.length} SKUs · ${reason}): ${summaryParts.join(' · ')}`,
          amount: totalFifoLossCost > 0 ? -totalFifoLossCost : 0,
          createdAt: now,
        },
        ...state.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ],
    },
  };
}

function migrateInventoryWithFifo(items: InventoryItem[]): InventoryItem[] {
  return items.map((item) => {
    const salePrice =
      typeof item.salePrice === 'number' && item.salePrice > 0
        ? round2(item.salePrice)
        : getDefaultSalePrice(item.version, item.model);

    if (Array.isArray(item.fifoBatches) && item.fifoBatches.length > 0) {
      return { ...item, salePrice };
    }
    return {
      ...item,
      salePrice,
      fifoBatches: [
        {
          batchId: `fifo-init-${item.id}`,
          batchName: 'Inventario Inicial',
          entryDate: '2026-11-01',
          initialQuantity: item.stock,
          remainingQuantity: item.stock,
          unitCost: item.cogs,
        },
      ],
    };
  });
}

export function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    return Object.values(value) as T[];
  }
  return [];
}

function sanitizeFirebaseObjectKey(key: string): string {
  return key.replace(/[.#$/[\]]/g, '_');
}

function normalizeCatalogRecordMap(rawMap: unknown): Record<string, string> {
  if (!rawMap || typeof rawMap !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawMap as Record<string, unknown>)) {
    if (typeof val !== 'string') continue;
    const safeKey = sanitizeFirebaseObjectKey(key);
    if (!safeKey) continue;
    if (key !== safeKey && safeKey in out) continue;
    out[safeKey] = val;
  }
  return out;
}

export function sanitizeForFirebase<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'number') {
    return (Number.isFinite(value) ? value : 0) as T;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirebase(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) {
        const safeKey = sanitizeFirebaseObjectKey(key);
        if (!safeKey) continue;
        if (key !== safeKey && safeKey in out) continue;
        out[safeKey] = sanitizeForFirebase(val);
      }
    }
    return out as T;
  }
  return value;
}

export function normalizeAppState(raw: unknown): AppState {
  try {
    if (!raw || typeof raw !== 'object') {
      return createInitialState();
    }

    const parsed = raw as Partial<AppState>;
    if (
      typeof parsed.cashOnHand !== 'number' ||
      !parsed.funds ||
      !parsed.exchangeRates
    ) {
      return createInitialState();
    }

    const base = createInitialState();
    const rawInventory = toArray<InventoryItem>(parsed.inventory).map((item) => ({
      ...item,
      fifoBatches: toArray<FifoBatch>(item.fifoBatches),
    }));

    const parsedFunds = parsed.funds;
    const normalizedFunds = {
      replacement: Number.isFinite(parsedFunds.replacement)
        ? round2(parsedFunds.replacement)
        : base.funds.replacement,
      commissions: Number.isFinite(parsedFunds.commissions)
        ? round2(parsedFunds.commissions)
        : base.funds.commissions,
      commissionsBySeller: {
        ...base.funds.commissionsBySeller,
        ...(parsedFunds.commissionsBySeller ?? {}),
      },
      operatingAndAds: Number.isFinite(parsedFunds.operatingAndAds)
        ? round2(parsedFunds.operatingAndAds)
        : base.funds.operatingAndAds,
      growthReinvestment: Number.isFinite(parsedFunds.growthReinvestment)
        ? round2(parsedFunds.growthReinvestment)
        : base.funds.growthReinvestment,
      dividendsByPartner: {
        ...base.funds.dividendsByPartner,
        ...(parsedFunds.dividendsByPartner ?? {}),
      },
      reinvestedFromDividendsTotal: Number.isFinite(
        parsedFunds.reinvestedFromDividendsTotal,
      )
        ? round2(parsedFunds.reinvestedFromDividendsTotal)
        : base.funds.reinvestedFromDividendsTotal,
    };

    return {
      cashOnHand: round2(parsed.cashOnHand),
      collectedReceivablesCount: Number.isFinite(
        Number(parsed.collectedReceivablesCount),
      )
        ? Number(parsed.collectedReceivablesCount)
        : 0,
      exchangeRates: {
        ...base.exchangeRates,
        ...parsed.exchangeRates,
        source: parsed.exchangeRates.source ?? 'manual',
      },
      inventory: migrateInventoryWithFifo(rawInventory),
      receivables: toArray<ReceivableItem>(parsed.receivables).map((r) => ({
        ...r,
        installments: r.installments
          ? toArray<ReceivableInstallment>(r.installments)
          : undefined,
      })),
      sales: (() => {
        const rawSales = toArray<SaleRecord>(parsed.sales);
        const totalSales = rawSales.length;
        return rawSales.map((s, idx) => ({
          ...s,
          invoiceNumber:
            s.invoiceNumber || formatInvoiceNumber(Math.max(1, totalSales - idx)),
          customerName: s.customerName || s.debtorName || 'Cliente Mostrador',
          paymentMethod: s.paymentMethod ?? 'Efectivo ($)',
          items: s.items
            ? toArray<SaleLineItem>(s.items).map((line) => ({
                ...line,
                fifoConsumed: line.fifoConsumed
                  ? toArray<FifoConsumptionDetail>(line.fifoConsumed)
                  : undefined,
              }))
            : undefined,
          paymentSplits: s.paymentSplits
            ? toArray<PaymentSplit>(s.paymentSplits)
            : undefined,
        }));
      })(),
      nextInvoiceSeq: (() => {
        const rawSales = toArray<SaleRecord>(parsed.sales);
        const parsedSeq = Number(parsed.nextInvoiceSeq ?? 0);
        return Math.max(
          rawSales.length + 1,
          Number.isFinite(parsedSeq) && parsedSeq >= 1 ? Math.floor(parsedSeq) : 1,
        );
      })(),
      returns: toArray<ReturnExchangeRecord>(parsed.returns),
      purchases: toArray<PurchaseRecord>(parsed.purchases),
      purchaseBatches: toArray<PurchaseBatchRecord>(parsed.purchaseBatches).map(
        (b) => {
          const status = b.status ?? 'RECIBIDO EN BODEGA';
          const computedDays =
            typeof b.diasTranscurridos === 'number' &&
            Number.isFinite(b.diasTranscurridos)
              ? Math.max(0, Math.floor(b.diasTranscurridos))
              : status === 'RECIBIDO EN BODEGA' && b.receivedDate
                ? b.isDirectReception
                  ? 0
                  : calculateElapsedTransitDays(b.entryDate, b.receivedDate)
                : undefined;
          return {
            ...b,
            status,
            fundingSource: b.fundingSource ?? 'cashOnHand',
            orderedTotalUnits: b.orderedTotalUnits ?? b.totalUnits,
            estimatedFreightCost: b.estimatedFreightCost ?? b.totalFreightCost,
            ...(computedDays !== undefined
              ? { diasTranscurridos: computedDays }
              : {}),
            items: toArray<PurchaseBatchItemRecord>(b.items).map((item) => ({
              ...item,
              orderedQuantity: item.orderedQuantity ?? item.quantity,
            })),
          };
        },
      ),
      operatingExpenses: toArray<OperatingExpenseRecord>(
        parsed.operatingExpenses,
      ).map((exp) => ({
        ...exp,
        ...(exp.category
          ? { category: normalizeExpenseCategory(exp.category) ?? exp.category }
          : {}),
      })),
      capitalInjections: toArray<CapitalInjectionRecord>(
        parsed.capitalInjections,
      ),
      inventoryAdjustments: toArray<InventoryAdjustmentRecord>(
        parsed.inventoryAdjustments,
      ),
      activeAuditSession:
        parsed.activeAuditSession && typeof parsed.activeAuditSession === 'object'
          ? (parsed.activeAuditSession as InventoryAuditSession)
          : null,
      auditHistory: parsed.auditHistory
        ? toArray<InventoryAuditSession>(parsed.auditHistory)
        : [],
      ...(parsed.customers
        ? { customers: toArray<CustomerProfile>(parsed.customers) }
        : {}),
      ...(parsed.seenAlertIds
        ? { seenAlertIds: toArray<string>(parsed.seenAlertIds) }
        : {}),
      catalogEnabled:
        typeof parsed.catalogEnabled === 'boolean'
          ? parsed.catalogEnabled
          : true,
      ...(parsed.catalogPhotos && typeof parsed.catalogPhotos === 'object'
        ? { catalogPhotos: normalizeCatalogRecordMap(parsed.catalogPhotos) }
        : {}),
      ...(parsed.catalogKeywords && typeof parsed.catalogKeywords === 'object'
        ? { catalogKeywords: normalizeCatalogRecordMap(parsed.catalogKeywords) }
        : {}),
      authorizedUsers: getMergedAuthorizedUsers(
        parsed.authorizedUsers ? toArray<AuthorizedUserRecord>(parsed.authorizedUsers) : undefined,
      ),
      historicalNetProfit:
        typeof parsed.historicalNetProfit === 'number' &&
        Number.isFinite(parsed.historicalNetProfit)
          ? round2(parsed.historicalNetProfit)
          : INITIAL_HISTORICAL_NET_PROFIT,
      userPurgedEmpty: Boolean(parsed.userPurgedEmpty),
      isExplicitDemo: Boolean(parsed.isExplicitDemo),
      funds: normalizedFunds,
      movements: toArray<AuditMovement>(parsed.movements).slice(
        0,
        MAX_RECENT_MOVEMENTS,
      ),
      ...(parsed.bulkImports
        ? { bulkImports: toArray<BulkImportRecord>(parsed.bulkImports) }
        : {}),
    };
  } catch {
    return createInitialState();
  }
}

function normalizeLegacySizeToken(rawSize: unknown): JerseySize {
  const clean = String(rawSize ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (clean === 'XXL' || clean === '2XL' || clean === 'XXLARGE') return 'XXL';
  if (clean === 'XL' || clean === 'XLARGE') return 'XL';
  if (clean === 'L' || clean === 'LARGE') return 'L';
  if (clean === 'S' || clean === 'SMALL') return 'S';
  return 'M';
}

function normalizeLegacyVersionToken(
  rawVersion: unknown,
  modelName = '',
): 'Fans' | 'Player' | 'Retro' {
  const combined = `${String(rawVersion ?? '')} ${modelName}`.toLowerCase();
  if (String(rawVersion ?? '').toLowerCase().includes('retro')) return 'Retro';
  if (
    String(rawVersion ?? '').toLowerCase().includes('player') ||
    String(rawVersion ?? '').toLowerCase().includes('jugador')
  ) {
    return 'Player';
  }
  if (
    !String(rawVersion ?? '').trim() &&
    combined.includes('retro')
  ) {
    return 'Retro';
  }
  return 'Fans';
}

/**
 * Convierte cualquier arreglo de inventario previo (plano, con claves en español,
 * versión "Fan" o estructura agrupada por matriz de tallas S/M/L/XL/XXL) al esquema
 * actual de InventoryItem sin perder ningún ítem ni lote FIFO.
 */
export function migrateLegacyInventoryItems(
  rawItems: unknown[],
): InventoryItem[] {
  const merged = new Map<string, InventoryItem>();

  const pushNormalizedSku = (candidate: InventoryItem) => {
    const key = `${candidate.model.toLowerCase()}__${candidate.version}__${candidate.size}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
      return;
    }

    const combinedStock = Math.max(0, existing.stock + candidate.stock);
    const combinedBatches = [...existing.fifoBatches, ...candidate.fifoBatches];
    const firstActive = combinedBatches.find((b) => b.remainingQuantity > 0);
    merged.set(key, {
      ...existing,
      stock: combinedStock,
      cogs: firstActive ? round2(firstActive.unitCost) : existing.cogs,
      salePrice:
        candidate.salePrice > 0 ? candidate.salePrice : existing.salePrice,
      fifoBatches: combinedBatches,
    });
  };

  rawItems.forEach((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object') return;
    const obj = rawEntry as Record<string, unknown>;

    const modelName = String(
      obj.model ?? obj.modelo ?? obj.name ?? obj.nombre ?? '',
    ).trim();
    if (!modelName) return;

    const rawTeam = String(
      obj.team ?? obj.equipo ?? obj.category ?? obj.categoria ?? '',
    ).trim();
    const resolvedTeam =
      rawTeam && rawTeam.toLowerCase() !== 'otro'
        ? rawTeam
        : extractTeamFromModel(modelName);

    const normalizedVersion = normalizeLegacyVersionToken(
      obj.version ?? obj.versión ?? obj.tipo,
      modelName,
    );

    const parsedCost = Number(
      obj.cogs ?? obj.cost ?? obj.costo ?? obj.unitCost ?? obj.costoUnitario ?? 6.0,
    );
    const unitCost =
      Number.isFinite(parsedCost) && parsedCost > 0 ? round2(parsedCost) : 6.0;

    const parsedSalePrice = Number(
      obj.salePrice ?? obj.precio ?? obj.precioVenta ?? obj.pvp ?? 0,
    );
    const salePrice =
      Number.isFinite(parsedSalePrice) && parsedSalePrice > 0
        ? round2(parsedSalePrice)
        : getDefaultSalePrice(normalizedVersion, modelName);

    const matrixObj =
      (obj.sizes && typeof obj.sizes === 'object'
        ? (obj.sizes as Record<string, unknown>)
        : null) ??
      (obj.tallas && typeof obj.tallas === 'object'
        ? (obj.tallas as Record<string, unknown>)
        : null);

    if (matrixObj) {
      let addedFromMatrix = false;
      for (const [rawSizeKey, rawQty] of Object.entries(matrixObj)) {
        const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
        if (qty <= 0) continue;
        addedFromMatrix = true;
        const size = normalizeLegacySizeToken(rawSizeKey);
        const skuId =
          typeof obj.id === 'string' && obj.id.trim()
            ? `${obj.id.trim()}-${size}`
            : `sku-mig-${index}-${size}-${Date.now()}`;
        pushNormalizedSku({
          id: skuId,
          team: resolvedTeam,
          model: modelName,
          version: normalizedVersion,
          size,
          stock: qty,
          cogs: unitCost,
          salePrice,
          fifoBatches: [
            {
              batchId: `fifo-mig-${skuId}`,
              batchName: 'Migración Inventario',
              entryDate: '2026-11-01',
              initialQuantity: qty,
              remainingQuantity: qty,
              unitCost,
            },
          ],
        });
      }
      if (addedFromMatrix) return;
    }

    const size = normalizeLegacySizeToken(obj.size ?? obj.talla);
    const rawQty = Number(
      obj.stock ?? obj.quantity ?? obj.cantidad ?? obj.qty ?? obj.existencia ?? 0,
    );
    const stock = Number.isFinite(rawQty) ? Math.max(0, Math.floor(rawQty)) : 0;

    const rawBatches = toArray<FifoBatch>(obj.fifoBatches ?? obj.lotes).map(
      (b, bIdx) => ({
        batchId: String(b.batchId || `fifo-mig-${index}-${bIdx}`),
        batchName: String(b.batchName || 'Inventario Migrado'),
        entryDate: String(b.entryDate || '2026-11-01'),
        initialQuantity: Math.max(0, Math.floor(Number(b.initialQuantity) || stock)),
        remainingQuantity: Math.max(
          0,
          Math.floor(Number(b.remainingQuantity) || 0),
        ),
        unitCost:
          Number.isFinite(Number(b.unitCost)) && Number(b.unitCost) > 0
            ? round4(Number(b.unitCost))
            : unitCost,
        usdtRate:
          typeof b.usdtRate === 'number' && Number.isFinite(b.usdtRate)
            ? b.usdtRate
            : undefined,
      }),
    );

    const skuId =
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.trim()
        : `sku-mig-${index}-${size}`;

    const fifoBatches: FifoBatch[] =
      rawBatches.length > 0
        ? rawBatches
        : [
            {
              batchId: `fifo-mig-${skuId}`,
              batchName: 'Inventario Migrado',
              entryDate: '2026-11-01',
              initialQuantity: stock,
              remainingQuantity: stock,
              unitCost,
            },
          ];

    const firstActive = fifoBatches.find((b) => b.remainingQuantity > 0);
    const effectiveCogs = firstActive ? round2(firstActive.unitCost) : unitCost;

    pushNormalizedSku({
      id: skuId,
      team: resolvedTeam,
      model: modelName,
      version: normalizedVersion,
      size,
      stock,
      cogs: effectiveCogs,
      salePrice,
      fifoBatches,
    });
  });

  return Array.from(merged.values());
}

/**
 * Convierte cualquier objeto o JSON heredado de localStorage (formato anterior
 * o claves en español) al formato actual AppState preservando todos los datos.
 */
export function migrateLegacyStateToCurrent(raw: unknown): AppState | null {
  try {
    let parsedRaw: unknown = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        return null;
      }
      parsedRaw = JSON.parse(trimmed);
    }

    if (!parsedRaw || typeof parsedRaw !== 'object') {
      return null;
    }

    const base = createInitialState();

    // Caso 1: arreglo directo de ítems de inventario legado
    if (Array.isArray(parsedRaw)) {
      const migratedItems = migrateLegacyInventoryItems(parsedRaw);
      if (migratedItems.length === 0) return null;
      return {
        ...base,
        inventory: migratedItems,
      };
    }

    const obj = parsedRaw as Record<string, unknown>;
    const rawInventorySource =
      obj.inventory ?? obj.inventario ?? obj.items ?? obj.stockItems;
    const hasInventoryKey = rawInventorySource !== undefined;
    const migratedInventory = hasInventoryKey
      ? migrateLegacyInventoryItems(toArray<unknown>(rawInventorySource))
      : [];

    const rawCash =
      obj.cashOnHand ?? obj.cash ?? obj.efectivo ?? obj.caja ?? obj.saldoCaja;
    const hasCash =
      typeof rawCash === 'number' && Number.isFinite(rawCash);

    const rawReceivables =
      obj.receivables ?? obj.cuentasPorCobrar ?? obj.cxc;
    const hasReceivables = rawReceivables !== undefined;

    const rawSales = obj.sales ?? obj.ventas;
    const rawPurchases = obj.purchases ?? obj.compras;
    const rawBatches = obj.purchaseBatches ?? obj.lotes;

    if (
      migratedInventory.length === 0 &&
      !hasCash &&
      !hasReceivables &&
      !rawSales &&
      !rawPurchases &&
      !rawBatches
    ) {
      return null;
    }

    const normalizedBase =
      typeof obj.cashOnHand === 'number' && obj.funds && obj.exchangeRates
        ? normalizeAppState(obj)
        : base;

    const receivables = hasReceivables
      ? toArray<ReceivableItem>(rawReceivables).map((r) => ({
          ...r,
          installments: r.installments
            ? toArray<ReceivableInstallment>(r.installments)
            : undefined,
        }))
      : INITIAL_RECEIVABLES.map((r) => ({ ...r }));

    const capitalInjections =
      obj.capitalInjections !== undefined
        ? toArray<CapitalInjectionRecord>(obj.capitalInjections)
        : INITIAL_CAPITAL_INJECTIONS.map((c) => ({ ...c }));

    const operatingExpenses =
      obj.operatingExpenses !== undefined
        ? toArray<OperatingExpenseRecord>(obj.operatingExpenses)
        : INITIAL_OPERATING_EXPENSES.map((e) => ({ ...e }));

    const resolvedCash = hasCash
      ? round2(Number(rawCash)) === 120.19 &&
        toArray(rawPurchases).length === 0 &&
        toArray(rawBatches).length === 0 &&
        operatingExpenses.length <= 1
        ? INITIAL_CASH_ON_HAND
        : round2(Number(rawCash))
      : base.cashOnHand;

    return {
      ...normalizedBase,
      cashOnHand: resolvedCash,
      inventory:
        migratedInventory.length > 0
          ? migratedInventory
          : normalizedBase.inventory,
      receivables,
      capitalInjections:
        capitalInjections.length > 0
          ? capitalInjections
          : INITIAL_CAPITAL_INJECTIONS.map((c) => ({ ...c })),
      operatingExpenses:
        operatingExpenses.length > 0
          ? operatingExpenses
          : INITIAL_OPERATING_EXPENSES.map((e) => ({ ...e })),
      sales:
        rawSales !== undefined
          ? toArray<SaleRecord>(rawSales)
          : normalizedBase.sales,
      purchases:
        rawPurchases !== undefined
          ? toArray<PurchaseRecord>(rawPurchases)
          : normalizedBase.purchases,
      purchaseBatches:
        rawBatches !== undefined
          ? toArray<PurchaseBatchRecord>(rawBatches)
          : normalizedBase.purchaseBatches,
      historicalNetProfit:
        typeof obj.historicalNetProfit === 'number' &&
        Number.isFinite(obj.historicalNetProfit)
          ? round2(obj.historicalNetProfit)
          : INITIAL_HISTORICAL_NET_PROFIT,
    };
  } catch {
    return null;
  }
}

/**
 * Detecta si un estado contiene únicamente los ítems genéricos del catálogo demo
 * sin autorización explícita (`isExplicitDemo`) ni ventas/compras reales registradas.
 */
export function isAccidentalDemoCatalogOnly(state: AppState): boolean {
  if (state.isExplicitDemo) return false;
  if (!state.inventory || state.inventory.length === 0) return false;
  if (
    state.sales.length > 0 ||
    state.purchases.length > 0 ||
    state.purchaseBatches.length > 0
  ) {
    return false;
  }
  return state.inventory.every((item) => DEMO_INVENTORY_IDS.has(item.id));
}

function scoreRecoveryCandidate(state: AppState): number {
  return (
    state.inventory.length * 100 +
    state.sales.length * 25 +
    state.purchases.length * 20 +
    state.purchaseBatches.length * 20 +
    state.movements.length
  );
}

/**
 * Reconcilia el estado remoto al arrancar la app:
 * 1) Purga automáticamente cualquier catálogo genérico de prueba inyectado por error.
 * 2) Recupera y migra datos reales existentes desde localStorage (sin inyectar datos falsos).
 * 3) Normaliza versiones heredadas ("Fan" -> "Fans") y tallas S..XXL sin borrar ningún ítem real.
 * 4) Mantiene el saldo base oficial ($135.19 USDT caja, 7 deudores $263.50 USDT, $1,912.35 capital, $624.00 gastos, $317.37 ganancia neta).
 */
export function recoverStartupErpState(
  remoteState: AppState,
  localCandidates: unknown[] = [],
): {
  state: AppState;
  needsFirebaseSync: boolean;
  recoverySummary?: string;
} {
  let strippedDemoFromRemote = false;
  let effectiveRemote = remoteState;
  if (isAccidentalDemoCatalogOnly(remoteState)) {
    strippedDemoFromRemote = true;
    effectiveRemote = {
      ...remoteState,
      inventory: [],
      isExplicitDemo: false,
    };
  }

  let bestLocal: AppState | null = null;
  for (const candidate of localCandidates) {
    const migrated = migrateLegacyStateToCurrent(candidate);
    if (!migrated) continue;
    const cleaned = isAccidentalDemoCatalogOnly(migrated)
      ? { ...migrated, inventory: [], isExplicitDemo: false }
      : migrated;
    if (
      !bestLocal ||
      scoreRecoveryCandidate(cleaned) > scoreRecoveryCandidate(bestLocal)
    ) {
      bestLocal = cleaned;
    }
  }

  // Si el remoto quedó sin inventario y hay un respaldo real en localStorage (no demo), recuperarlo
  if (effectiveRemote.inventory.length === 0 && !effectiveRemote.userPurgedEmpty) {
    if (bestLocal && bestLocal.inventory.length > 0) {
      const migratedInventory = migrateLegacyInventoryItems(bestLocal.inventory);
      const restoredCash =
        bestLocal.cashOnHand === 120.19 || bestLocal.cashOnHand <= 0
          ? INITIAL_CASH_ON_HAND
          : round2(bestLocal.cashOnHand);

      const restoredReceivables =
        bestLocal.receivables.length > 0 || bestLocal.collectedReceivablesCount > 0
          ? bestLocal.receivables
          : INITIAL_RECEIVABLES.map((r) => ({ ...r }));

      const restoredInjections =
        bestLocal.capitalInjections.length > 0
          ? bestLocal.capitalInjections
          : INITIAL_CAPITAL_INJECTIONS.map((c) => ({ ...c }));

      const restoredExpenses =
        bestLocal.operatingExpenses.length > 0
          ? bestLocal.operatingExpenses
          : INITIAL_OPERATING_EXPENSES.map((e) => ({ ...e }));

      const recoveredState: AppState = {
        ...bestLocal,
        cashOnHand: restoredCash,
        exchangeRates:
          effectiveRemote.exchangeRates && effectiveRemote.exchangeRates.usdt > 0
            ? effectiveRemote.exchangeRates
            : bestLocal.exchangeRates,
        inventory: migratedInventory,
        receivables: restoredReceivables,
        capitalInjections: restoredInjections,
        operatingExpenses: restoredExpenses,
        historicalNetProfit:
          bestLocal.historicalNetProfit ?? INITIAL_HISTORICAL_NET_PROFIT,
        userPurgedEmpty: false,
        movements: [
          {
            id: `mov-recovery-${Date.now()}`,
            type: 'reconciliation',
            description: `Recuperación automática desde respaldo local (${migratedInventory.reduce((s, i) => s + i.stock, 0)} uds) y caja (${formatUSD(restoredCash)} USDT)`,
            amount: restoredCash,
            createdAt: new Date().toISOString(),
          },
          ...(bestLocal.movements ?? []).slice(0, MAX_RECENT_MOVEMENTS - 1),
        ],
      };

      return {
        state: recoveredState,
        needsFirebaseSync: true,
        recoverySummary: `Inventario real recuperado (${migratedInventory.length} SKUs) y caja ajustada a ${formatUSD(restoredCash)} USDT.`,
      };
    }

    // Sin inventario en remoto ni en respaldo local real: mantener estado oficial limpio sin datos de prueba falsos
    const baseSource =
      bestLocal && scoreRecoveryCandidate(bestLocal) > scoreRecoveryCandidate(effectiveRemote)
        ? bestLocal
        : effectiveRemote;

    let changed = strippedDemoFromRemote || baseSource !== effectiveRemote;
    let nextCash = baseSource.cashOnHand;
    let nextMovements = baseSource.movements;
    if (
      round2(baseSource.cashOnHand) === 120.19 &&
      baseSource.purchases.length === 0 &&
      baseSource.purchaseBatches.length === 0 &&
      baseSource.operatingExpenses.length <= 1
    ) {
      nextCash = INITIAL_CASH_ON_HAND;
      changed = true;
      nextMovements = [
        {
          id: `mov-cash-restore-${Date.now()}`,
          type: 'reconciliation',
          description:
            'Corrección automática de caja física (+$15.00 USDT recuperados -> $135.19 USDT)',
          amount: 15.0,
          createdAt: new Date().toISOString(),
        },
        ...baseSource.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
      ];
    }

    const nextReceivables =
      baseSource.receivables.length > 0 || baseSource.collectedReceivablesCount > 0
        ? baseSource.receivables
        : ((changed = true), INITIAL_RECEIVABLES.map((r) => ({ ...r })));

    const nextInjections =
      baseSource.capitalInjections.length > 0
        ? baseSource.capitalInjections
        : ((changed = true), INITIAL_CAPITAL_INJECTIONS.map((c) => ({ ...c })));

    const nextExpenses =
      baseSource.operatingExpenses.length > 0
        ? baseSource.operatingExpenses
        : ((changed = true), INITIAL_OPERATING_EXPENSES.map((e) => ({ ...e })));

    const cleanState: AppState = {
      ...baseSource,
      cashOnHand: nextCash,
      exchangeRates:
        effectiveRemote.exchangeRates && effectiveRemote.exchangeRates.usdt > 0
          ? effectiveRemote.exchangeRates
          : baseSource.exchangeRates,
      inventory: [],
      receivables: nextReceivables,
      capitalInjections: nextInjections,
      operatingExpenses: nextExpenses,
      historicalNetProfit:
        baseSource.historicalNetProfit ?? INITIAL_HISTORICAL_NET_PROFIT,
      isExplicitDemo: false,
      movements: nextMovements,
    };

    return {
      state: cleanState,
      needsFirebaseSync: changed,
      recoverySummary: strippedDemoFromRemote
        ? 'Ítems de prueba eliminados; saldos reales ($135.19 USDT caja y $263.50 USDT CxC) verificados.'
        : undefined,
    };
  }

  // Inventario existente real: asegurar migración no destructiva (Fan -> Fans, tallas S..XXL, $135.19)
  let changed = strippedDemoFromRemote;
  const normalizedInventory = migrateLegacyInventoryItems(effectiveRemote.inventory);
  if (
    normalizedInventory.length !== effectiveRemote.inventory.length ||
    effectiveRemote.inventory.some((item, idx) => {
      const n = normalizedInventory[idx];
      return (
        !n ||
        item.version === 'Fan' ||
        !item.salePrice ||
        item.size !== n.size
      );
    })
  ) {
    changed = true;
  }

  let nextCash = effectiveRemote.cashOnHand;
  let nextMovements = effectiveRemote.movements;
  if (
    !effectiveRemote.userPurgedEmpty &&
    round2(effectiveRemote.cashOnHand) === 120.19 &&
    effectiveRemote.purchases.length === 0 &&
    effectiveRemote.purchaseBatches.length === 0 &&
    effectiveRemote.operatingExpenses.length <= 1
  ) {
    nextCash = INITIAL_CASH_ON_HAND;
    changed = true;
    nextMovements = [
      {
        id: `mov-cash-restore-${Date.now()}`,
        type: 'reconciliation',
        description:
          'Corrección automática de caja física (+$15.00 USDT recuperados -> $135.19 USDT)',
        amount: 15.0,
        createdAt: new Date().toISOString(),
      },
      ...effectiveRemote.movements.slice(0, MAX_RECENT_MOVEMENTS - 1),
    ];
  }

  let nextReceivables = effectiveRemote.receivables;
  if (
    !effectiveRemote.userPurgedEmpty &&
    effectiveRemote.receivables.length === 0 &&
    effectiveRemote.collectedReceivablesCount === 0
  ) {
    nextReceivables = INITIAL_RECEIVABLES.map((r) => ({ ...r }));
    changed = true;
  }

  if (!changed) {
    return { state: effectiveRemote, needsFirebaseSync: false };
  }

  return {
    state: {
      ...effectiveRemote,
      cashOnHand: nextCash,
      inventory: normalizedInventory,
      receivables: nextReceivables,
      movements: nextMovements,
    },
    needsFirebaseSync: true,
    recoverySummary: 'Datos adaptados automáticamente al formato S–XXL y $135.19 USDT.',
  };
}
