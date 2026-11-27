import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  Download,
  Landmark,
  Lock,
  Plane,
  PlusCircle,
  Receipt,
  RefreshCcw,
  Scale,
  Ship,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';
import { PARTNER_SHARES } from '../data/initialState';
import type {
  AppState,
  CapitalInjectionDestination,
  ExpenseCategory,
  ExpenseSource,
  MatrixConfigParams,
  PartnerName,
  PaymentMethod,
  SinglePaymentMethod,
} from '../types/erp';
import { isAdminUser, type ERPUser } from '../utils/auth';
import type {
  ReconcileCashInput,
  RegisterCapitalInjectionInput,
  RegisterOperatingExpenseInput,
} from '../utils/finance';
import {
  DEFAULT_GENERAL_CONFIG,
  detectExpenseCategoryFromDescription,
  EXPENSE_CATEGORIES,
  formatUSD,
  formatUSDT,
  formatVES,
  getCashBackedFundsSummary,
  getTotalReceivables,
  MAX_RECENT_MOVEMENTS,
  normalizeExpenseCategory,
  round2,
} from '../utils/finance';

interface FinanceViewProps {
  state: AppState;
  currentUser?: ERPUser | null;
  activeSection?: 'matriz' | 'gastos' | 'socios' | 'capital' | 'caja' | 'cxc';
  matrixParams?: MatrixConfigParams;
  onOpenReceivables?: () => void;
  onCollectReceivable: (
    receivableId: string,
    paymentMethod: PaymentMethod,
    amountPaid?: number,
    clientOperationId?: string,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onReinvestDividends: (
    partner: PartnerName,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onWithdrawDividends?: (
    partner: PartnerName,
    amount?: number,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onSyncFreeCashToFunds?: () =>
    | Promise<{ ok: boolean; error?: string }>
    | { ok: boolean; error?: string };
  onRegisterOperatingExpense: (
    input: RegisterOperatingExpenseInput,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onRegisterCapitalInjection: (
    input: RegisterCapitalInjectionInput,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onReconcileCash: (
    input: ReconcileCashInput,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onResetDemoData: () => void;
}

const PARTNERS: PartnerName[] = ['Jesús', 'Josué', 'Gabriel'];
const PAYMENT_METHODS: SinglePaymentMethod[] = [
  'Efectivo ($)',
  'Binance USDT',
  'Zelle',
  'Pago Móvil / Bs',
];
const CONTRIBUTOR_PRESETS = ['Jesús', 'Josué', 'Gabriel', 'Capital Externo'];

const PETTY_CASH_QUICK_PRESETS: Array<{
  label: string;
  concept: string;
  category: ExpenseCategory;
  source: ExpenseSource;
}> = [
  {
    label: 'Delivery local',
    concept: 'Delivery local de pedido',
    category: 'Logística/Producción',
    source: 'operatingFund',
  },
  {
    label: 'Bolsas y empaques',
    concept: 'Bolsas y empaques',
    category: 'Logística/Producción',
    source: 'operatingFund',
  },
  {
    label: 'Etiquetas / Envío',
    concept: 'Etiquetas y envío de mercancía',
    category: 'Logística/Producción',
    source: 'operatingFund',
  },
  {
    label: 'Publicidad / Ads',
    concept: 'Publicidad Meta / TikTok Ads',
    category: 'Comercialización/Publicidad',
    source: 'operatingFund',
  },
  {
    label: 'Retiro Socio',
    concept: 'Retiro personal de socio',
    category: 'Personales/Retiros de Socios',
    source: 'dividends',
  },
];

export function FinanceView({
  state,
  currentUser,
  activeSection,
  matrixParams,
  onOpenReceivables,
  onCollectReceivable,
  onReinvestDividends,
  onWithdrawDividends,
  onSyncFreeCashToFunds,
  onRegisterOperatingExpense,
  onRegisterCapitalInjection,
  onReconcileCash,
  onResetDemoData,
}: FinanceViewProps) {
  const isAdmin = isAdminUser(currentUser);
  const effectiveMatrixParams = matrixParams ?? DEFAULT_GENERAL_CONFIG.matrixParams;
  const vitalReserveMinUsd = round2(
    Math.max(0, effectiveMatrixParams.vitalReserveMinUsd ?? 150),
  );
  const airSharePct = round2(
    Math.min(100, Math.max(0, effectiveMatrixParams.airRotationSharePct ?? 50)),
  );
  const maritimeSharePct = round2(Math.max(0, 100 - airSharePct));
  const maritimeGoalUsd = round2(
    Math.max(1, effectiveMatrixParams.maritimeGoalUsd ?? 1500),
  );

  const showAllSections = !activeSection;
  const showMatrizSection = showAllSections || activeSection === 'matriz';
  const showSociosSection = showAllSections || activeSection === 'socios';
  const showCxcSection = showAllSections || activeSection === 'cxc';
  const showGastosSection = showAllSections || activeSection === 'gastos';
  const showCapitalSection = showAllSections || activeSection === 'capital';
  const showCajaSection = showAllSections || activeSection === 'caja';

  useEffect(() => {
    if (!activeSection) return;
    const sectionHeadingMap: Record<NonNullable<FinanceViewProps['activeSection']>, string> = {
      matriz: 'funds-heading',
      gastos: 'petty-cash-heading',
      socios: 'dividends-heading',
      capital: 'capital-injections-heading',
      caja: 'cash-reconciliation-heading',
      cxc: 'receivables-heading',
    };
    const targetId = sectionHeadingMap[activeSection];
    const raf = window.requestAnimationFrame(() => {
      if (activeSection === 'matriz') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const el = document.getElementById(targetId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [activeSection]);

  const [collectionMethod, setCollectionMethod] =
    useState<SinglePaymentMethod>('Efectivo ($)');
  const [abonoTargetId, setAbonoTargetId] = useState<string | null>(null);
  const [abonoAmountInput, setAbonoAmountInput] = useState('');

  const [expenseConcept, setExpenseConcept] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>(
    EXPENSE_CATEGORIES[0],
  );
  const [categoryManualOverride, setCategoryManualOverride] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseSource, setExpenseSource] = useState<ExpenseSource>(
    'operatingFund',
  );
  const [expenseMethod, setExpenseMethod] =
    useState<SinglePaymentMethod>('Efectivo ($)');

  const [injContributor, setInjContributor] = useState('Jesús');
  const [injConcept, setInjConcept] = useState('');
  const [injAmount, setInjAmount] = useState('');
  const [injMethod, setInjMethod] =
    useState<SinglePaymentMethod>('Efectivo ($)');
  const [injDestination, setInjDestination] =
    useState<CapitalInjectionDestination>('cashOnly');

  const [countedCashInput, setCountedCashInput] = useState(
    state.cashOnHand.toFixed(2),
  );
  const [reconcileReason, setReconcileReason] = useState('');

  const [isArqueoModalOpen, setIsArqueoModalOpen] = useState(false);
  const [modalCountedCashInput, setModalCountedCashInput] = useState(
    state.cashOnHand.toFixed(2),
  );
  const [modalReconcileReason, setModalReconcileReason] = useState('');

  useEffect(() => {
    setCountedCashInput(state.cashOnHand.toFixed(2));
    if (!isArqueoModalOpen) {
      setModalCountedCashInput(state.cashOnHand.toFixed(2));
    }
  }, [state.cashOnHand, isArqueoModalOpen]);

  useEffect(() => {
    if (!isArqueoModalOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsArqueoModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isArqueoModalOpen]);

  const [showAllMovements, setShowAllMovements] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [downloadingHtml, setDownloadingHtml] = useState(false);

  const totalReceivables = getTotalReceivables(state);
  const totalPendingReceivables = totalReceivables;
  const pendingReceivablesCount = state.receivables.length;
  const cashBackedSummary = getCashBackedFundsSummary(state);
  const unassignedCash = round2(
    Math.max(0, cashBackedSummary.cashOnHand - cashBackedSummary.totalAllocatedFunds),
  );
  const isBelowVitalReserve = state.cashOnHand < round2(vitalReserveMinUsd - 0.001);

  const airRotationFundBalance = round2(
    state.funds.growthReinvestment * (airSharePct / 100),
  );
  const maritimeFundBalance = round2(
    Math.max(0, state.funds.growthReinvestment - airRotationFundBalance),
  );
  const maritimeProgressPct = Math.min(
    100,
    round2((maritimeFundBalance / maritimeGoalUsd) * 100),
  );
  const maritimeMissingUsd = round2(
    Math.max(0, maritimeGoalUsd - maritimeFundBalance),
  );

  const detectedLogisticsMatch = useMemo(
    () => detectExpenseCategoryFromDescription(expenseConcept),
    [expenseConcept],
  );

  const totalDividendsPool = round2(
    state.funds.dividendsByPartner.Jesús +
      state.funds.dividendsByPartner.Josué +
      state.funds.dividendsByPartner.Gabriel,
  );

  const selectedFundAvailable = useMemo(() => {
    if (expenseSource === 'operatingFund') return state.funds.operatingAndAds;
    if (expenseSource === 'growthReinvestment') return state.funds.growthReinvestment;
    if (expenseSource === 'replacement') return state.funds.replacement;
    if (expenseSource === 'dividends') return totalDividendsPool;
    return state.cashOnHand;
  }, [
    expenseSource,
    state.funds.operatingAndAds,
    state.funds.growthReinvestment,
    state.funds.replacement,
    totalDividendsPool,
    state.cashOnHand,
  ]);

  const handleDownloadStandaloneHtml = async () => {
    setFeedback(null);
    if (window.location.protocol === 'file:') {
      setFeedback({
        type: 'success',
        text: 'Ya estás ejecutando el archivo HTML portátil completo de X4SPORT.',
      });
      return;
    }

    setDownloadingHtml(true);
    try {
      const response = await fetch('/x4sport-standalone.html', {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('No se encontró el paquete HTML autocontenido.');
      }
      const htmlText = await response.text();
      if (!htmlText.toLowerCase().includes('<!doctype html>')) {
        throw new Error('El archivo generado no tiene formato HTML válido.');
      }
      const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'index.html';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback({
        type: 'success',
        text: 'Archivo autocontenido index.html descargado con Firebase Realtime Database integrado, listo para arrastrar a Netlify Drop.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo descargar el archivo index.html completo.',
      });
    } finally {
      setDownloadingHtml(false);
    }
  };

  const handleCollect = async (
    id: string,
    debtor: string,
    amount: number,
    partialAmount?: number,
  ) => {
    const opId = `fin-cxc-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const res = await Promise.resolve(
      onCollectReceivable(id, collectionMethod, partialAmount, opId),
    );
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'Error al cobrar cuenta.' });
      return;
    }

    if (partialAmount !== undefined && partialAmount < amount) {
      const remaining = round2(Math.max(0, amount - partialAmount));
      setAbonoTargetId(null);
      setAbonoAmountInput('');
      setFeedback({
        type: 'success',
        text: `Abono de ${formatUSD(partialAmount)} recibido de ${debtor} vía ${collectionMethod}. Saldo restante: ${formatUSD(remaining)}.`,
      });
    } else {
      setAbonoTargetId(null);
      setAbonoAmountInput('');
      setFeedback({
        type: 'success',
        text: `Liquidación total de ${formatUSD(amount)} recibida de ${debtor} vía ${collectionMethod} y sumada a caja.`,
      });
    }
  };

  const handleReinvest = async (partner: PartnerName, amount: number) => {
    const res = await Promise.resolve(onReinvestDividends(partner));
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo reinvertir.' });
      return;
    }
    setFeedback({
      type: 'success',
      text: `${formatUSD(amount)} en dividendos de ${partner} reinvertidos al Fondo de Crecimiento.`,
    });
  };

  const handleWithdrawDividend = async (partner: PartnerName, amount: number) => {
    if (!onWithdrawDividends) return;
    const res = await Promise.resolve(onWithdrawDividends(partner, amount));
    if (!res.ok) {
      setFeedback({
        type: 'error',
        text: res.error ?? 'No se pudo retirar el dividendo.',
      });
      return;
    }
    setFeedback({
      type: 'success',
      text: `Dividendo de ${formatUSD(amount)} retirado por ${partner} y descontado del Efectivo Físico en Caja.`,
    });
  };

  const handleSyncFreeCash = async () => {
    if (!onSyncFreeCashToFunds) return;
    const res = await Promise.resolve(onSyncFreeCashToFunds());
    if (!res.ok) {
      setFeedback({
        type: 'error',
        text: res.error ?? 'No hay efectivo libre para sincronizar.',
      });
      return;
    }
    setFeedback({
      type: 'success',
      text: `Saldo libre en caja sincronizado al Fondo de Reinversión. Suma de Fondos = Efectivo Físico en Caja (${formatUSDT(state.cashOnHand)}).`,
    });
  };

  const handleExpenseConceptChange = (nextVal: string) => {
    setExpenseConcept(nextVal);
    setFeedback(null);
    const match = detectExpenseCategoryFromDescription(nextVal);
    if (match && !categoryManualOverride) {
      setExpenseCategory(match.category);
    } else if (!nextVal.trim()) {
      setCategoryManualOverride(false);
    }
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const parsedAmount = Number(expenseAmount);
    const res = await Promise.resolve(
      onRegisterOperatingExpense({
        concept: expenseConcept,
        category: expenseCategory,
        amount: parsedAmount,
        source: expenseSource,
        paymentMethod: expenseMethod,
      }),
    );
    if (!res.ok) {
      setFeedback({
        type: 'error',
        text: res.error ?? 'No se pudo registrar el gasto operativo.',
      });
      return;
    }
    const triggeredDeficit =
      expenseSource !== 'cashOnHand' && parsedAmount > selectedFundAvailable;
    const isBridgeSource =
      expenseSource === 'replacement' || expenseSource === 'growthReinvestment';
    setExpenseConcept('');
    setExpenseAmount('');
    setCategoryManualOverride(false);
    setFeedback({
      type: 'success',
      text: triggeredDeficit
        ? isBridgeSource
          ? `Gasto [${expenseCategory}] "${expenseConcept.trim()}" por ${formatUSD(parsedAmount)} registrado. Regla puente aplicada: el saldo excedente se cubrió con el fondo hermano (Reposición ↔ Reinversión) y los fondos activos según disponibilidad.`
          : `Gasto [${expenseCategory}] "${expenseConcept.trim()}" por ${formatUSD(parsedAmount)} registrado. Regla de Sobregiro aplicada: el fondo elegido quedó en $0.00 y el excedente redujo proporcionalmente el resto de los fondos activos.`
        : `Gasto [${expenseCategory}] "${expenseConcept.trim()}" por ${formatUSD(parsedAmount)} registrado y descontado de caja.`,
    });
  };

  const handleCapitalInjectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const parsedAmount = Number(injAmount);
    const res = await Promise.resolve(
      onRegisterCapitalInjection({
        contributor: injContributor,
        concept: injConcept,
        amount: parsedAmount,
        paymentMethod: injMethod,
        destination: injDestination,
      }),
    );
    if (!res.ok) {
      setFeedback({
        type: 'error',
        text: res.error ?? 'No se pudo registrar la inyección de dinero.',
      });
      return;
    }
    setInjConcept('');
    setInjAmount('');
    setFeedback({
      type: 'success',
      text: `Inyección de ${formatUSD(parsedAmount)} (${injContributor.trim()}) conciliada en caja operativa sin alterar el costo FIFO de inventario.`,
    });
  };

  const handleReconcileCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const parsedCount = Number(countedCashInput);
    const res = await Promise.resolve(
      onReconcileCash({
        countedCash: parsedCount,
        reason: reconcileReason,
      }),
    );
    if (!res.ok) {
      setFeedback({
        type: 'error',
        text: res.error ?? 'No se pudo conciliar la caja física.',
      });
      return;
    }
    setReconcileReason('');
    setFeedback({
      type: 'success',
      text: `Caja física conciliada a ${formatUSD(parsedCount)} (Bs. ${formatVES(parsedCount * state.exchangeRates.bcv).replace('Bs. ', '')} BCV).`,
    });
  };

  const handleModalArqueoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const parsedCount = Number(modalCountedCashInput);
    const res = await Promise.resolve(
      onReconcileCash({
        countedCash: parsedCount,
        reason: modalReconcileReason.trim() || 'Arqueo físico desde tarjeta principal',
      }),
    );
    if (!res.ok) {
      setFeedback({
        type: 'error',
        text: res.error ?? 'No se pudo actualizar el arqueo de caja.',
      });
      return;
    }
    setIsArqueoModalOpen(false);
    setModalReconcileReason('');
    setFeedback({
      type: 'success',
      text: `Arqueo aplicado: Efectivo Físico en Caja actualizado a ${formatUSDT(parsedCount)} sin alterar ventas, compras ni costos FIFO.`,
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Finanzas, Matriz de 4 Capas y Caja
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Fondos acumulados por capa contable, reparto de dividendos entre socios y gestión de cuentas por cobrar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="btn-download-html"
            disabled={downloadingHtml}
            onClick={handleDownloadStandaloneHtml}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-600/15 px-3.5 py-2 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-600/25 hover:text-white disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {downloadingHtml ? 'Generando index.html...' : 'Descargar index.html (Netlify Drop)'}
          </button>

          {isAdmin &&
            (!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="min-h-[40px] rounded-lg border border-slate-700 bg-[#0D1526] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              >
                Restablecer Datos Iniciales
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onResetDemoData();
                    setConfirmReset(false);
                    setFeedback({
                      type: 'success',
                      text: 'Saldos oficiales X4SPORT ($135.19 caja, $263.50 CxC, sin ítems de prueba) restablecidos.',
                    });
                  }}
                  className="min-h-[40px] rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-500"
                >
                  Confirmar Restablecimiento
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="min-h-[40px] rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
              </div>
            ))}
        </div>
      </div>

      {feedback && (
        <div
          role="status"
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

      {showMatrizSection && (
        <>
      {/* Tarjeta Principal: Efectivo Físico en Caja (USDT) + Acceso Directo CxC */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch">
        <section
          aria-label="Efectivo Físico en Caja"
          className={`rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-[#0D1A2D] via-[#0D1526] to-[#08121E] p-5 sm:p-6 shadow-xl flex flex-col justify-center ${
            onOpenReceivables ? 'lg:col-span-8' : 'lg:col-span-12'
          }`}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                  Efectivo Físico en Caja (USDT)
                </span>
                <span
                  data-testid="vital-reserve-status-badge"
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                    isBelowVitalReserve
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  }`}
                >
                  {isBelowVitalReserve ? (
                    <Lock className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Unlock className="h-3 w-3" aria-hidden="true" />
                  )}
                  {isBelowVitalReserve
                    ? `Bajo Mínimo Vital (${formatUSD(vitalReserveMinUsd)}) · Dividendos Bloqueados`
                    : `Mínimo Vital Cubierto (≥ ${formatUSD(vitalReserveMinUsd)})`}
                </span>
              </div>

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p
                  data-testid="hero-cash-on-hand"
                  className="font-mono-num text-3xl font-bold tracking-tight text-white sm:text-4xl"
                >
                  {formatUSDT(state.cashOnHand)}
                </p>
                <span className="font-mono-num text-xs text-slate-400">
                  {formatVES(state.cashOnHand * state.exchangeRates.bcv)} BCV ·{' '}
                  {formatVES(state.cashOnHand * state.exchangeRates.usdt)} USDT
                </span>
              </div>

              <p className="text-xs text-slate-300">
                Invariante contable:{' '}
                <strong className="font-mono-num text-white">
                  Suma de Fondos ({formatUSDT(cashBackedSummary.totalAllocatedFunds)})
                </strong>{' '}
                {Math.abs(cashBackedSummary.totalAllocatedFunds - state.cashOnHand) <= 0.01 ? (
                  <span className="text-emerald-400 font-semibold">
                    = Efectivo Físico en Caja (100% respaldado)
                  </span>
                ) : unassignedCash > 0 ? (
                  <span className="text-blue-300">
                    + Saldo libre en caja ({formatUSDT(unassignedCash)}) ={' '}
                    {formatUSDT(state.cashOnHand)}
                  </span>
                ) : (
                  <span className="text-amber-300">
                    ≤ Efectivo Físico en Caja
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {unassignedCash > 0.01 && onSyncFreeCashToFunds && (
                <button
                  type="button"
                  data-testid="btn-sync-free-cash"
                  onClick={handleSyncFreeCash}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-600/15 px-3.5 py-2 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-600/25 hover:text-white"
                >
                  <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Igualar Fondos (+{formatUSD(unassignedCash)})
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  data-testid="btn-open-arqueo"
                  onClick={() => {
                    setModalCountedCashInput(state.cashOnHand.toFixed(2));
                    setModalReconcileReason('');
                    setIsArqueoModalOpen(true);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/40 transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <Scale className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Arqueo / Ajustar Caja
                </button>
              )}
            </div>
          </div>
        </section>

        {onOpenReceivables && (
          <button
            type="button"
            data-testid="btn-shortcut-cxc"
            onClick={onOpenReceivables}
            className="group flex flex-col justify-between rounded-2xl border border-amber-500/30 bg-[#0D1526] p-5 text-left shadow-xl transition-colors hover:border-amber-400/60 hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 lg:col-span-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-amber-400 shrink-0">
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    Cuentas por Cobrar (CxC)
                  </p>
                  <p className="text-xs text-slate-400">
                    {pendingReceivablesCount}{' '}
                    {pendingReceivablesCount === 1
                      ? 'cuenta pendiente'
                      : 'cuentas pendientes'}
                  </p>
                </div>
              </div>
              <ArrowUpRight
                className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-amber-300"
                aria-hidden="true"
              />
            </div>

            <div className="mt-4 flex items-baseline justify-between gap-2 border-t border-slate-800/80 pt-3">
              <span className="font-mono-num text-2xl font-bold text-amber-400">
                {formatUSD(totalPendingReceivables)}
              </span>
              <span className="text-xs font-semibold text-blue-300 whitespace-nowrap">
                Ver y cobrar →
              </span>
            </div>
          </button>
        )}
      </div>

      <section aria-labelledby="funds-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2
              id="funds-heading"
              className="font-display text-lg font-semibold text-white"
            >
              Fondos Acumulados · Cascada Oficial de 4 Capas (USDT)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Cálculo jerárquico estricto respaldado por efectivo físico cobrado en caja (
              <span className="font-mono-num text-slate-200">
                {formatUSDT(cashBackedSummary.totalAllocatedFunds)}
              </span>{' '}
              asignados en fondos /{' '}
              <span className="font-mono-num text-emerald-300">
                {formatUSDT(cashBackedSummary.cashOnHand)}
              </span>{' '}
              en caja).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>
              Ganancia neta histórica:{' '}
              <strong
                data-testid="finance-historical-profit"
                className="font-mono-num text-emerald-400"
              >
                {formatUSDT(state.historicalNetProfit ?? 317.37)}
              </strong>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-xl border border-blue-500/30 bg-[#0D1526] p-5">
            <p className="text-xs font-medium text-blue-300">
              Fondo de Reposición (Costo Base · Capa 1)
            </p>
            <p
              data-testid="fund-replacement"
              className="font-mono-num mt-2 text-2xl font-bold text-white"
            >
              {formatUSD(state.funds.replacement)}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              100% costo base + flete/aduana prorrateado (respaldo mutuo con Reinversión)
            </p>
          </article>

          <article className="rounded-xl border border-slate-800 bg-[#0D1526] p-5">
            <p className="text-xs font-medium text-slate-400">
              Capa 2 · Comisiones Venta ({effectiveMatrixParams.commissionPct}%)
            </p>
            <p
              data-testid="fund-commissions"
              className="font-mono-num mt-2 text-2xl font-bold text-white"
            >
              {formatUSD(state.funds.commissions)}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Jesús {formatUSD(state.funds.commissionsBySeller.Jesús)} · Josué{' '}
              {formatUSD(state.funds.commissionsBySeller.Josué)} · Gabriel{' '}
              {formatUSD(state.funds.commissionsBySeller.Gabriel)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Sin vendedor asignado → pasa directo a Reinversión
            </p>
          </article>

          <article className="rounded-xl border border-slate-800 bg-[#0D1526] p-5">
            <p className="text-xs font-medium text-slate-400">
              Capa 3 · Operaciones y Mantenimiento
            </p>
            <p
              data-testid="fund-operating"
              className="font-mono-num mt-2 text-2xl font-bold text-white"
            >
              {formatUSD(state.funds.operatingAndAds)}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {effectiveMatrixParams.operatingFundPct}% Utilidad Neta (caja chica, empaques, pauta Meta/TikTok)
            </p>
          </article>

          <article className="rounded-xl border border-emerald-500/25 bg-[#0D1526] p-5">
            <p className="text-xs font-medium text-slate-400">
              Capa 4a · Reinversión de Crecimiento
            </p>
            <p
              data-testid="fund-growth"
              className="font-mono-num mt-2 text-2xl font-bold text-emerald-400"
            >
              {formatUSD(state.funds.growthReinvestment)}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {effectiveMatrixParams.growthReinvestmentPct}% remanente +{' '}
              <span className="font-mono-num text-slate-300">
                {formatUSD(state.funds.reinvestedFromDividendsTotal)}
              </span>{' '}
              reinvertidos
            </p>
          </article>
        </div>

        {/* Consolidado de Gavetas vs Efectivo Físico en Caja */}
        <div
          data-testid="funds-consolidated-summary"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#080E1C] px-4 py-3 text-xs"
        >
          <span className="text-slate-400">
            Consolidado 4 Capas (Reposición {formatUSD(state.funds.replacement)} + Comisiones{' '}
            {formatUSD(state.funds.commissions)} + Operativo{' '}
            {formatUSD(state.funds.operatingAndAds)} + Reinversión{' '}
            {formatUSD(state.funds.growthReinvestment)} + Dividendos{' '}
            {formatUSD(totalDividendsPool)}):
          </span>
          <span className="font-mono-num font-bold text-white">
            {formatUSDT(cashBackedSummary.totalAllocatedFunds)}{' '}
            <span className="font-normal text-slate-400">
              / {formatUSDT(cashBackedSummary.cashOnHand)} en caja
            </span>
          </span>
        </div>

        {/* Sub-tarjetas configurables de Capa 4a: Pedido Aéreo vs Acumulación Fondo Marítimo Masivo */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            data-testid="subfund-air-rotation"
            className="rounded-xl border border-slate-800 bg-[#0D1526] p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2 text-blue-400 shrink-0">
                  <Plane className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Pedido Aéreo de Rotación Activa
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Asignación configurable: {airSharePct.toFixed(0)}% del Fondo de Reinversión
                  </p>
                </div>
              </div>
              <span className="font-mono-num text-lg font-bold text-blue-300">
                {formatUSD(airRotationFundBalance)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${airSharePct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Liquidez inmediata para reposición aérea rápida de tallas y modelos top en demanda.
            </p>
          </div>

          <div
            data-testid="subfund-maritime-goal"
            className="rounded-xl border border-slate-800 bg-[#0D1526] p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-400 shrink-0">
                  <Ship className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Acumulación Fondo Marítimo Masivo
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {maritimeSharePct.toFixed(0)}% de Reinversión · Meta:{' '}
                    <span className="font-mono-num text-slate-200">
                      {formatUSD(maritimeGoalUsd)}
                    </span>
                  </p>
                </div>
              </div>
              <span className="font-mono-num text-lg font-bold text-emerald-400">
                {formatUSD(maritimeFundBalance)}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${maritimeProgressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono-num">
                <span className="text-emerald-300 font-semibold">
                  {maritimeProgressPct.toFixed(1)}% de la meta
                </span>
                <span className="text-slate-400">
                  {maritimeMissingUsd > 0
                    ? `Faltan ${formatUSD(maritimeMissingUsd)}`
                    : '¡Meta marítima alcanzada!'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
        </>
      )}

      {(showSociosSection || showCxcSection) && (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {showSociosSection && (
        <section
          aria-labelledby="dividends-heading"
          className={`rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 ${
            showCxcSection ? 'lg:col-span-6' : 'lg:col-span-12'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2
                id="dividends-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Capa 4b · Reparto de Dividendos ({effectiveMatrixParams.dividendsPct}%)
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {effectiveMatrixParams.dividendsPct}% de la utilidad neta remanente según participación accionaria.
              </p>
            </div>
            <span className="font-mono-num text-xs font-semibold text-slate-300">
              Pool: {formatUSD(totalDividendsPool)}
            </span>
          </div>

          {isBelowVitalReserve && (
            <div
              data-testid="vital-reserve-lock-warning"
              role="alert"
              className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-200"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  Retiro de Dividendos Bloqueado (Candado de Mínimo Vital)
                </p>
                <p className="mt-0.5 text-amber-200/90">
                  El Efectivo Físico en Caja ({formatUSDT(state.cashOnHand)}) está por debajo del Mínimo Vital de Reserva configurado ({formatUSDT(vitalReserveMinUsd)}). Reinvertir al Fondo de Crecimiento sigue disponible.
                </p>
              </div>
            </div>
          )}

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-medium text-slate-400">
                <tr>
                  <th scope="col" className="pb-3">Socio</th>
                  <th scope="col" className="pb-3 text-right">Participación</th>
                  <th scope="col" className="pb-3 text-right">Acumulado</th>
                  <th scope="col" className="pb-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {PARTNERS.map((partner) => {
                  const amount = state.funds.dividendsByPartner[partner];
                  const sharePct = (
                    effectiveMatrixParams.partnerSharesPct[partner] ??
                    PARTNER_SHARES[partner] * 100
                  ).toFixed(2);
                  const canWithdraw =
                    !isBelowVitalReserve &&
                    amount > 0 &&
                    amount <= round2(state.cashOnHand + 0.001);
                  return (
                    <tr key={partner}>
                      <td className="py-3.5 font-semibold text-white">
                        {partner}
                      </td>
                      <td className="py-3.5 text-right font-mono-num text-slate-300">
                        {sharePct}%
                      </td>
                      <td
                        data-testid={`dividend-${partner}`}
                        className="py-3.5 text-right font-mono-num font-bold text-white"
                      >
                        {formatUSD(amount)}
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            data-testid={`btn-withdraw-dividend-${partner}`}
                            disabled={!canWithdraw}
                            onClick={() => handleWithdrawDividend(partner, amount)}
                            title={
                              isBelowVitalReserve
                                ? `Bloqueado: Caja < Mínimo Vital (${formatUSD(vitalReserveMinUsd)})`
                                : `Retirar dividendo de ${partner}`
                            }
                            aria-label={`Retirar dividendo de ${partner}`}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                          >
                            {isBelowVitalReserve ? (
                              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Retirar Dividendo
                          </button>
                          <button
                            type="button"
                            disabled={amount <= 0}
                            onClick={() => handleReinvest(partner, amount)}
                            aria-label={`Reinvertir dividendos de ${partner}`}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-blue-500/40 bg-blue-600/15 px-2.5 py-1.5 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-600 hover:text-white disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-800/60 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                          >
                            <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            Reinvertir
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {showCxcSection && (
        <section
          aria-labelledby="receivables-heading"
          className={`rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 ${
            showSociosSection ? 'lg:col-span-6' : 'lg:col-span-12'
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2
                id="receivables-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Cuentas por Cobrar Pendientes
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Selecciona el método de cobro; el monto se suma automáticamente a caja.
              </p>
            </div>
            <span className="font-mono-num text-sm font-bold text-amber-400 shrink-0">
              {formatUSD(totalReceivables)}
            </span>
          </div>

          {state.receivables.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-800 bg-[#080E1C] p-3">
              <label
                htmlFor="collection-payment-method"
                className="text-xs font-medium text-slate-300"
              >
                Método de cobro recibido:
              </label>
              <select
                id="collection-payment-method"
                value={collectionMethod}
                onChange={(e) =>
                  setCollectionMethod(e.target.value as SinglePaymentMethod)
                }
                className="min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
              </select>
            </div>
          )}

          {state.receivables.length === 0 ? (
            <div className="mt-6 rounded-lg border border-slate-800 bg-[#080E1C] p-6 text-center">
              <p className="text-sm font-medium text-emerald-400">
                Sin cuentas pendientes
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Todas las cuentas por cobrar han sido liquidadas a caja.
              </p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-800/80">
              {state.receivables.map((rec) => {
                const isAbonoOpen = abonoTargetId === rec.id;
                const paidSoFar = round2(rec.paidAmount ?? 0);
                return (
                  <div key={rec.id} className="py-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-white">
                            {rec.debtor}
                          </p>
                          {paidSoFar > 0 && (
                            <span className="text-[11px] font-semibold text-blue-300">
                              Abono parcial (pagado {formatUSD(paidSoFar)})
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-slate-400">
                          {rec.note ?? 'Cuenta por cobrar'}
                          {collectionMethod === 'Pago Móvil / Bs' && (
                            <span className="font-mono-num text-blue-300">
                              {' '}
                              · {formatVES(rec.amount * state.exchangeRates.bcv)}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span className="font-mono-num text-sm font-bold text-white">
                          {formatUSD(rec.amount)}
                        </span>
                        <button
                          type="button"
                          data-testid={`btn-abono-${rec.id}`}
                          onClick={() => {
                            if (isAbonoOpen) {
                              setAbonoTargetId(null);
                              setAbonoAmountInput('');
                            } else {
                              setAbonoTargetId(rec.id);
                              setAbonoAmountInput('');
                            }
                          }}
                          className="min-h-[38px] rounded-lg border border-blue-500/40 bg-blue-600/10 px-2.5 py-1.5 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-600/20 hover:text-white"
                        >
                          {isAbonoOpen ? 'Cerrar' : 'Abonar'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleCollect(rec.id, rec.debtor, rec.amount)
                          }
                          aria-label={`Cobrar total ${formatUSD(rec.amount)} a ${rec.debtor}`}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                          <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                          Cobrar
                        </button>
                      </div>
                    </div>

                    {isAbonoOpen && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleCollect(
                            rec.id,
                            rec.debtor,
                            rec.amount,
                            Number(abonoAmountInput),
                          );
                        }}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-[#080E1C] p-2.5"
                      >
                        <label
                          htmlFor={`abono-input-${rec.id}`}
                          className="text-xs text-slate-300"
                        >
                          Monto del abono ($):
                        </label>
                        <input
                          id={`abono-input-${rec.id}`}
                          type="number"
                          min="0.01"
                          max={rec.amount}
                          step="0.01"
                          required
                          placeholder={(rec.amount / 2).toFixed(2)}
                          value={abonoAmountInput}
                          onChange={(e) => setAbonoAmountInput(e.target.value)}
                          className="font-mono-num min-h-[38px] w-28 rounded-lg border border-slate-700 bg-[#070D19] px-2.5 py-1 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="submit"
                          className="min-h-[38px] rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                        >
                          Registrar Abono
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        )}
      </div>
      )}

      {showGastosSection && (
      <section
        aria-labelledby="petty-cash-heading"
        className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="petty-cash-heading"
              className="font-display text-lg font-semibold text-white"
            >
              Gastos Operativos (Caja Chica)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Registra gastos menores (delivery, papelería, empaques) o publicidad descontándolos del efectivo físico de caja o Fondo Operativo sin alterar el inventario.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-num text-xs text-slate-300">
            <span>
              Caja física:{' '}
              <strong className="text-emerald-300">
                {formatUSDT(state.cashOnHand)}
              </strong>
            </span>
            <span>
              Total gastos:{' '}
              <strong
                data-testid="finance-total-expenses"
                className="text-red-300"
              >
                {formatUSDT(
                  (state.operatingExpenses ?? []).reduce(
                    (s, e) => s + e.amount,
                    0,
                  ),
                )}
              </strong>
            </span>
            <span>
              Fondo Operativo {effectiveMatrixParams.operatingFundPct}%:{' '}
              <strong className="text-blue-300">
                {formatUSDT(state.funds.operatingAndAds)}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-slate-400">
            Atajos Caja Chica:
          </span>
          {PETTY_CASH_QUICK_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                data-testid={`petty-cash-preset-${preset.label}`}
                onClick={() => {
                  setExpenseCategory(preset.category);
                  setExpenseConcept(preset.concept);
                  setExpenseSource(preset.source);
                  setExpenseMethod('Efectivo ($)');
                  setCategoryManualOverride(false);
                  setFeedback(null);
                }}
                className="min-h-[32px] rounded-lg border border-slate-700 bg-[#080E1C] px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition-colors hover:border-blue-500/50 hover:bg-blue-600/20 hover:text-white"
              >
                + {preset.label}
              </button>
            ))}
        </div>

        <form
          onSubmit={handleExpenseSubmit}
          className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-end"
        >
          <div className="sm:col-span-3">
            <label
              htmlFor="expense-category"
              className="block text-xs font-medium text-slate-300"
            >
              Clasificación del gasto *
            </label>
            <select
              id="expense-category"
              data-testid="expense-category"
              required
              value={expenseCategory}
              onChange={(e) => {
                setExpenseCategory(e.target.value as ExpenseCategory);
                setCategoryManualOverride(true);
                setFeedback(null);
              }}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="expense-concept"
                className="block text-xs font-medium text-slate-300"
              >
                Concepto del gasto *
              </label>
              {detectedLogisticsMatch && expenseCategory === 'Logística/Producción' && (
                <span
                  data-testid="expense-autodetect-badge"
                  className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200"
                >
                  <Sparkles className="h-2.5 w-2.5 text-blue-400" aria-hidden="true" />
                  Auto: Logística ({detectedLogisticsMatch.matchedKeyword})
                </span>
              )}
            </div>
            <input
              id="expense-concept"
              type="text"
              required
              placeholder="Ej. Bolsas, empaques, envío o Meta Ads"
              value={expenseConcept}
              onChange={(e) => handleExpenseConceptChange(e.target.value)}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="expense-amount"
              className="block text-xs font-medium text-slate-300"
            >
              Monto (USDT) *
            </label>
            <input
              id="expense-amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="0.00"
              value={expenseAmount}
              onChange={(e) => {
                setExpenseAmount(e.target.value);
                setFeedback(null);
              }}
              className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="expense-source"
              className="block text-xs font-medium text-slate-300"
            >
              Fondo de origen
            </label>
            <select
              id="expense-source"
              value={expenseSource}
              onChange={(e) =>
                setExpenseSource(e.target.value as ExpenseSource)
              }
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="operatingFund">
                Fondo Operativo ({formatUSD(state.funds.operatingAndAds)})
              </option>
              <option value="replacement">
                Fondo de Reposición (Costo Base) ({formatUSD(state.funds.replacement)})
              </option>
              <option value="growthReinvestment">
                Fondo Reinversión ({formatUSD(state.funds.growthReinvestment)})
              </option>
              <option value="dividends">
                Reparto Dividendos ({formatUSD(totalDividendsPool)})
              </option>
              <option value="cashOnHand">Caja General (Prorrateo)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="expense-method"
              className="block text-xs font-medium text-slate-300"
            >
              Vía de pago
            </label>
            <select
              id="expense-method"
              value={expenseMethod}
              onChange={(e) =>
                setExpenseMethod(e.target.value as SinglePaymentMethod)
              }
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm} value={pm}>
                  {pm}
                </option>
              ))}
            </select>
          </div>

          {expenseSource !== 'cashOnHand' &&
            Number(expenseAmount) > selectedFundAvailable &&
            Number(expenseAmount) <= state.cashOnHand && (
              <div className="sm:col-span-12 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
                {expenseSource === 'replacement' || expenseSource === 'growthReinvestment' ? (
                  <>
                    Regla Puente Reposición ↔ Reinversión activa: el fondo primario (
                    {formatUSD(selectedFundAvailable)}) quedará en $0.00 y el excedente de{' '}
                    <strong className="font-mono-num">
                      {formatUSD(round2(Number(expenseAmount) - selectedFundAvailable))}
                    </strong>{' '}
                    se descontará primero del fondo hermano (
                    {expenseSource === 'replacement'
                      ? `Reinversión: ${formatUSD(state.funds.growthReinvestment)}`
                      : `Reposición: ${formatUSD(state.funds.replacement)}`}
                    ) y, si aún falta, proporcionalmente del resto de los fondos positivos.
                  </>
                ) : (
                  <>
                    Regla de Sobregiro activa: el fondo seleccionado (
                    {formatUSD(selectedFundAvailable)}) quedará en $0.00 y el excedente de{' '}
                    <strong className="font-mono-num">
                      {formatUSD(round2(Number(expenseAmount) - selectedFundAvailable))}
                    </strong>{' '}
                    se descontará proporcionalmente del resto de los fondos con saldo positivo, preservando Suma de Fondos = Caja Física.
                  </>
                )}
              </div>
            )}

          <div className="sm:col-span-12 flex justify-end">
            <button
              type="submit"
              data-testid="btn-register-expense"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <Receipt className="h-4 w-4 shrink-0" aria-hidden="true" />
              Registrar Gasto Clasificado
            </button>
          </div>
        </form>

        {/* Resumen por las 3 categorías oficiales */}
        <div className="grid grid-cols-1 gap-3 border-t border-slate-800 pt-4 sm:grid-cols-3">
          {EXPENSE_CATEGORIES.map((cat) => {
            const catTotal = round2(
              (state.operatingExpenses ?? [])
                .filter((e) => normalizeExpenseCategory(e.category) === cat)
                .reduce((s, e) => s + e.amount, 0),
            );
            return (
              <div
                key={cat}
                className="rounded-lg border border-slate-800 bg-[#080E1C] px-3.5 py-2.5"
              >
                <p className="text-[11px] font-medium text-slate-400">{cat}</p>
                <p className="font-mono-num mt-1 text-sm font-bold text-white">
                  {formatUSDT(catTotal)}
                </p>
              </div>
            );
          })}
        </div>

        {(state.operatingExpenses ?? []).length === 0 ? (
          <p className="text-xs text-slate-400">
            Sin gastos operativos registrados en esta sesión.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/80 border-t border-slate-800 pt-2">
            {(state.operatingExpenses ?? []).map((exp) => {
              const displayCat =
                normalizeExpenseCategory(exp.category) ??
                exp.category ??
                'Gasto histórico acumulado';
              const expSourceLabel =
                exp.source === 'operatingFund'
                  ? `Fondo Operativo ${effectiveMatrixParams.operatingFundPct}%`
                  : exp.source === 'growthReinvestment'
                    ? 'Fondo Reinversión'
                    : exp.source === 'replacement'
                      ? 'Fondo Reposición'
                      : exp.source === 'dividends'
                        ? 'Reparto Dividendos'
                        : 'Caja General';
              return (
                <div
                  key={exp.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div>
                    <p className="font-medium text-white">
                      {exp.concept}{' '}
                      <span className="text-blue-300 font-normal">
                        · {displayCat}
                      </span>
                    </p>
                    <p className="text-slate-400">
                      {exp.paymentMethod} · {expSourceLabel}
                      {exp.deficitCoveredByFunds && exp.deficitCoveredByFunds > 0
                        ? ` · Sobregiro proporcional (-${formatUSD(
                            exp.deficitCoveredByFunds,
                          )})`
                        : ''}{' '}
                      ·{' '}
                      {new Date(exp.createdAt).toLocaleString('es-VE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                  <span className="font-mono-num text-sm font-semibold text-red-300">
                    -{formatUSD(exp.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* INYECCIONES DE DINERO Y CONCILIACIÓN DE CAJA FÍSICA */}
      {(showCapitalSection || showCajaSection) && (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {showCapitalSection && (
        <section
          aria-labelledby="capital-injections-heading"
          className={`rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-5 ${
            showCajaSection ? 'lg:col-span-7' : 'lg:col-span-12'
          }`}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2
                id="capital-injections-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Inyecciones de Dinero / Aportes de Capital
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Registra aportes externos o de socios para aumentar la liquidez y caja sin alterar el costo FIFO de inventario.
              </p>
            </div>
            <span className="font-mono-num text-xs text-emerald-300 shrink-0">
              Total inyectado:{' '}
              <strong>
                {formatUSD(
                  (state.capitalInjections ?? []).reduce(
                    (s, i) => s + i.amount,
                    0,
                  ),
                )}
              </strong>
            </span>
          </div>

          {isAdmin ? (
            <form
              onSubmit={handleCapitalInjectionSubmit}
              className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-start"
            >
              <div className="sm:col-span-4">
                <label
                  htmlFor="injection-contributor"
                  className="block text-xs font-medium text-slate-300"
                >
                  Aportante / Origen *
                </label>
                <input
                  id="injection-contributor"
                  type="text"
                  required
                  value={injContributor}
                  onChange={(e) => setInjContributor(e.target.value)}
                  placeholder="Ej. Jesús / Aporte Externo"
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CONTRIBUTOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setInjContributor(preset)}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        injContributor === preset
                          ? 'bg-blue-600 text-white'
                          : 'bg-[#080E1C] text-slate-400 hover:text-white'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-5">
                <label
                  htmlFor="injection-concept"
                  className="block text-xs font-medium text-slate-300"
                >
                  Concepto del aporte *
                </label>
                <input
                  id="injection-concept"
                  type="text"
                  required
                  placeholder="Ej. Capital de trabajo / Liquidez envío"
                  value={injConcept}
                  onChange={(e) => {
                    setInjConcept(e.target.value);
                    setFeedback(null);
                  }}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="injection-amount"
                  className="block text-xs font-medium text-slate-300"
                >
                  Monto (USDT) *
                </label>
                <input
                  id="injection-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={injAmount}
                  onChange={(e) => {
                    setInjAmount(e.target.value);
                    setFeedback(null);
                  }}
                  className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-4">
                <label
                  htmlFor="injection-method"
                  className="block text-xs font-medium text-slate-300"
                >
                  Método de ingreso
                </label>
                <select
                  id="injection-method"
                  value={injMethod}
                  onChange={(e) =>
                    setInjMethod(e.target.value as SinglePaymentMethod)
                  }
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {PAYMENT_METHODS.map((pm) => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-4">
                <label
                  htmlFor="injection-destination"
                  className="block text-xs font-medium text-slate-300"
                >
                  Destino contable
                </label>
                <select
                  id="injection-destination"
                  value={injDestination}
                  onChange={(e) =>
                    setInjDestination(
                      e.target.value as CapitalInjectionDestination,
                    )
                  }
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="cashOnly">Solo Caja Operativa</option>
                  <option value="growthReinvestment">
                    Caja + Fondo Reinversión
                  </option>
                  <option value="operatingFund">
                    Caja + Fondo Operativo 10%
                  </option>
                </select>
              </div>

              <div className="sm:col-span-4 sm:self-end">
                <button
                  type="submit"
                  data-testid="btn-register-injection"
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <PlusCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Registrar Inyección
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-[#080E1C] p-3.5 text-xs text-slate-300">
              <Lock className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                Registro de inyecciones de capital habilitado únicamente para el Administrador Principal.
              </span>
            </div>
          )}

          {(state.capitalInjections ?? []).length === 0 ? (
            <p className="text-xs text-slate-400">
              Aún no se han registrado inyecciones de capital externo.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/80 border-t border-slate-800 pt-2">
              {(state.capitalInjections ?? []).map((inj) => (
                <div
                  key={inj.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div>
                    <p className="font-medium text-white">
                      {inj.contributor} — {inj.concept}
                    </p>
                    <p className="text-slate-400">
                      {inj.paymentMethod} ·{' '}
                      {inj.destination === 'growthReinvestment'
                        ? 'Caja + Fondo Reinversión'
                        : inj.destination === 'operatingFund'
                          ? 'Caja + Fondo Operativo'
                          : 'Caja Operativa'}{' '}
                      ·{' '}
                      {new Date(inj.createdAt).toLocaleString('es-VE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                  <span className="font-mono-num text-sm font-semibold text-emerald-400">
                    +{formatUSD(inj.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {showCajaSection && (
        <section
          aria-labelledby="cash-reconciliation-heading"
          className={`rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-5 ${
            showCapitalSection ? 'lg:col-span-5' : 'lg:col-span-12'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="cash-reconciliation-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Conciliación Exacta de Caja
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Cuadre de efectivo físico contra referencias BCV y USDT sin modificar costos FIFO.
              </p>
            </div>
            <Scale className="h-5 w-5 shrink-0 text-blue-400" aria-hidden="true" />
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-[#080E1C] p-3.5 text-xs">
            <div>
              <p className="text-slate-400">Caja en sistema (USDT)</p>
              <p
                data-testid="finance-cash-system"
                className="font-mono-num mt-1 text-lg font-bold text-white"
              >
                {formatUSDT(state.cashOnHand)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Referencia BCV / USDT</p>
              <p className="font-mono-num mt-1 font-semibold text-emerald-300">
                {formatVES(state.cashOnHand * state.exchangeRates.bcv)} BCV
              </p>
              <p className="font-mono-num text-[11px] text-blue-300">
                {formatVES(state.cashOnHand * state.exchangeRates.usdt)} USDT
              </p>
            </div>
          </div>

          {isAdmin ? (
            <form onSubmit={handleReconcileCashSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="reconcile-counted-cash"
                  className="block text-xs font-medium text-slate-300"
                >
                  Efectivo físico contado (USDT) *
                </label>
                <input
                  id="reconcile-counted-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={countedCashInput}
                  onChange={(e) => {
                    setCountedCashInput(e.target.value);
                    setFeedback(null);
                  }}
                  className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {Number.isFinite(Number(countedCashInput)) &&
                  Math.abs(round2(Number(countedCashInput) - state.cashOnHand)) > 0 && (
                    <p
                      className={`mt-1 font-mono-num text-[11px] font-medium ${
                        round2(Number(countedCashInput) - state.cashOnHand) > 0
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      Diferencia a conciliar:{' '}
                      {round2(Number(countedCashInput) - state.cashOnHand) > 0
                        ? '+'
                        : ''}
                      {formatUSD(round2(Number(countedCashInput) - state.cashOnHand))}
                    </p>
                  )}
              </div>

              <div>
                <label
                  htmlFor="reconcile-reason"
                  className="block text-xs font-medium text-slate-300"
                >
                  Motivo / Referencia del arqueo
                </label>
                <input
                  id="reconcile-reason"
                  type="text"
                  placeholder="Ej. Cuadre diario hoja de cálculo / Diferencia de vuelto"
                  value={reconcileReason}
                  onChange={(e) => setReconcileReason(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <button
                type="submit"
                data-testid="btn-reconcile-cash"
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <Landmark className="h-4 w-4 shrink-0" aria-hidden="true" />
                Conciliar Saldo de Caja
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-[#080E1C] p-3.5 text-xs text-slate-300">
              <Lock className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                El arqueo y conciliación manual de caja están restringidos al Administrador Principal.
              </span>
            </div>
          )}

          {(state.movements ?? []).length > 0 && (() => {
            const allMovements = state.movements ?? [];
            const visibleMovements = showAllMovements
              ? allMovements.slice(0, MAX_RECENT_MOVEMENTS)
              : allMovements.slice(0, 15);
            return (
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-300">
                    Últimos movimientos financieros sincronizados
                  </p>
                  {allMovements.length > 15 && (
                    <button
                      type="button"
                      data-testid="btn-toggle-all-movements"
                      onClick={() => setShowAllMovements((prev) => !prev)}
                      className="rounded-md border border-slate-700 bg-[#080E1C] px-2.5 py-1 text-[11px] font-medium text-blue-300 transition-colors hover:border-blue-500/50 hover:text-blue-200 shrink-0"
                    >
                      {showAllMovements
                        ? 'Mostrar menos'
                        : `Ver todos (${allMovements.length})`}
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/70">
                  {visibleMovements.map((mov, idx) => (
                    <div
                      key={`${mov.id || 'mov'}-${idx}`}
                      className="flex items-start justify-between gap-2 py-2 text-[11px]"
                    >
                      <div className="min-w-0">
                        <p className="text-slate-200">{mov.description}</p>
                        <p className="text-slate-500">
                          {new Date(mov.createdAt).toLocaleString('es-VE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                      <span
                        className={`font-mono-num font-semibold shrink-0 ${
                          mov.amount > 0
                            ? 'text-emerald-400'
                            : mov.amount < 0
                              ? 'text-red-300'
                              : 'text-slate-400'
                        }`}
                      >
                        {mov.amount > 0 ? '+' : ''}
                        {formatUSD(mov.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </section>
        )}
      </div>
      )}

      {/* Modal Arqueo / Ajustar Caja */}
      {isAdmin && isArqueoModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="arqueo-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsArqueoModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0D1526] p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="arqueo-modal-title"
                  className="flex items-center gap-2 font-display text-lg font-bold text-white"
                >
                  <Scale className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                  Arqueo / Ajustar Caja Física
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Actualiza el saldo físico contado sin modificar ventas, compras ni costos FIFO.
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar modal de arqueo"
                onClick={() => setIsArqueoModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3.5 text-xs flex items-center justify-between">
              <span className="text-slate-400">Saldo actual en sistema:</span>
              <strong className="font-mono-num text-base text-white">
                {formatUSDT(state.cashOnHand)}
              </strong>
            </div>

            <form onSubmit={handleModalArqueoSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="modal-arqueo-counted"
                  className="block text-xs font-medium text-slate-300"
                >
                  Efectivo físico contado (USDT) *
                </label>
                <input
                  id="modal-arqueo-counted"
                  data-testid="modal-arqueo-counted"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={modalCountedCashInput}
                  onChange={(e) => setModalCountedCashInput(e.target.value)}
                  className="font-mono-num mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-base font-bold text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                {Number.isFinite(Number(modalCountedCashInput)) &&
                  Math.abs(round2(Number(modalCountedCashInput) - state.cashOnHand)) > 0 && (
                    <p
                      className={`mt-1.5 font-mono-num text-xs font-semibold ${
                        round2(Number(modalCountedCashInput) - state.cashOnHand) > 0
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      Ajuste neto:{' '}
                      {round2(Number(modalCountedCashInput) - state.cashOnHand) > 0
                        ? '+'
                        : ''}
                      {formatUSD(round2(Number(modalCountedCashInput) - state.cashOnHand))}
                    </p>
                  )}
                {Number.isFinite(Number(modalCountedCashInput)) &&
                  Number(modalCountedCashInput) < cashBackedSummary.totalAllocatedFunds && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                      <span>
                        Al reducir la caja por debajo de los fondos asignados ({formatUSD(cashBackedSummary.totalAllocatedFunds)}), los fondos se reajustarán proporcionalmente para mantener Suma de Fondos ≤ Caja Física.
                      </span>
                    </div>
                  )}
              </div>

              <div>
                <label
                  htmlFor="modal-arqueo-reason"
                  className="block text-xs font-medium text-slate-300"
                >
                  Motivo / Nota del arqueo
                </label>
                <input
                  id="modal-arqueo-reason"
                  type="text"
                  placeholder="Ej. Conteo físico de billetes y Binance USDT"
                  value={modalReconcileReason}
                  onChange={(e) => setModalReconcileReason(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-700 bg-[#070D19] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsArqueoModalOpen(false)}
                  className="min-h-[40px] rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  data-testid="btn-confirm-arqueo"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
                  Guardar Arqueo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
