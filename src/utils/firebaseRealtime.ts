import {
  createDemoSeedState,
  createEmptyCleanState,
  createInitialState,
} from '../data/initialState';
import type {
  AppState,
  ExchangeRates,
  GeneralConfig,
  InventoryItem,
  JerseySize,
  JerseyVersion,
  PurchaseBatchItemRecord,
  PurchaseBatchRecord,
  SaleRecord,
  ShippingType,
  TeamCategory,
} from '../types/erp';
import {
  type ActionResult,
  DEFAULT_GENERAL_CONFIG,
  isAccidentalDemoCatalogOnly,
  migrateLegacyStateToCurrent,
  normalizeAppState,
  normalizeGeneralConfig,
  recoverStartupErpState,
  sanitizeForFirebase,
  toArray,
} from './finance';

// Configuración de Firebase
export const firebaseConfig = {
  apiKey: 'AIzaSyAADvIq-w-2z9UGl3QEBMgQDOxCOI4VI9Q',
  authDomain: 'x4sport-sistem-maestro.firebaseapp.com',
  databaseURL: 'https://x4sport-sistem-maestro-default-rtdb.firebaseio.com',
  projectId: 'x4sport-sistem-maestro',
  storageBucket: 'x4sport-sistem-maestro.firebasestorage.app',
  messagingSenderId: '821669414352',
  appId: '1:821669414352:web:9f6205b3c60a23316565d5',
  measurementId: 'G-QZF6FCRGX8',
} as const;

export const RTDB_ERP_PATH = 'x4sport/erpState';
export const RTDB_PUBLIC_CATALOG_PATH = 'x4sport/publicCatalog';
export const RTDB_CONFIG_PATH = 'configuracion/general';
export const LOCAL_BACKUP_KEY = 'x4sport_erp_backup_v2';
export const LOCAL_PUBLIC_CATALOG_BACKUP_KEY = 'x4sport_public_catalog_v1';
export const LOCAL_CONFIG_BACKUP_KEY = 'x4sport_general_config_v1';

export interface PublicCatalogInventoryItem {
  id: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  stock: number;
  salePrice: number;
  imageUrl?: string;
}

export interface PublicCatalogBatchItem {
  skuId?: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  size: JerseySize;
  orderedQuantity: number;
  quantity: number;
  salePrice?: number;
  imageUrl?: string;
}

export interface PublicCatalogBatch {
  id: string;
  status: 'EN TRÁNSITO';
  entryDate: string;
  estimatedArrivalDate?: string;
  shippingType: ShippingType;
  referenceName: string;
  orderedTotalUnits: number;
  totalUnits: number;
  items: PublicCatalogBatchItem[];
}

export interface PublicCatalogSnapshot {
  catalogEnabled: boolean;
  exchangeRates: ExchangeRates;
  catalogPhotos: Record<string, string>;
  catalogKeywords: Record<string, string>;
  inventory: PublicCatalogInventoryItem[];
  purchaseBatches: PublicCatalogBatch[];
}

interface FirebaseDataSnapshot {
  exists: () => boolean;
  val: () => unknown;
}

interface FirebaseDatabaseRef {
  on: (
    eventType: 'value',
    callback: (snapshot: FirebaseDataSnapshot) => void,
    cancelCallback?: (error: Error) => void,
  ) => (snapshot: FirebaseDataSnapshot) => void;
  off: (
    eventType: 'value',
    callback?: (snapshot: FirebaseDataSnapshot) => void,
  ) => void;
  set: (value: unknown) => Promise<void>;
  update: (values: Record<string, unknown>) => Promise<void>;
  child: (path: string) => FirebaseDatabaseRef;
  transaction: (
    transactionUpdate: (currentData: unknown) => unknown,
  ) => Promise<{ committed: boolean; snapshot: FirebaseDataSnapshot }>;
}

interface FirebaseAuthCompat {
  currentUser?: {
    uid?: string;
    isAnonymous?: boolean;
    getIdToken?: () => Promise<string>;
  } | null;
  signInAnonymously?: () => Promise<{ user?: { uid?: string } | null }>;
}

interface FirebaseCompatGlobal {
  apps: unknown[];
  initializeApp: (config: Record<string, string>) => unknown;
  app: () => unknown;
  auth?: () => FirebaseAuthCompat;
  database: () => {
    ref: (path: string) => FirebaseDatabaseRef;
  };
}

declare global {
  interface Window {
    firebase?: FirebaseCompatGlobal;
  }
}

/**
 * Lee en modo SOLO LECTURA cualquier respaldo previo en localStorage (sin borrar ni sobrescribir nada)
 * para migrar automáticamente estructuras anteriores de X4SPORT al formato actual.
 */
