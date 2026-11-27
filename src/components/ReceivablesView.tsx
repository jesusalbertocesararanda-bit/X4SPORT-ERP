import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  Wallet,
} from 'lucide-react';
import type {
  AppState,
  PaymentMethod,
  ReceivableItem,
  SinglePaymentMethod,
} from '../types/erp';
import {
  formatUSD,
  formatVES,
  getTotalReceivables,
  round2,
} from '../utils/finance';

interface ReceivablesViewProps {
  state: AppState;
  receivableOverdueDays?: number;
  onCollectReceivable: (
    receivableId: string,
    paymentMethod: PaymentMethod,
    amountPaid?: number,
    clientOperationId?: string,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
}

const PAYMENT_METHODS: SinglePaymentMethod[] = [
  'Efectivo ($)',
  'Binance USDT',
  'Zelle',
  'Pago Móvil / Bs',
];

function computeElapsedDays(createdAt: string): number {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdMs) / 86_400_000));
}

function createCollectOpId(recId: string): string {
  return `cxc-${recId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ReceivablesView({
  state,
  receivableOverdueDays = 30,
  onCollectReceivable,
}: ReceivablesViewProps) {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<
    'todas' | 'vencidas' | 'parciales'
  >('todas');
  const [collectionMethod, setCollectionMethod] =
    useState<SinglePaymentMethod>('Efectivo ($)');
  const [abonoTargetId, setAbonoTargetId] = useState<string | null>(null);
  const [abonoAmountInput, setAbonoAmountInput] = useState<string>('');
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<
    Record<string, boolean>
  >({});
  const [isSubmittingId, setIsSubmittingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const enrichedReceivables = useMemo(() => {
    return (state.receivables ?? []).map((rec) => {
      const elapsedDays = computeElapsedDays(rec.createdAt);
      const originalAmount = round2(
        rec.originalAmount ?? rec.amount + (rec.paidAmount ?? 0),
      );
      const paidSoFar = round2(
        rec.paidAmount ?? Math.max(0, originalAmount - rec.amount),
      );
      const isOverdue = elapsedDays >= receivableOverdueDays;
      return {
        rec,
        elapsedDays,
        originalAmount,
        paidSoFar,
        isOverdue,
      };
    });
  }, [receivableOverdueDays, state.receivables]);

  const filteredReceivables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedReceivables.filter(({ rec, paidSoFar, isOverdue }) => {
      if (statusFilter === 'vencidas' && !isOverdue) return false;
      if (statusFilter === 'parciales' && paidSoFar <= 0) return false;
      if (!q) return true;
      return (
        rec.debtor.toLowerCase().includes(q) ||
        (rec.note ?? '').toLowerCase().includes(q) ||
        rec.amount.toFixed(2).includes(q)
      );
    });
  }, [enrichedReceivables, searchQuery, statusFilter]);

  const totalReceivables = getTotalReceivables(state);

  const toggleHistory = (id: string) => {
    setExpandedHistoryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenAbono = (rec: ReceivableItem) => {
    if (abonoTargetId === rec.id) {
      setAbonoTargetId(null);
      setAbonoAmountInput('');
      return;
    }
    setAbonoTargetId(rec.id);
    setAbonoAmountInput('');
    setFeedback(null);
  };

  const handleProcessCollection = async (
    rec: ReceivableItem,
    partialAmount?: number,
  ) => {
    if (isSubmittingId) return;
    setFeedback(null);

    const opId = createCollectOpId(rec.id);
    setIsSubmittingId(rec.id);
    try {
      const res = await Promise.resolve(
        onCollectReceivable(rec.id, collectionMethod, partialAmount, opId),
      );
      if (!res.ok) {
        setFeedback({
          type: 'error',
          text: res.error ?? 'No se pudo procesar el cobro.',
        });
        return;
      }

      const paidNow =
        partialAmount !== undefined ? round2(partialAmount) : round2(rec.amount);
      const remaining = round2(Math.max(0, rec.amount - paidNow));
      setAbonoTargetId(null);
      setAbonoAmountInput('');

      if (remaining > 0.009) {
        setFeedback({
          type: 'success',
          text: `Abono de ${formatUSD(paidNow)} recibido de ${rec.debtor} vía ${collectionMethod} y sumado a caja. Saldo restante: ${formatUSD(remaining)}.`,
        });
      } else {
        setFeedback({
          type: 'success',
          text: `Cuenta de ${rec.debtor} liquidada por completo (${formatUSD(paidNow)} vía ${collectionMethod}) y sumada a caja.`,
        });
      }
    } finally {
      setIsSubmittingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          role="status"
          data-testid="cxc-feedback"
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border border-red-500/30 bg-red-500/10 text-red-300'
              : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {feedback.type === 'success' && (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      <section
        aria-labelledby="receivables-heading"
        className="rounded-xl border border-slate-800 bg-[#0D1526] p-4 sm:p-6 space-y-4"
      >
        {/* 1. Encabezado compacto con total general arriba */}
        <div>
          <h1
            id="receivables-heading"
            className="font-display text-lg font-semibold text-white sm:text-xl"
          >
            Cuentas por Cobrar Pendientes
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Selecciona el método de cobro; el monto se suma automáticamente a caja.
          </p>
          <p
            data-testid="cxc-total-pending"
            className="mt-2 font-mono-num text-2xl sm:text-3xl font-bold text-amber-400"
          >
            {formatUSD(totalReceivables)}
          </p>
        </div>

        {/* 2. Selector de método de cobro + buscador compacto + filtros discretos */}
        <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3.5">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 shrink-0">
              <label
                htmlFor="cxc-payment-method"
                className="text-xs font-medium text-slate-300 whitespace-nowrap"
              >
                Método de cobro recibido:
              </label>
              <select
                id="cxc-payment-method"
                data-testid="cxc-payment-method"
                value={collectionMethod}
                onChange={(e) =>
                  setCollectionMethod(e.target.value as SinglePaymentMethod)
                }
                className="min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 flex-1 lg:justify-end">
              <div className="relative flex-1 min-w-[180px] sm:max-w-xs">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  data-testid="cxc-search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar cliente o #factura..."
                  className="w-full min-h-[36px] rounded-lg border border-slate-700 bg-[#070D19] pl-8 pr-2.5 py-1 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div
                className="flex items-center gap-1 shrink-0"
                role="group"
                aria-label="Filtrar cuentas"
              >
                {(
                  [
                    { id: 'todas', label: 'Todas' },
                    { id: 'parciales', label: 'Con abonos' },
                    { id: 'vencidas', label: `> ${receivableOverdueDays} días` },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStatusFilter(opt.id)}
                    aria-pressed={statusFilter === opt.id}
                    className={`min-h-[36px] rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      statusFilter === opt.id
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-700 bg-[#070D19] text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Lista en filas horizontales compactas */}
        {state.receivables.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-[#080E1C] p-6 text-center">
            <Wallet
              className="mx-auto h-6 w-6 text-emerald-400"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm font-medium text-emerald-400">
              Sin cuentas pendientes
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Todas las cuentas por cobrar han sido liquidadas a caja.
            </p>
          </div>
        ) : filteredReceivables.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-[#080E1C] p-5 text-center text-xs text-slate-400">
            No se encontraron cuentas que coincidan con el filtro aplicado.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filteredReceivables.map(
              ({ rec, elapsedDays, paidSoFar, isOverdue }) => {
                const isAbonoOpen = abonoTargetId === rec.id;
                const isExpanded = Boolean(expandedHistoryIds[rec.id]);
                const isBusy = isSubmittingId === rec.id;
                const parsedAbono = round2(Number(abonoAmountInput) || 0);
                const previewRemaining =
                  parsedAbono > 0 && parsedAbono <= rec.amount
                    ? round2(Math.max(0, rec.amount - parsedAbono))
                    : null;

                return (
                  <article
                    key={rec.id}
                    data-testid={`cxc-row-${rec.id}`}
                    className="py-2.5 sm:py-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 sm:gap-3">
                      {/* Izquierda */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">
                          {rec.debtor}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {rec.note || 'Cuenta por cobrar'} ·{' '}
                          <span className={isOverdue ? 'font-semibold text-red-400' : ''}>
                            {elapsedDays}d
                          </span>
                          {paidSoFar > 0 && (
                            <span className="text-blue-300">
                              {' '}
                              · Abonado {formatUSD(paidSoFar)}
                            </span>
                          )}
                          {collectionMethod === 'Pago Móvil / Bs' && (
                            <span className="font-mono-num text-blue-300">
                              {' '}
                              · {formatVES(rec.amount * state.exchangeRates.bcv)}
                            </span>
                          )}
                        </p>
                      </div>

                      {/* Centro */}
                      <span
                        data-testid={`cxc-amount-${rec.id}`}
                        className="shrink-0 font-mono-num text-sm font-bold text-white"
                      >
                        {formatUSD(rec.amount)}
                      </span>

                      {/* Derecha */}
                      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                        <button
                          type="button"
                          data-testid={`btn-abono-${rec.id}`}
                          disabled={isBusy}
                          onClick={() => handleOpenAbono(rec)}
                          className="min-h-[36px] rounded-lg border border-slate-700 bg-[#080E1C] px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap"
                        >
                          {isAbonoOpen ? 'Cerrar' : 'Abonar'}
                        </button>

                        <button
                          type="button"
                          data-testid={`btn-liquidar-${rec.id}`}
                          disabled={isBusy}
                          onClick={() => void handleProcessCollection(rec)}
                          aria-label={`Cobrar total ${formatUSD(rec.amount)} a ${rec.debtor}`}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap"
                        >
                          {isBusy ? (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <ArrowDownLeft
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          )}
                          Cobrar
                        </button>
                      </div>
                    </div>

                    {isAbonoOpen && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleProcessCollection(
                            rec,
                            Number(abonoAmountInput),
                          );
                        }}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#080E1C] p-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <label
                            htmlFor={`abono-input-${rec.id}`}
                            className="text-xs text-slate-300"
                          >
                            Monto del abono ($):
                          </label>
                          <input
                            id={`abono-input-${rec.id}`}
                            data-testid={`abono-input-${rec.id}`}
                            type="number"
                            min="0.01"
                            max={rec.amount}
                            step="0.01"
                            required
                            placeholder={(rec.amount / 2).toFixed(2)}
                            value={abonoAmountInput}
                            onChange={(e) =>
                              setAbonoAmountInput(e.target.value)
                            }
                            className="font-mono-num min-h-[36px] w-28 rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          {previewRemaining !== null && (
                            <span
                              data-testid={`abono-remaining-preview-${rec.id}`}
                              className="font-mono-num text-xs text-slate-300"
                            >
                              Resta:{' '}
                              <strong className="text-white">
                                {formatUSD(previewRemaining)}
                              </strong>
                            </span>
                          )}
                        </div>

                        <button
                          type="submit"
                          data-testid={`btn-confirm-abono-${rec.id}`}
                          disabled={isBusy}
                          className="min-h-[36px] rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60 whitespace-nowrap"
                        >
                          Confirmar Abono
                        </button>
                      </form>
                    )}

                    {(rec.installments?.length ?? 0) > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => toggleHistory(rec.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-300 hover:text-blue-200"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ChevronDown
                              className="h-3 w-3"
                              aria-hidden="true"
                            />
                          )}
                          Historial de abonos ({rec.installments!.length})
                        </button>

                        {isExpanded && (
                          <ul className="mt-1.5 space-y-1 rounded-lg border border-slate-800 bg-[#080E1C] p-2.5 text-xs text-slate-300">
                            {rec.installments!.map((inst) => (
                              <li
                                key={inst.id}
                                className="flex items-center justify-between gap-2"
                              >
                                <span>
                                  {new Date(inst.createdAt).toLocaleString(
                                    'es-VE',
                                    {
                                      dateStyle: 'short',
                                      timeStyle: 'short',
                                    },
                                  )}{' '}
                                  · {inst.paymentMethod}
                                </span>
                                <span className="font-mono-num font-semibold text-emerald-400">
                                  +{formatUSD(inst.amount)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </article>
                );
              },
            )}
          </div>
        )}
      </section>
    </div>
  );
}
