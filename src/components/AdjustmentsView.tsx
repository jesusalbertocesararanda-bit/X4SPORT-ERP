import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ClipboardList,
  MinusCircle,
  PlusCircle,
  Search,
  Sparkles,
} from 'lucide-react';
import type {
  AppState,
  AuthorizedUser,
  InventoryAdjustmentType,
  InventoryItem,
} from '../types/erp';
import {
  formatUSD,
  normalizeVersionDisplay,
  previewFifoConsumption,
} from '../utils/finance';

interface AdjustmentsViewProps {
  state: AppState;
  currentUser?: AuthorizedUser | null;
  onRegisterAdjustment: (input: {
    adjustmentType: 'entrada' | 'salida' | 'descruce';
    skuId: string;
    quantity: number;
    reason: string;
    user?: string;
    targetSkuId?: string;
    unitCost?: number;
  }) => { ok: boolean; error?: string };
  onPerformUncross: (input: {
    sourceSkuId: string;
    targetSkuId: string;
    quantity: number;
    reason?: string;
    user?: string;
  }) => { ok: boolean; error?: string };
}

const REASON_PRESETS_ENTRADA = [
  'Error de ingreso',
  'Devolución de cliente no registrada',
  'Mercancía recuperada',
  'Ajuste de conteo físico',
  'Donación/Cortesía de proveedor',
];

const REASON_PRESETS_SALIDA = [
  'Daño / Prenda defectuosa',
  'Pérdida / Extravío',
  'Error de despacho',
  'Muestra promocional',
  'Merma de inventario',
];

const REASON_PRESETS_DESCRUCE = [
  'Descruce de tallas (conteo físico)',
  'Error de digitación en compra',
  'Confusión de modelo en despacho',
  'Corrección de etiqueta',
];