export function readLocalStorageRecoveryCandidates(): unknown[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const candidates: unknown[] = [];
  try {
    const primaryRaw = window.localStorage.getItem(LOCAL_BACKUP_KEY);
    if (primaryRaw) {
      candidates.push(primaryRaw);
    }
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || k === LOCAL_BACKUP_KEY) continue;
      const lower = k.toLowerCase();
      if (
        lower.includes('x4sport') ||
        lower.includes('erp') ||
        lower.includes('inventory') ||
        lower.includes('inventario') ||
        lower.includes('ventas') ||
        lower.includes('finanzas')
      ) {
        const raw = window.localStorage.getItem(k);
        if (raw) candidates.push(raw);
      }
    }
  } catch {
    // Lectura segura ante restricciones del navegador
  }
  return candidates;
}

/**
 * Persiste en localStorage el estado real completo de la app.
 * Nunca guarda ítems genéricos de prueba no autorizados ni sobrescribe un inventario
 * real previo con un arreglo vacío transitorio antes de hidratar Firebase.
 */
export function saveLocalStateBackup(
  state: AppState,
  options?: { allowOverwriteEmpty?: boolean },
): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (isAccidentalDemoCatalogOnly(state)) return;

  if (
    !options?.allowOverwriteEmpty &&
    (!state.inventory || state.inventory.length === 0) &&
    !state.userPurgedEmpty
  ) {
    try {
      const existingRaw = window.localStorage.getItem(LOCAL_BACKUP_KEY);
      if (existingRaw) {
        const existingMigrated = migrateLegacyStateToCurrent(existingRaw);
        if (
          existingMigrated &&
          existingMigrated.inventory.length > 0 &&
          !isAccidentalDemoCatalogOnly(existingMigrated)
        ) {
          return;
        }
      }
    } catch {
      // Continuar con guardado seguro
    }
  }

  try {
    window.localStorage.setItem(
      LOCAL_BACKUP_KEY,
      JSON.stringify(sanitizeForFirebase(state)),
    );
  } catch {
    // Ignorar errores de cuota llena
  }
}

/**
 * Conservada por compatibilidad de API: ya no destruye localStorage automáticamente
 * para respetar el blindaje anti-borrado de datos del usuario.
 */
export function purgeLegacyLocalStorage(): number {
  return 0;
}

function getFirebaseDatabase(): { ref: (path: string) => FirebaseDatabaseRef } {
  if (typeof window === 'undefined' || !window.firebase) {
    throw new Error(
      'El SDK de Firebase CDN no está disponible en este navegador.',
    );
  }

  const fb = window.firebase;
  if (!fb.apps || fb.apps.length === 0) {
    fb.initializeApp({ ...firebaseConfig });
  }
  return fb.database();
}

let pendingSilentAuthPromise: Promise<boolean> | null = null;
let lastSilentAuthError: string | null = null;

function extractFirebaseAuthErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) {
      return code.trim();
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  const str = String(err ?? '').trim();
  return str || 'auth/unknown-error';
}

/**
 * Garantiza una sesión anónima silenciosa en Firebase Auth antes de operar sobre
 * x4sport/erpState cuando las reglas RTDB exigen `"auth != null"`.
 * Captura cualquier error sin bloquear la aplicación si Anonymous Auth aún no está habilitado.
 */
export async function ensureSilentFirebaseAuth(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.firebase) {
    return false;
  }

  const fb = window.firebase;
  try {
    if (!fb.apps || fb.apps.length === 0) {
      fb.initializeApp({ ...firebaseConfig });
    }
    if (typeof fb.auth !== 'function') {
      return false;
    }

    const authInstance = fb.auth();
    if (!authInstance) {
      return false;
    }
    if (authInstance.currentUser) {
      lastSilentAuthError = null;
      return true;
    }
    if (typeof authInstance.signInAnonymously !== 'function') {
      return false;
    }

    if (!pendingSilentAuthPromise) {
      pendingSilentAuthPromise = Promise.resolve(authInstance.signInAnonymously())
        .then((cred) => {
          const ok = Boolean(cred?.user ?? authInstance.currentUser);
          if (ok) {
            lastSilentAuthError = null;
          }
          return ok;
        })
        .catch((err: unknown) => {
          lastSilentAuthError = extractFirebaseAuthErrorCode(err);
          return false;
        })
        .finally(() => {
          pendingSilentAuthPromise = null;
        });
    }

    return await pendingSilentAuthPromise;
  } catch (err: unknown) {
    lastSilentAuthError = extractFirebaseAuthErrorCode(err);
    return false;
  }
}

