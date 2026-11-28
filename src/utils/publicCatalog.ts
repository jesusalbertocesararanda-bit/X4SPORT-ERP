import type {
  AppState,
  InventoryItem,
  JerseySize,
  JerseyVersion,
  PurchaseBatchRecord,
  TeamCategory,
} from '../types/erp';
import {
  ALL_JERSEY_SIZES,
  compareJerseySizes,
  formatUSD,
  formatVES,
  type InventorySizeMatrixRow,
  normalizeVersionDisplay,
  round2,
} from './finance';

export interface CatalogWhatsAppAdvisor {
  id: 'jesus' | 'josue';
  name: string;
  phoneDisplay: string;
  waNumber: string;
}

export const CATALOG_WHATSAPP_ADVISORS: readonly CatalogWhatsAppAdvisor[] = [
  {
    id: 'jesus',
    name: 'Jesús César',
    phoneDisplay: '+58 412-4612132',
    waNumber: '584124612132',
  },
  {
    id: 'josue',
    name: 'Josué Ojeda',
    phoneDisplay: '+58 412-4588754',
    waNumber: '584124588754',
  },
] as const;

export const WHATSAPP_TURN_STORAGE_KEY = 'x4sport_wa_turn_v1';

export const CANONICAL_CATALOG_TEAM_ORDER = [
  'Barcelona',
  'Real Madrid',
  'Manchester City',
  'PSG',
  'Selecciones',
] as const;

const BUILTIN_PLAYER_ALIASES: Array<{ keywords: string[]; teamHint: string; modelHints?: string[] }> = [
  {
    keywords: ['lamine', 'yamal', 'pedri', 'gavi', 'lewandowski', 'raphinha', 'cubarsi', 'olmo', 'messi barcelona', 'barca', 'fcb', 'culer'],
    teamHint: 'Barcelona',
  },
  {
    keywords: ['bellingham', 'mbappe', 'vinicius', 'vini', 'rodrygo', 'valverde', 'camavinga', 'modric', 'arda guler', 'madrid', 'rma', 'merengue'],
    teamHint: 'Real Madrid',
  },
  {
    keywords: ['haaland', 'foden', 'de bruyne', 'rodri', 'grealish', 'bernardo', 'guardiola', 'city', 'mci', 'citizens'],
    teamHint: 'Manchester City',
  },
  {
    keywords: ['dembele', 'barcola', 'hakimi', 'vitinha', 'neymar', 'paris', 'psg'],
    teamHint: 'PSG',
  },
  {
    keywords: ['messi', 'di maria', 'julian alvarez', 'lautaro', 'escaloni', 'albiceleste', 'argentina'],
    teamHint: 'Selecciones',
    modelHints: ['argentina'],
  },
  {
    keywords: ['soteldo', 'rondon', 'aramburu', 'herrera', 'savarino', 'machis', 'vinotinto', 'venezuela'],
    teamHint: 'Selecciones',
    modelHints: ['venezuela', 'vinotinto'],
  },
  {
    keywords: ['lamine yamal espana', 'nico williams', 'rodri espana', 'espana', 'roja'],
    teamHint: 'Selecciones',
    modelHints: ['espana', 'españa'],
  },
  {
    keywords: ['vinicius brasil', 'neymar brasil', 'raphinha brasil', 'endrick', 'brasil', 'canarinha'],
    teamHint: 'Selecciones',
    modelHints: ['brasil'],
  },
];

export interface PublicCatalogSizeOption {
  size: JerseySize;
  stock: number;
  salePrice: number;
}

export interface PublicCatalogProduct {
  key: string;
  team: TeamCategory;
  model: string;
  version: 'Fans' | 'Player' | 'Retro';
  totalStock: number;
  sizes: PublicCatalogSizeOption[];
  minPrice: number;
  maxPrice: number;
  photoUrl?: string;
  images: string[];
  keywords?: string;
  searchIndexText: string;
}

export interface PublicCatalogTeamGroup {
  team: TeamCategory;
  totalUnits: number;
  products: PublicCatalogProduct[];
}

export interface PublicTransitSizeOption {
  size: JerseySize;
  incomingQty: number;
  salePrice?: number;
}

export interface PublicTransitCard {
  key: string;
  team: TeamCategory;
  model: string;
  version: 'Fans' | 'Player' | 'Retro';
  totalIncomingUnits: number;
  sizes: PublicTransitSizeOption[];
  entryDate?: string;
  estimatedArrivalDate?: string;
  estimatedDaysRemaining?: number;
  estimatedArrivalLabel: string;
  shippingType: PurchaseBatchRecord['shippingType'];
  referenceName: string;
  salePrice?: number;
  photoUrl?: string;
  images: string[];
  keywords?: string;
  searchIndexText: string;
}

