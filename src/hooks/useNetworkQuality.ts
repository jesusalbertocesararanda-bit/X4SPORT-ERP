import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type ExternalConnectionHint = 'online' | 'poor' | 'offline';

export type NetworkQualityLevel =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'unstable'
  | 'offline';

export type NetworkEffectiveType = '4g' | '3g' | '2g' | 'slow-2g';

interface BrowserNetworkInformation extends EventTarget {
  downlink?: number;
  rtt?: number;
  effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
  connection?: BrowserNetworkInformation;
  mozConnection?: BrowserNetworkInformation;
  webkitConnection?: BrowserNetworkInformation;
}

export interface NetworkQualitySnapshot {
  level: NetworkQualityLevel;
  latencyMs: number | null;
  jitterMs: number;
  downlinkMbps: number | null;
  effectiveType: NetworkEffectiveType | null;
  consecutiveFailures: number;
  isOnline: boolean;
  label: string;
  diagnostic: string;
  detailLine: string;
  dotClassName: string;
  pillClassName: string;
}

export interface ClassifyNetworkQualityInput {
  isOnline: boolean;
  externalStatus?: ExternalConnectionHint;
  latencyMs: number | null;
  jitterMs: number;
  downlinkMbps: number | null;
  effectiveType: NetworkEffectiveType | null;
  consecutiveFailures: number;
}

const PROBE_INTERVAL_MS = 14_000;
const PROBE_TIMEOUT_MS = 4_500;
const RECENT_RTT_WINDOW = 3;

function getNavigatorConnection(): BrowserNetworkInformation | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as NavigatorWithConnection;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

function normalizeEffectiveType(raw?: string): NetworkEffectiveType | null {
  if (raw === '4g' || raw === '3g' || raw === '2g' || raw === 'slow-2g') {
    return raw;
  }
  return null;
}

export function computeRttJitterMs(recentRtts: readonly number[]): number {
  if (recentRtts.length < 2) return 0;
  let maxDelta = 0;
  for (let i = 1; i < recentRtts.length; i++) {
    const delta = Math.abs(recentRtts[i] - recentRtts[i - 1]);
    if (delta > maxDelta) maxDelta = delta;
  }
  return Math.round(maxDelta);
}

export function classifyNetworkQuality(
  input: ClassifyNetworkQualityInput,
): NetworkQualitySnapshot {
  const {
    isOnline,
    externalStatus = 'online',
    latencyMs,
    jitterMs,
    downlinkMbps,
    effectiveType,
    consecutiveFailures,
  } = input;

  const baseMetrics = {
    latencyMs,
    jitterMs,
    downlinkMbps,
    effectiveType,
    consecutiveFailures,
    isOnline,
  };

  // Nivel 5 — Sin Conexión / Offline (Rojo Carmesí)
  if (!isOnline || externalStatus === 'offline' || consecutiveFailures >= 2) {
    return {
      ...baseMetrics,
      level: 'offline',
      label: 'Sin conexión',
      diagnostic: 'Sin conexión · Modo Local',
      detailLine: 'Pendiente de sincronizar al recuperar señal',
      dotClassName: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]',
      pillClassName:
        'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200',
    };
  }

  const speedMetaParts: string[] = [];
  if (effectiveType) speedMetaParts.push(effectiveType.toUpperCase());
  if (downlinkMbps !== null && Number.isFinite(downlinkMbps)) {
    speedMetaParts.push(`${downlinkMbps.toFixed(1)} Mbps`);
  }
  if (jitterMs > 0) {
    speedMetaParts.push(`Jitter ${jitterMs} ms`);
  }
  const speedMetaText =
    speedMetaParts.length > 0 ? speedMetaParts.join(' · ') : 'Sonda HTTP en vivo';

  // Nivel 4 — Inestable / Crítica (Naranja Intenso con pulso suave)
  const hasHighLatency = latencyMs !== null && latencyMs > 800;
  const hasVerySlowNetwork =
    effectiveType === '2g' || effectiveType === 'slow-2g';
  const hasPacketLoss = consecutiveFailures === 1;
  const hasHighJitter = jitterMs > 250;

  if (hasHighLatency || hasVerySlowNetwork || hasPacketLoss || hasHighJitter) {
    return {
      ...baseMetrics,
      level: 'unstable',
      label: 'Internet Inestable',
      diagnostic:
        latencyMs !== null
          ? `Internet Inestable · ${latencyMs} ms`
          : 'Internet Inestable',
      detailLine: hasPacketLoss
        ? `Microcorte detectado · ${speedMetaText}`
        : speedMetaText,
      dotClassName:
        'bg-orange-500 animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.85)]',
      pillClassName:
        'border-orange-500/45 bg-orange-500/10 text-orange-700 dark:text-orange-200',
    };
  }

  // Nivel 3 — Regular / Lenta (Amarillo Ámbar)
  const hasMediumHighLatency = latencyMs !== null && latencyMs >= 350;
  const hasSlowDownlink = downlinkMbps !== null && downlinkMbps < 1.5;
  const is3g = effectiveType === '3g';

  if (
    externalStatus === 'poor' ||
    is3g ||
    hasSlowDownlink ||
    hasMediumHighLatency
  ) {
    return {
      ...baseMetrics,
      level: 'fair',
      label: 'Conexión Regular',
      diagnostic:
        latencyMs !== null
          ? `Conexión Regular · ${latencyMs} ms`
          : 'Conexión Regular',
      detailLine: speedMetaText,
      dotClassName: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]',
      pillClassName:
        'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    };
  }

  // Nivel 1 — Excelente (Verde Esmeralda brillante con halo)
  const hasOptimalSpeed = downlinkMbps === null || downlinkMbps >= 5;
  const hasLowLatency = latencyMs !== null && latencyMs < 150;
  const hasHighStability = consecutiveFailures === 0 && jitterMs <= 120;

  if (hasLowLatency && hasHighStability && hasOptimalSpeed) {
    return {
      ...baseMetrics,
      level: 'excellent',
      label: 'Conexión Excelente',
      diagnostic: `Conexión Excelente · ${latencyMs} ms`,
      detailLine: speedMetaText,
      dotClassName:
        'bg-emerald-500 shadow-[0_0_9px_rgba(16,185,129,0.75)] shadow-emerald-500/40',
      pillClassName:
        'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-[#0D1526] dark:text-slate-200',
    };
  }

  // Nivel 2 — Buena / Estable (Verde Lima)
  return {
    ...baseMetrics,
    level: 'good',
    label: 'Conexión Estable',
    diagnostic:
      latencyMs !== null
        ? `Conexión Estable · ${latencyMs} ms`
        : 'Conexión Estable',
    detailLine: speedMetaText,
    dotClassName: 'bg-lime-400 shadow-[0_0_8px_rgba(163,230,53,0.7)]',
    pillClassName:
      'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-[#0D1526] dark:text-slate-200',
  };
}