/**
 * Hook onValue en tiempo real contra Firebase Realtime Database (x4sport/erpState)
 * con hidratación REST rápida inicial y recuperación/migración automática no destructiva.
 */
export function subscribeErpState(
  onState: (state: AppState) => void,
  onError: (message: string) => void,
): () => void {
  let active = true;
  let seededOnce = false;
  let syncedRecoveryOnce = false;
  let receivedRealtimeSnapshot = false;
  let deliveredInitial = false;
  let detachRealtimeListener: (() => void) | null = null;

  const deliverState = (raw: unknown, fromRealtime: boolean) => {
    if (!active) return;
    if (fromRealtime) {
      receivedRealtimeSnapshot = true;
    } else if (receivedRealtimeSnapshot) {
      return;
    }
    deliveredInitial = true;

    const normalized = normalizeAppState(raw);
    const { state: recovered, needsFirebaseSync } = recoverStartupErpState(
      normalized,
      readLocalStorageRecoveryCandidates(),
    );

    saveLocalStateBackup(recovered, { allowOverwriteEmpty: needsFirebaseSync });

    onState(recovered);

    if (fromRealtime && needsFirebaseSync && !syncedRecoveryOnce) {
      syncedRecoveryOnce = true;
      void writeErpState(recovered).catch(() => {
        // Reintentará en la próxima escritura si la red está momentáneamente offline
      });
    }
  };

  const safetyTimer = setTimeout(() => {
    if (!active || deliveredInitial) return;
    deliveredInitial = true;
    const { state: fallbackRecovered, needsFirebaseSync } = recoverStartupErpState(
      createInitialState(),
      readLocalStorageRecoveryCandidates(),
    );
    saveLocalStateBackup(fallbackRecovered, { allowOverwriteEmpty: needsFirebaseSync });
    onState(fallbackRecovered);
    onError(
      'Conexión lenta con Firebase Realtime Database; mostrando datos recuperados mientras sincroniza.',
    );
  }, 6000);

  void ensureSilentFirebaseAuth()
    .then(async () => {
      if (!active) return;

      // Hidratación inicial rápida vía REST (~200ms) con token de Firebase Auth si está disponible
      let restAuthQuery = '';
      try {
        const token = await window.firebase?.auth?.()?.currentUser?.getIdToken?.();
        if (token) {
          restAuthQuery = `?auth=${encodeURIComponent(token)}`;
        }
      } catch {
        // Continuar sin token REST si falla la lectura del token
      }

      const restUrl = `${firebaseConfig.databaseURL}/${RTDB_ERP_PATH}.json${restAuthQuery}`;
      void fetch(restUrl, { cache: 'no-store' })
        .then(async (resp) => {
          if (!active || receivedRealtimeSnapshot) return;
          if (resp.status === 401 || resp.status === 403) {
            clearTimeout(safetyTimer);
            const currentHost =
              typeof window !== 'undefined' ? window.location?.hostname : '';
            if (
              lastSilentAuthError &&
              lastSilentAuthError.toLowerCase().includes('unauthorized-domain')
            ) {
              onError(
                `El dominio actual${currentHost ? ` (${currentHost})` : ''} no está autorizado en Firebase Authentication (${lastSilentAuthError}). Agrégalo en Firebase Console > Authentication > Settings > Authorized domains.`,
              );
            } else if (lastSilentAuthError) {
              onError(
                `Acceso denegado en Firebase Realtime Database (HTTP ${resp.status}). Detalle de Firebase Auth: ${lastSilentAuthError}.`,
              );
            } else {
              onError(
                `Permiso denegado en Firebase Realtime Database (HTTP ${resp.status}). Verifica las reglas de seguridad o habilita Anonymous Auth en Firebase Authentication.`,
              );
            }
            return;
          }
          if (!resp.ok) return;
          const data: unknown = await resp.json();
          if (!active || receivedRealtimeSnapshot) return;
          if (data !== null && data !== undefined) {
            deliverState(data, false);
          }
        })
        .catch(() => {
          // Fallback manejado por listener onValue / timeout
        });

      try {
        const db = getFirebaseDatabase();
        const stateRef = db.ref(RTDB_ERP_PATH);

        const listener = stateRef.on(
          'value',
          (snapshot) => {
            if (!active) return;
            clearTimeout(safetyTimer);
            try {
              if (!snapshot.exists() || snapshot.val() === null) {
                if (!seededOnce) {
                  seededOnce = true;
                  const { state: initialRecovered } = recoverStartupErpState(
                    createInitialState(),
                    readLocalStorageRecoveryCandidates(),
                  );
                  const initialPayload = sanitizeForFirebase(initialRecovered);
                  void stateRef
                    .transaction((current) => {
                      try {
                        return current === null ? initialPayload : current;
                      } catch {
                        return undefined;
                      }
                    })
                    .catch((err: unknown) => {
                      if (!active) return;
                      onError(formatFirebaseError(err));
                    });
                }
                return;
              }

              deliverState(snapshot.val(), true);
            } catch (err) {
              if (!active) return;
              onError(formatFirebaseError(err));
            }
          },
          (error) => {
            if (!active) return;
            clearTimeout(safetyTimer);
            onError(formatFirebaseError(error));
          },
        );

        detachRealtimeListener = () => {
          stateRef.off('value', listener);
        };
      } catch (err) {
        clearTimeout(safetyTimer);
        onError(formatFirebaseError(err));
      }
    })
    .catch((err: unknown) => {
      if (!active) return;
      clearTimeout(safetyTimer);
      onError(formatFirebaseError(err));
    });

  return () => {
    active = false;
    clearTimeout(safetyTimer);
    if (detachRealtimeListener) {
      detachRealtimeListener();
    }
  };
}