export function isRateValid(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

/**
 * Calcula el precio en Bolívares (Bs) a partir del precio en USD y la tasa USDT / Paralelo vigente.
 * Si la tasa es inválida, 0, nula o indefinida, devuelve null para proteger los márgenes del negocio.
 */
export function calculateCatalogBsPrice(
  priceUsd: number,
  usdtRate?: number | null,
): number | null {
  if (!isRateValid(usdtRate)) return null;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return round2(priceUsd * usdtRate);
}

function parseIsoDateUtcMs(iso?: string): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return null;
  const [y, m, d] = iso.trim().split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

export function computeTransitDaysRemaining(
  params: {
    entryDate?: string;
    estimatedArrivalDate?: string;
    shippingType: PurchaseBatchRecord['shippingType'];
  },
  referenceDateIso?: string,
): { daysRemaining?: number; label: string } {
  const refIso = referenceDateIso ?? new Date().toISOString().slice(0, 10);
  const refMs = parseIsoDateUtcMs(refIso);
  if (refMs === null) {
    return { label: 'Próximo arribo' };
  }

  let targetMs = parseIsoDateUtcMs(params.estimatedArrivalDate);
  if (targetMs === null) {
    const entryMs = parseIsoDateUtcMs(params.entryDate);
    if (entryMs !== null) {
      const slaDays = params.shippingType === 'Marítimo' ? 80 : 15;
      targetMs = entryMs + slaDays * 86_400_000;
    }
  }

  if (targetMs === null) {
    return { label: 'Próximo arribo' };
  }

  const daysRemaining = Math.round((targetMs - refMs) / 86_400_000);
  if (daysRemaining > 1) {
    return {
      daysRemaining,
      label: `Llega en ~${daysRemaining} días`,
    };
  }
  if (daysRemaining === 1) {
    return {
      daysRemaining: 1,
      label: 'Llega mañana (~1 día)',
    };
  }
  if (daysRemaining === 0) {
    return {
      daysRemaining: 0,
      label: 'Llegada estimada hoy',
    };
  }
  return {
    daysRemaining,
    label: 'Por arribar esta semana',
  };
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeFirebaseCatalogKey(rawKey: string): string {
  return rawKey.replace(/[.#$/[\]]/g, '_');
}

export function normalizePlayerToken(player?: string): string {
  const clean = normalizeSearchText(player ?? '');
  if (
    !clean ||
    clean === '-' ||
    clean === '—' ||
    clean === 'sin nombre' ||
    clean === 'n/a' ||
    clean === 'ninguno'
  ) {
    return '';
  }
  return clean;
}

export function splitModelAndPlayerParts(rawModel: string): {
  baseModel: string;
  player: string;
} {
  let cleanModel = (rawModel || '').replace(/\s+/g, ' ').trim();
  let playerCandidate = '';

  const sepParts = cleanModel
    .split(/\s*[·|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (sepParts.length > 1) {
    cleanModel = sepParts[0];
    playerCandidate = sepParts.slice(1).join(' ');
  }

  const parenMatch = cleanModel.match(/\(([^)]*#\d+[^)]*)\)/);
  if (parenMatch?.[1]) {
    if (!playerCandidate) {
      playerCandidate = parenMatch[1].trim();
    }
    cleanModel = cleanModel.replace(parenMatch[0], '').replace(/\s+/g, ' ').trim();
  }

  const trailingHashMatch = cleanModel.match(
    /\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+)?\s*#\d+)\s*$/,
  );
  if (trailingHashMatch?.[1]) {
    if (!playerCandidate) {
      playerCandidate = trailingHashMatch[1].trim();
    }
    cleanModel = cleanModel
      .slice(0, cleanModel.length - trailingHashMatch[0].length)
      .replace(/\s+/g, ' ')
      .trim();
  }

  return {
    baseModel: cleanModel || (rawModel || '').replace(/\s+/g, ' ').trim(),
    player: playerCandidate.replace(/\s+/g, ' ').trim(),
  };
}

export interface ModelIdentityInput {
  model: string;
  version?: JerseyVersion | string;
  player?: string;
}

/**
 * Clave de identidad única e invariable de modelo:
 * normaliza exclusivamente (nombreModeloNormalizado + versionNormalizada + jugadorNormalizado),
 * ignorando tildes, mayúsculas, espacios múltiples, URL de foto o ID de lote.
 */
export function getModelIdentityKey(input: ModelIdentityInput): string {
  const parsed = splitModelAndPlayerParts(input.model ?? '');
  const baseNorm = normalizeSearchText(parsed.baseModel);
  const effectivePlayer =
    normalizePlayerToken(input.player) || normalizePlayerToken(parsed.player);
  if (!input.version) {
    const modelOnly = effectivePlayer ? `${baseNorm}::${effectivePlayer}` : baseNorm;
    return sanitizeFirebaseCatalogKey(modelOnly);
  }
  const ver = normalizeVersionDisplay(input.version as JerseyVersion);
  return sanitizeFirebaseCatalogKey(`${baseNorm}::${ver}::${effectivePlayer}`);
}

export function canonicalizeCatalogKey(rawKey: string): string {
  const parts = rawKey.split('::');
  if (parts.length === 1) {
    return getModelIdentityKey({ model: parts[0] });
  }
  if (parts.length === 2) {
    const verCandidate = parts[1].trim().toLowerCase();
    const looksLikeVersion = ['fans', 'fan', 'player', 'retro'].includes(verCandidate);
    if (looksLikeVersion) {
      return getModelIdentityKey({ model: parts[0], version: parts[1] });
    }
    return getModelIdentityKey({ model: parts[0], player: parts[1] });
  }
  return getModelIdentityKey({
    model: parts[0],
    version: parts[1],
    player: parts.slice(2).join('::'),
  });
}

function buildCombinedModelIdentityFallback(
  model: string,
  version?: JerseyVersion | string,
  player?: string,
): string {
  const parsed = splitModelAndPlayerParts(model ?? '');
  const effectivePlayer =
    normalizePlayerToken(player) || normalizePlayerToken(parsed.player);
  const combined = effectivePlayer
    ? `${normalizeSearchText(parsed.baseModel)} ${effectivePlayer}`
    : normalizeSearchText(parsed.baseModel);
  if (!version) return sanitizeFirebaseCatalogKey(combined);
  const ver = normalizeVersionDisplay(version as JerseyVersion);
  return sanitizeFirebaseCatalogKey(`${combined}::${ver}`);
}

export function doesCatalogEntryKeyMatchModel(
  rawKey: string,
  model: string,
  version: JerseyVersion | string,
  player?: string,
): boolean {
  const targetIdentity = getModelIdentityKey({ model, version, player });
  if (canonicalizeCatalogKey(rawKey) === targetIdentity) return true;

  // Compatibilidad con claves heredadas de 2 segmentos donde '#' se sanitizó a '_'
  const parts = rawKey.split('::');
  if (parts.length >= 2) {
    const keyModelNorm = sanitizeFirebaseCatalogKey(normalizeSearchText(parts[0]));
    const keyVerNorm = normalizeVersionDisplay(parts[1] as JerseyVersion);
    const keyPlayerNorm = parts.length >= 3 ? normalizePlayerToken(parts.slice(2).join('::')) : '';
    const legacyCombinedKey = sanitizeFirebaseCatalogKey(
      keyPlayerNorm ? `${keyModelNorm} ${keyPlayerNorm}::${keyVerNorm}` : `${keyModelNorm}::${keyVerNorm}`,
    );
    const targetCombined = buildCombinedModelIdentityFallback(model, version, player);
    if (legacyCombinedKey === targetCombined) return true;
  }
  return false;
}

export function normalizeCatalogModelKey(
  model: string,
  version?: JerseyVersion | string,
): string {
  const cleanModel = model.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!version) return sanitizeFirebaseCatalogKey(cleanModel);
  const ver = normalizeVersionDisplay(version as JerseyVersion);
  return sanitizeFirebaseCatalogKey(`${cleanModel}::${ver}`);
}

export function resolveCatalogPhoto(
  model: string,
  version: JerseyVersion | string,
  photosMap?: Record<string, string>,
  player?: string,
): string | undefined {
  if (!photosMap) return undefined;
  const identityKey = getModelIdentityKey({ model, version, player });
  const byIdentity = photosMap[identityKey];
  if (typeof byIdentity === 'string' && byIdentity.trim()) return byIdentity.trim();

  const exactKey = normalizeCatalogModelKey(model, version);
  const exact = photosMap[exactKey];
  if (typeof exact === 'string' && exact.trim()) return exact.trim();

  const entries = Object.entries(photosMap);
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || !v.trim()) continue;
    if (doesCatalogEntryKeyMatchModel(k, model, version, player)) {
      return v.trim();
    }
  }

  const modelOnlyKey = normalizeCatalogModelKey(model);
  const byModel = photosMap[modelOnlyKey];
  if (typeof byModel === 'string' && byModel.trim()) return byModel.trim();

  const modelOnlyIdentity = getModelIdentityKey({ model, player });
  const targetModelLower = modelOnlyKey.toLowerCase();
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const kl = sanitizeFirebaseCatalogKey(k).trim().toLowerCase();
    if (kl === targetModelLower || canonicalizeCatalogKey(k) === modelOnlyIdentity) {
      return v.trim();
    }
  }
  return undefined;
}

export function resolveCatalogKeywords(
  model: string,
  version: JerseyVersion | string,
  keywordsMap?: Record<string, string>,
  player?: string,
): string | undefined {
  if (!keywordsMap) return undefined;
  const identityKey = getModelIdentityKey({ model, version, player });
  const byIdentity = keywordsMap[identityKey];
  if (typeof byIdentity === 'string' && byIdentity.trim()) return byIdentity.trim();

  const exactKey = normalizeCatalogModelKey(model, version);
  const exact = keywordsMap[exactKey];
  if (typeof exact === 'string' && exact.trim()) return exact.trim();

  const entries = Object.entries(keywordsMap);
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || !v.trim()) continue;
    if (doesCatalogEntryKeyMatchModel(k, model, version, player)) {
      return v.trim();
    }
  }

  const modelOnlyKey = normalizeCatalogModelKey(model);
  const byModel = keywordsMap[modelOnlyKey];
  if (typeof byModel === 'string' && byModel.trim()) return byModel.trim();

  const modelOnlyIdentity = getModelIdentityKey({ model, player });
  const targetModelLower = modelOnlyKey.toLowerCase();
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const kl = sanitizeFirebaseCatalogKey(k).trim().toLowerCase();
    if (kl === targetModelLower || canonicalizeCatalogKey(k) === modelOnlyIdentity) {
      return v.trim();
    }
  }
  return undefined;
}

