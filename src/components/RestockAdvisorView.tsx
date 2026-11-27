import { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  DollarSign,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Flame,
  Loader2,
  Minus,
  PackageCheck,
  Plane,
  Plus,
  RotateCcw,
  Search,
  Ship,
  Shirt,
  Snowflake,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import type {
  AppState,
  JerseyVersion,
  PurchaseBatchRecord,
  ShippingType,
} from '../types/erp';
import {
  formatUSD,
  getTodayLocalDateIso,
  normalizeVersionDisplay,
  round2,
} from '../utils/finance';
import {
  obtenerFallbackUrlImagen,
  parseCatalogImageList,
  resolveCatalogPhoto,
} from '../utils/publicCatalog';
import {
  buildSupplierOrderGroups,
  DEFAULT_SUPPLIER_PATCH,
  exportSupplierOrderExcel,
  extractBaseModelAndPlayer,
  SUPPLIER_PATCH_OPTIONS,
} from '../utils/supplierOrderExcel';

interface RestockAdvisorViewProps {
  state: AppState;
}

type AnalysisWindowDays = 30 | 60 | 90;
type PlanningMode = 'auto' | 'air' | 'maritime';
type RotationTier = 'high' | 'medium' | 'low';
type LogisticsRecommendation =
  | 'urgent_air_bridge'
  | 'urgent_air'
  | 'plan_maritime'
  | 'season_blocked'
  | 'in_transit_covered'
  | 'healthy'
  | 'low_rotation';
type StatusFilter =
  | 'all'
  | 'suggested'
  | 'high_rotation'
  | 'urgent_air'
  | 'plan_maritime'
  | 'in_transit'
  | 'low_rotation';
type BudgetMode = 'fixed' | 'auto';
type ModelMarketKind =
  | 'retro'
  | 'national_team'
  | 'european_club'
  | 'other_club';

interface RestockBucket {
  key: string;
  modelGroupKey: string;
  team: string;
  model: string;
  baseModel: string;
  version: 'Player' | 'Fans' | 'Retro';
  player: string;
  size: string;
  currentStock: number;
  inTransitUnits: number;
  maritimeTransitUnits: number;
  airTransitUnits: number;
  earliestMaritimeRemainingDays: number | null;
  earliestAirRemainingDays: number | null;
  earliestTransitRemainingDays: number | null;
  earliestTransitMode: ShippingType | null;
  firstEntryDate: string;
  firstSaleDate: string;
  soldInWindow: number;
  totalHistoricalSold: number;
  lastFallbackCost: number;
  lastCostDate: string;
  searchText: string;
}

export interface RestockBaseRow {
  key: string;
  modelGroupKey: string;
  team: string;
  model: string;
  baseModel: string;
  version: 'Player' | 'Fans' | 'Retro';
  player: string;
  size: string;
  marketKind: ModelMarketKind;
  currentStock: number;
  inTransitUnits: number;
  maritimeTransitUnits: number;
  airTransitUnits: number;
  earliestMaritimeRemainingDays: number | null;
  earliestAirRemainingDays: number | null;
  earliestTransitRemainingDays: number | null;
  earliestTransitMode: ShippingType | null;
  effectiveStock: number;
  effectiveAvailableDays: number;
  soldInWindow: number;
  totalHistoricalSold: number;
  dailyRate: number;
  weeklyRate: number;
  rotationTier: RotationTier;
  stockCoverageDays: number | null;
  effectiveCoverageDays: number | null;
  fallbackUnitCostUsd: number;
  searchText: string;
}

export interface RestockPlanRow extends RestockBaseRow {
  isModelExcluded: boolean;
  isActiveInOrder: boolean;
  suggestedQty: number;
  recommendedVia: ShippingType | null;
  logisticsStatus: LogisticsRecommendation;
  logisticsReason: string;
  seasonWarning: string | null;
  orderQty: number;
  orderShippingVia: ShippingType;
  baseUnitCostUsd: number;
  lineMerchandiseUsd: number;
}

interface ModelGroupCard {
  modelGroupKey: string;
  baseModel: string;
  team: string;
  version: 'Player' | 'Fans' | 'Retro';
  marketKind: ModelMarketKind;
  isExcluded: boolean;
  photoUrl?: string;
  fallbackPhotoUrl?: string;
  seasonWarning: string | null;
  hasHighRotation: boolean;
  hasUrgentAir: boolean;
  totalStock: number;
  totalTransit: number;
  totalOrderQty: number;
  totalMerchandiseUsd: number;
  rows: RestockPlanRow[];
}

interface HistoricalBatchSummary {
  batch: PurchaseBatchRecord;
  sortDate: string;
  totalUnits: number;
  factoryCost: number;
  freightCost: number;
  freightPerUnit: number;
  versionBaseCosts: Partial<Record<'Player' | 'Fans' | 'Retro', number>>;
}

const ANALYSIS_WINDOWS: AnalysisWindowDays[] = [30, 60, 90];
const PLANNING_MODES: Array<{
  id: PlanningMode;
  label: string;
  shortLabel: string;
}> = [
  { id: 'auto', label: 'Auto (Inteligente)', shortLabel: 'Auto' },
  {
    id: 'air',
    label: 'Solo Envío Aéreo (~15-20 días)',
    shortLabel: 'Aéreo (~18d)',
  },
  {
    id: 'maritime',
    label: 'Solo Envío Marítimo (~90 días)',
    shortLabel: 'Marítimo (~90d)',
  },
];
const BUDGET_PRESETS = [300, 350, 500, 800, 1200] as const;
const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const CORE_VERSIONS: Array<'Player' | 'Fans' | 'Retro'> = [
  'Player',
  'Fans',
  'Retro',
];

const MONTH_NAMES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const NATIONAL_TEAM_RE =
  /\b(selecci[oó]n(?:es)?|argentina|brasil|brazil|colombia|venezuela|vinotinto|espa[nñ]a|spain|francia|france|alemania|germany|portugal|inglaterra|england|italia|italy|holanda|pa[ií]ses\s+bajos|netherlands|m[eé]xico|mexico|estados\s+unidos|usa|uruguay|ecuador|chile|per[uú]|jap[oó]n|japan|corea|korea|croacia|croatia|marruecos|morocco|b[eé]lgica|belgium|suiza|polonia|austria|dinamarca|senegal|nigeria)\b/i;

const EUROPEAN_CLUB_RE =
  /\b(real\s+madrid|barcelona|barca|bar[cç]a|atl[eé]tico(?:\s+de)?\s+madrid|atleti|paris\s+saint[\s-]+germain|psg|manchester|man\s+city|man\s+utd|liverpool|arsenal|chelsea|tottenham|spurs|newcastle|aston\s+villa|bayern|borussia\s+dortmund|dortmund|bvb|leverkusen|inter(?:\s+de)?\s+mil[aá]n|internazionale|ac\s+mil[aá]n|milan|juventus|juve|napoli|n[aá]poles|roma|lazio|atalanta|ajax|benfica|porto|oporto|sporting|sevilla|valencia|villarreal|betis|real\s+sociedad|athletic\s+bilbao|lyon|marsella|marseille|monaco|europa|europeo(?:s)?)\b/i;

function norm(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalVer(v: JerseyVersion | string): 'Player' | 'Fans' | 'Retro' {
  const n = normalizeVersionDisplay(v as JerseyVersion);
  if (n === 'Player') return 'Player';
  if (n === 'Retro') return 'Retro';
  return 'Fans';
}

function extractDateOnly(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function parseIsoUtcMs(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

function diffDaysIso(fromIso: string, toIso: string): number {
  const a = parseIsoUtcMs(fromIso);
  const b = parseIsoUtcMs(toIso);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / 86_400_000);
}

function addDaysIso(fromIso: string, days: number): string {
  const base = parseIsoUtcMs(fromIso);
  if (base === null) return fromIso;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function getMonthIndexFromIso(iso: string): number {
  const parts = iso.split('-');
  if (parts.length !== 3) return 0;
  return Math.max(0, Math.min(11, Number(parts[1]) - 1));
}

function classifyModelMarket(
  model: string,
  team: string,
  version: 'Player' | 'Fans' | 'Retro',
): ModelMarketKind {
  if (version === 'Retro') return 'retro';
  const combined = `${team} ${model}`;
  if (NATIONAL_TEAM_RE.test(combined)) return 'national_team';
  if (EUROPEAN_CLUB_RE.test(combined)) return 'european_club';
  return 'other_club';
}

function getSizeRank(size: string): number {
  const idx = STANDARD_SIZES.indexOf(size.toUpperCase());
  return idx >= 0 ? idx : 99;
}

function inferTransitShippingType(batch: PurchaseBatchRecord): ShippingType {
  if (batch.shippingType === 'Marítimo' || batch.shippingType === 'Aéreo') {
    return batch.shippingType;
  }
  const totalUds =
    Number(batch.orderedTotalUnits) ||
    Number(batch.totalUnits) ||
    (batch.items ?? []).reduce(
      (s, it) => s + Math.max(0, Number(it.orderedQuantity ?? it.quantity) || 0),
      0,
    );
  return totalUds >= 35 ? 'Marítimo' : 'Aéreo';
}

function getMarketLabel(kind: ModelMarketKind): string {
  switch (kind) {
    case 'retro':
      return 'Retro / Clásica';
    case 'national_team':
      return 'Selección Nacional';
    case 'european_club':
      return 'Club Europeo';
    default:
      return 'Club Internacional';
  }
}

function pickClosestBatchByBudget(
  candidates: HistoricalBatchSummary[],
  targetBudgetUsd: number,
  predicate?: (b: HistoricalBatchSummary) => boolean,
): HistoricalBatchSummary | null {
  const pool = predicate ? candidates.filter(predicate) : candidates;
  if (pool.length === 0) return null;
  if (targetBudgetUsd <= 0) {
    return pool[0];
  }

  // Prefer the most recent batch within ±20% of target merchandise budget
  const within20 = pool.filter((b) => {
    if (b.factoryCost <= 0) return false;
    return Math.abs(b.factoryCost - targetBudgetUsd) / targetBudgetUsd <= 0.2;
  });
  if (within20.length > 0) {
    return within20[0];
  }

  let best = pool[0];
  let bestDiff = Math.abs(best.factoryCost - targetBudgetUsd);
  for (let i = 1; i < pool.length; i++) {
    const cur = pool[i];
    const diff = Math.abs(cur.factoryCost - targetBudgetUsd);
    if (diff < bestDiff) {
      best = cur;
      bestDiff = diff;
    }
  }
  return best;
}

function pickClosestBatchByUnits(
  candidates: HistoricalBatchSummary[],
  targetUnits: number,
  preferredShipping?: ShippingType,
): HistoricalBatchSummary | null {
  const withFreight = candidates.filter(
    (b) => b.freightCost > 0 && b.totalUnits > 0,
  );
  if (withFreight.length === 0) return null;

  const modePool = preferredShipping
    ? withFreight.filter((b) => b.batch.shippingType === preferredShipping)
    : [];
  const pool = modePool.length > 0 ? modePool : withFreight;

  if (targetUnits <= 0) return pool[0];

  let best = pool[0];
  let bestDiff = Math.abs(best.totalUnits - targetUnits);
  for (let i = 1; i < pool.length; i++) {
    const cur = pool[i];
    const diff = Math.abs(cur.totalUnits - targetUnits);
    if (diff < bestDiff) {
      best = cur;
      bestDiff = diff;
    }
  }
  return best;
}

function resolveModelCardThumbnail(
  rawModelSample: string,
  baseModel: string,
  version: 'Player' | 'Fans' | 'Retro',
  state: AppState,
): { photoUrl?: string; fallbackPhotoUrl?: string } {
  const targetRaw = norm(rawModelSample);
  const targetBase = norm(baseModel);

  const fromInv = (exactVersion: boolean): string | undefined => {
    for (const inv of state.inventory ?? []) {
      const mNorm = norm(inv.model);
      if (mNorm !== targetRaw && mNorm !== targetBase) continue;
      if (exactVersion && canonicalVer(inv.version) !== version) continue;
      const rec = inv as unknown as Record<string, unknown>;
      for (const f of ['image', 'imageUrl', 'photo', 'imagen', 'foto']) {
        const val = rec[f];
        if (typeof val === 'string' && val.trim()) {
          const list = parseCatalogImageList(val);
          if (list[0]) return list[0];
        }
      }
    }
    return undefined;
  };

  const candidates = [
    fromInv(true),
    resolveCatalogPhoto(rawModelSample, version, state.catalogPhotos),
    baseModel !== rawModelSample
      ? resolveCatalogPhoto(baseModel, version, state.catalogPhotos)
      : undefined,
    fromInv(false),
    ...CORE_VERSIONS.filter((v) => v !== version).map((v) =>
      resolveCatalogPhoto(baseModel, v, state.catalogPhotos),
    ),
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const list = parseCatalogImageList(raw);
    const primary = list[0] ?? raw;
    if (primary) {
      return {
        photoUrl: primary,
        fallbackPhotoUrl: obtenerFallbackUrlImagen(primary) ?? undefined,
      };
    }
  }
  return {};
}

function ModelThumb({
  photoUrl,
  fallbackPhotoUrl,
  alt,
}: {
  photoUrl?: string;
  fallbackPhotoUrl?: string;
  alt: string;
}) {
  const [srcIndex, setSrcIndex] = useState(0);
  const sources = [photoUrl, fallbackPhotoUrl].filter(
    (s): s is string => Boolean(s),
  );
  const currentSrc = sources[srcIndex];

  if (!currentSrc) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-500">
        <Shirt className="h-5 w-5" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setSrcIndex((idx) => idx + 1)}
      className="h-11 w-11 shrink-0 rounded-lg border border-slate-200 bg-white object-cover dark:border-slate-700 dark:bg-[#080F1E]"
    />
  );
}

export function RestockAdvisorView({ state }: RestockAdvisorViewProps) {
  const todayIso = useMemo(() => getTodayLocalDateIso(), []);

  const [analysisWindowDays, setAnalysisWindowDays] =
    useState<AnalysisWindowDays>(60);
  const [planningMode, setPlanningMode] = useState<PlanningMode>('auto');
  const [batchReferenceName, setBatchReferenceName] = useState<string>(
    () => `Pedido Reposición ${todayIso}`,
  );

  // Presupuesto mercancía (USDT)
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('fixed');
  const [budgetInput, setBudgetInput] = useState<string>('500');

  // Filtros
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sizeFilter, setSizeFilter] = useState<string>('Todas');

  // Controles de selección y edición del usuario
  const [excludedModels, setExcludedModels] = useState<Record<string, boolean>>(
    {},
  );
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [versionRateOverrides, setVersionRateOverrides] = useState<
    Record<string, number>
  >({});
  const [rowCostOverrides, setRowCostOverrides] = useState<
    Record<string, number>
  >({});
  const [patchByGroup, setPatchByGroup] = useState<Record<string, string>>({});

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [copiedRecently, setCopiedRecently] = useState(false);
  const [isExportingSupplier, setIsExportingSupplier] = useState(false);

  // Calendario logístico (hoy + 18d Aéreo / hoy + 90d Marítimo)
  const calendarForecast = useMemo(() => {
    const airArrivalIso = addDaysIso(todayIso, 18);
    const maritimeArrivalIso = addDaysIso(todayIso, 90);
    const maritimeMonthIdx = getMonthIndexFromIso(maritimeArrivalIso);
    const maritimeMonthName = MONTH_NAMES_ES[maritimeMonthIdx];
    const isEuropeanClosingWindow =
      maritimeMonthIdx === 4 ||
      maritimeMonthIdx === 5 ||
      maritimeMonthIdx === 6;

    return {
      airArrivalIso,
      maritimeArrivalIso,
      maritimeMonthName,
      isEuropeanClosingWindow,
    };
  }, [todayIso]);

  // 1) Motor real de rotación y cruce con Tránsito (state.inventory, state.sales, state.purchaseBatches, state.purchases)
  const baseRows = useMemo<RestockBaseRow[]>(() => {
    const buckets = new Map<string, RestockBucket>();

    const makeKey = (
      baseModel: string,
      player: string,
      ver: 'Player' | 'Fans' | 'Retro',
      size: string,
    ) => `${norm(baseModel)}|${norm(player)}|${ver}|${size}`;

    const considerEarliestDate = (current: string, candidate: string): string => {
      if (!candidate) return current;
      if (!current || candidate < current) return candidate;
      return current;
    };

    const ensureBucket = (
      team: string,
      rawModel: string,
      verRaw: JerseyVersion | string,
      sizeRaw: string,
      explicitPlayer = '',
    ): RestockBucket => {
      const ver = canonicalVer(verRaw);
      const size = String(sizeRaw || '').trim().toUpperCase() || 'M';
      const cleanModel = (rawModel || team || 'Producto').trim();
      const { baseModel, playerLabel } = extractBaseModelAndPlayer(
        cleanModel,
        explicitPlayer,
      );
      const playerDisplay = playerLabel === '无印号' ? '—' : playerLabel;
      const modelGroupKey = `${norm(baseModel)}::${ver}`;
      const key = makeKey(baseModel, playerDisplay, ver, size);

      const existing = buckets.get(key);
      if (existing) {
        if (!existing.team && team.trim()) existing.team = team.trim();
        return existing;
      }

      const created: RestockBucket = {
        key,
        modelGroupKey,
        team: (team || '').trim(),
        model: cleanModel,
        baseModel,
        version: ver,
        player: playerDisplay,
        size,
        currentStock: 0,
        inTransitUnits: 0,
        maritimeTransitUnits: 0,
        airTransitUnits: 0,
        earliestMaritimeRemainingDays: null,
        earliestAirRemainingDays: null,
        earliestTransitRemainingDays: null,
        earliestTransitMode: null,
        firstEntryDate: '',
        firstSaleDate: '',
        soldInWindow: 0,
        totalHistoricalSold: 0,
        lastFallbackCost: 0,
        lastCostDate: '',
        searchText: [
          team,
          cleanModel,
          baseModel,
          ver,
          playerDisplay,
          size,
        ]
          .join(' ')
          .toLowerCase(),
      };
      buckets.set(key, created);
      return created;
    };

    const considerFallbackCost = (
      bucket: RestockBucket,
      unitCost: number,
      dateStr: string,
    ) => {
      const cleanCost = round2(Number(unitCost) || 0);
      if (cleanCost <= 0) return;
      if (!bucket.lastFallbackCost || dateStr >= bucket.lastCostDate) {
        bucket.lastFallbackCost = cleanCost;
        bucket.lastCostDate = dateStr;
      }
    };

    // a) Inventario actual y fechas de lotes FIFO
    for (const inv of state.inventory ?? []) {
      const bucket = ensureBucket(inv.team, inv.model, inv.version, inv.size);
      bucket.currentStock += Math.max(0, Number(inv.stock) || 0);

      for (const fb of inv.fifoBatches ?? []) {
        const entryIso = extractDateOnly(fb.entryDate);
        bucket.firstEntryDate = considerEarliestDate(
          bucket.firstEntryDate,
          entryIso,
        );
        considerFallbackCost(bucket, fb.unitCost, entryIso);
      }
      if (bucket.lastFallbackCost <= 0 && inv.cogs > 0) {
        considerFallbackCost(bucket, inv.cogs, '');
      }
    }

    // b) Compras por lotes (En Tránsito y Recibidas)
    for (const batch of state.purchaseBatches ?? []) {
      const orderDateIso = extractDateOnly(batch.entryDate || batch.createdAt);
      const receivedDateIso = extractDateOnly(batch.receivedDate);
      const isTransit = batch.status === 'EN TRÁNSITO';
      const shippingVia = inferTransitShippingType(batch);
      const elapsedDays = orderDateIso
        ? Math.max(0, diffDaysIso(orderDateIso, todayIso))
        : 0;
      const remainingDays =
        shippingVia === 'Marítimo'
          ? Math.max(0, 90 - elapsedDays)
          : Math.max(0, 18 - elapsedDays);

      for (const it of batch.items ?? []) {
        const bucket = ensureBucket(it.team, it.model, it.version, it.size);
        if (!isTransit) {
          bucket.firstEntryDate = considerEarliestDate(
            bucket.firstEntryDate,
            receivedDateIso || orderDateIso,
          );
        } else {
          const pendingQty = Math.max(
            0,
            Number(it.orderedQuantity ?? it.quantity) || 0,
          );
          if (pendingQty > 0) {
            bucket.inTransitUnits += pendingQty;
            if (shippingVia === 'Marítimo') {
              bucket.maritimeTransitUnits += pendingQty;
              if (
                bucket.earliestMaritimeRemainingDays === null ||
                remainingDays < bucket.earliestMaritimeRemainingDays
              ) {
                bucket.earliestMaritimeRemainingDays = remainingDays;
              }
            } else {
              bucket.airTransitUnits += pendingQty;
              if (
                bucket.earliestAirRemainingDays === null ||
                remainingDays < bucket.earliestAirRemainingDays
              ) {
                bucket.earliestAirRemainingDays = remainingDays;
              }
            }
            if (
              bucket.earliestTransitRemainingDays === null ||
              remainingDays < bucket.earliestTransitRemainingDays
            ) {
              bucket.earliestTransitRemainingDays = remainingDays;
              bucket.earliestTransitMode = shippingVia;
            }
          }
        }

        const factoryBase =
          Number(it.factoryUnitCost) > 0
            ? Number(it.factoryUnitCost)
            : Math.max(
                0,
                (Number(it.landedUnitCost) || 0) -
                  (Number(it.proratedFreightPerUnit) || 0),
              );
        considerFallbackCost(
          bucket,
          factoryBase,
          receivedDateIso || orderDateIso,
        );
      }
    }

    // c) Historial plano state.purchases
    for (const pur of state.purchases ?? []) {
      const purDate = extractDateOnly(pur.createdAt);
      const bucket = ensureBucket(pur.team, pur.model, pur.version, pur.size);
      bucket.firstEntryDate = considerEarliestDate(
        bucket.firstEntryDate,
        purDate,
      );
      if (bucket.lastFallbackCost <= 0 && pur.unitCostWithFreight > 0) {
        considerFallbackCost(bucket, pur.unitCostWithFreight, purDate);
      }
    }

    // Propagar primera fecha de entrada a nivel modelo+versión si alguna talla nueva comparte lote
    const modelFirstEntry = new Map<string, string>();
    for (const b of buckets.values()) {
      if (b.firstEntryDate) {
        const prev = modelFirstEntry.get(b.modelGroupKey) ?? '';
        if (!prev || b.firstEntryDate < prev) {
          modelFirstEntry.set(b.modelGroupKey, b.firstEntryDate);
        }
      }
    }

    // d) Ventas reales (excluyendo anuladas)
    const windowCutoffIso = addDaysIso(todayIso, -analysisWindowDays);

    for (const sale of state.sales ?? []) {
      if (sale.voided) continue;
      const saleDateIso =
        extractDateOnly(sale.saleDate || sale.createdAt) || todayIso;

      const lines =
        sale.items && sale.items.length > 0
          ? sale.items
          : [
              {
                team: sale.team,
                modelLabel: sale.modelLabel,
                version: sale.version,
                size: sale.size,
                quantity: sale.quantity,
                unitCogs: sale.unitCogs,
              },
            ];

      for (const line of lines) {
        const qty = Math.max(0, Number(line.quantity) || 0);
        if (qty <= 0) continue;
        const bucket = ensureBucket(
          line.team || sale.team,
          line.modelLabel || sale.modelLabel,
          line.version || sale.version,
          line.size || sale.size,
        );
        bucket.totalHistoricalSold += qty;
        bucket.firstSaleDate = considerEarliestDate(
          bucket.firstSaleDate,
          saleDateIso,
        );
        if (saleDateIso >= windowCutoffIso && saleDateIso <= todayIso) {
          bucket.soldInWindow += qty;
        }
        if (bucket.lastFallbackCost <= 0 && (line.unitCogs ?? 0) > 0) {
          considerFallbackCost(bucket, line.unitCogs, saleDateIso);
        }
      }
    }

    // e) Calcular velocidad real sobre días efectivos disponibles y filtro estricto de Alta Rotación
    const rows: RestockBaseRow[] = [];
    for (const b of buckets.values()) {
      const originDate =
        b.firstEntryDate ||
        modelFirstEntry.get(b.modelGroupKey) ||
        b.firstSaleDate ||
        windowCutoffIso;

      const daysSinceOrigin = Math.max(1, diffDaysIso(originDate, todayIso));
      const effectiveAvailableDays = Math.max(
        1,
        Math.min(analysisWindowDays, daysSinceOrigin),
      );

      const dailyRate = b.soldInWindow / effectiveAvailableDays;
      const weeklyRate = Math.round(dailyRate * 7 * 10) / 10;

      // Regla estricta: Alta Rotación SOLO si >= 1 ud/semana (>= 1 cada <= 7d) Y >= 3 unidades vendidas en historial
      let rotationTier: RotationTier = 'low';
      if (weeklyRate >= 1.0 && b.totalHistoricalSold >= 3) {
        rotationTier = 'high';
      } else if (
        b.soldInWindow > 0 &&
        (weeklyRate >= 0.35 || b.totalHistoricalSold >= 2)
      ) {
        rotationTier = 'medium';
      }

      const effectiveStock = b.currentStock + b.inTransitUnits;
      const stockCoverageDays =
        dailyRate > 0
          ? Math.round(b.currentStock / dailyRate)
          : b.currentStock > 0
            ? null
            : 0;
      const effectiveCoverageDays =
        dailyRate > 0
          ? Math.round(effectiveStock / dailyRate)
          : effectiveStock > 0
            ? null
            : 0;

      rows.push({
        key: b.key,
        modelGroupKey: b.modelGroupKey,
        team: b.team,
        model: b.model,
        baseModel: b.baseModel,
        version: b.version,
        player: b.player,
        size: b.size,
        marketKind: classifyModelMarket(b.baseModel, b.team, b.version),
        currentStock: b.currentStock,
        inTransitUnits: b.inTransitUnits,
        maritimeTransitUnits: b.maritimeTransitUnits,
        airTransitUnits: b.airTransitUnits,
        earliestMaritimeRemainingDays: b.earliestMaritimeRemainingDays,
        earliestAirRemainingDays: b.earliestAirRemainingDays,
        earliestTransitRemainingDays: b.earliestTransitRemainingDays,
        earliestTransitMode: b.earliestTransitMode,
        effectiveStock,
        effectiveAvailableDays,
        soldInWindow: b.soldInWindow,
        totalHistoricalSold: b.totalHistoricalSold,
        dailyRate,
        weeklyRate,
        rotationTier,
        stockCoverageDays,
        effectiveCoverageDays,
        fallbackUnitCostUsd: round2(b.lastFallbackCost),
        searchText: b.searchText,
      });
    }

    rows.sort((a, b) => {
      const mComp = a.baseModel.localeCompare(b.baseModel);
      if (mComp !== 0) return mComp;
      const vComp = a.version.localeCompare(b.version);
      if (vComp !== 0) return vComp;
      const sComp = getSizeRank(a.size) - getSizeRank(b.size);
      if (sComp !== 0) return sComp;
      return a.player.localeCompare(b.player);
    });

    return rows;
  }, [
    analysisWindowDays,
    state.inventory,
    state.purchaseBatches,
    state.purchases,
    state.sales,
    todayIso,
  ]);

  // 2) Historial de lotes para tarifas base (Player, Fans, Retro) y cálculo de envío por separado
  const historicalBatches = useMemo<HistoricalBatchSummary[]>(() => {
    const list: HistoricalBatchSummary[] = [];
    for (const batch of state.purchaseBatches ?? []) {
      if (!batch.items || batch.items.length === 0) continue;

      const versionSums: Record<
        'Player' | 'Fans' | 'Retro',
        { costSum: number; qtySum: number }
      > = {
        Player: { costSum: 0, qtySum: 0 },
        Fans: { costSum: 0, qtySum: 0 },
        Retro: { costSum: 0, qtySum: 0 },
      };

      let computedUnits = 0;
      let computedFactoryTotal = 0;

      for (const it of batch.items) {
        const qty = Math.max(
          0,
          Number(it.receivedQuantity ?? it.orderedQuantity ?? it.quantity) || 0,
        );
        if (qty <= 0) continue;
        const ver = canonicalVer(it.version);
        const factoryUnit =
          Number(it.factoryUnitCost) > 0
            ? round2(Number(it.factoryUnitCost))
            : Math.max(
                0,
                round2(
                  (Number(it.landedUnitCost) || 0) -
                    (Number(it.proratedFreightPerUnit) || 0),
                ),
              );
        if (factoryUnit <= 0) continue;

        computedUnits += qty;
        computedFactoryTotal += qty * factoryUnit;
        versionSums[ver].costSum += qty * factoryUnit;
        versionSums[ver].qtySum += qty;
      }

      const totalUnits =
        batch.totalUnits > 0 ? batch.totalUnits : computedUnits;
      const factoryCost =
        batch.totalFactoryCost > 0
          ? round2(batch.totalFactoryCost)
          : round2(computedFactoryTotal);
      if (totalUnits <= 0 || factoryCost <= 0) continue;

      const freightCost =
        batch.status === 'RECIBIDO EN BODEGA'
          ? round2(
              Math.max(
                0,
                Number(batch.totalFreightCost) ||
                  Number(batch.estimatedFreightCost) ||
                  0,
              ),
            )
          : 0;

      const versionBaseCosts: Partial<
        Record<'Player' | 'Fans' | 'Retro', number>
      > = {};
      for (const ver of CORE_VERSIONS) {
        if (versionSums[ver].qtySum > 0) {
          versionBaseCosts[ver] = round2(
            versionSums[ver].costSum / versionSums[ver].qtySum,
          );
        }
      }

      const sortDate = extractDateOnly(
        batch.receivedDate || batch.entryDate || batch.createdAt,
      );

      list.push({
        batch,
        sortDate,
        totalUnits,
        factoryCost,
        freightCost,
        freightPerUnit: totalUnits > 0 ? freightCost / totalUnits : 0,
        versionBaseCosts,
      });
    }

    list.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
    return list;
  }, [state.purchaseBatches]);

  const parsedFixedBudgetUsd = useMemo(() => {
    const n = Number(budgetInput);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  }, [budgetInput]);

  // 3) Tarifas base de Player, Fans, Retro extraídas de state.purchases / purchaseBatches
  const benchmarkPricing = useMemo(() => {
    const targetBudgetUsd =
      budgetMode === 'fixed' && parsedFixedBudgetUsd > 0
        ? parsedFixedBudgetUsd
        : 500;

    const primaryBatch = pickClosestBatchByBudget(
      historicalBatches,
      targetBudgetUsd,
    );

    const fifoAvgByVersion: Partial<
      Record<'Player' | 'Fans' | 'Retro', number>
    > = {};
    const acc: Record<
      'Player' | 'Fans' | 'Retro',
      { sum: number; count: number }
    > = {
      Player: { sum: 0, count: 0 },
      Fans: { sum: 0, count: 0 },
      Retro: { sum: 0, count: 0 },
    };

    for (const r of baseRows) {
      if (r.fallbackUnitCostUsd > 0) {
        acc[r.version].sum += r.fallbackUnitCostUsd;
        acc[r.version].count += 1;
      }
    }
    for (const pur of state.purchases ?? []) {
      const ver = canonicalVer(pur.version);
      if (acc[ver].count === 0 && pur.unitCostWithFreight > 0) {
        acc[ver].sum += pur.unitCostWithFreight;
        acc[ver].count += 1;
      }
    }
    for (const ver of CORE_VERSIONS) {
      if (acc[ver].count > 0) {
        fifoAvgByVersion[ver] = round2(acc[ver].sum / acc[ver].count);
      }
    }

    const versionRates: Record<'Player' | 'Fans' | 'Retro', number> = {
      Player: 0,
      Fans: 0,
      Retro: 0,
    };
    const versionSources: Record<'Player' | 'Fans' | 'Retro', string> = {
      Player: 'Editable manual',
      Fans: 'Editable manual',
      Retro: 'Editable manual',
    };

    for (const ver of CORE_VERSIONS) {
      const primaryCost = primaryBatch?.versionBaseCosts[ver] ?? 0;
      if (primaryBatch && primaryCost > 0) {
        versionRates[ver] = primaryCost;
        versionSources[ver] = primaryBatch.batch.referenceName;
      } else {
        const alt = pickClosestBatchByBudget(
          historicalBatches,
          targetBudgetUsd,
          (b) => (b.versionBaseCosts[ver] ?? 0) > 0,
        );
        if (alt && (alt.versionBaseCosts[ver] ?? 0) > 0) {
          versionRates[ver] = alt.versionBaseCosts[ver]!;
          versionSources[ver] = alt.batch.referenceName;
        } else if ((fifoAvgByVersion[ver] ?? 0) > 0) {
          versionRates[ver] = fifoAvgByVersion[ver]!;
          versionSources[ver] = 'Último costo FIFO';
        }
      }
    }

    return {
      primaryBatch,
      versionRates,
      versionSources,
    };
  }, [
    baseRows,
    budgetMode,
    historicalBatches,
    parsedFixedBudgetUsd,
    state.purchases,
  ]);

  // Modelos donde TODAS las tallas son Rotación Lenta / Baja -> desactivados por defecto (0 pzs · $0.00)
  const lowRotationOnlyModels = useMemo(() => {
    const byGroup = new Map<string, RestockBaseRow[]>();
    for (const r of baseRows) {
      const list = byGroup.get(r.modelGroupKey) ?? [];
      list.push(r);
      byGroup.set(r.modelGroupKey, list);
    }
    const result: Record<string, boolean> = {};
    for (const [groupKey, list] of byGroup.entries()) {
      result[groupKey] =
        list.length > 0 && list.every((r) => r.rotationTier === 'low');
    }
    return result;
  }, [baseRows]);

  // 4) Motor de decisión logística (Aéreo ~18d vs Marítimo ~90d + Temporada Europea + Tránsito)
  const planRows = useMemo<RestockPlanRow[]>(() => {
    return baseRows.map((row) => {
      const defaultExcluded = Boolean(lowRotationOnlyModels[row.modelGroupKey]);
      const isModelExcluded =
        excludedModels[row.modelGroupKey] !== undefined
          ? excludedModels[row.modelGroupKey]
          : defaultExcluded;

      const seasonBlocked =
        calendarForecast.isEuropeanClosingWindow &&
        row.marketKind === 'european_club';
      const seasonWarning = seasonBlocked
        ? `⚠️ Llegaría en ${calendarForecast.maritimeMonthName} (cierre de temporada europea) — No conviene barco`
        : null;

      let suggestedQty = 0;
      let recommendedVia: ShippingType | null = null;
      let logisticsStatus: LogisticsRecommendation = 'low_rotation';
      let logisticsReason = 'Rotación lenta / baja';

      const stockCov = row.stockCoverageDays;
      const effCov = row.effectiveCoverageDays;
      const isCriticalStock =
        row.currentStock === 0 || (stockCov !== null && stockCov < 20);

      // Caso A: Ya viene en barco en tránsito
      if (row.maritimeTransitUnits > 0) {
        const remDays = row.earliestMaritimeRemainingDays ?? 80;
        const airAlreadyEnough =
          row.dailyRate > 0 &&
          row.currentStock + row.airTransitUnits >= row.dailyRate * remDays;
        const runsOutBeforeShip =
          row.currentStock === 0 ||
          (stockCov !== null && stockCov < remDays);

        if (
          row.rotationTier === 'high' &&
          runsOutBeforeShip &&
          isCriticalStock &&
          !airAlreadyEnough &&
          planningMode !== 'maritime'
        ) {
          const bridgeDays = Math.min(remDays, 25);
          const bridgeUnits = Math.max(
            1,
            Math.ceil(
              row.dailyRate * bridgeDays -
                (row.currentStock + row.airTransitUnits),
            ),
          );
          suggestedQty = bridgeUnits;
          recommendedVia = 'Aéreo';
          logisticsStatus = 'urgent_air_bridge';
          logisticsReason = `Puente Aéreo (${bridgeDays}d hasta llegada del barco en ~${remDays}d)`;
        } else {
          suggestedQty = 0;
          recommendedVia = null;
          logisticsStatus = 'in_transit_covered';
          logisticsReason = `Ya viene en barco · llega en ~${remDays} días`;
        }
      } else if (planningMode === 'air') {
        // Solo Aéreo: reservado EXCLUSIVAMENTE para Alta Rotación crítica (<20d o agotada)
        if (row.rotationTier === 'high' && isCriticalStock) {
          const airEffStock = row.currentStock + row.airTransitUnits;
          const airEffCov =
            row.dailyRate > 0 ? airEffStock / row.dailyRate : 0;
          if (airEffCov < 20) {
            suggestedQty = Math.max(
              1,
              Math.ceil(row.dailyRate * 25 - airEffStock),
            );
            recommendedVia = 'Aéreo';
            logisticsStatus = 'urgent_air';
            logisticsReason =
              row.currentStock === 0
                ? 'Agotada · Alta Rotación (Urgente Aéreo)'
                : `Cobertura ${stockCov ?? 0}d (<20d) · Alta Rotación`;
          } else {
            suggestedQty = 0;
            logisticsStatus = 'in_transit_covered';
            logisticsReason = `Cubierto con aéreo en camino (~${row.earliestAirRemainingDays ?? 18}d)`;
          }
        } else if (row.rotationTier === 'high') {
          suggestedQty = 0;
          logisticsStatus = 'healthy';
          logisticsReason = `Cobertura ${stockCov ?? '∞'}d (no requiere avión)`;
        } else {
          suggestedQty = 0;
          logisticsStatus =
            row.rotationTier === 'medium' ? 'healthy' : 'low_rotation';
          logisticsReason =
            row.rotationTier === 'medium'
              ? 'Rotación media (avión solo para Alta Rotación crítica)'
              : 'Rotación lenta / baja (no aplica avión)';
        }
      } else if (planningMode === 'maritime') {
        if (row.rotationTier === 'low') {
          suggestedQty = 0;
          logisticsStatus = 'low_rotation';
          logisticsReason = 'Rotación lenta / baja';
        } else if (seasonBlocked) {
          suggestedQty = 0;
          logisticsStatus = 'season_blocked';
          logisticsReason = seasonWarning!;
        } else if (effCov !== null && effCov < 60) {
          suggestedQty = Math.max(
            1,
            Math.ceil(row.dailyRate * 90 - row.effectiveStock),
          );
          recommendedVia = 'Marítimo';
          logisticsStatus = 'plan_maritime';
          logisticsReason = `Planificar Marítimo (~90d tránsito)`;
        } else {
          suggestedQty = 0;
          logisticsStatus = 'healthy';
          logisticsReason = 'Stock saludable';
        }
      } else {
        // Modo Auto (Inteligente):
        // 1) Avión solo si Alta Rotación + cobertura crítica (<20d o agotada) y aire en camino no cubre
        const airEffStock = row.currentStock + row.airTransitUnits;
        const airEffCov =
          row.dailyRate > 0 ? airEffStock / row.dailyRate : 999;

        if (
          row.rotationTier === 'high' &&
          isCriticalStock &&
          (row.currentStock === 0 || airEffCov < 20)
        ) {
          suggestedQty = Math.max(
            1,
            Math.ceil(row.dailyRate * 25 - airEffStock),
          );
          recommendedVia = 'Aéreo';
          logisticsStatus = 'urgent_air';
          logisticsReason =
            row.currentStock === 0
              ? 'Agotada · Alta Rotación (Urgente Aéreo)'
              : `Cobertura ${stockCov ?? 0}d (<20d) · Urgente Aéreo`;
        } else if (row.rotationTier === 'low') {
          suggestedQty = 0;
          logisticsStatus = 'low_rotation';
          logisticsReason = 'Rotación lenta / baja';
        } else if (effCov !== null && effCov < 45) {
          if (seasonBlocked) {
            suggestedQty = 0;
            logisticsStatus = 'season_blocked';
            logisticsReason = seasonWarning!;
          } else {
            suggestedQty = Math.max(
              1,
              Math.ceil(row.dailyRate * 75 - row.effectiveStock),
            );
            recommendedVia = 'Marítimo';
            logisticsStatus = 'plan_maritime';
            logisticsReason = 'Planificar Marítimo (~90d tránsito)';
          }
        } else {
          suggestedQty = 0;
          logisticsStatus = 'healthy';
          logisticsReason = 'Stock saludable';
        }
      }

      const rawQty =
        qtyOverrides[row.key] !== undefined
          ? qtyOverrides[row.key]
          : suggestedQty;
      const orderQty = isModelExcluded ? 0 : Math.max(0, Math.floor(rawQty));

      const versionPrice =
        versionRateOverrides[row.version] ??
        benchmarkPricing.versionRates[row.version] ??
        0;
      const defaultBaseCost =
        versionPrice > 0 ? versionPrice : row.fallbackUnitCostUsd;

      const baseUnitCostUsd = round2(
        rowCostOverrides[row.key] !== undefined
          ? rowCostOverrides[row.key]
          : defaultBaseCost,
      );

      const orderShippingVia: ShippingType =
        planningMode === 'air'
          ? 'Aéreo'
          : planningMode === 'maritime'
            ? 'Marítimo'
            : recommendedVia ?? 'Marítimo';

      const isActiveInOrder = !isModelExcluded && orderQty > 0;
      const lineMerchandiseUsd = isActiveInOrder
        ? round2(orderQty * baseUnitCostUsd)
        : 0;

      return {
        ...row,
        isModelExcluded,
        isActiveInOrder,
        suggestedQty,
        recommendedVia,
        logisticsStatus,
        logisticsReason,
        seasonWarning,
        orderQty,
        orderShippingVia,
        baseUnitCostUsd,
        lineMerchandiseUsd,
      };
    });
  }, [
    baseRows,
    benchmarkPricing.versionRates,
    calendarForecast,
    excludedModels,
    lowRotationOnlyModels,
    planningMode,
    qtyOverrides,
    rowCostOverrides,
    versionRateOverrides,
  ]);

  const availableSizes = useMemo(() => {
    const extras = new Set<string>();
    for (const r of planRows) {
      if (r.size && !STANDARD_SIZES.includes(r.size)) {
        extras.add(r.size);
      }
    }
    return ['Todas', ...STANDARD_SIZES, ...Array.from(extras).sort()];
  }, [planRows]);

  const baseFilteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return planRows.filter((row) => {
      if (sizeFilter !== 'Todas' && row.size !== sizeFilter) return false;
      if (q && !row.searchText.includes(q)) return false;
      return true;
    });
  }, [planRows, searchQuery, sizeFilter]);

  const pillCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: baseFilteredRows.length,
      suggested: 0,
      high_rotation: 0,
      urgent_air: 0,
      plan_maritime: 0,
      in_transit: 0,
      low_rotation: 0,
    };
    for (const r of baseFilteredRows) {
      if (r.orderQty > 0) counts.suggested += 1;
      if (r.rotationTier === 'high') counts.high_rotation += 1;
      if (
        r.logisticsStatus === 'urgent_air' ||
        r.logisticsStatus === 'urgent_air_bridge'
      ) {
        counts.urgent_air += 1;
      }
      if (r.logisticsStatus === 'plan_maritime') counts.plan_maritime += 1;
      if (r.inTransitUnits > 0) counts.in_transit += 1;
      if (r.rotationTier === 'low') counts.low_rotation += 1;
    }
    return counts;
  }, [baseFilteredRows]);

  const filteredRows = useMemo(() => {
    switch (statusFilter) {
      case 'suggested':
        return baseFilteredRows.filter((r) => r.orderQty > 0);
      case 'high_rotation':
        return baseFilteredRows.filter((r) => r.rotationTier === 'high');
      case 'urgent_air':
        return baseFilteredRows.filter(
          (r) =>
            r.logisticsStatus === 'urgent_air' ||
            r.logisticsStatus === 'urgent_air_bridge',
        );
      case 'plan_maritime':
        return baseFilteredRows.filter(
          (r) => r.logisticsStatus === 'plan_maritime',
        );
      case 'in_transit':
        return baseFilteredRows.filter((r) => r.inTransitUnits > 0);
      case 'low_rotation':
        return baseFilteredRows.filter((r) => r.rotationTier === 'low');
      default:
        return baseFilteredRows;
    }
  }, [baseFilteredRows, statusFilter]);

  // Agrupación limpia por Modelo + Versión en Tarjetas
  const modelCards = useMemo<ModelGroupCard[]>(() => {
    const map = new Map<string, RestockPlanRow[]>();
    for (const r of filteredRows) {
      const list = map.get(r.modelGroupKey) ?? [];
      list.push(r);
      map.set(r.modelGroupKey, list);
    }

    const cards: ModelGroupCard[] = [];
    for (const [groupKey, rawRows] of map.entries()) {
      const rows = [...rawRows].sort((a, b) => {
        const aSelected = a.orderQty > 0 ? 1 : 0;
        const bSelected = b.orderQty > 0 ? 1 : 0;
        if (bSelected !== aSelected) return bSelected - aSelected;
        const sComp = getSizeRank(a.size) - getSizeRank(b.size);
        if (sComp !== 0) return sComp;
        return a.player.localeCompare(b.player);
      });
      const first = rows[0];
      const thumbs = resolveModelCardThumbnail(
        first.model,
        first.baseModel,
        first.version,
        state,
      );
      const seasonWarning =
        rows.find((r) => r.seasonWarning)?.seasonWarning ?? null;
      const totalOrderQty = rows.reduce((s, r) => s + r.orderQty, 0);
      const totalMerchandiseUsd = round2(
        rows.reduce((s, r) => s + r.lineMerchandiseUsd, 0),
      );
      const isExcluded =
        excludedModels[groupKey] !== undefined
          ? excludedModels[groupKey]
          : Boolean(lowRotationOnlyModels[groupKey]);

      cards.push({
        modelGroupKey: groupKey,
        baseModel: first.baseModel,
        team: first.team,
        version: first.version,
        marketKind: first.marketKind,
        isExcluded,
        photoUrl: thumbs.photoUrl,
        fallbackPhotoUrl: thumbs.fallbackPhotoUrl,
        seasonWarning,
        hasHighRotation: rows.some((r) => r.rotationTier === 'high'),
        hasUrgentAir: rows.some(
          (r) =>
            r.logisticsStatus === 'urgent_air' ||
            r.logisticsStatus === 'urgent_air_bridge',
        ),
        totalStock: rows.reduce((s, r) => s + r.currentStock, 0),
        totalTransit: rows.reduce((s, r) => s + r.inTransitUnits, 0),
        totalOrderQty,
        totalMerchandiseUsd,
        rows,
      });
    }

    cards.sort((a, b) => {
      const aActiveOrder = !a.isExcluded && a.totalOrderQty > 0;
      const bActiveOrder = !b.isExcluded && b.totalOrderQty > 0;
      if (aActiveOrder !== bActiveOrder) return aActiveOrder ? -1 : 1;

      if (aActiveOrder && bActiveOrder) {
        if (b.totalOrderQty !== a.totalOrderQty) {
          return b.totalOrderQty - a.totalOrderQty;
        }
        if (a.hasUrgentAir !== b.hasUrgentAir) {
          return a.hasUrgentAir ? -1 : 1;
        }
        if (a.hasHighRotation !== b.hasHighRotation) {
          return a.hasHighRotation ? -1 : 1;
        }
        return a.baseModel.localeCompare(b.baseModel);
      }

      if (a.isExcluded !== b.isExcluded) return a.isExcluded ? 1 : -1;
      if (a.hasHighRotation !== b.hasHighRotation) {
        return a.hasHighRotation ? -1 : 1;
      }
      return a.baseModel.localeCompare(b.baseModel);
    });

    return cards;
  }, [excludedModels, filteredRows, lowRotationOnlyModels, state]);

  // Totales del pedido activo (SOLO mercancía)
  const selectedOrderLines = useMemo(
    () => planRows.filter((r) => r.isActiveInOrder),
    [planRows],
  );

  const selectedUnitsTotal = useMemo(
    () => selectedOrderLines.reduce((sum, r) => sum + r.orderQty, 0),
    [selectedOrderLines],
  );

  const merchandiseSubtotalUsd = useMemo(
    () =>
      round2(
        selectedOrderLines.reduce((sum, r) => sum + r.lineMerchandiseUsd, 0),
      ),
    [selectedOrderLines],
  );

  const supplierOrderGroups = useMemo(
    () =>
      buildSupplierOrderGroups(
        selectedOrderLines.map((r) => ({
          team: r.team,
          model: r.model,
          version: r.version,
          player: r.player,
          size: r.size,
          orderQty: r.orderQty,
        })),
        state,
      ),
    [selectedOrderLines, state],
  );

  // Envío estimado de referencia por separado (lotes históricos de cantidad similar)
  const referenceShippingEstimate = useMemo(() => {
    const preferredShip: ShippingType | undefined =
      planningMode === 'air'
        ? 'Aéreo'
        : planningMode === 'maritime'
          ? 'Marítimo'
          : undefined;
    const refBatch = pickClosestBatchByUnits(
      historicalBatches,
      selectedUnitsTotal,
      preferredShip,
    );
    if (!refBatch || refBatch.freightPerUnit <= 0) {
      return {
        amountUsd: 0,
        perUnitUsd: 0,
        refBatchName: null as string | null,
        refBatchUnits: 0,
        refBatchShipping: null as ShippingType | null,
      };
    }
    return {
      amountUsd: round2(refBatch.freightPerUnit * selectedUnitsTotal),
      perUnitUsd: round2(refBatch.freightPerUnit),
      refBatchName: refBatch.batch.referenceName,
      refBatchUnits: refBatch.totalUnits,
      refBatchShipping: refBatch.batch.shippingType,
    };
  }, [historicalBatches, planningMode, selectedUnitsTotal]);

  const activeTargetBudgetUsd =
    budgetMode === 'auto' ? merchandiseSubtotalUsd : parsedFixedBudgetUsd;

  const budgetStatusInfo = useMemo(() => {
    if (budgetMode === 'auto') {
      return {
        tone: 'info' as const,
        text: `Modo Auto · ${selectedUnitsTotal} franelas · Mercancía ${formatUSD(merchandiseSubtotalUsd)} (sin envío)`,
      };
    }
    if (activeTargetBudgetUsd <= 0) {
      return {
        tone: 'neutral' as const,
        text: `${selectedUnitsTotal} franelas activas · Ingresa un presupuesto en USDT`,
      };
    }
    const diff = round2(activeTargetBudgetUsd - merchandiseSubtotalUsd);
    if (diff >= 0) {
      return {
        tone: 'ok' as const,
        text: `Dentro de presupuesto · ${selectedUnitsTotal} franelas · sobran ${formatUSD(diff)} en mercancía`,
      };
    }
    return {
      tone: 'over' as const,
      text: `Excede presupuesto de mercancía por ${formatUSD(Math.abs(diff))} · ${selectedUnitsTotal} franelas`,
    };
  }, [
    activeTargetBudgetUsd,
    budgetMode,
    merchandiseSubtotalUsd,
    selectedUnitsTotal,
  ]);

  const kpis = useMemo(() => {
    let highRotCount = 0;
    let urgentAirCount = 0;
    let urgentAirUnits = 0;
    let maritimeCount = 0;
    let activeTransitUnits = 0;
    const allModels = new Set<string>();
    const activeModels = new Set<string>();

    for (const r of planRows) {
      allModels.add(r.modelGroupKey);
      if (!r.isModelExcluded && r.orderQty > 0) {
        activeModels.add(r.modelGroupKey);
      }
      if (r.rotationTier === 'high') highRotCount += 1;
      if (
        r.logisticsStatus === 'urgent_air' ||
        r.logisticsStatus === 'urgent_air_bridge'
      ) {
        urgentAirCount += 1;
        urgentAirUnits += r.orderQty;
      } else if (r.logisticsStatus === 'plan_maritime') {
        maritimeCount += 1;
      }
      activeTransitUnits += r.inTransitUnits;
    }

    return {
      highRotCount,
      urgentAirCount,
      urgentAirUnits,
      maritimeCount,
      activeTransitUnits,
      activeModelsCount: activeModels.size,
      totalModelsCount: allModels.size,
    };
  }, [planRows]);

  const replacementFundBalance = round2(state.funds?.replacement ?? 0);
  const cashOnHandBalance = round2(state.cashOnHand ?? 0);

  const hasCustomEdits =
    Object.keys(excludedModels).length > 0 ||
    Object.keys(qtyOverrides).length > 0 ||
    Object.keys(versionRateOverrides).length > 0 ||
    Object.keys(rowCostOverrides).length > 0;

  // Handlers de edición
  const handleToggleExcludeModel = (
    modelGroupKey: string,
    currentExcluded: boolean,
  ) => {
    setExcludedModels((prev) => ({
      ...prev,
      [modelGroupKey]: !currentExcluded,
    }));
  };

  const handleStepRowQty = (row: RestockPlanRow, delta: number) => {
    const nextQty = Math.max(0, row.orderQty + delta);
    if (row.isModelExcluded && delta > 0) {
      setExcludedModels((prev) => ({ ...prev, [row.modelGroupKey]: false }));
    }
    setQtyOverrides((prev) => ({ ...prev, [row.key]: nextQty }));
  };

  const handleChangeRowQty = (row: RestockPlanRow, rawVal: string) => {
    const parsed = Math.max(0, Math.floor(Number(rawVal) || 0));
    if (row.isModelExcluded && parsed > 0) {
      setExcludedModels((prev) => ({ ...prev, [row.modelGroupKey]: false }));
    }
    setQtyOverrides((prev) => ({ ...prev, [row.key]: parsed }));
  };

  const handleChangeVersionRate = (
    ver: 'Player' | 'Fans' | 'Retro',
    rawVal: string,
  ) => {
    const parsed = Math.max(0, round2(Number(rawVal) || 0));
    setVersionRateOverrides((prev) => ({ ...prev, [ver]: parsed }));
    setRowCostOverrides((prev) => {
      const next = { ...prev };
      for (const r of baseRows) {
        if (r.version === ver) {
          delete next[r.key];
        }
      }
      return next;
    });
  };

  const handleChangeRowCost = (row: RestockPlanRow, rawVal: string) => {
    const parsed = Math.max(0, round2(Number(rawVal) || 0));
    setRowCostOverrides((prev) => ({ ...prev, [row.key]: parsed }));
  };

  const handleResetEdits = () => {
    setExcludedModels({});
    setQtyOverrides({});
    setVersionRateOverrides({});
    setRowCostOverrides({});
    setFeedback({
      type: 'success',
      text: 'Modelos incluidos, cantidades sugeridas y tarifas base restablecidos.',
    });
  };

  // Botón WhatsApp (CERO precios)
  const handleCopySupplierList = async () => {
    setFeedback(null);
    if (selectedOrderLines.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Incluye al menos 1 talla con cantidad mayor a 0 para copiar la lista del proveedor.',
      });
      return;
    }

    const lines = selectedOrderLines.map((r, idx) => {
      const playerPart = r.player !== '—' ? ` · ${r.player}` : '';
      return `${idx + 1}. ${r.baseModel} · ${r.version}${playerPart} · Talla ${r.size} — ${r.orderQty} uds`;
    });

    const text = [
      `*ORDEN DE PEDIDO X4SPORT*`,
      `Referencia: ${batchReferenceName.trim() || `Pedido ${todayIso}`}`,
      ...lines,
      `Total piezas: ${selectedUnitsTotal} franelas`,
    ].join('\n');

    try {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedRecently(true);
      setTimeout(() => setCopiedRecently(false), 2500);
      setFeedback({
        type: 'success',
        text: `Lista proveedor copiada (${selectedOrderLines.length} líneas · ${selectedUnitsTotal} piezas, sin precios).`,
      });
    } catch {
      setFeedback({
        type: 'error',
        text: 'No se pudo copiar automáticamente al portapapeles.',
      });
    }
  };

  // Botón Excel Matricial Chino con Fotos (CERO precios)
  const handleDownloadSupplierOrder = async () => {
    setFeedback(null);
    if (selectedOrderLines.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Incluye al menos 1 talla con cantidad mayor a 0 antes de descargar la orden del proveedor.',
      });
      return;
    }

    setIsExportingSupplier(true);
    try {
      const result = await exportSupplierOrderExcel({
        lines: selectedOrderLines.map((r) => ({
          team: r.team,
          model: r.model,
          version: r.version,
          player: r.player,
          size: r.size,
          orderQty: r.orderQty,
        })),
        state,
        patchByGroup,
        todayIso,
      });
      setFeedback({
        type: 'success',
        text: `Orden matricial "${result.fileName}" descargada (${result.groupsCount} modelo(s) · ${result.totalUnits} piezas · ${result.embeddedPhotosCount} foto(s) incrustada(s), sin precios).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error && err.message
            ? err.message
            : 'No se pudo generar el archivo Excel matricial para proveedor.',
      });
    } finally {
      setIsExportingSupplier(false);
    }
  };

  // Botón Cargas Masivas (.xlsx) -> Estado 'En Tránsito', Costo Unitario Base SIN envío
  const handleDownloadBulkUploadOrder = () => {
    setFeedback(null);
    if (typeof window === 'undefined' || !window.XLSX) {
      setFeedback({
        type: 'error',
        text: 'La librería SheetJS (xlsx) aún está cargando o no está disponible sin conexión.',
      });
      return;
    }
    if (selectedOrderLines.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Incluye al menos 1 talla con cantidad mayor a 0 para exportar a Cargas Masivas.',
      });
      return;
    }
    const zeroCostLine = selectedOrderLines.find((r) => r.baseUnitCostUsd <= 0);
    if (zeroCostLine) {
      setFeedback({
        type: 'error',
        text: `Define un Precio Base mayor a $0.00 para "${zeroCostLine.baseModel} (${zeroCostLine.version})" antes de exportar a Cargas Masivas.`,
      });
      return;
    }

    const cleanRef =
      batchReferenceName.trim() || `Pedido Reposición ${todayIso}`;
    const usdtRate = round2(state.exchangeRates?.usdt || 1);

    const headers = [
      'Fecha',
      'Referencia / Lote',
      'Estado',
      'Modalidad Envío',
      'Proveedor',
      'Equipo / Modelo',
      'Versión',
      'Jugador / Dorsal',
      'Parche',
      'Talla',
      'Cantidad',
      'Costo Unitario Base (USDT)',
      'Envío Estimado Referencia (USDT)',
      'Tasa USDT',
    ];

    const rows = selectedOrderLines.map((r, idx) => {
      const selectedPatch =
        patchByGroup[r.modelGroupKey] ?? DEFAULT_SUPPLIER_PATCH;
      const patchOption = SUPPLIER_PATCH_OPTIONS.find(
        (o) => o.value === selectedPatch,
      );
      return [
        todayIso,
        cleanRef,
        'En Tránsito',
        r.orderShippingVia,
        '1688 / Alibaba',
        r.baseModel,
        r.version,
        r.player,
        patchOption ? patchOption.label : selectedPatch,
        r.size,
        r.orderQty,
        r.baseUnitCostUsd,
        idx === 0 ? referenceShippingEstimate.amountUsd : 0,
        usdtRate,
      ];
    });

    const summaryHeaders = ['Concepto', 'Valor'];
    const summaryRows = [
      ['Referencia / Lote', cleanRef],
      ['Estado Inicial', 'En Tránsito'],
      ['Total Prendas', selectedUnitsTotal],
      ['Mercancía a Descontar Hoy (USDT)', merchandiseSubtotalUsd],
      [
        'Envío Estimado Referencia Pendiente (USDT)',
        referenceShippingEstimate.amountUsd,
      ],
      [
        'Total Referencial Puesto en Bodega (USDT)',
        round2(merchandiseSubtotalUsd + referenceShippingEstimate.amountUsd),
      ],
    ];

    const fileName = `X4SPORT_Carga_Masiva_Pedido_${todayIso}.xlsx`;
    const XLSX = window.XLSX;
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pedido_En_Transito');
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen_Financiero');
    XLSX.writeFile(wb, fileName);

    setFeedback({
      type: 'success',
      text: `Archivo "${fileName}" descargado listo para Cargas Masivas (${selectedUnitsTotal} uds · Mercancía a descontar hoy: ${formatUSD(merchandiseSubtotalUsd)} · Envío ref. separado: ${formatUSD(referenceShippingEstimate.amountUsd)}).`,
    });
  };

  const filterPills: Array<{
    id: StatusFilter;
    label: string;
  }> = [
    { id: 'all', label: 'Todas' },
    { id: 'suggested', label: 'Con Pedido' },
    { id: 'high_rotation', label: 'Alta Rotación' },
    { id: 'urgent_air', label: 'Urgente Aéreo' },
    { id: 'plan_maritime', label: 'Planificar Marítimo' },
    { id: 'in_transit', label: 'En Tránsito' },
    { id: 'low_rotation', label: 'Rotación Lenta' },
  ];

  const hasActiveFilters =
    statusFilter !== 'all' ||
    searchQuery.trim() !== '' ||
    sizeFilter !== 'Todas';

  return (
    <div className="space-y-5" data-testid="restock-advisor-view">
      {/* Encabezado + Exportaciones */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Reposición y Pedidos
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Rotación real sobre días disponibles · Cruce inteligente Aéreo (~18d) vs. Marítimo (~90d) · Temporada europea · Exportación china con fotos y Cargas Masivas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="btn-copy-supplier-list"
            onClick={() => void handleCopySupplierList()}
            className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-blue-500/40 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-600/15 dark:text-blue-200 dark:hover:bg-blue-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {copiedRecently ? (
              <Check
                className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                aria-hidden="true"
              />
            ) : (
              <ClipboardCopy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>
              {copiedRecently
                ? 'Lista copiada'
                : 'Copiar Lista Proveedor (WhatsApp)'}
            </span>
          </button>

          <button
            type="button"
            data-testid="btn-export-supplier-excel"
            disabled={isExportingSupplier}
            onClick={() => void handleDownloadSupplierOrder()}
            className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-65 dark:border-slate-700 dark:bg-[#0D1526] dark:text-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {isExportingSupplier ? (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>
              {isExportingSupplier
                ? 'Generando Excel con fotos...'
                : 'Descargar Orden Proveedor (.xlsx)'}
            </span>
          </button>

          <button
            type="button"
            data-testid="btn-export-bulk-upload-excel"
            onClick={handleDownloadBulkUploadOrder}
            className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Descargar para Cargas Masivas (.xlsx)</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium ${
            feedback.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
              : 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-200'
          }`}
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {feedback.text}
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-0.5 opacity-75 hover:opacity-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Barra Superior de Modalidad Logística, Ventana Real y Lote */}
      <section
        aria-label="Modalidad logística y ventana de análisis"
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0D1526] space-y-3"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Ship className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                Modalidad:
              </span>
              <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-[#080F1E]">
                {PLANNING_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`btn-planning-mode-${m.id}`}
                    onClick={() => setPlanningMode(m.id)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                      planningMode === m.id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-blue-600 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Clock className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                Ventana:
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-[#080F1E]">
                {ANALYSIS_WINDOWS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    data-testid={`btn-window-${days}`}
                    onClick={() => setAnalysisWindowDays(days)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      analysisWindowDays === days
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-emerald-600 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="input-restock-batch-ref"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Lote:
              </label>
              <input
                id="input-restock-batch-ref"
                type="text"
                data-testid="input-restock-batch-ref"
                value={batchReferenceName}
                onChange={(e) => setBatchReferenceName(e.target.value)}
                placeholder={`Pedido Reposición ${todayIso}`}
                className="h-9 w-48 sm:w-56 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#080F1E] dark:text-white"
              />
            </div>

            {hasCustomEdits && (
              <button
                type="button"
                data-testid="btn-reset-restock-edits"
                onClick={handleResetEdits}
                className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Restablecer
              </button>
            )}
          </div>
        </div>

        {/* Calendario Logístico + Alerta de Temporada Europea */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2.5 text-xs dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
            <Calendar className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
            <span>
              Llegada estimada hoy +18d (Aéreo):{' '}
              <strong className="font-mono-num text-slate-900 dark:text-slate-200">
                {calendarForecast.airArrivalIso}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Hoy +90d (Marítimo):{' '}
              <strong className="font-mono-num text-slate-900 dark:text-slate-200">
                {calendarForecast.maritimeArrivalIso} ({calendarForecast.maritimeMonthName})
              </strong>
            </span>
          </div>

          {calendarForecast.isEuropeanClosingWindow ? (
            <div
              data-testid="european-season-alert"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                ⚠️ Llegaría en {calendarForecast.maritimeMonthName} (cierre de temporada europea) — Marítimo bloqueado para clubes europeos; prioriza Retro o Selecciones.
              </span>
            </div>
          ) : (
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              Temporada europea activa al arribo marítimo ({calendarForecast.maritimeMonthName})
            </span>
          )}
        </div>
      </section>

      {/* Presupuesto Mercancía + 3 Tarifas Base Editables (Player, Fans, Retro) + Envío Separado */}
      <section
        aria-label="Presupuesto mercancía y tarifas base por categoría"
        data-testid="restock-pricing-panel"
        className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-[#0D1526] space-y-4"
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Izquierda: Presupuesto Mercancía del Pedido (USDT) */}
          <div className="lg:col-span-5 space-y-2.5">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              <label
                htmlFor="restock-budget-input"
                className="text-xs font-bold text-slate-800 dark:text-slate-200"
              >
                Presupuesto Mercancía del Pedido (USDT)
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <DollarSign
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="restock-budget-input"
                  data-testid="input-restock-budget"
                  type="number"
                  min="0"
                  step="10"
                  disabled={budgetMode === 'auto'}
                  value={
                    budgetMode === 'auto'
                      ? String(merchandiseSubtotalUsd)
                      : budgetInput
                  }
                  onChange={(e) => {
                    setBudgetMode('fixed');
                    setBudgetInput(e.target.value);
                  }}
                  className="font-mono-num tabular-nums h-9 w-32 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-3 text-xs font-bold text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-[#080F1E] dark:text-white"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {BUDGET_PRESETS.map((preset) => {
                  const active =
                    budgetMode === 'fixed' && Number(budgetInput) === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      data-testid={`btn-budget-${preset}`}
                      onClick={() => {
                        setBudgetMode('fixed');
                        setBudgetInput(String(preset));
                      }}
                      className={`font-mono-num tabular-nums h-9 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      ${preset.toLocaleString('en-US')}
                    </button>
                  );
                })}
                <button
                  type="button"
                  data-testid="btn-budget-auto"
                  onClick={() => setBudgetMode('auto')}
                  className={`h-9 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                    budgetMode === 'auto'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  Auto
                </button>
              </div>
            </div>

            <div
              data-testid="restock-budget-indicator"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                budgetStatusInfo.tone === 'ok'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : budgetStatusInfo.tone === 'over'
                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/35 dark:bg-red-500/15 dark:text-red-300'
                    : 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/35 dark:bg-blue-500/15 dark:text-blue-200'
              }`}
            >
              <span>{budgetStatusInfo.text}</span>
            </div>
          </div>

          {/* Derecha: 3 Tarifas Base Editables (Player, Fans, Retro) SIN envío */}
          <div className="lg:col-span-7 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Tarifas Base por Categoría (SIN envío · editables)
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {benchmarkPricing.primaryBatch
                  ? `Lote similar ±20%: ${benchmarkPricing.primaryBatch.batch.referenceName} (${formatUSD(benchmarkPricing.primaryBatch.factoryCost)} merc.)`
                  : 'Sin lote histórico comparable; usando último FIFO'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {CORE_VERSIONS.map((ver) => {
                const currentVal =
                  versionRateOverrides[ver] !== undefined
                    ? versionRateOverrides[ver]
                    : benchmarkPricing.versionRates[ver] ?? 0;
                const label = `Precio Base ${ver} ($)`;
                return (
                  <div
                    key={ver}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-[#080F1E]"
                  >
                    <label
                      htmlFor={`input-rate-${ver}`}
                      className="block text-xs font-semibold text-slate-800 dark:text-slate-100"
                    >
                      {label}
                    </label>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                        {versionRateOverrides[ver] !== undefined
                          ? 'Tarifa editada'
                          : benchmarkPricing.versionSources[ver]}
                      </span>
                      <div className="relative shrink-0">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                          $
                        </span>
                        <input
                          id={`input-rate-${ver}`}
                          type="number"
                          min="0"
                          step="0.1"
                          data-testid={`input-version-rate-${ver}`}
                          value={currentVal}
                          onChange={(e) =>
                            handleChangeVersionRate(ver, e.target.value)
                          }
                          className="font-mono-num tabular-nums h-8 w-20 rounded-md border border-slate-300 bg-white pl-5 pr-1.5 text-right text-xs font-bold text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D1526] dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Desglose financiero separado: Mercancía hoy vs Envío referencia separado */}
        <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-3.5 dark:border-slate-800 md:grid-cols-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <span className="block text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
              Mercancía a invertir HOY (sin envío)
            </span>
            <p
              data-testid="summary-merchandise-usd"
              className="font-mono-num tabular-nums mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-300"
            >
              {formatUSD(merchandiseSubtotalUsd)}
            </p>
            <p className="mt-0.5 text-[11px] text-emerald-700/80 dark:text-emerald-200/80">
              {selectedUnitsTotal} prendas · Repo: {formatUSD(replacementFundBalance)} · Caja: {formatUSD(cashOnHandBalance)}
            </p>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
            <span className="block text-[11px] font-semibold text-amber-800 dark:text-amber-200">
              Envío estimado de referencia (lotes similares)
            </span>
            <p
              data-testid="summary-reference-shipping-usd"
              className="font-mono-num tabular-nums mt-1 text-xl font-bold text-amber-700 dark:text-amber-300"
            >
              ~{formatUSD(referenceShippingEstimate.amountUsd)}
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800/85 dark:text-amber-200/80">
              {referenceShippingEstimate.refBatchName
                ? `Ref: ${referenceShippingEstimate.refBatchName} (${referenceShippingEstimate.refBatchUnits} uds · ~${formatUSD(referenceShippingEstimate.perUnitUsd)}/ud). Se paga al recibir en Guacara.`
                : 'Sin historial de flete; se liquida por separado al recibir en Guacara.'}
            </p>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 dark:border-blue-500/30 dark:bg-blue-500/10">
            <span className="block text-[11px] font-semibold text-blue-800 dark:text-blue-200">
              Referencia total puesto en bodega
            </span>
            <p
              data-testid="summary-landed-total-usd"
              className="font-mono-num tabular-nums mt-1 text-xl font-bold text-blue-700 dark:text-blue-300"
            >
              {formatUSD(
                round2(merchandiseSubtotalUsd + referenceShippingEstimate.amountUsd),
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-blue-700/80 dark:text-blue-200/80">
              Promedio ref.:{' '}
              <strong className="font-mono-num tabular-nums">
                {selectedUnitsTotal > 0
                  ? formatUSD(
                      (merchandiseSubtotalUsd +
                        referenceShippingEstimate.amountUsd) /
                        selectedUnitsTotal,
                    )
                  : '$0.00'}
              </strong>
              /franela (solo informativo)
            </p>
          </div>
        </div>
      </section>

      {/* 4 KPIs */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0D1526]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Alta Rotación Real
            </span>
            <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
          </div>
          <p
            data-testid="kpi-high-rotation-count"
            className="font-mono-num tabular-nums mt-1 text-2xl font-bold text-slate-900 dark:text-white"
          >
            {kpis.highRotCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            tallas con ≥1 ud/sem y ≥3 vendidas
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0D1526]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Urgente / Puente Aéreo
            </span>
            <Plane className="h-4 w-4 text-red-500" aria-hidden="true" />
          </div>
          <p
            data-testid="kpi-urgent-count"
            className="font-mono-num tabular-nums mt-1 text-2xl font-bold text-red-600 dark:text-red-400"
          >
            {kpis.urgentAirCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            +{kpis.urgentAirUnits} uds recomendadas por avión
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0D1526]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              En Tránsito Activo
            </span>
            <Truck className="h-4 w-4 text-blue-500" aria-hidden="true" />
          </div>
          <p
            data-testid="kpi-transit-units"
            className="font-mono-num tabular-nums mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400"
          >
            +{kpis.activeTransitUnits}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            uds en camino hacia Guacara
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0D1526]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Modelos en este Pedido
            </span>
            <PackageCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <p
            data-testid="kpi-active-models"
            className="font-mono-num tabular-nums mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400"
          >
            {kpis.activeModelsCount}/{kpis.totalModelsCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {selectedUnitsTotal} franelas seleccionadas
          </p>
        </div>
      </div>

      {/* Filtros + Buscador + Talla */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0D1526]">
        <div
          role="tablist"
          aria-label="Filtrar combinaciones por rotación y logística"
          className="flex flex-wrap items-center gap-1.5"
        >
          {filterPills.map((pill) => {
            const active = statusFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`restock-pill-${pill.id}`}
                onClick={() => setStatusFilter(pill.id)}
                className={`inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <span>{pill.label}</span>
                <span
                  className={`font-mono-num tabular-nums text-[11px] ${
                    active
                      ? 'text-blue-100'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {pillCounts[pill.id]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              data-testid="input-search-restock"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por equipo, modelo, jugador o versión..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#080F1E] dark:text-white dark:placeholder:text-slate-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Talla:
            </span>
            {availableSizes.map((sz) => {
              const active = sizeFilter === sz;
              return (
                <button
                  key={sz}
                  type="button"
                  data-testid={`size-pill-${sz}`}
                  onClick={() => setSizeFilter(sz)}
                  className={`min-h-[32px] rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {sz}
                </button>
              );
            })}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setSearchQuery('');
                  setSizeFilter('Todas');
                }}
                className="ml-1 inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Limpiar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tarjetas agrupadas por Modelo de Camiseta + Versión */}
      {modelCards.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-[#0D1526]">
          <PackageCheck
            className="mx-auto h-9 w-9 text-slate-400 dark:text-slate-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
            No hay modelos que coincidan con estos filtros
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Prueba ampliando la ventana a 60d/90d o limpiando los filtros actuales.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {modelCards.map((card) => {
            const selectedPatch =
              patchByGroup[card.modelGroupKey] ?? DEFAULT_SUPPLIER_PATCH;
            return (
              <article
                key={card.modelGroupKey}
                data-testid={`restock-model-card-${card.modelGroupKey}`}
                className={`overflow-hidden rounded-xl border transition-opacity ${
                  card.isExcluded
                    ? 'border-slate-200 bg-slate-50/70 opacity-65 dark:border-slate-800/80 dark:bg-[#090F1D]'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0D1526]'
                }`}
              >
                {/* Encabezado de Tarjeta de Modelo */}
                <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3.5 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <ModelThumb
                      photoUrl={card.photoUrl}
                      fallbackPhotoUrl={card.fallbackPhotoUrl}
                      alt={`${card.baseModel} ${card.version}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-base font-bold text-slate-900 dark:text-white whitespace-normal break-words leading-snug">
                          {card.baseModel}
                        </h2>
                        {card.hasHighRotation && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300">
                            🔥 Alta Rotación
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {card.version}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{getMarketLabel(card.marketKind)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num tabular-nums">
                          Bodega: {card.totalStock} uds
                        </span>
                        {card.totalTransit > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-num tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
                              Tránsito: +{card.totalTransit} uds
                            </span>
                          </>
                        )}
                      </div>
                      {card.seasonWarning && (
                        <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                          {card.seasonWarning}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Controles del Modelo: Parche chino + Totales + Botón Incluir/Excluir */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor={`patch-${card.modelGroupKey}`}
                        className="text-[11px] font-medium text-slate-500 dark:text-slate-400"
                      >
                        Parche:
                      </label>
                      <select
                        id={`patch-${card.modelGroupKey}`}
                        data-testid={`select-supplier-patch-${card.modelGroupKey}`}
                        value={selectedPatch}
                        onChange={(e) =>
                          setPatchByGroup((prev) => ({
                            ...prev,
                            [card.modelGroupKey]: e.target.value,
                          }))
                        }
                        className="h-8 max-w-[175px] rounded-lg border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-100"
                      >
                        {SUPPLIER_PATCH_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="text-right px-2">
                      <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                        Pedido modelo
                      </span>
                      <span className="font-mono-num tabular-nums text-xs font-bold text-slate-900 dark:text-white">
                        {card.totalOrderQty} pzs ·{' '}
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {formatUSD(card.totalMerchandiseUsd)}
                        </span>
                      </span>
                    </div>

                    <button
                      type="button"
                      data-testid={`btn-toggle-model-${card.modelGroupKey}`}
                      onClick={() =>
                        handleToggleExcludeModel(
                          card.modelGroupKey,
                          card.isExcluded,
                        )
                      }
                      className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors ${
                        card.isExcluded
                          ? 'border-blue-500/40 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-600/15 dark:text-blue-300 dark:hover:bg-blue-600/25'
                          : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-300 dark:hover:bg-red-500/15 dark:hover:text-red-300 dark:hover:border-red-500/40'
                      }`}
                    >
                      {card.isExcluded ? (
                        <>
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          Incluir Modelo
                        </>
                      ) : (
                        <>
                          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                          Excluir Modelo
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Tabla de Tallas / Jugadores del Modelo */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-[#080F1E] dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 text-center w-20">Talla</th>
                        <th className="px-3 py-2.5">Jugador / Dorsal</th>
                        <th className="px-3 py-2.5">Rotación Real</th>
                        <th className="px-3 py-2.5 text-right">Bodega</th>
                        <th className="px-3 py-2.5">Tránsito</th>
                        <th className="px-3 py-2.5">Decisión Logística</th>
                        <th className="px-3 py-2.5 text-center">Pedir (Uds)</th>
                        <th className="px-3 py-2.5 text-right">Unit. Base ($)</th>
                        <th className="px-4 py-2.5 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                      {card.rows.map((row) => (
                        <tr
                          key={row.key}
                          data-testid="restock-row"
                          className={`transition-colors ${
                            row.isActiveInOrder
                              ? 'bg-blue-50/25 hover:bg-blue-50/50 dark:bg-blue-950/15 dark:hover:bg-slate-800/45'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/30'
                          }`}
                        >
                          <td className="px-4 py-2.5 text-center">
                            <span className="font-mono-num tabular-nums inline-flex min-w-[36px] items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300">
                              {row.size}
                            </span>
                          </td>

                          <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                            {row.player}
                          </td>

                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="flex flex-col gap-0.5">
                              {row.rotationTier === 'high' ? (
                                <span className="inline-flex w-fit items-center gap-1 rounded border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-[11px] font-bold text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300">
                                  🔥 Alta Rotación
                                </span>
                              ) : row.rotationTier === 'medium' ? (
                                <span className="inline-flex w-fit items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300">
                                  Rotación Media
                                </span>
                              ) : (
                                <span className="inline-flex w-fit items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                                  <Snowflake
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                  Rotación Lenta / Baja
                                </span>
                              )}
                              <span className="font-mono-num tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                                {row.weeklyRate}/sem · {row.soldInWindow} vend. en{' '}
                                {row.effectiveAvailableDays}d disp.
                                {row.stockCoverageDays !== null &&
                                  ` · cob. ~${row.stockCoverageDays}d`}
                              </span>
                            </div>
                          </td>

                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <span
                              className={`font-mono-num tabular-nums text-sm font-bold ${
                                row.currentStock === 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-slate-900 dark:text-white'
                              }`}
                            >
                              {row.currentStock}
                            </span>
                          </td>

                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {row.inTransitUnits > 0 ? (
                              <span className="font-mono-num tabular-nums text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                                +{row.inTransitUnits}{' '}
                                {row.earliestTransitMode === 'Marítimo'
                                  ? `(barco ~${row.earliestMaritimeRemainingDays}d)`
                                  : `(avión ~${row.earliestAirRemainingDays}d)`}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600">
                                —
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-2.5">
                            {row.logisticsStatus === 'urgent_air' ||
                            row.logisticsStatus === 'urgent_air_bridge' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                                <AlertOctagon
                                  className="h-3.5 w-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                {row.logisticsReason}
                              </span>
                            ) : row.logisticsStatus === 'plan_maritime' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                                <Ship
                                  className="h-3.5 w-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                {row.logisticsReason}
                              </span>
                            ) : row.logisticsStatus === 'season_blocked' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                                <AlertTriangle
                                  className="h-3.5 w-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                {row.logisticsReason}
                              </span>
                            ) : row.logisticsStatus === 'in_transit_covered' ? (
                              <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                                {row.logisticsReason}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                {row.logisticsReason}
                              </span>
                            )}
                          </td>

                          {/* Stepper - / + y cantidad editable */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={card.isExcluded || row.orderQty <= 0}
                                onClick={() => handleStepRowQty(row, -1)}
                                aria-label={`Restar 1 a ${row.baseModel} talla ${row.size}`}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Minus className="h-3 w-3" aria-hidden="true" />
                              </button>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                aria-label={`Cantidad a pedir para ${row.baseModel} talla ${row.size}`}
                                data-testid={`input-qty-${row.key}`}
                                value={row.orderQty}
                                onChange={(e) =>
                                  handleChangeRowQty(row, e.target.value)
                                }
                                className="font-mono-num tabular-nums h-7 w-14 rounded-md border border-slate-300 bg-white px-1.5 text-center text-xs font-bold text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-[#080F1E] dark:text-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleStepRowQty(row, 1)}
                                aria-label={`Sumar 1 a ${row.baseModel} talla ${row.size}`}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Plus className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          </td>

                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <div className="relative inline-block">
                              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                                $
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                disabled={card.isExcluded}
                                aria-label={`Precio unitario base para ${row.baseModel} talla ${row.size}`}
                                data-testid={`input-cost-${row.key}`}
                                value={row.baseUnitCostUsd}
                                onChange={(e) =>
                                  handleChangeRowCost(row, e.target.value)
                                }
                                className="font-mono-num tabular-nums h-7 w-20 rounded-md border border-slate-300 bg-white pl-5 pr-1.5 text-right text-xs font-semibold text-slate-900 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-[#080F1E] dark:text-white"
                              />
                            </div>
                          </td>

                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <span className="font-mono-num tabular-nums font-bold text-slate-900 dark:text-white">
                              {row.lineMerchandiseUsd > 0
                                ? formatUSD(row.lineMerchandiseUsd)
                                : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Resumen rápido de grupos listos para Excel chino */}
      {supplierOrderGroups.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Listo para exportar a proveedor chino:{' '}
          <strong className="text-slate-700 dark:text-slate-200">
            {supplierOrderGroups.length} modelo(s)
          </strong>{' '}
          ({selectedUnitsTotal} piezas totales) con fotos incrustadas y sin precios en el Excel de fábrica.
        </p>
      )}
    </div>
  );
}
