export type TabId =
  | 'dashboard'
  | 'ventas'
  | 'devoluciones'
  | 'inventario'
  | 'auditoria'
  | 'compras'
  | 'finanzas'
  | 'estadisticas'
  | 'reportes'
  | 'cargas'
  | 'historial-precios'
  | 'catalogo'
  | 'configuracion';

export type SubModuleId =
  | 'dashboard'
  | 'ventas-registrar'
  | 'ventas-historial'
  | 'ventas-devoluciones'
  | 'ventas-cxc'
  | 'compras-registrar'
  | 'compras-transito'
  | 'compras-precios'
  | 'inventario-stock'
  | 'inventario-auditoria'
  | 'inventario-ajustes'
  | 'finanzas-matriz'
  | 'finanzas-gastos'
  | 'finanzas-socios'
  | 'finanzas-capital'
  | 'finanzas-caja'
  | 'reportes'
  | 'estadisticas'
  | 'cargas'
  | 'catalogo'
  | 'configuracion';

export interface MatrixConfigParams {
  commissionPct: number; // Default 4%
  operatingFundPct: number; // Default 10%
  growthReinvestmentPct: number; // Default 80% of remainder
  dividendsPct: number; // Default 20% of remainder
  partnerSharesPct: Record<PartnerName, number>; // Default { Jesús: 53.65, Josué: 40.43, Gabriel: 5.92 }
  vitalReserveMinUsd?: number; // Default 150 (Mínimo Vital de Reserva en USDT)
  airRotationSharePct?: number; // Default 50 (% de Capa 4a para Pedido Aéreo de Rotación Activa)
  maritimeGoalUsd?: number; // Default 1500 (Meta Fondo Marítimo Masivo USD)
}

export interface AlertThresholdsConfig {
  lowStockThreshold: number; // Default 2
  receivableOverdueDays: number; // Default 30
  maritimeTransitMaxDays: number; // Default 80
  airTransitMaxDays: number; // Default 15
}

export interface BrandIdentityConfig {
  storeName: string; // Default 'X4SPORT'
  storeSubtitle: string; // Default 'INDUMENTARIA DEPORTIVA'
  storeLocation: string; // Default 'Guacara, Edo. Carabobo · Venezuela'
  logoUrl: string; // Default '/assets/aistudio/image_992adf2a.jpg'
  invoiceFooterMessage: string; // Default 'Gracias por comprar en X4SPORT'
}

export interface OtpEmailConfig {
  serviceId: string;
  templateId: string;
  publicKey: string;
}

export interface GeneralConfig {
  matrixParams: MatrixConfigParams;
  alertThresholds: AlertThresholdsConfig;
  brandIdentity: BrandIdentityConfig;
  otpEmailConfig?: OtpEmailConfig;
  updatedAt?: string;
  updatedBy?: string;
}

export type TeamCategory = string;

export type JerseyVersion = 'Player' | 'Fan' | 'Fans' | 'Retro';
export type StandardJerseySize = 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type JerseySize = StandardJerseySize | (string & {});

export type SellerName =
  | 'Jesús'
  | 'Josué'
  | 'Gabriel'
  | 'Sin Vendedor'
  | 'Sin Asignar';
export type PartnerName = 'Jesús' | 'Josué' | 'Gabriel';
export type PaymentStatus = 'Cobrado' | 'Pendiente';
export type PaymentMethod =
  | 'Efectivo ($)'
  | 'Binance USDT'
  | 'Zelle'
  | 'Pago Móvil / Bs'
  | 'Pago Mixto';

export type SinglePaymentMethod = Exclude<PaymentMethod, 'Pago Mixto'>;

export interface PaymentSplit {
  method: SinglePaymentMethod;
  amountUsd: number;
  bcvEquivalent?: number;
}

export type ShippingType = 'Aéreo' | 'Marítimo';

