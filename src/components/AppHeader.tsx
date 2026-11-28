import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Menu,
  Package,
  RotateCcw,
  Smartphone,
  X,
} from 'lucide-react';
import type { AlertThresholdsConfig, SubModuleId } from '../types/erp';
import type { ERPUser } from '../utils/auth';
import type { OperationalAlert } from '../utils/finance';
import { getUnseenAlertCount } from '../utils/notifications';
import { useNetworkQuality } from '../hooks/useNetworkQuality';
import {
  getSystemNotificationPermission,
  requestSystemNotificationPermission,
  sendTestSystemNotification,
  type SystemNotificationPermission,
} from '../hooks/usePushNotifications';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type WindowWithInstallPrompt = Window & {
  __deferredInstallPrompt?: BeforeInstallPromptEvent | null;
};

export type ConnectionStatus = 'online' | 'poor' | 'offline';

interface AppHeaderProps {
  moduleLabel: string;
  subModuleLabel?: string;
  currentUser?: ERPUser | null;
  connectionStatus?: ConnectionStatus;
  alerts: OperationalAlert[];
  alertThresholds: AlertThresholdsConfig;
  seenAlertIds: string[];
  onToggleAlertSeen: (alertId: string) => void;
  onMarkAllAlertsSeen: () => void;
  onOpenMobileSidebar: () => void;
  onStartSale?: () => void;
  onNavigateAlert: (alert: OperationalAlert) => void;
  onOpenChangePassword?: () => void;
}

