import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  PackageCheck,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { getDefaultSalePrice } from '../data/initialState';
import type {
  AlertThresholdsConfig,
  AppState,
  JerseySize,
  JerseyVersion,
  PurchaseBatchRecord,
  PurchaseFundingSource,
  PurchasePricingMode,
  ShippingType,
  TeamCategory,
} from '../types/erp';
import type {
  ReceiveImportBatchInput,
  RegisterImportBatchInput,
} from '../utils/finance';
import {
  ALL_JERSEY_SIZES,
  EXTRA_JERSEY_SIZE_PRESETS,
  calculateElapsedTransitDays,
  extractTeamFromModel,
  formatUSD,
  getTodayLocalDateIso,
  getTransitAlertStatus,
  getTransitCapitalSummary,
  round2,
  round4,
} from '../utils/finance';
import {
  buildPurchaseArrivalCalendarEvent,
  createGoogleCalendarEvent,
  shouldSchedulePurchaseCalendarEvent,
  type GoogleCalendarAuthState,
} from '../utils/googleCalendar';
import { GoogleCalendarBanner } from './GoogleCalendarBanner';
import {
  compressCatalogImageFile,
  normalizeCatalogImageUrl,
  normalizeCatalogModelKey,
  resolveCatalogPhoto,
} from '../utils/publicCatalog';

export interface PurchaseOperationOutcome {
  ok: boolean;
  error?: string;
  createdBatch?: PurchaseBatchRecord;
}

interface PurchasesViewProps {
  state: AppState;
  activeSection?: 'create' | 'transit';
  alertThresholds?: AlertThresholdsConfig;
  calendarAuth?: GoogleCalendarAuthState;
  onConnectGoogleCalendar?: () => Promise<boolean>;
  onDisconnectGoogleCalendar?: () => Promise<void>;
  onCalendarAuthExpired?: () => void;
  onAttachPurchaseCalendarMetadata?: (
    batchId: string,
    eventId: string,
    htmlLink?: string,
  ) => void;
  onSaveCatalogPhoto?: (modelKey: string, photoUrl: string) => void;
  onRegisterImportBatch: (
    input: RegisterImportBatchInput,
  ) => Promise<PurchaseOperationOutcome> | PurchaseOperationOutcome;
  onReceiveImportBatch: (
    input: ReceiveImportBatchInput,
  ) => Promise<PurchaseOperationOutcome> | PurchaseOperationOutcome;
}

interface DraftBatchLine {
  lineId: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  quantity: number;
  factoryUnitCost: number;
  salePrice: number;
}

type PurchasesSubView = 'all' | 'create' | 'transit' | 'history';
type PurchaseFlowType = 'transit' | 'direct';
type ModelEntryMode = 'existing' | 'new';

const VERSIONS: Array<'Player' | 'Retro' | 'Fans'> = ['Player', 'Retro', 'Fans'];
const SHIPPING_TYPES: ShippingType[] = ['Aéreo', 'Marítimo'];

function buildInitialSizeQuantities(sizes: JerseySize[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sz of sizes) {
    out[sz] = '0';
  }
  return out;
}

function generateOperationId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getFundingSourceLabel(source?: PurchaseFundingSource | ''): string {
  if (source === '') return 'origen de fondos por seleccionar';
  if (source === 'replacement') return 'Fondo de Reposición (Costo Base)';
  if (source === 'growthReinvestment') return 'Fondo de Reinversión';
  return 'Caja General';
}

function normalizeModelSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function PurchasesView({
  state,
  activeSection,
  alertThresholds,
  calendarAuth,
  onConnectGoogleCalendar,
  onDisconnectGoogleCalendar,
  onCalendarAuthExpired,
  onAttachPurchaseCalendarMetadata,
  onSaveCatalogPhoto,
  onRegisterImportBatch,
  onReceiveImportBatch,
}: PurchasesViewProps) {
  const todayStr = getTodayLocalDateIso();

  const [subView, setSubView] = useState<PurchasesSubView>(activeSection ?? 'all');

  useEffect(() => {
    if (activeSection) {
      setSubView(activeSection);
    }
  }, [activeSection]);

  const uniqueModelNames = useMemo(
    () =>
      Array.from(
        new Set(
          (state.inventory ?? [])
            .map((i) => i.model.trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [state.inventory],
  );

  // Etapa 1: Batch header fields
  const [flowType, setFlowType] = useState<PurchaseFlowType>('transit');
  const [entryDate, setEntryDate] = useState(todayStr);
  const [directReceivedDate, setDirectReceivedDate] = useState(todayStr);
  const [estimatedArrivalDate, setEstimatedArrivalDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [referenceName, setReferenceName] = useState('Aéreo Noviembre');
  const [shippingType, setShippingType] = useState<ShippingType>('Aéreo');
  const [totalFreightCost, setTotalFreightCost] = useState('15.00');
  const [batchUsdtRate, setBatchUsdtRate] = useState(
    state.exchangeRates.usdt.toFixed(2),
  );
  const [fundingSource, setFundingSource] = useState<PurchaseFundingSource | ''>(
    '',
  );

  useEffect(() => {
    setBatchUsdtRate(state.exchangeRates.usdt.toFixed(2));
  }, [state.exchangeRates.usdt]);

  // Etapa 1: Model builder & auto team detection
  const [modelEntryMode, setModelEntryMode] = useState<ModelEntryMode>(() =>
    uniqueModelNames.length > 0 ? 'existing' : 'new',
  );
  const [model, setModel] = useState('');
  const [isEditingTeam, setIsEditingTeam] = useState(false);
  const [manualTeamOverride, setManualTeamOverride] = useState<string | null>(null);
  const [version, setVersion] = useState<'Player' | 'Retro' | 'Fans'>('Fans');
  const [factoryUnitCost, setFactoryUnitCost] = useState('5.50');

  // Retail pricing mode (Modo A uniforme vs Modo B por ítem/talla)
  const [stage1PricingMode, setStage1PricingMode] =
    useState<PurchasePricingMode>('uniform');
  const [unitSalePrice, setUnitSalePrice] = useState('25.00');
  const [salePriceTouched, setSalePriceTouched] = useState(false);

  // Vertical matrix sizes (standard S..XXL + extra sizes)
  const [activeSizes, setActiveSizes] = useState<JerseySize[]>([
    ...ALL_JERSEY_SIZES,
  ]);
  const [sizeMatrix, setSizeMatrix] = useState<Record<string, string>>(() =>
    buildInitialSizeQuantities(ALL_JERSEY_SIZES),
  );
  const [sizeSalePrices, setSizeSalePrices] = useState<Record<string, string>>({});
  const [showExtraSizePicker, setShowExtraSizePicker] = useState(false);
  const [customSizeInput, setCustomSizeInput] = useState('');

  const [itemPhotoInput, setItemPhotoInput] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);

  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelComboboxRef = useRef<HTMLDivElement | null>(null);
  const existingModelSearchRef = useRef<HTMLInputElement | null>(null);
  const modelInputRef = useRef<HTMLInputElement | null>(null);

  const existingModelOptions = useMemo(() => {
    const versionsByModel = new Map<string, Set<JerseyVersion>>();
    for (const item of state.inventory ?? []) {
      const cleanName = item.model.trim();
      if (!cleanName) continue;
      const key = cleanName.toLowerCase();
      let set = versionsByModel.get(key);
      if (!set) {
        set = new Set<JerseyVersion>();
        versionsByModel.set(key, set);
      }
      set.add(item.version);
    }

    return uniqueModelNames.map((name) => {
      const detectedTeam = extractTeamFromModel(name);
      const versions = Array.from(
        versionsByModel.get(name.toLowerCase()) ?? [],
      );
      let rawPhoto: string | undefined;
      for (const ver of [...versions, ...VERSIONS]) {
        const candidate = resolveCatalogPhoto(name, ver, state.catalogPhotos);
        if (candidate) {
          rawPhoto = candidate;
          break;
        }
      }
      const thumbnailUrl = rawPhoto ? normalizeCatalogImageUrl(rawPhoto) : '';
      const searchableText = normalizeModelSearchText(
        [name, detectedTeam, ...versions].join(' '),
      );
      return {
        name,
        detectedTeam,
        versions,
        thumbnailUrl,
        searchableText,
      };
    });
  }, [state.catalogPhotos, state.inventory, uniqueModelNames]);

  const filteredExistingModelOptions = useMemo(() => {
    const normalizedQuery = normalizeModelSearchText(modelSearchQuery);
    const normalizedSelected = normalizeModelSearchText(model);
    if (!normalizedQuery || (normalizedSelected && normalizedQuery === normalizedSelected)) {
      return existingModelOptions;
    }
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    return existingModelOptions.filter((option) =>
      tokens.every((token) => option.searchableText.includes(token)),
    );
  }, [existingModelOptions, model, modelSearchQuery]);

  useEffect(() => {
    if (!isModelDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        modelComboboxRef.current &&
        !modelComboboxRef.current.contains(e.target as Node)
      ) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isModelDropdownOpen]);

  const autoDetectedTeam = useMemo(() => extractTeamFromModel(model), [model]);
  const effectiveTeam = useMemo(() => {
    if (manualTeamOverride !== null && manualTeamOverride.trim()) {
      return manualTeamOverride.trim();
    }
    return autoDetectedTeam;
  }, [autoDetectedTeam, manualTeamOverride]);

  const existingCatalogPhoto = useMemo(
    () =>
      model.trim()
        ? resolveCatalogPhoto(model, version, state.catalogPhotos)
        : undefined,
    [state.catalogPhotos, model, version],
  );

  const [draftItems, setDraftItems] = useState<DraftBatchLine[]>([]);
  const [pendingCalendarBatch, setPendingCalendarBatch] =
    useState<PurchaseBatchRecord | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    calendarNotice?: string;
    calendarLink?: string;
    needsCalendarAuth?: boolean;
  } | null>(null);

  // Duplicate prevention locks (Stage 1)
  const createLockRef = useRef(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  // Etapa 2: Modal state for receiving an EN TRÁNSITO batch
  const [receivingBatch, setReceivingBatch] =
    useState<PurchaseBatchRecord | null>(null);
  const [receiveDate, setReceiveDate] = useState(todayStr);
  const [actualFreightInput, setActualFreightInput] = useState('');
  const [receivedQtys, setReceivedQtys] = useState<Record<number, string>>({});
  const [stage2PricingMode, setStage2PricingMode] =
    useState<PurchasePricingMode>('uniform');
  const [stage2UniformSalePrice, setStage2UniformSalePrice] = useState('25.00');
  const [stage2ItemSalePrices, setStage2ItemSalePrices] = useState<
    Record<number, string>
  >({});
  const [receiveError, setReceiveError] = useState<string | null>(null);

  // Duplicate prevention locks (Stage 2)
  const receiveLockRef = useRef(false);
  const [isSubmittingReceive, setIsSubmittingReceive] = useState(false);

  useEffect(() => {
    if (!receivingBatch) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !receiveLockRef.current) {
        setReceivingBatch(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [receivingBatch]);

  const parsedFreight = Math.max(0, round2(Number(totalFreightCost) || 0));

  const batchSummary = useMemo(() => {
    const totalUnits = draftItems.reduce((sum, l) => sum + l.quantity, 0);
    const totalFactory = round2(
      draftItems.reduce((sum, l) => sum + l.quantity * l.factoryUnitCost, 0),
    );
    const freightPerUnit = totalUnits > 0 ? parsedFreight / totalUnits : 0;
    const totalLanded = round2(totalFactory + parsedFreight);
    return {
      totalUnits,
      totalFactory,
      freightPerUnit: round2(freightPerUnit),
      freightPerUnitExact: freightPerUnit,
      totalLanded,
    };
  }, [draftItems, parsedFreight]);

  const {
    transitBatches,
    receivedBatches,
    transitCount,
    transitUnits,
    transitCapital,
  } = useMemo(() => getTransitCapitalSummary(state), [state]);

  const replacementFundBalance = round2(Math.max(0, state.funds.replacement));
  const reinvestmentFundBalance = round2(
    Math.max(0, state.funds.growthReinvestment),
  );
  const combinedRepoReinvestmentBalance = round2(
    replacementFundBalance + reinvestmentFundBalance,
  );
  const primaryFundingBalance =
    fundingSource === 'replacement'
      ? replacementFundBalance
      : fundingSource === 'growthReinvestment'
        ? reinvestmentFundBalance
        : fundingSource === 'cashOnHand'
          ? state.cashOnHand
          : 0;
  const availableFundingBalance = state.cashOnHand;

  const matrixTotalUnits = useMemo(
    () =>
      activeSizes.reduce((sum, sz) => {
        const val = Math.max(0, Math.floor(Number(sizeMatrix[sz]) || 0));
        return sum + val;
      }, 0),
    [activeSizes, sizeMatrix],
  );

  const handleFlowTypeChange = (nextFlow: PurchaseFlowType) => {
    setFlowType(nextFlow);
    setFeedback(null);
    if (nextFlow === 'direct') {
      if (referenceName === 'Aéreo Noviembre') {
        setReferenceName(`Recepción Directa ${entryDate}`);
      }
      if (totalFreightCost === '15.00') {
        setTotalFreightCost('0.00');
      }
    } else {
      if (referenceName.startsWith('Recepción Directa')) {
        setReferenceName('Aéreo Noviembre');
      }
      if (totalFreightCost === '0.00') {
        setTotalFreightCost('15.00');
      }
    }
  };

  const handleSwitchToNewModel = () => {
    setModelEntryMode('new');
    setModel('');
    setModelSearchQuery('');
    setIsModelDropdownOpen(false);
    setManualTeamOverride(null);
    setIsEditingTeam(false);
    setFeedback(null);
    setTimeout(() => {
      modelInputRef.current?.focus();
    }, 10);
  };

  const handleSelectExistingModel = (selectedModelName: string) => {
    setModel(selectedModelName);
    setManualTeamOverride(null);
    setIsEditingTeam(false);
    setFeedback(null);

    if (selectedModelName.trim()) {
      const existingMatch = state.inventory.find(
        (i) =>
          i.model.trim().toLowerCase() === selectedModelName.trim().toLowerCase(),
      );
      if (existingMatch && !salePriceTouched && existingMatch.salePrice > 0) {
        setUnitSalePrice(existingMatch.salePrice.toFixed(2));
      }
    }
  };

  const handleVersionChange = (nextVer: 'Player' | 'Retro' | 'Fans') => {
    setVersion(nextVer);
    setFeedback(null);
    if (!salePriceTouched) {
      setUnitSalePrice(getDefaultSalePrice(nextVer, model).toFixed(2));
    }
  };

  const handleStage1PricingModeChange = (mode: PurchasePricingMode) => {
    setStage1PricingMode(mode);
    setFeedback(null);
    const uniformParsed = round2(Number(unitSalePrice) || 0);
    if (mode === 'uniform' && uniformParsed > 0 && draftItems.length > 0) {
      setDraftItems((prev) =>
        prev.map((line) => ({ ...line, salePrice: uniformParsed })),
      );
    } else if (mode === 'per-item') {
      const seeded: Record<string, string> = {};
      for (const sz of activeSizes) {
        seeded[sz] = sizeSalePrices[sz]?.trim() || unitSalePrice;
      }
      setSizeSalePrices(seeded);
    }
  };

  const handleUniformPriceChange = (rawVal: string) => {
    setUnitSalePrice(rawVal);
    setSalePriceTouched(true);
    setFeedback(null);
    const parsed = round2(Number(rawVal) || 0);
    if (stage1PricingMode === 'uniform' && parsed > 0 && draftItems.length > 0) {
      setDraftItems((prev) =>
        prev.map((line) => ({ ...line, salePrice: parsed })),
      );
    }
  };

  const handleAddExtraSize = (rawSize: string) => {
    const clean = rawSize.trim();
    if (!clean) return;
    const normalizedDisplay =
      clean.length <= 4 && /^[a-z0-9]+$/i.test(clean)
        ? clean.toUpperCase()
        : clean;

    const alreadyExists = activeSizes.some(
      (s) => s.toLowerCase() === normalizedDisplay.toLowerCase(),
    );
    if (!alreadyExists) {
      setActiveSizes((prev) => [...prev, normalizedDisplay]);
      setSizeMatrix((prev) => ({ ...prev, [normalizedDisplay]: '0' }));
      setSizeSalePrices((prev) => ({
        ...prev,
        [normalizedDisplay]: unitSalePrice,
      }));
    }
    setCustomSizeInput('');
    setShowExtraSizePicker(false);
    setFeedback(null);
  };

  const handleRemoveExtraSize = (szToRemove: JerseySize) => {
    if (ALL_JERSEY_SIZES.includes(szToRemove as (typeof ALL_JERSEY_SIZES)[number])) {
      return;
    }
    setActiveSizes((prev) => prev.filter((s) => s !== szToRemove));
    setSizeMatrix((prev) => {
      const copy = { ...prev };
      delete copy[szToRemove];
      return copy;
    });
    setSizeSalePrices((prev) => {
      const copy = { ...prev };
      delete copy[szToRemove];
      return copy;
    });
  };

  const handleAddLine = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const cleanModel = model.trim();
    if (!cleanModel) {
      setFeedback({
        type: 'error',
        text: 'Selecciona un modelo existente o escribe el nombre del nuevo modelo antes de agregar.',
      });
      return;
    }

    const fCost = round2(Number(factoryUnitCost) || 0);
    if (!Number.isFinite(fCost) || fCost <= 0) {
      setFeedback({
        type: 'error',
        text: 'El precio unitario de fábrica debe ser mayor a $0.00.',
      });
      return;
    }

    const defaultSalePrice = round2(Number(unitSalePrice) || 0);
    if (
      stage1PricingMode === 'uniform' &&
      (!Number.isFinite(defaultSalePrice) || defaultSalePrice <= 0)
    ) {
      setFeedback({
        type: 'error',
        text: 'El precio de venta unitario ($) para el lote debe ser mayor a $0.00.',
      });
      return;
    }

    const sizesToAdd = activeSizes
      .map((sz) => ({
        size: sz,
        qty: Math.max(0, Math.floor(Number(sizeMatrix[sz]) || 0)),
        rowPrice:
          stage1PricingMode === 'uniform'
            ? defaultSalePrice
            : round2(Number(sizeSalePrices[sz] ?? unitSalePrice) || 0),
      }))
      .filter((entry) => entry.qty > 0);

    if (sizesToAdd.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Ingresa al menos 1 unidad en la columna de tallas.',
      });
      return;
    }

    for (const entry of sizesToAdd) {
      if (!Number.isFinite(entry.rowPrice) || entry.rowPrice <= 0) {
        setFeedback({
          type: 'error',
          text: `Ingresa un precio de venta ($) válido mayor a $0.00 para la talla ${entry.size}.`,
        });
        return;
      }
    }

    const resolvedTeam = effectiveTeam || 'Otro';
    const stamp = Date.now();
    const newLines: DraftBatchLine[] = sizesToAdd.map((entry, idx) => ({
      lineId: `draft-${stamp}-${idx}-${entry.size}`,
      team: resolvedTeam,
      model: cleanModel,
      version,
      size: entry.size,
      quantity: entry.qty,
      factoryUnitCost: fCost,
      salePrice: entry.rowPrice,
    }));

    if (itemPhotoInput.trim() && onSaveCatalogPhoto) {
      const normalizedPhoto = normalizeCatalogImageUrl(itemPhotoInput);
      if (normalizedPhoto) {
        onSaveCatalogPhoto(
          normalizeCatalogModelKey(cleanModel, version),
          normalizedPhoto,
        );
      }
    }

    setDraftItems((prev) => [...prev, ...newLines]);
    setSizeMatrix(buildInitialSizeQuantities(activeSizes));
    setSalePriceTouched(false);
    setItemPhotoInput('');
  };

  const handlePurchasePhotoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoUploading(true);
    try {
      const dataUrl = await compressCatalogImageFile(file);
      setItemPhotoInput(dataUrl);
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo procesar la foto del modelo.',
      });
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemoveLine = (lineId: string) => {
    setDraftItems((prev) => prev.filter((l) => l.lineId !== lineId));
    setFeedback(null);
  };

  const handleUpdateDraftLinePrice = (lineId: string, rawPrice: string) => {
    const parsed = round2(Number(rawPrice) || 0);
    setDraftItems((prev) =>
      prev.map((line) =>
        line.lineId === lineId
          ? { ...line, salePrice: parsed > 0 ? parsed : 0 }
          : line,
      ),
    );
  };

  const schedulePurchaseInCalendar = async (batch: PurchaseBatchRecord) => {
    const calRes = await createGoogleCalendarEvent(
      buildPurchaseArrivalCalendarEvent(batch),
    );
    if (calRes.ok) {
      setPendingCalendarBatch(null);
      if (calRes.eventId) {
        onAttachPurchaseCalendarMetadata?.(
          batch.id,
          calRes.eventId,
          calRes.htmlLink,
        );
      }
      setFeedback((prev) =>
        prev
          ? {
              ...prev,
              calendarNotice: `Evento de llegada agendado en Google Calendar para el ${batch.estimatedArrivalDate}.`,
              calendarLink: calRes.htmlLink,
              needsCalendarAuth: false,
            }
          : {
              type: 'success',
              text: `Lote "${batch.referenceName}" sincronizado con Google Calendar.`,
              calendarNotice: `Evento de llegada agendado para el ${batch.estimatedArrivalDate}.`,
              calendarLink: calRes.htmlLink,
              needsCalendarAuth: false,
            },
      );
    } else if (calRes.needsAuth) {
      setPendingCalendarBatch(batch);
      onCalendarAuthExpired?.();
      setFeedback((prev) =>
        prev
          ? {
              ...prev,
              calendarNotice:
                'Conecta Google Calendar para agendar automáticamente la fecha estimada de llegada.',
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

  const handleSaveBatch = async () => {
    if (createLockRef.current) return;
    setFeedback(null);
    setPendingCalendarBatch(null);

    if (draftItems.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Agrega al menos un producto a la orden antes de confirmar.',
      });
      return;
    }

    if (!fundingSource) {
      setFeedback({
        type: 'error',
        text: 'Selecciona un origen de fondos antes de guardar el lote.',
      });
      return;
    }

    const invalidPriceLine = draftItems.find(
      (l) => !Number.isFinite(l.salePrice) || l.salePrice <= 0,
    );
    if (invalidPriceLine) {
      setFeedback({
        type: 'error',
        text: `Define un PVP mayor a $0.00 para ${invalidPriceLine.model} (${invalidPriceLine.size}).`,
      });
      return;
    }

    createLockRef.current = true;
    setIsSubmittingCreate(true);

    try {
      const cleanArrivalDate =
        flowType === 'transit' ? estimatedArrivalDate.trim() || undefined : undefined;
      const parsedBatchUsdt = round2(Number(batchUsdtRate) || 0);
      const clientOperationId = generateOperationId('op-purchase');

      const res = await Promise.resolve(
        onRegisterImportBatch({
          entryDate,
          ...(cleanArrivalDate ? { estimatedArrivalDate: cleanArrivalDate } : {}),
          ...(flowType === 'direct'
            ? { receivedDate: directReceivedDate || entryDate }
            : {}),
          supplier: supplier.trim() || undefined,
          referenceName,
          shippingType,
          totalFreightCost: parsedFreight,
          fundingSource,
          retailPricingMode: stage1PricingMode,
          isDirectReception: flowType === 'direct',
          clientOperationId,
          usdtRate:
            parsedBatchUsdt > 0 ? parsedBatchUsdt : state.exchangeRates.usdt,
          items: draftItems.map((l) => ({
            team: l.team,
            model: l.model,
            version: l.version,
            size: l.size,
            quantity: l.quantity,
            factoryUnitCost: l.factoryUnitCost,
            salePrice: l.salePrice,
          })),
        }),
      );

      if (!res.ok) {
        setFeedback({
          type: 'error',
          text: res.error ?? 'No se pudo registrar la compra.',
        });
        return;
      }

      const fundLabel = getFundingSourceLabel(fundingSource);

      const isDirect = flowType === 'direct';
      const willSchedule =
        !isDirect &&
        res.createdBatch &&
        shouldSchedulePurchaseCalendarEvent(res.createdBatch);

      setFeedback({
        type: 'success',
        text: isDirect
          ? `Recepción Directa "${referenceName.trim()}" (${batchSummary.totalUnits} uds) ingresada a bodega FIFO al instante (0 días en tránsito). Descontados ${formatUSD(batchSummary.totalLanded)} de ${fundLabel}.`
          : `Orden "${referenceName.trim()}" (${batchSummary.totalUnits} uds) guardada EN TRÁNSITO. Descontados ${formatUSD(batchSummary.totalLanded)} de ${fundLabel}; el inventario se sumará al recibir en bodega.`,
        ...(willSchedule
          ? { calendarNotice: 'Agendando fecha estimada en Google Calendar...' }
          : {}),
      });
      setDraftItems([]);
      setEstimatedArrivalDate('');
      setFundingSource('');

      if (
        !isDirect &&
        res.createdBatch &&
        shouldSchedulePurchaseCalendarEvent(res.createdBatch)
      ) {
        void schedulePurchaseInCalendar(res.createdBatch);
      }
    } finally {
      createLockRef.current = false;
      setIsSubmittingCreate(false);
    }
  };

  const handleRetryPendingCalendarBatch = async () => {
    if (!pendingCalendarBatch || !onConnectGoogleCalendar) return;
    const connected = await onConnectGoogleCalendar();
    if (connected) {
      await schedulePurchaseInCalendar(pendingCalendarBatch);
    }
  };

  const openReceiveModal = (batch: PurchaseBatchRecord) => {
    const qtyMap: Record<number, string> = {};
    const priceMap: Record<number, string> = {};
    const distinctPrices = new Set<number>();

    batch.items.forEach((item, idx) => {
      qtyMap[idx] = String(item.orderedQuantity ?? item.quantity);
      const existingInv = state.inventory.find(
        (inv) =>
          inv.model.trim().toLowerCase() === item.model.trim().toLowerCase() &&
          inv.size === item.size,
      );
      const basePrice =
        item.salePrice && item.salePrice > 0
          ? item.salePrice
          : existingInv?.salePrice && existingInv.salePrice > 0
            ? existingInv.salePrice
            : getDefaultSalePrice(item.version, item.model);
      priceMap[idx] = basePrice.toFixed(2);
      distinctPrices.add(round2(basePrice));
    });

    const initialMode: PurchasePricingMode =
      batch.retailPricingMode ??
      (distinctPrices.size > 1 ? 'per-item' : 'uniform');

    setReceivingBatch(batch);
    setReceiveDate(getTodayLocalDateIso());
    setActualFreightInput(
      (batch.estimatedFreightCost ?? batch.totalFreightCost).toFixed(2),
    );
    setReceivedQtys(qtyMap);
    setStage2PricingMode(initialMode);
    setStage2UniformSalePrice(priceMap[0] ?? '25.00');
    setStage2ItemSalePrices(priceMap);
    setReceiveError(null);
    setFeedback(null);
  };

  const modalAuditPreview = useMemo(() => {
    if (!receivingBatch) return null;
    const parsedActualFreight = Math.max(
      0,
      round2(Number(actualFreightInput) || 0),
    );
    let totalReceivedUnits = 0;
    let arrivedFactoryCostRaw = 0;
    receivingBatch.items.forEach((item, idx) => {
      const q = Math.max(0, Math.floor(Number(receivedQtys[idx]) || 0));
      totalReceivedUnits += q;
      arrivedFactoryCostRaw += q * item.factoryUnitCost;
    });
    const arrivedFactoryCost = round2(arrivedFactoryCostRaw);
    const factoryShortageUsd = round2(
      Math.max(0, receivingBatch.totalFactoryCost - arrivedFactoryCost),
    );
    const shortagePerUnitExact =
      totalReceivedUnits > 0 ? factoryShortageUsd / totalReceivedUnits : 0;
    const freightPerUnitExact =
      totalReceivedUnits > 0 ? parsedActualFreight / totalReceivedUnits : 0;
    const estimatedFreight =
      receivingBatch.estimatedFreightCost ?? receivingBatch.totalFreightCost;
    const freightDiff = round2(parsedActualFreight - estimatedFreight);
    const elapsedDays = calculateElapsedTransitDays(
      receivingBatch.entryDate,
      receiveDate,
    );
    return {
      parsedActualFreight,
      totalReceivedUnits,
      arrivedFactoryCost,
      factoryShortageUsd,
      shortagePerUnitExact,
      shortagePerUnitDisplay: round2(shortagePerUnitExact),
      freightPerUnitExact,
      freightPerUnitDisplay: round2(freightPerUnitExact),
      estimatedFreight,
      freightDiff,
      elapsedDays,
    };
  }, [actualFreightInput, receiveDate, receivedQtys, receivingBatch]);

  const handleConfirmReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivingBatch || receiveLockRef.current) return;
    setReceiveError(null);

    const parsedActualFreight = round2(Number(actualFreightInput));
    if (!Number.isFinite(parsedActualFreight) || parsedActualFreight < 0) {
      setReceiveError('El costo real del flete debe ser mayor o igual a $0.00.');
      return;
    }

    const uniformPrice = round2(Number(stage2UniformSalePrice) || 0);
    if (
      stage2PricingMode === 'uniform' &&
      (!Number.isFinite(uniformPrice) || uniformPrice <= 0)
    ) {
      setReceiveError(
        'El precio de venta uniforme ($) para el lote debe ser mayor a $0.00.',
      );
      return;
    }

    const receivedItems = receivingBatch.items.map((item, idx) => {
      const qty = Math.max(0, Math.floor(Number(receivedQtys[idx]) || 0));
      const rowSalePrice =
        stage2PricingMode === 'uniform'
          ? uniformPrice
          : round2(
              Number(
                stage2ItemSalePrices[idx] ??
                  item.salePrice ??
                  getDefaultSalePrice(item.version, item.model),
              ) || 0,
            );
      return {
        itemIndex: idx,
        receivedQuantity: qty,
        salePrice: rowSalePrice,
        modelLabel: `${item.model} (${item.size})`,
      };
    });

    if (stage2PricingMode === 'per-item') {
      const badItem = receivedItems.find(
        (it) => it.receivedQuantity > 0 && (!Number.isFinite(it.salePrice) || it.salePrice <= 0),
      );
      if (badItem) {
        setReceiveError(
          `Define un PVP ($) mayor a $0.00 para ${badItem.modelLabel}.`,
        );
        return;
      }
    }

    receiveLockRef.current = true;
    setIsSubmittingReceive(true);

    try {
      const clientOperationId = generateOperationId(`op-recv-${receivingBatch.id}`);
      const res = await Promise.resolve(
        onReceiveImportBatch({
          batchId: receivingBatch.id,
          receivedDate: receiveDate,
          actualFreightCost: parsedActualFreight,
          retailPricingMode: stage2PricingMode,
          clientOperationId,
          receivedItems: receivedItems.map(({ itemIndex, receivedQuantity, salePrice }) => ({
            itemIndex,
            receivedQuantity,
            salePrice,
          })),
        }),
      );

      if (!res.ok) {
        setReceiveError(
          res.error ?? 'No se pudo validar el ingreso del lote a bodega.',
        );
        return;
      }

      const arrivedCount = receivedItems.reduce(
        (sum, item) => sum + item.receivedQuantity,
        0,
      );
      const diff = modalAuditPreview?.freightDiff ?? 0;
      const days = modalAuditPreview?.elapsedDays ?? 0;
      const diffMsg =
        diff === 0
          ? 'sin diferencia de flete'
          : diff > 0
            ? `ajuste adicional de +${formatUSD(diff)} descontado`
            : `reembolso de ${formatUSD(Math.abs(diff))} devuelto`;

      setFeedback({
        type: 'success',
        text: `Lote "${receivingBatch.referenceName}" recibido en bodega (${arrivedCount} uds ingresadas a cola FIFO · ${days} días transcurridos · ${diffMsg}).`,
      });
      setReceivingBatch(null);
    } finally {
      receiveLockRef.current = false;
      setIsSubmittingReceive(false);
    }
  };

  return (
    <div className="w-full max-w-[1680px] mx-auto space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl text-balance">
            Compras, Importaciones y Recepción en Bodega
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Registra órdenes en tránsito o recepción directa con detección automática de equipo, matriz vertical de tallas y auditoría FIFO.
          </p>
        </div>
      </div>

      {/* KPI Strip: Capital en Tránsito y Estado de Importaciones */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <article className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4">
          <p className="text-xs font-medium text-slate-400">
            Capital invertido en tránsito
          </p>
          <p
            data-testid="transit-capital"
            className="font-mono-num mt-1 text-xl font-bold text-amber-300"
          >
            {formatUSD(transitCapital)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {transitCount}{' '}
            {transitCount === 1 ? 'orden en camino' : 'órdenes en camino'}
          </p>
        </article>

        <article className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4">
          <p className="text-xs font-medium text-slate-400">
            Unidades en camino (pendientes FIFO)
          </p>
          <p
            data-testid="transit-units"
            className="font-mono-num mt-1 text-xl font-bold text-white"
          >
            {transitUnits} uds
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            No disponibles para venta hasta su recepción
          </p>
        </article>

        <article className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4">
          <p className="text-xs font-medium text-slate-400">
            Disponibilidad para compras
          </p>
          <p className="font-mono-num mt-1 text-xl font-bold text-emerald-400">
            {formatUSD(state.cashOnHand)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Reposición:{' '}
            <span className="font-mono-num text-blue-300">
              {formatUSD(replacementFundBalance)}
            </span>{' '}
            · Reinversión:{' '}
            <span className="font-mono-num text-emerald-300">
              {formatUSD(reinvestmentFundBalance)}
            </span>{' '}
            · Combinado:{' '}
            <span className="font-mono-num font-semibold text-white">
              {formatUSD(combinedRepoReinvestmentBalance)}
            </span>
          </p>
        </article>
      </div>

      {/* Segmented Sub-Navigation */}
      <div
        role="tablist"
        aria-label="Secciones de compras"
        className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-slate-800 bg-[#0D1526] p-1.5"
      >
        {(
          [
            { id: 'all', label: 'Vista Completa' },
            { id: 'create', label: 'Registrar Compra / Recepción' },
            {
              id: 'transit',
              label: `Pedidos en Tránsito (${transitCount})`,
            },
            {
              id: 'history',
              label: `Historial Recibido (${receivedBatches.length})`,
            },
          ] as Array<{ id: PurchasesSubView; label: string }>
        ).map((tab) => {
          const active = subView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubView(tab.id)}
              className={`min-h-[40px] rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {calendarAuth && onConnectGoogleCalendar && onDisconnectGoogleCalendar && (
        <GoogleCalendarBanner
          variant="compact"
          authState={calendarAuth}
          onConnect={onConnectGoogleCalendar}
          onDisconnect={onDisconnectGoogleCalendar}
          contextText="Cada compra en tránsito con fecha estimada de llegada crea un evento automático en tu Google Calendar."
        />
      )}

      {feedback && (
        <div
          role="status"
          data-testid="purchases-feedback"
          className={`flex flex-col gap-2 rounded-xl px-4 py-3 text-xs font-medium ${
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
          {feedback.calendarNotice && (
            <div className="flex flex-wrap items-center gap-2 border-t border-emerald-500/20 pt-2 text-[11px] text-blue-200">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-blue-300" aria-hidden="true" />
              <span data-testid="purchase-calendar-status">{feedback.calendarNotice}</span>
              {feedback.calendarLink && (
                <a
                  href={feedback.calendarLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-blue-400/40 bg-blue-500/15 px-2 py-0.5 font-semibold text-blue-200 hover:bg-blue-500/25"
                >
                  Ver evento
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
              {feedback.needsCalendarAuth &&
                pendingCalendarBatch &&
                onConnectGoogleCalendar && (
                  <button
                    type="button"
                    data-testid="btn-retry-purchase-calendar"
                    onClick={() => void handleRetryPendingCalendarBatch()}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-400/50 bg-blue-600/25 px-2.5 py-1 font-semibold text-white hover:bg-blue-600/40"
                  >
                    Conectar Google y Agendar
                  </button>
                )}
            </div>
          )}
        </div>
      )}

      {/* ETAPA 1: REGISTRAR COMPRA / RECEPCIÓN (FLUJO EN 3 COLUMNAS EN ESCRITORIO) */}
      {(subView === 'all' || subView === 'create') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
          {/* COLUMNA 1: ENTRADA DE DATOS */}
          <div className="lg:col-span-4 space-y-3.5">
            <section
              aria-labelledby="batch-header-heading"
              className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4"
            >
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="batch-header-heading"
                    className="flex items-center gap-2 font-display text-sm sm:text-base font-semibold text-white"
                  >
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-blue-500/40 bg-blue-600/20 font-mono-num text-[11px] font-bold text-blue-300">
                      1
                    </span>
                    <span>Datos del Lote y Modalidad de Ingreso</span>
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Caja:{' '}
                    <strong className="font-mono-num text-emerald-400">
                      {formatUSD(state.cashOnHand)}
                    </strong>
                  </p>
                </div>

                {/* Selector Flujo: En Tránsito vs Recepción Directa */}
                <div
                  role="group"
                  aria-label="Modalidad de ingreso"
                  className="inline-flex w-full rounded-lg border border-slate-700 bg-[#070D19] p-1"
                >
                  <button
                    type="button"
                    data-testid="btn-flow-transit"
                    aria-pressed={flowType === 'transit'}
                    onClick={() => handleFlowTypeChange('transit')}
                    className={`inline-flex flex-1 min-h-[34px] items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      flowType === 'transit'
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                    En Tránsito
                  </button>
                  <button
                    type="button"
                    data-testid="btn-flow-direct"
                    aria-pressed={flowType === 'direct'}
                    onClick={() => handleFlowTypeChange('direct')}
                    className={`inline-flex flex-1 min-h-[34px] items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      flowType === 'direct'
                        ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Recepción Directa
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="batch-date"
                    className="block text-[11px] font-medium text-slate-300"
                  >
                    Fecha de registro
                  </label>
                  <input
                    id="batch-date"
                    type="date"
                    value={entryDate}
                    onChange={(e) => {
                      setEntryDate(e.target.value);
                      if (flowType === 'direct') {
                        setDirectReceivedDate(e.target.value);
                      }
                    }}
                    className="font-mono-num mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="batch-supplier"
                    className="flex items-center gap-1 text-[11px] font-medium text-slate-300"
                  >
                    <Building2 className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    Proveedor / Origen
                  </label>
                  <input
                    id="batch-supplier"
                    data-testid="batch-supplier-input"
                    type="text"
                    placeholder="Ej. Fábrica Guangzhou / Local"
                    value={supplier}
                    onChange={(e) => {
                      setSupplier(e.target.value);
                      setFeedback(null);
                    }}
                    className="mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="batch-ref"
                    className="block text-[11px] font-medium text-slate-300"
                  >
                    Referencia del lote
                  </label>
                  <input
                    id="batch-ref"
                    type="text"
                    required
                    placeholder="Ej. Aéreo Noviembre"
                    value={referenceName}
                    onChange={(e) => {
                      setReferenceName(e.target.value);
                      setFeedback(null);
                    }}
                    className="mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="batch-shipping"
                    className="block text-[11px] font-medium text-slate-300"
                  >
                    Tipo de envío (SLA)
                  </label>
                  <select
                    id="batch-shipping"
                    value={shippingType}
                    onChange={(e) =>
                      setShippingType(e.target.value as ShippingType)
                    }
                    className="mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {SHIPPING_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {st === 'Aéreo'
                          ? 'Aéreo (Alerta > 15 días)'
                          : 'Marítimo (Alerta > 80 días)'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="batch-freight"
                    className="block text-[11px] font-medium text-slate-300"
                  >
                    {flowType === 'direct'
                      ? 'Flete / Traslado (USDT)'
                      : 'Flete Estimado (USDT)'}
                  </label>
                  <input
                    id="batch-freight"
                    type="number"
                    min="0"
                    step="0.01"
                    value={totalFreightCost}
                    onChange={(e) => {
                      setTotalFreightCost(e.target.value);
                      setFeedback(null);
                    }}
                    className="font-mono-num mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="batch-usdt-rate"
                    className="block text-[11px] font-medium text-slate-300"
                  >
                    Tasa USDT del Lote (Bs/USDT)
                  </label>
                  <input
                    id="batch-usdt-rate"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={batchUsdtRate}
                    onChange={(e) => {
                      setBatchUsdtRate(e.target.value);
                      setFeedback(null);
                    }}
                    className="font-mono-num mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="batch-funding-source"
                    className="block text-[11px] font-medium text-slate-300"
                  >
                    Descontar de
                  </label>
                  <select
                    id="batch-funding-source"
                    value={fundingSource}
                    onChange={(e) => {
                      setFundingSource(
                        e.target.value as PurchaseFundingSource | '',
                      );
                      setFeedback(null);
                    }}
                    className="mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Selecciona origen de fondos...</option>
                    <option value="replacement">
                      Fondo de Reposición (Costo Base) ({formatUSD(replacementFundBalance)})
                    </option>
                    <option value="growthReinvestment">
                      Fondo de Reinversión ({formatUSD(reinvestmentFundBalance)})
                    </option>
                    <option value="cashOnHand">
                      Caja General ({formatUSD(state.cashOnHand)})
                    </option>
                  </select>
                </div>

                {flowType === 'transit' ? (
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="batch-arrival-date"
                      className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300"
                    >
                      <Calendar className="h-3 w-3 text-blue-400" aria-hidden="true" />
                      Fecha estimada de llegada (Agenda en Google Calendar)
                    </label>
                    <div className="mt-1 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                      <input
                        id="batch-arrival-date"
                        data-testid="batch-estimated-arrival-date"
                        type="date"
                        value={estimatedArrivalDate}
                        onChange={(e) => {
                          setEstimatedArrivalDate(e.target.value);
                          setFeedback(null);
                        }}
                        className="font-mono-num w-full sm:w-44 min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400">
                        {estimatedArrivalDate
                          ? `Recordatorio automático el ${estimatedArrivalDate}.`
                          : 'Opcional para agendar llegada.'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="batch-direct-received-date"
                      className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-300"
                    >
                      <PackageCheck className="h-3 w-3" aria-hidden="true" />
                      Fecha de ingreso directo a bodega (FIFO)
                    </label>
                    <div className="mt-1 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                      <input
                        id="batch-direct-received-date"
                        data-testid="batch-direct-received-date"
                        type="date"
                        value={directReceivedDate}
                        onChange={(e) => {
                          setDirectReceivedDate(e.target.value);
                          setFeedback(null);
                        }}
                        className="font-mono-num w-full sm:w-44 min-h-[36px] rounded-lg border border-emerald-500/40 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <span className="text-[11px] text-emerald-300/90">
                        Ingresa de inmediato a bodega como RECIBIDO (0 días en tránsito).
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Visor claro de saldos disponibles (Reposición + Reinversión + Respaldo Combinado) */}
              <div
                data-testid="purchase-funding-balances"
                className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-slate-800 bg-[#080E1C] p-2.5 sm:grid-cols-3"
              >
                <div
                  className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
                    fundingSource === 'replacement'
                      ? 'border-blue-500/50 bg-blue-500/10'
                      : 'border-slate-800 bg-[#070D19]'
                  }`}
                >
                  <p className="text-[10px] font-medium text-slate-400">
                    Reposición (Costo)
                  </p>
                  <p className="font-mono-num mt-0.5 text-xs font-bold text-blue-300">
                    {formatUSD(replacementFundBalance)}
                  </p>
                </div>

                <div
                  className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
                    fundingSource === 'growthReinvestment'
                      ? 'border-emerald-500/50 bg-emerald-500/10'
                      : 'border-slate-800 bg-[#070D19]'
                  }`}
                >
                  <p className="text-[10px] font-medium text-slate-400">
                    Reinversión
                  </p>
                  <p className="font-mono-num mt-0.5 text-xs font-bold text-emerald-300">
                    {formatUSD(reinvestmentFundBalance)}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-700/80 bg-[#070D19] px-2.5 py-1.5">
                  <p className="text-[10px] font-medium text-slate-400">
                    Combinado
                  </p>
                  <p className="font-mono-num mt-0.5 text-xs font-bold text-white">
                    {formatUSD(combinedRepoReinvestmentBalance)}
                  </p>
                </div>
              </div>
            </section>

            {/* BLOQUE 2: CONSTRUCTOR DE PRENDAS (SOLO FORMULARIO DE CARGA) */}
            <section
              aria-labelledby="batch-items-builder-heading"
              className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4"
            >
              <div>
                <h2
                  id="batch-items-builder-heading"
                  className="flex items-center gap-2 font-display text-sm sm:text-base font-semibold text-white"
                >
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-blue-500/40 bg-blue-600/20 font-mono-num text-[11px] font-bold text-blue-300">
                    2
                  </span>
                  <span>Agregar Prendas · Modelo, Versión y Tallas</span>
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  La categoría o equipo se detecta automáticamente desde el nombre del modelo.
                </p>
              </div>

              <form onSubmit={handleAddLine} className="mt-3 space-y-3">
                {/* Selección de Modelo Existente o "+ Registrar Nuevo Modelo" + Versión + Costo */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="col-span-2 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor={
                          modelEntryMode === 'existing' && uniqueModelNames.length > 0
                            ? 'purchase-existing-model'
                            : 'purchase-model'
                        }
                        className="block text-[11px] font-medium text-slate-300"
                      >
                        Modelo / Franela
                      </label>

                      <div className="flex items-center gap-2">
                        {uniqueModelNames.length > 0 && modelEntryMode === 'new' && (
                          <button
                            type="button"
                            data-testid="btn-use-existing-model"
                            onClick={() => {
                              setModelEntryMode('existing');
                              setModel('');
                              setModelSearchQuery('');
                              setIsModelDropdownOpen(false);
                              setManualTeamOverride(null);
                              setIsEditingTeam(false);
                            }}
                            className="text-[11px] font-semibold text-slate-300 underline-offset-2 hover:text-white hover:underline whitespace-nowrap shrink-0"
                          >
                            Elegir existente
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid="btn-register-new-model"
                          onClick={handleSwitchToNewModel}
                          className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-600/15 px-2 py-0.5 text-[11px] font-semibold text-blue-200 transition-colors hover:bg-blue-600/25 hover:text-white whitespace-nowrap shrink-0"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                          Registrar Nuevo Modelo
                        </button>
                      </div>
                    </div>

                    {modelEntryMode === 'existing' && uniqueModelNames.length > 0 ? (
                      <div ref={modelComboboxRef} className="relative">
                        <div className="relative">
                          <Search
                            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                            aria-hidden="true"
                          />
                          <input
                            ref={existingModelSearchRef}
                            id="purchase-existing-model"
                            data-testid="purchase-existing-model-input"
                            type="text"
                            role="combobox"
                            aria-expanded={isModelDropdownOpen}
                            aria-controls="purchase-existing-model-listbox"
                            aria-autocomplete="list"
                            autoComplete="off"
                            value={modelSearchQuery}
                            onFocus={() => setIsModelDropdownOpen(true)}
                            onChange={(e) => {
                              const nextQuery = e.target.value;
                              setModelSearchQuery(nextQuery);
                              setIsModelDropdownOpen(true);
                              if (model && nextQuery !== model) {
                                setModel('');
                                setManualTeamOverride(null);
                                setIsEditingTeam(false);
                              }
                              setFeedback(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setIsModelDropdownOpen(false);
                              }
                            }}
                            placeholder="Escribe para buscar modelo, equipo o versión..."
                            className="w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          {(modelSearchQuery || model) && (
                            <button
                              type="button"
                              data-testid="btn-clear-existing-model"
                              aria-label="Limpiar búsqueda de modelo"
                              onClick={() => {
                                setModelSearchQuery('');
                                handleSelectExistingModel('');
                                setIsModelDropdownOpen(true);
                                existingModelSearchRef.current?.focus();
                              }}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>

                        {isModelDropdownOpen && (
                          <div
                            id="purchase-existing-model-listbox"
                            role="listbox"
                            data-testid="purchase-existing-model-listbox"
                            className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-slate-700 bg-[#080E1C] p-1.5 shadow-2xl"
                          >
                            {filteredExistingModelOptions.length === 0 ? (
                              <div className="px-3 py-4 text-center text-xs text-slate-400">
                                No se encontraron modelos coincidentes en el catálogo.
                              </div>
                            ) : (
                              filteredExistingModelOptions.map((option) => {
                                const isSelected = option.name === model;
                                return (
                                  <button
                                    key={option.name}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    data-testid={`purchase-existing-model-option-${option.name}`}
                                    onClick={() => {
                                      handleSelectExistingModel(option.name);
                                      setModelSearchQuery(option.name);
                                      setIsModelDropdownOpen(false);
                                    }}
                                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                                      isSelected
                                        ? 'bg-blue-600/15 border border-blue-500/40'
                                        : 'hover:bg-slate-800 border border-transparent'
                                    }`}
                                  >
                                    {option.thumbnailUrl ? (
                                      <img
                                        src={option.thumbnailUrl}
                                        alt=""
                                        referrerPolicy="no-referrer"
                                        className="h-9 w-9 shrink-0 rounded-md border border-slate-700 object-cover bg-[#070D19]"
                                      />
                                    ) : null}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs font-medium text-white">
                                        {option.name}
                                      </p>
                                      <p className="truncate text-[11px] text-blue-300">
                                        {option.detectedTeam}
                                        {option.versions.length > 0
                                          ? ` · ${option.versions.join(', ')}`
                                          : ''}
                                      </p>
                                    </div>
                                    {isSelected && (
                                      <CheckCircle2
                                        className="h-4 w-4 shrink-0 text-blue-400"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <input
                        ref={modelInputRef}
                        id="purchase-model"
                        data-testid="purchase-model-input"
                        type="text"
                        required
                        value={model}
                        onChange={(e) => {
                          setModel(e.target.value);
                          setFeedback(null);
                        }}
                        placeholder="Ej. Real Madrid Local 26/27, PSG Retro 2002, Japón Edición Especial"
                        className="w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}

                    {/* Indicador automático de Equipo/Categoría SIN campo obligatorio previo */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <span
                        data-testid="purchase-detected-team"
                        className="text-[11px] font-medium text-blue-300"
                      >
                        Equipo detectado:{' '}
                        <strong className="text-white">{effectiveTeam}</strong>
                        {manualTeamOverride ? ' (editado)' : ''}
                      </span>

                      {!isEditingTeam ? (
                        <button
                          type="button"
                          data-testid="btn-edit-detected-team"
                          onClick={() => {
                            setManualTeamOverride(effectiveTeam);
                            setIsEditingTeam(true);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-blue-300 whitespace-nowrap shrink-0"
                        >
                          <Edit3 className="h-3 w-3" aria-hidden="true" />
                          Editar categoría
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            data-testid="purchase-override-team-input"
                            value={manualTeamOverride ?? ''}
                            onChange={(e) => setManualTeamOverride(e.target.value)}
                            placeholder="Categoría"
                            aria-label="Editar categoría detectada"
                            className="w-28 rounded border border-slate-600 bg-[#070D19] px-2 py-0.5 text-[11px] text-white focus:border-blue-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setIsEditingTeam(false)}
                            className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-700"
                          >
                            Listo
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setManualTeamOverride(null);
                              setIsEditingTeam(false);
                            }}
                            className="text-[10px] text-slate-400 hover:text-slate-200"
                          >
                            Auto
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="purchase-version"
                      className="block text-[11px] font-medium text-slate-300"
                    >
                      Versión <span className="text-red-400">*</span>
                    </label>
                    <select
                      id="purchase-version"
                      data-testid="purchase-version-select"
                      required
                      value={version}
                      onChange={(e) =>
                        handleVersionChange(
                          e.target.value as 'Player' | 'Retro' | 'Fans',
                        )
                      }
                      className="mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {VERSIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="purchase-factory-cost"
                      className="block text-[11px] font-medium text-slate-300"
                    >
                      Costo Fábrica ($)
                    </label>
                    <input
                      id="purchase-factory-cost"
                      data-testid="purchase-factory-cost-input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={factoryUnitCost}
                      onChange={(e) => {
                        setFactoryUnitCost(e.target.value);
                        setFeedback(null);
                      }}
                      className="font-mono-num mt-1 w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Selector Modo A vs Modo B para Precio de Venta al Público (Etapa 1) */}
                <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3 space-y-2.5">
                  <div className="flex flex-col gap-2">
                    <div>
                      <span className="block text-xs font-semibold text-slate-200">
                        Precio de Venta al Público (PVP $)
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Elige un PVP uniforme para todo el lote o asigna precios distintos por ítem/talla.
                      </span>
                    </div>

                    <div
                      role="group"
                      aria-label="Modo de precio de venta"
                      className="inline-flex w-full rounded-lg border border-slate-700 bg-[#070D19] p-1"
                    >
                      <button
                        type="button"
                        data-testid="btn-stage1-pricing-uniform"
                        aria-pressed={stage1PricingMode === 'uniform'}
                        onClick={() => handleStage1PricingModeChange('uniform')}
                        className={`flex-1 min-h-[30px] rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                          stage1PricingMode === 'uniform'
                            ? 'bg-emerald-600/25 text-emerald-200 border border-emerald-500/40'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Modo A: Mismo precio lote
                      </button>
                      <button
                        type="button"
                        data-testid="btn-stage1-pricing-per-item"
                        aria-pressed={stage1PricingMode === 'per-item'}
                        onClick={() => handleStage1PricingModeChange('per-item')}
                        className={`flex-1 min-h-[30px] rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                          stage1PricingMode === 'per-item'
                            ? 'bg-blue-600/25 text-blue-200 border border-blue-500/40'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Modo B: Precio por talla/ítem
                      </button>
                    </div>
                  </div>

                  {stage1PricingMode === 'uniform' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <label
                        htmlFor="purchase-sale-price"
                        className="text-[11px] font-medium text-slate-300"
                      >
                        PVP uniforme para todo el lote ($):
                      </label>
                      <input
                        id="purchase-sale-price"
                        data-testid="purchase-sale-price-input"
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        value={unitSalePrice}
                        onChange={(e) => handleUniformPriceChange(e.target.value)}
                        className="font-mono-num w-28 min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1 text-xs font-semibold text-emerald-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs text-blue-200">
                      <label
                        htmlFor="purchase-sale-price"
                        className="text-[11px] font-medium text-slate-300"
                      >
                        PVP base sugerido ($):
                      </label>
                      <input
                        id="purchase-sale-price"
                        data-testid="purchase-sale-price-input"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={unitSalePrice}
                        onChange={(e) => handleUniformPriceChange(e.target.value)}
                        className="font-mono-num w-28 min-h-[34px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1 text-xs font-semibold text-emerald-300 focus:border-blue-500 focus:outline-none"
                      />
                      <span className="w-full text-[11px] text-slate-400">
                        Ajusta el PVP individual de cada talla directamente abajo en la columna.
                      </span>
                    </div>
                  )}
                </div>

                {/* Matriz Vertical de Tallas en Columna S, M, L, XL, XXL + otras tallas */}
                <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-200">
                      Matriz de Tallas en Columna (Cantidad por talla)
                    </span>
                    <span className="font-mono-num text-xs font-semibold text-blue-300">
                      Total bloque: {matrixTotalUnits} uds
                    </span>
                  </div>

                  <div
                    data-testid="vertical-size-matrix"
                    className="divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-[#070D19]"
                  >
                    {activeSizes.map((sz) => {
                      const isStandard = ALL_JERSEY_SIZES.includes(
                        sz as (typeof ALL_JERSEY_SIZES)[number],
                      );
                      return (
                        <div
                          key={sz}
                          data-testid={`vertical-size-row-${sz}`}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
                        >
                          <div className="flex items-center gap-1.5 min-w-[64px]">
                            <label
                              htmlFor={`matrix-size-${sz}`}
                              className="font-mono-num text-xs font-bold text-white"
                            >
                              {sz}
                            </label>
                            {!isStandard && (
                              <button
                                type="button"
                                onClick={() => handleRemoveExtraSize(sz)}
                                aria-label={`Quitar talla ${sz}`}
                                className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                              </button>
                            )}
                          </div>

                          <div className="flex flex-1 items-center justify-end gap-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-slate-400">
                                Cant.
                              </span>
                              <input
                                id={`matrix-size-${sz}`}
                                data-testid={`purchase-size-${sz}`}
                                type="number"
                                min="0"
                                step="1"
                                value={sizeMatrix[sz] ?? '0'}
                                onChange={(e) => {
                                  setSizeMatrix((prev) => ({
                                    ...prev,
                                    [sz]: e.target.value,
                                  }));
                                  setFeedback(null);
                                }}
                                className="font-mono-num w-20 min-h-[34px] rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1 text-right text-xs font-semibold text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>

                            {stage1PricingMode === 'per-item' && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-400">
                                  PVP $
                                </span>
                                <input
                                  id={`matrix-price-${sz}`}
                                  data-testid={`purchase-size-price-${sz}`}
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={sizeSalePrices[sz] ?? unitSalePrice}
                                  onChange={(e) => {
                                    setSizeSalePrices((prev) => ({
                                      ...prev,
                                      [sz]: e.target.value,
                                    }));
                                    setFeedback(null);
                                  }}
                                  className="font-mono-num w-20 min-h-[34px] rounded-lg border border-emerald-500/35 bg-[#0D1526] px-2 py-1 text-right text-xs font-semibold text-emerald-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* "+ Agregar otra talla" con presets rápidos (XS, 3XL, Niño) + campo libre */}
                  <div className="pt-0.5">
                    {!showExtraSizePicker ? (
                      <button
                        type="button"
                        data-testid="btn-add-extra-size"
                        onClick={() => setShowExtraSizePicker(true)}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1 text-xs font-semibold text-slate-200 transition-colors hover:border-blue-500/40 hover:bg-slate-800 hover:text-white"
                      >
                        <Plus className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                        Agregar otra talla
                      </button>
                    ) : (
                      <div
                        data-testid="extra-size-picker"
                        className="rounded-lg border border-slate-700 bg-[#070D19] p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-slate-300">
                            Accesos rápidos o talla personalizada
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowExtraSizePicker(false)}
                            className="text-[11px] text-slate-400 hover:text-white"
                          >
                            Cerrar
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {EXTRA_JERSEY_SIZE_PRESETS.map((preset) => {
                            const exists = activeSizes.some(
                              (s) => s.toLowerCase() === preset.toLowerCase(),
                            );
                            return (
                              <button
                                key={preset}
                                type="button"
                                data-testid={`preset-size-${preset}`}
                                disabled={exists}
                                onClick={() => handleAddExtraSize(preset)}
                                className="min-h-[30px] rounded-md border border-slate-700 bg-[#0D1526] px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-blue-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                + {preset}
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            data-testid="custom-size-input"
                            value={customSizeInput}
                            onChange={(e) => setCustomSizeInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddExtraSize(customSizeInput);
                              }
                            }}
                            placeholder="Ej. 4XL, 10-12 años, Juvenil"
                            className="min-w-[140px] flex-1 min-h-[34px] rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            data-testid="btn-confirm-custom-size"
                            onClick={() => handleAddExtraSize(customSizeInput)}
                            disabled={!customSizeInput.trim()}
                            className="min-h-[34px] rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                          >
                            Agregar talla
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Foto opcional para el catálogo público (URL / Drive / Móvil) */}
                <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor="purchase-catalog-photo"
                        className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300"
                      >
                        <Camera className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                        Foto para Catálogo Público (opcional · URL, Google Drive o galería)
                      </label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <input
                          id="purchase-catalog-photo"
                          data-testid="purchase-catalog-photo-input"
                          type="url"
                          value={itemPhotoInput}
                          onChange={(e) => setItemPhotoInput(e.target.value)}
                          placeholder={
                            existingCatalogPhoto
                              ? 'Ya tiene foto guardada (pega otro enlace para reemplazar)'
                              : 'https://drive.google.com/file/d/... o sube desde tu móvil'
                          }
                          className="min-w-[160px] flex-1 min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                        <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white">
                          <Upload className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                          {photoUploading ? 'Procesando...' : 'Subir Foto'}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => void handlePurchasePhotoUpload(e)}
                            className="sr-only"
                          />
                        </label>
                        {(itemPhotoInput.trim() || existingCatalogPhoto) && (
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-[#070D19]">
                            <img
                              src={
                                normalizeCatalogImageUrl(itemPhotoInput) ||
                                existingCatalogPhoto
                              }
                              alt="Vista previa modelo"
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    data-testid="btn-add-batch-items"
                    className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-600/20 px-4 py-2 text-xs sm:text-sm font-semibold text-blue-200 transition-colors hover:bg-blue-600/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Agregar Tallas al Lote
                  </button>
                </div>
              </form>
            </section>
          </div>

          {/* COLUMNA 2: LISTA DE LA ORDEN EN VIVO */}
          <section
            aria-labelledby="order-draft-items-heading"
            className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4 lg:col-span-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="order-draft-items-heading"
                className="flex items-center gap-2 font-display text-sm sm:text-base font-semibold text-white"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-blue-500/40 bg-blue-600/20 font-mono-num text-[11px] font-bold text-blue-300">
                  3
                </span>
                <span>Prendas incluidas en la Orden</span>
              </h2>
              <span className="font-mono-num text-xs text-slate-400">
                {batchSummary.totalUnits} prendas · Flete prorrateado:{' '}
                {formatUSD(batchSummary.freightPerUnit)}/ud
              </span>
            </div>

            {draftItems.length === 0 ? (
              <div
                data-testid="draft-items-empty"
                className="mt-3 rounded-lg border border-dashed border-slate-700/80 bg-[#080E1C] p-6 text-center"
              >
                <ShoppingCart
                  className="mx-auto h-6 w-6 text-slate-500"
                  aria-hidden="true"
                />
                <p className="mt-2 text-xs font-semibold text-slate-300">
                  Aún no hay prendas en esta orden
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Las prendas agregadas desde el bloque izquierdo aparecerán aquí en vivo para revisar cantidades, costo puesto y PVP.
                </p>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-[11px] text-slate-400">
                    <tr>
                      <th className="pb-2">Modelo</th>
                      <th className="pb-2 text-right">Cant.</th>
                      <th className="pb-2 text-right">Fábrica</th>
                      <th className="pb-2 text-right">Est. Puesto</th>
                      <th className="pb-2 text-right">PVP ($)</th>
                      <th className="pb-2 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {draftItems.map((line) => {
                      const landed = round2(
                        round4(
                          line.factoryUnitCost +
                            batchSummary.freightPerUnitExact,
                        ),
                      );
                      return (
                        <tr key={line.lineId}>
                          <td className="py-2 pr-2">
                            <span className="font-medium text-white">
                              {line.model}
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              {line.team} · {line.version} · Talla {line.size}
                            </span>
                          </td>
                          <td className="py-2 text-right font-mono-num font-semibold text-white">
                            {line.quantity}
                          </td>
                          <td className="py-2 text-right font-mono-num text-slate-300">
                            {formatUSD(line.factoryUnitCost)}
                          </td>
                          <td className="py-2 text-right font-mono-num font-semibold text-blue-300">
                            {formatUSD(landed)}
                          </td>
                          <td className="py-2 text-right font-mono-num font-semibold text-emerald-300">
                            {stage1PricingMode === 'per-item' ? (
                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                aria-label={`PVP para ${line.model} talla ${line.size}`}
                                data-testid={`draft-line-price-${line.size}`}
                                value={line.salePrice || ''}
                                onChange={(e) =>
                                  handleUpdateDraftLinePrice(
                                    line.lineId,
                                    e.target.value,
                                  )
                                }
                                className="font-mono-num w-20 rounded border border-emerald-500/40 bg-[#070D19] px-2 py-1 text-right text-xs font-semibold text-emerald-300 focus:border-emerald-400 focus:outline-none"
                              />
                            ) : (
                              formatUSD(line.salePrice)
                            )}
                          </td>
                          <td className="py-2 pl-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(line.lineId)}
                              aria-label={`Eliminar ${line.model} del lote`}
                              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/20"
                            >
                              <Trash2
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* COLUMNA 3: RESUMEN Y CIERRE */}
          <section
            aria-labelledby="batch-impact-heading"
            className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4 lg:col-span-3"
          >
            <h2
              id="batch-impact-heading"
              className="flex items-center gap-2 font-display text-sm sm:text-base font-semibold text-white"
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-blue-500/40 bg-blue-600/20 font-mono-num text-[11px] font-bold text-blue-300">
                4
              </span>
              <span>Resumen y Confirmación</span>
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Se descontará de{' '}
              <span className="font-semibold text-slate-200">
                {getFundingSourceLabel(fundingSource)}
              </span>{' '}
              {flowType === 'direct'
                ? 'y las unidades ingresarán inmediatamente al inventario FIFO.'
                : 'y la orden quedará EN TRÁNSITO hasta confirmar recepción.'}
            </p>

            <div className="mt-3.5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-300">Modalidad</span>
                <span
                  className={`text-xs font-semibold ${
                    flowType === 'direct' ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                >
                  {flowType === 'direct'
                    ? 'Recepción Directa (Bodega)'
                    : 'En Tránsito (Seguimiento SLA)'}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-300">Total prendas</span>
                <span className="font-mono-num font-semibold text-white">
                  {batchSummary.totalUnits} uds
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-300">Costo fábrica total</span>
                <span className="font-mono-num font-semibold text-white">
                  {formatUSD(batchSummary.totalFactory)}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-300">
                  Flete ({shippingType})
                </span>
                <span className="font-mono-num font-semibold text-white">
                  {formatUSD(parsedFreight)}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-300">
                  Flete prorrateado / ud
                </span>
                <span className="font-mono-num font-semibold text-blue-300">
                  {batchSummary.totalUnits > 0
                    ? `${formatUSD(batchSummary.freightPerUnit)}/ud`
                    : '—'}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-300">Desembolso inmediato</span>
                <span
                  data-testid="batch-total-landed"
                  className={`font-mono-num text-sm font-bold ${
                    batchSummary.totalLanded > availableFundingBalance
                      ? 'text-red-400'
                      : 'text-white'
                  }`}
                >
                  {formatUSD(batchSummary.totalLanded)}
                </span>
              </div>

              <div className="flex items-center justify-between pb-1">
                <span className="text-slate-300">Saldo proyectado</span>
                <span
                  className={`font-mono-num font-semibold ${
                    availableFundingBalance - batchSummary.totalLanded < 0
                      ? 'text-red-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {formatUSD(availableFundingBalance - batchSummary.totalLanded)}
                </span>
              </div>

              {batchSummary.totalLanded > availableFundingBalance &&
                draftItems.length > 0 && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    El total supera el efectivo físico en caja ({formatUSD(availableFundingBalance)}). Cobra cuentas por cobrar o ajusta las cantidades.
                  </p>
                )}

              {batchSummary.totalLanded <= availableFundingBalance &&
                (fundingSource === 'replacement' ||
                  fundingSource === 'growthReinvestment') &&
                batchSummary.totalLanded > primaryFundingBalance &&
                draftItems.length > 0 && (
                  <p
                    data-testid="purchase-bridge-notice"
                    className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200"
                  >
                    {batchSummary.totalLanded <= combinedRepoReinvestmentBalance
                      ? `Respaldo mutuo activo: el saldo en ${getFundingSourceLabel(fundingSource)} (${formatUSD(primaryFundingBalance)}) se complementará con ${formatUSD(round2(batchSummary.totalLanded - primaryFundingBalance))} del fondo hermano.`
                      : `Respaldo combinado + prorrata: se usarán Reposición y Reinversión (${formatUSD(combinedRepoReinvestmentBalance)}) y el excedente de ${formatUSD(round2(batchSummary.totalLanded - combinedRepoReinvestmentBalance))} se prorrateará en los demás fondos de caja.`}
                  </p>
                )}

              <button
                type="button"
                data-testid="btn-submit-batch"
                onClick={() => void handleSaveBatch()}
                disabled={draftItems.length === 0 || isSubmittingCreate}
                className={`mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold text-white transition-colors active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 ${
                  flowType === 'direct'
                    ? 'bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-400'
                    : 'bg-blue-600 hover:bg-blue-500 focus-visible:ring-blue-400'
                }`}
              >
                {flowType === 'direct' ? (
                  <PackageCheck className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                )}
                {isSubmittingCreate
                  ? 'Procesando registro...'
                  : flowType === 'direct'
                    ? 'Confirmar Recepción Directa en Bodega'
                    : 'Registrar Orden en Tránsito'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* SECCIONES: PEDIDOS EN TRÁNSITO E HISTORIAL (LADO A LADO EN VISTA COMPLETA) */}
      {(subView === 'all' || subView === 'transit' || subView === 'history') && (
        <div
          className={
            subView === 'all'
              ? 'grid grid-cols-1 xl:grid-cols-2 gap-3.5 items-start'
              : 'space-y-3.5'
          }
        >
          {/* SECCIÓN: PEDIDOS EN TRÁNSITO (EN CAMINO) */}
          {(subView === 'all' || subView === 'transit') && (
            <section
              aria-labelledby="transit-orders-heading"
              className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4"
            >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2
                id="transit-orders-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Pedidos en Tránsito (En Camino)
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Alertas automáticas activas si supera 15 días (Aéreo) u 80 días (Marítimo). Confirma recepción para calcular días y cargar inventario FIFO.
              </p>
            </div>
            <div className="text-xs text-slate-300 whitespace-nowrap">
              En tránsito:{' '}
              <strong className="font-mono-num text-amber-300">
                {formatUSD(transitCapital)}
              </strong>{' '}
              ({transitUnits} uds)
            </div>
          </div>

          {transitBatches.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-slate-700/80 bg-[#080E1C] p-6 text-center">
              <p className="text-sm font-medium text-slate-300">
                No hay pedidos en tránsito en este momento
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Cuando registres una nueva orden En Tránsito aparecerá aquí para hacer seguimiento y auditar su llegada a bodega.
              </p>
            </div>
          ) : (
            <div className="mt-5 divide-y divide-slate-800">
              {transitBatches.map((batch) => {
                const transitAlert = getTransitAlertStatus(
                  batch,
                  undefined,
                  alertThresholds,
                );
                return (
                  <article
                    key={batch.id}
                    data-testid={`transit-batch-${batch.id}`}
                    className={`py-5 first:pt-1 last:pb-1 space-y-4 ${
                      transitAlert.isDelayed
                        ? 'rounded-xl border border-red-500/40 bg-red-500/5 px-4 my-2'
                        : ''
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              transitAlert.isDelayed
                                ? 'text-red-400'
                                : 'text-amber-300'
                            }`}
                          >
                            {transitAlert.isDelayed ? (
                              <AlertTriangle
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            ) : (
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {transitAlert.isDelayed
                              ? `RETRASO EN TRÁNSITO (${transitAlert.daysInTransit}d > ${transitAlert.thresholdDays}d)`
                              : `${batch.status} · ${transitAlert.daysInTransit} días`}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="font-mono-num text-xs text-slate-400">
                            Registro {batch.entryDate}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="text-xs text-blue-300">
                            {batch.shippingType}
                          </span>
                          {batch.supplier && (
                            <>
                              <span aria-hidden="true" className="text-slate-600">
                                ·
                              </span>
                              <span className="text-xs text-slate-300">
                                Proveedor: {batch.supplier}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="text-xs text-slate-400">
                            Pago: {getFundingSourceLabel(batch.fundingSource)}
                          </span>
                        </div>

                        <h3 className="text-base font-semibold text-white">
                          {batch.referenceName}
                        </h3>

                        {batch.estimatedArrivalDate && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-blue-300">
                            <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="font-mono-num">
                              Llegada est.: {batch.estimatedArrivalDate}
                            </span>
                            {batch.calendarEventLink && (
                              <a
                                href={batch.calendarEventLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded border border-blue-500/35 bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-200 hover:bg-blue-500/20"
                              >
                                Google Calendar
                                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        )}

                        <p className="text-xs text-slate-400">
                          {batch.orderedTotalUnits} prendas en camino · Fábrica{' '}
                          <span className="font-mono-num text-slate-200">
                            {formatUSD(batch.totalFactoryCost)}
                          </span>{' '}
                          + Flete est.{' '}
                          <span className="font-mono-num text-slate-200">
                            {formatUSD(batch.estimatedFreightCost)}
                          </span>{' '}
                          · Total invertido:{' '}
                          <strong className="font-mono-num text-amber-300">
                            {formatUSD(batch.totalLandedCost)}
                          </strong>
                        </p>
                      </div>

                      <button
                        type="button"
                        data-testid={`btn-open-receive-${batch.id}`}
                        onClick={() => openReceiveModal(batch)}
                        className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        <PackageCheck className="h-4 w-4" aria-hidden="true" />
                        Confirmar Recepción
                      </button>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-[#080E1C] px-4 py-2.5">
                      <ul className="divide-y divide-slate-800/60 text-xs">
                        {batch.items.map((item, idx) => (
                          <li
                            key={`${batch.id}-transit-item-${idx}`}
                            className="flex flex-wrap items-center justify-between gap-2 py-2"
                          >
                            <span className="text-slate-200">
                              <strong className="font-mono-num text-white">
                                {item.orderedQuantity}x
                              </strong>{' '}
                              {item.model}{' '}
                              <span className="text-slate-400">
                                ({item.team} · {item.version} · Talla {item.size})
                              </span>
                            </span>
                            <span className="font-mono-num text-slate-400">
                              Fábrica {formatUSD(item.factoryUnitCost)}/ud · Est. puesto{' '}
                              <strong className="text-blue-300">
                                {formatUSD(item.landedUnitCost)}/ud
                              </strong>
                              {item.salePrice ? (
                                <span className="text-emerald-300">
                                  {' '}
                                  · PVP {formatUSD(item.salePrice)}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

          {/* HISTORIAL DE COMPRAS Y LOTES RECIBIDOS EN BODEGA */}
          {(subView === 'all' || subView === 'transit' || subView === 'history') && (
            <section
              aria-labelledby="purchase-history-heading"
              className="rounded-xl border border-slate-800 bg-[#0D1526] p-3.5 xl:p-4 overflow-hidden"
            >
          <div className="flex items-center justify-between gap-4">
            <h2
              id="purchase-history-heading"
              className="font-display text-lg font-semibold text-white"
            >
              Historial de Compras y Lotes Recibidos en Bodega
            </h2>
            <span className="font-mono-num text-xs text-slate-400">
              {receivedBatches.length}{' '}
              {receivedBatches.length === 1 ? 'lote' : 'lotes'}
            </span>
          </div>

          {receivedBatches.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">
              Aún no hay lotes recibidos en bodega. Al confirmar recepción o registrar una recepción directa aparecerá aquí con sus días transcurridos y Landed Cost definitivo.
            </p>
          ) : (
            <>
              <div className="mt-4 hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-800 bg-[#080E1C] text-xs font-medium text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Fechas y Tiempo</th>
                      <th className="px-4 py-3">Lote / Proveedor</th>
                      <th className="px-4 py-3">Detalle Recibido (Landed y PVP)</th>
                      <th className="px-4 py-3 text-right">Fábrica</th>
                      <th className="px-4 py-3 text-right">Flete Real</th>
                      <th className="px-4 py-3 text-right">Total Lote</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {receivedBatches.map((b) => {
                      const diff = b.freightAdjustment ?? 0;
                      const dias =
                        typeof b.diasTranscurridos === 'number'
                          ? b.diasTranscurridos
                          : b.isDirectReception
                            ? 0
                            : calculateElapsedTransitDays(
                                b.entryDate,
                                b.receivedDate ?? b.entryDate,
                              );
                      return (
                        <tr
                          key={b.id}
                          data-testid={`history-batch-${b.id}`}
                          className="align-top hover:bg-slate-800/30"
                        >
                          <td className="px-4 py-3 text-xs whitespace-nowrap space-y-1">
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                              <PackageCheck
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {b.status}
                            </span>
                            <p className="font-mono-num text-slate-300">
                              Recibido: {b.receivedDate ?? b.entryDate}
                            </p>
                            {b.receivedDate && b.receivedDate !== b.entryDate && (
                              <p className="font-mono-num text-[11px] text-slate-500">
                                Registro: {b.entryDate}
                              </p>
                            )}
                            <div>
                              <span
                                data-testid={`batch-days-badge-${b.id}`}
                                className={`font-mono-num inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${
                                  b.isDirectReception
                                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                                    : 'border-blue-500/35 bg-blue-500/10 text-blue-200'
                                }`}
                              >
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                {b.isDirectReception
                                  ? 'Recepción Directa · 0 días'
                                  : `Recibido en ${dias} ${dias === 1 ? 'día' : 'días'} · ${b.shippingType}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-white">
                              {b.referenceName}
                            </p>
                            {b.supplier && (
                              <p className="mt-0.5 text-xs text-slate-300">
                                Proveedor: {b.supplier}
                              </p>
                            )}
                            <p className="text-xs text-blue-300">
                              {b.shippingType} · {b.totalUnits}
                              {b.orderedTotalUnits !== b.totalUnits
                                ? `/${b.orderedTotalUnits}`
                                : ''}{' '}
                              uds (Flete{' '}
                              <span className="font-mono-num">
                                {formatUSD(b.freightPerUnit)}/ud
                              </span>
                              )
                              {b.usdtRate ? (
                                <span className="font-mono-num text-slate-400">
                                  {' '}
                                  · Tasa {b.usdtRate.toFixed(2)}
                                </span>
                              ) : null}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <ul className="space-y-1 text-xs text-slate-300">
                              {b.items.map((item, idx) => (
                                <li key={`${b.id}-${item.skuId ?? idx}-${idx}`}>
                                  <strong className="font-mono-num text-white">
                                    {item.quantity}x
                                  </strong>{' '}
                                  {item.model} ({item.version} · {item.size})
                                  {item.orderedQuantity !== item.quantity ? (
                                    <span className="text-amber-300">
                                      {' '}
                                      [pedidas: {item.orderedQuantity}]
                                    </span>
                                  ) : null}{' '}
                                  — Fábrica{' '}
                                  <span className="font-mono-num">
                                    {formatUSD(item.factoryUnitCost)}
                                  </span>{' '}
                                  → Puesto{' '}
                                  <strong className="font-mono-num text-white">
                                    {formatUSD(item.landedUnitCost)}/ud
                                  </strong>
                                  {item.salePrice ? (
                                    <span className="font-mono-num text-emerald-300">
                                      {' '}
                                      · PVP {formatUSD(item.salePrice)}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="px-4 py-3 text-right font-mono-num text-slate-300 whitespace-nowrap">
                            {formatUSD(b.totalFactoryCost)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-num whitespace-nowrap">
                            <span className="text-slate-300">
                              {formatUSD(b.totalFreightCost)}
                            </span>
                            {diff !== 0 && (
                              <span
                                className={`block text-[11px] ${
                                  diff > 0 ? 'text-amber-300' : 'text-emerald-400'
                                }`}
                              >
                                ({diff > 0 ? `+${formatUSD(diff)}` : formatUSD(diff)})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-num font-bold text-red-300 whitespace-nowrap">
                            -{formatUSD(b.totalLandedCost)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 divide-y divide-slate-800/80 md:hidden">
                {receivedBatches.map((b) => {
                  const dias =
                    typeof b.diasTranscurridos === 'number'
                      ? b.diasTranscurridos
                      : b.isDirectReception
                        ? 0
                        : calculateElapsedTransitDays(
                            b.entryDate,
                            b.receivedDate ?? b.entryDate,
                          );
                  return (
                    <div key={b.id} className="py-3.5 space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                            <PackageCheck
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            {b.status}
                          </span>
                          <p className="text-sm font-semibold text-white">
                            {b.referenceName}
                          </p>
                          {b.supplier && (
                            <p className="text-slate-300">
                              Proveedor: {b.supplier}
                            </p>
                          )}
                          <p className="text-slate-400">
                            {b.receivedDate ?? b.entryDate} · {b.shippingType} ·{' '}
                            {b.totalUnits} uds
                          </p>
                          <span
                            className={`font-mono-num inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${
                              b.isDirectReception
                                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                                : 'border-blue-500/35 bg-blue-500/10 text-blue-200'
                            }`}
                          >
                            {b.isDirectReception
                              ? 'Recepción Directa · 0 días'
                              : `Recibido en ${dias} ${dias === 1 ? 'día' : 'días'} · ${b.shippingType}`}
                          </span>
                        </div>
                        <span className="font-mono-num text-sm font-bold text-red-300 shrink-0">
                          -{formatUSD(b.totalLandedCost)}
                        </span>
                      </div>
                      <ul className="space-y-1 text-slate-300">
                        {b.items.map((item, idx) => (
                          <li key={`${b.id}-m-${idx}`}>
                            {item.quantity}x {item.model} ({item.version} ·{' '}
                            {item.size}) →{' '}
                            <strong className="font-mono-num text-white">
                              {formatUSD(item.landedUnitCost)}/ud
                            </strong>
                            {item.salePrice ? (
                              <span className="font-mono-num text-emerald-300">
                                {' '}
                                · PVP {formatUSD(item.salePrice)}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </>
          )}
            </section>
          )}
        </div>
      )}

      {/* ETAPA 2: MODAL DE RECEPCIÓN Y AUDITORÍA DE INGRESO A BODEGA */}
      {receivingBatch && modalAuditPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="receive-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-[#0D1526] p-5 sm:p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs font-medium text-emerald-400">
                  Etapa 2 · Auditoría de Ingreso a Bodega FIFO
                </p>
                <h2
                  id="receive-modal-title"
                  className="font-display mt-0.5 text-lg font-bold text-white sm:text-xl"
                >
                  Confirmar Recepción: {receivingBatch.referenceName}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Registro {receivingBatch.entryDate} · {receivingBatch.shippingType}
                  {receivingBatch.supplier ? ` · ${receivingBatch.supplier}` : ''} ·{' '}
                  <span className="font-mono-num text-blue-300">
                    {modalAuditPreview.elapsedDays}{' '}
                    {modalAuditPreview.elapsedDays === 1
                      ? 'día transcurrido'
                      : 'días transcurridos'}
                  </span>
                </p>
              </div>
              <button
                type="button"
                disabled={isSubmittingReceive}
                onClick={() => setReceivingBatch(null)}
                aria-label="Cerrar modal de recepción"
                className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-700 bg-[#080E1C] text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={(e) => void handleConfirmReceive(e)} className="mt-5 space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="receive-date"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Fecha de recepción en bodega (FIFO)
                  </label>
                  <input
                    id="receive-date"
                    type="date"
                    required
                    value={receiveDate}
                    onChange={(e) => {
                      setReceiveDate(e.target.value);
                      setReceiveError(null);
                    }}
                    className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="receive-actual-freight"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Costo Real del Flete (USDT)
                  </label>
                  <input
                    id="receive-actual-freight"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={actualFreightInput}
                    onChange={(e) => {
                      setActualFreightInput(e.target.value);
                      setReceiveError(null);
                    }}
                    className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Selector Modo A vs Modo B de PVP al Confirmar Recepción */}
              <div className="rounded-lg border border-slate-800 bg-[#080E1C] p-3.5 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Precio de Venta al Público (PVP $) al ingresar a bodega
                  </span>
                  <div
                    role="group"
                    aria-label="Modo de precio de venta en recepción"
                    className="inline-flex rounded-lg border border-slate-700 bg-[#070D19] p-1 self-start"
                  >
                    <button
                      type="button"
                      data-testid="btn-stage2-pricing-uniform"
                      aria-pressed={stage2PricingMode === 'uniform'}
                      onClick={() => {
                        setStage2PricingMode('uniform');
                        setReceiveError(null);
                      }}
                      className={`min-h-[32px] rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        stage2PricingMode === 'uniform'
                          ? 'bg-emerald-600/25 text-emerald-200 border border-emerald-500/40'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Modo A: Mismo precio lote
                    </button>
                    <button
                      type="button"
                      data-testid="btn-stage2-pricing-per-item"
                      aria-pressed={stage2PricingMode === 'per-item'}
                      onClick={() => {
                        setStage2PricingMode('per-item');
                        setReceiveError(null);
                      }}
                      className={`min-h-[32px] rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        stage2PricingMode === 'per-item'
                          ? 'bg-blue-600/25 text-blue-200 border border-blue-500/40'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Modo B: Precio por ítem/talla
                    </button>
                  </div>
                </div>

                {stage2PricingMode === 'uniform' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <label
                      htmlFor="receive-uniform-sale-price"
                      className="text-xs text-slate-300"
                    >
                      PVP uniforme para todo el lote ($):
                    </label>
                    <input
                      id="receive-uniform-sale-price"
                      data-testid="receive-uniform-sale-price"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={stage2UniformSalePrice}
                      onChange={(e) => {
                        setStage2UniformSalePrice(e.target.value);
                        setReceiveError(null);
                      }}
                      className="font-mono-num w-32 min-h-[38px] rounded-lg border border-emerald-500/40 bg-[#070D19] px-3 py-1.5 text-sm font-semibold text-emerald-300 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200">
                    Cantidades Reales Recibidas por Modelo y Talla
                  </h3>
                  <span className="font-mono-num text-xs text-slate-400">
                    Flete real prorrateado:{' '}
                    <strong className="text-blue-300">
                      {modalAuditPreview.totalReceivedUnits > 0
                        ? `${formatUSD(modalAuditPreview.freightPerUnitDisplay)}/ud`
                        : '—'}
                    </strong>
                  </span>
                </div>

                <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-[#080E1C] px-3.5">
                  {receivingBatch.items.map((item, idx) => {
                    const qtyVal = Math.max(
                      0,
                      Math.floor(Number(receivedQtys[idx]) || 0),
                    );
                    const realLanded =
                      modalAuditPreview.totalReceivedUnits > 0
                        ? round2(
                            round4(
                              item.factoryUnitCost +
                                modalAuditPreview.shortagePerUnitExact +
                                modalAuditPreview.freightPerUnitExact,
                            ),
                          )
                        : item.factoryUnitCost;
                    return (
                      <div
                        key={`receive-line-${idx}`}
                        className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">
                            {item.model}
                          </p>
                          <p className="text-xs text-slate-400">
                            {item.version} · Talla {item.size} · Pedido:{' '}
                            <span className="font-mono-num text-slate-200">
                              {item.orderedQuantity} uds
                            </span>{' '}
                            · Fábrica{' '}
                            <span className="font-mono-num">
                              {formatUSD(item.factoryUnitCost)}
                            </span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end shrink-0">
                          <div className="text-right">
                            <span className="block text-[11px] text-slate-400">
                              Landed Real
                            </span>
                            <span className="font-mono-num text-xs font-semibold text-emerald-300">
                              {qtyVal > 0 ? `${formatUSD(realLanded)}/ud` : 'Sin ingreso'}
                            </span>
                          </div>

                          {stage2PricingMode === 'per-item' && (
                            <div>
                              <label
                                htmlFor={`receive-item-price-${idx}`}
                                className="block text-[10px] text-slate-400 text-right"
                              >
                                PVP ($)
                              </label>
                              <input
                                id={`receive-item-price-${idx}`}
                                data-testid={`receive-item-price-${idx}`}
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={stage2ItemSalePrices[idx] ?? '25.00'}
                                onChange={(e) => {
                                  setStage2ItemSalePrices((prev) => ({
                                    ...prev,
                                    [idx]: e.target.value,
                                  }));
                                  setReceiveError(null);
                                }}
                                className="font-mono-num min-h-[38px] w-24 rounded-lg border border-emerald-500/40 bg-[#070D19] px-2.5 py-1 text-right text-xs font-semibold text-emerald-300 focus:border-emerald-400 focus:outline-none"
                              />
                            </div>
                          )}

                          <div>
                            <label
                              htmlFor={`receive-qty-${idx}`}
                              className="block text-[10px] text-slate-400 text-right"
                            >
                              Recibidas
                            </label>
                            <input
                              id={`receive-qty-${idx}`}
                              type="number"
                              min="0"
                              step="1"
                              required
                              value={receivedQtys[idx] ?? '0'}
                              onChange={(e) => {
                                setReceivedQtys((prev) => ({
                                  ...prev,
                                  [idx]: e.target.value,
                                }));
                                setReceiveError(null);
                              }}
                              className="font-mono-num min-h-[38px] w-20 rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1 text-right text-sm font-semibold text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Resumen de diferencia de flete y efecto en caja/fondo */}
              <div className="space-y-2 rounded-lg border border-slate-800 bg-[#080E1C] p-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Total piezas a ingresar a FIFO</span>
                  <span className="font-mono-num font-semibold text-white">
                    {modalAuditPreview.totalReceivedUnits} /{' '}
                    {receivingBatch.orderedTotalUnits} uds
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Tiempo en tránsito al recibir</span>
                  <span className="font-mono-num font-semibold text-blue-300">
                    {modalAuditPreview.elapsedDays}{' '}
                    {modalAuditPreview.elapsedDays === 1 ? 'día' : 'días'}
                  </span>
                </div>

                {modalAuditPreview.factoryShortageUsd > 0 && (
                  <div
                    data-testid="receive-factory-shortage"
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-400">
                      Faltante de fábrica ({formatUSD(modalAuditPreview.factoryShortageUsd)})
                    </span>
                    <span className="font-mono-num font-semibold text-amber-300 text-right">
                      Prorrateado +{formatUSD(modalAuditPreview.shortagePerUnitDisplay)}/ud (sin devolución a caja)
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">
                    Diferencia flete (Real vs Estimado)
                  </span>
                  <span
                    data-testid="receive-freight-diff"
                    className={`font-mono-num font-semibold ${
                      modalAuditPreview.freightDiff > 0
                        ? 'text-amber-300'
                        : modalAuditPreview.freightDiff < 0
                          ? 'text-emerald-400'
                          : 'text-slate-200'
                    }`}
                  >
                    {modalAuditPreview.freightDiff === 0
                      ? '$0.00 (Sin diferencia)'
                      : modalAuditPreview.freightDiff > 0
                        ? `+${formatUSD(modalAuditPreview.freightDiff)} (Cargo adicional a ${getFundingSourceLabel(
                            receivingBatch.fundingSource,
                          )})`
                        : `${formatUSD(modalAuditPreview.freightDiff)} (Reembolso a ${getFundingSourceLabel(
                            receivingBatch.fundingSource,
                          )})`}
                  </span>
                </div>
              </div>

              {receiveError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs font-medium text-red-300"
                >
                  {receiveError}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={isSubmittingReceive}
                  onClick={() => setReceivingBatch(null)}
                  className="min-h-[44px] rounded-lg border border-slate-700 bg-[#080E1C] px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  data-testid="btn-confirm-receive-submit"
                  disabled={isSubmittingReceive}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <PackageCheck className="h-4 w-4" aria-hidden="true" />
                  {isSubmittingReceive
                    ? 'Procesando recepción...'
                    : 'Confirmar Recepción e Ingresar a FIFO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