function resolvePhotoInCatalogOrInventory(
  state: AppState | undefined,
  target: ModelIdentityInput,
): string | undefined {
  if (!state || !target.model?.trim()) return undefined;
  const version = normalizeVersionDisplay((target.version ?? 'Fans') as JerseyVersion);
  const fromCatalog = resolveCatalogPhoto(
    target.model,
    version,
    state.catalogPhotos,
    target.player,
  );
  if (fromCatalog) return fromCatalog;

  const targetIdentity = getModelIdentityKey({
    model: target.model,
    version,
    player: target.player,
  });

  for (const item of state.inventory ?? []) {
    if (!item?.imageUrl?.trim()) continue;
    if (getModelIdentityKey({ model: item.model, version: item.version }) === targetIdentity) {
      return item.imageUrl.trim();
    }
  }
  return undefined;
}

/**
 * Busca la imagen asignada de un modelo en todas las fuentes del sistema
 * (borrador actual, catálogo público, inventario incluso con stock 0, lotes en tránsito y compras),
 * comparando por clave única normalizada del modelo.
 */
export function resolveModelPhotoAnywhere(
  state: AppState | undefined,
  target: ModelIdentityInput,
  extraPhotosByIdentityKey?: Record<string, string>,
): string | undefined {
  if (!target.model?.trim()) return undefined;
  const version = normalizeVersionDisplay((target.version ?? 'Fans') as JerseyVersion);
  const targetIdentity = getModelIdentityKey({
    model: target.model,
    version,
    player: target.player,
  });

  const fromExtra = extraPhotosByIdentityKey?.[targetIdentity];
  if (typeof fromExtra === 'string' && fromExtra.trim()) {
    return fromExtra.trim();
  }

  const fromCatalogOrInventory = resolvePhotoInCatalogOrInventory(state, {
    ...target,
    version,
  });
  if (fromCatalogOrInventory) return fromCatalogOrInventory;

  for (const batch of state?.purchaseBatches ?? []) {
    for (const bi of batch.items ?? []) {
      if (!bi?.imageUrl?.trim()) continue;
      if (getModelIdentityKey({ model: bi.model, version: bi.version }) === targetIdentity) {
        return bi.imageUrl.trim();
      }
    }
  }

  for (const pur of state?.purchases ?? []) {
    if (!pur?.imageUrl?.trim()) continue;
    if (getModelIdentityKey({ model: pur.model, version: pur.version }) === targetIdentity) {
      return pur.imageUrl.trim();
    }
  }

  return undefined;
}

/**
 * Extrae el ID único de archivo de cualquier formato de enlace de Google Drive
 * (file/d/ID, open?id=ID, uc?id=ID, thumbnail?id=ID, lh3.googleusercontent.com/d/ID).
 */
export function extractGoogleDriveFileId(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Ya está en formato directo lh3: https://lh3.googleusercontent.com/d/<ID>(=w1000)
  const lh3Match = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i);
  if (lh3Match?.[1]) return lh3Match[1];

  // drive.google.com/.../d/<ID> o docs.google.com/.../d/<ID>
  const fileMatch = trimmed.match(
    /(?:drive|docs)\.google\.com\/(?:[a-zA-Z0-9_\/]*\/)?d\/([a-zA-Z0-9_-]+)/i,
  );
  if (fileMatch?.[1]) return fileMatch[1];

  // drive.google.com/open?id=<ID>, uc?id=<ID>, thumbnail?id=<ID>, drive.usercontent.google.com/...?id=<ID>
  if (/(?:drive|docs)(?:\.usercontent)?\.google\.com/i.test(trimmed)) {
    const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
    if (idMatch?.[1]) return idMatch[1];
  }

  return null;
}

/**
 * Convierte cualquier enlace de Google Drive (file/d/ID, open?id=ID, uc?id=ID)
 * al endpoint optimizado https://lh3.googleusercontent.com/d/{ID}=w1000.
 * Conserva intactas Data URLs base64 y URLs HTTPS externas.
 */