export function useNetworkQuality(
  externalStatus: ExternalConnectionHint = 'online',
): NetworkQualitySnapshot {
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [connMeta, setConnMeta] = useState<{
    downlinkMbps: number | null;
    effectiveType: NetworkEffectiveType | null;
    hintRttMs: number | null;
  }>(() => {
    const conn = getNavigatorConnection();
    return {
      downlinkMbps:
        typeof conn?.downlink === 'number' && Number.isFinite(conn.downlink)
          ? conn.downlink
          : null,
      effectiveType: normalizeEffectiveType(conn?.effectiveType),
      hintRttMs:
        typeof conn?.rtt === 'number' &&
        Number.isFinite(conn.rtt) &&
        conn.rtt > 0
          ? conn.rtt
          : null,
    };
  });

  const [probeState, setProbeState] = useState<{
    latencyMs: number | null;
    jitterMs: number;
    consecutiveFailures: number;
  }>(() => ({
    latencyMs: connMeta.hintRttMs,
    jitterMs: 0,
    consecutiveFailures: 0,
  }));

  const recentRttsRef = useRef<number[]>([]);
  const probeInFlightRef = useRef(false);

  const syncConnectionApi = useCallback(() => {
    const conn = getNavigatorConnection();
    setConnMeta({
      downlinkMbps:
        typeof conn?.downlink === 'number' && Number.isFinite(conn.downlink)
          ? conn.downlink
          : null,
      effectiveType: normalizeEffectiveType(conn?.effectiveType),
      hintRttMs:
        typeof conn?.rtt === 'number' &&
        Number.isFinite(conn.rtt) &&
        conn.rtt > 0
          ? conn.rtt
          : null,
    });
  }, []);

  const runProbe = useCallback(async () => {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsBrowserOnline(false);
      return;
    }
    if (probeInFlightRef.current) return;

    probeInFlightRef.current = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const isHttpOrigin =
      window.location.protocol === 'http:' ||
      window.location.protocol === 'https:';
    const probeTarget = isHttpOrigin
      ? `${window.location.origin}/`
      : 'https://www.gstatic.com/generate_204';

    const startedAt =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      await fetch(probeTarget, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal,
      });
      const endedAt =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const measuredMs = Math.max(1, Math.round(endedAt - startedAt));

      const nextRtts = [...recentRttsRef.current, measuredMs].slice(
        -RECENT_RTT_WINDOW,
      );
      recentRttsRef.current = nextRtts;

      setIsBrowserOnline(true);
      setProbeState({
        latencyMs: measuredMs,
        jitterMs: computeRttJitterMs(nextRtts),
        consecutiveFailures: 0,
      });
    } catch {
      setProbeState((prev) => ({
        ...prev,
        consecutiveFailures: prev.consecutiveFailures + 1,
      }));
    } finally {
      window.clearTimeout(timeoutId);
      probeInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsBrowserOnline(true);
      syncConnectionApi();
      void runProbe();
    };
    const handleOffline = () => {
      setIsBrowserOnline(false);
    };
    const handleFocusOrVisible = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      syncConnectionApi();
      void runProbe();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    const conn = getNavigatorConnection();
    const handleConnectionChange = () => {
      syncConnectionApi();
      void runProbe();
    };
    conn?.addEventListener?.('change', handleConnectionChange);

    // Sonda inicial y luego cada 14 s (rango ligero 12-15 s)
    void runProbe();
    const intervalId = window.setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      syncConnectionApi();
      void runProbe();
    }, PROBE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      conn?.removeEventListener?.('change', handleConnectionChange);
    };
  }, [runProbe, syncConnectionApi]);

  return useMemo(
    () =>
      classifyNetworkQuality({
        isOnline: isBrowserOnline,
        externalStatus,
        latencyMs: probeState.latencyMs ?? connMeta.hintRttMs,
        jitterMs: probeState.jitterMs,
        downlinkMbps: connMeta.downlinkMbps,
        effectiveType: connMeta.effectiveType,
        consecutiveFailures: probeState.consecutiveFailures,
      }),
    [
      connMeta.downlinkMbps,
      connMeta.effectiveType,
      connMeta.hintRttMs,
      externalStatus,
      isBrowserOnline,
      probeState.consecutiveFailures,
      probeState.jitterMs,
      probeState.latencyMs,
    ],
  );
}
