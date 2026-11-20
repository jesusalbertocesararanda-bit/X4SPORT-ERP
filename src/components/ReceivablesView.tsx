import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
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
  const overdueCount = enrichedReceivables.filter((e) => e.isOverdue).length;

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
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Cuentas por Cobrar (CxC)
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Control de clientes con saldo pendiente, días transcurridos, historial de abonos parciales y liquidación directa a caja.
        </p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
          <span className="text-xs text-slate-400">Cartera Pendiente Total</span>
          <p
            data-testid="cxc-total-pending"
            className="font-mono-num mt-1 text-2xl font-bold text-amber-400"
          >
            {formatUSD(totalReceivables)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
          <span className="text-xs text-slate-400">Deudores Activos</span>
          <p className="font-mono-num mt-1 text-2xl font-bold text-white">
            {state.receivables.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
          <span className="text-xs text-slate-400">
            Vencidas (&ge;{receivableOverdueDays}d)
          </span>
          <p
            className={`font-mono-num mt-1 text-2xl font-bold ${
              overdueCount > 0 ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {overdueCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
          <span className="text-xs text-slate-400">Cuentas Liquidadas</span>
          <p className="font-mono-num mt-1 text-2xl font-bold text-emerald-400">
            {state.collectedReceivablesCount}
          </p>
        </div>
      </div>

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

      {/* Filtros + Método de Cobro */}
      <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center flex-1">
            <div className="relative flex-1 sm:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                data-testid="cxc-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar deudor, factura o monto..."
                className="w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#070D19] pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar cuentas">
              {(
                [
                  { id: 'todas', label: 'Todas' },
                  { id: 'vencidas', label: `Vencidas (≥${receivableOverdueDays}d)` },
                  { id: 'parciales', label: 'Con Abonos' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStatusFilter(opt.id)}
                  aria-pressed={statusFilter === opt.id}
                  className={`min-h-[36px] rounded-lg border px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    statusFilter === opt.id
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-slate-700 bg-[#080E1C] text-slate-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label
              htmlFor="cxc-payment-method"
              className="text-xs font-medium text-slate-300 whitespace-nowrap"
            >
              Método de cobro:
            </label>
            <select
              id="cxc-payment-method"
              data-testid="cxc-payment-method"
              value={collectionMethod}
              onChange={(e) =>
                setCollectionMethod(e.target.value as SinglePaymentMethod)
              }
              className="min-h-[40px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm} value={pm}>
                  {pm}
                </option>
              ))}
            </select>
          </div>
        </div>

        {state.receivables.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-[#080E1C] p-8 text-center">
            <Wallet
              className="mx-auto h-7 w-7 text-emerald-400"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm font-semibold text-white">
              Sin cuentas por cobrar pendientes
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Todas las ventas a crédito han sido liquidadas a caja.
            </p>
          </div>
        ) : filteredReceivables.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-[#080E1C] p-6 text-center text-sm text-slate-400">
            No se encontraron cuentas que coincidan con el filtro aplicado.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filteredReceivables.map(
              ({ rec, elapsedDays, originalAmount, paidSoFar, isOverdue }) => {
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
                    className="py-4 space-y-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h3 className="text-base font-semibold text-white">
                            {rec.debtor}
                          </h3>
                          <span
                            className={`inline-flex items-center gap-1 font-mono-num text-xs font-semibold ${
                              isOverdue ? 'text-red-400' : 'text-slate-400'
                            }`}
                          >
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            {elapsedDays} {elapsedDays === 1 ? 'día' : 'días'}
                          </span>
                          {paidSoFar > 0 && (
                            <span className="font-mono-num text-xs font-medium text-blue-300">
                              Abonado {formatUSD(paidSoFar)} de{' '}
                              {formatUSD(originalAmount)}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-400">
                          {rec.note || 'Cuenta por cobrar'} · Creada el{' '}
                          {new Date(rec.createdAt).toLocaleDateString('es-VE', {
                            dateStyle: 'medium',
                          })}
                          {collectionMethod === 'Pago Móvil / Bs' && (
                            <span className="font-mono-num text-blue-300">
                              {' '}
                              · {formatVES(rec.amount * state.exchangeRates.bcv)}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        <div className="text-right mr-1">
                          <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                            Pendiente
                          </span>
                          <span
                            data-testid={`cxc-amount-${rec.id}`}
                            className="font-mono-num text-lg font-bold text-amber-300"
                          >
                            {formatUSD(rec.amount)}
                          </span>
                        </div>

                        <button
                          type="button"
                          data-testid={`btn-abono-${rec.id}`}
                          disabled={isBusy}
                          onClick={() => handleOpenAbono(rec)}
                          className="min-h-[40px] rounded-lg border border-blue-500/40 bg-blue-600/15 px-3 py-1.5 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-600/25 hover:text-white whitespace-nowrap shrink-0"
                        >
                          {isAbonoOpen ? 'Cancelar' : 'Registrar Abono'}
                        </button>

                        <button
                          type="button"
                          data-testid={`btn-liquidar-${rec.id}`}
                          disabled={isBusy}
                          onClick={() => void handleProcessCollection(rec)}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap shrink-0"
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
                          Liquidar Total
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
                        className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-[#080E1C] p-3.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          <label
                            htmlFor={`abono-input-${rec.id}`}
                            className="text-xs font-medium text-slate-300"
                          >
                            Monto del abono (USDT):
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
                            className="font-mono-num min-h-[40px] w-32 rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          {previewRemaining !== null && (
                            <span
                              data-testid={`abono-remaining-preview-${rec.id}`}
                              className="font-mono-num text-xs text-slate-300"
                            >
                              Resta después del abono:{' '}
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
                          className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60 whitespace-nowrap shrink-0"
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
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronDown
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          )}
                          Historial de abonos ({rec.installments!.length})
                        </button>

                        {isExpanded && (
                          <ul className="mt-2 space-y-1 rounded-lg border border-slate-800 bg-[#080E1C] p-3 text-xs text-slate-300">
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