export function normalizarUrlImagen(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image/')) return trimmed;

  const fileId = extractGoogleDriveFileId(trimmed);
  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}=w1000`;
  }

  return trimmed;
}

/**
 * Devuelve la URL alternativa de respaldo para Google Drive:
 * https://drive.google.com/thumbnail?id={ID}&sz=w1000
 */
export function obtenerFallbackUrlImagen(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:image/')) return null;

  const fileId = extractGoogleDriveFileId(trimmed);
  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  }
  return null;
}

/**
 * Convierte un enlace compartido de Google Drive al formato de visualización directa de imagen:
 * https://lh3.googleusercontent.com/d/[FILE_ID]
 */
export function convertGoogleDriveUrlToDirect(rawUrl: string): string {
  const fileId = extractGoogleDriveFileId(rawUrl);
  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }
  return rawUrl.trim();
}

/**
 * Normaliza enlaces de imagen (Google Drive share URLs -> visualización directa lh3.googleusercontent.com)
 * manteniendo intactas URLs directas HTTPS y Data URLs base64.
 */
export function normalizeCatalogImageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image/')) return trimmed;

  const directGoogleDriveUrl = convertGoogleDriveUrlToDirect(trimmed);
  if (directGoogleDriveUrl !== trimmed) {
    return directGoogleDriveUrl;
  }

  return trimmed;
}

/**
 * Parsea una o varias URLs de imagen (separadas por salto de línea, "|" o coma en URLs http/https),
 * normalizando cada enlace de Google Drive con normalizarUrlImagen().
 */
export function parseCatalogImageList(raw?: string): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Si es una sola Data URL base64 (contiene coma interna), no dividir por coma
  const rawEntries = trimmed.startsWith('data:image/')
    ? trimmed.split(/[\r\n|]+/)
    : trimmed.split(/[\r\n|,]+/);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of rawEntries) {
    const normalized = normalizarUrlImagen(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Limita estrictamente el índice del carrusel entre 0 y total - 1.
 */
export function clampCatalogCarouselIndex(index: number, total: number): number {
  if (!Number.isFinite(total) || total <= 1) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.floor(total) - 1, Math.trunc(index)));
}

/**
 * Bloquea el desplazamiento horizontal fuera de [0, total - 1] para evitar deslizar hacia el vacío.
 */
export function computeClampedSwipeOffset(
  deltaX: number,
  currentIndex: number,
  total: number,
): number {
  if (!Number.isFinite(total) || total <= 1) return 0;
  if (!Number.isFinite(deltaX)) return 0;
  const safeIndex = clampCatalogCarouselIndex(currentIndex, total);
  if (safeIndex === 0 && deltaX > 0) return 0;
  if (safeIndex === total - 1 && deltaX < 0) return 0;
  return deltaX;
}

function buildSearchIndexForProduct(params: {
  team: string;
  model: string;
  version: 'Fans' | 'Player' | 'Retro';
  sizes: string[];
  customKeywords?: string;
}): string {
  const baseNormalized = normalizeSearchText(
    [
      params.team,
      params.model,
      params.version,
      params.version === 'Fans' ? 'fan fans aficionado' : '',
      params.sizes.join(' '),
      params.customKeywords ?? '',
    ].join(' '),
  );

  const aliasTokens: string[] = [];
  const teamNorm = normalizeSearchText(params.team);
  const modelNorm = normalizeSearchText(params.model);

  for (const rule of BUILTIN_PLAYER_ALIASES) {
    const teamMatches = normalizeSearchText(rule.teamHint) === teamNorm;
    const modelMatches =
      !rule.modelHints ||
      rule.modelHints.some((hint) => modelNorm.includes(normalizeSearchText(hint)));
    if (teamMatches && modelMatches) {
      aliasTokens.push(...rule.keywords);
    }
  }

  return `${baseNormalized} ${aliasTokens.join(' ')}`.trim();
}

export function buildPublicCatalogGroups(
  state: AppState,
): PublicCatalogTeamGroup[] {
  const grouped = new Map<
    string,
    {
      team: TeamCategory;
      model: string;
      version: 'Fans' | 'Player' | 'Retro';
      sizeMap: Map<JerseySize, { stock: number; salePrice: number }>;
      directPhotoUrl?: string;
    }
  >();

  for (const item of state.inventory ?? []) {
    if (!item || item.stock <= 0) continue;
    const version = normalizeVersionDisplay(item.version);
    const key = getModelIdentityKey({ model: item.model, version });

    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        team: item.team || 'Otro',
        model: item.model.trim(),
        version,
        sizeMap: new Map(),
        directPhotoUrl: item.imageUrl?.trim() || undefined,
      };
      grouped.set(key, entry);
    } else if (!entry.directPhotoUrl && item.imageUrl?.trim()) {
      entry.directPhotoUrl = item.imageUrl.trim();
    }

    const existingSize = entry.sizeMap.get(item.size);
    if (existingSize) {
      existingSize.stock += item.stock;
      existingSize.salePrice = item.salePrice;
    } else {
      entry.sizeMap.set(item.size, {
        stock: item.stock,
        salePrice: item.salePrice,
      });
    }
  }

  const byTeam = new Map<TeamCategory, PublicCatalogProduct[]>();

  for (const [key, entry] of grouped.entries()) {
    const sizes: PublicCatalogSizeOption[] = Array.from(
      entry.sizeMap.entries(),
    )
      .filter(([, info]) => info.stock > 0)
      .sort(([szA], [szB]) => compareJerseySizes(szA, szB))
      .map(([sz, info]) => ({
        size: sz,
        stock: info.stock,
        salePrice: round2(info.salePrice),
      }));

    if (sizes.length === 0) continue;
    const totalStock = sizes.reduce((sum, s) => sum + s.stock, 0);
    if (totalStock <= 0) continue;

    const prices = sizes.map((s) => s.salePrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const rawPhotoUrl =
      resolveModelPhotoAnywhere(state, {
        model: entry.model,
        version: entry.version,
      }) ?? entry.directPhotoUrl;
    const images = parseCatalogImageList(rawPhotoUrl);
    const photoUrl = images[0];
    const keywords = resolveCatalogKeywords(
      entry.model,
      entry.version,
      state.catalogKeywords,
    );

    const product: PublicCatalogProduct = {
      key,
      team: entry.team,
      model: entry.model,
      version: entry.version,
      totalStock,
      sizes,
      minPrice,
      maxPrice,
      photoUrl,
      images,
      keywords,
      searchIndexText: buildSearchIndexForProduct({
        team: entry.team,
        model: entry.model,
        version: entry.version,
        sizes: sizes.map((s) => s.size),
        customKeywords: keywords,
      }),
    };

    const list = byTeam.get(entry.team) ?? [];
    list.push(product);
    byTeam.set(entry.team, list);
  }

  const orderedTeams: TeamCategory[] = [
    ...CANONICAL_CATALOG_TEAM_ORDER.filter((t) => byTeam.has(t)),
    ...Array.from(byTeam.keys())
      .filter(
        (t) =>
          !CANONICAL_CATALOG_TEAM_ORDER.includes(
            t as (typeof CANONICAL_CATALOG_TEAM_ORDER)[number],
          ),
      )
      .sort((a, b) => a.localeCompare(b)),
  ];

  return orderedTeams.map((team) => {
    const products = (byTeam.get(team) ?? []).sort(
      (a, b) =>
        a.model.localeCompare(b.model) || a.version.localeCompare(b.version),
    );
    return {
      team,
      totalUnits: products.reduce((sum, p) => sum + p.totalStock, 0),
      products,
    };
  });
}

export function buildUpcomingTransitCards(
  state: AppState,
  referenceDateIso?: string,
): PublicTransitCard[] {
  const map = new Map<string, PublicTransitCard>();

  for (const batch of state.purchaseBatches ?? []) {
    if (batch.status !== 'EN TRÁNSITO') continue;
    const etaMeta = computeTransitDaysRemaining(
      {
        entryDate: batch.entryDate,
        estimatedArrivalDate: batch.estimatedArrivalDate,
        shippingType: batch.shippingType,
      },
      referenceDateIso,
    );
    for (const item of batch.items ?? []) {
      const qty = item.orderedQuantity ?? item.quantity ?? 0;
      if (qty <= 0) continue;
      const version = normalizeVersionDisplay(item.version);
      const modelKey = getModelIdentityKey({ model: item.model, version });
      const groupKey = `${batch.id}::${modelKey}`;

      let card = map.get(groupKey);
      if (!card) {
        const rawPhotoUrl =
          resolveModelPhotoAnywhere(state, {
            model: item.model,
            version,
          }) ?? item.imageUrl?.trim();
        const images = parseCatalogImageList(rawPhotoUrl);
        const photoUrl = images[0];
        const keywords = resolveCatalogKeywords(
          item.model,
          version,
          state.catalogKeywords,
        );
        card = {
          key: groupKey,
          team: item.team || 'Otro',
          model: item.model.trim(),
          version,
          totalIncomingUnits: 0,
          sizes: [],
          entryDate: batch.entryDate,
          estimatedArrivalDate: batch.estimatedArrivalDate,
          estimatedDaysRemaining: etaMeta.daysRemaining,
          estimatedArrivalLabel: etaMeta.label,
          shippingType: batch.shippingType,
          referenceName: batch.referenceName,
          salePrice: item.salePrice,
          photoUrl,
          images,
          keywords,
          searchIndexText: '',
        };
        map.set(groupKey, card);
      }

      card.totalIncomingUnits += qty;
      if (item.salePrice && !card.salePrice) {
        card.salePrice = item.salePrice;
      }
      const existingSize = card.sizes.find((s) => s.size === item.size);
      if (existingSize) {
        existingSize.incomingQty += qty;
      } else {
        card.sizes.push({
          size: item.size,
          incomingQty: qty,
          salePrice: item.salePrice,
        });
      }
    }
  }

  const cards = Array.from(map.values()).map((card) => {
    const sortedSizes = [...card.sizes].sort((a, b) =>
      compareJerseySizes(a.size, b.size),
    );
    return {
      ...card,
      sizes: sortedSizes,
      searchIndexText: buildSearchIndexForProduct({
        team: card.team,
        model: card.model,
        version: card.version,
        sizes: sortedSizes.map((s) => s.size),
        customKeywords: `${card.keywords ?? ''} ${card.referenceName} en camino proximamente`,
      }),
    };
  });

  return cards.sort((a, b) => {
    const da = a.estimatedArrivalDate ?? '9999-12-31';
    const db = b.estimatedArrivalDate ?? '9999-12-31';
    return da.localeCompare(db) || a.model.localeCompare(b.model);
  });
}

function matchesTokens(
  searchIndexText: string,
  availableSizes: JerseySize[],
  productVersion: 'Fans' | 'Player' | 'Retro',
  query: string,
  versionFilter: 'Todas' | 'Player' | 'Fans' | 'Retro',
  sizeFilter: 'Todas' | JerseySize,
): boolean {
  if (versionFilter !== 'Todas' && productVersion !== versionFilter) {
    return false;
  }
  if (sizeFilter !== 'Todas' && !availableSizes.includes(sizeFilter)) {
    return false;
  }

  const qNorm = normalizeSearchText(query);
  if (!qNorm) return true;

  const tokens = qNorm.split(' ').filter(Boolean);
  return tokens.every((token) => {
    // Exact size token check (avoid 's' matching every word containing 's')
    if (['xs', 's', 'm', 'l', 'xl', 'xxl', '3xl', 'xxxl'].includes(token)) {
      return availableSizes.some((sz) => sz.toLowerCase() === token);
    }
    if (token === 'fan') {
      return productVersion === 'Fans' || searchIndexText.includes('fan');
    }
    return searchIndexText.includes(token);
  });
}

export function filterPublicCatalogGroups(
  groups: PublicCatalogTeamGroup[],
  query: string,
  versionFilter: 'Todas' | 'Player' | 'Fans' | 'Retro' = 'Todas',
  sizeFilter: 'Todas' | JerseySize = 'Todas',
): PublicCatalogTeamGroup[] {
  const out: PublicCatalogTeamGroup[] = [];
  for (const group of groups) {
    const filteredProducts = group.products.filter((prod) =>
      matchesTokens(
        prod.searchIndexText,
        prod.sizes.map((s) => s.size),
        prod.version,
        query,
        versionFilter,
        sizeFilter,
      ),
    );
    if (filteredProducts.length > 0) {
      out.push({
        team: group.team,
        totalUnits: filteredProducts.reduce((sum, p) => sum + p.totalStock, 0),
        products: filteredProducts,
      });
    }
  }
  return out;
}

export function filterUpcomingTransitCards(
  cards: PublicTransitCard[],
  query: string,
  versionFilter: 'Todas' | 'Player' | 'Fans' | 'Retro' = 'Todas',
  sizeFilter: 'Todas' | JerseySize = 'Todas',
): PublicTransitCard[] {
  return cards.filter((card) =>
    matchesTokens(
      card.searchIndexText,
      card.sizes.map((s) => s.size),
      card.version,
      query,
      versionFilter,
      sizeFilter,
    ),
  );
}

let inMemoryTurnIndex = 0;

export function getAdvisorForTurnIndex(index: number): CatalogWhatsAppAdvisor {
  const safe =
    ((Math.floor(index) % CATALOG_WHATSAPP_ADVISORS.length) +
      CATALOG_WHATSAPP_ADVISORS.length) %
    CATALOG_WHATSAPP_ADVISORS.length;
  return CATALOG_WHATSAPP_ADVISORS[safe];
}

export function getCurrentWhatsAppTurnIndex(storage?: Storage | null): number {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    if (!store) return inMemoryTurnIndex;
    const raw = store.getItem(WHATSAPP_TURN_STORAGE_KEY);
    if (raw === null) return inMemoryTurnIndex;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed) % CATALOG_WHATSAPP_ADVISORS.length;
    }
  } catch {
    // Fallback to in-memory rotation
  }
  return inMemoryTurnIndex;
}

export function advanceWhatsAppTurnIndex(storage?: Storage | null): number {
  const current = getCurrentWhatsAppTurnIndex(storage);
  const next = (current + 1) % CATALOG_WHATSAPP_ADVISORS.length;
  inMemoryTurnIndex = next;
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    store?.setItem(WHATSAPP_TURN_STORAGE_KEY, String(next));
  } catch {
    // Ignore storage restriction
  }
  return next;
}

export function buildCatalogWhatsAppMessage(params: {
  model: string;
  version: JerseyVersion | string;
  size?: JerseySize | string;
  isTransit?: boolean;
}): string {
  const versionLabel = normalizeVersionDisplay(params.version as JerseyVersion);
  const sizePart = params.size ? `Talla ${params.size}` : 'Talla por confirmar';
  const descriptor = `${params.model}, Versión ${versionLabel}, ${sizePart}`;
  if (params.isTransit) {
    return `¡Hola! 👋 Me interesa apartar la franela ${descriptor} que viene en camino en el catálogo de X4SPORT. ¿Cuándo llega?`;
  }
  return `¡Hola! 👋 Me interesa la franela ${descriptor} que vi en el catálogo de X4SPORT. ¿Está disponible?`;
}

export function buildCatalogWhatsAppHref(
  turnIndex: number,
  params: {
    model: string;
    version: JerseyVersion | string;
    size?: JerseySize | string;
    isTransit?: boolean;
  },
): { advisor: CatalogWhatsAppAdvisor; href: string; message: string } {
  const advisor = getAdvisorForTurnIndex(turnIndex);
  const message = buildCatalogWhatsAppMessage(params);
  const href = `https://wa.me/${advisor.waNumber}?text=${encodeURIComponent(message)}`;
  return { advisor, href, message };
}

