import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Ban,
  Calendar,
  CheckCircle2,
  Download,
  ExternalLink,
  FileImage,
  History,
  Loader2,
  Percent,
  Plus,
  Search,
  ShoppingBag,
  Star,
  Tag,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AppState,
  BrandIdentityConfig,
  InventoryItem,
  JerseySize,
  JerseyVersion,
  MatrixConfigParams,
  PaymentMethod,
  PaymentSplit,
  PaymentStatus,
  SaleRecord,
  SellerName,
  SinglePaymentMethod,
  TeamCategory,
} from '../types/erp';
import { isAdminUser, type ERPUser } from '../utils/auth';
import type {
  ConvertSaleToReceivableInput,
  PricingAdjustMode,
  RegisterMultiSaleInput,
  UpsertCustomerInput,
  VoidSaleInput,
} from '../utils/finance';
import {
  calculateDiscountedUnitPrice,
  compareJerseySizes,
  DEFAULT_GENERAL_CONFIG,
  doesItemMatchTeamFilter,
  doesSaleMatchSearchQuery,
  formatUSD,
  formatVES,
  normalizeCanonicalTeam,
  normalizeVersionDisplay,
  previewFifoConsumption,
  round2,
  WHOLESALE_DISCOUNT_PCT,
} from '../utils/finance';
import {
  buildCustomerDirectory,
  evaluateCustomerStatus,
  isWalkInCustomerName,
  normalizeCustomerText,
  searchCustomerDirectory,
  type CustomerHistorySummary,
} from '../utils/customers';
import {
  buildSaleCalendarEvent,
  createGoogleCalendarEvent,
  shouldScheduleSaleCalendarEvent,
  type GoogleCalendarAuthState,
} from '../utils/googleCalendar';
import {
  downloadJpgDataUrl,
  renderSaleReceiptJpgDataUrl,
} from '../utils/receiptJpg';
import { GoogleCalendarBanner } from './GoogleCalendarBanner';

