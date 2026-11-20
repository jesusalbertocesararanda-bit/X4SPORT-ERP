import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Layers,
  PackagePlus,
  Receipt,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AppState,
  BulkImportRecord,
  MatrixConfigParams,
} from '../types/erp';
import {
  applyBulkUploadPreview,
  downloadBulkTemplateWithSheetJS,
  parseBulkUploadFileWithSheetJS,
  type BulkImportKind,
  type BulkUploadPreview,
} from '../utils/bulkImport';
import {
  downloadExcelTemplateWithSheetJS,
  parseExcelFileWithSheetJS,
  type ExcelImportPreview,
} from '../utils/excelImport';
import { formatUSD, formatUSDT } from '../utils/finance';
import type { BulkImportMetaPayload } from './ExcelImportModal';

interface BulkImportViewProps {
  state: AppState;
  matrixParams?: MatrixConfigParams;
  currentUserName?: string;
  onApplyImportedState: (
    newState: AppState,
    importMeta?: BulkImportMetaPayload,
  ) => Promise<void>;
  onCommitBulkState?: (newState: AppState) => Promise<{ ok: boolean; error?: string }>;
  onPurgeGhostData?: () => Promise<void>;
}

interface CardDefinition {
  kind: BulkImportKind;
  title: string;
  subtitle: string;
  description: string;
  accentText: string;
  accentBg: string;
  icon: typeof ShoppingBag;
}

const CARD_DEFINITIONS: CardDefinition[] = [
  {
    kind: 'ventas',
    title: 'Ventas Masivas',
    subtitle: 'Facturación e histórico FIFO',
    description:
      'Importa lotes de ventas con cliente, vendedor, talla, condición (Contado/Crédito) y aplicación automática en la matriz.',
    accentText: 'text-emerald-400',
    accentBg: 'border-emerald-500/30 bg-emerald-500/10',
    icon: ShoppingBag,
  },
  {
    kind: 'compras',
    title: 'Compras Masivas',
    subtitle: 'Lotes 1688 / Alibaba y pedidos',
    description:
      'Carga lotes de importación en tránsito o recibidos con costo fábrica, flete unitario, precio de venta y tasa USDT.',
    accentText: 'text-blue-400',
    accentBg: 'border-blue-500/30 bg-blue-500/10',
    icon: PackagePlus,
  },
  {
    kind: 'ajustes',
    title: 'Ajustes de Inventario Masivos',
    subtitle: 'Entradas y salidas de stock',
    description:
      'Aplica ajustes físicos por conteo o correcciones masivas de stock con motivo auditable y actualización de lotes FIFO.',
    accentText: 'text-amber-400',
    accentBg: 'border-amber-500/30 bg-amber-500/10',
    icon: SlidersHorizontal,
  },
  {
    kind: 'gastos',
    title: 'Gastos Masivos',
    subtitle: 'Egresos con detección inteligente',
    description:
      'Registra gastos operativos, empaques, envíos o publicidad con autodetección de categoría y prorrateo de caja.',
    accentText: 'text-purple-400',
    accentBg: 'border-purple-500/30 bg-purple-500/10',
    icon: Receipt,
  },
  {
    kind: 'respaldo',
    title: 'Respaldo Completo del Sistema (.xlsx)',
    subtitle: 'Sincronizar y Cargar Respaldo Excel (.xlsx)',
    description:
      'Sincroniza el libro maestro multi-hoja (Compras, Ventas y Finanzas) con reconstrucción FIFO y respaldo en Firebase.',
    accentText: 'text-cyan-400',
    accentBg: 'border-cyan-500/30 bg-cyan-500/10',
    icon: Database,
  },
];

const KIND_LABELS: Record<BulkImportKind, string> = {
  ventas: 'Ventas Masivas',
  compras: 'Compras Masivas',
  ajustes: 'Ajustes de Inventario Masivos',
  gastos: 'Gastos Masivos',
  respaldo: 'Respaldo Completo del Sistema (.xlsx)',
};