export interface FifoBatch {
  batchId: string;
  batchName: string;
  entryDate: string; // YYYY-MM-DD
  initialQuantity: number;
  remainingQuantity: number;
  unitCost: number; // Landed unit cost exact of this batch (USDT)
  usdtRate?: number; // Tasa USDT real aplicada al lote
}

export interface InventoryItem {
  id: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  stock: number;
  cogs: number; // Next active FIFO unit cost (or weighted avg display)
  salePrice: number; // Retail unit price in USD / USDT
  fifoBatches: FifoBatch[];
}

export interface ReceivableInstallment {
  id: string;
  amount: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
}

export interface ReceivableItem {
  id: string;
  debtor: string;
  amount: number;
  originalAmount?: number;
  paidAmount?: number;
  installments?: ReceivableInstallment[];
  createdAt: string;
  note?: string;
  saleId?: string;
  paymentMethod?: PaymentMethod;
  clientLastOpId?: string;
}

export interface FourLayerBreakdown {
  grossRevenue: number;
  layer1CostRecovery: number;
  grossProfit?: number;
  layer2Commission: number;
  layer2ToReinvestment?: number;
  netProfit: number;
  layer3OperatingFund: number;
  remainingNetProfit: number;
  layer4GrowthReinvestment: number;
  layer4TotalDividends: number;
  partnerSplits: Record<PartnerName, number>;
}

