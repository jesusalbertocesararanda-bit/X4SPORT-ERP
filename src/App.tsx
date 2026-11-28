import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, WifiOff, X } from 'lucide-react';
import { AppHeader, type ConnectionStatus } from './components/AppHeader';
import { AdjustmentsView } from './components/AdjustmentsView';
import { AuditView } from './components/AuditView';
import { BulkImportView } from './components/BulkImportView';
import { CatalogAdminView } from './components/CatalogAdminView';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { ConfigView } from './components/ConfigView';
import { DashboardView } from './components/DashboardView';
import {
  ExcelImportModal,
  type BulkImportMetaPayload,
} from './components/ExcelImportModal';
import { FinanceView } from './components/FinanceView';
import { InventoryMovementsView } from './components/InventoryMovementsView';
import {
  InventoryView,
  type BulkUpdateInventoryModelInput,
  type BulkUpdateInventoryModelResult,
} from './components/InventoryView';
import { LoginModal } from './components/LoginModal';
import { PublicCatalogView } from './components/PublicCatalogView';
import {
  PurchasesView,
  type RegisterImportBatchWithPhotosInput,
} from './components/PurchasesView';
import { ReceivablesView } from './components/ReceivablesView';
import { ReportsView } from './components/ReportsView';
import { RestockAdvisorView } from './components/RestockAdvisorView';
import { ReturnsView } from './components/ReturnsView';
import { SalesView } from './components/SalesView';
import { Sidebar } from './components/Sidebar';
import { StatsView } from './components/StatsView';
import { SupplierPriceHistoryView } from './components/SupplierPriceHistoryView';
import { ThemeSelector } from './components/ThemeSelector';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useThemePreference } from './hooks/useThemePreference';
import { createInitialState } from './data/initialState';
import {
  canAccessConfiguration,
  ERPUser,
  getStoredActiveUser,
  getStoredLastActivityMs,
  isAdminUser,
  isSessionExpired,
  MAIN_ADMIN_EMAIL,
  saveAuthorizedUsersToStorage,
  storeActiveUser,
  touchUserActivity,
} from './utils/auth';
import type {
  AppState,
  AuthorizedUserRecord,
  BulkImportRecord,
  GeneralConfig,
  PartnerName,
  PaymentMethod,
  PurchaseBatchRecord,
  SaleRecord,
  SubModuleId,
  TabId,
} from './types/erp';
import { fetchVenezuelaExchangeRates } from './utils/exchangeRatesApi';
import {
  adjustInventoryPhysicalCount,
  applyAuditAdjustments,
  attachPurchaseBatchCalendarMetadata,
  attachSaleCalendarMetadata,
  closeAuditSession,
  collectReceivable,
  convertCashSaleToReceivable,
  DEFAULT_GENERAL_CONFIG,
  getActiveOperationalAlerts,
  normalizeGeneralConfig,
  normalizeVersionDisplay,
  performInventoryUncross,
  processReturnOrExchange,
  receiveImportBatch,
  reconcileCashOnHand,
  recoverStartupErpState,
  registerCapitalInjection,
  registerImportBatch,
  registerManualInventoryAdjustment,
  registerMultiItemSale,
  registerOperatingExpense,
  reinvestPartnerDividends,
  round2,
  saveAuditProgress,
  startNewAuditSession,
  syncUnassignedCashToGrowthFund,
  updateExchangeRates,
  upsertCustomerProfile,
  voidSaleTransaction,
  withdrawPartnerDividends,
} from './utils/finance';
import {
  clearCachedCalendarAccessToken,
  initGoogleCalendarAuth,
  signInWithGoogleCalendar,
  signOutGoogleCalendar,
  type GoogleCalendarAuthState,
} from './utils/googleCalendar';
import type {
  ActionResult,
  AdjustInventoryCountInput,
  ApplyAuditAdjustmentsInput,
  ConvertSaleToReceivableInput,
  OperationalAlert,
  ProcessReturnExchangeInput,
  ReceiveImportBatchInput,
  ReconcileCashInput,
  RegisterCapitalInjectionInput,
  RegisterImportBatchInput,
  RegisterMultiSaleInput,
  RegisterOperatingExpenseInput,
  UpsertCustomerInput,
  VoidSaleInput,
} from './utils/finance';
import {
  markAllAlertsSeenIds,
  toggleAlertSeenId,
} from './utils/notifications';
import {
  buildPublicCatalogSnapshot,
  formatFirebaseError,
  normalizePublicCatalogToAppState,
  purgeAllDataInFirebase,
  readLocalGeneralConfigBackup,
  readLocalPublicCatalogBackup,
  readLocalStorageRecoveryCandidates,
  resetBaselineStateInFirebase,
  resetErpStateInFirebase,
  saveLocalGeneralConfigBackup,
  saveLocalStateBackup,
  subscribeErpState,
  subscribeGeneralConfig,
  subscribePublicCatalog,
  transactErpState,
  updateErpState,
  writeErpState,
  writeExchangeRatesOnly,
  writeGeneralConfig,
  writePublicCatalogSnapshot,
} from './utils/firebaseRealtime';
import {
  getBreadcrumbParts,
  SUBMODULE_ROUTES,
  tabToDefaultSubModule,
} from './utils/navigation';
import {
  applyCatalogPhotoMutation,
  canonicalizeCatalogKey,
  getModelIdentityKey,
  isPublicCatalogModeFromLocation,
  normalizarUrlImagen,
  parseCatalogImageList,
  propagateModelPhotosAfterBatchMutation,
  sanitizeFirebaseCatalogKey,
} from './utils/publicCatalog';

export interface RateSyncInfo {
  status: 'idle' | 'loading' | 'synced' | 'error';
  message?: string;
}