/**
 * Escritura completa atómica vía set() en Firebase RTDB + respaldo directo en localStorage.
 */
export async function writeErpState(nextState: AppState): Promise<void> {
  saveLocalStateBackup(nextState, { allowOverwriteEmpty: true });
  await ensureSilentFirebaseAuth();
  const db = getFirebaseDatabase();
  const payload = sanitizeForFirebase(nextState);
  await db.ref(RTDB_ERP_PATH).set(payload);
}

export interface TransactErpStateOutcome {
  ok: boolean;
  error?: string;
  state?: AppState;
  createdBatch?: PurchaseBatchRecord;
  createdSale?: SaleRecord;
  source: 'firebase' | 'rejected' | 'unavailable';
}

/**
 * Ejecuta una transacción atómica sobre x4sport/erpState en Firebase RTDB
 * para evitar condiciones de carrera y duplicados en compras o recepciones.
 */
export async function transactErpState(
  mutator: (current: AppState) => ActionResult,
  fallbackState: AppState,
): Promise<TransactErpStateOutcome> {
  let db: { ref: (path: string) => FirebaseDatabaseRef };
  try {
    await ensureSilentFirebaseAuth();
    db = getFirebaseDatabase();
  } catch (err: unknown) {
    return {
      ok: false,
      error: formatFirebaseError(err),
      source: 'unavailable',
    };
  }

  let rejectedError: string | undefined;
  let lastActionResult: ActionResult | null = null;

  try {
    const txResult = await db.ref(RTDB_ERP_PATH).transaction((currentRaw) => {
      rejectedError = undefined;
      lastActionResult = null;
      try {
        const baseState =
          currentRaw !== null && currentRaw !== undefined
            ? normalizeAppState(currentRaw)
            : fallbackState;
        const res = mutator(baseState);
        if (!res.ok) {
          rejectedError = res.error ?? 'Operación rechazada por validación.';
          return undefined;
        }
        lastActionResult = res;
        return sanitizeForFirebase(res.state);
      } catch (err: unknown) {
        rejectedError = formatFirebaseError(err);
        return undefined;
      }
    });

    if (rejectedError) {
      return {
        ok: false,
        error: rejectedError,
        source: 'rejected',
      };
    }

    if (txResult.committed && lastActionResult) {
      const committedRes = lastActionResult as ActionResult;
      const finalState =
        txResult.snapshot && txResult.snapshot.exists()
          ? normalizeAppState(txResult.snapshot.val())
          : committedRes.state;
      saveLocalStateBackup(finalState, { allowOverwriteEmpty: true });
      return {
        ok: true,
        state: finalState,
        createdBatch: committedRes.createdBatch,
        createdSale: committedRes.createdSale,
        source: 'firebase',
      };
    }

    return {
      ok: false,
      error: 'No se pudo confirmar la transacción en Firebase RTDB. Intenta de nuevo.',
      source: 'unavailable',
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: formatFirebaseError(err),
      source: 'unavailable',
    };
  }
}

/**
 * Actualización parcial atómica vía update() en Firebase RTDB.
 */
export async function updateErpState(
  partial: Partial<AppState>,
): Promise<void> {
  await ensureSilentFirebaseAuth();
  const db = getFirebaseDatabase();
  const payload = sanitizeForFirebase(partial) as Record<string, unknown>;
  await db.ref(RTDB_ERP_PATH).update(payload);
}