export function AdjustmentsView({
  state,
  currentUser,
  onRegisterAdjustment,
  onPerformUncross,
}: AdjustmentsViewProps) {
  const [activeTab, setActiveTab] = useState<'entrada' | 'salida' | 'descruce'>('entrada');
  
  // Single movement (entrada / salida)
  const [selectedSkuId, setSelectedSkuId] = useState<string>(
    state.inventory[0]?.id ?? '',
  );
  const [quantityInput, setQuantityInput] = useState<string>('1');
  const [unitCostInput, setUnitCostInput] = useState<string>('');
  const [reasonInput, setReasonInput] = useState<string>('');

  // Descruce movement
  const [sourceSkuId, setSourceSkuId] = useState<string>(
    state.inventory[0]?.id ?? '',
  );
  const [targetSkuId, setTargetSkuId] = useState<string>(
    state.inventory[1]?.id ?? state.inventory[0]?.id ?? '',
  );
  const [uncrossQtyInput, setUncrossQtyInput] = useState<string>('1');
  const [uncrossReasonInput, setUncrossReasonInput] = useState<string>('');

  // History filtering
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<
    'all' | InventoryAdjustmentType
  >('all');

  // Feedback banner
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const selectedItem: InventoryItem | undefined = useMemo(() => {
    return (
      state.inventory.find((i) => i.id === selectedSkuId) ??
      state.inventory[0]
    );
  }, [selectedSkuId, state.inventory]);

  const sourceItem: InventoryItem | undefined = useMemo(() => {
    return (
      state.inventory.find((i) => i.id === sourceSkuId) ??
      state.inventory[0]
    );
  }, [sourceSkuId, state.inventory]);

  const targetItem: InventoryItem | undefined = useMemo(() => {
    return (
      state.inventory.find((i) => i.id === targetSkuId) ??
      state.inventory[1] ??
      state.inventory[0]
    );
  }, [targetSkuId, state.inventory]);

  // FIFO loss preview for salida
  const fifoLossPreview = useMemo(() => {
    if (activeTab !== 'salida' || !selectedItem) return 0;
    const qty = Math.max(0, Math.floor(Number(quantityInput) || 0));
    if (qty <= 0 || qty > selectedItem.stock) return 0;
    return previewFifoConsumption(selectedItem, qty).totalCost;
  }, [activeTab, quantityInput, selectedItem]);

  // Handle single movement submit (entrada / salida)
  const handleSubmitSingleAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!selectedItem) {
      setFeedback({ type: 'error', text: 'Selecciona una franela / SKU de inventario.' });
      return;
    }

    const qty = Math.floor(Number(quantityInput));
    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback({ type: 'error', text: 'La cantidad debe ser un número entero mayor a 0.' });
      return;
    }

    if (activeTab === 'salida' && qty > selectedItem.stock) {
      setFeedback({
        type: 'error',
        text: `Stock insuficiente en bodega (${selectedItem.stock} uds) para registrar una salida de ${qty} uds.`,
      });
      return;
    }

    const cleanReason = reasonInput.trim();
    if (!cleanReason) {
      setFeedback({
        type: 'error',
        text: 'El motivo / razón del ajuste es obligatorio para fines de auditoría.',
      });
      return;
    }

    const parsedCost = unitCostInput.trim() !== '' ? Number(unitCostInput) : undefined;
    if (parsedCost !== undefined && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
      setFeedback({ type: 'error', text: 'El costo unitario ingresado no es válido.' });
      return;
    }

    const res = onRegisterAdjustment({
      adjustmentType: activeTab,
      skuId: selectedItem.id,
      quantity: qty,
      reason: cleanReason,
      user: currentUser?.name ?? 'Admin',
      unitCost: parsedCost,
    });

    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'Error al registrar el ajuste.' });
      return;
    }

    setFeedback({
      type: 'success',
      text: `Ajuste registrado exitosamente: ${
        activeTab === 'entrada' ? '+' : '-'
      }${qty} uds a ${selectedItem.model} (${selectedItem.version} · ${selectedItem.size}). Motivo: "${cleanReason}".`,
    });
    setQuantityInput('1');
    setReasonInput('');
    setUnitCostInput('');
  };

  // Handle descruce submit
  const handleSubmitDescruce = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!sourceItem || !targetItem) {
      setFeedback({ type: 'error', text: 'Selecciona tanto la franela de origen como la de destino.' });
      return;
    }

    if (sourceItem.id === targetItem.id) {
      setFeedback({
        type: 'error',
        text: 'La franela de origen y la de destino deben ser diferentes (distinta talla o modelo).',
      });
      return;
    }

    const qty = Math.floor(Number(uncrossQtyInput));
    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback({ type: 'error', text: 'La cantidad a descruzar debe ser un número entero mayor a 0.' });
      return;
    }

    if (qty > sourceItem.stock) {
      setFeedback({
        type: 'error',
        text: `Stock insuficiente en origen (${sourceItem.model} ${sourceItem.size}: ${sourceItem.stock} uds) para transferir ${qty} uds.`,
      });
      return;
    }

    const cleanReason = uncrossReasonInput.trim();
    if (!cleanReason) {
      setFeedback({
        type: 'error',
        text: 'El motivo / razón del descruce es obligatorio para fines de auditoría.',
      });
      return;
    }

    const res = onPerformUncross({
      sourceSkuId: sourceItem.id,
      targetSkuId: targetItem.id,
      quantity: qty,
      reason: cleanReason,
      user: currentUser?.name ?? 'Admin',
    });

    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'Error al descruzar la mercancía.' });
      return;
    }

    setFeedback({
      type: 'success',
      text: `Descruce completado exitosamente: Se movieron ${qty} uds de ${sourceItem.model} (${sourceItem.size}) a ${targetItem.model} (${targetItem.size}). Total en bodega intacto.`,
    });
    setUncrossQtyInput('1');
    setUncrossReasonInput('');
  };

  // Filtered adjustments history
  const adjustmentsHistory = state.inventoryAdjustments ?? [];
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return adjustmentsHistory.filter((adj) => {
      if (historyTypeFilter !== 'all') {
        const effectiveType = adj.adjustmentType ?? (adj.delta < 0 ? 'salida' : 'entrada');
        if (effectiveType !== historyTypeFilter) return false;
      }
      if (!q) return true;
      return (
        adj.modelLabel.toLowerCase().includes(q) ||
        adj.size.toLowerCase().includes(q) ||
        adj.reason.toLowerCase().includes(q) ||
        (adj.user && adj.user.toLowerCase().includes(q)) ||
        (adj.targetModelLabel && adj.targetModelLabel.toLowerCase().includes(q))
      );
    });
  }, [adjustmentsHistory, historySearch, historyTypeFilter]);

  // Statistics
  const historyStats = useMemo(() => {
    let entradasUnits = 0;
    let salidasUnits = 0;
    let descrucesUnits = 0;
    let totalFifoLoss = 0;

    for (const a of adjustmentsHistory) {
      const type = a.adjustmentType ?? (a.delta < 0 ? 'salida' : 'entrada');
      if (type === 'entrada') {
        entradasUnits += Math.max(0, a.delta);
      } else if (type === 'salida') {
        salidasUnits += Math.abs(a.delta);
        if (a.fifoLossCost) totalFifoLoss += a.fifoLossCost;
      } else if (type === 'descruce') {
        descrucesUnits += Math.abs(a.delta);
      }
    }

    return {
      totalRecords: adjustmentsHistory.length,
      entradasUnits,
      salidasUnits,
      descrucesUnits,
      totalFifoLoss,
    };
  }, [adjustmentsHistory]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Ajustes de Inventario
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Corrección manual de stock (Entradas, Salidas y Descruces atómicos de mercancía) con registro auditable y motivo obligatorio.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-300">
          <span className="rounded-lg border border-slate-800 bg-[#0D1526] px-3 py-1.5 font-mono-num font-semibold text-emerald-300">
            +{historyStats.entradasUnits} uds entradas
          </span>
          <span className="rounded-lg border border-slate-800 bg-[#0D1526] px-3 py-1.5 font-mono-num font-semibold text-red-300">
            -{historyStats.salidasUnits} uds salidas
          </span>
          <span className="rounded-lg border border-slate-800 bg-[#0D1526] px-3 py-1.5 font-mono-num font-semibold text-blue-300">
            ⇄ {historyStats.descrucesUnits} uds descruces
          </span>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-xl p-4 text-sm font-medium ${
            feedback.type === 'error'
              ? 'border border-red-500/40 bg-red-500/10 text-red-200'
              : 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
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

      {/* Movement Mode Selector & Form Card */}
      <section className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 sm:p-7 shadow-xl">
        <div className="border-b border-slate-800 pb-5">
          <div
            role="tablist"
            aria-label="Tipo de Ajuste de Inventario"
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'entrada'}
              onClick={() => {
                setActiveTab('entrada');
                setFeedback(null);
              }}
              className={`flex items-center justify-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                activeTab === 'entrada'
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 shadow-md ring-1 ring-emerald-500/30'
                  : 'border-slate-800 bg-[#070D19] text-slate-400 hover:border-slate-700 hover:text-white'
              }`}
            >
              <PlusCircle className="h-4 w-4 text-emerald-400" />
              <span>Entrada Manual (+)</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'salida'}
              onClick={() => {
                setActiveTab('salida');
                setFeedback(null);
              }}
              className={`flex items-center justify-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                activeTab === 'salida'
                  ? 'border-red-500/60 bg-red-500/15 text-red-200 shadow-md ring-1 ring-red-500/30'
                  : 'border-slate-800 bg-[#070D19] text-slate-400 hover:border-slate-700 hover:text-white'
              }`}
            >
              <MinusCircle className="h-4 w-4 text-red-400" />
              <span>Salida Manual (-)</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'descruce'}
              onClick={() => {
                setActiveTab('descruce');
                setFeedback(null);
              }}
              className={`flex items-center justify-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                activeTab === 'descruce'
                  ? 'border-blue-500/60 bg-blue-500/15 text-blue-200 shadow-md ring-1 ring-blue-500/30'
                  : 'border-slate-800 bg-[#070D19] text-slate-400 hover:border-slate-700 hover:text-white'
              }`}
            >
              <ArrowLeftRight className="h-4 w-4 text-blue-400" />
              <span>Descruce de Mercancía (⇄)</span>
            </button>
          </div>
        </div>

        {/* FORMS */}
        {activeTab === 'descruce' ? (
          /* FORMULARIO DE DESCRUCE DE MERCANCÍA */
          <form onSubmit={handleSubmitDescruce} className="mt-6 space-y-6">
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs text-blue-200 flex items-start gap-3">
              <Sparkles className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <p>
                El <strong>Descruce de Mercancía</strong> transfiere unidades atómicamente de un modelo/talla a otro (ej. -1 en L y +1 en M), manteniendo intacto el conteo total de bodega y preservando el costo promedio FIFO de reposición.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {/* Origen */}
              <div className="space-y-2 rounded-xl border border-slate-800 bg-[#080E1C] p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="uncross-source" className="text-xs font-semibold text-red-300">
                    Franela de Origen (Resta -) *
                  </label>
                  {sourceItem && (
                    <span className="font-mono-num text-xs font-bold text-slate-300">
                      Stock: {sourceItem.stock} uds
                    </span>
                  )}
                </div>
                <select
                  id="uncross-source"
                  value={sourceSkuId}
                  onChange={(e) => setSourceSkuId(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  {state.inventory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.team} · {item.model} ({normalizeVersionDisplay(item.version)} · Talla {item.size}) — {item.stock} uds
                    </option>
                  ))}
                </select>
                {sourceItem && (
                  <p className="text-[11px] text-slate-400">
                    Costo FIFO actual: <span className="text-slate-200">{formatUSD(sourceItem.cogs)}</span>
                  </p>
                )}
              </div>

              {/* Destino */}
              <div className="space-y-2 rounded-xl border border-slate-800 bg-[#080E1C] p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="uncross-target" className="text-xs font-semibold text-emerald-300">
                    Franela de Destino (Suma +) *
                  </label>
                  {targetItem && (
                    <span className="font-mono-num text-xs font-bold text-slate-300">
                      Stock: {targetItem.stock} uds
                    </span>
                  )}
                </div>
                <select
                  id="uncross-target"
                  value={targetSkuId}
                  onChange={(e) => setTargetSkuId(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  {state.inventory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.team} · {item.model} ({normalizeVersionDisplay(item.version)} · Talla {item.size}) — {item.stock} uds
                    </option>
                  ))}
                </select>
                {targetItem && (
                  <p className="text-[11px] text-slate-400">
                    PVP actual: <span className="text-emerald-300">{formatUSD(targetItem.salePrice)}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <div>
                <label htmlFor="uncross-qty" className="block text-xs font-medium text-slate-300">
                  Cantidad a Transferir (Unidades) *
                </label>
                <input
                  id="uncross-qty"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={uncrossQtyInput}
                  onChange={(e) => setUncrossQtyInput(e.target.value)}
                  className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="uncross-reason" className="block text-xs font-medium text-slate-300">
                  Motivo del Descruce (Obligatorio) *
                </label>
                <input
                  id="uncross-reason"
                  type="text"
                  required
                  placeholder="Ej. Descruce de tallas detectado en conteo físico"
                  value={uncrossReasonInput}
                  onChange={(e) => setUncrossReasonInput(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {REASON_PRESETS_DESCRUCE.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setUncrossReasonInput(preset)}
                      className="rounded-md border border-slate-800 bg-[#080E1C] px-2.5 py-1 text-[11px] text-slate-400 hover:border-slate-700 hover:text-white transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Impact Preview */}
            {sourceItem && targetItem && (
              <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-4 text-xs space-y-1.5">
                <p className="font-semibold text-slate-300">Previsualización del Descruce:</p>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-slate-400">
                  <span>
                    Resta <strong className="font-mono-num text-red-400">-{uncrossQtyInput || 0} uds</strong> de{' '}
                    <span className="text-white">{sourceItem.model} ({sourceItem.version} · {sourceItem.size})</span>: {sourceItem.stock} → {Math.max(0, sourceItem.stock - (Number(uncrossQtyInput) || 0))} uds
                  </span>
                  <span className="hidden sm:inline text-slate-600">→</span>
                  <span>
                    Suma <strong className="font-mono-num text-emerald-400">+{uncrossQtyInput || 0} uds</strong> a{' '}
                    <span className="text-white">{targetItem.model} ({targetItem.version} · {targetItem.size})</span>: {targetItem.stock} → {targetItem.stock + (Number(uncrossQtyInput) || 0)} uds
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <ArrowLeftRight className="h-4 w-4" />
                Ejecutar Descruce Atómico
              </button>
            </div>
          </form>
        ) : (
          /* FORMULARIO DE ENTRADA O SALIDA MANUAL */
          <form onSubmit={handleSubmitSingleAdjustment} className="mt-6 space-y-6">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <label htmlFor="single-sku" className="block text-xs font-medium text-slate-300">
                  Seleccionar Franela / SKU *
                </label>
                <select
                  id="single-sku"
                  value={selectedSkuId}
                  onChange={(e) => setSelectedSkuId(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  {state.inventory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.team} · {item.model} ({normalizeVersionDisplay(item.version)} · Talla {item.size}) — Stock actual: {item.stock} uds
                    </option>
                  ))}
                </select>
                {selectedItem && (
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Stock actual: <strong className="font-mono-num text-white">{selectedItem.stock} uds</strong>
                    </span>
                    <span>
                      Costo FIFO unitario: <strong className="font-mono-num text-blue-300">{formatUSD(selectedItem.cogs)}</strong>
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="single-qty" className="block text-xs font-medium text-slate-300">
                    Cantidad a {activeTab === 'entrada' ? 'Ingresar (+)' : 'Retirar (-)'} *
                  </label>
                  <input
                    id="single-qty"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(e.target.value)}
                    className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  />
                  {activeTab === 'salida' && selectedItem && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Nuevo stock:{' '}
                      <span className="font-mono-num font-semibold text-white">
                        {Math.max(0, selectedItem.stock - (Number(quantityInput) || 0))} uds
                      </span>
                    </p>
                  )}
                  {activeTab === 'entrada' && selectedItem && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Nuevo stock:{' '}
                      <span className="font-mono-num font-semibold text-white">
                        {selectedItem.stock + (Number(quantityInput) || 0)} uds
                      </span>
                    </p>
                  )}
                </div>

                {activeTab === 'entrada' ? (
                  <div>
                    <label htmlFor="single-cost" className="block text-xs font-medium text-slate-300">
                      Costo Unitario ($) (Opcional)
                    </label>
                    <input
                      id="single-cost"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={selectedItem ? String(selectedItem.cogs) : 'Ej. 20.00'}
                      value={unitCostInput}
                      onChange={(e) => setUnitCostInput(e.target.value)}
                      className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Si se omite, usa el costo FIFO base ({selectedItem ? formatUSD(selectedItem.cogs) : '$0.00'}).
                    </p>
                  </div>
                ) : (
                  <div>
                    <span className="block text-xs font-medium text-slate-300">
                      Impacto Merma FIFO
                    </span>
                    <div className="mt-1.5 min-h-[44px] rounded-lg border border-slate-800 bg-[#080E1C] px-3 py-2 flex items-center justify-between text-xs">
                      <span className="text-slate-400">Valor consumido:</span>
                      <span className="font-mono-num font-bold text-red-400">
                        {formatUSD(fifoLossPreview)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Descuenta lotes antiguos en orden FIFO.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="single-reason" className="block text-xs font-medium text-slate-300">
                Motivo / Razón del Ajuste (Obligatorio) *
              </label>
              <input
                id="single-reason"
                type="text"
                required
                placeholder={
                  activeTab === 'entrada'
                    ? 'Ej. Error de ingreso en lote anterior / Franela adicional'
                    : 'Ej. Daño de fábrica detectado / Prenda manchada'
                }
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(activeTab === 'entrada'
                  ? REASON_PRESETS_ENTRADA
                  : REASON_PRESETS_SALIDA
                ).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setReasonInput(preset)}
                    className="rounded-md border border-slate-800 bg-[#080E1C] px-2.5 py-1 text-[11px] text-slate-400 hover:border-slate-700 hover:text-white transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 ${
                  activeTab === 'entrada'
                    ? 'bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-400'
                    : 'bg-red-600 hover:bg-red-500 focus-visible:ring-red-400'
                }`}
              >
                {activeTab === 'entrada' ? (
                  <>
                    <PlusCircle className="h-4 w-4" />
                    Registrar Entrada Manual (+)
                  </>
                ) : (
                  <>
                    <MinusCircle className="h-4 w-4" />
                    Registrar Salida Manual (-)
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Historial Completo y Auditable de Ajustes */}
      <section className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 sm:p-7 shadow-xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="h-5 w-5 text-blue-400" />
            <h2 className="font-display text-lg font-bold text-white">
              Historial de Ajustes Realizados
            </h2>
            <span className="font-mono-num rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
              {filteredHistory.length} de {adjustmentsHistory.length}
            </span>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setHistoryTypeFilter('all')}
              className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                historyTypeFilter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#080E1C] text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setHistoryTypeFilter('entrada')}
              className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                historyTypeFilter === 'entrada'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#080E1C] text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              Entradas (+)
            </button>
            <button
              type="button"
              onClick={() => setHistoryTypeFilter('salida')}
              className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                historyTypeFilter === 'salida'
                  ? 'bg-red-600 text-white'
                  : 'bg-[#080E1C] text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              Salidas (-)
            </button>
            <button
              type="button"
              onClick={() => setHistoryTypeFilter('descruce')}
              className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                historyTypeFilter === 'descruce'
                  ? 'bg-blue-500 text-white'
                  : 'bg-[#080E1C] text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              Descruces (⇄)
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
            placeholder="Buscar en bitácora por modelo, talla, motivo o usuario..."
            className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#070D19] pl-10 pr-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Table / List */}
        {filteredHistory.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-[#080E1C] p-8 text-center text-sm text-slate-400">
            {adjustmentsHistory.length === 0
              ? 'No hay registros de ajustes en la bitácora todavía.'
              : 'No se encontraron ajustes con los filtros seleccionados.'}
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 bg-[#080E1C] text-xs font-medium text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Fecha</th>
                    <th scope="col" className="px-4 py-3">Tipo</th>
                    <th scope="col" className="px-4 py-3">Modelo / Talla</th>
                    <th scope="col" className="px-4 py-3 text-right">Variación</th>
                    <th scope="col" className="px-4 py-3 text-right">Stock</th>
                    <th scope="col" className="px-4 py-3">Motivo</th>
                    <th scope="col" className="px-4 py-3">Responsable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredHistory.map((adj) => {
                    const type = adj.adjustmentType ?? (adj.delta < 0 ? 'salida' : 'entrada');
                    return (
                      <tr key={adj.id} className="hover:bg-slate-800/35 transition-colors">
                        <td className="px-4 py-3 font-mono-num text-xs text-slate-300 whitespace-nowrap">
                          {new Date(adj.createdAt).toLocaleString('es-VE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {type === 'entrada' ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                              <PlusCircle className="h-3 w-3" /> Entrada
                            </span>
                          ) : type === 'salida' ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                              <MinusCircle className="h-3 w-3" /> Salida
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-300">
                              <ArrowLeftRight className="h-3 w-3" /> Descruce
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">{adj.modelLabel}</p>
                          <p className="text-xs text-slate-400">
                            {adj.version} · Talla {adj.size}
                            {adj.targetModelLabel && (
                              <span className="text-blue-300 ml-1">
                                → {adj.targetModelLabel} ({adj.targetVersion ?? adj.version} · {adj.targetSize})
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num font-bold whitespace-nowrap">
                          <span
                            className={
                              type === 'entrada'
                                ? 'text-emerald-400'
                                : type === 'salida'
                                  ? 'text-red-400'
                                  : 'text-blue-300'
                            }
                          >
                            {adj.delta > 0 ? `+${adj.delta}` : adj.delta} uds
                          </span>
                          {adj.fifoLossCost !== undefined && adj.fifoLossCost > 0 && (
                            <span className="block text-[10px] text-red-300">
                              Merma: {formatUSD(adj.fifoLossCost)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num text-xs text-slate-300 whitespace-nowrap">
                          {adj.previousStock} → {adj.newStock}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {adj.reason}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                          {adj.user || 'Admin'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="divide-y divide-slate-800/80 md:hidden">
              {filteredHistory.map((adj) => {
                const type = adj.adjustmentType ?? (adj.delta < 0 ? 'salida' : 'entrada');
                return (
                  <div key={adj.id} className="py-3.5 space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          {type === 'entrada' ? (
                            <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                              + Entrada
                            </span>
                          ) : type === 'salida' ? (
                            <span className="rounded border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                              - Salida
                            </span>
                          ) : (
                            <span className="rounded border border-blue-500/40 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                              ⇄ Descruce
                            </span>
                          )}
                          <span className="text-slate-400 font-mono-num text-[11px]">
                            {new Date(adj.createdAt).toLocaleDateString('es-VE')}
                          </span>
                        </div>
                        <p className="mt-1 font-semibold text-white">
                          {adj.modelLabel} ({adj.version} · {adj.size})
                        </p>
                        {adj.targetModelLabel && (
                          <p className="text-blue-300">
                            → {adj.targetModelLabel} ({adj.targetSize})
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span
                          className={`font-mono-num text-sm font-bold ${
                            type === 'entrada'
                              ? 'text-emerald-400'
                              : type === 'salida'
                                ? 'text-red-400'
                                : 'text-blue-300'
                          }`}
                        >
                          {adj.delta > 0 ? `+${adj.delta}` : adj.delta} uds
                        </span>
                        <p className="font-mono-num text-[11px] text-slate-400">
                          {adj.previousStock} → {adj.newStock}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-slate-400 border-t border-slate-800/60 pt-1.5">
                      <span className="truncate">{adj.reason}</span>
                      <span className="shrink-0 text-slate-500">{adj.user || 'Admin'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
