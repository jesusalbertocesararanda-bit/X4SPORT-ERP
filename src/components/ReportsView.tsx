import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeftRight,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Filter,
  PackageCheck,
  RotateCcw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Users,
} from 'lucide-react';
import type { AppState } from '../types/erp';
import { formatUSD } from '../utils/finance';
import {
  buildReportExcelSheetData,
  countActiveReportFilters,
  DEFAULT_REPORT_FILTERS,
  filterAdjustmentsReportRows,
  filterAvailableStockReportRows,
  filterBulkImportsReportRows,
  filterCustomersReportRows,
  filterPurchasesReportRows,
  filterReturnsReportRows,
  filterSalesReportRows,
  filterStockMovementsReportRows,
  type ReportFilters,
  type ReportSummaryTotals,
  type ReportType,
} from '../utils/reports';

interface ReportsViewProps {
  state: AppState;
}

interface ReportTabMeta {
  id: ReportType;
  label: string;
  shortLabel: string;
  icon: typeof ShoppingBag;
  description: string;
  applicableFilters: (keyof ReportFilters)[];
  totalUsdLabel: string;
  totalUnitsLabel: string;
}

const REPORT_TABS: ReportTabMeta[] = [
  {
    id: 'ventas',
    label: 'Ventas',
    shortLabel: 'Ventas',
    icon: ShoppingBag,
    description: 'Detalle por línea vendida, vendedor, condición contado/crédito y método de pago.',
    applicableFilters: [
      'dateFrom',
      'dateTo',
      'search',
      'size',
      'version',
      'customer',
      'city',
      'seller',
      'paymentCondition',
      'amountMin',
      'amountMax',
    ],
    totalUsdLabel: 'Total Facturado (USDT)',
    totalUnitsLabel: 'Total Unidades',
  },
  {
    id: 'compras',
    label: 'Compras',
    shortLabel: 'Compras',
    icon: ShoppingCart,
    description: 'Lotes e ítems de importación marítima y aérea, costo landed y tasa USDT.',
    applicableFilters: [
      'dateFrom',
      'dateTo',
      'search',
      'size',
      'version',
      'shippingType',
      'amountMin',
      'amountMax',
    ],
    totalUsdLabel: 'Total Landed (USDT)',
    totalUnitsLabel: 'Total Unidades',
  },
  {
    id: 'clientes',
    label: 'Clientes',
    shortLabel: 'Clientes',
    icon: Users,
    description: 'Directorio consolidado de clientes, compras filtradas, unidades y saldo CxC.',
    applicableFilters: [
      'dateFrom',
      'dateTo',
      'search',
      'size',
      'version',
      'customer',
      'city',
      'seller',
      'paymentCondition',
      'amountMin',
      'amountMax',
    ],
    totalUsdLabel: 'Total Comprado (USDT)',
    totalUnitsLabel: 'Total Unidades',
  },
  {
    id: 'devoluciones',
    label: 'Devoluciones y Cambios',
    shortLabel: 'Devoluciones y Cambios',
    icon: ArrowLeftRight,
    description: 'Cambios de talla/modelo, reembolsos y diferencias netas en caja.',
    applicableFilters: [
      'dateFrom',
      'dateTo',
      'search',
      'size',
      'version',
      'customer',
      'city',
      'seller',
      'amountMin',
      'amountMax',
    ],
    totalUsdLabel: 'Diferencia Neta (USDT)',
    totalUnitsLabel: 'Unidades Devueltas',
  },
  {
    id: 'ajustes',
    label: 'Ajustes de Inventario',
    shortLabel: 'Ajustes de Inventario',
    icon: ClipboardList,
    description: 'Entradas, salidas manuales, descruces y merma FIFO auditada.',
    applicableFilters: [
      'dateFrom',
      'dateTo',
      'search',
      'size',
      'version',
      'amountMin',
      'amountMax',
    ],
    totalUsdLabel: 'Merma FIFO (USDT)',
    totalUnitsLabel: 'Variación Neta (uds)',
  },
  {
    id: 'movimientos',
    label: 'Salidas y Entradas',
    shortLabel: 'Salidas y Entradas',
    icon: ArrowDownUp,
    description: 'Movimientos consolidados de stock: compras, ventas, devoluciones y ajustes.',
    applicableFilters: [
      'dateFrom',
      'dateTo',
      'search',
      'size',
      'version',
      'customer',
      'city',
      'seller',
      'paymentCondition',
      'shippingType',
      'amountMin',
      'amountMax',
    ],
    totalUsdLabel: 'Valor Movimientos (USDT)',
    totalUnitsLabel: 'Unidades Movidas',
  },
  {
    id: 'cargas',
    label: 'Cargas Masivas',
    shortLabel: 'Cargas Masivas',
    icon: FileSpreadsheet,
    description: 'Historial de importaciones de respaldo y sincronizaciones por Excel (.xlsx).',
    applicableFilters: [
      'dateFrom',
      'dateTo',
      'search',
      'amountMin',
      'amountMax',
    ],
    totalUsdLabel: 'Volumen Importado (USDT)',
    totalUnitsLabel: 'Unidades Procesadas',
  },
  {
    id: 'inventario',
    label: 'Stock Disponible',
    shortLabel: 'Stock Disponible',
    icon: PackageCheck,
    description: 'Franelas disponibles en stock (> 0 uds) desglosadas por talla, PVP y valor FIFO.',
    applicableFilters: ['search', 'size', 'version', 'amountMin', 'amountMax'],
    totalUsdLabel: 'Valor Inventario FIFO (USDT)',
    totalUnitsLabel: 'Total Disponible (uds)',
  },
];