export async function writeExchangeRatesOnly(
  rates: ExchangeRates,
): Promise<void> {
  await updateErpState({ exchangeRates: rates });
}

export async function resetBaselineStateInFirebase(): Promise<AppState> {
  const fresh = createInitialState();
  await writeErpState(fresh);
  return fresh;
}

export async function resetErpStateInFirebase(): Promise<AppState> {
  const demo = createDemoSeedState();
  await writeErpState(demo);
  return demo;
}

/**
 * Reinicia explícitamente la nube a un estado sin inventario manteniendo los saldos fijos iniciales
 * ($135.19 caja, $263.50 CxC desglosada, $1,912.35 capital, $624.00 gastos y $317.37 ganancia neta histórica),
 * sin borrar el respaldo histórico existente en localStorage.
 */
export async function purgeAllDataInFirebase(
  bcv = 46.5,
  usdt = 54.2,
  source: ExchangeRates['source'] = 'manual',
): Promise<AppState> {
  const clean = createEmptyCleanState(undefined, bcv, usdt);
  clean.exchangeRates.source = source;
  clean.userPurgedEmpty = true;
  await writeErpState(clean);
  return clean;
}

export function formatFirebaseError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (
    msg.toLowerCase().includes('permission_denied') ||
    msg.toLowerCase().includes('permission denied')
  ) {
    return 'Permiso denegado en Firebase Realtime Database. Verifica las reglas de lectura/escritura en tu consola de Firebase.';
  }
  return msg || 'Error de conexión con Firebase Realtime Database.';
}

export function readLocalGeneralConfigBackup(): GeneralConfig {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_GENERAL_CONFIG;
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_CONFIG_BACKUP_KEY);
    if (!raw) return DEFAULT_GENERAL_CONFIG;
    return normalizeGeneralConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_GENERAL_CONFIG;
  }
}

export function saveLocalGeneralConfigBackup(config: GeneralConfig): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      LOCAL_CONFIG_BACKUP_KEY,
      JSON.stringify(sanitizeForFirebase(config)),
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Suscripción única en tiempo real a `configuracion/general` en Firebase RTDB.
 * Debe montarse una sola vez en App.tsx para evitar listeners duplicados.
 */
export function subscribeGeneralConfig(
  onConfig: (config: GeneralConfig) => void,
): () => void {
  let active = true;
  let receivedRealtime = false;
  let detachConfigListener: (() => void) | null = null;

  void ensureSilentFirebaseAuth()
    .then(async () => {
      if (!active) return;

      let restAuthQuery = '';
      try {
        const token = await window.firebase?.auth?.()?.currentUser?.getIdToken?.();
        if (token) {
          restAuthQuery = `?auth=${encodeURIComponent(token)}`;
        }
      } catch {
        // Continue without REST token if unavailable
      }

      const restUrl = `${firebaseConfig.databaseURL}/${RTDB_CONFIG_PATH}.json${restAuthQuery}`;
      void fetch(restUrl, { cache: 'no-store' })
        .then(async (resp) => {
          if (!active || receivedRealtime || !resp.ok) return;
          const data: unknown = await resp.json();
          if (!active || receivedRealtime) return;
          if (data !== null && data !== undefined) {
            const normalized = normalizeGeneralConfig(data);
            saveLocalGeneralConfigBackup(normalized);
            onConfig(normalized);
          }
        })
        .catch(() => {
          // Fallback handled by onValue listener or local backup
        });

      try {
        const db = getFirebaseDatabase();
        const configRef = db.ref(RTDB_CONFIG_PATH);

        const listener = configRef.on(
          'value',
          (snapshot) => {
            if (!active) return;
            receivedRealtime = true;
            try {
              if (!snapshot.exists() || snapshot.val() === null) {
                return;
              }
              const normalized = normalizeGeneralConfig(snapshot.val());
              saveLocalGeneralConfigBackup(normalized);
              onConfig(normalized);
            } catch {
              // Keep active local config cleanly if parsing fails
            }
          },
          () => {
            // Keep active local config cleanly if permission/network error occurs
          },
        );

        detachConfigListener = () => {
          configRef.off('value', listener);
        };
      } catch {
        // Keep active local config cleanly if Firebase SDK is unavailable
      }
    })
    .catch(() => {
      // Keep active local config cleanly
    });

  return () => {
    active = false;
    if (detachConfigListener) {
      detachConfigListener();
    }
  };
}