export interface FifoConsumptionDetail {
  batchId: string;
  batchName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface SaleLineItem {
  skuId: string;
  modelLabel: string;
  team: TeamCategory;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  unitCogs: number; // Weighted effective COGS from consumed FIFO layers
  totalLineCogs: number;
  baseUnitPrice?: number;
  discountLabel?: string;
  unitPrice: number;
  subtotal: number;
  fifoConsumed?: FifoConsumptionDetail[];
}

export interface SaleRecord {
  id: string;
  invoiceNumber?: string; // Consecutivo ordenado: #0001, #0002, ... (y legado FAC-0001)
  saleDate?: string; // YYYY-MM-DD fecha editable de la venta
  skuId: string;
  modelLabel: string;
  team: TeamCategory;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  unitCogs: number;
  finalPrice: number;
  paidAmount?: number; // Monto pagado al momento de registrar la venta
  returnedAmount?: number; // Monto acumulado devuelto / acreditado por devoluciones
  returnStatus?: 'Parcial' | 'Total'; // Indica si la factura tuvo devolución parcial o total
  items?: SaleLineItem[];
  customerName: string;
  customerCity?: string;
  customerPhone?: string;
  customerSocial?: string;
  customerIdDoc?: string;
  seller: SellerName;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paymentSplits?: PaymentSplit[];
  bcvEquivalent?: number;
  debtorName?: string;
  deliveryDate?: string; // YYYY-MM-DD fecha de entrega o recordatorio
  calendarEventId?: string;
  calendarEventLink?: string;
  breakdown: FourLayerBreakdown;
  userName?: string;
  clientOperationId?: string;
  voided?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  convertedToCreditAt?: string;
  convertedToCreditBy?: string;
  createdAt: string;
}

export type ReturnExchangeType = 'Cambio' | 'Devolución';

export interface ReturnExchangeRecord {
  id: string;
  type: ReturnExchangeType;
  saleId?: string;
  invoiceNumber?: string;
  returnedSkuId: string;
  returnedModelLabel: string;
  returnedVersion: JerseyVersion;
  returnedSize: JerseySize;
  returnedQuantity: number;
  returnedUnitPrice: number;
  returnedTotal: number;
  replacementSkuId?: string;
  replacementModelLabel?: string;
  replacementVersion?: JerseyVersion;
  replacementSize?: JerseySize;
  replacementQuantity?: number;
  replacementUnitPrice?: number;
  replacementTotal?: number;
  differenceUsd: number; // >0 cliente paga diferencia, <0 se reembolsa al cliente, 0 parejo
  paymentMethod: SinglePaymentMethod;
  reason: string;
  customerName?: string;
  clientOperationId?: string;
  createdAt: string;
}

export type PurchaseBatchStatus = 'EN TRÁNSITO' | 'RECIBIDO EN BODEGA';
export type PurchaseFundingSource =
  | 'replacement'
  | 'growthReinvestment'
  | 'cashOnHand';
export type PurchasePricingMode = 'uniform' | 'per-item';

export interface PurchaseBatchItemRecord {
  skuId?: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  orderedQuantity: number;
  quantity: number;
  receivedQuantity?: number;
  salePrice?: number;
  factoryUnitCost: number;
  proratedFreightPerUnit: number;
  landedUnitCost: number;
  lineFactoryTotal: number;
  lineLandedTotal: number;
}

export interface PurchaseBatchRecord {
  id: string;
  status: PurchaseBatchStatus;
  fundingSource: PurchaseFundingSource;
  entryDate: string; // Order date (YYYY-MM-DD)
  estimatedArrivalDate?: string; // Fecha estimada de llegada (YYYY-MM-DD)
  receivedDate?: string; // Warehouse arrival date for FIFO (YYYY-MM-DD)
  diasTranscurridos?: number; // Días calendario entre entryDate y receivedDate
  supplier?: string; // Proveedor u origen del lote
  retailPricingMode?: PurchasePricingMode;
  isDirectReception?: boolean;
  clientOperationId?: string;
  calendarEventId?: string;
  calendarEventLink?: string;
  referenceName: string;
  shippingType: ShippingType;
  orderedTotalUnits: number;
  totalUnits: number;
  totalFactoryCost: number;
  estimatedFreightCost: number;
  totalFreightCost: number;
  freightAdjustment?: number;
  freightPerUnit: number;
  totalLandedCost: number;
  usdtRate?: number; // Tasa USDT real del lote (editable / importada de Excel)
  items: PurchaseBatchItemRecord[];
  userName?: string;
  createdAt: string;
  receivedAt?: string;
}

export interface PurchaseRecord {
  id: string;
  skuId: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  unitCostWithFreight: number;
  totalCost: number;
  previousCogs: number | null;
  resultingCogs: number;
  createdAt: string;
}

export interface ExchangeRates {
  bcv: number;
  usdt: number;
  updatedAt: string;
  source?: 'api' | 'manual' | 'excel' | 'seed';
}

export type ExpenseCategory =
  | 'Logística/Producción'
  | 'Comercialización/Publicidad'
  | 'Personales/Retiros de Socios';

export type ExpenseSource =
  | 'operatingFund'
  | 'growthReinvestment'
  | 'replacement'
  | 'dividends'
  | 'cashOnHand';

export interface OperatingExpenseRecord {
  id: string;
  concept: string;
  category?: ExpenseCategory;
  amount: number;
  source: ExpenseSource;
  paymentMethod: SinglePaymentMethod;
  deficitCoveredByFunds?: number;
  createdAt: string;
}

export type InventoryAdjustmentType = 'entrada' | 'salida' | 'descruce';

export interface InventoryAdjustmentRecord {
  id: string;
  skuId: string;
  modelLabel: string;
  version: JerseyVersion;
  size: JerseySize;
  previousStock: number;
  newStock: number;
  delta: number;
  fifoLossCost?: number;
  auditMode?: 'cascade' | 'sku' | 'manual' | 'uncross';
  adjustmentType?: InventoryAdjustmentType;
  targetSkuId?: string;
  targetModelLabel?: string;
  targetVersion?: JerseyVersion;
  targetSize?: JerseySize;
  reason: string;
  userName?: string;
  createdAt: string;
}

export interface InventoryAuditSummaryMetrics {
  totalItems: number;
  reconciledItems: number;
  reconciledItemsPct: number;
  unreconciledItems: number;
  unreconciledItemsPct: number;
  uncountedItems: number;
  uncountedItemsPct: number;