const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;

export function ReportsView({ state }: ReportsViewProps) {
  const [reportType, setReportType] = useState<ReportType>('ventas');
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const activeTabMeta = useMemo(
    () => REPORT_TABS.find((t) => t.id === reportType) ?? REPORT_TABS[0],
    [reportType],
  );

  const supportsFilter = (key: keyof ReportFilters) =>
    activeTabMeta.applicableFilters.includes(key);

  const activeFilterCount = useMemo(
    () => countActiveReportFilters(filters, activeTabMeta.applicableFilters),
    [filters, activeTabMeta],
  );

  // Suggestions for Ciudad & Cliente datalists
  const { knownCustomers, knownCities } = useMemo(() => {
    const custSet = new Set<string>();
    const citySet = new Set<string>();

    (state.customers ?? []).forEach((c) => {
      if (c.name?.trim()) custSet.add(c.name.trim());
      if (c.city?.trim()) citySet.add(c.city.trim());
    });
    (state.sales ?? []).forEach((s) => {
      if (s.customerName?.trim()) custSet.add(s.customerName.trim());
      if (s.customerCity?.trim()) citySet.add(s.customerCity.trim());
    });
    (state.receivables ?? []).forEach((r) => {
      if (r.debtor?.trim()) custSet.add(r.debtor.trim());
    });

    return {
      knownCustomers: Array.from(custSet).sort((a, b) => a.localeCompare(b)),
      knownCities: Array.from(citySet).sort((a, b) => a.localeCompare(b)),
    };
  }, [state.customers, state.sales, state.receivables]);

  // Filtered datasets for each of the 8 views
  const salesResult = useMemo(
    () => filterSalesReportRows(state, filters),
    [state, filters],
  );
  const purchasesResult = useMemo(
    () => filterPurchasesReportRows(state, filters),
    [state, filters],
  );
  const customersResult = useMemo(
    () => filterCustomersReportRows(state, filters),
    [state, filters],
  );
  const returnsResult = useMemo(
    () => filterReturnsReportRows(state, filters),
    [state, filters],
  );
  const adjustmentsResult = useMemo(
    () => filterAdjustmentsReportRows(state, filters),
    [state, filters],
  );
  const movementsResult = useMemo(
    () => filterStockMovementsReportRows(state, filters),
    [state, filters],
  );
  const bulkImportsResult = useMemo(
    () => filterBulkImportsReportRows(state, filters),
    [state, filters],
  );
  const availableStockResult = useMemo(
    () => filterAvailableStockReportRows(state, filters),
    [state, filters],
  );

  const activeTotals: ReportSummaryTotals = useMemo(() => {
    switch (reportType) {
      case 'ventas':
        return salesResult.totals;
      case 'compras':
        return purchasesResult.totals;
      case 'clientes':
        return customersResult.totals;
      case 'devoluciones':
        return returnsResult.totals;
      case 'ajustes':
        return adjustmentsResult.totals;
      case 'movimientos':
        return movementsResult.totals;
      case 'cargas':
        return bulkImportsResult.totals;
      case 'inventario':
        return availableStockResult.totals;
    }
  }, [
    reportType,
    salesResult.totals,
    purchasesResult.totals,
    customersResult.totals,
    returnsResult.totals,
    adjustmentsResult.totals,
    movementsResult.totals,
    bulkImportsResult.totals,
    availableStockResult.totals,
  ]);

  const updateFilter = <K extends keyof ReportFilters>(
    key: K,
    value: ReportFilters[K],
  ) => {
    setFeedback(null);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleClearFilters = () => {
    setFeedback(null);
    setFilters(DEFAULT_REPORT_FILTERS);
  };

  const handleExportExcel = () => {
    setFeedback(null);
    if (typeof window === 'undefined' || !window.XLSX) {
      setFeedback({
        type: 'error',
        text: 'La librería SheetJS (xlsx) aún está cargando o no está disponible sin conexión.',
      });
      return;
    }

    const payload = buildReportExcelSheetData(reportType, state, filters);
    if (payload.rows.length === 0) {
      setFeedback({
        type: 'error',
        text: 'No hay registros filtrados visibles para exportar en este reporte.',
      });
      return;
    }

    const XLSX = window.XLSX;
    const sheetData = [payload.headers, ...payload.rows, payload.totalsRow];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, payload.sheetName);
    XLSX.writeFile(wb, payload.fileName);

    setFeedback({
      type: 'success',
      text: `Reporte "${activeTabMeta.label}" exportado (${payload.rows.length} registros filtrados + fila de totales).`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-white sm:text-2xl">
            Reportes Operativos y Financieros
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {activeTabMeta.description}
          </p>
        </div>

        <button
          type="button"
          data-testid="btn-download-report-excel"
          onClick={handleExportExcel}
          className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-emerald-500"
        >
          <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
          Descargar Reporte en Excel (.xlsx)
        </button>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border border-red-500/35 bg-red-500/10 text-red-200'
              : 'border border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
          }`}
        >
          {feedback.type === 'error' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* 1. Selector de Tipo de Reporte (8 Vistas Unificadas) */}
      <div
        role="tablist"
        aria-label="Selector de tipo de reporte"
        className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-[#080E1C] p-2 sm:grid-cols-4 xl:grid-cols-8"
      >
        {REPORT_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = reportType === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`report-tab-${tab.id}`}
              onClick={() => {
                setFeedback(null);
                setReportType(tab.id);
              }}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all text-center ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-950/50'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="leading-tight">{tab.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* 2. Motor de Filtros Cruzados (Lógica AND en Tiempo Real) */}
      <div className="rounded-2xl border border-slate-800 bg-[#080E1C] p-4 sm:p-5 space-y-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Filter className="h-4 w-4 text-blue-400" aria-hidden="true" />
            <span>Motor de Filtros Cruzados (Lógica AND)</span>
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-md border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-300">
                {activeFilterCount} activo{activeFilterCount === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <button
            type="button"
            data-testid="btn-clear-report-filters"
            onClick={handleClearFilters}
            disabled={activeFilterCount === 0}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0D1526] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-45 disabled:pointer-events-none"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Limpiar Filtros
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {/* Fecha Desde */}
          {supportsFilter('dateFrom') && (
            <div>
              <label
                htmlFor="filter-date-from"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Fecha Desde
              </label>
              <input
                id="filter-date-from"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => updateFilter('dateFrom', e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          {/* Fecha Hasta */}
          {supportsFilter('dateTo') && (
            <div>
              <label
                htmlFor="filter-date-to"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Fecha Hasta
              </label>
              <input
                id="filter-date-to"
                type="date"
                value={filters.dateTo}
                onChange={(e) => updateFilter('dateTo', e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          {/* Buscador Modelo / Equipo / Jugador */}
          {supportsFilter('search') && (
            <div className="sm:col-span-2">
              <label
                htmlFor="filter-search"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                {reportType === 'cargas'
                  ? 'Archivo / Usuario / Hoja'
                  : 'Modelo / Equipo / Jugador / Ref.'}
              </label>
              <div className="relative">
                <Search
                  className="absolute left-3 top-2.5 h-4 w-4 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  id="filter-search"
                  type="text"
                  value={filters.search}
                  onChange={(e) => updateFilter('search', e.target.value)}
                  placeholder={
                    reportType === 'cargas'
                      ? 'Nombre de archivo .xlsx, usuario...'
                      : 'Ej. Real Madrid, Vinotinto, Yamal, #0001...'
                  }
                  className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] pl-9 pr-3 text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Talla */}
          {supportsFilter('size') && (
            <div>
              <label
                htmlFor="filter-size"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Talla
              </label>
              <select
                id="filter-size"
                value={filters.size}
                onChange={(e) => updateFilter('size', e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ALL">Todas las tallas</option>
                {STANDARD_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Versión */}
          {supportsFilter('version') && (
            <div>
              <label
                htmlFor="filter-version"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Versión
              </label>
              <select
                id="filter-version"
                value={filters.version}
                onChange={(e) => updateFilter('version', e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ALL">Todas las versiones</option>
                <option value="Player">Player</option>
                <option value="Retro">Retro</option>
                <option value="Fans">Fans</option>
              </select>
            </div>
          )}

          {/* Cliente */}
          {supportsFilter('customer') && (
            <div>
              <label
                htmlFor="filter-customer"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Cliente
              </label>
              <input
                id="filter-customer"
                type="text"
                list="report-customers-list"
                value={filters.customer}
                onChange={(e) => updateFilter('customer', e.target.value)}
                placeholder="Nombre del cliente..."
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
              <datalist id="report-customers-list">
                {knownCustomers.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )}

          {/* Ciudad / Ubicación */}
          {supportsFilter('city') && (
            <div>
              <label
                htmlFor="filter-city"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Ciudad / Ubicación
              </label>
              <input
                id="filter-city"
                type="text"
                list="report-cities-list"
                value={filters.city}
                onChange={(e) => updateFilter('city', e.target.value)}
                placeholder="Ej. Guacara, Valencia..."
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
              <datalist id="report-cities-list">
                {knownCities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )}

          {/* Vendedor */}
          {supportsFilter('seller') && (
            <div>
              <label
                htmlFor="filter-seller"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Vendedor
              </label>
              <select
                id="filter-seller"
                value={filters.seller}
                onChange={(e) => updateFilter('seller', e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ALL">Todos</option>
                <option value="Jesús">Jesús</option>
                <option value="Josué">Josué</option>
                <option value="Gabriel">Gabriel</option>
                <option value="Sin Asignar">Sin Asignar</option>
              </select>
            </div>
          )}

          {/* Condición de Pago */}
          {supportsFilter('paymentCondition') && (
            <div>
              <label
                htmlFor="filter-payment-condition"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Condición de Pago
              </label>
              <select
                id="filter-payment-condition"
                value={filters.paymentCondition}
                onChange={(e) => updateFilter('paymentCondition', e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ALL">Todas</option>
                <option value="Contado">Contado</option>
                <option value="Crédito">Crédito</option>
              </select>
            </div>
          )}

          {/* Tipo de Importación */}
          {supportsFilter('shippingType') && (
            <div>
              <label
                htmlFor="filter-shipping-type"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Tipo de Importación
              </label>
              <select
                id="filter-shipping-type"
                value={filters.shippingType}
                onChange={(e) => updateFilter('shippingType', e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ALL">Marítimo y Aéreo</option>
                <option value="Marítimo">Marítimo</option>
                <option value="Aéreo">Aéreo</option>
              </select>
            </div>
          )}

          {/* Rango de Monto (Mínimo - Máximo) */}
          {supportsFilter('amountMin') && (
            <div>
              <label
                htmlFor="filter-amount-min"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Monto Mín. (USDT)
              </label>
              <input
                id="filter-amount-min"
                type="number"
                min="0"
                step="0.01"
                value={filters.amountMin}
                onChange={(e) => updateFilter('amountMin', e.target.value)}
                placeholder="Ej. 20"
                className="font-mono-num w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          {supportsFilter('amountMax') && (
            <div>
              <label
                htmlFor="filter-amount-max"
                className="block text-[11px] font-medium text-slate-300 mb-1"
              >
                Monto Máx. (USDT)
              </label>
              <input
                id="filter-amount-max"
                type="number"
                min="0"
                step="0.01"
                value={filters.amountMax}
                onChange={(e) => updateFilter('amountMax', e.target.value)}
                placeholder="Ej. 50"
                className="font-mono-num w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#070D19] px-2.5 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Barra de Totales Dinámicos */}
      <div
        data-testid="report-totals-bar"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] px-4 py-3.5 shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Registros Filtrados
          </p>
          <p
            data-testid="report-total-count"
            className="font-mono-num mt-1 text-xl font-bold text-white"
          >
            {activeTotals.filteredCount}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0D1526] px-4 py-3.5 shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {activeTabMeta.totalUnitsLabel}
          </p>
          <p
            data-testid="report-total-units"
            className="font-mono-num mt-1 text-xl font-bold text-blue-400"
          >
            {activeTotals.totalUnits} uds
          </p>
          {activeTotals.extraNote && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              {activeTotals.extraNote}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0D1526] px-4 py-3.5 shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {activeTabMeta.totalUsdLabel}
          </p>
          <p
            data-testid="report-total-usd"
            className="font-mono-num mt-1 text-xl font-bold text-emerald-400"
          >
            {formatUSD(activeTotals.totalUsd)} USDT
          </p>
        </div>
      </div>

      {/* 1) VENTAS */}
      {reportType === 'ventas' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070D19] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="p-3">Factura / Fecha</th>
                  <th className="p-3">Cliente / Ubicación</th>
                  <th className="p-3">Prenda / Talla</th>
                  <th className="p-3 text-center">Cant.</th>
                  <th className="p-3 text-right">Precio Unit.</th>
                  <th className="p-3">Vendedor</th>
                  <th className="p-3">Pago / Condición</th>
                  <th className="p-3 text-right">Total (USDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {salesResult.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      No se encontraron ventas con la combinación de filtros actual.
                    </td>
                  </tr>
                ) : (
                  salesResult.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono-num whitespace-nowrap">
                        <div className="font-bold text-white">{r.invoiceNumber}</div>
                        <div className="text-[10px] text-slate-400">{r.date || 'N/D'}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-200">{r.customerName}</div>
                        <div className="text-[10px] text-slate-400">
                          {r.customerCity} · {r.customerPhone}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-white">{r.modelLabel}</div>
                        <div className="text-[10px] text-slate-400">
                          {r.team ? `${r.team} · ` : ''}
                          {r.version} · Talla <strong className="text-slate-200">{r.size}</strong>
                        </div>
                      </td>
                      <td className="p-3 text-center font-mono-num font-bold text-white">
                        {r.quantity}
                      </td>
                      <td className="p-3 text-right font-mono-num text-slate-300">
                        {formatUSD(r.unitPrice)}
                      </td>
                      <td className="p-3 font-medium text-slate-200">{r.seller}</td>
                      <td className="p-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                            r.paymentCondition === 'Contado'
                              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : 'border border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          {r.paymentCondition}
                        </span>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {r.paymentMethod}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono-num font-bold text-emerald-400">
                        {formatUSD(r.subtotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2) COMPRAS */}
      {reportType === 'compras' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070D19] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="p-3">Lote / Fecha</th>
                  <th className="p-3">Importación / Estatus</th>
                  <th className="p-3">Modelo / Talla</th>
                  <th className="p-3 text-center">Cant.</th>
                  <th className="p-3 text-right">Landed Unit.</th>
                  <th className="p-3 text-right">Tasa USDT</th>
                  <th className="p-3 text-right">Total Landed (USDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {purchasesResult.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No se encontraron compras con la combinación de filtros actual.
                    </td>
                  </tr>
                ) : (
                  purchasesResult.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono-num">
                        <div className="font-bold text-white">{r.referenceName}</div>
                        <div className="text-[10px] text-slate-400">
                          {r.date} · {r.supplier}
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                            r.shippingType === 'Marítimo'
                              ? 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                              : 'border border-blue-500/30 bg-blue-500/10 text-blue-300'
                          }`}
                        >
                          {r.shippingType}
                        </span>
                        <div className="mt-0.5 text-[10px] text-slate-400">{r.status}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-white">{r.model}</div>
                        <div className="text-[10px] text-slate-400">
                          {r.team ? `${r.team} · ` : ''}
                          {r.version} · Talla <strong className="text-slate-200">{r.size}</strong>
                        </div>
                      </td>
                      <td className="p-3 text-center font-mono-num font-bold text-white">
                        {r.quantity}
                      </td>
                      <td className="p-3 text-right font-mono-num text-slate-300">
                        {formatUSD(r.landedUnitCost)}
                      </td>
                      <td className="p-3 text-right font-mono-num text-slate-400">
                        {r.usdtRate > 0 ? r.usdtRate.toFixed(2) : 'N/D'}
                      </td>
                      <td className="p-3 text-right font-mono-num font-bold text-blue-400">
                        {formatUSD(r.lineLandedTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3) CLIENTES */}
      {reportType === 'clientes' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070D19] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="p-3">Cliente / Contacto</th>
                  <th className="p-3">Ciudad</th>
                  <th className="p-3 text-center">Compras</th>
                  <th className="p-3 text-center">Unidades</th>
                  <th className="p-3">Vendedores / Modelos</th>
                  <th className="p-3 text-right">CxC Pendiente</th>
                  <th className="p-3 text-right">Total Comprado (USDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {customersResult.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No se encontraron clientes con la combinación de filtros actual.
                    </td>
                  </tr>
                ) : (
                  customersResult.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="p-3">
                        <div className="font-bold text-white">{r.customerName}</div>
                        <div className="text-[10px] text-slate-400">
                          {r.phone} {r.social !== 'N/D' ? `· ${r.social}` : ''}
                        </div>
                      </td>
                      <td className="p-3 text-slate-300">{r.city}</td>
                      <td className="p-3 text-center font-mono-num text-slate-200">
                        {r.purchasesCount}
                      </td>
                      <td className="p-3 text-center font-mono-num font-bold text-white">
                        {r.unitsBought}
                      </td>
                      <td className="p-3">
                        <div className="text-[11px] font-medium text-slate-200">
                          {r.sellersSummary}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-xs">
                          {r.favoriteModels} · Últ: {r.lastPurchaseDate}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono-num font-semibold text-amber-300">
                        {r.pendingCxcUsd > 0 ? formatUSD(r.pendingCxcUsd) : '—'}
                      </td>
                      <td className="p-3 text-right font-mono-num font-bold text-emerald-400">
                        {formatUSD(r.totalSpentUsd)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4) DEVOLUCIONES Y CAMBIOS */}
      {reportType === 'devoluciones' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070D19] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="p-3">Operación / Fecha</th>
                  <th className="p-3">Cliente / Factura</th>
                  <th className="p-3">Prenda Devuelta</th>
                  <th className="p-3">Reemplazo</th>
                  <th className="p-3">Motivo</th>
                  <th className="p-3 text-right">Diferencia (USDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {returnsResult.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No se encontraron devoluciones o cambios con estos filtros.
                    </td>
                  </tr>
                ) : (
                  returnsResult.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono-num whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                            r.type === 'Cambio'
                              ? 'border border-blue-500/30 bg-blue-500/10 text-blue-300'
                              : 'border border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          {r.type}
                        </span>
                        <div className="mt-0.5 text-[10px] text-slate-400">{r.date}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-white">{r.customerName}</div>
                        <div className="text-[10px] text-slate-400">
                          {r.invoiceNumber} · {r.customerCity}
                        </div>
                      </td>
                      <td className="p-3 text-slate-200">
                        <strong className="text-white">{r.returnedQuantity}x</strong>{' '}
                        {r.returnedModelLabel} ({r.returnedVersion} · {r.returnedSize})
                      </td>
                      <td className="p-3 text-slate-300">
                        {r.replacementModelLabel
                          ? `${r.replacementQuantity}x ${r.replacementModelLabel} (${r.replacementSize})`
                          : 'Reembolso directo'}
                      </td>
                      <td className="p-3 text-slate-400">{r.reason}</td>
                      <td
                        className={`p-3 text-right font-mono-num font-bold ${
                          r.differenceUsd >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {r.differenceUsd >= 0
                          ? `+${formatUSD(r.differenceUsd)}`
                          : formatUSD(r.differenceUsd)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5) AJUSTES DE INVENTARIO */}
      {reportType === 'ajustes' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070D19] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Modelo / Talla</th>
                  <th className="p-3 text-right">Variación</th>
                  <th className="p-3 text-right">Stock</th>
                  <th className="p-3 text-right">Merma FIFO</th>
                  <th className="p-3">Motivo / Responsable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {adjustmentsResult.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No se encontraron ajustes de inventario con estos filtros.
                    </td>
                  </tr>
                ) : (
                  adjustmentsResult.rows.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono-num text-slate-400 whitespace-nowrap">
                        {a.date}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                            a.adjustmentType === 'entrada'
                              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                              : a.adjustmentType === 'salida'
                                ? 'border border-red-500/30 bg-red-500/10 text-red-400'
                                : 'border border-blue-500/30 bg-blue-500/10 text-blue-300'
                          }`}
                        >
                          {a.adjustmentType === 'entrada'
                            ? '+ Entrada'
                            : a.adjustmentType === 'salida'
                              ? '- Salida'
                              : '⇄ Descruce'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-200">
                        <span className="font-semibold text-white">{a.modelLabel}</span>{' '}
                        <span className="text-slate-400">
                          ({a.version} · {a.size})
                        </span>
                        {a.targetModelLabel && (
                          <div className="text-[11px] text-blue-300">
                            → {a.targetModelLabel} ({a.targetVersion || a.version} · {a.targetSize})
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono-num font-bold whitespace-nowrap">
                        <span
                          className={
                            a.delta >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }
                        >
                          {a.delta > 0 ? `+${a.delta}` : a.delta} uds
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono-num text-slate-300 whitespace-nowrap">
                        {a.previousStock} → {a.newStock}
                      </td>
                      <td className="p-3 text-right font-mono-num text-amber-300 whitespace-nowrap">
                        {a.fifoLossCost > 0 ? formatUSD(a.fifoLossCost) : '—'}
                      </td>
                      <td className="p-3">
                        <div className="text-slate-200">{a.reason}</div>
                        <div className="text-[10px] text-slate-400">
                          Responsable: {a.userName}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6) SALIDAS Y ENTRADAS (Movimientos Consolidados de Stock) */}
      {reportType === 'movimientos' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070D19] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="p-3">Fecha / Ref.</th>
                  <th className="p-3">Dirección / Origen</th>
                  <th className="p-3">Prenda / Talla</th>
                  <th className="p-3 text-right">Unidades</th>
                  <th className="p-3">Contraparte / Vendedor</th>
                  <th className="p-3">Detalle</th>
                  <th className="p-3 text-right">Valor (USDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {movementsResult.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No hay salidas ni entradas de stock con estos filtros.
                    </td>
                  </tr>
                ) : (
                  movementsResult.rows.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono-num whitespace-nowrap">
                        <div className="font-bold text-white">{m.reference}</div>
                        <div className="text-[10px] text-slate-400">{m.date}</div>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                            m.direction === 'Entrada'
                              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : 'border border-red-500/30 bg-red-500/10 text-red-300'
                          }`}
                        >
                          {m.sourceType}
                        </span>
                        {m.shippingType && (
                          <div className="mt-0.5 text-[10px] text-cyan-300">
                            {m.shippingType}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-white">{m.modelLabel}</div>
                        <div className="text-[10px] text-slate-400">
                          {m.version} · Talla <strong className="text-slate-200">{m.size}</strong>
                        </div>
                      </td>
                      <td
                        className={`p-3 text-right font-mono-num font-bold whitespace-nowrap ${
                          m.signedUnits >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {m.signedUnits > 0 ? `+${m.signedUnits}` : m.signedUnits} uds
                      </td>
                      <td className="p-3">
                        <div className="text-slate-200">{m.counterparty}</div>
                        <div className="text-[10px] text-slate-400">
                          {m.city}
                          {m.seller ? ` · Vend: ${m.seller}` : ''}
                        </div>
                      </td>
                      <td className="p-3 text-slate-400">{m.detail}</td>
                      <td className="p-3 text-right font-mono-num font-semibold text-slate-200 whitespace-nowrap">
                        {formatUSD(m.amountUsd)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7) CARGAS MASIVAS (Historial de Importaciones por Excel) */}
      {reportType === 'cargas' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#070D19] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="p-3">Fecha / Estado</th>
                  <th className="p-3">Archivo Excel (.xlsx)</th>
                  <th className="p-3">Usuario / Hojas</th>
                  <th className="p-3 text-right">Compras</th>
                  <th className="p-3 text-right">Ventas</th>
                  <th className="p-3 text-right">Stock Final</th>
                  <th className="p-3 text-right">Caja / Tasas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {bulkImportsResult.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No hay importaciones de Excel registradas en el historial. Al sincronizar un respaldo desde Configuración o Cargas Masivas aparecerá aquí.
                    </td>
                  </tr>
                ) : (
                  bulkImportsResult.rows.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono-num whitespace-nowrap">
                        <div className="font-bold text-white">{b.importDate}</div>
                        <span className="inline-block mt-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          {b.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-white">{b.fileName}</div>
                        <div className="text-[10px] text-slate-400">{b.notes}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-slate-200">{b.userName}</div>
                        <div className="text-[10px] text-slate-400">{b.sheetsText}</div>
                      </td>
                      <td className="p-3 text-right font-mono-num whitespace-nowrap">
                        <div className="font-semibold text-blue-300">
                          {b.comprasUnits} uds ({b.comprasRows} filas)
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {formatUSD(b.comprasCostUsd)} USDT
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono-num whitespace-nowrap">
                        <div className="font-semibold text-emerald-400">
                          {b.ventasUnits} uds ({b.ventasRows} filas)
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {formatUSD(b.ventasRevenueUsd)} USDT
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono-num whitespace-nowrap">
                        <div className="font-bold text-white">
                          {b.resultingStockUnits} uds
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {b.resultingSkusCount} SKUs
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono-num whitespace-nowrap">
                        <div className="font-semibold text-white">
                          {formatUSD(b.cashOnHandUsd)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          USDT {b.usdtRate.toFixed(2)} · BCV {b.bcvRate.toFixed(2)}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 8) STOCK DISPONIBLE (Franelas con Stock > 0 por Talla y Valor FIFO) */}
      {reportType === 'inventario' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 shadow-xl">
          <div className="overflow-x-auto">
            <table
              data-testid="report-available-stock-table"
              className="w-full text-left text-xs"
            >
              <thead className="border-b border-slate-800 bg-[#070D19] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="p-3">Equipo</th>
                  <th className="p-3">Modelo / Versión</th>
                  <th className="p-3 text-center">S</th>
                  <th className="p-3 text-center">M</th>
                  <th className="p-3 text-center">L</th>
                  <th className="p-3 text-center">XL</th>
                  <th className="p-3 text-center">XXL</th>
                  <th className="p-3">Otras Tallas</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-right">PVP (USDT / Bs)</th>
                  <th className="p-3 text-right">Valor FIFO (USDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {availableStockResult.rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-500">
                      No hay franelas disponibles en stock con la combinación de filtros actual.
                    </td>
                  </tr>
                ) : (
                  availableStockResult.rows.map((r) => (
                    <tr key={r.key} className="hover:bg-slate-800/40">
                      <td className="p-3 font-medium text-blue-300 whitespace-nowrap">
                        {r.team}
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-white">{r.model}</div>
                        <div className="text-[10px] text-slate-400">{r.version}</div>
                      </td>
                      <td className="p-3 text-center font-mono-num text-slate-200">
                        {r.sizes.S}
                      </td>
                      <td className="p-3 text-center font-mono-num text-slate-200">
                        {r.sizes.M}
                      </td>
                      <td className="p-3 text-center font-mono-num text-slate-200">
                        {r.sizes.L}
                      </td>
                      <td className="p-3 text-center font-mono-num text-slate-200">
                        {r.sizes.XL}
                      </td>
                      <td className="p-3 text-center font-mono-num text-slate-200">
                        {r.sizes.XXL}
                      </td>
                      <td className="p-3 font-mono-num text-slate-400 whitespace-nowrap">
                        {r.extraSizesText}
                      </td>
                      <td className="p-3 text-right font-mono-num font-bold text-white whitespace-nowrap">
                        {r.totalStock}
                      </td>
                      <td className="p-3 text-right font-mono-num whitespace-nowrap">
                        <div className="font-semibold text-emerald-400">
                          {formatUSD(r.salePrice)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Bs {r.salePriceBs.toFixed(2)}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono-num font-bold text-blue-300 whitespace-nowrap">
                        {formatUSD(r.totalFifoValue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