export async function writeGeneralConfig(config: GeneralConfig): Promise<void> {
  const clean = normalizeGeneralConfig(config);
  saveLocalGeneralConfigBackup(clean);
  await ensureSilentFirebaseAuth();
  const db = getFirebaseDatabase();
  await db.ref(RTDB_CONFIG_PATH).set(sanitizeForFirebase(clean));
}

function normalizePublicCatalogStringMap(rawMap: unknown): Record<string, string> {
  if (!rawMap || typeof rawMap !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawMap as Record<string, unknown>)) {
    if (typeof val !== 'string') continue;
    const safeKey = key.replace(/[.#$/[\]]/g, '_');
    if (!safeKey) continue;
    if (key !== safeKey && safeKey in out) continue;
    out[safeKey] = val;
  }
  return out;
}

export function buildPublicCatalogSnapshot(state: AppState): PublicCatalogSnapshot {
  const rawInventory = toArray<InventoryItem>(state.inventory);
  const publicInventory: PublicCatalogInventoryItem[] = rawInventory
    .filter((item) => Boolean(item && item.id))
    .map((item) => ({
      id: item.id,
      team: item.team,
      model: item.model,
      version: item.version,
      size: item.size,
      stock: Number.isFinite(item.stock) ? item.stock : 0,
      salePrice: Number.isFinite(item.salePrice) ? item.salePrice : 0,
      ...(item.imageUrl?.trim() ? { imageUrl: item.imageUrl.trim() } : {}),
    }));

  const rawBatches = toArray<PurchaseBatchRecord>(state.purchaseBatches);
  const publicTransitBatches: PublicCatalogBatch[] = rawBatches
    .filter((batch) => Boolean(batch && batch.status === 'EN TRÁNSITO'))
    .map((batch) => ({
      id: batch.id,
      status: 'EN TRÁNSITO' as const,
      entryDate: batch.entryDate ?? '',
      ...(batch.estimatedArrivalDate
        ? { estimatedArrivalDate: batch.estimatedArrivalDate }
        : {}),
      shippingType: batch.shippingType,
      referenceName: batch.referenceName ?? '',
      orderedTotalUnits: Number.isFinite(batch.orderedTotalUnits)
        ? batch.orderedTotalUnits
        : Number.isFinite(batch.totalUnits)
          ? batch.totalUnits
          : 0,
      totalUnits: Number.isFinite(batch.totalUnits) ? batch.totalUnits : 0,
      items: toArray<PurchaseBatchItemRecord>(batch.items).map((item) => ({
        ...(item.skuId ? { skuId: item.skuId } : {}),
        team: item.team,
        model: item.model,
        version: item.version,
        size: item.size,
        orderedQuantity: Number.isFinite(item.orderedQuantity)
          ? item.orderedQuantity
          : Number.isFinite(item.quantity)
            ? item.quantity
            : 0,
        quantity: Number.isFinite(item.quantity) ? item.quantity : 0,
        ...(typeof item.salePrice === 'number' && Number.isFinite(item.salePrice)
          ? { salePrice: item.salePrice }
          : {}),
        ...(item.imageUrl?.trim() ? { imageUrl: item.imageUrl.trim() } : {}),
      })),
    }));

  const snapshot: PublicCatalogSnapshot = {
    catalogEnabled: state.catalogEnabled !== false,
    exchangeRates: {
      bcv: Number.isFinite(state.exchangeRates?.bcv) ? state.exchangeRates.bcv : 0,
      usdt: Number.isFinite(state.exchangeRates?.usdt) ? state.exchangeRates.usdt : 0,
      updatedAt: state.exchangeRates?.updatedAt ?? '',
      source: state.exchangeRates?.source ?? 'seed',
    },
    catalogPhotos: normalizePublicCatalogStringMap(state.catalogPhotos),
    catalogKeywords: normalizePublicCatalogStringMap(state.catalogKeywords),
    inventory: publicInventory,
    purchaseBatches: publicTransitBatches,
  };

  return sanitizeForFirebase(snapshot);
}

export function normalizePublicCatalogToAppState(raw: unknown): AppState {
  const parsed =
    raw && typeof raw === 'object' ? (raw as Partial<PublicCatalogSnapshot>) : {};

  const exchangeRates: ExchangeRates = {
    bcv:
      typeof parsed.exchangeRates?.bcv === 'number' &&
      Number.isFinite(parsed.exchangeRates.bcv)
        ? parsed.exchangeRates.bcv
        : 0,
    usdt:
      typeof parsed.exchangeRates?.usdt === 'number' &&
      Number.isFinite(parsed.exchangeRates.usdt)
        ? parsed.exchangeRates.usdt
        : 0,
    updatedAt:
      typeof parsed.exchangeRates?.updatedAt === 'string'
        ? parsed.exchangeRates.updatedAt
        : '',
    source: parsed.exchangeRates?.source ?? 'seed',
  };

  const inventory: InventoryItem[] = toArray<PublicCatalogInventoryItem>(
    parsed.inventory,
  )
    .filter((item) => Boolean(item && item.id))
    .map((item) => ({
      id: item.id,
      team: item.team,
      model: item.model,
      version: item.version,
      size: item.size,
      stock: Number.isFinite(item.stock) ? item.stock : 0,
      salePrice: Number.isFinite(item.salePrice) ? item.salePrice : 0,
      cogs: 0,
      fifoBatches: [],
      ...(item.imageUrl?.trim() ? { imageUrl: item.imageUrl.trim() } : {}),
    }));

  const purchaseBatches: PurchaseBatchRecord[] = toArray<PublicCatalogBatch>(
    parsed.purchaseBatches,
  )
    .filter((batch) => Boolean(batch && batch.status === 'EN TRÁNSITO'))
    .map((batch) => ({
      id: batch.id,
      status: 'EN TRÁNSITO',
      fundingSource: 'cashOnHand',
      entryDate: batch.entryDate ?? '',
      ...(batch.estimatedArrivalDate
        ? { estimatedArrivalDate: batch.estimatedArrivalDate }
        : {}),
      shippingType: batch.shippingType ?? 'Aéreo',
      referenceName: batch.referenceName ?? '',
      orderedTotalUnits: Number.isFinite(batch.orderedTotalUnits)
        ? batch.orderedTotalUnits
        : Number.isFinite(batch.totalUnits)
          ? batch.totalUnits
          : 0,
      totalUnits: Number.isFinite(batch.totalUnits) ? batch.totalUnits : 0,
      totalFactoryCost: 0,
      estimatedFreightCost: 0,
      totalFreightCost: 0,
      freightPerUnit: 0,
      totalLandedCost: 0,
      createdAt: batch.entryDate ?? '',
      items: toArray<PublicCatalogBatchItem>(batch.items).map((item) => ({
        ...(item.skuId ? { skuId: item.skuId } : {}),
        team: item.team,
        model: item.model,
        version: item.version,
        size: item.size,
        orderedQuantity: Number.isFinite(item.orderedQuantity)
          ? item.orderedQuantity
          : Number.isFinite(item.quantity)
            ? item.quantity
            : 0,
        quantity: Number.isFinite(item.quantity) ? item.quantity : 0,
        ...(typeof item.salePrice === 'number' && Number.isFinite(item.salePrice)
          ? { salePrice: item.salePrice }
          : {}),
        ...(item.imageUrl?.trim() ? { imageUrl: item.imageUrl.trim() } : {}),
        factoryUnitCost: 0,
        proratedFreightPerUnit: 0,
        landedUnitCost: 0,
        lineFactoryTotal: 0,
        lineLandedTotal: 0,
      })),
    }));

  return {
    cashOnHand: 0,
    collectedReceivablesCount: 0,
    exchangeRates,
    inventory,
    receivables: [],
    sales: [],
    returns: [],
    purchases: [],
    purchaseBatches,
    operatingExpenses: [],
    capitalInjections: [],
    inventoryAdjustments: [],
    activeAuditSession: null,
    auditHistory: [],
    customers: [],
    catalogEnabled:
      typeof parsed.catalogEnabled === 'boolean' ? parsed.catalogEnabled : true,
    catalogPhotos: normalizePublicCatalogStringMap(parsed.catalogPhotos),
    catalogKeywords: normalizePublicCatalogStringMap(parsed.catalogKeywords),
    historicalNetProfit: 0,
    funds: {
      replacement: 0,
      commissions: 0,
      commissionsBySeller: { Jesús: 0, Josué: 0, Gabriel: 0 },
      operatingAndAds: 0,
      growthReinvestment: 0,
      dividendsByPartner: { Jesús: 0, Josué: 0, Gabriel: 0 },
      reinvestedFromDividendsTotal: 0,
    },
    movements: [],
  };
}

export function readLocalPublicCatalogBackup(): AppState | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_PUBLIC_CATALOG_BACKUP_KEY);
    if (!raw) return null;
    return normalizePublicCatalogToAppState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveLocalPublicCatalogBackup(snapshot: PublicCatalogSnapshot): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      LOCAL_PUBLIC_CATALOG_BACKUP_KEY,
      JSON.stringify(sanitizeForFirebase(snapshot)),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export async function writePublicCatalogSnapshot(state: AppState): Promise<void> {
  const snapshot = buildPublicCatalogSnapshot(state);
  saveLocalPublicCatalogBackup(snapshot);
  await ensureSilentFirebaseAuth();
  const db = getFirebaseDatabase();
  await db.ref(RTDB_PUBLIC_CATALOG_PATH).set(snapshot);
}

