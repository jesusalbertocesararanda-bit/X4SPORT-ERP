import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  History,
  Layers,
  Lock,
  Play,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AppState,
  InventoryAuditCrossAlert,
  InventoryAuditSession,
  TeamCategory,
} from '../types/erp';
import { isAdminUser, type ERPUser } from '../utils/auth';
import {
  buildBaseModelQuickCountGroups,
  calculateAuditMetrics,
  detectSizeDiscrepancyCrosses,
  normalizeVersionDisplay,
  type BaseModelQuickCountGroup,
} from '../utils/finance';

interface AuditViewProps {
  state: AppState;
  currentUser?: ERPUser | null;
  onSaveProgress: (
    counts: Record<string, number>,
    notes?: string,
    modelQuickCounts?: Record<string, number | null>,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onCloseAuditSession: (
    counts: Record<string, number>,
    applyAdjustmentsToInventory: boolean,
    reason?: string,
    modelQuickCounts?: Record<string, number | null>,
  ) =>
    | Promise<{ ok: boolean; error?: string; session?: InventoryAuditSession }>
    | { ok: boolean; error?: string; session?: InventoryAuditSession };
  onStartNewAuditSession: () =>
    | Promise<{ ok: boolean; error?: string }>
    | { ok: boolean; error?: string };
  onPerformUncross: (input: {
    sourceSkuId: string;
    targetSkuId: string;
    quantity: number;
    reason?: string;
    user?: string;
  }) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
}

const DEFAULT_TEAM_ORDER = [
  'Barcelona',
  'Real Madrid',
  'Manchester City',
  'PSG',
  'Selecciones',
  'Otro',
];

export function AuditView({
  state,
  currentUser,
  onSaveProgress,
  onCloseAuditSession,
  onStartNewAuditSession,
  onPerformUncross,
}: AuditViewProps) {
  // Active session or initialize
  const isAdmin = isAdminUser(currentUser);
  const activeSession = state.activeAuditSession ?? null;
  const isClosed = activeSession?.status === 'closed';

  // Physical counts mapping: skuId -> string input
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [quickCounts, setQuickCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string>('');
  const [countViewMode, setCountViewMode] = useState<'variant' | 'quick_model'>(
    'variant',
  );

  // Sync with active session when it changes
  useEffect(() => {
    if (activeSession) {
      const initial: Record<string, string> = {};
      for (const [skuId, val] of Object.entries(activeSession.counts ?? {})) {
        if (val !== null && val !== undefined) {
          initial[skuId] = String(val);
        }
      }
      setCounts(initial);

      const initialQuick: Record<string, string> = {};
      for (const [groupKey, val] of Object.entries(
        activeSession.modelQuickCounts ?? {},
      )) {
        if (val !== null && val !== undefined) {
          initialQuick[groupKey] = String(val);
        }
      }
      setQuickCounts(initialQuick);
      setNotes(activeSession.notes ?? '');
    } else {
      setCounts({});
      setQuickCounts({});
      setNotes('');
    }
  }, [activeSession]);

  // Filtering & search
  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<'Todos' | TeamCategory>('Todos');
  const [statusFilter, setStatusFilter] = useState<'all' | 'counted' | 'uncounted' | 'discrepancy'>(
    'all',
  );

  // Modals & feedback
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [applyAdjustments, setApplyAdjustments] = useState(isAdmin);
  const [closeReason, setCloseReason] = useState('Auditoría física y conteo mensual');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Tab for active count vs history
  const [viewTab, setViewTab] = useState<'conteo' | 'historial'>('conteo');

  const teamFilters = useMemo(() => {
    const present = new Set(state.inventory.map((i) => i.team));
    const orderedCanonical = DEFAULT_TEAM_ORDER.filter((t) => present.has(t));
    const customTeams = Array.from(present)
      .filter((t) => !DEFAULT_TEAM_ORDER.includes(t))
      .sort();
    return ['Todos', ...orderedCanonical, ...customTeams];
  }, [state.inventory]);

  // Parsed numeric counts
  const parsedNumericCounts = useMemo(() => {
    const res: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) {
      if (v.trim() !== '') {
        const n = Math.floor(Number(v));
        if (Number.isFinite(n) && n >= 0) {
          res[k] = n;
        }
      }
    }
    return res;
  }, [counts]);

  // Parsed quick model counts (preserve null for cleared keys)
  const parsedQuickModelCounts = useMemo(() => {
    const res: Record<string, number | null> = {};
    const allKeys = new Set([
      ...Object.keys(activeSession?.modelQuickCounts ?? {}),
      ...Object.keys(quickCounts),
    ]);
    for (const k of allKeys) {
      const raw = quickCounts[k];
      if (raw !== undefined && raw.trim() !== '') {
        const n = Math.floor(Number(raw));
        if (Number.isFinite(n) && n >= 0) {
          res[k] = n;
          continue;
        }
      }
      if (activeSession?.modelQuickCounts && k in activeSession.modelQuickCounts) {
        res[k] = null;
      }
    }
    return res;
  }, [activeSession?.modelQuickCounts, quickCounts]);

  const quickCountGroups: BaseModelQuickCountGroup[] = useMemo(
    () =>
      buildBaseModelQuickCountGroups(
        state.inventory,
        parsedNumericCounts,
        parsedQuickModelCounts,
      ),
    [parsedNumericCounts, parsedQuickModelCounts, state.inventory],
  );

  const filteredQuickGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return quickCountGroups.filter((group) => {
      if (teamFilter !== 'Todos' && group.team !== teamFilter) return false;
      const isCounted = group.physicalCount !== null;
      const hasDiscrepancy =
        group.status === 'shortage' ||
        group.status === 'surplus' ||
        group.status === 'cross_alert';

      if (statusFilter === 'counted' && !isCounted) return false;
      if (statusFilter === 'uncounted' && isCounted) return false;
      if (statusFilter === 'discrepancy' && !hasDiscrepancy) return false;

      if (!q) return true;
      return (
        group.baseModel.toLowerCase().includes(q) ||
        group.team.toLowerCase().includes(q) ||
        group.versions.some((v) => v.toLowerCase().includes(q)) ||
        group.skus.some((s) => s.model.toLowerCase().includes(q))
      );
    });
  }, [quickCountGroups, searchQuery, statusFilter, teamFilter]);

  // Calculate the 6 exact indicators
  const metrics = useMemo(() => {
    if (isClosed && activeSession?.summary) {
      return activeSession.summary;
    }
    return calculateAuditMetrics(state.inventory, parsedNumericCounts);
  }, [activeSession, isClosed, parsedNumericCounts, state.inventory]);

  // Detect size discrepancy crosses in current counts
  const crossAlerts: InventoryAuditCrossAlert[] = useMemo(() => {
    if (isClosed) return [];
    return detectSizeDiscrepancyCrosses(state.inventory, parsedNumericCounts);
  }, [isClosed, parsedNumericCounts, state.inventory]);

  // Filtered inventory items for counting table
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.inventory
      .filter((item) => {
        if (teamFilter !== 'Todos' && item.team !== teamFilter) return false;

        const countRaw = counts[item.id];
        const isCounted = countRaw !== undefined && countRaw.trim() !== '';
        const parsedVal = isCounted ? Math.floor(Number(countRaw)) : null;
        const hasDiscrepancy =
          parsedVal !== null && Number.isFinite(parsedVal) && parsedVal !== item.stock;

        if (statusFilter === 'counted' && !isCounted) return false;
        if (statusFilter === 'uncounted' && isCounted) return false;
        if (statusFilter === 'discrepancy' && !hasDiscrepancy) return false;

        if (!q) return true;
        return (
          item.model.toLowerCase().includes(q) ||
          item.team.toLowerCase().includes(q) ||
          item.version.toLowerCase().includes(q) ||
          item.size.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          a.team.localeCompare(b.team) ||
          a.model.localeCompare(b.model) ||
          a.version.localeCompare(b.version) ||
          a.size.localeCompare(b.size),
      );
  }, [counts, searchQuery, state.inventory, statusFilter, teamFilter]);

  // Handlers
  const handleCountChange = (skuId: string, val: string) => {
    if (isClosed) return;
    setFeedback(null);
    setCounts((prev) => ({
      ...prev,
      [skuId]: val,
    }));
  };

  const handleQuickModelCountChange = (groupKey: string, val: string) => {
    if (isClosed) return;
    setFeedback(null);
    setQuickCounts((prev) => ({
      ...prev,
      [groupKey]: val,
    }));
  };

  const handleSaveProgress = async () => {
    setFeedback(null);
    const res = await Promise.resolve(
      onSaveProgress(parsedNumericCounts, notes, parsedQuickModelCounts),
    );
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'Error al guardar el progreso.' });
      return;
    }
    const countedSkus = Object.keys(parsedNumericCounts).length;
    const countedModels = Object.values(parsedQuickModelCounts).filter(
      (v) => v !== null && v !== undefined,
    ).length;
    setFeedback({
      type: 'success',
      text: `Progreso guardado exitosamente en Firebase (${countedSkus} SKUs · ${countedModels} modelos rápidos). Puedes continuar en cualquier momento.`,
    });
  };

  const handleStartNewSession = async () => {
    if (
      !isClosed &&
      (Object.keys(parsedNumericCounts).length > 0 ||
        Object.values(parsedQuickModelCounts).some((v) => v !== null)) &&
      !window.confirm(
        'Hay un conteo en borrador activo. ¿Deseas descartarlo e iniciar una nueva auditoría desde cero?',
      )
    ) {
      return;
    }
    const res = await Promise.resolve(onStartNewAuditSession());
    if (res.ok) {
      setCounts({});
      setQuickCounts({});
      setNotes('');
      setFeedback({
        type: 'info',
        text: 'Nueva sesión de auditoría iniciada. Ingresa el conteo físico de cada franela o por modelo base.',
      });
      setViewTab('conteo');
    } else {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo iniciar el nuevo conteo.' });
    }
  };

  const handleConfirmClose = async () => {
    if (isSubmitting) return;
    setFeedback(null);
    setIsSubmitting(true);
    const shouldApplyToInventory = isAdmin && applyAdjustments;
    try {
      const res = await Promise.resolve(
        onCloseAuditSession(
          parsedNumericCounts,
          shouldApplyToInventory,
          closeReason,
          parsedQuickModelCounts,
        ),
      );
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error ?? 'Error al cerrar el recuento.' });
        setShowCloseModal(false);
        return;
      }
      setShowCloseModal(false);
      setFeedback({
        type: 'success',
        text: shouldApplyToInventory
          ? 'Recuento cerrado exitosamente: Se archivaron las métricas y se actualizaron las unidades en inventario.'
          : 'Recuento cerrado y archivado exitosamente sin modificar el stock de inventario.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUncrossOneClick = async (alert: InventoryAuditCrossAlert) => {
    if (isSubmitting) return;
    setFeedback(null);
    setIsSubmitting(true);
    try {
      const res = await Promise.resolve(
        onPerformUncross({
          sourceSkuId: alert.shortageSkuId,
          targetSkuId: alert.surplusSkuId,
          quantity: alert.uncrossQuantity,
          reason: `Descruce automático 1-Clic: ${alert.model} (${alert.shortageSize} → ${alert.surplusSize})`,
          user: currentUser?.name ?? 'Auditor',
        }),
      );

      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error ?? 'Error al descruzar.' });
        return;
      }

      setFeedback({
        type: 'success',
        text: `Descruce aplicado: Se transfirieron ${alert.uncrossQuantity} uds de ${alert.shortageSize} a ${alert.surplusSize} en ${alert.model}. Stock del sistema actualizado frente al conteo físico.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Auditoría y Conteos Físicos
            </h1>
            {isClosed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                <Lock className="h-3 w-3" /> Conteo Cerrado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/15 px-2.5 py-0.5 text-xs font-semibold text-blue-300">
                <Play className="h-3 w-3" /> Borrador en Progreso
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Conteo progresivo de inventario con guardado en Firebase, detector de cruce de tallas y tablero de 6 indicadores de conciliación.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleStartNewSession}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 bg-[#0D1526] px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <RotateCcw className="h-4 w-4 text-slate-400" />
            Iniciar Nuevo Recuento
          </button>

          {!isClosed && (
            <>
              <button
                type="button"
                onClick={handleSaveProgress}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/15 px-4 py-2 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-500/25"
              >
                <Save className="h-4 w-4 text-blue-400" />
                Guardar Progreso
              </button>

              <button
                type="button"
                onClick={() => setShowCloseModal(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.99] shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <Lock className="h-4 w-4" />
                Cerrar Recuento
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-xl p-4 text-sm font-medium ${
            feedback.type === 'error'
              ? 'border border-red-500/40 bg-red-500/10 text-red-200'
              : feedback.type === 'success'
                ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border border-blue-500/40 bg-blue-500/10 text-blue-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          ) : feedback.type === 'error' ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          ) : (
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          )}
          <span className="flex-1">{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* DETECTOR INTELIGENTE DE CRUCE DE MERCANCÍA */}
      {crossAlerts.length > 0 && (
        <section
          aria-label="Alertas de cruce de mercancía"
          className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 sm:p-6 shadow-xl space-y-3"
        >
          <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
            <ArrowLeftRight className="h-5 w-5 text-amber-400 animate-pulse" />
            <span>Detector Inteligente de Cruce de Mercancía</span>
          </div>
          <p className="text-xs text-amber-200/90">
            Se detectaron descuadres simétricos (sobrante en una talla y faltante idéntico en otra talla del mismo modelo y versión). Corrige el cruce con un solo clic:
          </p>

          <div className="space-y-3 pt-2">
            {crossAlerts.map((alert) => (
              <div
                key={`${alert.model}_${alert.version}_${alert.surplusSize}_${alert.shortageSize}`}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-amber-500/30 bg-[#080E1C] p-4 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">
                      {alert.model}
                    </span>
                    <span className="text-slate-400">({alert.version})</span>
                  </div>
                  <p className="text-slate-300">
                    Posible cruce detectado:{' '}
                    <strong className="text-emerald-400 font-mono-num">
                      +{alert.uncrossQuantity} uds en Talla {alert.surplusSize}
                    </strong>{' '}
                    y{' '}
                    <strong className="text-red-400 font-mono-num">
                      -{alert.uncrossQuantity} uds en Talla {alert.shortageSize}
                    </strong>
                    .
                  </p>
                </div>

                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => handleUncrossOneClick(alert)}
                    className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white shadow hover:bg-amber-500 active:scale-[0.99] whitespace-nowrap shrink-0 transition-colors"
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                    Descruzar 1-Clic
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 whitespace-nowrap shrink-0">
                    <Lock className="h-3.5 w-3.5" /> Solo Admin ejecuta descruce
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TABLERO RESUMEN CON LOS 6 INDICADORES EXACTOS (CANTIDAD Y %) */}
      <section aria-labelledby="audit-kpi-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2
            id="audit-kpi-heading"
            className="font-display text-base font-bold text-white flex items-center gap-2"
          >
            <Layers className="h-4 w-4 text-blue-400" />
            Tablero Resumen de Conciliación (6 Indicadores)
          </h2>
          <span className="text-xs text-slate-400 font-mono-num">
            Total en Sistema: {metrics.totalItems} SKUs · {metrics.totalSystemUnits} uds
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {/* 1) Ítems Conciliados */}
          <div className="rounded-xl border border-emerald-500/30 bg-[#0D1526] p-4 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              1. Ítems Conciliados
            </span>
            <p className="font-mono-num text-xl font-bold text-white">
              {metrics.reconciledItems}{' '}
              <span className="text-xs font-normal text-slate-400">SKUs</span>
            </p>
            <span className="inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono-num text-[11px] font-bold text-emerald-300">
              {metrics.reconciledItemsPct.toFixed(1)}%
            </span>
          </div>

          {/* 2) Ítems No Conciliados */}
          <div className="rounded-xl border border-amber-500/30 bg-[#0D1526] p-4 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              2. Ítems No Conciliados
            </span>
            <p className="font-mono-num text-xl font-bold text-amber-300">
              {metrics.unreconciledItems}{' '}
              <span className="text-xs font-normal text-slate-400">SKUs</span>
            </p>
            <span className="inline-block rounded bg-amber-500/20 px-1.5 py-0.5 font-mono-num text-[11px] font-bold text-amber-300">
              {metrics.unreconciledItemsPct.toFixed(1)}%
            </span>
          </div>

          {/* 3) Ítems No Contados */}
          <div className="rounded-xl border border-slate-700 bg-[#0D1526] p-4 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
              <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              3. Ítems No Contados
            </span>
            <p className="font-mono-num text-xl font-bold text-slate-200">
              {metrics.uncountedItems}{' '}
              <span className="text-xs font-normal text-slate-400">SKUs</span>
            </p>
            <span className="inline-block rounded bg-slate-800 px-1.5 py-0.5 font-mono-num text-[11px] font-bold text-slate-300">
              {metrics.uncountedItemsPct.toFixed(1)}%
            </span>
          </div>

          {/* 4) Unidades Conciliadas */}
          <div className="rounded-xl border border-emerald-500/30 bg-[#0D1526] p-4 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              4. Unidades Conciliadas
            </span>
            <p className="font-mono-num text-xl font-bold text-white">
              {metrics.reconciledUnits}{' '}
              <span className="text-xs font-normal text-slate-400">uds</span>
            </p>
            <span className="inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono-num text-[11px] font-bold text-emerald-300">
              {metrics.reconciledUnitsPct.toFixed(1)}%
            </span>
          </div>

          {/* 5) Unidades No Conciliadas */}
          <div className="rounded-xl border border-red-500/30 bg-[#0D1526] p-4 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-300">
              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              5. Unidades No Conciliadas
            </span>
            <p className="font-mono-num text-xl font-bold text-red-400">
              {metrics.unreconciledUnits}{' '}
              <span className="text-xs font-normal text-slate-400">uds</span>
            </p>
            <span className="inline-block rounded bg-red-500/20 px-1.5 py-0.5 font-mono-num text-[11px] font-bold text-red-300">
              {metrics.unreconciledUnitsPct.toFixed(1)}%
            </span>
          </div>

          {/* 6) Unidades No Contadas */}
          <div className="rounded-xl border border-slate-700 bg-[#0D1526] p-4 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
              <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              6. Unidades No Contadas
            </span>
            <p className="font-mono-num text-xl font-bold text-slate-200">
              {metrics.uncountedUnits}{' '}
              <span className="text-xs font-normal text-slate-400">uds</span>
            </p>
            <span className="inline-block rounded bg-slate-800 px-1.5 py-0.5 font-mono-num text-[11px] font-bold text-slate-300">
              {metrics.uncountedUnitsPct.toFixed(1)}%
            </span>
          </div>
        </div>
      </section>

      {/* View Switcher: Conteo Activo vs Historial de Auditorías */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setViewTab('conteo')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            viewTab === 'conteo'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Layers className="h-4 w-4" />
          Hoja de Conteo ({filteredItems.length} SKUs)
        </button>

        <button
          type="button"
          onClick={() => setViewTab('historial')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            viewTab === 'historial'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <History className="h-4 w-4" />
          Historial de Auditorías ({(state.auditHistory ?? []).length})
        </button>
      </div>

      {viewTab === 'historial' ? (
        /* HISTORIAL DE AUDITORÍAS PASADAS */
        <section className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 shadow-xl space-y-4">
          <h3 className="font-display text-base font-bold text-white">
            Sesiones de Auditoría Archivadas
          </h3>
          {(state.auditHistory ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#080E1C] p-8 text-center text-sm text-slate-400">
              No hay auditorías cerradas registradas en el historial.
            </div>
          ) : (
            <div className="space-y-4">
              {(state.auditHistory ?? []).map((session) => (
                <article
                  key={session.id}
                  className="rounded-xl border border-slate-800 bg-[#080E1C] p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div>
                      <p className="font-semibold text-white">
                        Auditoría #{session.id.slice(-6)} · {session.notes || 'Sin observaciones'}
                      </p>
                      <p className="text-xs text-slate-400 font-mono-num">
                        Cerrada el{' '}
                        {new Date(session.closedAt || session.updatedAt || session.startedAt).toLocaleString('es-VE', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}{' '}
                        por {session.closedBy || 'Admin'}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 shrink-0">
                      <Lock className="h-3 w-3" /> Cerrada
                    </span>
                  </div>

                  {session.summary && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-xs font-mono-num">
                      <div className="p-2 rounded bg-[#0D1526]">
                        <span className="block text-[10px] text-slate-400">Ítems Conciliados</span>
                        <span className="font-bold text-emerald-400">
                          {session.summary.reconciledItems} ({session.summary.reconciledItemsPct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="p-2 rounded bg-[#0D1526]">
                        <span className="block text-[10px] text-slate-400">Ítems No Conciliados</span>
                        <span className="font-bold text-amber-300">
                          {session.summary.unreconciledItems} ({session.summary.unreconciledItemsPct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="p-2 rounded bg-[#0D1526]">
                        <span className="block text-[10px] text-slate-400">Ítems No Contados</span>
                        <span className="font-bold text-slate-300">
                          {session.summary.uncountedItems} ({session.summary.uncountedItemsPct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="p-2 rounded bg-[#0D1526]">
                        <span className="block text-[10px] text-slate-400">Uds Conciliadas</span>
                        <span className="font-bold text-emerald-400">
                          {session.summary.reconciledUnits} ({session.summary.reconciledUnitsPct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="p-2 rounded bg-[#0D1526]">
                        <span className="block text-[10px] text-slate-400">Uds No Conciliadas</span>
                        <span className="font-bold text-red-400">
                          {session.summary.unreconciledUnits} ({session.summary.unreconciledUnitsPct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="p-2 rounded bg-[#0D1526]">
                        <span className="block text-[10px] text-slate-400">Uds No Contadas</span>
                        <span className="font-bold text-slate-300">
                          {session.summary.uncountedUnits} ({session.summary.uncountedUnitsPct.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        /* HOJA DE CONTEO ACTIVA */
        <section className="space-y-4">
          {/* Selector de Modo de Vista dentro de Auditoría */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-[#0D1526] p-3.5 sm:px-5">
            <div className="text-xs text-slate-300">
              <strong className="text-white">Modo de conteo físico:</strong>{' '}
              <span className="text-slate-400">
                {countViewMode === 'variant'
                  ? 'Detallado SKU por variante, versión y talla.'
                  : 'Agrupado por Modelo Base (ignorando dorsal/jugador y tallas S–XXL).'}
              </span>
            </div>
            <div
              role="group"
              aria-label="Modo de conteo de auditoría"
              className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800 bg-[#070D19] p-1"
            >
              <button
                type="button"
                data-testid="audit-mode-variant"
                onClick={() => setCountViewMode('variant')}
                className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  countViewMode === 'variant'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                Por Variante (Talla/Jugador)
              </button>
              <button
                type="button"
                data-testid="audit-mode-quick-model"
                onClick={() => setCountViewMode('quick_model')}
                className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  countViewMode === 'quick_model'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                Conteo Rápido por Modelo ({quickCountGroups.length})
              </button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-4 sm:p-5 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    countViewMode === 'quick_model'
                      ? 'Buscar modelo base o equipo...'
                      : 'Buscar franela por modelo, equipo o talla para conteo...'
                  }
                  className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#070D19] pl-10 pr-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Status pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    statusFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#080E1C] text-slate-400 hover:text-white'
                  }`}
                >
                  Todos ({countViewMode === 'quick_model' ? quickCountGroups.length : state.inventory.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('counted')}
                  className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    statusFilter === 'counted'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#080E1C] text-slate-400 hover:text-white'
                  }`}
                >
                  Contados (
                  {countViewMode === 'quick_model'
                    ? quickCountGroups.filter((g) => g.physicalCount !== null).length
                    : Object.keys(parsedNumericCounts).length}
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('uncounted')}
                  className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    statusFilter === 'uncounted'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#080E1C] text-slate-400 hover:text-white'
                  }`}
                >
                  No contados (
                  {countViewMode === 'quick_model'
                    ? quickCountGroups.filter((g) => g.physicalCount === null).length
                    : metrics.uncountedItems}
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('discrepancy')}
                  className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    statusFilter === 'discrepancy'
                      ? 'bg-amber-600 text-white'
                      : 'bg-[#080E1C] text-slate-400 hover:text-white'
                  }`}
                >
                  Con diferencia (
                  {countViewMode === 'quick_model'
                    ? quickCountGroups.filter(
                        (g) =>
                          g.status === 'shortage' ||
                          g.status === 'surplus' ||
                          g.status === 'cross_alert',
                      ).length
                    : metrics.unreconciledItems}
                  )
                </button>
              </div>
            </div>

            {/* Team Filters */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {teamFilters.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTeamFilter(t)}
                  className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    teamFilter === t
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'bg-[#080E1C] text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {countViewMode === 'quick_model' ? (
            /* MODO: CONTEO RÁPIDO POR MODELO BASE */
            <div className="rounded-2xl border border-slate-800 bg-[#0D1526] overflow-hidden shadow-xl">
              {filteredQuickGroups.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No hay modelos activos que coincidan con los filtros seleccionados.
                </div>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-800 bg-[#080E1C] text-xs font-medium text-slate-400">
                        <tr>
                          <th scope="col" className="px-5 py-3.5">Equipo</th>
                          <th scope="col" className="px-5 py-3.5">Modelo Base (Tallas y dorsales agrupados)</th>
                          <th scope="col" className="px-5 py-3.5 text-right">Total Sistema</th>
                          <th scope="col" className="px-5 py-3.5 text-right">Total Físico</th>
                          <th scope="col" className="px-5 py-3.5 text-right">Diferencia</th>
                          <th scope="col" className="px-5 py-3.5">Diagnóstico en Tiempo Real</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {filteredQuickGroups.map((group) => {
                          const raw = quickCounts[group.groupKey] ?? '';
                          const isComplete = group.status === 'complete';
                          const isCrossAlert = group.status === 'cross_alert';
                          const isRealDiff =
                            group.status === 'shortage' || group.status === 'surplus';

                          return (
                            <tr
                              key={group.groupKey}
                              data-testid={`quick-model-row-${group.groupKey}`}
                              className={`transition-colors ${
                                isRealDiff
                                  ? 'bg-red-500/5 hover:bg-red-500/10'
                                  : isCrossAlert
                                    ? 'bg-amber-500/5 hover:bg-amber-500/10'
                                    : isComplete
                                      ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                                      : 'hover:bg-slate-800/35'
                              }`}
                            >
                              <td className="px-5 py-3 text-xs font-medium text-blue-300 whitespace-nowrap">
                                {group.team}
                              </td>
                              <td className="px-5 py-3">
                                <p className="font-semibold text-white">{group.baseModel}</p>
                                <p className="text-[11px] text-slate-400">
                                  {group.versions.join(' · ')} · {group.skuCount}{' '}
                                  {group.skuCount === 1 ? 'variante' : 'variantes'}
                                </p>
                              </td>
                              <td className="px-5 py-3 text-right font-mono-num font-bold text-white whitespace-nowrap">
                                {group.totalSystemUnits} uds
                              </td>
                              <td className="px-5 py-3 text-right">
                                <label
                                  htmlFor={`quick-model-input-${group.groupKey}`}
                                  className="sr-only"
                                >
                                  Total físico para {group.baseModel}
                                </label>
                                <input
                                  id={`quick-model-input-${group.groupKey}`}
                                  data-testid={`quick-model-input-${group.groupKey}`}
                                  type="number"
                                  min="0"
                                  step="1"
                                  disabled={isClosed}
                                  placeholder={String(group.totalSystemUnits)}
                                  value={raw}
                                  onChange={(e) =>
                                    handleQuickModelCountChange(group.groupKey, e.target.value)
                                  }
                                  className={`font-mono-num min-h-[38px] w-24 rounded-lg border px-2.5 py-1 text-right text-sm font-semibold transition-colors focus:outline-none ${
                                    isClosed
                                      ? 'border-slate-800 bg-slate-900 text-slate-500'
                                      : isRealDiff
                                        ? 'border-red-500/60 bg-[#070D19] text-red-200 focus:border-red-500'
                                        : isCrossAlert
                                          ? 'border-amber-500/60 bg-[#070D19] text-amber-200 focus:border-amber-500'
                                          : isComplete
                                            ? 'border-emerald-500/60 bg-[#070D19] text-emerald-200 focus:border-emerald-500'
                                            : 'border-slate-700 bg-[#070D19] text-white focus:border-blue-500'
                                  }`}
                                />
                              </td>
                              <td className="px-5 py-3 text-right font-mono-num font-bold whitespace-nowrap">
                                {group.delta === null ? (
                                  <span className="text-xs text-slate-500">Sin contar</span>
                                ) : group.delta === 0 ? (
                                  <span className="text-emerald-400">0 ✓</span>
                                ) : group.delta > 0 ? (
                                  <span className="text-red-400">+{group.delta} uds</span>
                                ) : (
                                  <span className="text-red-400">{group.delta} uds</span>
                                )}
                              </td>
                              <td className="px-5 py-3">
                                {group.status === 'pending' && (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                                    <Clock className="h-3.5 w-3.5" /> Pendiente de conteo
                                  </span>
                                )}
                                {group.status === 'complete' && (
                                  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    Lote de modelo completo
                                  </span>
                                )}
                                {group.status === 'cross_alert' && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-200">
                                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                                      Posible cruce de talla/jugador detectado (revisar en Descruce)
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSearchQuery(group.baseModel);
                                        setCountViewMode('variant');
                                      }}
                                      className="rounded-md border border-amber-500/40 bg-[#080E1C] px-2 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
                                    >
                                      Ver tallas
                                    </button>
                                  </div>
                                )}
                                {group.status === 'shortage' && group.delta !== null && (
                                  <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                    Faltante real de {Math.abs(group.delta)} uds
                                  </span>
                                )}
                                {group.status === 'surplus' && group.delta !== null && (
                                  <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                    Sobrante real de {group.delta} uds
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards for Conteo Rápido por Modelo */}
                  <div className="divide-y divide-slate-800/80 md:hidden">
                    {filteredQuickGroups.map((group) => {
                      const raw = quickCounts[group.groupKey] ?? '';
                      return (
                        <div key={group.groupKey} className="p-4 space-y-2.5 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-[11px] font-medium text-blue-300">
                                {group.team} · {group.versions.join(' · ')}
                              </span>
                              <p className="font-semibold text-white text-sm">
                                {group.baseModel}
                              </p>
                              <p className="text-slate-400 font-mono-num">
                                Total Sistema:{' '}
                                <strong className="text-white">{group.totalSystemUnits} uds</strong> ·{' '}
                                {group.skuCount} variantes
                              </p>
                            </div>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              disabled={isClosed}
                              placeholder={String(group.totalSystemUnits)}
                              value={raw}
                              onChange={(e) =>
                                handleQuickModelCountChange(group.groupKey, e.target.value)
                              }
                              className="font-mono-num min-h-[42px] w-24 shrink-0 rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1 text-right text-sm font-semibold text-white focus:border-blue-500 focus:outline-none"
                            />
                          </div>

                          <div>
                            {group.status === 'pending' && (
                              <span className="text-slate-500">Pendiente de conteo</span>
                            )}
                            {group.status === 'complete' && (
                              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Lote de modelo completo
                              </span>
                            )}
                            {group.status === 'cross_alert' && (
                              <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-200">
                                <AlertTriangle className="h-3.5 w-3.5" /> Posible cruce de talla/jugador detectado (revisar en Descruce)
                              </span>
                            )}
                            {group.status === 'shortage' && group.delta !== null && (
                              <span className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
                                <AlertCircle className="h-3.5 w-3.5" /> Faltante real de {Math.abs(group.delta)} uds
                              </span>
                            )}
                            {group.status === 'surplus' && group.delta !== null && (
                              <span className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
                                <AlertCircle className="h-3.5 w-3.5" /> Sobrante real de {group.delta} uds
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Table / List (Por Variante S-XXL / Jugador) */
            <div className="rounded-2xl border border-slate-800 bg-[#0D1526] overflow-hidden shadow-xl">
              {filteredItems.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No se encontraron franelas con los criterios de búsqueda seleccionados.
                </div>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-800 bg-[#080E1C] text-xs font-medium text-slate-400">
                      <tr>
                        <th scope="col" className="px-5 py-3.5">Categoría / Equipo</th>
                        <th scope="col" className="px-5 py-3.5">Modelo</th>
                        <th scope="col" className="px-5 py-3.5">Versión</th>
                        <th scope="col" className="px-5 py-3.5">Talla</th>
                        <th scope="col" className="px-5 py-3.5 text-right">Stock Sistema</th>
                        <th scope="col" className="px-5 py-3.5 text-right">Conteo Físico</th>
                        <th scope="col" className="px-5 py-3.5 text-right">Diferencia</th>
                        <th scope="col" className="px-5 py-3.5 text-right">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {filteredItems.map((item) => {
                        const raw = counts[item.id] ?? '';
                        const isCounted = raw.trim() !== '';
                        const parsed = isCounted ? Math.floor(Number(raw)) : null;
                        const delta =
                          parsed !== null && Number.isFinite(parsed) ? parsed - item.stock : 0;
                        const isReconciled = isCounted && delta === 0;
                        const hasDelta = isCounted && delta !== 0;

                        return (
                          <tr
                            key={item.id}
                            className={`transition-colors ${
                              hasDelta
                                ? 'bg-amber-500/5 hover:bg-amber-500/10'
                                : isReconciled
                                  ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                                  : 'hover:bg-slate-800/35'
                            }`}
                          >
                            <td className="px-5 py-3 text-xs font-medium text-blue-300">
                              {item.team}
                            </td>
                            <td className="px-5 py-3 font-medium text-white">
                              {item.model}
                            </td>
                            <td className="px-5 py-3 text-slate-300">
                              {normalizeVersionDisplay(item.version)}
                            </td>
                            <td className="px-5 py-3 font-mono-num font-semibold text-slate-200">
                              {item.size}
                            </td>
                            <td className="px-5 py-3 text-right font-mono-num font-bold text-white">
                              {item.stock} uds
                            </td>
                            <td className="px-5 py-3 text-right">
                              <label htmlFor={`audit-item-${item.id}`} className="sr-only">
                                Conteo físico para {item.model} talla {item.size}
                              </label>
                              <input
                                id={`audit-item-${item.id}`}
                                type="number"
                                min="0"
                                step="1"
                                disabled={isClosed}
                                placeholder={String(item.stock)}
                                value={raw}
                                onChange={(e) => handleCountChange(item.id, e.target.value)}
                                className={`font-mono-num min-h-[38px] w-24 rounded-lg border px-2.5 py-1 text-right text-sm font-semibold transition-colors focus:outline-none ${
                                  isClosed
                                    ? 'border-slate-800 bg-slate-900 text-slate-500'
                                    : hasDelta
                                      ? 'border-amber-500/50 bg-[#070D19] text-amber-200 focus:border-amber-500'
                                      : isReconciled
                                        ? 'border-emerald-500/50 bg-[#070D19] text-emerald-200 focus:border-emerald-500'
                                        : 'border-slate-700 bg-[#070D19] text-white focus:border-blue-500'
                                }`}
                              />
                            </td>
                            <td className="px-5 py-3 text-right font-mono-num font-bold">
                              {!isCounted ? (
                                <span className="text-slate-500 text-xs">Sin contar</span>
                              ) : delta === 0 ? (
                                <span className="text-emerald-400">0 ✓</span>
                              ) : delta > 0 ? (
                                <span className="text-emerald-300">+{delta} uds</span>
                              ) : (
                                <span className="text-red-400">{delta} uds</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {!isCounted ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                  <Clock className="h-3 w-3" /> Pendiente
                                </span>
                              ) : delta === 0 ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                                  <CheckCircle2 className="h-3 w-3" /> Conciliado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300">
                                  <AlertTriangle className="h-3 w-3" /> Con descuadre
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile view cards */}
                <div className="divide-y divide-slate-800/80 md:hidden">
                  {filteredItems.map((item) => {
                    const raw = counts[item.id] ?? '';
                    const isCounted = raw.trim() !== '';
                    const parsed = isCounted ? Math.floor(Number(raw)) : null;
                    const delta =
                      parsed !== null && Number.isFinite(parsed) ? parsed - item.stock : 0;

                    return (
                      <div key={item.id} className="p-4 space-y-2 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[11px] font-medium text-blue-300">
                              {item.team} · {normalizeVersionDisplay(item.version)}
                            </span>
                            <p className="font-semibold text-white text-sm">
                              {item.model}
                            </p>
                            <p className="text-slate-400 font-mono-num">
                              Talla <strong className="text-white">{item.size}</strong> · Stock en sistema:{' '}
                              <strong className="text-white">{item.stock} uds</strong>
                            </p>
                          </div>

                          <div className="text-right shrink-0 space-y-1">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              disabled={isClosed}
                              placeholder={String(item.stock)}
                              value={raw}
                              onChange={(e) => handleCountChange(item.id, e.target.value)}
                              className="font-mono-num min-h-[42px] w-24 rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1 text-right text-sm font-semibold text-white focus:border-blue-500 focus:outline-none"
                            />
                            <div>
                              {!isCounted ? (
                                <span className="text-[10px] text-slate-500">Sin contar</span>
                              ) : delta === 0 ? (
                                <span className="text-[11px] font-semibold text-emerald-400">
                                  0 ✓ Conciliado
                                </span>
                              ) : (
                                <span
                                  className={`text-[11px] font-bold ${
                                    delta > 0 ? 'text-amber-300' : 'text-red-400'
                                  }`}
                                >
                                  {delta > 0 ? `+${delta}` : delta} uds
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* MODAL DE CONFIRMACIÓN: CERRAR RECUENTO */}
      {showCloseModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in"
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0D1526] p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 id="close-modal-title" className="font-display text-lg font-bold text-white">
                  Cerrar y Finalizar Auditoría
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Esta acción bloqueará la edición de este recuento y calculará los 6 indicadores definitivos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Resumen de los 6 indicadores */}
            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-4 space-y-2 text-xs">
              <p className="font-semibold text-white">Resumen de Conciliación:</p>
              <div className="grid grid-cols-2 gap-2 font-mono-num">
                <span className="text-emerald-300">
                  Ítems conciliados: {metrics.reconciledItems} ({metrics.reconciledItemsPct.toFixed(1)}%)
                </span>
                <span className="text-emerald-300">
                  Unidades conciliadas: {metrics.reconciledUnits} ({metrics.reconciledUnitsPct.toFixed(1)}%)
                </span>
                <span className="text-amber-300">
                  Ítems no conciliados: {metrics.unreconciledItems} ({metrics.unreconciledItemsPct.toFixed(1)}%)
                </span>
                <span className="text-red-400">
                  Unidades no conciliadas: {metrics.unreconciledUnits} ({metrics.unreconciledUnitsPct.toFixed(1)}%)
                </span>
                <span className="text-slate-400">
                  Ítems no contados: {metrics.uncountedItems} ({metrics.uncountedItemsPct.toFixed(1)}%)
                </span>
                <span className="text-slate-400">
                  Unidades no contadas: {metrics.uncountedUnits} ({metrics.uncountedUnitsPct.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {isAdmin ? (
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyAdjustments}
                    onChange={(e) => setApplyAdjustments(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-700 bg-[#070D19] text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-slate-300">
                    <strong className="block text-white">Actualizar stock físico en inventario:</strong>
                    Aplica automáticamente los sobrantes y faltantes al inventario de Firebase con trazabilidad FIFO en mermas. Si se desmarca, el recuento solo se guardará como reporte de auditoría sin alterar el stock.
                  </span>
                </label>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <span>
                    El recuento se cerrará únicamente como reporte de auditoría sin alterar el stock del inventario (solo el Administrador Principal puede aplicar ajustes directos al inventario).
                  </span>
                </div>
              )}

              <div>
                <label htmlFor="close-reason-input" className="block text-xs font-medium text-slate-300">
                  Motivo / Observaciones del Cierre
                </label>
                <input
                  id="close-reason-input"
                  type="text"
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="Ej. Auditoría de fin de mes de bodega"
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="min-h-[42px] rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmClose}
                className="min-h-[42px] rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-500 active:scale-[0.99]"
              >
                Confirmar y Cerrar Conteo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