export default function App() {
  const [isPublicCatalogRoute, setIsPublicCatalogRoute] = useState<boolean>(() =>
    isPublicCatalogModeFromLocation(),
  );
  const [state, setState] = useState<AppState>(() => {
    if (isPublicCatalogModeFromLocation()) {
      return (
        readLocalPublicCatalogBackup() ?? normalizePublicCatalogToAppState(null)
      );
    }
    const { state: initialRecovered } = recoverStartupErpState(
      createInitialState(),
      readLocalStorageRecoveryCandidates(),
    );
    return initialRecovered;
  });
  const latestStateRef = useRef<AppState>(state);
  latestStateRef.current = state;
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>(() =>
    isPublicCatalogModeFromLocation()
      ? DEFAULT_GENERAL_CONFIG
      : readLocalGeneralConfigBackup(),
  );
  const [isHydratingDb, setIsHydratingDb] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [activeSubModule, setActiveSubModule] = useState<SubModuleId>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    try {
      const viewParam = new URLSearchParams(window.location.search).get('view');
      if (viewParam && viewParam in SUBMODULE_ROUTES) {
        return viewParam as SubModuleId;
      }
    } catch {
      // Ignore malformed URL query
    }
    return 'dashboard';
  });
  const activeTab: TabId = SUBMODULE_ROUTES[activeSubModule].tab;
  const breadcrumb = getBreadcrumbParts(activeSubModule);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [rateSync, setRateSync] = useState<RateSyncInfo>({ status: 'idle' });
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isCatalogPreview, setIsCatalogPreview] = useState(false);
  const [calendarAuth, setCalendarAuth] = useState<GoogleCalendarAuthState>({
    isConnected: false,
    needsAuth: true,
    isConnecting: false,
  });
  const [currentUser, setCurrentUser] = useState<ERPUser | null>(() => getStoredActiveUser());
  const [loginToast, setLoginToast] = useState<string | null>(null);
  const [restrictedToast, setRestrictedToast] = useState<string | null>(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [isPoorNetwork, setIsPoorNetwork] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return false;
    const conn = (
      navigator as unknown as {
        connection?: { effectiveType?: string; downlink?: number };
      }
    ).connection;
    if (!conn) return false;
    return (
      conn.effectiveType === '2g' ||
      conn.effectiveType === 'slow-2g' ||
      (typeof conn.downlink === 'number' &&
        conn.downlink > 0 &&
        conn.downlink < 0.5)
    );
  });
  const { themePreference, resolvedTheme, setThemePreference } =
    useThemePreference({ forceSystemTheme: isPublicCatalogRoute });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    type NetworkInfoLike = {
      effectiveType?: string;
      downlink?: number;
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };

    const navConn = (
      navigator as unknown as { connection?: NetworkInfoLike }
    ).connection;

    const evaluateNetworkState = () => {
      setIsBrowserOnline(
        typeof navigator !== 'undefined' ? navigator.onLine : true,
      );
      if (!navConn) {
        setIsPoorNetwork(false);
        return;
      }
      const poor =
        navConn.effectiveType === '2g' ||
        navConn.effectiveType === 'slow-2g' ||
        (typeof navConn.downlink === 'number' &&
          navConn.downlink > 0 &&
          navConn.downlink < 0.5);
      setIsPoorNetwork(poor);
    };

    const handleOnline = () => evaluateNetworkState();
    const handleOffline = () => setIsBrowserOnline(false);

    evaluateNetworkState();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    navConn?.addEventListener?.('change', evaluateNetworkState);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      navConn?.removeEventListener?.('change', evaluateNetworkState);
    };
  }, []);

  const isSynced = dbError === null && !isHydratingDb;
  const connectionStatus: ConnectionStatus = !isBrowserOnline
    ? 'offline'
    : !isSynced || isPoorNetwork
      ? 'poor'
      : 'online';

  useEffect(() => {
    document.title =
      isPublicCatalogRoute || isCatalogPreview
        ? 'Catálogo X4SPORT'
        : 'X4SPORT ERP';
  }, [isPublicCatalogRoute, isCatalogPreview]);

  useEffect(() => {
    if (!loginToast) return;
    const timer = setTimeout(() => {
      setLoginToast(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [loginToast]);

  useEffect(() => {
    if (!restrictedToast) return;
    const timer = setTimeout(() => {
      setRestrictedToast(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [restrictedToast]);

  useEffect(() => {
    if (!currentUser) return;

    let lastThrottledWriteMs = getStoredLastActivityMs() ?? Date.now();

    const expireSessionIfIdle = (nowMs = Date.now()): boolean => {
      const lastActivityMs = getStoredLastActivityMs();
      if (isSessionExpired(lastActivityMs, nowMs)) {
        storeActiveUser(null);
        setCurrentUser(null);
        setIsChangePasswordOpen(false);
        setActiveSubModule('dashboard');
        setSessionExpiredNotice(
          'Tu sesión se cerró automáticamente por superar 24 horas de inactividad. Inicia sesión nuevamente.',
        );
        return true;
      }
      return false;
    };

    if (expireSessionIfIdle(Date.now())) {
      return;
    }

    const handleUserInteraction = () => {
      const nowMs = Date.now();
      // Verificar expiración de 24h ANTES de actualizar el timestamp de actividad
      if (expireSessionIfIdle(nowMs)) return;
      if (nowMs - lastThrottledWriteMs < 60_000) return;
      lastThrottledWriteMs = nowMs;
      touchUserActivity(nowMs);
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        expireSessionIfIdle(Date.now());
      }
    };

    const intervalId = window.setInterval(() => {
      expireSessionIfIdle(Date.now());
    }, 60_000);

    window.addEventListener('pointerdown', handleUserInteraction, { passive: true });
    window.addEventListener('keydown', handleUserInteraction);
    window.addEventListener('touchstart', handleUserInteraction, { passive: true });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pointerdown', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('touchstart', handleUserInteraction);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [currentUser]);

  const handleLoginSuccess = useCallback((user: ERPUser) => {
    storeActiveUser(user);
    setCurrentUser(user);
    setSessionExpiredNotice(null);
    setLoginToast(`¡Bienvenido, ${user.name}!`);
  }, []);

  const handleLogout = useCallback(() => {
    storeActiveUser(null);
    setCurrentUser(null);
    setIsChangePasswordOpen(false);
    setSessionExpiredNotice(null);
    setActiveSubModule('dashboard');
  }, []);

  const handleUpdateAuthorizedUsers = useCallback((users: AuthorizedUserRecord[]) => {
    saveAuthorizedUsersToStorage(users);
    const next: AppState = {
      ...latestStateRef.current,
      authorizedUsers: users,
    };
    latestStateRef.current = next;
    setState(next);
    saveLocalStateBackup(next, { allowOverwriteEmpty: true });
    void updateErpState({ authorizedUsers: users })
      .then(() => setDbError(null))
      .catch((err: unknown) => {
        setDbError(formatFirebaseError(err));
      });
  }, []);

  const handleSelectSubModule = useCallback((subModule: SubModuleId) => {
    setActiveSubModule(subModule);
  }, []);

  const handleNavigateTab = useCallback((tab: TabId) => {
    setActiveSubModule(tabToDefaultSubModule(tab));
  }, []);

  const handleNavigateAlert = useCallback((alert: OperationalAlert) => {
    if (alert.targetSubModule) {
      setActiveSubModule(alert.targetSubModule);
      return;
    }
    if (alert.targetTab) {
      setActiveSubModule(tabToDefaultSubModule(alert.targetTab));
    }
  }, []);

  const checkAdminPermission = useCallback((actionName: string): boolean => {
    if (isAdminUser(currentUser)) return true;
    setRestrictedToast(`Acceso restringido (${actionName}): Solo Administrador Principal (${MAIN_ADMIN_EMAIL})`);
    return false;
  }, [currentUser]);

  const [localSeenAlertIds, setLocalSeenAlertIds] = useState<string[]>(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return [];
      const raw = window.localStorage.getItem('x4sport_seen_alerts_v1');
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  });

  // Inicializar listener de autenticación de Google Calendar (token solo en memoria)
  useEffect(() => {
    if (isPublicCatalogModeFromLocation()) return;
    const unsubscribe = initGoogleCalendarAuth(
      (user) => {
        setCalendarAuth({
          isConnected: true,
          needsAuth: false,
          isConnecting: false,
          userEmail: user.email ?? undefined,
          userName: user.displayName ?? undefined,
        });
      },
      () => {
        setCalendarAuth((prev) => ({
          isConnected: false,
          needsAuth: true,
          isConnecting: false,
          error: prev.error,
        }));
      },
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const syncPublicRoute = () => {
      setIsPublicCatalogRoute(isPublicCatalogModeFromLocation());
    };
    window.addEventListener('popstate', syncPublicRoute);
    window.addEventListener('hashchange', syncPublicRoute);
    return () => {
      window.removeEventListener('popstate', syncPublicRoute);
      window.removeEventListener('hashchange', syncPublicRoute);
    };
  }, []);

  usePushNotifications({
    state,
    enabled: !isPublicCatalogRoute && Boolean(currentUser),
    isHydratingDb,
  });

  useEffect(() => {
    const applyTargetView = (candidate: unknown) => {
      if (typeof candidate === 'string' && candidate in SUBMODULE_ROUTES) {
        setActiveSubModule(candidate as SubModuleId);
      }
    };
    const handleCustomNavigate = (e: Event) => {
      applyTargetView((e as CustomEvent<unknown>).detail);
    };
    const handleSwMessage = (e: MessageEvent) => {
      const payload = e.data as { type?: string; view?: string } | null;
      if (payload?.type === 'X4SPORT_NAVIGATE_VIEW') {
        applyTargetView(payload.view);
      }
    };
    window.addEventListener('x4sport:navigate-view', handleCustomNavigate);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }
    return () => {
      window.removeEventListener('x4sport:navigate-view', handleCustomNavigate);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, []);

  const handleConnectGoogleCalendar = useCallback(async (): Promise<boolean> => {
    setCalendarAuth((prev) => ({
      ...prev,
      isConnecting: true,
      error: undefined,
    }));
    try {
      const { user } = await signInWithGoogleCalendar();
      setCalendarAuth({
        isConnected: true,
        needsAuth: false,
        isConnecting: false,
        userEmail: user.email ?? undefined,
        userName: user.displayName ?? undefined,
      });
      return true;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'No se pudo completar el inicio de sesión con Google.';
      setCalendarAuth({
        isConnected: false,
        needsAuth: true,
        isConnecting: false,
        error: message,
      });
      return false;
    }
  }, []);

  const handleDisconnectGoogleCalendar = useCallback(async (): Promise<void> => {
    await signOutGoogleCalendar();
    setCalendarAuth({
      isConnected: false,
      needsAuth: true,
      isConnecting: false,
    });
  }, []);

  const handleCalendarAuthExpired = useCallback(() => {
    clearCachedCalendarAccessToken();
    setCalendarAuth({
      isConnected: false,
      needsAuth: true,
      isConnecting: false,
    });
  }, []);

  // Suscripción en tiempo real (onValue) a Firebase RTDB:
  // En ruta pública (?catalogo=1) solo descarga `x4sport/publicCatalog` sin datos financieros ni privados.
  useEffect(() => {
    setIsHydratingDb(true);
    if (isPublicCatalogRoute) {
      const unsubscribePublic = subscribePublicCatalog(
        (publicState) => {
          latestStateRef.current = publicState;
          setState(publicState);
          setIsHydratingDb(false);
          setDbError(null);
        },
        (errorMessage) => {
          setIsHydratingDb(false);
          setDbError(errorMessage);
        },
      );

      return () => {
        unsubscribePublic();
      };
    }

    const unsubscribeState = subscribeErpState(
      (remoteState) => {
        setState(remoteState);
        setIsHydratingDb(false);
        setDbError(null);
      },
      (errorMessage) => {
        setIsHydratingDb(false);
        setDbError(errorMessage);
      },
    );

    const unsubscribeConfig = subscribeGeneralConfig((remoteConfig) => {
      setGeneralConfig(remoteConfig);
    });

    return () => {
      unsubscribeState();
      unsubscribeConfig();
    };
  }, [isPublicCatalogRoute]);

  const lastSyncedPublicCatalogJsonRef = useRef<string | null>(null);

  // Sincronización automática del nodo público ligero `x4sport/publicCatalog`
  // cada vez que cambia inventario, tasas, fotos, palabras clave o lotes en tránsito
  useEffect(() => {
    if (isPublicCatalogRoute || isHydratingDb || !currentUser) return;
    const publicSnapshot = buildPublicCatalogSnapshot(state);
    const serialized = JSON.stringify(publicSnapshot);
    if (serialized === lastSyncedPublicCatalogJsonRef.current) return;
    lastSyncedPublicCatalogJsonRef.current = serialized;
    void writePublicCatalogSnapshot(state).catch(() => {
      lastSyncedPublicCatalogJsonRef.current = null;
    });
  }, [
    isPublicCatalogRoute,
    isHydratingDb,
    currentUser,
    state.catalogEnabled,
    state.exchangeRates,
    state.catalogPhotos,
    state.catalogKeywords,
    state.inventory,
    state.purchaseBatches,
  ]);

  const handleSaveGeneralConfig = useCallback(
    async (nextConfig: GeneralConfig): Promise<void> => {
      if (!canAccessConfiguration(currentUser)) {
        throw new Error(
          `Acceso restringido: Solo Administrador Principal (${MAIN_ADMIN_EMAIL})`,
        );
      }
      const normalized = normalizeGeneralConfig(nextConfig);
      setGeneralConfig(normalized);
      saveLocalGeneralConfigBackup(normalized);
      try {
        await writeGeneralConfig(normalized);
        setDbError(null);
      } catch (err: unknown) {
        const message = formatFirebaseError(err);
        setDbError(message);
        throw new Error(message);
      }
    },
    [currentUser],
  );

  const hasBootRateSyncRef = useRef(false);
  const latestRateSourceRef = useRef(state.exchangeRates.source);
  latestRateSourceRef.current = state.exchangeRates.source;

  const syncRatesFromApi = useCallback(async () => {
    setRateSync({ status: 'loading', message: 'Consultando tasas BCV / USDT...' });
    const result = await fetchVenezuelaExchangeRates();
    if (result.ok && result.bcv && result.usdt) {
      const cleanBcv = round2(result.bcv);
      const cleanUsdt = round2(result.usdt);
      const nextRates: AppState['exchangeRates'] = {
        bcv: cleanBcv,
        usdt: cleanUsdt,
        updatedAt: new Date().toISOString(),
        source: 'api',
      };

      setState((prev) => ({
        ...prev,
        exchangeRates: nextRates,
      }));

      void writeExchangeRatesOnly(nextRates)
        .then(() => setDbError(null))
        .catch((err: unknown) => {
          setDbError(formatFirebaseError(err));
        });

      setRateSync({
        status: 'synced',
        message: `Tasas sincronizadas vía ${result.providerLabel ?? 'API pública'}.`,
      });
      return { ok: true, bcv: cleanBcv, usdt: cleanUsdt };
    }

    setRateSync({
      status: 'error',
      message:
        result.error ??
        'No se pudo sincronizar automáticamente; usando tasas guardadas.',
    });
    return { ok: false, error: result.error };
  }, []);

  // Esperar a que Firebase entregue el estado inicial antes de sincronizar tasas en vivo
  // (No sobrescribir tasas reales importadas desde Excel ni ajustes manuales, ni ejecutar en catálogo público)
  useEffect(() => {
    if (isPublicCatalogRoute || isHydratingDb || hasBootRateSyncRef.current) return;
    hasBootRateSyncRef.current = true;

    const currentSource = latestRateSourceRef.current;
    if (currentSource === 'excel' || currentSource === 'manual') {
      setRateSync({
        status: 'idle',
        message:
          currentSource === 'excel'
            ? 'Usando Tasa USDT importada desde Excel.'
            : 'Usando ajuste manual guardado.',
      });
      return;
    }

    let active = true;
    setRateSync({ status: 'loading', message: 'Consultando tasas BCV / USDT...' });

    void fetchVenezuelaExchangeRates().then((result) => {
      if (!active) return;
      if (result.ok && result.bcv && result.usdt) {
        const cleanBcv = round2(result.bcv);
        const cleanUsdt = round2(result.usdt);
        const nextRates: AppState['exchangeRates'] = {
          bcv: cleanBcv,
          usdt: cleanUsdt,
          updatedAt: new Date().toISOString(),
          source: 'api',
        };

        setState((prev) => {
          if (
            prev.exchangeRates.bcv === cleanBcv &&
            prev.exchangeRates.usdt === cleanUsdt
          ) {
            return prev;
          }
          return {
            ...prev,
            exchangeRates: nextRates,
          };
        });

        void writeExchangeRatesOnly(nextRates).catch((err: unknown) => {
          if (!active) return;
          setDbError(formatFirebaseError(err));
        });

        setRateSync({
          status: 'synced',
          message: `Tasas sincronizadas vía ${result.providerLabel ?? 'API pública'}.`,
        });
      } else {
        setRateSync({
          status: 'error',
          message:
            result.error ??
            'Sin respuesta de API pública; puedes editar las tasas manualmente.',
        });
      }
    });

    return () => {
      active = false;
    };
  }, [isHydratingDb, isPublicCatalogRoute]);

  const activeAlerts = useMemo(
    () =>
      getActiveOperationalAlerts(
        state,
        undefined,
        generalConfig.alertThresholds,
      ),
    [state, generalConfig.alertThresholds],
  );

  const effectiveSeenAlertIds = useMemo(() => {
    const merged = new Set<string>([
      ...localSeenAlertIds,
      ...(state.seenAlertIds ?? []),
    ]);
    return Array.from(merged);
  }, [localSeenAlertIds, state.seenAlertIds]);

  const persistSeenAlerts = (nextIds: string[]) => {
    setLocalSeenAlertIds(nextIds);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(
          'x4sport_seen_alerts_v1',
          JSON.stringify(nextIds),
        );
      }
    } catch {
      // Ignore storage quota errors
    }
    const next: AppState = {
      ...latestStateRef.current,
      seenAlertIds: nextIds,
    };
    latestStateRef.current = next;
    setState(next);
    saveLocalStateBackup(next, { allowOverwriteEmpty: true });
    void updateErpState({ seenAlertIds: nextIds })
      .then(() => setDbError(null))
      .catch((err: unknown) => {
        setDbError(formatFirebaseError(err));
      });
  };

  const handleToggleAlertSeen = (alertId: string) => {
    const nextIds = toggleAlertSeenId(effectiveSeenAlertIds, alertId);
    persistSeenAlerts(nextIds);
  };

  const handleMarkAllAlertsSeen = () => {
    const nextIds = markAllAlertsSeenIds(effectiveSeenAlertIds, activeAlerts);
    persistSeenAlerts(nextIds);
  };

  const handleUpdateRates = async (
    bcv: number,
    usdt: number,
  ): Promise<{ ok: boolean; error?: string }> => {
    const res = updateExchangeRates(latestStateRef.current, bcv, usdt, 'manual');
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    try {
      await writeExchangeRatesOnly(res.state.exchangeRates);
      latestStateRef.current = res.state;
      setState(res.state);
      saveLocalStateBackup(res.state, { allowOverwriteEmpty: true });
      setDbError(null);
      setRateSync({
        status: 'idle',
        message: 'Ajuste manual guardado.',
      });
      return { ok: true };
    } catch (err: unknown) {
      const msg = formatFirebaseError(err);
      setDbError(msg);
      return { ok: false, error: msg };
    }
  };

  const inFlightErpOpsRef = useRef<Set<string>>(new Set());

  const runAtomicErpOperation = useCallback(
    async (
      opKey: string,
      mutator: (current: AppState) => ActionResult,
    ): Promise<{
      ok: boolean;
      error?: string;
      createdBatch?: PurchaseBatchRecord;
      createdSale?: SaleRecord;
    }> => {
      if (inFlightErpOpsRef.current.has(opKey)) {
        return {
          ok: false,
          error: 'Operación en curso; espera un momento para evitar duplicados.',
        };
      }
      inFlightErpOpsRef.current.add(opKey);
      try {
        const txOutcome = await transactErpState(mutator, latestStateRef.current);
        if (txOutcome.ok && txOutcome.state) {
          latestStateRef.current = txOutcome.state;
          setState(txOutcome.state);
          saveLocalStateBackup(txOutcome.state, { allowOverwriteEmpty: true });
          setDbError(null);
          return {
            ok: true,
            createdBatch: txOutcome.createdBatch,
            createdSale: txOutcome.createdSale,
          };
        }

        if (txOutcome.source === 'rejected') {
          return {
            ok: false,
            error: txOutcome.error ?? 'Operación rechazada por validación.',
          };
        }

        const unavailableError =
          txOutcome.error ??
          'No se pudo sincronizar la transacción con Firebase RTDB. Verifica tu conexión e inténtalo de nuevo.';
        setDbError(unavailableError);
        return {
          ok: false,
          error: unavailableError,
        };
      } finally {
        inFlightErpOpsRef.current.delete(opKey);
      }
    },
    [],
  );

  const handleRegisterMultiSale = (input: RegisterMultiSaleInput) => {
    const opKey =
      input.clientOperationId?.trim() ||
      `sale-${Date.now()}-${input.items.map((i) => `${i.skuId}:${i.quantity}`).join(',')}`;
    return runAtomicErpOperation(opKey, (current) =>
      registerMultiItemSale(
        current,
        { ...input, actorName: input.actorName ?? currentUser?.name },
        generalConfig.matrixParams,
      ),
    );
  };

  const handleSaveCustomerProfile = (input: UpsertCustomerInput) => {
    const opKey = `save-customer-${input.name.trim().toLowerCase()}`;
    return runAtomicErpOperation(opKey, (current) =>
      upsertCustomerProfile(current, input),
    );
  };

  const handleRegisterImportBatch = (
    input: RegisterImportBatchWithPhotosInput,
  ) => {
    const { modelPhotos, ...cleanBatchInput } = input;
    const opKey =
      cleanBatchInput.clientOperationId?.trim() ||
      `reg-${cleanBatchInput.referenceName.trim()}-${cleanBatchInput.entryDate}`;
    return runAtomicErpOperation(opKey, (current) => {
      const res = registerImportBatch(current, {
        ...cleanBatchInput,
        actorName: cleanBatchInput.actorName ?? currentUser?.name,
      });
      if (!res.ok) return res;
      const syncedState = propagateModelPhotosAfterBatchMutation(res.state, {
        targetBatch: res.createdBatch,
        priorState: current,
        modelPhotos,
      });
      return {
        ...res,
        state: syncedState,
      };
    });
  };

  const handleReceiveImportBatch = (input: ReceiveImportBatchInput) => {
    const opKey = `recv-${input.batchId}`;
    return runAtomicErpOperation(opKey, (current) => {
      const res = receiveImportBatch(current, input);
      if (!res.ok) return res;
      const syncedState = propagateModelPhotosAfterBatchMutation(res.state, {
        targetBatch: res.createdBatch,
        priorState: current,
      });
      return {
        ...res,
        state: syncedState,
      };
    });
  };

  const handleCollectReceivable = (
    receivableId: string,
    paymentMethod: PaymentMethod,
    amountPaid?: number,
    clientOperationId?: string,
  ) => {
    const opKey =
      clientOperationId?.trim() ||
      `cxc-${receivableId}-${amountPaid ?? 'full'}`;
    return runAtomicErpOperation(opKey, (current) =>
      collectReceivable(
        current,
        receivableId,
        paymentMethod,
        amountPaid,
        clientOperationId,
      ),
    );
  };

  const handleReinvestDividends = (partner: PartnerName) =>
    runAtomicErpOperation(`reinvest-${partner}`, (current) =>
      reinvestPartnerDividends(current, partner),
    );

  const handleWithdrawDividends = (partner: PartnerName, amount?: number) =>
    runAtomicErpOperation(`withdraw-${partner}`, (current) =>
      withdrawPartnerDividends(
        current,
        partner,
        generalConfig.matrixParams.vitalReserveMinUsd ?? 150,
        amount,
      ),
    );

  const handleSyncFreeCashToFunds = () =>
    runAtomicErpOperation('sync-free-cash', (current) =>
      syncUnassignedCashToGrowthFund(current),
    );

  const handleRegisterOperatingExpense = (
    input: RegisterOperatingExpenseInput,
  ) =>
    runAtomicErpOperation('register-operating-expense', (current) =>
      registerOperatingExpense(current, input),
    );

  const handleRegisterCapitalInjection = async (
    input: RegisterCapitalInjectionInput,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Inyección de Capital / Dinero en Caja')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    return runAtomicErpOperation('register-capital-injection', (current) =>
      registerCapitalInjection(current, input),
    );
  };

  const handleReconcileCash = async (
    input: ReconcileCashInput,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Arqueo y Conciliación de Caja')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    return runAtomicErpOperation('reconcile-cash', (current) =>
      reconcileCashOnHand(current, input),
    );
  };

  const handleConvertSaleToReceivable = async (
    input: ConvertSaleToReceivableInput,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Pasar Venta de Contado a CxC')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    return runAtomicErpOperation(`sale-to-cxc-${input.saleId}`, (current) =>
      convertCashSaleToReceivable(current, {
        ...input,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
      }),
    );
  };

  const handleVoidSale = async (
    input: VoidSaleInput,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Anular Venta')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    return runAtomicErpOperation(`void-sale-${input.saleId}`, (current) =>
      voidSaleTransaction(current, {
        ...input,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
      }),
    );
  };

  const handleAdjustInventoryCount = async (
    input: AdjustInventoryCountInput,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Ajustes Manuales de Inventario')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    return runAtomicErpOperation(`adjust-count-${input.skuId}`, (current) =>
      adjustInventoryPhysicalCount(current, {
        ...input,
        actorName: input.actorName ?? currentUser?.name,
      }),
    );
  };

  const handleRegisterManualInventoryAdjustment = async (input: {
    adjustmentType: 'entrada' | 'salida' | 'descruce';
    skuId: string;
    quantity: number;
    reason: string;
    user?: string;
    targetSkuId?: string;
    unitCost?: number;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Ajustes Manuales de Inventario')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    const opKey = `adj-${input.skuId}-${Date.now()}`;
    return runAtomicErpOperation(opKey, (current) => {
      const actorName = input.user?.trim() || currentUser?.name;
      if (input.adjustmentType === 'descruce') {
        if (!input.targetSkuId) {
          return {
            ok: false,
            error: 'Selecciona una franela destino para realizar el descruce.',
            state: current,
          };
        }
        return performInventoryUncross(current, {
          sourceSkuId: input.skuId,
          targetSkuId: input.targetSkuId,
          quantity: input.quantity,
          reason: input.reason,
          actorName,
        });
      }
      return registerManualInventoryAdjustment(current, {
        type: input.adjustmentType,
        skuId: input.skuId,
        quantity: input.quantity,
        reason: input.reason,
        actorName,
        unitCost: input.unitCost,
      });
    });
  };

  const handlePerformInventoryUncross = async (input: {
    sourceSkuId: string;
    targetSkuId: string;
    quantity: number;
    reason?: string;
    user?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Descruce de Inventario')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    const opKey = `uncross-${input.sourceSkuId}-${input.targetSkuId}-${Date.now()}`;
    return runAtomicErpOperation(opKey, (current) =>
      performInventoryUncross(current, {
        sourceSkuId: input.sourceSkuId,
        targetSkuId: input.targetSkuId,
        quantity: input.quantity,
        reason: input.reason ?? '',
        actorName: input.user?.trim() || currentUser?.name,
      }),
    );
  };

  const handleSaveAuditProgress = (
    counts: Record<string, number>,
    notes?: string,
    modelQuickCounts?: Record<string, number | null>,
  ) =>
    runAtomicErpOperation('audit-save-progress', (current) =>
      saveAuditProgress(current, counts, notes, modelQuickCounts),
    );

  const handleCloseAuditSession = async (
    counts: Record<string, number>,
    applyAdjustmentsToInventory: boolean,
    reason?: string,
    modelQuickCounts?: Record<string, number | null>,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (
      applyAdjustmentsToInventory &&
      !checkAdminPermission('Aplicar Ajustes de Auditoría al Inventario')
    ) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    const opKey = `audit-close-${Date.now()}`;
    return runAtomicErpOperation(opKey, (current) =>
      closeAuditSession(
        current,
        counts,
        applyAdjustmentsToInventory,
        reason,
        currentUser?.name,
        modelQuickCounts,
      ),
    );
  };

  const handleStartNewAuditSession = () =>
    runAtomicErpOperation('audit-start-new-session', (current) =>
      startNewAuditSession(current),
    );

  const handleApplyAuditAdjustments = async (
    input: ApplyAuditAdjustmentsInput,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Ajustes Manuales de Inventario')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    return runAtomicErpOperation('apply-audit-adjustments', (current) =>
      applyAuditAdjustments(current, {
        ...input,
        actorName: input.actorName ?? currentUser?.name,
      }),
    );
  };

  const handleProcessReturnOrExchange = (input: ProcessReturnExchangeInput) => {
    const opKey =
      input.clientOperationId?.trim() ||
      `ret-${input.saleId}-${input.type}-${input.returnedSkuId}`;
    return runAtomicErpOperation(opKey, (current) =>
      processReturnOrExchange(current, input, generalConfig.matrixParams),
    );
  };

  const handleAttachSaleCalendarMetadata = useCallback(
    (saleId: string, eventId: string, htmlLink?: string) => {
      const optimisticNext = attachSaleCalendarMetadata(
        latestStateRef.current,
        saleId,
        eventId,
        htmlLink,
      );
      latestStateRef.current = optimisticNext;
      setState(optimisticNext);
      saveLocalStateBackup(optimisticNext, { allowOverwriteEmpty: true });
      void transactErpState(
        (current) => ({
          ok: true,
          state: attachSaleCalendarMetadata(current, saleId, eventId, htmlLink),
        }),
        optimisticNext,
      ).then((outcome) => {
        if (outcome.ok && outcome.state) {
          latestStateRef.current = outcome.state;
          setState(outcome.state);
          saveLocalStateBackup(outcome.state, { allowOverwriteEmpty: true });
          setDbError(null);
        } else if (!outcome.ok && outcome.error) {
          setDbError(outcome.error);
        }
      });
    },
    [],
  );

  const handleAttachPurchaseCalendarMetadata = useCallback(
    (batchId: string, eventId: string, htmlLink?: string) => {
      const optimisticNext = attachPurchaseBatchCalendarMetadata(
        latestStateRef.current,
        batchId,
        eventId,
        htmlLink,
      );
      latestStateRef.current = optimisticNext;
      setState(optimisticNext);
      saveLocalStateBackup(optimisticNext, { allowOverwriteEmpty: true });
      void transactErpState(
        (current) => ({
          ok: true,
          state: attachPurchaseBatchCalendarMetadata(
            current,
            batchId,
            eventId,
            htmlLink,
          ),
        }),
        optimisticNext,
      ).then((outcome) => {
        if (outcome.ok && outcome.state) {
          latestStateRef.current = outcome.state;
          setState(outcome.state);
          saveLocalStateBackup(outcome.state, { allowOverwriteEmpty: true });
          setDbError(null);
        } else if (!outcome.ok && outcome.error) {
          setDbError(outcome.error);
        }
      });
    },
    [],
  );

  const handleBulkUpdateInventoryModel = async (
    input: BulkUpdateInventoryModelInput,
  ): Promise<BulkUpdateInventoryModelResult> => {
    const normSp = (v: string) => (v || '').replace(/\s+/g, ' ').trim();
    const cleanNewName = normSp(input.newModelName);
    if (!cleanNewName) {
      return { ok: false, error: 'Ingresa el nombre o descripción del modelo.' };
    }

    const cleanPlayer = normSp(input.newPlayer);
    const composedModel = cleanPlayer
      ? cleanNewName.toLowerCase().endsWith(cleanPlayer.toLowerCase())
        ? cleanNewName
        : `${cleanNewName} · ${cleanPlayer}`
      : cleanNewName;
    const cleanTeam = normSp(input.newTeam);
    const cleanVersion = normalizeVersionDisplay(input.newVersion);
    const cleanSalePrice =
      typeof input.newSalePrice === 'number' &&
      Number.isFinite(input.newSalePrice) &&
      input.newSalePrice > 0
        ? round2(input.newSalePrice)
        : undefined;

    const origVerNorm = normalizeVersionDisplay(input.originalVersion);
    const origIdentityKey = getModelIdentityKey({
      model: input.originalModel,
      version: origVerNorm,
      player: input.originalPlayer,
    });
    const newIdentityKey = getModelIdentityKey({
      model: composedModel,
      version: cleanVersion,
    });

    const rawPhoto = input.newPhotoUrl.trim();
    let normalizedPhoto = '';
    if (rawPhoto) {
      const parsedImages = parseCatalogImageList(rawPhoto);
      normalizedPhoto =
        parsedImages.length > 1
          ? parsedImages.join('\n')
          : parsedImages[0] ?? normalizarUrlImagen(rawPhoto);
    }

    let updatedCount = 0;
    let updatedTransitCount = 0;
    const opKey = `bulk-model-edit-${Date.now()}`;

    const res = await runAtomicErpOperation(opKey, (current) => {
      updatedCount = 0;
      updatedTransitCount = 0;

      const nextInventory = (current.inventory ?? []).map((item) => {
        const itemIdentityKey = getModelIdentityKey({
          model: item.model,
          version: item.version,
        });
        if (itemIdentityKey !== origIdentityKey) return item;
        updatedCount += 1;
        const { imageUrl: _prevImg, ...baseItem } = item;
        return {
          ...baseItem,
          team: cleanTeam || item.team,
          model: composedModel,
          version: cleanVersion,
          ...(cleanSalePrice !== undefined ? { salePrice: cleanSalePrice } : {}),
          ...(normalizedPhoto ? { imageUrl: normalizedPhoto } : {}),
        };
      });

      if (updatedCount === 0) {
        return {
          ok: false,
          error:
            'No se encontraron registros activos para este modelo en el inventario.',
          state: current,
        };
      }

      const remainingUseOldKey = nextInventory.some(
        (it) =>
          getModelIdentityKey({ model: it.model, version: it.version }) ===
          origIdentityKey,
      );

      const nextCatalogPhotos = { ...(current.catalogPhotos ?? {}) };
      if (origIdentityKey !== newIdentityKey && !remainingUseOldKey) {
        for (const existingKey of Object.keys(nextCatalogPhotos)) {
          if (canonicalizeCatalogKey(existingKey) === origIdentityKey) {
            delete nextCatalogPhotos[existingKey];
          }
        }
      }

      for (const existingKey of Object.keys(nextCatalogPhotos)) {
        if (canonicalizeCatalogKey(existingKey) === newIdentityKey) {
          delete nextCatalogPhotos[existingKey];
        }
      }
      if (normalizedPhoto) {
        nextCatalogPhotos[newIdentityKey] = normalizedPhoto;
      }

      const nextCatalogKeywords = { ...(current.catalogKeywords ?? {}) };
      if (origIdentityKey !== newIdentityKey && !remainingUseOldKey) {
        for (const existingKey of Object.keys(nextCatalogKeywords)) {
          if (canonicalizeCatalogKey(existingKey) === origIdentityKey) {
            const kw = nextCatalogKeywords[existingKey];
            delete nextCatalogKeywords[existingKey];
            if (kw && !nextCatalogKeywords[newIdentityKey]) {
              nextCatalogKeywords[newIdentityKey] = kw;
            }
          }
        }
      }

      let nextPurchaseBatches = current.purchaseBatches ?? [];
      if (input.updateTransitBatches) {
        nextPurchaseBatches = nextPurchaseBatches.map((batch) => {
          if (batch.status !== 'EN TRÁNSITO') return batch;
          let batchChanged = false;
          const nextItems = (batch.items ?? []).map((bi) => {
            const biIdentityKey = getModelIdentityKey({
              model: bi.model,
              version: bi.version,
            });
            if (biIdentityKey !== origIdentityKey) return bi;
            batchChanged = true;
            updatedTransitCount += 1;
            const { imageUrl: _prevBiImg, ...baseBi } = bi;
            return {
              ...baseBi,
              team: cleanTeam || bi.team,
              model: composedModel,
              version: cleanVersion,
              ...(normalizedPhoto ? { imageUrl: normalizedPhoto } : {}),
            };
          });
          return batchChanged ? { ...batch, items: nextItems } : batch;
        });
      }

      return {
        ok: true,
        state: {
          ...current,
          inventory: nextInventory,
          catalogPhotos: nextCatalogPhotos,
          catalogKeywords: nextCatalogKeywords,
          ...(input.updateTransitBatches
            ? { purchaseBatches: nextPurchaseBatches }
            : {}),
        },
      };
    });

    return {
      ok: res.ok,
      updatedCount,
      updatedTransitCount,
      error: res.error,
    };
  };

  const handleResetBaselineData = () => {
    if (!checkAdminPermission('Restablecimiento de Fábrica')) return;
    void resetBaselineStateInFirebase()
      .then((fresh) => {
        setState(fresh);
        setDbError(null);
      })
      .catch((err: unknown) => {
        setDbError(formatFirebaseError(err));
      });
  };

  const handleResetDemoData = () => {
    if (!checkAdminPermission('Restablecimiento de Catálogo Demo')) return;
    void resetErpStateInFirebase()
      .then((fresh) => {
        setState(fresh);
        setDbError(null);
      })
      .catch((err: unknown) => {
        setDbError(formatFirebaseError(err));
      });
  };

  const handleApplyImportedState = async (
    nextState: AppState,
    importMeta?: BulkImportMetaPayload,
  ) => {
    if (!checkAdminPermission('Cargas Masivas de Datos')) return;
    const nowIso = new Date().toISOString();
    const prevBulkImports = latestStateRef.current.bulkImports ?? [];
    const newImportEntry: BulkImportRecord[] = importMeta
      ? [
          {
            id: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ...importMeta,
            userName: currentUser?.name ?? 'Admin',
            createdAt: nowIso,
          },
        ]
      : [];
    const mergedBulkImports = [
      ...newImportEntry,
      ...(nextState.bulkImports ?? []),
      ...prevBulkImports,
    ];
    const seenBulkIds = new Set<string>();
    const deduplicatedBulkImports: BulkImportRecord[] = [];
    for (const record of mergedBulkImports) {
      if (!record?.id || seenBulkIds.has(record.id)) continue;
      seenBulkIds.add(record.id);
      deduplicatedBulkImports.push(record);
    }
    const cleanNext: AppState = {
      ...nextState,
      bulkImports: deduplicatedBulkImports,
      userPurgedEmpty: false,
      isExplicitDemo: false,
    };
    saveLocalStateBackup(cleanNext, { allowOverwriteEmpty: true });
    latestStateRef.current = cleanNext;
    setState(cleanNext);
    await writeErpState(cleanNext);
    setDbError(null);
  };

  const handleCommitBulkState = async (
    nextState: AppState,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Cargas Masivas de Datos')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    const cleanNext: AppState = {
      ...nextState,
      userPurgedEmpty: false,
      isExplicitDemo: false,
    };
    saveLocalStateBackup(cleanNext, { allowOverwriteEmpty: true });
    latestStateRef.current = cleanNext;
    setState(cleanNext);
    await writeErpState(cleanNext);
    setDbError(null);
    return { ok: true };
  };

  const handleBulkRegisterTransitBatches = async (payload: {
    batches: RegisterImportBatchInput[];
    importRecord: BulkImportRecord;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPermission('Cargas Masivas de Datos')) {
      return {
        ok: false,
        error: 'Acceso restringido: Solo Administrador Principal (Jesús César)',
      };
    }
    const opKey = `bulk-transit-${payload.importRecord.id}`;
    return runAtomicErpOperation(opKey, (current) => {
      let working = current;
      for (const batchInput of payload.batches) {
        const beforeBatch = working;
        const res = registerImportBatch(working, {
          ...batchInput,
          totalFreightCost: 0,
          isDirectReception: false,
          actorName: batchInput.actorName ?? currentUser?.name,
        });
        if (!res.ok) {
          return {
            ok: false,
            error: `Lote "${batchInput.referenceName}": ${res.error ?? 'Error al registrar pedido En Tránsito.'}`,
            state: current,
          };
        }
        working = propagateModelPhotosAfterBatchMutation(res.state, {
          targetBatch: res.createdBatch,
          priorState: beforeBatch,
        });
      }
      return {
        ok: true,
        state: {
          ...working,
          bulkImports: [payload.importRecord, ...(working.bulkImports ?? [])],
          userPurgedEmpty: false,
          isExplicitDemo: false,
        },
      };
    });
  };

  const handlePurgeGhostData = async () => {
    if (!checkAdminPermission('Borrado de Fábrica y Purgado')) return;
    const clean = await purgeAllDataInFirebase(
      state.exchangeRates.bcv,
      state.exchangeRates.usdt,
      state.exchangeRates.source,
    );
    latestStateRef.current = clean;
    setState(clean);
    setDbError(null);
  };

  const handleToggleCatalogEnabled = useCallback((enabled: boolean) => {
    const next: AppState = {
      ...latestStateRef.current,
      catalogEnabled: enabled,
    };
    latestStateRef.current = next;
    setState(next);
    saveLocalStateBackup(next, { allowOverwriteEmpty: true });
    void updateErpState({ catalogEnabled: enabled })
      .then(() => setDbError(null))
      .catch((err: unknown) => {
        setDbError(formatFirebaseError(err));
      });
  }, []);

  const handleSaveCatalogPhoto = useCallback(
    (modelKey: string, photoUrl: string) => {
      if (!modelKey || !photoUrl) return;
      const optimisticNext = applyCatalogPhotoMutation(latestStateRef.current, {
        modelKey,
        photoUrl,
      });
      latestStateRef.current = optimisticNext;
      setState(optimisticNext);
      saveLocalStateBackup(optimisticNext, { allowOverwriteEmpty: true });
      void transactErpState(
        (current) => ({
          ok: true,
          state: applyCatalogPhotoMutation(current, { modelKey, photoUrl }),
        }),
        optimisticNext,
      ).then((outcome) => {
        if (outcome.ok && outcome.state) {
          latestStateRef.current = outcome.state;
          setState(outcome.state);
          saveLocalStateBackup(outcome.state, { allowOverwriteEmpty: true });
          setDbError(null);
        } else if (!outcome.ok && outcome.error) {
          setDbError(outcome.error);
        }
      });
    },
    [],
  );

  const handleRemoveCatalogPhoto = useCallback((modelKey: string) => {
    if (!modelKey) return;
    const optimisticNext = applyCatalogPhotoMutation(latestStateRef.current, {
      modelKey,
      photoUrl: '',
    });
    latestStateRef.current = optimisticNext;
    setState(optimisticNext);
    saveLocalStateBackup(optimisticNext, { allowOverwriteEmpty: true });
    void transactErpState(
      (current) => ({
        ok: true,
        state: applyCatalogPhotoMutation(current, { modelKey, photoUrl: '' }),
      }),
      optimisticNext,
    ).then((outcome) => {
      if (outcome.ok && outcome.state) {
        latestStateRef.current = outcome.state;
        setState(outcome.state);
        saveLocalStateBackup(outcome.state, { allowOverwriteEmpty: true });
        setDbError(null);
      } else if (!outcome.ok && outcome.error) {
        setDbError(outcome.error);
      }
    });
  }, []);

  const handleSaveCatalogKeywords = useCallback(
    (modelKey: string, keywords: string) => {
      if (!modelKey) return;
      const safeModelKey = sanitizeFirebaseCatalogKey(modelKey);
      const updated = { ...(latestStateRef.current.catalogKeywords ?? {}) };
      delete updated[modelKey];
      delete updated[safeModelKey];
      for (const existingKey of Object.keys(updated)) {
        if (sanitizeFirebaseCatalogKey(existingKey) === safeModelKey) {
          delete updated[existingKey];
        }
      }
      const trimmed = keywords.trim();
      if (trimmed) {
        updated[safeModelKey] = trimmed;
      }
      const next: AppState = {
        ...latestStateRef.current,
        catalogKeywords: updated,
      };
      latestStateRef.current = next;
      setState(next);
      saveLocalStateBackup(next, { allowOverwriteEmpty: true });
      void updateErpState({ catalogKeywords: updated })
        .then(() => setDbError(null))
        .catch((err: unknown) => {
          setDbError(formatFirebaseError(err));
        });
    },
    [],
  );

  const handleExitPublicCatalogToLogin = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `${window.location.origin}/`);
    }
    setIsCatalogPreview(false);
    setIsPublicCatalogRoute(false);
  }, []);

  if (isPublicCatalogRoute || isCatalogPreview) {
    if (isPublicCatalogRoute && isHydratingDb) {
      return (
        <div className="erp-catalog-shell flex min-h-screen flex-col items-center justify-center gap-3 bg-[#060B16] p-6 text-center text-slate-100">
          <Loader2
            className="h-8 w-8 animate-spin text-blue-400"
            aria-hidden="true"
          />
          <p className="font-display text-base font-semibold text-white">
            Cargando Catálogo Oficial X4SPORT...
          </p>
        </div>
      );
    }

    return (
      <PublicCatalogView
        state={state}
        isPreviewMode={isCatalogPreview && !isPublicCatalogRoute}
        onExitPreview={() => setIsCatalogPreview(false)}
        onGoToPartnerLogin={
          isPublicCatalogRoute ? handleExitPublicCatalogToLogin : undefined
        }
      />
    );
  }

  if (!currentUser) {
    return (
      <div className="erp-auth-shell min-h-screen bg-slate-50 text-slate-900 dark:bg-[#060B16] dark:text-slate-100 flex flex-col items-center justify-center relative">
        <div className="fixed top-4 right-4 z-40">
          <ThemeSelector
            value={themePreference}
            onChange={setThemePreference}
            showLabels="xl"
            testIdPrefix="login-theme-selector"
          />
        </div>
        {loginToast && (
          <div
            role="status"
            aria-live="polite"
            className="fixed top-5 right-5 z-50 flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-[#071913]/95 backdrop-blur-md px-4 py-3 text-xs font-semibold text-emerald-200 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-top-2"
          >
            <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{loginToast}</span>
            <button
              type="button"
              onClick={() => setLoginToast(null)}
              className="ml-2 text-emerald-400/70 hover:text-emerald-200 p-0.5 rounded"
              aria-label="Cerrar notificación"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {connectionStatus === 'offline' && (
          <div
            role="status"
            aria-live="assertive"
            data-testid="offline-connection-banner"
            className={`fixed right-5 z-50 flex items-center gap-2.5 rounded-xl border border-red-500/45 bg-[#1f0a0a]/95 backdrop-blur-md px-4 py-3 text-xs text-red-100 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-top-2 ${
              loginToast ? 'top-20' : 'top-5'
            }`}
          >
            <WifiOff className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-bold text-red-100 leading-tight">Sin conexión</p>
              <p className="mt-0.5 text-[11px] font-medium text-red-200/85 leading-snug">
                No hay acceso a internet · Verifica tu red para sincronizar
              </p>
            </div>
          </div>
        )}
        {restrictedToast && (
          <div
            role="alert"
            className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-[#1f1504]/95 backdrop-blur-md px-4 py-3 text-xs font-semibold text-amber-200 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-top-2 max-w-md text-center"
          >
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{restrictedToast}</span>
            <button
              type="button"
              onClick={() => setRestrictedToast(null)}
              className="ml-2 text-amber-400/70 hover:text-amber-200 p-0.5 rounded shrink-0"
              aria-label="Cerrar alerta"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {sessionExpiredNotice && (
          <div
            role="alert"
            data-testid="session-expired-notice"
            className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 rounded-xl border border-amber-500/45 bg-[#1f1504]/95 backdrop-blur-md px-4 py-3 text-xs font-semibold text-amber-200 shadow-2xl max-w-md text-center"
          >
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{sessionExpiredNotice}</span>
            <button
              type="button"
              onClick={() => setSessionExpiredNotice(null)}
              className="ml-2 text-amber-400/70 hover:text-amber-200 p-0.5 rounded shrink-0"
              aria-label="Cerrar aviso de sesión"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <LoginModal
          onLoginSuccess={handleLoginSuccess}
          authorizedUsers={state.authorizedUsers}
          onUpdateAuthorizedUsers={handleUpdateAuthorizedUsers}
          otpEmailConfig={generalConfig.otpEmailConfig}
        />
      </div>
    );
  }

  return (
    <div className="erp-admin-shell min-h-screen bg-slate-50 text-slate-900 dark:bg-[#060B16] dark:text-slate-100 flex relative">
      {loginToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-5 right-5 z-50 flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-[#071913]/95 backdrop-blur-md px-4 py-3 text-xs font-semibold text-emerald-200 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-top-2"
        >
          <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{loginToast}</span>
          <button
            type="button"
            onClick={() => setLoginToast(null)}
            className="ml-2 text-emerald-400/70 hover:text-emerald-200 p-0.5 rounded"
            aria-label="Cerrar notificación"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {connectionStatus === 'offline' && (
        <div
          role="status"
          aria-live="assertive"
          data-testid="offline-connection-banner"
          className={`fixed right-5 z-50 flex items-center gap-2.5 rounded-xl border border-red-500/45 bg-[#1f0a0a]/95 backdrop-blur-md px-4 py-3 text-xs text-red-100 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-top-2 ${
            loginToast ? 'top-20' : 'top-5'
          }`}
        >
          <WifiOff className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-bold text-red-100 leading-tight">Sin conexión</p>
            <p className="mt-0.5 text-[11px] font-medium text-red-200/85 leading-snug">
              No hay acceso a internet · Verifica tu red para sincronizar
            </p>
          </div>
        </div>
      )}
      {restrictedToast && (
        <div
          role="alert"
          className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-[#1f1504]/95 backdrop-blur-md px-4 py-3 text-xs font-semibold text-amber-200 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-top-2 max-w-md text-center"
        >
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>{restrictedToast}</span>
          <button
            type="button"
            onClick={() => setRestrictedToast(null)}
            className="ml-2 text-amber-400/70 hover:text-amber-200 p-0.5 rounded shrink-0"
            aria-label="Cerrar alerta"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <Sidebar
        activeSubModule={activeSubModule}
        isCollapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        currentUser={currentUser}
        isSynced={isSynced}
        storeName={generalConfig.brandIdentity.storeName}
        themePreference={themePreference}
        onChangeThemePreference={setThemePreference}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onSelectSubModule={handleSelectSubModule}
        onLogout={handleLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          moduleLabel={breadcrumb.moduleLabel}
          subModuleLabel={breadcrumb.subModuleLabel}
          currentUser={currentUser}
          connectionStatus={connectionStatus}
          alerts={activeAlerts}
          alertThresholds={generalConfig.alertThresholds}
          seenAlertIds={effectiveSeenAlertIds}
          onToggleAlertSeen={handleToggleAlertSeen}
          onMarkAllAlertsSeen={handleMarkAllAlertsSeen}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          onNavigateAlert={handleNavigateAlert}
          onOpenChangePassword={() => setIsChangePasswordOpen(true)}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {dbError && (
            <div
              role="alert"
              className="mb-6 flex items-start gap-2.5 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-xs font-medium text-red-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              <span>{dbError}</span>
            </div>
          )}

          {isHydratingDb ? (
            <div
              className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-[#0D1526] p-8 text-center"
              role="status"
            >
              <Loader2 className="h-7 w-7 animate-spin text-blue-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-200">
                Cargando datos sincronizados de X4SPORT...
              </p>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <DashboardView
                  state={state}
                  rateSync={rateSync}
                  lowStockThreshold={generalConfig.alertThresholds.lowStockThreshold}
                  onSyncRatesFromApi={syncRatesFromApi}
                  onUpdateRates={handleUpdateRates}
                  onNavigate={handleNavigateTab}
                />
              )}

              {activeTab === 'ventas' && (
                <SalesView
                  state={state}
                  currentUser={currentUser}
                  activeSection={
                    activeSubModule === 'ventas-historial'
                      ? 'historial'
                      : 'registrar'
                  }
                  matrixParams={generalConfig.matrixParams}
                  brandIdentity={generalConfig.brandIdentity}
                  calendarAuth={calendarAuth}
                  onConnectGoogleCalendar={handleConnectGoogleCalendar}
                  onDisconnectGoogleCalendar={handleDisconnectGoogleCalendar}
                  onCalendarAuthExpired={handleCalendarAuthExpired}
                  onAttachSaleCalendarMetadata={handleAttachSaleCalendarMetadata}
                  onRegisterMultiSale={handleRegisterMultiSale}
                  onSaveCustomerProfile={handleSaveCustomerProfile}
                  onConvertSaleToReceivable={handleConvertSaleToReceivable}
                  onVoidSale={handleVoidSale}
                />
              )}

              {activeTab === 'devoluciones' && (
                <ReturnsView
                  state={state}
                  onProcessReturnOrExchange={handleProcessReturnOrExchange}
                />
              )}

              {activeTab === 'inventario' && activeSubModule === 'inventario-movimientos' && (
                <InventoryMovementsView state={state} />
              )}

              {activeTab === 'inventario' && activeSubModule === 'inventario-reposicion' && (
                <RestockAdvisorView state={state} />
              )}

              {activeTab === 'inventario' &&
                activeSubModule !== 'inventario-movimientos' &&
                activeSubModule !== 'inventario-reposicion' && (
                <InventoryView
                  state={state}
                  lowStockThreshold={generalConfig.alertThresholds.lowStockThreshold}
                  onBulkUpdateModel={handleBulkUpdateInventoryModel}
                />
              )}

              {activeTab === 'auditoria' && activeSubModule === 'inventario-ajustes' && (
                <AdjustmentsView
                  state={state}
                  currentUser={currentUser}
                  onRegisterAdjustment={handleRegisterManualInventoryAdjustment}
                  onPerformUncross={handlePerformInventoryUncross}
                />
              )}

              {activeTab === 'auditoria' && activeSubModule !== 'inventario-ajustes' && (
                <AuditView
                  state={state}
                  currentUser={currentUser}
                  onSaveProgress={handleSaveAuditProgress}
                  onCloseAuditSession={handleCloseAuditSession}
                  onStartNewAuditSession={handleStartNewAuditSession}
                  onPerformUncross={handlePerformInventoryUncross}
                />
              )}

              {activeTab === 'compras' && (
                <PurchasesView
                  state={state}
                  activeSection={
                    activeSubModule === 'compras-transito'
                      ? 'transit'
                      : 'create'
                  }
                  alertThresholds={generalConfig.alertThresholds}
                  calendarAuth={calendarAuth}
                  onConnectGoogleCalendar={handleConnectGoogleCalendar}
                  onDisconnectGoogleCalendar={handleDisconnectGoogleCalendar}
                  onCalendarAuthExpired={handleCalendarAuthExpired}
                  onAttachPurchaseCalendarMetadata={
                    handleAttachPurchaseCalendarMetadata
                  }
                  onRegisterImportBatch={handleRegisterImportBatch}
                  onReceiveImportBatch={handleReceiveImportBatch}
                />
              )}

              {activeTab === 'finanzas' && activeSubModule === 'ventas-cxc' && (
                <ReceivablesView
                  state={state}
                  currentUser={currentUser}
                  brandIdentity={generalConfig.brandIdentity}
                  receivableOverdueDays={generalConfig.alertThresholds.receivableOverdueDays}
                  onCollectReceivable={handleCollectReceivable}
                />
              )}

              {activeTab === 'finanzas' && activeSubModule !== 'ventas-cxc' && (
                <FinanceView
                  state={state}
                  currentUser={currentUser}
                  brandIdentity={generalConfig.brandIdentity}
                  activeSection={
                    activeSubModule === 'finanzas-gastos'
                      ? 'gastos'
                      : activeSubModule === 'finanzas-socios'
                        ? 'socios'
                        : activeSubModule === 'finanzas-capital'
                          ? 'capital'
                          : activeSubModule === 'finanzas-caja'
                            ? 'caja'
                            : 'matriz'
                  }
                  matrixParams={generalConfig.matrixParams}
                  onOpenReceivables={() => handleSelectSubModule('ventas-cxc')}
                  onCollectReceivable={handleCollectReceivable}
                  onReinvestDividends={handleReinvestDividends}
                  onWithdrawDividends={handleWithdrawDividends}
                  onSyncFreeCashToFunds={handleSyncFreeCashToFunds}
                  onRegisterOperatingExpense={handleRegisterOperatingExpense}
                  onRegisterCapitalInjection={handleRegisterCapitalInjection}
                  onReconcileCash={handleReconcileCash}
                  onResetDemoData={handleResetBaselineData}
                />
              )}

              {activeTab === 'estadisticas' && (
                <StatsView state={state} resolvedTheme={resolvedTheme} />
              )}
              {activeTab === 'reportes' && <ReportsView state={state} />}
              {activeTab === 'cargas' && (
                <BulkImportView
                  state={state}
                  matrixParams={generalConfig.matrixParams}
                  currentUserName={currentUser?.name ?? 'Admin'}
                  onApplyImportedState={handleApplyImportedState}
                  onCommitBulkState={handleCommitBulkState}
                  onRegisterTransitImportBatches={handleBulkRegisterTransitBatches}
                  onPurgeGhostData={handlePurgeGhostData}
                />
              )}
              {activeTab === 'historial-precios' && (
                <SupplierPriceHistoryView state={state} />
              )}
              {activeTab === 'catalogo' && (
                <CatalogAdminView
                  state={state}
                  onToggleCatalogEnabled={handleToggleCatalogEnabled}
                  onSaveCatalogPhoto={handleSaveCatalogPhoto}
                  onRemoveCatalogPhoto={handleRemoveCatalogPhoto}
                  onSaveCatalogKeywords={handleSaveCatalogKeywords}
                  onOpenCatalogPreview={() => setIsCatalogPreview(true)}
                />
              )}
              {activeTab === 'configuracion' && (
                <ConfigView
                  currentUser={currentUser}
                  state={state}
                  generalConfig={generalConfig}
                  rateSync={rateSync}
                  calendarAuth={calendarAuth}
                  activeSection={
                    activeSubModule === 'config-marca-catalogo'
                      ? 'marca-catalogo'
                      : activeSubModule === 'config-usuarios-seguridad'
                        ? 'usuarios-seguridad'
                        : activeSubModule === 'config-tasas'
                          ? 'tasas'
                          : activeSubModule === 'config-respaldo'
                            ? 'respaldo'
                            : 'matriz-alertas'
                  }
                  onOpenChangePassword={() => setIsChangePasswordOpen(true)}
                  onSaveGeneralConfig={handleSaveGeneralConfig}
                  onConnectGoogleCalendar={handleConnectGoogleCalendar}
                  onDisconnectGoogleCalendar={handleDisconnectGoogleCalendar}
                  onToggleCatalogEnabled={handleToggleCatalogEnabled}
                  onOpenCatalogAdmin={() => setActiveSubModule('catalogo')}
                  onBackToDashboard={() => setActiveSubModule('dashboard')}
                  onOpenExcelImport={() => setIsExcelModalOpen(true)}
                  onSyncRatesFromApi={syncRatesFromApi}
                  onUpdateRates={handleUpdateRates}
                  onRestoreFullState={(restoredState) =>
                    handleApplyImportedState(restoredState)
                  }
                  onResetDemoData={handleResetDemoData}
                  onUpdateAuthorizedUsers={handleUpdateAuthorizedUsers}
                />
              )}
            </>
          )}
        </main>
      </div>

      <ExcelImportModal
        isOpen={isExcelModalOpen}
        currentRates={state.exchangeRates}
        onClose={() => setIsExcelModalOpen(false)}
        onApplyImportedState={handleApplyImportedState}
        onPurgeGhostData={handlePurgeGhostData}
      />

      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        currentUser={currentUser}
        stateUsers={state.authorizedUsers}
        onClose={() => setIsChangePasswordOpen(false)}
        onUpdateAuthorizedUsers={(users) => {
          handleUpdateAuthorizedUsers(users);
          setLoginToast('Tu contraseña ha sido actualizada y sincronizada.');
        }}
      />
    </div>
  );
}