export function isPublicCatalogModeFromLocation(locationLike?: {
  search?: string;
  hash?: string;
  pathname?: string;
}): boolean {
  const loc =
    locationLike ??
    (typeof window !== 'undefined' ? window.location : undefined);
  if (!loc) return false;

  const search = loc.search ?? '';
  if (search) {
    const params = new URLSearchParams(search);
    const val = params.get('catalogo');
    if (val === '1' || val === 'true') return true;
  }

  const hash = (loc.hash ?? '').toLowerCase();
  if (hash === '#catalogo' || hash === '#/catalogo') return true;

  const pathname = (loc.pathname ?? '').toLowerCase();
  if (pathname === '/catalogo' || pathname.endsWith('/catalogo')) return true;

  return false;
}

export function buildShareableCatalogUrl(locationLike?: {
  protocol?: string;
  origin?: string;
  pathname?: string;
}): string {
  const loc =
    locationLike ??
    (typeof window !== 'undefined' ? window.location : undefined);
  if (!loc) return '?catalogo=1';
  if (loc.protocol === 'file:') {
    return `${loc.pathname ?? ''}#catalogo`;
  }
  const baseOrigin = loc.origin && loc.origin !== 'null' ? loc.origin : '';
  const basePath = loc.pathname && loc.pathname !== '/' ? loc.pathname : '/';
  return `${baseOrigin}${basePath}?catalogo=1`;
}

