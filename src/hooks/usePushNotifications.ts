import { useEffect, useRef } from 'react';
import type { AppState, SubModuleId } from '../types/erp';

export type SystemNotificationPermission =
  | NotificationPermission
  | 'unsupported';

const DAILY_REMINDER_STORAGE_KEY = 'x4sport_daily_notif_reminder_date_v1';

interface ReceivableSnapshot {
  debtor: string;
  amount: number;
  paidAmount: number;
  saleId?: string;
  instIds: Set<string>;
}

interface NotificationBaseline {
  initialized: boolean;
  saleIds: Set<string>;
  receivables: Map<string, ReceivableSnapshot>;
  expenseIds: Set<string>;
  inventoryStock: Map<string, number>;
  collectedReceivablesCount: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getLocalTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function getSystemNotificationPermission(): SystemNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function sendSystemNotification(
  title: string,
  body: string,
  tag?: string,
  targetView?: SubModuleId | string,
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  const targetUrl = targetView
    ? `/?view=${encodeURIComponent(targetView)}`
    : '/';

  const options: NotificationOptions & { vibrate?: number[] } = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    vibrate: [150, 80, 150],
    data: {
      view: targetView,
      url: targetUrl,
    },
  };

  try {
    if ('serviceWorker' in navigator) {
      const existingReg = await navigator.serviceWorker.getRegistration();
      if (existingReg) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, options);
          return true;
        }
      }
    }
  } catch {
    // Fallback to browser Notification constructor below
  }

  try {
    const notif = new Notification(title, options);
    if (targetView) {
      notif.onclick = () => {
        window.focus();
        window.dispatchEvent(
          new CustomEvent('x4sport:navigate-view', { detail: targetView }),
        );
        notif.close();
      };
    }
    return true;
  } catch {
    return false;
  }
}

export async function requestSystemNotificationPermission(): Promise<SystemNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      await sendSystemNotification(
        'X4SPORT ERP · Notificaciones activadas correctamente',
        'Recibirás alertas en tiempo real de nuevas ventas, abonos CxC y stock crítico.',
        'x4sport-notif-activated',
        'dashboard',
      );
    }
    return result;
  } catch {
    return Notification.permission;
  }
}

export async function sendTestSystemNotification(): Promise<boolean> {
  return sendSystemNotification(
    'X4SPORT ERP · Notificaciones activadas correctamente',
    'Prueba de alerta nativa con sonido y vibración en este dispositivo.',
    `x4sport-notif-test-${Date.now()}`,
    'dashboard',
  );
}

function buildBaselineFromState(state: AppState): NotificationBaseline {
  const receivables = new Map<string, ReceivableSnapshot>();
  for (const rec of state.receivables ?? []) {
    receivables.set(rec.id, {
      debtor: rec.debtor,
      amount: round2(rec.amount),
      paidAmount: round2(rec.paidAmount ?? 0),
      saleId: rec.saleId,
      instIds: new Set((rec.installments ?? []).map((i) => i.id)),
    });
  }

  const inventoryStock = new Map<string, number>();
  for (const item of state.inventory ?? []) {
    inventoryStock.set(item.id, item.stock);
  }

  return {
    initialized: true,
    saleIds: new Set((state.sales ?? []).map((s) => s.id)),
    receivables,
    expenseIds: new Set((state.operatingExpenses ?? []).map((e) => e.id)),
    inventoryStock,
    collectedReceivablesCount: state.collectedReceivablesCount ?? 0,
  };
}

interface UsePushNotificationsOptions {
  state: AppState;
  enabled: boolean;
  isHydratingDb: boolean;
}