/**
 * Suscripción ligera de SOLO LECTURA al nodo público `x4sport/publicCatalog`.
 * Nunca descarga `x4sport/erpState` (ventas, clientes, CxC, fondos ni usuarios)
 * ni realiza escrituras en Firebase. Si RTDB exige sesión, inicia sesión anónima
 * automática (signInAnonymously) exclusivamente para lectura pública.
 */
export function subscribePublicCatalog(
  onState: (state: AppState) => void,
  onError: (message: string) => void,
): () => void {
  let active = true;
  let receivedRealtimeSnapshot = false;
  let deliveredInitial = false;
  let detachRealtimeListener: (() => void) | null = null;

  const deliverPublicState = (raw: unknown, fromRealtime: boolean) => {
    if (!active) return;
    if (fromRealtime) {
      receivedRealtimeSnapshot = true;
    } else if (receivedRealtimeSnapshot) {
      return;
    }
    deliveredInitial = true;

    const appState = normalizePublicCatalogToAppState(raw);
    saveLocalPublicCatalogBackup(buildPublicCatalogSnapshot(appState));
    onState(appState);
  };

  const deliverFallbackBackup = () => {
    if (!active || deliveredInitial) return;
    deliveredInitial = true;
    const backup = readLocalPublicCatalogBackup();
    onState(backup ?? normalizePublicCatalogToAppState(null));
  };

  const safetyTimer = setTimeout(() => {
    if (!active || deliveredInitial) return;
    deliverFallbackBackup();
    onError(
      'Conexión lenta con Firebase Realtime Database; mostrando catálogo guardado mientras sincroniza.',
    );
  }, 6000);

  void ensureSilentFirebaseAuth()
    .then(async () => {
      if (!active) return;

      let restAuthQuery = '';
      try {
        const token = await window.firebase?.auth?.()?.currentUser?.getIdToken?.();
        if (token) {
          restAuthQuery = `?auth=${encodeURIComponent(token)}`;
        }
      } catch {
        // Continuar sin token REST si las reglas de publicCatalog permiten lectura anónima abierta
      }

      const restUrl = `${firebaseConfig.databaseURL}/${RTDB_PUBLIC_CATALOG_PATH}.json${restAuthQuery}`;
      void fetch(restUrl, { cache: 'no-store' })
        .then(async (resp) => {
          if (!active || receivedRealtimeSnapshot) return;
          if (resp.status === 401 || resp.status === 403) {
            clearTimeout(safetyTimer);
            deliverFallbackBackup();
            onError(
              lastSilentAuthError
                ? `No se pudo autenticar lectura pública (${lastSilentAuthError}).`
                : `Lectura pública bloqueada en Firebase RTDB (HTTP ${resp.status}).`,
            );
            return;
          }
          if (!resp.ok) return;
          const data: unknown = await resp.json();
          if (!active || receivedRealtimeSnapshot) return;
          if (data !== null && data !== undefined) {
            deliverPublicState(data, false);
          }
        })
        .catch(() => {
          // Fallback handled by onValue listener or timeout
        });

      try {
        const db = getFirebaseDatabase();
        const publicRef = db.ref(RTDB_PUBLIC_CATALOG_PATH);

        const listener = publicRef.on(
          'value',
          (snapshot) => {
            if (!active) return;
            clearTimeout(safetyTimer);
            try {
              if (!snapshot.exists() || snapshot.val() === null) {
                deliverPublicState(null, true);
                return;
              }
              deliverPublicState(snapshot.val(), true);
            } catch (err) {
              if (!active) return;
              deliverFallbackBackup();
              onError(formatFirebaseError(err));
            }
          },
          (error) => {
            if (!active) return;
            clearTimeout(safetyTimer);
            deliverFallbackBackup();
            onError(formatFirebaseError(error));
          },
        );

        detachRealtimeListener = () => {
          publicRef.off('value', listener);
        };
      } catch (err) {
        clearTimeout(safetyTimer);
        deliverFallbackBackup();
        onError(formatFirebaseError(err));
      }
    })
    .catch((err: unknown) => {
      if (!active) return;
      clearTimeout(safetyTimer);
      deliverFallbackBackup();
      onError(formatFirebaseError(err));
    });

  return () => {
    active = false;
    clearTimeout(safetyTimer);
    if (detachRealtimeListener) {
      detachRealtimeListener();
    }
  };
}