export async function compressCatalogImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecciona un archivo de imagen válido (JPG, PNG o WebP).');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const img = new Image();
      img.onerror = () =>
        reject(new Error('La imagen seleccionada no es compatible.'));
      img.onload = () => {
        const MAX_DATA_URL_CHARS = 40 * 1024;
        const maxSide = 480;
        const baseScale = Math.min(1, maxSide / Math.max(img.width, img.height));

        const encodeAt = (scaleFactor: number, quality: number): string | null => {
          const targetW = Math.max(1, Math.round(img.width * baseScale * scaleFactor));
          const targetH = Math.max(1, Math.round(img.height * baseScale * scaleFactor));
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetW, targetH);
          ctx.drawImage(img, 0, 0, targetW, targetH);
          return canvas.toDataURL('image/jpeg', quality);
        };

        let bestOutput = '';
        for (const quality of [0.68, 0.55, 0.45]) {
          const candidate = encodeAt(1, quality);
          if (candidate === null) {
            resolve(dataUrl);
            return;
          }
          bestOutput = candidate;
          if (candidate.length <= MAX_DATA_URL_CHARS) {
            resolve(candidate);
            return;
          }
        }

        // Garantiza <= 40 KB incluso en imágenes muy detalladas
        for (const fallbackScale of [0.8, 0.65, 0.5]) {
          const candidate = encodeAt(fallbackScale, 0.45);
          if (candidate && candidate.length < bestOutput.length) {
            bestOutput = candidate;
          }
          if (candidate && candidate.length <= MAX_DATA_URL_CHARS) {
            resolve(candidate);
            return;
          }
        }

        resolve(bestOutput || dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Consolida filas de matriz de inventario por getModelIdentityKey()
 * para eliminar cualquier duplicado visual por diferencias de tildes, mayúsculas o espacios.
 */
export function consolidateMatrixRowsByModelIdentity(
  rows: InventorySizeMatrixRow[],
  lowStockThreshold = 5,
): InventorySizeMatrixRow[] {
  const merged = new Map<
    string,
    InventorySizeMatrixRow & { extraMap: Map<string, number> }
  >();

  for (const row of rows) {
    const identityKey = getModelIdentityKey({
      model: row.model,
      version: row.version,
    });
    const existing = merged.get(identityKey);
    if (!existing) {
      const extraMap = new Map<string, number>();
      for (const ex of row.extraSizes) {
        extraMap.set(ex.size, (extraMap.get(ex.size) ?? 0) + ex.stock);
      }
      merged.set(identityKey, {
        ...row,
        key: identityKey,
        sizes: { ...row.sizes },
        trackedSizes: { ...row.trackedSizes },
        extraSizes: [...row.extraSizes],
        lowSizes: [...row.lowSizes],
        items: [...row.items],
        extraMap,
      });
      continue;
    }

    // Preferir nombre de modelo con stock activo si la fila existente tenía 0 stock
    if (existing.totalStock === 0 && row.totalStock > 0) {
      existing.model = row.model;
      existing.team = row.team;
      if (row.salePrice > 0) existing.salePrice = row.salePrice;
    } else if (existing.salePrice <= 0 && row.salePrice > 0) {
      existing.salePrice = row.salePrice;
    }

    for (const sz of ALL_JERSEY_SIZES) {
      existing.sizes[sz] = (existing.sizes[sz] ?? 0) + (row.sizes[sz] ?? 0);
      existing.trackedSizes[sz] = existing.trackedSizes[sz] || row.trackedSizes[sz];
    }
    for (const ex of row.extraSizes) {
      existing.extraMap.set(
        ex.size,
        (existing.extraMap.get(ex.size) ?? 0) + ex.stock,
      );
    }

    existing.totalStock += row.totalStock;
    existing.totalFifoValue = round2(existing.totalFifoValue + row.totalFifoValue);
    existing.items.push(...row.items);
  }

  const out = Array.from(merged.values()).map(({ extraMap, ...row }) => {
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

  out.sort(
    (a, b) =>
      a.team.localeCompare(b.team) ||
      a.model.localeCompare(b.model) ||
      a.version.localeCompare(b.version),
  );

  return out;
}

/**
 * Centraliza cualquier cambio o eliminación de foto desde Catálogo Público:
 * actualiza catalogPhotos bajo la clave única y propaga la imagen a todos los registros
 * en state.inventory (incluso stock 0) y pedidos EN TRÁNSITO con la misma identidad.
 */
export function applyCatalogPhotoMutation(
  state: AppState,
  params: { modelKey: string; photoUrl?: string },
): AppState {
  if (!params.modelKey?.trim()) return state;
  const targetIdentity = canonicalizeCatalogKey(params.modelKey);
  const cleanPhoto = params.photoUrl?.trim() ?? '';

  const updatedCatalogPhotos: Record<string, string> = {
    ...(state.catalogPhotos ?? {}),
  };
  for (const existingKey of Object.keys(updatedCatalogPhotos)) {
    if (canonicalizeCatalogKey(existingKey) === targetIdentity) {
      delete updatedCatalogPhotos[existingKey];
    }
  }
  if (cleanPhoto) {
    updatedCatalogPhotos[targetIdentity] = cleanPhoto;
  }

  const nextInventory: InventoryItem[] = (state.inventory ?? []).map((item) => {
    const itemIdentity = getModelIdentityKey({
      model: item.model,
      version: item.version,
    });
    if (itemIdentity !== targetIdentity) return item;
    if (cleanPhoto) {
      return { ...item, imageUrl: cleanPhoto };
    }
    const { imageUrl: _removed, ...rest } = item;
    return rest;
  });

  const nextPurchaseBatches: PurchaseBatchRecord[] = (
    state.purchaseBatches ?? []
  ).map((batch) => {
    let changed = false;
    const nextItems = (batch.items ?? []).map((bi) => {
      const biIdentity = getModelIdentityKey({
        model: bi.model,
        version: bi.version,
      });
      if (biIdentity !== targetIdentity) return bi;
      if (cleanPhoto) {
        if (bi.imageUrl?.trim() === cleanPhoto) return bi;
        changed = true;
        return { ...bi, imageUrl: cleanPhoto };
      }
      if (!bi.imageUrl) return bi;
      changed = true;
      const { imageUrl: _removed, ...rest } = bi;
      return rest;
    });
    return changed ? { ...batch, items: nextItems } : batch;
  });

  const nextPurchases = (state.purchases ?? []).map((pur) => {
    const purIdentity = getModelIdentityKey({
      model: pur.model,
      version: pur.version,
    });
    if (purIdentity !== targetIdentity) return pur;
    if (cleanPhoto) {
      if (pur.imageUrl?.trim() === cleanPhoto) return pur;
      return { ...pur, imageUrl: cleanPhoto };
    }
    if (!pur.imageUrl) return pur;
    const { imageUrl: _removed, ...rest } = pur;
    return rest;
  });

  return {
    ...state,
    catalogPhotos: updatedCatalogPhotos,
    inventory: nextInventory,
    purchaseBatches: nextPurchaseBatches,
    purchases: nextPurchases,
  };
}

/**
 * Propaga y hereda imágenes automáticamente tras registrar o recibir un lote de compra:
 * - Si el modelo ya poseía imagen previa (catálogo, inventario o tránsito), la hereda automáticamente en el nuevo lote FIFO y la orden.
 * - Si el modelo no tenía imagen previa (o estaba en stock 0 sin foto) y el lote trae una foto nueva,
 *   la propaga al nuevo lote FIFO, a los registros anteriores del mismo modelo y al catálogo público.
 */
export function propagateModelPhotosAfterBatchMutation(
  state: AppState,
  params: {
    targetBatch?: PurchaseBatchRecord;
    priorState?: AppState;
    modelPhotos?: Record<
      string,
      { model: string; version: JerseyVersion; photoUrl: string }
    >;
  },
): AppState {
  const targetBatch = params.targetBatch;
  if (!targetBatch) return state;

  const resolvedPhotoByIdentity = new Map<string, string>();
  const batchKeys = new Map<string, { model: string; version: JerseyVersion }>();

  for (const item of targetBatch.items ?? []) {
    const identityKey = getModelIdentityKey({
      model: item.model,
      version: item.version,
    });
    if (!batchKeys.has(identityKey)) {
      batchKeys.set(identityKey, {
        model: item.model,
        version: item.version,
      });
    }
  }

  for (const [identityKey, sample] of batchKeys.entries()) {
    const existingAnywherePhoto = resolveModelPhotoAnywhere(
      params.priorState ?? state,
      sample,
    );
    const incomingFromMap = params.modelPhotos?.[identityKey]?.photoUrl?.trim();
    const incomingFromBatchItem = targetBatch.items
      .find(
        (bi) =>
          getModelIdentityKey({ model: bi.model, version: bi.version }) ===
            identityKey && Boolean(bi.imageUrl?.trim()),
      )
      ?.imageUrl?.trim();

    const finalPhoto =
      existingAnywherePhoto || incomingFromMap || incomingFromBatchItem;
    if (finalPhoto) {
      resolvedPhotoByIdentity.set(identityKey, finalPhoto);
    }
  }

  if (resolvedPhotoByIdentity.size === 0) return state;

  const nextCatalogPhotos: Record<string, string> = {
    ...(state.catalogPhotos ?? {}),
  };
  for (const [identityKey, photoUrl] of resolvedPhotoByIdentity.entries()) {
    for (const existingKey of Object.keys(nextCatalogPhotos)) {
      if (canonicalizeCatalogKey(existingKey) === identityKey) {
        delete nextCatalogPhotos[existingKey];
      }
    }
    nextCatalogPhotos[identityKey] = photoUrl;
  }

  const nextInventory: InventoryItem[] = (state.inventory ?? []).map((item) => {
    const identityKey = getModelIdentityKey({
      model: item.model,
      version: item.version,
    });
    const photoUrl = resolvedPhotoByIdentity.get(identityKey);
    if (!photoUrl || item.imageUrl?.trim() === photoUrl) return item;
    return { ...item, imageUrl: photoUrl };
  });

  const nextPurchaseBatches: PurchaseBatchRecord[] = (
    state.purchaseBatches ?? []
  ).map((batch) => {
    if (batch.id !== targetBatch.id) return batch;
    let changed = false;
    const nextItems = (batch.items ?? []).map((bi) => {
      const identityKey = getModelIdentityKey({
        model: bi.model,
        version: bi.version,
      });
      const photoUrl = resolvedPhotoByIdentity.get(identityKey);
      if (!photoUrl || bi.imageUrl?.trim() === photoUrl) return bi;
      changed = true;
      return { ...bi, imageUrl: photoUrl };
    });
    return changed ? { ...batch, items: nextItems } : batch;
  });

  const nextPurchases = (state.purchases ?? []).map((pur) => {
    const identityKey = getModelIdentityKey({
      model: pur.model,
      version: pur.version,
    });
    const photoUrl = resolvedPhotoByIdentity.get(identityKey);
    if (!photoUrl || pur.imageUrl?.trim() === photoUrl) return pur;
    return { ...pur, imageUrl: photoUrl };
  });

  return {
    ...state,
    catalogPhotos: nextCatalogPhotos,
    inventory: nextInventory,
    purchaseBatches: nextPurchaseBatches,
    purchases: nextPurchases,
  };
}

export const PUBLIC_CART_STORAGE_KEY = 'x4sport_public_cart_v1';

export interface PublicCartItem {
  id: string;
  modelKey: string;
  team: TeamCategory;
  model: string;
  player?: string;
  version: 'Fans' | 'Player' | 'Retro';
  size: JerseySize;
  quantity: number;
  unitPrice: number;
  maxStock: number;
  photoUrl?: string;
}

export interface PublicCartCandidate {
  modelKey: string;
  team: TeamCategory;
  model: string;
  player?: string;
  version: 'Fans' | 'Player' | 'Retro';
  size: JerseySize;
  unitPrice: number;
  maxStock: number;
  photoUrl?: string;
  quantityToAdd?: number;
}

export interface PublicCartTotals {
  totalItems: number;
  distinctLines: number;
  totalUsd: number;
  totalBs: number | null;
  bcvRate: number | null;
}

export interface BuildWhatsAppMultiItemMessageInput {
  items: PublicCartItem[];
  bcvRate?: number | null;
  customerName?: string;
  deliveryZone?: string;
}

export function buildPublicCartItemId(
  modelKey: string,
  size: JerseySize | string,
): string {
  return `${modelKey}::${String(size).trim()}`;
}

export function addItemToPublicCart(
  cart: PublicCartItem[],
  candidate: PublicCartCandidate,
): PublicCartItem[] {
  const safeMaxStock = Math.max(0, Math.floor(candidate.maxStock));
  if (safeMaxStock <= 0) return cart;

  const qtyToAdd = Math.max(1, Math.floor(candidate.quantityToAdd ?? 1));
  const id = buildPublicCartItemId(candidate.modelKey, candidate.size);
  const parsed = splitModelAndPlayerParts(candidate.model);
  const cleanModel = parsed.baseModel || candidate.model.trim();
  const cleanPlayer =
    candidate.player?.trim() || parsed.player || undefined;
  const normalizedVer = normalizeVersionDisplay(candidate.version);

  const existingIndex = cart.findIndex((item) => item.id === id);
  if (existingIndex === -1) {
    const clampedQty = Math.min(qtyToAdd, safeMaxStock);
    return [
      ...cart,
      {
        id,
        modelKey: candidate.modelKey,
        team: candidate.team,
        model: cleanModel,
        ...(cleanPlayer ? { player: cleanPlayer } : {}),
        version: normalizedVer,
        size: candidate.size,
        quantity: clampedQty,
        unitPrice: round2(candidate.unitPrice),
        maxStock: safeMaxStock,
        ...(candidate.photoUrl?.trim() ? { photoUrl: candidate.photoUrl.trim() } : {}),
      },
    ];
  }

  return cart.map((item, idx) => {
    if (idx !== existingIndex) return item;
    const nextQty = Math.min(item.quantity + qtyToAdd, safeMaxStock);
    return {
      ...item,
      team: candidate.team,
      model: cleanModel,
      ...(cleanPlayer ? { player: cleanPlayer } : {}),
      version: normalizedVer,
      quantity: nextQty,
      unitPrice: round2(candidate.unitPrice),
      maxStock: safeMaxStock,
      ...(candidate.photoUrl?.trim() ? { photoUrl: candidate.photoUrl.trim() } : {}),
    };
  });
}

export function updatePublicCartItemQty(
  cart: PublicCartItem[],
  itemId: string,
  nextQty: number,
): PublicCartItem[] {
  if (!Number.isFinite(nextQty)) return cart;
  const targetQty = Math.floor(nextQty);
  if (targetQty <= 0) {
    return cart.filter((item) => item.id !== itemId);
  }
  return cart.flatMap((item) => {
    if (item.id !== itemId) return [item];
    const safeMax = Math.max(0, Math.floor(item.maxStock));
    if (safeMax <= 0) return [];
    return [
      {
        ...item,
        quantity: Math.min(targetQty, safeMax),
      },
    ];
  });
}

export function removeItemFromPublicCart(
  cart: PublicCartItem[],
  itemId: string,
): PublicCartItem[] {
  return cart.filter((item) => item.id !== itemId);
}

export function syncPublicCartWithCatalogGroups(
  cart: PublicCartItem[],
  teamGroups: PublicCatalogTeamGroup[],
): PublicCartItem[] {
  if (cart.length === 0) return cart;

  const liveByLineId = new Map<
    string,
    { product: PublicCatalogProduct; sizeOpt: PublicCatalogSizeOption }
  >();

  for (const group of teamGroups) {
    for (const product of group.products) {
      for (const sizeOpt of product.sizes) {
        if (sizeOpt.stock <= 0) continue;
        liveByLineId.set(buildPublicCartItemId(product.key, sizeOpt.size), {
          product,
          sizeOpt,
        });
      }
    }
  }

  let changed = false;
  const next: PublicCartItem[] = [];

  for (const item of cart) {
    const match = liveByLineId.get(item.id);
    if (!match) {
      changed = true;
      continue;
    }

    const liveStock = Math.max(0, Math.floor(match.sizeOpt.stock));
    if (liveStock <= 0) {
      changed = true;
      continue;
    }

    const parsed = splitModelAndPlayerParts(match.product.model);
    const liveModel = parsed.baseModel || match.product.model.trim();
    const livePlayer = parsed.player || item.player || undefined;
    const clampedQty = Math.max(1, Math.min(Math.floor(item.quantity), liveStock));
    const livePrice = round2(match.sizeOpt.salePrice);
    const livePhoto = match.product.photoUrl?.trim() || undefined;

    if (
      clampedQty !== item.quantity ||
      liveStock !== item.maxStock ||
      livePrice !== item.unitPrice ||
      liveModel !== item.model ||
      livePlayer !== item.player ||
      livePhoto !== item.photoUrl ||
      match.product.team !== item.team ||
      match.product.version !== item.version
    ) {
      changed = true;
    }

    next.push({
      ...item,
      team: match.product.team,
      model: liveModel,
      ...(livePlayer ? { player: livePlayer } : {}),
      version: match.product.version,
      quantity: clampedQty,
      unitPrice: livePrice,
      maxStock: liveStock,
      ...(livePhoto ? { photoUrl: livePhoto } : {}),
    });
  }

  return changed ? next : cart;
}

export function calculatePublicCartTotals(
  items: PublicCartItem[],
  bcvRate?: number | null,
): PublicCartTotals {
  let totalItems = 0;
  let totalUsd = 0;
  let distinctLines = 0;

  for (const item of items) {
    const qty = Number.isFinite(item.quantity)
      ? Math.max(0, Math.floor(item.quantity))
      : 0;
    if (qty <= 0) continue;
    const price = Number.isFinite(item.unitPrice) ? Math.max(0, item.unitPrice) : 0;
    distinctLines += 1;
    totalItems += qty;
    totalUsd = round2(totalUsd + round2(price * qty));
  }

  const validBcv = isRateValid(bcvRate) ? bcvRate : null;
  const totalBs = validBcv !== null ? round2(totalUsd * validBcv) : null;

  return {
    totalItems,
    distinctLines,
    totalUsd,
    totalBs,
    bcvRate: validBcv,
  };
}

export function buildWhatsAppMultiItemMessage({
  items,
  bcvRate,
  customerName,
  deliveryZone,
}: BuildWhatsAppMultiItemMessageInput): string {
  const activeItems = items.filter(
    (item) => Number.isFinite(item.quantity) && Math.floor(item.quantity) > 0,
  );
  const totals = calculatePublicCartTotals(activeItems, bcvRate);

  const lines: string[] = [
    'Hola X4SPORT, quiero realizar el siguiente pedido desde el Catálogo:',
  ];

  if (activeItems.length > 0) {
    lines.push('');
    activeItems.forEach((item, index) => {
      const qty = Math.floor(item.quantity);
      const parsed = splitModelAndPlayerParts(item.model);
      const displayModel = parsed.baseModel || item.model.trim();
      const displayPlayer = item.player?.trim() || parsed.player;
      const versionLabel = normalizeVersionDisplay(item.version);
      const subtotalUsd = round2(item.unitPrice * qty);
      const playerSegment = displayPlayer ? ` · ${displayPlayer}` : '';
      lines.push(
        `${index + 1}. ${qty}x ${displayModel} (${versionLabel})${playerSegment} · Talla ${item.size} — ${formatUSD(subtotalUsd)} USD`,
      );
    });
  }

  lines.push('');
  lines.push(`Total USD: ${formatUSD(totals.totalUsd)} USD`);
  if (totals.totalBs !== null && totals.bcvRate !== null) {
    lines.push(
      `Total en Bolívares (Tasa BCV ${formatVES(totals.bcvRate)}): ${formatVES(totals.totalBs)}`,
    );
  }

  const cleanName = customerName?.trim();
  const cleanZone = deliveryZone?.trim();
  if (cleanName || cleanZone) {
    lines.push('');
    if (cleanName) {
      lines.push(`Nombre: ${cleanName}`);
    }
    if (cleanZone) {
      lines.push(`Ciudad / Entrega: ${cleanZone}`);
    }
  }

  return lines.join('\n');
}

export function buildCatalogMultiItemWhatsAppHref(
  turnIndex: number,
  params: BuildWhatsAppMultiItemMessageInput,
): { advisor: CatalogWhatsAppAdvisor; href: string; message: string } {
  const advisor = getAdvisorForTurnIndex(turnIndex);
  const message = buildWhatsAppMultiItemMessage(params);
  const href = `https://wa.me/${advisor.waNumber}?text=${encodeURIComponent(message)}`;
  return { advisor, href, message };
}

export function loadPublicCartFromSession(
  storage?: Storage | null,
): PublicCartItem[] {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.sessionStorage
          : null;
    const raw = store?.getItem(PUBLIC_CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PublicCartItem =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as PublicCartItem).id === 'string' &&
        typeof (entry as PublicCartItem).modelKey === 'string' &&
        typeof (entry as PublicCartItem).model === 'string' &&
        typeof (entry as PublicCartItem).size === 'string' &&
        typeof (entry as PublicCartItem).quantity === 'number' &&
        typeof (entry as PublicCartItem).unitPrice === 'number' &&
        typeof (entry as PublicCartItem).maxStock === 'number',
    );
  } catch {
    return [];
  }
}

export function savePublicCartToSession(
  items: PublicCartItem[],
  storage?: Storage | null,
): void {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.sessionStorage
          : null;
    if (!store) return;
    if (items.length === 0) {
      store.removeItem(PUBLIC_CART_STORAGE_KEY);
    } else {
      store.setItem(PUBLIC_CART_STORAGE_KEY, JSON.stringify(items));
    }
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}