export function BulkImportView({
  state,
  matrixParams,
  currentUserName = 'Admin',
  onApplyImportedState,
  onCommitBulkState,
  onPurgeGhostData,
}: BulkImportViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeUploadKind, setActiveUploadKind] = useState<BulkImportKind>('ventas');
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const [incrementalPreview, setIncrementalPreview] =
    useState<BulkUploadPreview | null>(null);

  const [fullBackupFileName, setFullBackupFileName] = useState<string>('');
  const [fullBackupPreview, setFullBackupPreview] =
    useState<ExcelImportPreview | null>(null);
  const [pendingFullState, setPendingFullState] = useState<AppState | null>(null);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  const duplicateFullBackupMatch = useMemo(() => {
    if (!fullBackupPreview || !fullBackupFileName) return null;
    const normName = fullBackupFileName.trim().toLowerCase();
    return (
      (state.bulkImports ?? []).find(
        (imp) =>
          imp.fileName.trim().toLowerCase() === normName &&
          imp.comprasRows === fullBackupPreview.comprasRowsParsed &&
          imp.ventasRows === fullBackupPreview.ventasRowsParsed,
      ) ?? null
    );
  }, [fullBackupFileName, fullBackupPreview, state.bulkImports]);

  const recentBulkImports: BulkImportRecord[] = useMemo(
    () => (state.bulkImports ?? []).slice(0, 6),
    [state.bulkImports],
  );

  const handleDownloadTemplate = (kind: BulkImportKind) => {
    setFeedback(null);
    const ok =
      kind === 'respaldo'
        ? downloadExcelTemplateWithSheetJS()
        : downloadBulkTemplateWithSheetJS(kind);

    if (!ok) {
      setFeedback({
        type: 'error',
        text: 'Librería SheetJS (xlsx) aún no disponible en este navegador.',
      });
      return;
    }

    setFeedback({
      type: 'success',
      text: `Plantilla "${KIND_LABELS[kind]}" descargada en formato .xlsx.`,
    });
  };

  const triggerFileSelect = (kind: BulkImportKind) => {
    setActiveUploadKind(kind);
    setFeedback(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setFeedback(null);
    setIncrementalPreview(null);
    setFullBackupPreview(null);
    setPendingFullState(null);

    try {
      if (activeUploadKind === 'respaldo') {
        const result = await parseExcelFileWithSheetJS(file, {
          currentBcv: state.exchangeRates.bcv,
          currentUsdt: state.exchangeRates.usdt,
        });
        if (!result.ok || !result.preview || !result.state) {
          setFeedback({
            type: 'error',
            text:
              result.error ??
              'No se pudo validar el archivo de Respaldo Completo (.xlsx).',
          });
          return;
        }
        setFullBackupFileName(file.name);
        setFullBackupPreview(result.preview);
        setPendingFullState(result.state);
      } else {
        const result = await parseBulkUploadFileWithSheetJS(
          activeUploadKind,
          file,
          state,
        );
        if (!result.ok || !result.preview) {
          setFeedback({
            type: 'error',
            text: result.error ?? 'No se pudo leer el archivo .xlsx.',
          });
          return;
        }
        setIncrementalPreview(result.preview);
      }
    } finally {
      setIsParsing(false);
      e.target.value = '';
    }
  };

  const clearPreview = () => {
    setIncrementalPreview(null);
    setFullBackupPreview(null);
    setPendingFullState(null);
    setFullBackupFileName('');
  };

  const handleConfirmIncrementalSave = async () => {
    if (!incrementalPreview) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const outcome = applyBulkUploadPreview(
        state,
        incrementalPreview,
        currentUserName,
        matrixParams,
      );
      if (!outcome.ok) {
        setFeedback({
          type: 'error',
          text: outcome.error ?? 'No se pudieron aplicar las filas válidas.',
        });
        return;
      }

      if (onCommitBulkState) {
        const commitRes = await onCommitBulkState(outcome.state);
        if (!commitRes.ok) {
          setFeedback({
            type: 'error',
            text:
              commitRes.error ??
              'Error al guardar la carga masiva en Firebase.',
          });
          return;
        }
      } else {
        await onApplyImportedState(outcome.state);
      }

      setFeedback({
        type: 'success',
        text: `Carga aplicada en Firebase (${outcome.appliedCount} fila(s) guardada(s), ${outcome.skippedDuplicatesCount} duplicada(s) omitida(s)). Registrada para auditoría en Reportes > Cargas Masivas.`,
      });
      setIncrementalPreview(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Error al confirmar la carga masiva en Firebase.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmFullBackupSave = async () => {
    if (!pendingFullState || !fullBackupPreview) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const importMeta: BulkImportMetaPayload = {
        fileName: fullBackupFileName || 'Respaldo_X4SPORT.xlsx',
        importDate: new Date().toISOString().slice(0, 10),
        sheetsDetected: fullBackupPreview.detectedSheets.allSheets,
        comprasRows: fullBackupPreview.comprasRowsParsed,
        comprasUnits: fullBackupPreview.comprasUnitsTotal,
        comprasCostUsd: fullBackupPreview.comprasCostTotal,
        ventasRows: fullBackupPreview.ventasRowsParsed,
        ventasUnits: fullBackupPreview.ventasUnitsSold,
        ventasRevenueUsd: fullBackupPreview.ventasRevenueTotal,
        resultingSkusCount: fullBackupPreview.resultingSkusCount,
        resultingStockUnits: fullBackupPreview.resultingStockUnits,
        cashOnHandUsd: fullBackupPreview.cashOnHand,
        usdtRate: fullBackupPreview.usdtRate,
        bcvRate: fullBackupPreview.bcvRate,
        status: 'Aplicada',
        notes:
          fullBackupPreview.warnings.length > 0
            ? `${fullBackupPreview.warnings.length} observación(es) de mapeo`
            : 'Sincronización completa FIFO',
      };

      await onApplyImportedState(pendingFullState, importMeta);
      setFeedback({
        type: 'success',
        text: `Respaldo "${importMeta.fileName}" sincronizado en Firebase y auditado en Reportes > Cargas Masivas.`,
      });
      clearPreview();
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Error al escribir el respaldo en Firebase.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmPurge = async () => {
    if (!onPurgeGhostData) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      await onPurgeGhostData();
      setConfirmPurge(false);
      clearPreview();
      setFeedback({
        type: 'success',
        text: 'Datos fantasma eliminados de Firebase. Base restablecida a saldos iniciales oficiales.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Error al purgar datos en Firebase.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden shared file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv"
        onChange={handleFileChange}
        disabled={isParsing || isSaving}
        className="hidden"
        data-testid="bulk-file-input"
      />

      {/* Header */}
      <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              Cargas Masivas y Sincronización Excel (.xlsx)
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Descarga plantillas oficiales, previsualiza validación de columnas sin duplicados y audita cada carga en{' '}
              <span className="font-semibold text-slate-200">
                Reportes &gt; Cargas Masivas
              </span>
              .
            </p>
          </div>

          {onPurgeGhostData && (
            <div className="flex items-center gap-2 shrink-0">
              {!confirmPurge ? (
                <button
                  type="button"
                  onClick={() => setConfirmPurge(true)}
                  className="inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap rounded-xl border border-red-500/35 bg-red-500/10 px-3.5 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Eliminar Datos Fantasma
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/60 px-3 py-1.5">
                  <span className="text-[11px] font-medium text-red-200">
                    ¿Limpiar Firebase?
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleConfirmPurge()}
                    disabled={isSaving}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {isSaving ? 'Purgando...' : 'Sí, purgar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmPurge(false)}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded-xl px-4 py-3.5 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border border-red-500/35 bg-red-500/10 text-red-200'
              : feedback.type === 'warning'
                ? 'border border-amber-500/35 bg-amber-500/10 text-amber-200'
                : 'border border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            ) : (
              <AlertTriangle
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  feedback.type === 'error' ? 'text-red-400' : 'text-amber-400'
                }`}
                aria-hidden="true"
              />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-0.5 text-slate-400 hover:text-white"
            aria-label="Cerrar mensaje"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 5 Organized Operation Cards (each with 2 buttons) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CARD_DEFINITIONS.map((card) => {
          const Icon = card.icon;
          const isRespaldo = card.kind === 'respaldo';
          return (
            <article
              key={card.kind}
              data-testid={`bulk-card-${card.kind}`}
              className={`flex flex-col justify-between rounded-2xl border bg-[#0D1526] p-5 ${
                isRespaldo
                  ? 'border-cyan-500/30 md:col-span-2 xl:col-span-1'
                  : 'border-slate-800'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className={`rounded-xl border p-2.5 ${card.accentBg} ${card.accentText}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-400">
                    {card.subtitle}
                  </span>
                </div>

                <h2 className="mt-4 font-display text-base font-bold text-white">
                  {card.title}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  {card.description}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleDownloadTemplate(card.kind)}
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700 bg-[#080E1C] px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <Download className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                  Descargar Plantilla .xlsx
                </button>
                <button
                  type="button"
                  onClick={() => triggerFileSelect(card.kind)}
                  disabled={isParsing || isSaving}
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {isParsing && activeUploadKind === card.kind
                    ? 'Validando...'
                    : 'Cargar Archivo .xlsx'}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Incremental Validation Preview Table */}
      {incrementalPreview && (
        <section
          aria-labelledby="bulk-preview-title"
          data-testid="bulk-preview-panel"
          className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-blue-400" aria-hidden="true" />
                <h2
                  id="bulk-preview-title"
                  className="font-display text-lg font-bold text-white"
                >
                  Vista Previa de Validación · {KIND_LABELS[incrementalPreview.kind]}
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Archivo: <span className="font-semibold text-slate-200">{incrementalPreview.fileName}</span> · Pestaña:{' '}
                <span className="font-semibold text-slate-200">{incrementalPreview.sheetName}</span>
              </p>
            </div>

            <button
              type="button"
              onClick={clearPreview}
              className="inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-700 bg-[#080E1C] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Descartar vista previa
            </button>
          </div>

          {/* Detected Columns & Missing Required Columns */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-semibold text-slate-400 mr-1">
                Columnas detectadas:
              </span>
              {incrementalPreview.detectedColumns.length > 0 ? (
                incrementalPreview.detectedColumns.map((col, idx) => (
                  <span
                    key={`${col}-${idx}`}
                    className="rounded-md border border-slate-700 bg-[#080E1C] px-2 py-0.5 text-slate-300"
                  >
                    {col}
                  </span>
                ))
              ) : (
                <span className="text-red-300">Ninguna columna detectada</span>
              )}
            </div>

            {incrementalPreview.missingRequiredColumns.length > 0 && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                <span>
                  Faltan columnas obligatorias en el archivo:{' '}
                  <strong>
                    {incrementalPreview.missingRequiredColumns.join(', ')}
                  </strong>
                  . Descarga la plantilla oficial e intenta de nuevo.
                </span>
              </div>
            )}
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
              <span className="text-[11px] text-slate-400">Filas Leídas</span>
              <p className="font-mono-num mt-0.5 text-lg font-bold text-white">
                {incrementalPreview.rows.length}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
              <span className="text-[11px] text-emerald-300">Válidas</span>
              <p className="font-mono-num mt-0.5 text-lg font-bold text-emerald-300">
                {incrementalPreview.validCount}
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <span className="text-[11px] text-amber-300">Duplicados Omitidos</span>
              <p className="font-mono-num mt-0.5 text-lg font-bold text-amber-300">
                {incrementalPreview.duplicateCount}
              </p>
            </div>
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <span className="text-[11px] text-red-300">Errores</span>
              <p className="font-mono-num mt-0.5 text-lg font-bold text-red-300">
                {incrementalPreview.errorCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3 col-span-2 sm:col-span-1">
              <span className="text-[11px] text-slate-400">Total Válido</span>
              <p className="font-mono-num mt-0.5 text-lg font-bold text-blue-300">
                {formatUSD(incrementalPreview.validTotalUsd)}
              </p>
              <span className="font-mono-num text-[10px] text-slate-400">
                {incrementalPreview.validUnits} uds
              </span>
            </div>
          </div>

          {/* Preview Rows Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#080E1C]">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#0B1222] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">Fila</th>
                  <th className="px-3 py-2.5">Fecha</th>
                  <th className="px-3 py-2.5">Operación / Modelo</th>
                  <th className="px-3 py-2.5">Detalle</th>
                  <th className="px-3 py-2.5 text-right">Uds</th>
                  <th className="px-3 py-2.5 text-right">Monto USDT</th>
                  <th className="px-3 py-2.5">Estado</th>
                  <th className="px-3 py-2.5">Validación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {incrementalPreview.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-6 text-center text-slate-400"
                    >
                      No se encontraron filas de datos para procesar.
                    </td>
                  </tr>
                ) : (
                  incrementalPreview.rows.map((row) => (
                    <tr key={`${row.rowNumber}-${row.primaryLabel}`} className="hover:bg-slate-800/30">
                      <td className="font-mono-num px-3 py-2.5 text-slate-400">
                        #{row.rowNumber}
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-slate-300 whitespace-nowrap">
                        {row.date}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-white">
                        {row.primaryLabel}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">
                        {row.detailLabel}
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-right text-slate-200">
                        {row.units}
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-right font-semibold text-white">
                        {formatUSD(row.amountUsd)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {row.status === 'valido' ? (
                          <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                            Válido
                          </span>
                        ) : row.status === 'duplicado' ? (
                          <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                            Duplicado
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                            Error
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">
                        {row.statusReason}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Confirm Action Bar */}
          <div className="flex flex-col gap-3 border-t border-slate-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-400">
              Solo se guardarán en Firebase las{' '}
              <strong className="text-emerald-300">
                {incrementalPreview.validCount} fila(s) válidas
              </strong>
              ; los duplicados y errores serán omitidos automáticamente.
            </p>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={clearPreview}
                className="min-h-[40px] rounded-xl border border-slate-700 bg-[#080E1C] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmIncrementalSave()}
                disabled={
                  isSaving ||
                  incrementalPreview.validCount === 0 ||
                  incrementalPreview.missingRequiredColumns.length > 0
                }
                className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {isSaving
                  ? 'Guardando en Firebase...'
                  : 'Confirmar y Guardar en Firebase (Solo Válidos)'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Full Backup Validation Preview */}
      {fullBackupPreview && pendingFullState && (
        <section
          aria-labelledby="full-backup-preview-title"
          data-testid="full-backup-preview-panel"
          className="rounded-2xl border border-cyan-500/35 bg-[#0D1526] p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-cyan-400" aria-hidden="true" />
                <h2
                  id="full-backup-preview-title"
                  className="font-display text-lg font-bold text-white"
                >
                  Vista Previa · Sincronizar y Cargar Respaldo Excel (.xlsx)
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Archivo:{' '}
                <span className="font-semibold text-slate-200">
                  {fullBackupFileName}
                </span>{' '}
                · Pestañas:{' '}
                <span className="font-semibold text-slate-200">
                  {fullBackupPreview.detectedSheets.allSheets.join(', ')}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={clearPreview}
              className="inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-700 bg-[#080E1C] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Descartar
            </button>
          </div>

          {duplicateFullBackupMatch && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                Advertencia de duplicado: Este mismo archivo ({duplicateFullBackupMatch.fileName}) con{' '}
                {duplicateFullBackupMatch.comprasRows} compras y{' '}
                {duplicateFullBackupMatch.ventasRows} ventas ya fue sincronizado el{' '}
                {duplicateFullBackupMatch.importDate}. Confirma únicamente si deseas sobrescribir intencionalmente el estado en Firebase.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
              <span className="text-[11px] text-slate-400">Compras Detectadas</span>
              <p className="font-mono-num mt-0.5 text-base font-bold text-white">
                {fullBackupPreview.comprasRowsParsed} filas · {fullBackupPreview.comprasUnitsTotal} uds
              </p>
              <span className="font-mono-num text-[11px] text-slate-400">
                {formatUSD(fullBackupPreview.comprasCostTotal)}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
              <span className="text-[11px] text-slate-400">Ventas FIFO</span>
              <p className="font-mono-num mt-0.5 text-base font-bold text-emerald-300">
                {fullBackupPreview.ventasRowsParsed} filas · {fullBackupPreview.ventasUnitsSold} uds
              </p>
              <span className="font-mono-num text-[11px] text-slate-400">
                {formatUSD(fullBackupPreview.ventasRevenueTotal)}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
              <span className="text-[11px] text-slate-400">Inventario Final</span>
              <p className="font-mono-num mt-0.5 text-base font-bold text-blue-300">
                {fullBackupPreview.resultingStockUnits} uds
              </p>
              <span className="font-mono-num text-[11px] text-slate-400">
                {fullBackupPreview.resultingSkusCount} SKUs
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#080E1C] p-3">
              <span className="text-[11px] text-slate-400">Caja Fís. y CxC</span>
              <p className="font-mono-num mt-0.5 text-base font-bold text-white">
                {formatUSDT(fullBackupPreview.cashOnHand)}
              </p>
              <span className="font-mono-num text-[11px] text-amber-300">
                CxC: {formatUSD(fullBackupPreview.receivablesTotal)}
              </span>
            </div>
          </div>

          {fullBackupPreview.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200 space-y-1">
              <p className="font-semibold text-amber-300">
                Observaciones de mapeo ({fullBackupPreview.warnings.length}):
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {fullBackupPreview.warnings.slice(0, 6).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-slate-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-400">
              Al confirmar se sincronizará todo el libro en Firebase y quedará registrado en Reportes &gt; Cargas Masivas.
            </p>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={clearPreview}
                className="min-h-[40px] rounded-xl border border-slate-700 bg-[#080E1C] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmFullBackupSave()}
                disabled={isSaving}
                className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-xl bg-cyan-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {isSaving
                  ? 'Sincronizando...'
                  : 'Confirmar y Sincronizar Respaldo en Firebase'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Recent Audit Trail Preview */}
      <section className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 sm:p-6 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-white">
              Historial Reciente de Cargas Masivas
            </h2>
            <p className="text-xs text-slate-400">
              Cada importación confirmada queda auditada aquí y en el módulo completo de{' '}
              <span className="text-slate-200 font-medium">Reportes &gt; Cargas Masivas</span>.
            </p>
          </div>
          <span className="font-mono-num text-xs text-slate-400">
            Total registradas: <strong className="text-white">{(state.bulkImports ?? []).length}</strong>
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#080E1C]">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="border-b border-slate-800 bg-[#0B1222] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5">Archivo</th>
                <th className="px-3 py-2.5">Hojas / Tipo</th>
                <th className="px-3 py-2.5">Usuario</th>
                <th className="px-3 py-2.5 text-right">Stock Res.</th>
                <th className="px-3 py-2.5">Resumen / Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {recentBulkImports.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    Aún no se han aplicado cargas masivas en esta sesión.
                  </td>
                </tr>
              ) : (
                recentBulkImports.map((imp) => (
                  <tr key={imp.id} className="hover:bg-slate-800/30">
                    <td className="font-mono-num px-3 py-2.5 text-slate-300 whitespace-nowrap">
                      {imp.importDate}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-white">
                      {imp.fileName}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">
                      {imp.sheetsDetected.join(', ')}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{imp.userName}</td>
                    <td className="font-mono-num px-3 py-2.5 text-right text-slate-200">
                      {imp.resultingStockUnits} uds
                    </td>
                    <td className="px-3 py-2.5 text-emerald-300">
                      {imp.notes || imp.status}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