export function AppHeader({
  moduleLabel,
  subModuleLabel,
  currentUser,
  connectionStatus = 'online',
  alerts,
  alertThresholds,
  seenAlertIds,
  onToggleAlertSeen,
  onMarkAllAlertsSeen,
  onOpenMobileSidebar,
  onNavigateAlert,
}: AppHeaderProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [networkTooltipOpen, setNetworkTooltipOpen] = useState(false);
  const [networkHoverOpen, setNetworkHoverOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [notifPermission, setNotifPermission] =
    useState<SystemNotificationPermission>(() =>
      getSystemNotificationPermission(),
    );
  const [notifActionBusy, setNotifActionBusy] = useState(false);
  const [notifTestSent, setNotifTestSent] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(() => {
      if (typeof window === 'undefined') return null;
      return (window as WindowWithInstallPrompt).__deferredInstallPrompt ?? null;
    });
  const [isPwaInstalled, setIsPwaInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true
    );
  });
  const lastScrollYRef = useRef(0);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const networkQuality = useNetworkQuality(connectionStatus);
  const showNetworkTooltip = networkTooltipOpen || networkHoverOpen;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncFromWindowPrompt = () => {
      const earlyPrompt = (window as WindowWithInstallPrompt)
        .__deferredInstallPrompt;
      if (earlyPrompt) {
        setDeferredInstallPrompt(earlyPrompt);
      }
    };

    syncFromWindowPrompt();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      (window as WindowWithInstallPrompt).__deferredInstallPrompt = promptEvent;
      setDeferredInstallPrompt(promptEvent);
    };

    const handleAppInstalled = () => {
      setIsPwaInstalled(true);
      setDeferredInstallPrompt(null);
      (window as WindowWithInstallPrompt).__deferredInstallPrompt = null;
    };

    window.addEventListener('x4sport-install-ready', syncFromWindowPrompt);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('x4sport-install-ready', syncFromWindowPrompt);
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleHeaderInstallClick = async () => {
    const promptToUse =
      deferredInstallPrompt ??
      (typeof window !== 'undefined'
        ? (window as WindowWithInstallPrompt).__deferredInstallPrompt
        : null);
    if (!promptToUse) return;
    try {
      await promptToUse.prompt();
      const { outcome } = await promptToUse.userChoice;
      if (outcome === 'accepted') {
        setIsPwaInstalled(true);
      }
    } catch {
      // Ignore user cancellation
    } finally {
      setDeferredInstallPrompt(null);
      if (typeof window !== 'undefined') {
        (window as WindowWithInstallPrompt).__deferredInstallPrompt = null;
      }
    }
  };

  useEffect(() => {
    if (!notifOpen) return;
    setNotifPermission(getSystemNotificationPermission());
    setNotifTestSent(false);
  }, [notifOpen]);

  const handleEnableNotifications = async () => {
    if (notifActionBusy) return;
    setNotifActionBusy(true);
    try {
      const nextPerm = await requestSystemNotificationPermission();
      setNotifPermission(nextPerm);
      if (nextPerm === 'granted') {
        setNotifTestSent(true);
      }
    } finally {
      setNotifActionBusy(false);
    }
  };

  const handleTestNotification = async () => {
    if (notifActionBusy) return;
    setNotifActionBusy(true);
    try {
      const ok = await sendTestSystemNotification();
      if (ok) {
        setNotifTestSent(true);
      }
    } finally {
      setNotifActionBusy(false);
    }
  };

  // Auto-hide topbar on scroll down, show immediately on scroll up
  useEffect(() => {
    const handleScroll = () => {
      if (notifOpen || networkTooltipOpen) {
        setIsVisible(true);
        return;
      }
      const currentY = window.scrollY;
      const lastY = lastScrollYRef.current;

      if (currentY <= 40) {
        setIsVisible(true);
      } else if (currentY > lastY + 8) {
        setIsVisible(false);
      } else if (currentY < lastY - 8) {
        setIsVisible(true);
      }
      lastScrollYRef.current = currentY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [notifOpen, networkTooltipOpen]);

  // Reset visible when route changes
  useEffect(() => {
    setIsVisible(true);
  }, [moduleLabel, subModuleLabel]);

  useEffect(() => {
    if (!notifOpen && !networkTooltipOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setNetworkTooltipOpen(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setNotifOpen(false);
        setNetworkTooltipOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [notifOpen, networkTooltipOpen]);

  const seenSet = new Set(seenAlertIds);
  const unseenCount = getUnseenAlertCount(alerts, seenAlertIds);

  const cleanUserName = currentUser?.name
    ? currentUser.name.replace(/\s*\(X4SPORT\)\s*$/i, '').trim()
    : '';

  const getAlertDestinationLabel = (alert: OperationalAlert): string => {
    const sub: SubModuleId | undefined = alert.targetSubModule;
    if (sub === 'ventas-cxc' || alert.kind === 'overdue_receivable') {
      return 'Ir a Ventas > CxC';
    }
    if (sub === 'compras-transito' || alert.kind === 'transit_delay') {
      return 'Ir a Compras > Pedidos en Tránsito';
    }
    return 'Ir a Inventario > Stock Disponible';
  };

  return (
    <header
      data-testid="app-header"
      data-visible={isVisible ? 'true' : 'false'}
      className={`sticky top-0 z-30 border-b border-slate-200 bg-white/95 dark:border-slate-800/90 dark:bg-[#080F1E]/95 backdrop-blur-md transition-transform duration-300 ${
        isVisible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between gap-2 sm:gap-3 px-2.5 sm:px-6">
        {/* Izquierda: toggle móvil + breadcrumb dinámico */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            data-testid="btn-mobile-menu"
            onClick={onOpenMobileSidebar}
            aria-label="Abrir menú lateral"
            className="inline-flex lg:hidden min-h-[36px] min-w-[36px] sm:min-h-[38px] sm:min-w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-[#0D1526] dark:text-slate-200 dark:hover:bg-slate-800 shrink-0"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </button>

          <nav
            aria-label="Ruta actual"
            data-testid="header-module-title"
            className="flex min-w-0 items-center text-[13px] sm:text-base"
          >
            {/* Móvil (< 640px): muestra solo el sub-módulo activo sin truncar */}
            <span className="font-display sm:hidden whitespace-nowrap font-semibold tracking-tight text-slate-900 dark:text-white">
              {subModuleLabel || moduleLabel}
            </span>

            {/* Tablet / Escritorio (>= 640px): ruta completa */}
            <span className="hidden sm:inline-flex min-w-0 items-center gap-1.5">
              <span
                className={`font-display truncate tracking-tight ${
                  subModuleLabel
                    ? 'font-medium text-slate-500 dark:text-slate-400'
                    : 'font-semibold text-slate-900 dark:text-white'
                }`}
              >
                {moduleLabel}
              </span>
              {subModuleLabel && (
                <>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-600"
                    aria-hidden="true"
                  />
                  <span className="font-display truncate font-semibold tracking-tight text-slate-900 dark:text-white">
                    {subModuleLabel}
                  </span>
                </>
              )}
            </span>
          </nav>
        </div>

        {/* Derecha: Instalar App (cuando prompt listo) + Estado de conexión + Usuario y Notificaciones */}
        <div
          ref={popoverRef}
          className="relative flex items-center gap-1.5 sm:gap-2.5 shrink-0"
        >
          {!isPwaInstalled && deferredInstallPrompt && (
            <button
              type="button"
              data-testid="btn-header-install-pwa"
              title="Instalar App X4SPORT"
              aria-label="Instalar App X4SPORT"
              onClick={() => void handleHeaderInstallClick()}
              className="inline-flex min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] items-center justify-center rounded-lg border border-sky-400/50 bg-[#38bdf8]/15 px-2 text-[#38bdf8] transition-colors hover:bg-[#38bdf8] hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              data-testid="header-connection-status"
              data-status={connectionStatus}
              data-quality={networkQuality.level}
              title={
                cleanUserName
                  ? `${cleanUserName} · ${networkQuality.diagnostic}`
                  : networkQuality.diagnostic
              }
              aria-label={
                cleanUserName
                  ? `${cleanUserName}, ${networkQuality.diagnostic}`
                  : networkQuality.diagnostic
              }
              aria-expanded={showNetworkTooltip}
              onClick={() => {
                setNotifOpen(false);
                setNetworkTooltipOpen((prev) => !prev);
              }}
              onMouseEnter={() => setNetworkHoverOpen(true)}
              onMouseLeave={() => setNetworkHoverOpen(false)}
              onFocus={() => setNetworkHoverOpen(true)}
              onBlur={() => setNetworkHoverOpen(false)}
              className={`inline-flex min-h-[36px] sm:min-h-[40px] items-center gap-1.5 sm:gap-2 rounded-lg border px-2 sm:px-3 py-1 sm:py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${networkQuality.pillClassName}`}
            >
              <span
                data-testid="header-connection-dot"
                className={`h-2.5 w-2.5 rounded-full shrink-0 transition-all duration-300 ${networkQuality.dotClassName}`}
              />
              {cleanUserName ? (
                <span
                  data-testid="header-active-user-name"
                  className="font-semibold whitespace-nowrap"
                >
                  {cleanUserName}
                </span>
              ) : (
                <span
                  data-testid="header-connection-label"
                  className="text-[11px] font-semibold whitespace-nowrap"
                >
                  {networkQuality.label}
                </span>
              )}
            </button>

            {showNetworkTooltip && (
              <div
                role="status"
                aria-live="polite"
                data-testid="header-network-tooltip"
                className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 w-max max-w-[250px] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-left shadow-xl backdrop-blur-md dark:border-slate-700 dark:bg-[#0D1526]/95"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${networkQuality.dotClassName}`}
                  />
                  <span className="text-[11px] font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                    {networkQuality.diagnostic}
                  </span>
                </div>
                <p className="mt-0.5 pl-4 text-[10px] text-slate-500 dark:text-slate-400">
                  {networkQuality.detailLine}
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            data-testid="btn-header-notifications"
            aria-expanded={notifOpen}
            aria-haspopup="dialog"
            aria-label={
              unseenCount > 0
                ? `Notificaciones (${unseenCount} no leídas)`
                : 'Notificaciones (sin alertas pendientes)'
            }
            onClick={() => {
              setNetworkTooltipOpen(false);
              setNotifOpen((prev) => !prev);
            }}
            className={`relative inline-flex min-h-[36px] sm:min-h-[40px] items-center justify-center gap-1.5 sm:gap-2 rounded-lg border px-2 sm:px-3.5 py-1.5 sm:py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
              unseenCount > 0
                ? 'border-red-500/45 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-200'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#0D1526] dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Notificaciones</span>
            {unseenCount > 0 && (
              <span
                data-testid="notifications-badge"
                className="font-mono-num inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white"
              >
                {unseenCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div
              role="dialog"
              aria-label="Centro de alertas operativas"
              data-testid="notifications-popover"
              className="absolute right-0 top-12 z-50 w-[330px] sm:w-[420px] rounded-xl border border-slate-700 bg-[#0D1526] shadow-2xl overflow-hidden"
            >
              <div className="flex items-start justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Notificaciones en Tiempo Real
                    </h3>
                    {alerts.length > 0 && (
                      <span
                        data-testid="notifications-unseen-summary"
                        className={`font-mono-num rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          unseenCount > 0
                            ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                            : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {unseenCount > 0
                          ? `${unseenCount} sin leer`
                          : 'Todas leídas'}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Stock (≤{alertThresholds.lowStockThreshold}), CxC (&gt;
                    {alertThresholds.receivableOverdueDays}d) y Tránsito (M&gt;
                    {alertThresholds.maritimeTransitMaxDays}d / A&gt;
                    {alertThresholds.airTransitMaxDays}d)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  aria-label="Cerrar notificaciones"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white shrink-0"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {/* Interruptor: Notificaciones en este Teléfono */}
              <div
                data-testid="phone-notifications-card"
                className="flex items-center justify-between gap-2.5 border-b border-slate-800 bg-[#080E1C] px-4 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className={`rounded-lg border p-1.5 shrink-0 ${
                      notifPermission === 'granted'
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-400'
                        : notifPermission === 'denied' ||
                            notifPermission === 'unsupported'
                          ? 'border-red-500/35 bg-red-500/10 text-red-400'
                          : 'border-sky-500/35 bg-sky-500/10 text-sky-400'
                    }`}
                  >
                    <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-white">
                      Notificaciones en este Teléfono
                    </p>
                    <p
                      data-testid="phone-notifications-status"
                      className={`text-[10px] font-medium ${
                        notifPermission === 'granted'
                          ? 'text-emerald-400'
                          : notifPermission === 'denied' ||
                              notifPermission === 'unsupported'
                            ? 'text-red-300'
                            : 'text-slate-400'
                      }`}
                    >
                      {notifPermission === 'granted'
                        ? notifTestSent
                          ? 'Activadas en este dispositivo · Prueba enviada'
                          : 'Activadas en este dispositivo'
                        : notifPermission === 'denied' ||
                            notifPermission === 'unsupported'
                          ? 'Bloqueadas en navegador'
                          : 'Desactivadas'}
                    </p>
                  </div>
                </div>

                {notifPermission === 'granted' ? (
                  <button
                    type="button"
                    data-testid="btn-test-push-notifications"
                    disabled={notifActionBusy}
                    onClick={() => void handleTestNotification()}
                    className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-md border border-slate-700 bg-[#0D1526] px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition-colors hover:border-sky-500/50 hover:bg-sky-500/15 hover:text-white disabled:opacity-60"
                  >
                    <BellRing className="h-3 w-3 text-sky-400" aria-hidden="true" />
                    Probar
                  </button>
                ) : notifPermission === 'default' ? (
                  <button
                    type="button"
                    data-testid="btn-enable-push-notifications"
                    disabled={notifActionBusy}
                    onClick={() => void handleEnableNotifications()}
                    className="inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
                  >
                    <BellRing className="h-3 w-3" aria-hidden="true" />
                    Activar Notificaciones
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-500 text-right shrink-0">
                    Permitir en ajustes
                  </span>
                )}
              </div>

              {alerts.length > 0 && unseenCount > 0 && (
                <div className="flex items-center justify-end border-b border-slate-800/80 bg-[#080E1C] px-4 py-1.5">
                  <button
                    type="button"
                    data-testid="btn-mark-all-alerts-seen"
                    onClick={onMarkAllAlertsSeen}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-blue-300 transition-colors hover:bg-blue-500/15 hover:text-white"
                  >
                    <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Marcar todas como leídas
                  </button>
                </div>
              )}

              {alerts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  Sin alertas pendientes. Stock, Cuentas por Cobrar y envíos están dentro de los umbrales configurados.
                </div>
              ) : (
                <ul className="max-h-80 divide-y divide-slate-800/80 overflow-y-auto">
                  {alerts.map((alert) => {
                    const isSeen = seenSet.has(alert.id);
                    return (
                      <li
                        key={alert.id}
                        data-seen={isSeen ? 'true' : 'false'}
                        className={`flex items-start gap-2 px-3 py-2.5 transition-colors ${
                          isSeen
                            ? 'bg-[#070C17]/80 opacity-65'
                            : 'bg-blue-950/15 hover:bg-slate-800/40'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (!isSeen) {
                              onToggleAlertSeen(alert.id);
                            }
                            onNavigateAlert(alert);
                            setNotifOpen(false);
                          }}
                          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {alert.kind === 'transit_delay' ? (
                            <Clock
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                isSeen ? 'text-slate-500' : 'text-amber-400'
                              }`}
                              aria-hidden="true"
                            />
                          ) : alert.kind === 'overdue_receivable' ? (
                            <CreditCard
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                isSeen ? 'text-slate-500' : 'text-red-400'
                              }`}
                              aria-hidden="true"
                            />
                          ) : (
                            <AlertTriangle
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                isSeen ? 'text-slate-500' : 'text-red-400'
                              }`}
                              aria-hidden="true"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {!isSeen && (
                                <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                              )}
                              <p
                                className={`text-xs font-semibold truncate ${
                                  isSeen ? 'text-slate-400' : 'text-white'
                                }`}
                              >
                                {alert.title}
                              </p>
                            </div>
                            <p
                              className={`mt-0.5 text-[11px] ${
                                isSeen ? 'text-slate-500' : 'text-red-300'
                              }`}
                            >
                              {alert.description}
                            </p>
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-blue-300">
                              <Package className="h-3 w-3" aria-hidden="true" />
                              {getAlertDestinationLabel(alert)}
                            </span>
                          </div>
                        </button>

                        <button
                          type="button"
                          data-testid={`btn-toggle-alert-${alert.id}`}
                          aria-pressed={isSeen}
                          aria-label={
                            isSeen
                              ? `Marcar "${alert.title}" como no leída`
                              : `Marcar "${alert.title}" como leída`
                          }
                          onClick={() => onToggleAlertSeen(alert.id)}
                          className={`mt-1 inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                            isSeen
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-slate-800 hover:text-slate-200'
                              : 'border-slate-700 bg-[#080E1C] text-slate-300 hover:border-blue-500/50 hover:bg-blue-600/20 hover:text-white'
                          }`}
                        >
                          {isSeen ? (
                            <>
                              <RotateCcw className="h-3 w-3" aria-hidden="true" />
                              <span>Leída</span>
                            </>
                          ) : (
                            <>
                              <Check className="h-3 w-3" aria-hidden="true" />
                              <span>Leer</span>
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