interface SalesViewProps {
  state: AppState;
  currentUser?: ERPUser | null;
  activeSection?: 'registrar' | 'historial';
  matrixParams?: MatrixConfigParams;
  brandIdentity?: BrandIdentityConfig;
  calendarAuth?: GoogleCalendarAuthState;
  onConnectGoogleCalendar?: () => Promise<boolean>;
  onDisconnectGoogleCalendar?: () => Promise<void>;
  onCalendarAuthExpired?: () => void;
  onAttachSaleCalendarMetadata?: (
    saleId: string,
    eventId: string,
    htmlLink?: string,
  ) => void;
  onRegisterMultiSale: (
    input: RegisterMultiSaleInput,
  ) =>
    | Promise<{ ok: boolean; error?: string; createdSale?: SaleRecord }>
    | { ok: boolean; error?: string; createdSale?: SaleRecord };
  onSaveCustomerProfile?: (
    input: UpsertCustomerInput,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onConvertSaleToReceivable?: (
    input: ConvertSaleToReceivableInput,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onVoidSale?: (
    input: VoidSaleInput,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
}

interface CartLine {
  lineId: string;
  skuId: string;
  modelLabel: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  baseUnitPrice: number;
  discountLabel?: string;
  unitPrice: number;
  subtotal: number;
}

interface MinimalModelCardGroup {
  groupKey: string;
  model: string;
  version: 'Fans' | 'Player' | 'Retro';
  canonicalTeam: TeamCategory;
  sizeItems: Array<{
    item: InventoryItem;
    availableStock: number;
  }>;
}

const SELLERS: SellerName[] = ['Jesús', 'Josué', 'Gabriel', 'Sin Asignar'];
const CORE_TEAM_FILTERS = [
  'Todos',
  'Real Madrid',
  'Barcelona',
  'Manchester City',
  'PSG',
  'Selecciones',
] as const;

const SINGLE_PAYMENT_METHODS: SinglePaymentMethod[] = [
  'Efectivo ($)',
  'Binance USDT',
  'Zelle',
  'Pago Móvil / Bs',
];
const ALL_PAYMENT_METHODS: PaymentMethod[] = [
  ...SINGLE_PAYMENT_METHODS,
  'Pago Mixto',
];

const INITIAL_MIXED_SPLITS: Record<SinglePaymentMethod, string> = {
  'Efectivo ($)': '',
  'Binance USDT': '',
  Zelle: '',
  'Pago Móvil / Bs': '',
};

function getTodayLocalDateIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function createDraftOpId(): string {
  return `sale-op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDisplayDate(sale: SaleRecord): string {
  const raw = sale.saleDate?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date(sale.createdAt).toLocaleDateString('es-VE', {
    dateStyle: 'short',
  });
}

export function SalesView({
  state,
  currentUser,
  activeSection = 'registrar',
  brandIdentity,
  calendarAuth,
  onConnectGoogleCalendar,
  onDisconnectGoogleCalendar,
  onCalendarAuthExpired,
  onAttachSaleCalendarMetadata,
  onRegisterMultiSale,
  onSaveCustomerProfile,
  onConvertSaleToReceivable,
  onVoidSale,
}: SalesViewProps) {
  const isAdmin = isAdminUser(currentUser);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [modelSearch, setModelSearch] = useState<string>('');
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('Todos');
  const [selectedSkuId, setSelectedSkuId] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('1');
  const [unitPrice, setUnitPrice] = useState<string>('30.00');
  const [pricingMode, setPricingMode] = useState<PricingAdjustMode>('normal');
  const [discountType, setDiscountType] = useState<'pct' | 'usd'>('usd');
  const [discountAmountInput, setDiscountAmountInput] = useState<string>('');

  // Sale metadata & mandatory controls
  const [saleDate, setSaleDate] = useState<string>(() => getTodayLocalDateIso());
  const [seller, setSeller] = useState<SellerName>('Jesús');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Cobrado');
  const [paidAmountInput, setPaidAmountInput] = useState<string>('0.00');
  const [deliveryDate, setDeliveryDate] = useState<string>('');
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>('Efectivo ($)');
  const [mixedSplits, setMixedSplits] =
    useState<Record<SinglePaymentMethod, string>>(INITIAL_MIXED_SPLITS);

  // Optional flexible customer fields + dynamic autocomplete & profile state
  const [customerName, setCustomerName] = useState<string>('');
  const [customerCity, setCustomerCity] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerSocial, setCustomerSocial] = useState<string>('');
  const [customerIdDoc, setCustomerIdDoc] = useState<string>('');
  const [showExtraCustomerFields, setShowExtraCustomerFields] =
    useState<boolean>(false);
  const [customerDropdownOpen, setCustomerDropdownOpen] =
    useState<boolean>(false);
  const [customerSavedNotice, setCustomerSavedNotice] = useState<string | null>(
    null,
  );
  const customerBoxRef = useRef<HTMLDivElement | null>(null);

  const [isSubmittingSale, setIsSubmittingSale] = useState<boolean>(false);
  const [draftOpId, setDraftOpId] = useState<string>(() => createDraftOpId());
  const [pendingCalendarSale, setPendingCalendarSale] =
    useState<SaleRecord | null>(null);
  const [lastCreatedSale, setLastCreatedSale] = useState<SaleRecord | null>(
    null,
  );
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    calendarNotice?: string;
    calendarLink?: string;
    needsCalendarAuth?: boolean;
  } | null>(null);

  // Invoice search & auto-generated JPG receipt state
  const [invoiceSearch, setInvoiceSearch] = useState<string>('');
  const [receiptPreview, setReceiptPreview] = useState<{
    sale: SaleRecord;
    dataUrl: string;
  } | null>(null);
  const [generatingReceiptId, setGeneratingReceiptId] = useState<string | null>(
    null,
  );
  const [cxcTargetSale, setCxcTargetSale] = useState<SaleRecord | null>(null);
  const [cxcCustomerNameInput, setCxcCustomerNameInput] = useState<string>('');
  const [cxcError, setCxcError] = useState<string | null>(null);
  const [voidTargetSale, setVoidTargetSale] = useState<SaleRecord | null>(null);
  const [voidReasonInput, setVoidReasonInput] = useState<string>('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [isProcessingHistoryAction, setIsProcessingHistoryAction] =
    useState<boolean>(false);
  const [historyFeedback, setHistoryFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const qtyInCartBySku = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart) {
      map.set(line.skuId, (map.get(line.skuId) ?? 0) + line.quantity);
    }
    return map;
  }, [cart]);

  const availableSkus = useMemo(
    () =>
      state.inventory
        .filter((item) => item.stock - (qtyInCartBySku.get(item.id) ?? 0) > 0)
        .sort(
          (a, b) =>
            a.model.localeCompare(b.model) ||
            a.version.localeCompare(b.version) ||
            compareJerseySizes(a.size, b.size),
        ),
    [qtyInCartBySku, state.inventory],
  );

  const teamFilterOptions = useMemo(() => {
    const extras = new Set<string>();
    const coreSet = new Set<string>(CORE_TEAM_FILTERS);
    for (const item of availableSkus) {
      const canonical = normalizeCanonicalTeam(item.team, item.model);
      if (canonical && !coreSet.has(canonical)) {
        extras.add(canonical);
      }
    }
    return [
      ...CORE_TEAM_FILTERS,
      ...Array.from(extras).sort((a, b) => a.localeCompare(b)),
    ];
  }, [availableSkus]);

  const filteredSelectorSkus = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    return availableSkus.filter((item) => {
      if (!doesItemMatchTeamFilter(item, selectedTeamFilter)) {
        return false;
      }
      if (!q) return true;
      const ver = normalizeVersionDisplay(item.version).toLowerCase();
      const canonicalTeam = normalizeCanonicalTeam(
        item.team,
        item.model,
      ).toLowerCase();
      return (
        item.model.toLowerCase().includes(q) ||
        ver.includes(q) ||
        item.size.toLowerCase().includes(q) ||
        canonicalTeam.includes(q)
      );
    });
  }, [availableSkus, modelSearch, selectedTeamFilter]);

  const groupedModelCards = useMemo((): MinimalModelCardGroup[] => {
    const groupsMap = new Map<string, MinimalModelCardGroup>();
    for (const item of filteredSelectorSkus) {
      const avail = item.stock - (qtyInCartBySku.get(item.id) ?? 0);
      if (avail <= 0) continue;
      const ver = normalizeVersionDisplay(item.version);
      const groupKey = `${item.model.trim().toLowerCase()}::${ver}`;
      let group = groupsMap.get(groupKey);
      if (!group) {
        group = {
          groupKey,
          model: item.model.trim(),
          version: ver,
          canonicalTeam: normalizeCanonicalTeam(item.team, item.model),
          sizeItems: [],
        };
        groupsMap.set(groupKey, group);
      }
      group.sizeItems.push({ item, availableStock: avail });
    }
    return Array.from(groupsMap.values()).map((g) => ({
      ...g,
      sizeItems: g.sizeItems.sort((a, b) =>
        compareJerseySizes(a.item.size, b.item.size),
      ),
    }));
  }, [filteredSelectorSkus, qtyInCartBySku]);

  const effectiveSkuId = filteredSelectorSkus.some(
    (s) => s.id === selectedSkuId,
  )
    ? selectedSkuId
    : (filteredSelectorSkus[0]?.id ?? '');

  const activeSku =
    filteredSelectorSkus.find((s) => s.id === effectiveSkuId) ?? null;
  const remainingForActiveSku = activeSku
    ? activeSku.stock - (qtyInCartBySku.get(activeSku.id) ?? 0)
    : 0;

  useEffect(() => {
    if (!activeSku) return;
    setUnitPrice(activeSku.salePrice.toFixed(2));
    setPricingMode('normal');
    setDiscountAmountInput('');
  }, [activeSku?.id, activeSku?.salePrice]);

  useEffect(() => {
    if (!customerDropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        customerBoxRef.current &&
        !customerBoxRef.current.contains(e.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [customerDropdownOpen]);

  const customerDirectory = useMemo(
    () => buildCustomerDirectory(state.sales, state.customers ?? []),
    [state.customers, state.sales],
  );

  const customerSuggestions = useMemo(() => {
    const query = customerName.trim() || customerPhone.trim();
    return searchCustomerDirectory(customerDirectory, query, 7);
  }, [customerDirectory, customerName, customerPhone]);

  const customerStatus = useMemo(
    () =>
      evaluateCustomerStatus(
        customerDirectory,
        customerName,
        customerPhone,
      ),
    [customerDirectory, customerName, customerPhone],
  );

  const handleSelectCustomerSuggestion = (customer: CustomerHistorySummary) => {
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone ?? '');
    setCustomerCity(customer.city ?? '');
    setCustomerSocial(customer.social ?? '');
    setCustomerIdDoc(customer.idDoc ?? '');
    setCustomerDropdownOpen(false);
    setCustomerSavedNotice(null);
    setFeedback(null);
  };

  const handleClearCustomerFields = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerCity('');
    setCustomerSocial('');
    setCustomerIdDoc('');
    setCustomerSavedNotice(null);
    setCustomerDropdownOpen(false);
  };

  const handleSaveNewCustomerInline = async () => {
    if (!onSaveCustomerProfile) return;
    const res = await Promise.resolve(
      onSaveCustomerProfile({
        name: customerName,
        phone: customerPhone,
        city: customerCity,
        social: customerSocial,
        idDoc: customerIdDoc,
      }),
    );
    if (!res.ok) {
      setFeedback({
        type: 'error',
        text: res.error ?? 'No se pudo guardar la ficha del cliente.',
      });
      return;
    }
    setCustomerDropdownOpen(false);
    setCustomerSavedNotice(
      `Ficha de ${customerName.trim()} guardada en el directorio sin salir de la venta.`,
    );
    setFeedback(null);
  };

  const cartTotals = useMemo(() => {
    let totalUnits = 0;
    let totalAmount = 0;

    for (const line of cart) {
      totalUnits += line.quantity;
      totalAmount += line.subtotal;
    }

    return {
      totalUnits,
      totalAmount: round2(totalAmount),
    };
  }, [cart]);

  // Keep FIFO preview strictly internal for validation (not rendered in UI cards)
  useMemo(() => {
    const workingInventory = new Map(
      state.inventory.map((item) => [
        item.id,
        {
          ...item,
          fifoBatches: (item.fifoBatches ?? []).map((b) => ({ ...b })),
        },
      ]),
    );
    for (const line of cart) {
      const sku = workingInventory.get(line.skuId);
      if (sku) {
        const res = previewFifoConsumption(sku, line.quantity);
        sku.stock -= line.quantity;
        sku.fifoBatches = res.updatedBatches;
      }
    }
    return true;
  }, [cart, state.inventory]);

  const handleSelectModelCard = (skuId: string) => {
    setSelectedSkuId(skuId);
    const found = filteredSelectorSkus.find((s) => s.id === skuId);
    if (found) {
      setUnitPrice(found.salePrice.toFixed(2));
      setPricingMode('normal');
      setDiscountAmountInput('');
    }
    setFeedback(null);
  };

  const handleToggleWholesale = () => {
    if (!activeSku) return;
    setFeedback(null);
    if (pricingMode === 'wholesale') {
      setPricingMode('normal');
      setUnitPrice(activeSku.salePrice.toFixed(2));
      return;
    }
    const res = calculateDiscountedUnitPrice(activeSku.salePrice, 'wholesale');
    setPricingMode('wholesale');
    setDiscountAmountInput('');
    setUnitPrice(res.unitPrice.toFixed(2));
  };

  const handleToggleCustomDiscount = () => {
    if (!activeSku) return;
    setFeedback(null);
    const isDiscountActive =
      pricingMode === 'discount_pct' || pricingMode === 'discount_usd';
    if (isDiscountActive) {
      setPricingMode('normal');
      setDiscountAmountInput('');
      setUnitPrice(activeSku.salePrice.toFixed(2));
      return;
    }
    const nextMode: PricingAdjustMode =
      discountType === 'pct' ? 'discount_pct' : 'discount_usd';
    const defaultVal =
      discountAmountInput || (discountType === 'pct' ? '10' : '2');
    setPricingMode(nextMode);
    setDiscountAmountInput(defaultVal);
    const res = calculateDiscountedUnitPrice(
      activeSku.salePrice,
      nextMode,
      Number(defaultVal) || 0,
    );
    setUnitPrice(res.unitPrice.toFixed(2));
  };

  const handleDiscountAmountChange = (
    rawVal: string,
    nextType = discountType,
  ) => {
    setDiscountAmountInput(rawVal);
    setFeedback(null);
    if (!activeSku) return;
    const mode: PricingAdjustMode =
      nextType === 'pct' ? 'discount_pct' : 'discount_usd';
    setPricingMode(mode);
    const res = calculateDiscountedUnitPrice(
      activeSku.salePrice,
      mode,
      Number(rawVal) || 0,
    );
    setUnitPrice(res.unitPrice.toFixed(2));
  };

  const currentDiscountLabel = useMemo(() => {
    if (!activeSku) return undefined;
    const parsedPrice = round2(Number(unitPrice) || 0);
    if (pricingMode === 'wholesale') {
      return `Al Mayor (-${WHOLESALE_DISCOUNT_PCT}%)`;
    }
    if (pricingMode === 'discount_pct' || pricingMode === 'discount_usd') {
      return calculateDiscountedUnitPrice(
        activeSku.salePrice,
        pricingMode,
        Number(discountAmountInput) || 0,
      ).discountLabel;
    }
    if (pricingMode === 'manual' && parsedPrice < activeSku.salePrice) {
      const diff = round2(activeSku.salePrice - parsedPrice);
      return `Precio especial (-${formatUSD(diff)})`;
    }
    return undefined;
  }, [activeSku, discountAmountInput, pricingMode, unitPrice]);

  const handleAddToCart = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!activeSku) {
      setFeedback({
        type: 'error',
        text: 'Selecciona una franela disponible para agregar.',
      });
      return;
    }

    const parsedQty = Math.floor(Number(quantity) || 0);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      setFeedback({
        type: 'error',
        text: 'La cantidad debe ser un número entero mayor a 0.',
      });
      return;
    }

    if (parsedQty > remainingForActiveSku) {
      setFeedback({
        type: 'error',
        text: `Stock insuficiente para ${activeSku.model} (${normalizeVersionDisplay(activeSku.version)} · ${activeSku.size}). Quedan ${remainingForActiveSku} unidad(es).`,
      });
      return;
    }

    const parsedUnitPrice = round2(Number(unitPrice) || 0);
    if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice <= 0) {
      setFeedback({
        type: 'error',
        text: 'El precio unitario debe ser mayor a $0.00.',
      });
      return;
    }

    setCart((prev) => {
      const matchIdx = prev.findIndex(
        (line) =>
          line.skuId === activeSku.id &&
          line.unitPrice === parsedUnitPrice &&
          line.discountLabel === currentDiscountLabel,
      );
      if (matchIdx >= 0) {
        return prev.map((line, idx) =>
          idx === matchIdx
            ? {
                ...line,
                quantity: line.quantity + parsedQty,
                subtotal: round2((line.quantity + parsedQty) * line.unitPrice),
              }
            : line,
        );
      }

      return [
        ...prev,
        {
          lineId: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          skuId: activeSku.id,
          modelLabel: activeSku.model,
          version: activeSku.version,
          size: activeSku.size,
          quantity: parsedQty,
          baseUnitPrice: activeSku.salePrice,
          discountLabel: currentDiscountLabel,
          unitPrice: parsedUnitPrice,
          subtotal: round2(parsedQty * parsedUnitPrice),
        },
      ];
    });

    setDraftOpId(createDraftOpId());
    setQuantity('1');
  };

  const handleRemoveCartLine = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
    setDraftOpId(createDraftOpId());
    setFeedback(null);
  };

  const mixedAllocatedTotal = useMemo(() => {
    return round2(
      SINGLE_PAYMENT_METHODS.reduce(
        (sum, m) => sum + Math.max(0, round2(Number(mixedSplits[m]) || 0)),
        0,
      ),
    );
  }, [mixedSplits]);

  const mixedRemaining = round2(cartTotals.totalAmount - mixedAllocatedTotal);

  const openOrDownloadSaleReceipt = async (
    sale: SaleRecord,
    autoDownload: boolean,
  ) => {
    setGeneratingReceiptId(sale.id);
    try {
      const dataUrl = await renderSaleReceiptJpgDataUrl(
        sale,
        state.exchangeRates.bcv,
        brandIdentity,
      );
      setReceiptPreview({ sale, dataUrl });
      if (autoDownload) {
        const cleanFileCode = (sale.invoiceNumber || sale.id).replace(/^#/, 'Factura-');
        downloadJpgDataUrl(dataUrl, `${cleanFileCode}.jpg`);
      }
    } catch {
      // Fail gracefully without blocking sale completion
    } finally {
      setGeneratingReceiptId(null);
    }
  };

  const scheduleSaleInCalendar = async (sale: SaleRecord) => {
    const calRes = await createGoogleCalendarEvent(buildSaleCalendarEvent(sale));
    if (calRes.ok) {
      setPendingCalendarSale(null);
      if (calRes.eventId) {
        onAttachSaleCalendarMetadata?.(
          sale.id,
          calRes.eventId,
          calRes.htmlLink,
        );
      }
      setFeedback((prev) =>
        prev
          ? {
              ...prev,
              calendarNotice: `Recordatorio agendado en Google Calendar para ${sale.customerName}.`,
              calendarLink: calRes.htmlLink,
              needsCalendarAuth: false,
            }
          : {
              type: 'success',
              text: `Recordatorio de ${sale.invoiceNumber || 'venta'} agendado en Google Calendar.`,
              calendarNotice: `Recordatorio agendado para ${sale.customerName}.`,
              calendarLink: calRes.htmlLink,
              needsCalendarAuth: false,
            },
      );
    } else if (calRes.needsAuth) {
      setPendingCalendarSale(sale);
      onCalendarAuthExpired?.();
      setFeedback((prev) =>
        prev
          ? {
              ...prev,
              calendarNotice:
                'Conecta Google Calendar para agendar automáticamente este recordatorio.',
              needsCalendarAuth: true,
            }
          : null,
      );
    } else {
      setFeedback((prev) =>
        prev
          ? {
              ...prev,
              calendarNotice: `No se pudo agendar en Google Calendar: ${calRes.error ?? 'error desconocido'}`,
              needsCalendarAuth: false,
            }
          : null,
      );
    }
  };

  const effectivePaidAmount =
    paymentStatus === 'Cobrado'
      ? cartTotals.totalAmount
      : round2(Math.max(0, Number(paidAmountInput) || 0));

  const pendingCreditBalance =
    paymentStatus === 'Pendiente'
      ? round2(Math.max(0, cartTotals.totalAmount - effectivePaidAmount))
      : 0;

  const handleConfirmTotalSale = async () => {
    if (isSubmittingSale) return;
    setFeedback(null);
    setPendingCalendarSale(null);

    if (cart.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Agrega al menos un producto al carrito antes de registrar la venta.',
      });
      return;
    }

    if (!saleDate.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate.trim())) {
      setFeedback({
        type: 'error',
        text: 'Selecciona una fecha válida para la venta.',
      });
      return;
    }

    if (paymentStatus === 'Pendiente') {
      const parsedPaid = round2(Number(paidAmountInput) || 0);
      if (parsedPaid < 0) {
        setFeedback({
          type: 'error',
          text: 'El monto pagado inicial no puede ser negativo.',
        });
        return;
      }
      if (parsedPaid >= round2(cartTotals.totalAmount - 0.009)) {
        setFeedback({
          type: 'error',
          text: 'El monto pagado cubre el 100% de la venta; cambia la condición a Contado.',
        });
        return;
      }
    }

    const effectiveMethod: PaymentMethod =
      paymentStatus === 'Pendiente' && paymentMethod === 'Pago Mixto'
        ? 'Efectivo ($)'
        : paymentMethod;

    const paymentSplitsPayload: PaymentSplit[] | undefined =
      effectiveMethod === 'Pago Mixto'
        ? SINGLE_PAYMENT_METHODS.map((m) => ({
            method: m,
            amountUsd: Math.max(0, round2(Number(mixedSplits[m]) || 0)),
          })).filter((s) => s.amountUsd > 0)
        : undefined;

    const summaryCount = cartTotals.totalUnits;
    const summaryTotal = cartTotals.totalAmount;
    const cleanCustomer = customerName.trim() || 'Cliente Mostrador';
    const cleanCity = customerCity.trim() || undefined;
    const cleanPhone = customerPhone.trim() || undefined;
    const cleanSocial = customerSocial.trim() || undefined;
    const cleanIdDoc = customerIdDoc.trim() || undefined;
    const cleanDeliveryDate = deliveryDate.trim() || undefined;

    setIsSubmittingSale(true);
    try {
      const res = await Promise.resolve(
        onRegisterMultiSale({
          items: cart.map((line) => ({
            skuId: line.skuId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            baseUnitPrice: line.baseUnitPrice,
            discountLabel: line.discountLabel,
          })),
          saleDate: saleDate.trim(),
          customerName: cleanCustomer,
          customerCity: cleanCity,
          customerPhone: cleanPhone,
          customerSocial: cleanSocial,
          customerIdDoc: cleanIdDoc,
          seller,
          paymentStatus,
          paidAmount:
            paymentStatus === 'Pendiente' ? effectivePaidAmount : summaryTotal,
          paymentMethod: effectiveMethod,
          paymentSplits: paymentSplitsPayload,
          debtorName: cleanCustomer,
          deliveryDate: cleanDeliveryDate,
          clientOperationId: draftOpId,
        }),
      );

      if (!res.ok) {
        setFeedback({
          type: 'error',
          text: res.error ?? 'No se pudo registrar la venta.',
        });
        return;
      }

      setCart([]);
      setQuantity('1');
      setPaidAmountInput('0.00');
      setCustomerName('');
      setCustomerCity('');
      setCustomerPhone('');
      setCustomerSocial('');
      setCustomerIdDoc('');
      setDeliveryDate('');
      setCustomerSavedNotice(null);
      setCustomerDropdownOpen(false);
      setMixedSplits(INITIAL_MIXED_SPLITS);
      setDraftOpId(createDraftOpId());

      const invoiceTag = res.createdSale?.invoiceNumber
        ? `Factura ${res.createdSale.invoiceNumber} · `
        : '';
      const creditNote =
        paymentStatus === 'Pendiente'
          ? ` (Crédito CxC · Abono ${formatUSD(effectivePaidAmount)} · Resta ${formatUSD(
              round2(summaryTotal - effectivePaidAmount),
            )})`
          : '';
      const willSchedule =
        res.createdSale && shouldScheduleSaleCalendarEvent(res.createdSale);

      setLastCreatedSale(res.createdSale ?? null);
      setFeedback({
        type: 'success',
        text: `${invoiceTag}Venta registrada para ${cleanCustomer} (${summaryCount} ${
          summaryCount === 1 ? 'franela' : 'franelas'
        } · ${formatUSD(summaryTotal)} vía ${effectiveMethod})${creditNote}. Comprobante JPG listo.`,
        ...(willSchedule
          ? { calendarNotice: 'Agendando recordatorio en Google Calendar...' }
          : {}),
      });

      if (res.createdSale) {
        void openOrDownloadSaleReceipt(res.createdSale, false);
        if (shouldScheduleSaleCalendarEvent(res.createdSale)) {
          void scheduleSaleInCalendar(res.createdSale);
        }
      }
    } finally {
      setIsSubmittingSale(false);
    }
  };

  const handleRetryPendingCalendarSale = async () => {
    if (!pendingCalendarSale || !onConnectGoogleCalendar) return;
    const connected = await onConnectGoogleCalendar();
    if (connected) {
      await scheduleSaleInCalendar(pendingCalendarSale);
    }
  };

  const sortedSalesHistory = useMemo(() => {
    return [...state.sales].sort((a, b) => {
      const dateA = a.saleDate || a.createdAt.slice(0, 10);
      const dateB = b.saleDate || b.createdAt.slice(0, 10);
      const dateCmp = dateB.localeCompare(dateA);
      if (dateCmp !== 0) return dateCmp;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [state.sales]);

  const filteredSalesHistory = useMemo(() => {
    const q = invoiceSearch.trim();
    if (!q) return sortedSalesHistory;
    return sortedSalesHistory.filter((sale) =>
      doesSaleMatchSearchQuery(sale, q),
    );
  }, [invoiceSearch, sortedSalesHistory]);

  const filteredHistoryRevenue = useMemo(
    () =>
      round2(
        filteredSalesHistory
          .filter((s) => !s.voided)
          .reduce((sum, s) => sum + s.finalPrice, 0),
      ),
    [filteredSalesHistory],
  );

  const openConvertToCxcModal = (sale: SaleRecord) => {
    setHistoryFeedback(null);
    setCxcError(null);
    const initialName = sale.debtorName || sale.customerName || '';
    setCxcCustomerNameInput(isWalkInCustomerName(initialName) ? '' : initialName);
    setCxcTargetSale(sale);
  };

  const handleConfirmConvertToCxc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cxcTargetSale || !onConvertSaleToReceivable || isProcessingHistoryAction) {
      return;
    }
    setCxcError(null);
    setIsProcessingHistoryAction(true);
    try {
      const res = await Promise.resolve(
        onConvertSaleToReceivable({
          saleId: cxcTargetSale.id,
          customerName: cxcCustomerNameInput.trim(),
        }),
      );
      if (!res.ok) {
        setCxcError(res.error ?? 'No se pudo pasar la venta a CxC.');
        return;
      }
      const inv = cxcTargetSale.invoiceNumber || cxcTargetSale.id;
      setCxcTargetSale(null);
      setCxcCustomerNameInput('');
      setHistoryFeedback({
        type: 'success',
        text: `Factura ${inv} convertida a Crédito (CxC) para ${cxcCustomerNameInput.trim()}. Efectivo y capas revertidas; inventario FIFO intacto.`,
      });
    } finally {
      setIsProcessingHistoryAction(false);
    }
  };

  const openVoidSaleModal = (sale: SaleRecord) => {
    setHistoryFeedback(null);
    setVoidError(null);
    setVoidReasonInput('');
    setVoidTargetSale(sale);
  };

  const handleConfirmVoidSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTargetSale || !onVoidSale || isProcessingHistoryAction) {
      return;
    }
    setVoidError(null);
    setIsProcessingHistoryAction(true);
    try {
      const res = await Promise.resolve(
        onVoidSale({
          saleId: voidTargetSale.id,
          reason: voidReasonInput.trim() || undefined,
        }),
      );
      if (!res.ok) {
        setVoidError(res.error ?? 'No se pudo anular la venta.');
        return;
      }
      const inv = voidTargetSale.invoiceNumber || voidTargetSale.id;
      setVoidTargetSale(null);
      setVoidReasonInput('');
      setHistoryFeedback({
        type: 'success',
        text: `Factura ${inv} anulada correctamente. Unidades restauradas al inventario FIFO y cobro revertido en caja.`,
      });
    } finally {
      setIsProcessingHistoryAction(false);
    }
  };

  const linePreviewSubtotal = round2(
    Math.max(0, Math.floor(Number(quantity) || 0)) *
      Math.max(0, Number(unitPrice) || 0),
  );

  const bcvTotalEquivalent = round2(
    cartTotals.totalAmount * state.exchangeRates.bcv,
  );

  const pagoMovilMixedUsd = Math.max(
    0,
    round2(Number(mixedSplits['Pago Móvil / Bs']) || 0),
  );

  const isDiscountOpen =
    pricingMode === 'discount_pct' || pricingMode === 'discount_usd';

  return (
    <div className="space-y-6">
      {activeSection === 'registrar' ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Registrar Venta
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Selecciona franelas y tallas disponibles, configura pago Contado o Crédito (CxC) y genera tu factura .JPG al instante.
              </p>
            </div>
            {cart.length > 0 && (
              <div className="font-mono-num text-sm font-semibold text-blue-300">
                Carrito: {cartTotals.totalUnits} ud(s) · {formatUSD(cartTotals.totalAmount)}
              </div>
            )}
          </div>

          {calendarAuth &&
            onConnectGoogleCalendar &&
            onDisconnectGoogleCalendar && (
              <GoogleCalendarBanner
                variant="compact"
                authState={calendarAuth}
                onConnect={onConnectGoogleCalendar}
                onDisconnect={onDisconnectGoogleCalendar}
                contextText="Las ventas a crédito o con fecha de entrega se agendan como recordatorio automático en Google Calendar."
              />
            )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Columna Izquierda: Tarjetas Minimalistas + Carrito */}
            <div className="space-y-6 lg:col-span-7">
              <section
                aria-labelledby="add-item-heading"
                className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2
                    id="add-item-heading"
                    className="font-display text-lg font-semibold text-white"
                  >
                    1. Seleccionar Franela Disponible
                  </h2>
                  <span className="font-mono-num text-xs text-slate-400">
                    {groupedModelCards.length}{' '}
                    {groupedModelCards.length === 1 ? 'modelo' : 'modelos'}
                  </span>
                </div>

                {availableSkus.length === 0 ? (
                  <div className="mt-4 rounded-lg border border-slate-800 bg-[#080E1C] p-5 text-sm text-slate-300">
                    {cart.length > 0
                      ? 'Ya agregaste todo el stock disponible al carrito. Confirma la venta o retira algún ítem.'
                      : 'No hay inventario disponible en este momento. Registra una compra en Compras.'}
                  </div>
                ) : (
                  <form onSubmit={handleAddToCart} className="mt-4 space-y-4">
                    {/* Buscador */}
                    <div>
                      <label htmlFor="sale-model-search" className="sr-only">
                        Buscar modelo disponible
                      </label>
                      <div className="relative">
                        <Search
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          aria-hidden="true"
                        />
                        <input
                          id="sale-model-search"
                          data-testid="sale-model-search"
                          type="search"
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          placeholder="Buscar modelo, versión o talla..."
                          className="w-full min-h-[42px] rounded-lg border border-slate-700 bg-[#070D19] pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    {/* Filtros normalizados exactos por equipo */}
                    <div
                      role="group"
                      aria-label="Filtrar por equipo"
                      className="flex flex-wrap gap-2"
                    >
                      {teamFilterOptions.map((team) => {
                        const isActive = selectedTeamFilter === team;
                        return (
                          <button
                            key={team}
                            type="button"
                            data-testid={`team-filter-${team}`}
                            aria-pressed={isActive}
                            onClick={() => setSelectedTeamFilter(team)}
                            className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                              isActive
                                ? 'border-blue-500 bg-blue-600 text-white'
                                : 'border-slate-700/80 bg-[#080E1C] text-slate-300 hover:border-slate-600 hover:text-white'
                            }`}
                          >
                            {team}
                          </button>
                        );
                      })}
                    </div>

                    {/* Tarjetas minimalistas (SOLO 3 datos: Modelo/Versión+Tallas, Stock, Precio Venta USDT) */}
                    {groupedModelCards.length === 0 ? (
                      <div className="rounded-lg border border-slate-800 bg-[#080E1C] p-5 text-center text-xs text-slate-400">
                        No hay franelas disponibles en{' '}
                        <strong className="text-slate-200">
                          {selectedTeamFilter}
                        </strong>
                        {modelSearch.trim()
                          ? ` para "${modelSearch.trim()}"`
                          : ''}
                        .
                      </div>
                    ) : (
                      <div
                        data-testid="model-cards-grid"
                        className="grid max-h-[360px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2"
                      >
                        {groupedModelCards.map((group) => {
                          const selectedInGroup =
                            group.sizeItems.find(
                              (si) => si.item.id === effectiveSkuId,
                            ) ?? group.sizeItems[0];
                          const isGroupActive =
                            selectedInGroup.item.id === effectiveSkuId;

                          return (
                            <article
                              key={group.groupKey}
                              data-testid={`model-group-card-${group.groupKey}`}
                              className={`flex flex-col justify-between rounded-xl border p-4 transition-colors ${
                                isGroupActive
                                  ? 'border-blue-500 bg-blue-600/10'
                                  : 'border-slate-800 bg-[#080E1C] hover:border-slate-700'
                              }`}
                            >
                              {/* Dato 1: Nombre del modelo (y versión) + tallas clicables */}
                              <div>
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="text-sm font-semibold leading-snug text-white">
                                    {group.model}
                                  </h3>
                                  <span className="shrink-0 text-[11px] font-medium text-slate-400">
                                    {group.version}
                                  </span>
                                </div>

                                <div
                                  className="mt-3 flex flex-wrap gap-1.5"
                                  role="group"
                                  aria-label={`Tallas disponibles para ${group.model} ${group.version}`}
                                >
                                  {group.sizeItems.map(({ item }) => {
                                    const isSizeSelected =
                                      item.id === effectiveSkuId;
                                    return (
                                      <button
                                        key={item.id}
                                        type="button"
                                        data-testid={`model-card-${item.id}`}
                                        aria-pressed={isSizeSelected}
                                        onClick={() =>
                                          handleSelectModelCard(item.id)
                                        }
                                        className={`font-mono-num min-h-[32px] min-w-[38px] rounded-md border px-2 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                                          isSizeSelected
                                            ? 'border-blue-400 bg-blue-600 text-white'
                                            : 'border-slate-700 bg-[#070D19] text-slate-200 hover:border-slate-500 hover:text-white'
                                        }`}
                                      >
                                        {item.size}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Datos 2 y 3: Stock disponible y Precio de venta (USDT) */}
                              <div className="mt-3.5 flex items-baseline justify-between border-t border-slate-800/80 pt-2.5">
                                <span
                                  data-testid={`group-stock-${group.groupKey}`}
                                  className="font-mono-num text-xs text-slate-400"
                                >
                                  {selectedInGroup.availableStock} disp.
                                </span>
                                <span className="font-mono-num text-base font-bold text-blue-300">
                                  {formatUSD(selectedInGroup.item.salePrice)}
                                </span>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}

                    {/* Controles de cantidad y precio del ítem seleccionado */}
                    {activeSku && (
                      <>
                        <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-12">
                          <div className="sm:col-span-3">
                            <label
                              htmlFor="sale-qty"
                              className="block text-xs font-medium text-slate-300"
                            >
                              Cantidad * (Máx. {remainingForActiveSku})
                            </label>
                            <input
                              id="sale-qty"
                              data-testid="sale-qty"
                              type="number"
                              min="1"
                              max={remainingForActiveSku}
                              step="1"
                              required
                              value={quantity}
                              onChange={(e) => {
                                setQuantity(e.target.value);
                                setFeedback(null);
                              }}
                              className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          <div className="sm:col-span-9">
                            <div className="flex items-center justify-between gap-2">
                              <label
                                htmlFor="sale-unit-price"
                                className="block text-xs font-medium text-slate-300"
                              >
                                Precio unitario (USDT) *
                              </label>
                              <span className="font-mono-num text-[11px] text-slate-400">
                                {activeSku.model} ({activeSku.size}) · Lista:{' '}
                                {formatUSD(activeSku.salePrice)}
                                {currentDiscountLabel
                                  ? ` · ${currentDiscountLabel}`
                                  : ''}
                              </span>
                            </div>

                            <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:flex-nowrap">
                              <input
                                id="sale-unit-price"
                                data-testid="sale-unit-price"
                                type="number"
                                step="0.01"
                                min="0.01"
                                required
                                value={unitPrice}
                                onChange={(e) => {
                                  setUnitPrice(e.target.value);
                                  setPricingMode('manual');
                                  setFeedback(null);
                                }}
                                className="font-mono-num min-h-[44px] w-full sm:w-32 rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />

                              <button
                                type="button"
                                data-testid="btn-wholesale"
                                onClick={handleToggleWholesale}
                                aria-pressed={pricingMode === 'wholesale'}
                                className={`inline-flex min-h-[44px] flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                                  pricingMode === 'wholesale'
                                    ? 'border-blue-500 bg-blue-600/25 text-white'
                                    : 'border-slate-700 bg-[#080E1C] text-slate-300 hover:bg-slate-800 hover:text-white'
                                }`}
                              >
                                <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                Al Mayor (-{WHOLESALE_DISCOUNT_PCT}%)
                              </button>

                              <button
                                type="button"
                                data-testid="btn-discount"
                                onClick={handleToggleCustomDiscount}
                                aria-pressed={isDiscountOpen}
                                className={`inline-flex min-h-[44px] flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                                  isDiscountOpen
                                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                                    : 'border-slate-700 bg-[#080E1C] text-slate-300 hover:bg-slate-800 hover:text-white'
                                }`}
                              >
                                <Percent
                                  className="h-3.5 w-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                Descuento
                              </button>
                            </div>
                          </div>
                        </div>

                        {isDiscountOpen && (
                          <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-[#080E1C] p-3.5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-300">
                                Tipo de rebaja:
                              </span>
                              <div className="inline-flex rounded-lg border border-slate-700 bg-[#070D19] p-0.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDiscountType('usd');
                                    handleDiscountAmountChange(
                                      discountAmountInput,
                                      'usd',
                                    );
                                  }}
                                  className={`min-h-[34px] rounded-md px-2.5 text-xs font-semibold transition-colors ${
                                    discountType === 'usd'
                                      ? 'bg-blue-600 text-white'
                                      : 'text-slate-400 hover:text-white'
                                  }`}
                                >
                                  Monto (USDT)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDiscountType('pct');
                                    handleDiscountAmountChange(
                                      discountAmountInput,
                                      'pct',
                                    );
                                  }}
                                  className={`min-h-[34px] rounded-md px-2.5 text-xs font-semibold transition-colors ${
                                    discountType === 'pct'
                                      ? 'bg-blue-600 text-white'
                                      : 'text-slate-400 hover:text-white'
                                  }`}
                                >
                                  Porcentaje (%)
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <label
                                htmlFor="sale-discount-value"
                                className="text-xs text-slate-400 whitespace-nowrap"
                              >
                                {discountType === 'pct'
                                  ? 'Descuento (%):'
                                  : 'Rebaja ($):'}
                              </label>
                              <input
                                id="sale-discount-value"
                                type="number"
                                min="0"
                                max={discountType === 'pct' ? '99' : undefined}
                                step="0.01"
                                value={discountAmountInput}
                                onChange={(e) =>
                                  handleDiscountAmountChange(e.target.value)
                                }
                                className="font-mono-num min-h-[40px] w-28 rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-right text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs text-slate-400">
                            Subtotal del ítem:{' '}
                            <strong className="font-mono-num text-sm text-white">
                              {formatUSD(linePreviewSubtotal)}
                            </strong>
                            <span className="ml-2 font-mono-num text-slate-400">
                              · {formatVES(linePreviewSubtotal * state.exchangeRates.bcv)}{' '}
                              BCV
                            </span>
                          </p>

                          <button
                            type="submit"
                            data-testid="btn-add-to-cart"
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-600/20 px-4 py-2 text-sm font-semibold text-blue-200 transition-colors hover:bg-blue-600/30 hover:text-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 whitespace-nowrap shrink-0"
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            Agregar al Carrito
                          </button>
                        </div>
                      </>
                    )}
                  </form>
                )}
              </section>

              {/* Carrito limpio */}
              <section
                aria-labelledby="cart-items-heading"
                className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2
                    id="cart-items-heading"
                    className="font-display text-lg font-semibold text-white"
                  >
                    2. Ítems de la Venta
                  </h2>
                  <span
                    data-testid="cart-count"
                    className="font-mono-num text-xs text-slate-300"
                  >
                    {cart.length} {cart.length === 1 ? 'línea' : 'líneas'} ·{' '}
                    {cartTotals.totalUnits}{' '}
                    {cartTotals.totalUnits === 1 ? 'unidad' : 'unidades'}
                  </span>
                </div>

                {cart.length === 0 ? (
                  <div className="mt-4 rounded-lg border border-dashed border-slate-700/80 bg-[#080E1C] p-6 text-center">
                    <p className="text-sm font-medium text-slate-300">
                      El carrito está vacío
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Elige una franela y talla arriba, y presiona &ldquo;Agregar al Carrito&rdquo;.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4">
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-800 text-xs font-medium text-slate-400">
                          <tr>
                            <th scope="col" className="pb-2.5">
                              Franela / Talla
                            </th>
                            <th scope="col" className="pb-2.5 text-right">
                              Cant.
                            </th>
                            <th scope="col" className="pb-2.5 text-right">
                              Precio Unit.
                            </th>
                            <th scope="col" className="pb-2.5 text-right">
                              Subtotal
                            </th>
                            <th scope="col" className="pb-2.5 text-right">
                              Acción
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {cart.map((line) => (
                            <tr key={line.lineId}>
                              <td className="py-3 pr-3">
                                <p className="font-medium text-white">
                                  {line.modelLabel}
                                </p>
                                <p className="text-xs text-slate-400">
                                  {normalizeVersionDisplay(line.version)} · Talla{' '}
                                  {line.size}
                                  {line.discountLabel ? (
                                    <span className="text-emerald-400">
                                      {' '}
                                      · {line.discountLabel}
                                    </span>
                                  ) : null}
                                </p>
                              </td>
                              <td className="py-3 text-right font-mono-num font-semibold text-white">
                                {line.quantity}
                              </td>
                              <td className="py-3 text-right font-mono-num text-slate-300">
                                {formatUSD(line.unitPrice)}
                              </td>
                              <td className="py-3 text-right font-mono-num font-bold text-white">
                                {formatUSD(line.subtotal)}
                              </td>
                              <td className="py-3 pl-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCartLine(line.lineId)}
                                  aria-label={`Eliminar ${line.modelLabel} ${line.version} talla ${line.size}`}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  Quitar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="divide-y divide-slate-800/80 sm:hidden">
                      {cart.map((line) => (
                        <div
                          key={line.lineId}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {line.quantity}x {line.modelLabel}
                            </p>
                            <p className="text-xs text-slate-400">
                              {normalizeVersionDisplay(line.version)} · Talla{' '}
                              {line.size} ·{' '}
                              <span className="font-mono-num">
                                {formatUSD(line.unitPrice)} c/u
                              </span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="font-mono-num text-sm font-bold text-white">
                              {formatUSD(line.subtotal)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCartLine(line.lineId)}
                              aria-label={`Eliminar ${line.modelLabel} ${line.version} talla ${line.size}`}
                              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3.5">
                      <span className="text-xs font-medium text-slate-400">
                        Total de la venta ({cartTotals.totalUnits} uds)
                      </span>
                      <span
                        data-testid="cart-total-amount"
                        className="font-mono-num text-xl font-bold text-white"
                      >
                        {formatUSD(cartTotals.totalAmount)}
                      </span>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Columna Derecha: Cierre de Venta con Campos Obligatorios y Opcionales */}
            <div className="space-y-6 lg:col-span-5">
              <section
                aria-labelledby="global-sale-heading"
                className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6"
              >
                <h2
                  id="global-sale-heading"
                  className="font-display text-lg font-semibold text-white"
                >
                  3. Cierre y Facturación
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Campos con <span className="text-blue-300">*</span> son obligatorios. Datos del cliente son opcionales.
                </p>

                <div className="mt-4 space-y-4">
                  {/* Fecha de Venta (Obligatorio, editable) & Vendedor (Obligatorio) */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="sale-date"
                        className="block text-xs font-medium text-slate-300"
                      >
                        Fecha de la venta *
                      </label>
                      <input
                        id="sale-date"
                        data-testid="sale-date"
                        type="date"
                        required
                        value={saleDate}
                        onChange={(e) => {
                          setSaleDate(e.target.value);
                          setFeedback(null);
                        }}
                        className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="sale-seller"
                        className="block text-xs font-medium text-slate-300"
                      >
                        Vendedor *
                      </label>
                      <select
                        id="sale-seller"
                        data-testid="sale-seller"
                        value={seller}
                        onChange={(e) => {
                          setSeller(e.target.value as SellerName);
                          setFeedback(null);
                        }}
                        className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {SELLERS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Condición de Pago & Monto Pagado */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="sale-status"
                        className="block text-xs font-medium text-slate-300"
                      >
                        Condición de Pago *
                      </label>
                      <select
                        id="sale-status"
                        data-testid="sale-status"
                        value={paymentStatus}
                        onChange={(e) => {
                          const nextStatus = e.target.value as PaymentStatus;
                          setPaymentStatus(nextStatus);
                          if (nextStatus === 'Cobrado') {
                            setPaidAmountInput(
                              cartTotals.totalAmount.toFixed(2),
                            );
                          } else {
                            setPaidAmountInput('0.00');
                            if (paymentMethod === 'Pago Mixto') {
                              setPaymentMethod('Efectivo ($)');
                            }
                          }
                          setFeedback(null);
                        }}
                        className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="Cobrado">Contado</option>
                        <option value="Pendiente">Crédito (CxC)</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <label
                          htmlFor="sale-paid-amount"
                          className="block text-xs font-medium text-slate-300"
                        >
                          Monto pagado (USDT) *
                        </label>
                        <span className="font-mono-num text-[11px] text-slate-400">
                          {paymentStatus === 'Cobrado'
                            ? '100% Contado'
                            : 'Abono inicial'}
                        </span>
                      </div>
                      <input
                        id="sale-paid-amount"
                        data-testid="sale-paid-amount"
                        type="number"
                        step="0.01"
                        min="0"
                        max={
                          paymentStatus === 'Pendiente'
                            ? Math.max(0, cartTotals.totalAmount - 0.01)
                            : undefined
                        }
                        readOnly={paymentStatus === 'Cobrado'}
                        value={
                          paymentStatus === 'Cobrado'
                            ? cartTotals.totalAmount.toFixed(2)
                            : paidAmountInput
                        }
                        onChange={(e) => {
                          setPaidAmountInput(e.target.value);
                          setFeedback(null);
                        }}
                        className={`font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                          paymentStatus === 'Cobrado'
                            ? 'border-slate-800 bg-[#080E1C] text-emerald-300 cursor-not-allowed'
                            : 'border-slate-700 bg-[#070D19] text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Resumen de Monto Total vs Saldo CxC si es Crédito */}
                  <div className="rounded-lg border border-slate-800 bg-[#080E1C] px-3.5 py-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Monto Total:</span>
                      <strong className="font-mono-num text-sm text-white">
                        {formatUSD(cartTotals.totalAmount)} USDT
                      </strong>
                    </div>
                    {paymentStatus === 'Pendiente' && (
                      <div className="mt-1.5 flex items-center justify-between border-t border-slate-800/80 pt-1.5">
                        <span className="text-amber-300">
                          Deuda pendiente a CxC:
                        </span>
                        <strong
                          data-testid="sale-credit-pending"
                          className="font-mono-num text-sm text-amber-300"
                        >
                          {formatUSD(pendingCreditBalance)} USDT
                        </strong>
                      </div>
                    )}
                  </div>

                  {/* Método de Pago */}
                  <div>
                    <label
                      htmlFor="sale-payment-method"
                      className="block text-xs font-medium text-slate-300"
                    >
                      Método de Pago *
                    </label>
                    <select
                      id="sale-payment-method"
                      data-testid="sale-payment-method"
                      value={paymentMethod}
                      onChange={(e) => {
                        setPaymentMethod(e.target.value as PaymentMethod);
                        setFeedback(null);
                      }}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {(paymentStatus === 'Pendiente'
                        ? SINGLE_PAYMENT_METHODS
                        : ALL_PAYMENT_METHODS
                      ).map((pm) => (
                        <option key={pm} value={pm}>
                          {pm}
                        </option>
                      ))}
                    </select>
                  </div>

                  {paymentMethod === 'Pago Móvil / Bs' && (
                    <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3.5 py-2.5 text-xs">
                      <div className="flex items-center justify-between text-blue-200">
                        <span>
                          Referencia BCV ({state.exchangeRates.bcv.toFixed(2)}{' '}
                          Bs/$):
                        </span>
                        <strong
                          data-testid="sale-bcv-conversion"
                          className="font-mono-num text-sm text-white"
                        >
                          {formatVES(bcvTotalEquivalent)}
                        </strong>
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'Pago Mixto' &&
                    paymentStatus === 'Cobrado' && (
                      <div className="space-y-3 rounded-lg border border-slate-700 bg-[#080E1C] p-3.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-white">
                            Desglose Pago Mixto (USDT)
                          </span>
                          <span
                            className={`font-mono-num font-semibold ${
                              Math.abs(mixedRemaining) <= 0.01 &&
                              cartTotals.totalAmount > 0
                                ? 'text-emerald-400'
                                : 'text-amber-300'
                            }`}
                          >
                            Restante: {formatUSD(mixedRemaining)}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {SINGLE_PAYMENT_METHODS.map((method) => (
                            <div key={method}>
                              <label
                                htmlFor={`split-${method}`}
                                className="block text-[11px] font-medium text-slate-300"
                              >
                                {method}
                              </label>
                              <input
                                id={`split-${method}`}
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={mixedSplits[method]}
                                onChange={(e) => {
                                  setMixedSplits((prev) => ({
                                    ...prev,
                                    [method]: e.target.value,
                                  }));
                                  setFeedback(null);
                                }}
                                className="font-mono-num mt-1 w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          ))}
                        </div>

                        {pagoMovilMixedUsd > 0 && (
                          <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-blue-200">
                            <span>Equivalente Pago Móvil BCV:</span>
                            <strong
                              data-testid="mixed-bcv-conversion"
                              className="font-mono-num text-white"
                            >
                              {formatVES(
                                pagoMovilMixedUsd * state.exchangeRates.bcv,
                              )}
                            </strong>
                          </div>
                        )}
                      </div>
                    )}

                  {/* Bloque de Datos Opcionales del Cliente */}
                  <div
                    ref={customerBoxRef}
                    className="space-y-3 rounded-xl border border-slate-800 bg-[#080E1C] p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor="sale-customer-name"
                        className="text-xs font-semibold text-slate-200"
                      >
                        Cliente (opcional)
                      </label>

                      {customerStatus.status === 'frequent' ? (
                        <span
                          data-testid="customer-status-badge"
                          data-status="frequent"
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300"
                        >
                          <Star
                            className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0"
                            aria-hidden="true"
                          />
                          Frecuente ({customerStatus.purchaseCount})
                        </span>
                      ) : customerStatus.status === 'new' ? (
                        <span
                          data-testid="customer-status-badge"
                          data-status="new"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300"
                        >
                          Cliente Nuevo
                        </span>
                      ) : (
                        <span
                          data-testid="customer-status-badge"
                          data-status="anonymous"
                          className="text-[11px] text-slate-400"
                        >
                          Cliente Mostrador
                        </span>
                      )}
                    </div>

                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        id="sale-customer-name"
                        data-testid="sale-customer-name"
                        type="text"
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={
                          customerDropdownOpen && customerSuggestions.length > 0
                        }
                        aria-controls="customer-autocomplete-listbox"
                        placeholder="Nombre del cliente (opcional)..."
                        value={customerName}
                        onFocus={() => setCustomerDropdownOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setCustomerDropdownOpen(false);
                          }
                        }}
                        onChange={(e) => {
                          setCustomerName(e.target.value);
                          setCustomerDropdownOpen(true);
                          setCustomerSavedNotice(null);
                          setFeedback(null);
                        }}
                        className="w-full min-h-[42px] rounded-lg border border-slate-700 bg-[#070D19] pl-9 pr-9 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {(customerName ||
                        customerPhone ||
                        customerCity ||
                        customerSocial ||
                        customerIdDoc) && (
                        <button
                          type="button"
                          onClick={handleClearCustomerFields}
                          aria-label="Limpiar datos del cliente"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}

                      {customerDropdownOpen &&
                        customerSuggestions.length > 0 && (
                          <ul
                            id="customer-autocomplete-listbox"
                            role="listbox"
                            aria-label="Clientes sugeridos del historial"
                            data-testid="customer-autocomplete-list"
                            className="absolute left-0 right-0 top-[46px] z-40 max-h-56 divide-y divide-slate-800/80 overflow-y-auto rounded-xl border border-slate-700 bg-[#0D1526] shadow-2xl"
                          >
                            {customerSuggestions.map((cust) => (
                              <li key={cust.key}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={false}
                                  data-testid={`customer-option-${cust.key}`}
                                  onClick={() =>
                                    handleSelectCustomerSuggestion(cust)
                                  }
                                  className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-blue-600/15"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-white">
                                      {cust.name}
                                    </p>
                                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                      {[cust.phone, cust.city, cust.social]
                                        .filter(Boolean)
                                        .join(' · ') || 'Sin datos de contacto'}
                                    </p>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    {cust.purchaseCount > 0 ? (
                                      <span className="font-mono-num text-[11px] font-semibold text-amber-300">
                                        {cust.purchaseCount} comp. ·{' '}
                                        {formatUSD(cust.totalSpentUsd)}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] font-semibold text-emerald-300">
                                        Ficha nueva
                                      </span>
                                    )}
                                  </div>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>

                    {customerStatus.status === 'frequent' &&
                      customerStatus.matchedCustomer && (
                        <div
                          data-testid="customer-history-card"
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 font-semibold">
                              <History
                                className="h-3.5 w-3.5 text-amber-300"
                                aria-hidden="true"
                              />
                              {customerStatus.matchedCustomer.name}
                            </span>
                            <span className="font-mono-num font-bold text-amber-300">
                              {formatUSD(customerStatus.totalSpentUsd)} (
                              {customerStatus.purchaseCount} compras)
                            </span>
                          </div>
                        </div>
                      )}

                    {customerStatus.status === 'frequent' &&
                      customerStatus.matchedCustomer &&
                      customerName.trim().toLowerCase() !==
                        customerStatus.matchedCustomer.name.toLowerCase() && (
                        <button
                          type="button"
                          onClick={() =>
                            handleSelectCustomerSuggestion(
                              customerStatus.matchedCustomer!,
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/25"
                        >
                          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Autocompletar ficha de{' '}
                          {customerStatus.matchedCustomer.name}
                        </button>
                      )}

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="sale-customer-city"
                          className="block text-[11px] font-medium text-slate-300"
                        >
                          Ciudad / Ubicación (opcional)
                        </label>
                        <input
                          id="sale-customer-city"
                          data-testid="sale-customer-city"
                          type="text"
                          placeholder="Ej. Guacara / Valencia"
                          value={customerCity}
                          onChange={(e) => {
                            setCustomerCity(e.target.value);
                            setCustomerSavedNotice(null);
                          }}
                          className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="sale-customer-phone"
                          className="block text-[11px] font-medium text-slate-300"
                        >
                          Teléfono (opcional)
                        </label>
                        <input
                          id="sale-customer-phone"
                          data-testid="sale-customer-phone"
                          type="tel"
                          placeholder="Ej. 0414-1234567"
                          value={customerPhone}
                          onChange={(e) => {
                            setCustomerPhone(e.target.value);
                            setCustomerSavedNotice(null);
                          }}
                          className="font-mono-num mt-1 w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          setShowExtraCustomerFields((prev) => !prev)
                        }
                        className="text-[11px] font-medium text-slate-400 hover:text-slate-200"
                      >
                        {showExtraCustomerFields
                          ? 'Ocultar datos adicionales'
                          : '+ Red social, cédula o fecha de entrega'}
                      </button>

                      {customerStatus.status === 'new' &&
                        onSaveCustomerProfile && (
                          <button
                            type="button"
                            data-testid="btn-save-new-customer"
                            onClick={handleSaveNewCustomerInline}
                            className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                          >
                            <UserPlus className="h-3 w-3" aria-hidden="true" />
                            Guardar ficha
                          </button>
                        )}
                    </div>

                    {showExtraCustomerFields && (
                      <div className="grid grid-cols-1 gap-2.5 border-t border-slate-800/80 pt-2.5 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="sale-customer-social"
                            className="block text-[11px] font-medium text-slate-300"
                          >
                            Red Social (IG / TikTok)
                          </label>
                          <input
                            id="sale-customer-social"
                            data-testid="sale-customer-social"
                            type="text"
                            placeholder="@usuario"
                            value={customerSocial}
                            onChange={(e) => {
                              setCustomerSocial(e.target.value);
                              setCustomerSavedNotice(null);
                            }}
                            className="mt-1 w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="sale-customer-iddoc"
                            className="block text-[11px] font-medium text-slate-300"
                          >
                            Cédula / RIF
                          </label>
                          <input
                            id="sale-customer-iddoc"
                            data-testid="sale-customer-iddoc"
                            type="text"
                            placeholder="V-25.123.456"
                            value={customerIdDoc}
                            onChange={(e) => {
                              setCustomerIdDoc(e.target.value);
                              setCustomerSavedNotice(null);
                            }}
                            className="font-mono-num mt-1 w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label
                            htmlFor="sale-delivery-date"
                            className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300"
                          >
                            <Calendar
                              className="h-3.5 w-3.5 text-blue-400"
                              aria-hidden="true"
                            />
                            Fecha de entrega / recordatorio (Google Calendar)
                          </label>
                          <input
                            id="sale-delivery-date"
                            data-testid="sale-delivery-date"
                            type="date"
                            value={deliveryDate}
                            onChange={(e) => {
                              setDeliveryDate(e.target.value);
                              setFeedback(null);
                            }}
                            className="font-mono-num mt-1 w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    )}

                    {customerSavedNotice && (
                      <p
                        role="status"
                        data-testid="customer-saved-notice"
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300"
                      >
                        {customerSavedNotice}
                      </p>
                    )}
                  </div>

                  {feedback && (
                    <div
                      role="status"
                      data-testid="sales-feedback"
                      className={`flex flex-col gap-2 rounded-lg px-3.5 py-2.5 text-xs font-medium ${
                        feedback.type === 'error'
                          ? 'border border-red-500/30 bg-red-500/10 text-red-300'
                          : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {feedback.type === 'success' && (
                          <CheckCircle2
                            className="mt-0.5 h-4 w-4 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span>{feedback.text}</span>
                      </div>

                      {feedback.type === 'success' && lastCreatedSale && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            data-testid="btn-reopen-last-receipt"
                            onClick={() =>
                              void openOrDownloadSaleReceipt(
                                lastCreatedSale,
                                false,
                              )
                            }
                            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25"
                          >
                            <FileImage className="h-3.5 w-3.5" aria-hidden="true" />
                            Ver / Descargar Factura JPG (
                            {lastCreatedSale.invoiceNumber})
                          </button>
                        </div>
                      )}

                      {feedback.calendarNotice && (
                        <div className="flex flex-wrap items-center gap-2 border-t border-emerald-500/20 pt-2 text-[11px] text-blue-200">
                          <Calendar
                            className="h-3.5 w-3.5 shrink-0 text-blue-300"
                            aria-hidden="true"
                          />
                          <span data-testid="sale-calendar-status">
                            {feedback.calendarNotice}
                          </span>
                          {feedback.calendarLink && (
                            <a
                              href={feedback.calendarLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-blue-400/40 bg-blue-500/15 px-2 py-0.5 font-semibold text-blue-200 hover:bg-blue-500/25"
                            >
                              Ver recordatorio
                              <ExternalLink
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                            </a>
                          )}
                          {feedback.needsCalendarAuth &&
                            pendingCalendarSale &&
                            onConnectGoogleCalendar && (
                              <button
                                type="button"
                                data-testid="btn-retry-sale-calendar"
                                onClick={() =>
                                  void handleRetryPendingCalendarSale()
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-blue-400/50 bg-blue-600/25 px-2.5 py-1 font-semibold text-white hover:bg-blue-600/40"
                              >
                                Conectar Google y Agendar
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    data-testid="btn-confirm-total-sale"
                    onClick={() => void handleConfirmTotalSale()}
                    disabled={cart.length === 0 || isSubmittingSale}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    {isSubmittingSale ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Registrando en Firebase...
                      </>
                    ) : (
                      <>
                        <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                        Confirmar Venta y Factura JPG
                      </>
                    )}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </>
      ) : (
        /* Sub-módulo dedicado: Historial de Ventas */
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Historial de Ventas
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Busca al instante por N° de factura (#0001), modelo, jugador (ej. Bellingham, Yamal), precio, cliente o vendedor y descarga cualquier factura JPG.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="font-mono-num text-slate-300">
                {filteredSalesHistory.length}{' '}
                {filteredSalesHistory.length === 1 ? 'venta' : 'ventas'}
              </span>
              <span className="font-mono-num font-bold text-blue-300">
                Total: {formatUSD(filteredHistoryRevenue)} USDT
              </span>
            </div>
          </div>

          <section
            aria-labelledby="recent-sales-heading"
            className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 overflow-hidden"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2
                id="recent-sales-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Registro Cronológico de Facturas
              </h2>

              <div className="relative w-full sm:w-96">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  data-testid="sales-invoice-search"
                  aria-label="Buscar ventas por factura, modelo, jugador, precio o cliente"
                  placeholder="Buscar #0001, Real Madrid, Bellingham, 30, cliente..."
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  className="w-full min-h-[42px] rounded-lg border border-slate-700 bg-[#070D19] pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {historyFeedback && (
              <div
                role="status"
                className={`mt-4 flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-xs font-medium ${
                  historyFeedback.type === 'error'
                    ? 'border border-red-500/30 bg-red-500/10 text-red-200'
                    : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                }`}
              >
                <span>{historyFeedback.text}</span>
                <button
                  type="button"
                  onClick={() => setHistoryFeedback(null)}
                  className="text-xs opacity-70 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            )}

            {state.sales.length === 0 ? (
              <p className="mt-6 text-sm text-slate-400">
                Aún no hay ventas registradas. Registra la primera desde Ventas &gt; Registrar Venta.
              </p>
            ) : filteredSalesHistory.length === 0 ? (
              <p className="mt-6 text-sm text-slate-400">
                No se encontraron ventas que coincidan con &ldquo;{invoiceSearch}&rdquo;.
              </p>
            ) : (
              <>
                <div className="mt-4 hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-800 bg-[#080E1C] text-xs font-medium text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Factura / Fecha</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Vendedor</th>
                        <th className="px-4 py-3">Prendas</th>
                        <th className="px-4 py-3">Método</th>
                        <th className="px-4 py-3 text-right">Total (USDT)</th>
                        <th className="px-4 py-3 text-right">Condición</th>
                        <th className="px-4 py-3 text-right">Acciones / Comprobante</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {filteredSalesHistory.map((sale) => {
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
                                  totalLineCogs: round2(
                                    sale.unitCogs * sale.quantity,
                                  ),
                                  unitPrice: round2(
                                    sale.finalPrice / Math.max(1, sale.quantity),
                                  ),
                                  subtotal: sale.finalPrice,
                                },
                              ];
                        const paidAtSale =
                          sale.paidAmount !== undefined
                            ? sale.paidAmount
                            : sale.paymentStatus === 'Cobrado'
                              ? round2(Math.max(0, sale.finalPrice - (sale.returnedAmount ?? 0)))
                              : 0;
                        const pendingCredit =
                          sale.paymentStatus === 'Pendiente'
                            ? round2(
                                Math.max(
                                  0,
                                  sale.finalPrice -
                                    (sale.returnedAmount ?? 0) -
                                    paidAtSale,
                                ),
                              )
                            : 0;

                        const canConvertToCxc =
                          isAdmin &&
                          !sale.voided &&
                          sale.paymentStatus === 'Cobrado' &&
                          sale.returnStatus !== 'Total' &&
                          Boolean(onConvertSaleToReceivable);
                        const canVoidSale =
                          isAdmin && !sale.voided && Boolean(onVoidSale);

                        return (
                          <tr
                            key={sale.id}
                            data-testid={`sale-history-row-${sale.invoiceNumber || sale.id}`}
                            className={`align-top transition-colors ${
                              sale.voided
                                ? 'bg-red-950/15 opacity-65'
                                : 'hover:bg-slate-800/30'
                            }`}
                          >
                            <td className="px-4 py-3 font-mono-num text-xs whitespace-nowrap">
                              <span
                                className={`block font-bold ${
                                  sale.voided
                                    ? 'text-red-400 line-through'
                                    : 'text-blue-300'
                                }`}
                              >
                                {sale.invoiceNumber || '#0001'}
                              </span>
                              <span className="text-slate-400">
                                {formatDisplayDate(sale)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm whitespace-nowrap">
                              <span className="block font-semibold text-white">
                                {sale.customerName ||
                                  sale.debtorName ||
                                  'Cliente Mostrador'}
                              </span>
                              {(sale.customerCity || sale.customerPhone) && (
                                <span className="block text-[11px] text-slate-400">
                                  {[sale.customerCity, sale.customerPhone]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-200 whitespace-nowrap">
                              {sale.seller}
                            </td>
                            <td className="px-4 py-3">
                              <ul className="space-y-0.5 text-xs text-slate-300">
                                {lineItems.map((item, idx) => (
                                  <li key={`${sale.id}-${item.skuId}-${idx}`}>
                                    <strong className="text-white">
                                      {item.quantity}x
                                    </strong>{' '}
                                    {item.modelLabel} (
                                    {normalizeVersionDisplay(item.version)} ·{' '}
                                    {item.size}) —{' '}
                                    <span className="font-mono-num">
                                      {formatUSD(item.subtotal)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-200">
                              <span className="font-medium">
                                {sale.paymentMethod ?? 'Efectivo ($)'}
                              </span>
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono-num font-bold whitespace-nowrap ${
                                sale.voided
                                  ? 'text-slate-400 line-through'
                                  : 'text-white'
                              }`}
                            >
                              {formatUSD(sale.finalPrice)}
                            </td>
                            <td className="px-4 py-3 text-right text-xs font-semibold whitespace-nowrap">
                              {sale.voided ? (
                                <div className="text-red-400">
                                  <span className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-bold">
                                    Anulada
                                  </span>
                                  {sale.voidReason && (
                                    <span className="block mt-0.5 text-[10px] font-normal text-red-300 max-w-[140px] truncate ml-auto">
                                      {sale.voidReason}
                                    </span>
                                  )}
                                </div>
                              ) : sale.returnStatus === 'Total' ? (
                                <div className="text-rose-400">
                                  <span>Devuelto Total</span>
                                  {sale.returnedAmount ? (
                                    <span className="font-mono-num block text-[11px] font-normal text-rose-300">
                                      -{formatUSD(sale.returnedAmount)}
                                    </span>
                                  ) : null}
                                </div>
                              ) : sale.paymentStatus === 'Cobrado' ? (
                                <div className="text-emerald-400">
                                  <span>
                                    {sale.returnStatus === 'Parcial'
                                      ? 'Contado · Dev. Parcial'
                                      : 'Contado'}
                                  </span>
                                  {sale.returnStatus === 'Parcial' &&
                                  sale.returnedAmount ? (
                                    <span className="font-mono-num block text-[11px] font-normal text-amber-200">
                                      Pagado {formatUSD(paidAtSale)} · Dev.{' '}
                                      {formatUSD(sale.returnedAmount)}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="text-amber-400">
                                  <span>
                                    {sale.returnStatus === 'Parcial'
                                      ? 'Crédito CxC · Dev. Parcial'
                                      : 'Crédito CxC'}
                                  </span>
                                  <span className="font-mono-num block text-[11px] font-normal text-amber-200">
                                    Abono {formatUSD(paidAtSale)} · Resta{' '}
                                    {formatUSD(pendingCredit)}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  data-testid={`btn-receipt-jpg-${sale.invoiceNumber || sale.id}`}
                                  disabled={generatingReceiptId === sale.id}
                                  onClick={() =>
                                    void openOrDownloadSaleReceipt(sale, false)
                                  }
                                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#080E1C] px-2.5 py-1 text-xs font-semibold text-blue-200 transition-colors hover:border-blue-500/50 hover:bg-blue-600/20 hover:text-white"
                                >
                                  <FileImage
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  Factura JPG
                                </button>
                                {canConvertToCxc && (
                                  <button
                                    type="button"
                                    data-testid={`btn-sale-to-cxc-${sale.invoiceNumber || sale.id}`}
                                    onClick={() => openConvertToCxcModal(sale)}
                                    className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/20"
                                  >
                                    <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                                    Pasar a CxC
                                  </button>
                                )}
                                {canVoidSale && (
                                  <button
                                    type="button"
                                    data-testid={`btn-void-sale-${sale.invoiceNumber || sale.id}`}
                                    onClick={() => openVoidSaleModal(sale)}
                                    className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20"
                                  >
                                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                                    Anular
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 divide-y divide-slate-800/80 md:hidden">
                  {filteredSalesHistory.map((sale) => {
                    const canConvertToCxc =
                      isAdmin &&
                      !sale.voided &&
                      sale.paymentStatus === 'Cobrado' &&
                      sale.returnStatus !== 'Total' &&
                      Boolean(onConvertSaleToReceivable);
                    const canVoidSale =
                      isAdmin && !sale.voided && Boolean(onVoidSale);

                    return (
                      <div
                        key={sale.id}
                        className={`py-3.5 space-y-2 ${sale.voided ? 'opacity-65' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span
                              className={`font-mono-num text-xs font-bold ${
                                sale.voided
                                  ? 'text-red-400 line-through'
                                  : 'text-blue-300'
                              }`}
                            >
                              {sale.invoiceNumber || '#0001'} ·{' '}
                              {formatDisplayDate(sale)}
                            </span>
                            <span className="block text-sm font-semibold text-white">
                              {sale.customerName || 'Cliente Mostrador'} ·{' '}
                              {sale.seller}
                            </span>
                          </div>
                          <span
                            className={`font-mono-num text-sm font-bold ${
                              sale.voided ? 'text-slate-400 line-through' : 'text-white'
                            }`}
                          >
                            {formatUSD(sale.finalPrice)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300">
                          {(sale.items ?? [])
                            .map(
                              (i) =>
                                `${i.quantity}x ${i.modelLabel} (${normalizeVersionDisplay(
                                  i.version,
                                )} ${i.size})`,
                            )
                            .join(', ') || sale.modelLabel}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-slate-400">
                            {sale.paymentMethod ?? 'Efectivo ($)'} ·{' '}
                            <span
                              className={
                                sale.voided || sale.returnStatus === 'Total'
                                  ? 'text-rose-400 font-semibold'
                                  : sale.paymentStatus === 'Cobrado'
                                    ? 'text-emerald-400'
                                    : 'text-amber-400'
                              }
                            >
                              {sale.voided
                                ? 'Anulada'
                                : sale.returnStatus === 'Total'
                                  ? 'Devuelto Total'
                                  : sale.paymentStatus === 'Cobrado'
                                    ? sale.returnStatus === 'Parcial'
                                      ? 'Contado · Dev. Parcial'
                                      : 'Contado'
                                    : sale.returnStatus === 'Parcial'
                                      ? 'Crédito CxC · Dev. Parcial'
                                      : 'Crédito CxC'}
                            </span>
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                void openOrDownloadSaleReceipt(sale, false)
                              }
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-700 bg-[#080E1C] px-2.5 py-1 text-xs font-semibold text-blue-200"
                            >
                              <FileImage className="h-3.5 w-3.5" aria-hidden="true" />
                              Factura JPG
                            </button>
                            {canConvertToCxc && (
                              <button
                                type="button"
                                onClick={() => openConvertToCxcModal(sale)}
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200"
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                                Pasar a CxC
                              </button>
                            )}
                            {canVoidSale && (
                              <button
                                type="button"
                                onClick={() => openVoidSaleModal(sale)}
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300"
                              >
                                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                                Anular
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* Modal Previsualización y Descarga de Factura JPG */}
      {receiptPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="receipt-modal-title"
          data-testid="receipt-preview-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
        >
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0D1526] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <div>
                <h3
                  id="receipt-modal-title"
                  className="font-display text-base font-semibold text-white"
                >
                  Factura Digital {receiptPreview.sale.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-400">
                  Imagen .JPG sobre fondo blanco lista para compartir por WhatsApp.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceiptPreview(null)}
                aria-label="Cerrar comprobante"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#060B16] p-4 flex justify-center">
              <img
                src={receiptPreview.dataUrl}
                alt={`Factura digital ${receiptPreview.sale.invoiceNumber}`}
                className="max-h-[65vh] w-auto rounded-lg border border-slate-300 object-contain shadow-lg"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-800 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setReceiptPreview(null)}
                className="min-h-[40px] rounded-lg border border-slate-700 bg-[#080E1C] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Cerrar
              </button>
              <button
                type="button"
                data-testid="btn-download-receipt-jpg"
                onClick={() =>
                  downloadJpgDataUrl(
                    receiptPreview.dataUrl,
                    `${(receiptPreview.sale.invoiceNumber || receiptPreview.sale.id).replace(/^#/, 'Factura-')}.jpg`,
                  )
                }
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Descargar Factura JPG
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmación: Pasar Venta a CxC */}
      {cxcTargetSale && isAdmin && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cxc-convert-modal-title"
          data-testid="modal-convert-sale-cxc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
        >
          <form
            onSubmit={(e) => void handleConfirmConvertToCxc(e)}
            className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#0D1526] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3
                  id="cxc-convert-modal-title"
                  className="font-display text-base font-bold text-white"
                >
                  Pasar Factura {cxcTargetSale.invoiceNumber || cxcTargetSale.id} a CxC
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Convierte esta venta de Contado a Crédito manteniendo la deducción FIFO de inventario intacta.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCxcTargetSale(null)}
                aria-label="Cerrar"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3.5 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Monto de la venta:</span>
                <strong className="font-mono-num text-white">
                  {formatUSD(
                    round2(
                      Math.max(
                        0,
                        cxcTargetSale.finalPrice - (cxcTargetSale.returnedAmount ?? 0),
                      ),
                    ),
                  )}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Efectivo a revertir de caja:</span>
                <strong className="font-mono-num text-amber-300">
                  -
                  {formatUSD(
                    round2(
                      Math.max(
                        0,
                        cxcTargetSale.paidAmount !== undefined
                          ? cxcTargetSale.paidAmount
                          : cxcTargetSale.finalPrice -
                              (cxcTargetSale.returnedAmount ?? 0),
                      ),
                    ),
                  )}
                </strong>
              </div>
            </div>

            <div>
              <label
                htmlFor="cxc-debtor-name-input"
                className="block text-xs font-medium text-slate-300"
              >
                Nombre del Cliente / Deudor *
              </label>
              <input
                id="cxc-debtor-name-input"
                data-testid="input-cxc-customer-name"
                type="text"
                required
                value={cxcCustomerNameInput}
                onChange={(e) => {
                  setCxcCustomerNameInput(e.target.value);
                  setCxcError(null);
                }}
                placeholder="Ej. Carlos Pérez"
                className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {cxcError && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {cxcError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCxcTargetSale(null)}
                className="min-h-[40px] rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                data-testid="btn-confirm-convert-cxc"
                disabled={isProcessingHistoryAction}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Confirmar Pasar a CxC
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Confirmación: Anular Venta */}
      {voidTargetSale && isAdmin && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-sale-modal-title"
          data-testid="modal-void-sale"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
        >
          <form
            onSubmit={(e) => void handleConfirmVoidSale(e)}
            className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[#0D1526] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3
                  id="void-sale-modal-title"
                  className="font-display text-base font-bold text-white"
                >
                  Anular Factura {voidTargetSale.invoiceNumber || voidTargetSale.id}
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Restaurará las unidades vendidas al inventario FIFO, revertirá el efectivo cobrado y eliminará cualquier CxC vinculada.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVoidTargetSale(null)}
                aria-label="Cerrar"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3.5 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Cliente:</span>
                <strong className="text-white">
                  {voidTargetSale.customerName ||
                    voidTargetSale.debtorName ||
                    'Cliente Mostrador'}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Total facturado:</span>
                <strong className="font-mono-num text-white">
                  {formatUSD(voidTargetSale.finalPrice)}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Cobro a revertir en caja:</span>
                <strong className="font-mono-num text-red-300">
                  -
                  {formatUSD(
                    round2(
                      Math.max(
                        0,
                        voidTargetSale.paidAmount !== undefined
                          ? voidTargetSale.paidAmount
                          : voidTargetSale.paymentStatus === 'Cobrado'
                            ? voidTargetSale.finalPrice -
                              (voidTargetSale.returnedAmount ?? 0)
                            : 0,
                      ),
                    ),
                  )}
                </strong>
              </div>
            </div>

            <div>
              <label
                htmlFor="void-reason-input"
                className="block text-xs font-medium text-slate-300"
              >
                Motivo de la anulación (Opcional)
              </label>
              <input
                id="void-reason-input"
                data-testid="input-void-sale-reason"
                type="text"
                value={voidReasonInput}
                onChange={(e) => {
                  setVoidReasonInput(e.target.value);
                  setVoidError(null);
                }}
                placeholder="Ej. Pedido duplicado / Cliente canceló envío"
                className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>

            {voidError && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {voidError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setVoidTargetSale(null)}
                className="min-h-[40px] rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                data-testid="btn-confirm-void-sale"
                disabled={isProcessingHistoryAction}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Confirmar Anulación
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
