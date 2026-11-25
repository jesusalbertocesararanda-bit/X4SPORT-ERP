import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CalendarRange,
  CheckCircle2,
  Download,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  AppState,
  PartnerName,
  ShippingType,
  TeamCategory,
} from '../types/erp';
import {
  formatUSD,
  getTodayLocalDateIso,
  getTotalInventoryCostValue,
  getTotalReceivables,
  getTotalUnits,
  isUnassignedSeller,
  round2,
} from '../utils/finance';
import {
  buildRecommendedOrderExcelSheet,
  computeModelCostHistory,
  computeSalesRanking,
  computeSmartOrderRecommendation,
  getAvailableModelsForCostHistory,
  type RankingPeriodMode,
} from '../utils/statistics';

import type { ResolvedTheme } from '../utils/theme';

interface StatsViewProps {
  state: AppState;
  resolvedTheme?: ResolvedTheme;
}

const CHART_TEAMS: TeamCategory[] = [
  'Barcelona',
  'Real Madrid',
  'Manchester City',
  'PSG',
  'Selecciones',
  'Otro',
];

const SELLERS: PartnerName[] = ['Jesús', 'Josué', 'Gabriel'];

export function StatsView({ state, resolvedTheme = 'dark' }: StatsViewProps) {
  const isLightMode = resolvedTheme === 'light';
  const chartTextColor = isLightMode ? '#334155' : '#CBD5E1';
  const chartTickColor = isLightMode ? '#475569' : '#94A3B8';
  const chartAxisLabelColor = isLightMode ? '#1E293B' : '#E2E8F0';
  const chartGridColor = isLightMode
    ? 'rgba(15, 23, 42, 0.08)'
    : 'rgba(148, 163, 184, 0.1)';
  const chartSurfaceBorder = isLightMode ? '#FFFFFF' : '#0D1526';
  const todayIso = useMemo(() => getTodayLocalDateIso(), []);
  const currentMonthIso = useMemo(() => todayIso.slice(0, 7), [todayIso]);

  // Existing chart refs
  const inventoryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const matrixCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const receivablesCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // New analytics chart refs
  const sizeRankingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const costHistoryCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 1. Ranking Semanal / Mensual state
  const [periodMode, setPeriodMode] = useState<RankingPeriodMode>('month');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthIso);
  const [customFrom, setCustomFrom] = useState<string>(
    `${currentMonthIso}-01`,
  );
  const [customTo, setCustomTo] = useState<string>(todayIso);

  // 2. Historial de Precios y Costos por Modelo state
  const availableModels = useMemo(
    () => getAvailableModelsForCostHistory(state),
    [state],
  );
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const effectiveModelKey = useMemo(() => {
    if (
      selectedModelKey &&
      availableModels.some((m) => m.key === selectedModelKey)
    ) {
      return selectedModelKey;
    }
    return availableModels[0]?.key ?? '';
  }, [availableModels, selectedModelKey]);

  // 3. Recomendador Inteligente de Pedidos state
  const [capitalInput, setCapitalInput] = useState<string>('500');
  const [orderShippingType, setOrderShippingType] =
    useState<ShippingType>('Aéreo');
  const [exportFeedback, setExportFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const totalUnits = getTotalUnits(state);
  const totalInvCost = getTotalInventoryCostValue(state);
  const totalReceivables = getTotalReceivables(state);
  const activeSales = useMemo(
    () => state.sales.filter((s) => !s.voided),
    [state.sales],
  );
  const totalSalesRevenue = round2(
    activeSales.reduce((sum, s) => sum + s.finalPrice, 0),
  );

  const sellerStats = useMemo(() => {
    return SELLERS.map((seller) => {
      const sellerSales = activeSales.filter((s) => s.seller === seller);
      const totalSold = round2(
        sellerSales.reduce((sum, s) => sum + s.finalPrice, 0),
      );
      const unitsSold = sellerSales.reduce((sum, s) => sum + s.quantity, 0);
      const commissionEarned = round2(state.funds.commissionsBySeller[seller]);
      return {
        seller,
        salesCount: sellerSales.length,
        unitsSold,
        totalSold,
        commissionEarned,
      };
    });
  }, [activeSales, state.funds.commissionsBySeller]);

  const ranking = useMemo(
    () =>
      computeSalesRanking(state, periodMode, {
        anchorDate: todayIso,
        monthStr: selectedMonth,
        customFrom,
        customTo,
      }),
    [customFrom, customTo, periodMode, selectedMonth, state, todayIso],
  );

  const modelCostHistory = useMemo(
    () => computeModelCostHistory(state, effectiveModelKey),
    [effectiveModelKey, state],
  );

  const parsedCapitalUsd = useMemo(() => {
    const n = Number(capitalInput);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  }, [capitalInput]);

  const recommendation = useMemo(
    () =>
      computeSmartOrderRecommendation(
        state,
        parsedCapitalUsd,
        orderShippingType,
        todayIso,
      ),
    [orderShippingType, parsedCapitalUsd, state, todayIso],
  );

  // Existing Chart 1: Inventory distribution by team (units)
  useEffect(() => {
    const canvas = inventoryCanvasRef.current;
    if (!canvas) return;

    const dynamicTeams = Array.from(
      new Set([
        ...CHART_TEAMS,
        ...state.inventory.map((i) => i.team).filter(Boolean),
      ]),
    );

    const activePairs = dynamicTeams
      .map((label) => ({
        label,
        value: state.inventory
          .filter((item) => item.team === label)
          .reduce((sum, item) => sum + item.stock, 0),
      }))
      .filter((p) => p.value > 0);

    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: activePairs.map((p) => p.label),
        datasets: [
          {
            data: activePairs.map((p) => p.value),
            backgroundColor: [
              '#2563EB',
              isLightMode ? '#CBD5E1' : '#F8FAFC',
              '#38BDF8',
              '#6366F1',
              '#10B981',
              '#94A3B8',
            ],
            borderColor: chartSurfaceBorder,
            borderWidth: 2,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: chartTextColor,
              padding: 14,
              font: { family: 'Plus Jakarta Sans', size: 12 },
            },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [chartSurfaceBorder, chartTextColor, isLightMode, state.inventory]);

  // Existing Chart 2: 4-Layer Matrix Accumulated Funds + Partner Dividends
  useEffect(() => {
    const canvas = matrixCanvasRef.current;
    if (!canvas) return;

    const dividendsTotal = round2(
      state.funds.dividendsByPartner.Jesús +
        state.funds.dividendsByPartner.Josué +
        state.funds.dividendsByPartner.Gabriel,
    );

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: [
          'Reposición',
          'Comisiones',
          'Operativo',
          'Reinversión',
          'Dividendos',
        ],
        datasets: [
          {
            label: 'Acumulado (USDT)',
            data: [
              state.funds.replacement,
              state.funds.commissions,
              state.funds.operatingAndAds,
              state.funds.growthReinvestment,
              dividendsTotal,
            ],
            backgroundColor: [
              '#3B82F6',
              '#60A5FA',
              '#93C5FD',
              '#10B981',
              '#F59E0B',
            ],
            borderRadius: 6,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: chartTextColor, font: { size: 11 } },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: chartTickColor,
              callback: (val) => `$${val}`,
            },
            grid: { color: chartGridColor },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });

    return () => chart.destroy();
  }, [chartGridColor, chartTextColor, chartTickColor, state.funds]);

  // Existing Chart 3: Receivables breakdown OR Sales by Seller
  useEffect(() => {
    const canvas = receivablesCanvasRef.current;
    if (!canvas) return;

    const salesBySeller = SELLERS.map((seller) =>
      round2(
        activeSales
          .filter((s) => s.seller === seller)
          .reduce((sum, s) => sum + s.finalPrice, 0),
      ),
    );
    const noSellerSales = round2(
      activeSales
        .filter((s) => isUnassignedSeller(s.seller))
        .reduce((sum, s) => sum + s.finalPrice, 0),
    );

    const hasSales = activeSales.length > 0;

    const labels = hasSales
      ? ['Jesús', 'Josué', 'Gabriel', 'Sin Asignar']
      : state.receivables.map((r) => r.debtor);

    const values = hasSales
      ? [...salesBySeller, noSellerSales]
      : state.receivables.map((r) => r.amount);

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: hasSales ? 'Ventas (USDT)' : 'Por Cobrar (USDT)',
            data: values,
            backgroundColor: hasSales ? '#2563EB' : '#F59E0B',
            borderRadius: 6,
          },
        ],
      },
      options: {
        animation: false,
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              color: chartTickColor,
              callback: (val) => `$${val}`,
            },
            grid: { color: chartGridColor },
          },
          y: {
            ticks: { color: chartAxisLabelColor, font: { size: 11 } },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });

    return () => chart.destroy();
  }, [activeSales, chartAxisLabelColor, chartGridColor, chartTickColor, state.receivables]);

  // New Chart 4: Size Ranking (Units)
  useEffect(() => {
    const canvas = sizeRankingCanvasRef.current;
    if (!canvas) return;

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ranking.sizeRanking.map((r) => `Talla ${r.size}`),
        datasets: [
          {
            label: 'Unidades Vendidas',
            data: ranking.sizeRanking.map((r) => r.unitsSold),
            backgroundColor: '#3B82F6',
            borderRadius: 6,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: chartTextColor, font: { size: 11 } },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: chartTickColor,
            },
            grid: { color: chartGridColor },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });

    return () => chart.destroy();
  }, [chartGridColor, chartTextColor, chartTickColor, ranking.sizeRanking]);

  // New Chart 5: Model Cost Evolution vs Sale Price
  useEffect(() => {
    const canvas = costHistoryCanvasRef.current;
    if (!canvas || !modelCostHistory || modelCostHistory.entries.length === 0) {
      return;
    }

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: modelCostHistory.entries.map(
          (e) => `${e.entryDate} (${e.size})`,
        ),
        datasets: [
          {
            label: 'Costo Import. Landed (USDT)',
            data: modelCostHistory.entries.map((e) => e.landedUnitCost),
            borderColor: '#F59E0B',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            tension: 0.25,
            fill: false,
            pointRadius: 4,
          },
          {
            label: 'Precio de Venta (USDT)',
            data: modelCostHistory.entries.map((e) => e.salePrice),
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            tension: 0.25,
            fill: false,
            pointRadius: 4,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: chartTextColor, font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: chartTickColor,
              callback: (val) => `$${val}`,
            },
            grid: { color: chartGridColor },
          },
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: chartTextColor,
              font: { family: 'Plus Jakarta Sans', size: 11 },
            },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [chartGridColor, chartTextColor, chartTickColor, modelCostHistory]);

  const handleDownloadRecommendedOrder = () => {
    setExportFeedback(null);
    if (recommendation.lines.length === 0) {
      setExportFeedback({
        type: 'error',
        text: 'Ingresa un capital mayor a $0.00 USDT que alcance al menos para 1 franela antes de exportar.',
      });
      return;
    }
    if (typeof window === 'undefined' || !window.XLSX) {
      setExportFeedback({
        type: 'error',
        text: 'Librería SheetJS (xlsx) aún no disponible en este navegador.',
      });
      return;
    }

    const spec = buildRecommendedOrderExcelSheet(
      recommendation,
      state.exchangeRates.usdt,
      todayIso,
    );
    const XLSX = window.XLSX;
    const ws = XLSX.utils.aoa_to_sheet([[...spec.headers], ...spec.rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
    XLSX.writeFile(wb, spec.fileName);

    setExportFeedback({
      type: 'success',
      text: `Pedido recomendado (${recommendation.totalUnits} uds · ${formatUSD(recommendation.totalAllocatedUsd)}) descargado con la plantilla oficial de Compras Masivas.`,
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Estadísticas, Costos y Compras Inteligentes
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Ranking de ventas semanal/mensual, evolución de costos de importación por modelo, recomendador de pedidos y comisiones de socios.
        </p>
      </div>

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
          <span className="text-xs text-slate-400">Unidades en Bodega</span>
          <p className="font-mono-num mt-1 text-xl font-bold text-white">
            {totalUnits}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
          <span className="text-xs text-slate-400">Valor COGS FIFO</span>
          <p className="font-mono-num mt-1 text-xl font-bold text-white">
            {formatUSD(totalInvCost)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
          <span className="text-xs text-slate-400">Ingresos por Ventas</span>
          <p className="font-mono-num mt-1 text-xl font-bold text-blue-300">
            {formatUSD(totalSalesRevenue)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
          <span className="text-xs text-slate-400">Cartera por Cobrar</span>
          <p className="font-mono-num mt-1 text-xl font-bold text-amber-400">
            {formatUSD(totalReceivables)}
          </p>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 1. RANKING SEMANAL Y MENSUAL                                         */}
      {/* ==================================================================== */}
      <section
        aria-labelledby="ranking-section-heading"
        data-testid="stats-ranking-section"
        className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-400" aria-hidden="true" />
              <h2
                id="ranking-section-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Ranking Semanal y Mensual de Franelas y Tallas
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Período activo:{' '}
              <span className="font-mono-num font-semibold text-slate-200">
                {ranking.dateFrom || 'Inicio'} — {ranking.dateTo || 'Hoy'}
              </span>{' '}
              · Total:{' '}
              <span className="font-mono-num font-semibold text-blue-300">
                {ranking.totalUnitsSold} uds ({formatUSD(ranking.totalRevenueUsd)})
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-800 bg-[#080E1C] p-1">
              {(
                [
                  { id: 'week', label: 'Por Semana' },
                  { id: 'month', label: 'Por Mes' },
                  { id: 'custom', label: 'Personalizado' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPeriodMode(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    periodMode === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {periodMode === 'month' && (
              <input
                type="month"
                aria-label="Seleccionar mes de ranking"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-xl border border-slate-700 bg-[#080E1C] px-3 py-1.5 text-xs text-slate-200"
              />
            )}

            {periodMode === 'custom' && (
              <div className="flex items-center gap-1.5 text-xs">
                <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <input
                  type="date"
                  aria-label="Fecha desde"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-[#080E1C] px-2.5 py-1.5 text-xs text-slate-200"
                />
                <span className="text-slate-500">—</span>
                <input
                  type="date"
                  aria-label="Fecha hasta"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-[#080E1C] px-2.5 py-1.5 text-xs text-slate-200"
                />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Franelas más vendidas */}
          <div className="lg:col-span-7 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              Franelas Más Vendidas (Unidades y %)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#080E1C]">
              <table className="w-full min-w-[500px] text-left text-xs">
                <thead className="border-b border-slate-800 bg-[#0B1222] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">#</th>
                    <th className="px-3 py-2.5">Modelo / Versión</th>
                    <th className="px-3 py-2.5 text-right">Uds</th>
                    <th className="px-3 py-2.5 w-36">% Partic.</th>
                    <th className="px-3 py-2.5 text-right">Ingresos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {ranking.topModels.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        Sin ventas registradas en este período. Cambia el rango o selecciona otro mes.
                      </td>
                    </tr>
                  ) : (
                    ranking.topModels.slice(0, 10).map((row, idx) => (
                      <tr key={row.key} className="hover:bg-slate-800/30">
                        <td className="font-mono-num px-3 py-2.5 text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-semibold text-white">
                            {row.modelLabel}
                          </span>
                          <span className="ml-2 text-[11px] text-slate-400">
                            {row.version}
                          </span>
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right font-bold text-white">
                          {row.unitsSold}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${Math.min(100, row.pct)}%` }}
                              />
                            </div>
                            <span className="font-mono-num w-11 text-right text-[11px] font-semibold text-blue-300">
                              {row.pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right text-emerald-300">
                          {formatUSD(row.revenueUsd)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tallas más vendidas */}
          <div className="lg:col-span-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              Tallas Más Vendidas (S, M, L, XL, XXL)
            </h3>
            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-4 space-y-3">
              {ranking.sizeRanking.map((sz) => (
                <div key={sz.size} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">
                      Talla {sz.size}
                    </span>
                    <span className="font-mono-num text-slate-300">
                      <strong className="text-white">{sz.unitsSold} uds</strong>{' '}
                      <span className="text-blue-300">({sz.pct.toFixed(1)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${Math.min(100, sz.pct)}%` }}
                    />
                  </div>
                </div>
              ))}

              <div className="relative mt-4 h-36 w-full border-t border-slate-800 pt-3">
                <canvas
                  ref={sizeRankingCanvasRef}
                  aria-label="Gráfico de tallas más vendidas"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 2. HISTORIAL DE PRECIOS Y COSTOS POR MODELO                          */}
      {/* ==================================================================== */}
      <section
        aria-labelledby="cost-history-heading"
        data-testid="stats-cost-history-section"
        className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="cost-history-heading"
              className="font-display text-lg font-semibold text-white"
            >
              Historial de Precios y Costos por Modelo (1688/Alibaba + Flete)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Compara la evolución del costo unitario de importación en cada lote histórico frente al precio de venta y margen real.
            </p>
          </div>

          <select
            aria-label="Seleccionar modelo para historial de costos"
            value={effectiveModelKey}
            onChange={(e) => setSelectedModelKey(e.target.value)}
            className="min-w-[260px] rounded-xl border border-slate-700 bg-[#080E1C] px-3 py-2 text-xs font-medium text-white"
          >
            {availableModels.length === 0 ? (
              <option value="">Sin modelos registrados</option>
            ) : (
              availableModels.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.model} ({opt.version})
                </option>
              ))
            )}
          </select>
        </div>

        {!modelCostHistory ? (
          <p className="py-4 text-xs text-slate-400">
            Registra compras o inventario para visualizar el historial de precios y costos por modelo.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
                <span className="text-[11px] text-slate-400">
                  Último Costo Landed
                </span>
                <p className="font-mono-num mt-0.5 text-lg font-bold text-white">
                  {formatUSD(modelCostHistory.lastLandedCost)}
                </p>
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                  {modelCostHistory.costDeltaUsd > 0 ? (
                    <TrendingUp className="h-3 w-3 text-amber-400" aria-hidden="true" />
                  ) : modelCostHistory.costDeltaUsd < 0 ? (
                    <TrendingDown className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                  ) : null}
                  Var: {modelCostHistory.costDeltaUsd >= 0 ? '+' : ''}
                  {formatUSD(modelCostHistory.costDeltaUsd)} ({modelCostHistory.costDeltaPct}%)
                </span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
                <span className="text-[11px] text-slate-400">
                  Costo Promedio Import.
                </span>
                <p className="font-mono-num mt-0.5 text-lg font-bold text-blue-300">
                  {formatUSD(modelCostHistory.avgLandedCost)}
                </p>
                <span className="text-[11px] text-slate-400">
                  Inicial: {formatUSD(modelCostHistory.firstLandedCost)}
                </span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
                <span className="text-[11px] text-slate-400">
                  Precio Venta Real Prom.
                </span>
                <p className="font-mono-num mt-0.5 text-lg font-bold text-white">
                  {formatUSD(modelCostHistory.realAvgSalePrice)}
                </p>
                <span className="text-[11px] text-slate-400">
                  {modelCostHistory.unitsSoldTotal} uds vendidas
                </span>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <span className="text-[11px] text-emerald-300">
                  Margen Unitario Real
                </span>
                <p className="font-mono-num mt-0.5 text-lg font-bold text-emerald-300">
                  {formatUSD(modelCostHistory.currentMarginUsd)}
                </p>
                <span className="font-mono-num text-[11px] text-emerald-200">
                  {modelCostHistory.currentMarginPct.toFixed(1)}% sobre venta
                </span>
              </div>
            </div>

            {modelCostHistory.entries.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-4">
                <div className="relative h-56 w-full">
                  <canvas
                    ref={costHistoryCanvasRef}
                    aria-label="Evolución de costo landed frente a precio de venta"
                  />
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#080E1C]">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="border-b border-slate-800 bg-[#0B1222] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Fecha</th>
                    <th className="px-3 py-2.5">Lote</th>
                    <th className="px-3 py-2.5">Proveedor</th>
                    <th className="px-3 py-2.5">Import.</th>
                    <th className="px-3 py-2.5">Talla</th>
                    <th className="px-3 py-2.5 text-right">Uds</th>
                    <th className="px-3 py-2.5 text-right">Fábrica</th>
                    <th className="px-3 py-2.5 text-right">Flete Unit.</th>
                    <th className="px-3 py-2.5 text-right">Costo Total</th>
                    <th className="px-3 py-2.5 text-right">Venta</th>
                    <th className="px-3 py-2.5 text-right">Margen Real</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {modelCostHistory.entries.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-6 text-center text-slate-400">
                        Sin entradas históricas de compra registradas para este modelo.
                      </td>
                    </tr>
                  ) : (
                    modelCostHistory.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-800/30">
                        <td className="font-mono-num px-3 py-2.5 text-slate-300 whitespace-nowrap">
                          {entry.entryDate}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-white">
                          {entry.batchName}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300">
                          {entry.supplier}
                        </td>
                        <td className="px-3 py-2.5 text-slate-400">
                          {entry.shippingType}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-white">
                          {entry.size}
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right text-slate-300">
                          {entry.quantity}
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right text-slate-300">
                          {formatUSD(entry.factoryUnitCost)}
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right text-slate-300">
                          {formatUSD(entry.freightPerUnit)}
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right font-semibold text-amber-300">
                          {formatUSD(entry.landedUnitCost)}
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right text-white">
                          {formatUSD(entry.salePrice)}
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right font-semibold text-emerald-400">
                          {formatUSD(entry.realMarginUsd)} ({entry.realMarginPct.toFixed(1)}%)
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ==================================================================== */}
      {/* 3. RECOMENDADOR INTELIGENTE DE PEDIDOS                               */}
      {/* ==================================================================== */}
      <section
        aria-labelledby="smart-order-heading"
        data-testid="stats-smart-order-section"
        className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-emerald-400" aria-hidden="true" />
              <h2
                id="smart-order-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Recomendador Inteligente de Pedidos
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {recommendation.sourceNote}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="smart-order-capital"
                className="block text-[11px] font-semibold text-slate-300 mb-1"
              >
                Capital disponible para invertir (USDT)
              </label>
              <input
                id="smart-order-capital"
                type="number"
                min="0"
                step="10"
                value={capitalInput}
                onChange={(e) => setCapitalInput(e.target.value)}
                className="font-mono-num w-44 rounded-xl border border-slate-700 bg-[#080E1C] px-3 py-2 text-xs font-semibold text-white"
              />
            </div>

            <div>
              <label
                htmlFor="smart-order-shipping"
                className="block text-[11px] font-semibold text-slate-300 mb-1"
              >
                Tipo de Importación
              </label>
              <select
                id="smart-order-shipping"
                value={orderShippingType}
                onChange={(e) =>
                  setOrderShippingType(e.target.value as ShippingType)
                }
                className="rounded-xl border border-slate-700 bg-[#080E1C] px-3 py-2 text-xs font-semibold text-white"
              >
                <option value="Aéreo">Aéreo</option>
                <option value="Marítimo">Marítimo</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleDownloadRecommendedOrder}
              disabled={recommendation.lines.length === 0}
              className="inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              Descargar Pedido Recomendado (.xlsx)
            </button>
          </div>
        </div>

        {exportFeedback && (
          <div
            role={exportFeedback.type === 'error' ? 'alert' : 'status'}
            className={`flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-medium ${
              exportFeedback.type === 'error'
                ? 'border border-red-500/35 bg-red-500/10 text-red-200'
                : 'border border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            {exportFeedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            )}
            <span>{exportFeedback.text}</span>
          </div>
        )}

        {/* Alerta de Modelos de baja rotación (No traer en exceso) */}
        {recommendation.lowRotationAlerts.length > 0 && (
          <div
            role="region"
            aria-label="Modelos de baja rotación"
            data-testid="low-rotation-alerts"
            className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-2.5"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                Modelos de baja rotación (No traer en exceso) — {recommendation.lowRotationAlerts.length} SKU(s) excluidos del pedido
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recommendation.lowRotationAlerts.slice(0, 9).map((alert) => (
                <div
                  key={alert.skuId}
                  className="rounded-lg border border-amber-500/25 bg-[#080E1C]/80 px-3 py-2 text-xs"
                >
                  <p className="font-semibold text-white">
                    {alert.model}{' '}
                    <span className="text-amber-300">
                      ({alert.version} · {alert.size})
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-200/90">
                    {alert.reason}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Budget Allocation KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
            <span className="text-[11px] text-slate-400">Unidades a Pedir</span>
            <p className="font-mono-num mt-0.5 text-lg font-bold text-white">
              {recommendation.totalUnits} uds
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
            <span className="text-[11px] text-slate-400">Inversión Asignada</span>
            <p className="font-mono-num mt-0.5 text-lg font-bold text-emerald-400">
              {formatUSD(recommendation.totalAllocatedUsd)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
            <span className="text-[11px] text-slate-400">Remanente Libre</span>
            <p className="font-mono-num mt-0.5 text-lg font-bold text-blue-300">
              {formatUSD(recommendation.remainingUsd)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
            <span className="text-[11px] text-slate-400">Mix por Tallas</span>
            <p className="font-mono-num mt-1 text-[11px] text-slate-200">
              {recommendation.sizeBreakdown
                .filter((s) => s.units > 0)
                .map((s) => `${s.size}:${s.units}`)
                .join(' · ') || '—'}
            </p>
          </div>
        </div>

        {/* Recommended Order Lines Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#080E1C]">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead className="border-b border-slate-800 bg-[#0B1222] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Modelo</th>
                <th className="px-3 py-2.5">Versión</th>
                <th className="px-3 py-2.5">Talla</th>
                <th className="px-3 py-2.5 text-right">Stock Act.</th>
                <th className="px-3 py-2.5 text-right">Vendidas</th>
                <th className="px-3 py-2.5 text-right">% Demanda</th>
                <th className="px-3 py-2.5 text-right">Costo Prom.</th>
                <th className="px-3 py-2.5 text-right">Pedir (Uds)</th>
                <th className="px-3 py-2.5 text-right">Subtotal USDT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {recommendation.lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                    Ajusta el capital disponible en USDT para generar el desglose exacto del pedido recomendado.
                  </td>
                </tr>
              ) : (
                recommendation.lines.map((line) => (
                  <tr
                    key={`${line.model}-${line.version}-${line.size}`}
                    className="hover:bg-slate-800/30"
                  >
                    <td className="px-3 py-2.5 font-semibold text-white">
                      {line.model}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{line.version}</td>
                    <td className="px-3 py-2.5 font-semibold text-blue-300">
                      {line.size}
                    </td>
                    <td className="font-mono-num px-3 py-2.5 text-right text-slate-400">
                      {line.currentStock}
                    </td>
                    <td className="font-mono-num px-3 py-2.5 text-right text-slate-300">
                      {line.historicalSold}
                    </td>
                    <td className="font-mono-num px-3 py-2.5 text-right text-slate-300">
                      {line.salesSharePct.toFixed(1)}%
                    </td>
                    <td className="font-mono-num px-3 py-2.5 text-right text-amber-300">
                      {formatUSD(line.landedUnitCost)}
                    </td>
                    <td className="font-mono-num px-3 py-2.5 text-right font-bold text-emerald-400">
                      {line.recommendedQty}
                    </td>
                    <td className="font-mono-num px-3 py-2.5 text-right font-semibold text-white">
                      {formatUSD(line.lineTotalCost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* EXISTING SELLER COMMISSIONS & GLOBAL CHARTS                          */}
      {/* ==================================================================== */}
      <section
        aria-labelledby="seller-commissions-heading"
        className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="seller-commissions-heading"
              className="font-display text-lg font-semibold text-white"
            >
              Rendimiento y Comisiones por Vendedor (4%)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Total vendido por cada vendedor y monto acumulado correspondiente a la Capa 2.
            </p>
          </div>
          <span className="font-mono-num text-xs text-slate-300">
            Total Comisiones: <strong className="text-emerald-400">{formatUSD(state.funds.commissions)}</strong>
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {sellerStats.map((row) => (
            <article
              key={row.seller}
              data-testid={`seller-card-${row.seller}`}
              className="rounded-lg border border-slate-800 bg-[#080E1C] p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-white">
                  {row.seller}
                </h3>
                <span className="font-mono-num text-xs text-slate-400">
                  {row.salesCount} {row.salesCount === 1 ? 'venta' : 'ventas'} · {row.unitsSold} uds
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between border-t border-slate-800/80 pt-3">
                <div>
                  <span className="block text-[11px] text-slate-400">Total Vendido</span>
                  <span className="font-mono-num text-lg font-bold text-white">
                    {formatUSD(row.totalSold)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="block text-[11px] text-slate-400">Comisión 4%</span>
                  <span className="font-mono-num text-lg font-bold text-emerald-400">
                    {formatUSD(row.commissionEarned)}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-white">
            Distribución de Inventario por Equipo (Unidades)
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Participación actual de modelos en bodega.
          </p>
          <div className="relative mt-4 h-72 w-full">
            <canvas
              ref={inventoryCanvasRef}
              data-testid="chart-inventory"
              aria-label="Gráfico de distribución de inventario por equipo"
            />
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-white">
            Acumulado de la Matriz de 4 Capas (USDT)
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Distribución contable acumulada de las ventas registradas.
          </p>
          <div className="relative mt-4 h-72 w-full">
            <canvas
              ref={matrixCanvasRef}
              data-testid="chart-matrix"
              aria-label="Gráfico de acumulado de la matriz de 4 capas"
            />
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6">
        <h2 className="font-display text-base font-semibold text-white">
          {state.sales.length > 0
            ? 'Rendimiento Comercial por Vendedor (USDT)'
            : 'Distribución Actual de Cuentas por Cobrar (USDT)'}
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {state.sales.length > 0
            ? 'Volumen total vendido por cada responsable asignado.'
            : 'Al registrar ventas se mostrará el rendimiento por vendedor; actualmente refleja la cartera pendiente.'}
        </p>
        <div className="relative mt-4 h-56 w-full">
          <canvas
            ref={receivablesCanvasRef}
            data-testid="chart-performance"
            aria-label="Gráfico de rendimiento comercial y cuentas por cobrar"
          />
        </div>
      </section>
    </div>
  );
}