export function usePushNotifications({
  state,
  enabled,
  isHydratingDb,
}: UsePushNotificationsOptions): void {
  const baselineRef = useRef<NotificationBaseline>({
    initialized: false,
    saleIds: new Set(),
    receivables: new Map(),
    expenseIds: new Set(),
    inventoryStock: new Map(),
    collectedReceivablesCount: 0,
  });

  // 1. Detección pasiva en vivo (con protección anti-spam al iniciar)
  useEffect(() => {
    if (!enabled || isHydratingDb) return;

    if (!baselineRef.current.initialized) {
      baselineRef.current = buildBaselineFromState(state);
      return;
    }

    const prev = baselineRef.current;

    // a) Nueva Venta registrada
    for (const sale of state.sales ?? []) {
      if (!prev.saleIds.has(sale.id) && !sale.voided) {
        const customer = sale.customerName?.trim() || 'Cliente Mostrador';
        void sendSystemNotification(
          `Nueva Venta · ${sale.seller}`,
          `${customer} — $${round2(sale.finalPrice).toFixed(2)} USDT (${sale.paymentMethod})`,
          `x4sport-sale-${sale.id}`,
          'ventas-historial',
        );
      }
    }

    // b) Nuevo Abono o Liquidación en CxC
    const currentRecMap = new Map(
      (state.receivables ?? []).map((r) => [r.id, r]),
    );
    const salesById = new Map((state.sales ?? []).map((s) => [s.id, s]));

    for (const rec of state.receivables ?? []) {
      const prevRec = prev.receivables.get(rec.id);
      if (!prevRec) continue;

      const newInstallment = (rec.installments ?? []).find(
        (inst) => !prevRec.instIds.has(inst.id),
      );
      if (newInstallment && newInstallment.amount > 0) {
        void sendSystemNotification(
          'Abono Recibido · CxC',
          `${rec.debtor} abonó $${round2(newInstallment.amount).toFixed(2)} USDT (Resta: $${round2(rec.amount).toFixed(2)} USDT)`,
          `x4sport-cxc-${rec.id}-${newInstallment.id}`,
          'ventas-cxc',
        );
      } else {
        const deltaPaid = round2(prevRec.amount - rec.amount);
        if (deltaPaid > 0.009) {
          void sendSystemNotification(
            'Abono Recibido · CxC',
            `${rec.debtor} abonó $${deltaPaid.toFixed(2)} USDT (Resta: $${round2(rec.amount).toFixed(2)} USDT)`,
            `x4sport-cxc-${rec.id}-${Date.now()}`,
            'ventas-cxc',
          );
        }
      }
    }

    // Liquidación total (la cuenta salió de state.receivables al cobrarse por completo)
    if (
      (state.collectedReceivablesCount ?? 0) > prev.collectedReceivablesCount
    ) {
      for (const [recId, prevRec] of prev.receivables.entries()) {
        if (!currentRecMap.has(recId) && prevRec.amount > 0.009) {
          const isVoidedRelated = Boolean(
            prevRec.saleId && salesById.get(prevRec.saleId)?.voided,
          );
          if (!isVoidedRelated) {
            void sendSystemNotification(
              'Abono Recibido · CxC',
              `${prevRec.debtor} abonó $${prevRec.amount.toFixed(2)} USDT (Resta: $0.00 USDT)`,
              `x4sport-cxc-paid-${recId}`,
              'ventas-cxc',
            );
          }
        }
      }
    }

    // c) Stock Crítico tras movimiento (baja a <= 2 unidades)
    for (const item of state.inventory ?? []) {
      const prevStock = prev.inventoryStock.get(item.id);
      if (
        prevStock !== undefined &&
        item.stock < prevStock &&
        item.stock <= 2
      ) {
        void sendSystemNotification(
          'Stock Crítico (≤ 2 uds)',
          `${item.model} (${item.version} · Talla ${item.size}) — Quedan ${item.stock} ud(s)`,
          `x4sport-lowstock-${item.id}`,
          'inventario-stock',
        );
      }
    }

    // Actualizar snapshot de referencia (sales, receivables, expenses, stock)
    baselineRef.current = buildBaselineFromState(state);
  }, [enabled, isHydratingDb, state]);

  // 2. Recordatorio Diario Inteligente (Máximo 1 vez cada 24h usando localStorage)
  useEffect(() => {
    if (!enabled || isHydratingDb) return;
    if (getSystemNotificationPermission() !== 'granted') return;

    const todayIso = getLocalTodayIso();
    try {
      if (
        typeof window !== 'undefined' &&
        window.localStorage?.getItem(DAILY_REMINDER_STORAGE_KEY) === todayIso
      ) {
        return;
      }
    } catch {
      return;
    }

    const nowMs = Date.now();
    const overdueReceivables = (state.receivables ?? []).filter((rec) => {
      const createdMs = Date.parse(rec.createdAt);
      if (!Number.isFinite(createdMs)) return false;
      const days = Math.floor((nowMs - createdMs) / 86_400_000);
      return days > 15;
    });

    const transitNearArrival = (state.purchaseBatches ?? []).filter((batch) => {
      if (batch.status !== 'EN TRÁNSITO') return false;
      const refDateMs = Date.parse(batch.entryDate || batch.createdAt);
      if (!Number.isFinite(refDateMs)) return false;
      const elapsedDays = Math.max(
        0,
        Math.floor((nowMs - refDateMs) / 86_400_000),
      );
      if (batch.shippingType === 'Aéreo') {
        return elapsedDays >= 15; // Próximo o cumplido plazo estimado de 18d aéreo
      }
      return elapsedDays >= 80; // Próximo o cumplido plazo estimado de 90d marítimo
    });

    if (overdueReceivables.length === 0 && transitNearArrival.length === 0) {
      return;
    }

    const summaryParts: string[] = [];
    if (overdueReceivables.length > 0) {
      summaryParts.push(
        `${overdueReceivables.length} cuenta(s) CxC vencida(s) (>15d)`,
      );
    }
    if (transitNearArrival.length > 0) {
      summaryParts.push(
        `${transitNearArrival.length} compra(s) en tránsito próxima(s) a llegada`,
      );
    }

    const targetView: SubModuleId =
      overdueReceivables.length > 0 ? 'ventas-cxc' : 'compras-transito';

    try {
      window.localStorage?.setItem(DAILY_REMINDER_STORAGE_KEY, todayIso);
    } catch {
      // Ignore storage quota errors
    }

    void sendSystemNotification(
      'Resumen Diario · X4SPORT ERP',
      summaryParts.join(' · '),
      `x4sport-daily-summary-${todayIso}`,
      targetView,
    );
  }, [enabled, isHydratingDb, state.purchaseBatches, state.receivables]);
}