  totalSystemUnits: number;
  reconciledUnits: number;
  reconciledUnitsPct: number;
  unreconciledUnits: number;
  unreconciledUnitsPct: number;
  uncountedUnits: number;
  uncountedUnitsPct: number;
}

export interface InventoryAuditCrossAlert {
  id: string;
  model: string;
  version: JerseyVersion;
  surplusSkuId: string;
  surplusSize: JerseySize;
  surplusDelta: number;
  shortageSkuId: string;
  shortageSize: JerseySize;
  shortageDelta: number;
  uncrossQuantity: number;
}

export interface InventoryAuditSession {
  id: string;
  status: 'draft' | 'closed';
  startedAt: string;
  updatedAt: string;
  closedAt?: string;
  notes?: string;
  counts: Record<string, number | null>;
  modelQuickCounts?: Record<string, number | null>;
  summary?: InventoryAuditSummaryMetrics;
  closedBy?: string;
}

export interface FinancialFunds {
  replacement: number;
  commissions: number;
  commissionsBySeller: Record<PartnerName, number>;
  operatingAndAds: number;
  growthReinvestment: number;
  dividendsByPartner: Record<PartnerName, number>;
  reinvestedFromDividendsTotal: number;
}

export type CapitalInjectionDestination =
  | 'cashOnly'
  | 'operatingFund'
  | 'growthReinvestment';

export interface CapitalInjectionRecord {
  id: string;
  contributor: string;
  concept: string;
  amount: number;
  paymentMethod: SinglePaymentMethod;
  destination: CapitalInjectionDestination;
  createdAt: string;
}

export interface AuditMovement {
  id: string;
  type:
    | 'sale'
    | 'sale_void'
    | 'sale_to_cxc'
    | 'purchase'
    | 'collection'
    | 'reinvestment'
    | 'dividend_withdrawal'
    | 'funds_sync'
    | 'expense'
    | 'adjustment'
    | 'capital_injection'
    | 'reconciliation'
    | 'return_exchange';
  description: string;
  amount: number;
  createdAt: string;
}

export interface CustomerProfile {
  id: string;
  name: string;
  phone?: string;
  city?: string;
  social?: string;
  idDoc?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizedUserRecord {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'partner';
  title?: string;
  phone?: string;
  password?: string;
  passwordHash?: string;
  firstLoginPending: boolean;
  avatarBg?: string;
  createdAt: string;
}

export interface BulkImportRecord {
  id: string;
  fileName: string;
  importDate: string; // YYYY-MM-DD
  userName: string;
  sheetsDetected: string[];
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
  status: 'Aplicada' | 'Validada';
  notes?: string;
  createdAt: string;
}

export interface AppState {
  cashOnHand: number;
  exchangeRates: ExchangeRates;
  inventory: InventoryItem[];
  receivables: ReceivableItem[];
  collectedReceivablesCount: number;
  sales: SaleRecord[];
  nextInvoiceSeq?: number;
  returns?: ReturnExchangeRecord[];
  purchases: PurchaseRecord[];
  purchaseBatches: PurchaseBatchRecord[];
  operatingExpenses: OperatingExpenseRecord[];
  capitalInjections: CapitalInjectionRecord[];
  inventoryAdjustments: InventoryAdjustmentRecord[];
  activeAuditSession?: InventoryAuditSession | null;
  auditHistory?: InventoryAuditSession[];
  customers?: CustomerProfile[];
  seenAlertIds?: string[];
  catalogEnabled?: boolean;
  catalogPhotos?: Record<string, string>;
  catalogKeywords?: Record<string, string>;
  historicalNetProfit?: number;
  userPurgedEmpty?: boolean;
  isExplicitDemo?: boolean;
  funds: FinancialFunds;
  movements: AuditMovement[];
  authorizedUsers?: AuthorizedUserRecord[];
  bulkImports?: BulkImportRecord[];
}
