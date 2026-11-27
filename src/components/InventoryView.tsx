import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import type { AppState, JerseyVersion, TeamCategory } from '../types/erp';
import {
  ALL_JERSEY_SIZES,
  formatUSD,
  getInventorySizeMatrix,
  getNextFifoUnitCost,
  getTotalInventoryCostValue,
  getTotalUnits,
  normalizeVersionDisplay,
  round2,
} from '../utils/finance';
import {
  consolidateMatrixRowsByModelIdentity,
  getModelIdentityKey,
  normalizarUrlImagen,
  obtenerFallbackUrlImagen,
  parseCatalogImageList,
  resolveModelPhotoAnywhere,
} from '../utils/publicCatalog';
import { buildAvailableStockExcelPayload } from '../utils/reports';

export interface BulkUpdateInventoryModelInput {
  originalModel: string;
  originalVersion: JerseyVersion;
  originalPlayer: string;
  newModelName: string;
  newTeam: string;
  newVersion: JerseyVersion;
  newPlayer: string;
  newSalePrice?: number;
  newPhotoUrl: string;
  updateTransitBatches: boolean;
}

export interface BulkUpdateInventoryModelResult {
  ok: boolean;
  updatedCount?: number;
  updatedTransitCount?: number;
  error?: string;
}

interface InventoryViewProps {
  state: AppState;
  lowStockThreshold?: number;
  onBulkUpdateModel?: (
    input: BulkUpdateInventoryModelInput,
  ) => Promise<BulkUpdateInventoryModelResult> | BulkUpdateInventoryModelResult;
}

type InventoryDisplayMode = 'matrix' | 'sku';

interface EditingModelTarget {
  originalModel: string;
  originalVersion: 'Fans' | 'Player' | 'Retro';
  originalPlayer: string;
  team: string;
  salePrice: number;
  photoUrl: string;
  matchingItemsCount: number;
  totalStock: number;
  fifoLayersCount: number;
  transitMatchingCount: number;
}

const DEFAULT_TEAM_ORDER = [
  'Barcelona',
  'Real Madrid',
  'Manchester City',
  'PSG',
  'Selecciones',
  'Otro',
];

function normalizeSpaces(value: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function splitModelAndPlayer(rawModel: string): {
  baseModel: string;
  player: string;
} {
  let cleanModel = normalizeSpaces(rawModel);
  let playerCandidate = '';

  const sepParts = cleanModel
    .split(/\s*[·|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (sepParts.length > 1) {
    cleanModel = sepParts[0];
    playerCandidate = sepParts.slice(1).join(' ');
  }

  const parenMatch = cleanModel.match(/\(([^)]*#\d+[^)]*)\)/);
  if (parenMatch?.[1]) {
    if (!playerCandidate) {
      playerCandidate = parenMatch[1].trim();
    }
    cleanModel = normalizeSpaces(cleanModel.replace(parenMatch[0], ''));
  }

  const trailingHashMatch = cleanModel.match(
    /\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+)?\s*#\d+)\s*$/,
  );
  if (trailingHashMatch?.[1]) {
    if (!playerCandidate) {
      playerCandidate = trailingHashMatch[1].trim();
    }
    cleanModel = normalizeSpaces(
      cleanModel.slice(0, cleanModel.length - trailingHashMatch[0].length),
    );
  }

  return {
    baseModel: cleanModel || normalizeSpaces(rawModel),
    player: normalizeSpaces(playerCandidate),
  };
}

export function InventoryView({
  state,
  lowStockThreshold = 5,
  onBulkUpdateModel,
}: InventoryViewProps) {
  const threshold = Math.max(1, lowStockThreshold);
  const [displayMode, setDisplayMode] = useState<InventoryDisplayMode>('matrix');
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<'Todos' | TeamCategory>('Todos');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Estado del modal de Edición en Bloque de Modelo
  const [editingTarget, setEditingTarget] = useState<EditingModelTarget | null>(
    null,
  );
  const [formModelName, setFormModelName] = useState('');
  const [formTeam, setFormTeam] = useState('');
  const [formVersion, setFormVersion] = useState<'Fans' | 'Player' | 'Retro'>(
    'Fans',
  );
  const [formPlayer, setFormPlayer] = useState('');
  const [formSalePrice, setFormSalePrice] = useState('');
  const [formPhotoUrl, setFormPhotoUrl] = useState('');
  const [formUpdateTransit, setFormUpdateTransit] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [previewFallbackIdx, setPreviewFallbackIdx] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (!editingTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSavingModel) {
        setEditingTarget(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingTarget, isSavingModel]);

  const openEditModelModal = (params: {
    model: string;
    version: JerseyVersion;
    team: string;
    salePrice: number;
  }) => {
    const cleanOrigModel = normalizeSpaces(params.model);
    const normalizedVer = normalizeVersionDisplay(params.version);
    const { baseModel, player } = splitModelAndPlayer(cleanOrigModel);

    const targetIdentityKey = getModelIdentityKey({
      model: cleanOrigModel,
      version: normalizedVer,
    });
    const matchingItems = state.inventory.filter(
      (it) =>
        getModelIdentityKey({ model: it.model, version: it.version }) ===
        targetIdentityKey,
    );
    const totalStock = matchingItems.reduce((s, it) => s + it.stock, 0);
    const fifoLayersCount = matchingItems.reduce(
      (s, it) => s + Math.max(1, (it.fifoBatches ?? []).length),
      0,
    );

    let transitMatchingCount = 0;
    for (const batch of state.purchaseBatches ?? []) {
      if (batch.status !== 'EN TRÁNSITO') continue;
      for (const bi of batch.items ?? []) {
        if (
          getModelIdentityKey({ model: bi.model, version: bi.version }) ===
          targetIdentityKey
        ) {
          transitMatchingCount += 1;
        }
      }
    }

    const existingPhoto =
      resolveModelPhotoAnywhere(state, {
        model: cleanOrigModel,
        version: normalizedVer,
      }) ?? '';

    setEditingTarget({
      originalModel: cleanOrigModel,
      originalVersion: normalizedVer,
      originalPlayer: player,
      team: params.team,
      salePrice: params.salePrice,
      photoUrl: existingPhoto,
      matchingItemsCount: matchingItems.length,
      totalStock,
      fifoLayersCount,
      transitMatchingCount,
    });
    setFormModelName(baseModel);
    setFormTeam(params.team);
    setFormVersion(normalizedVer);
    setFormPlayer(player);
    setFormSalePrice(
      params.salePrice > 0 ? String(round2(params.salePrice)) : '',
    );
    setFormPhotoUrl(existingPhoto);
    setFormUpdateTransit(false);
    setFormError(null);
    setPreviewFallbackIdx(0);
  };

  const handleCloseEditModal = () => {
    if (isSavingModel) return;
    setEditingTarget(null);
    setFormError(null);
  };

  const handleSubmitBulkModelEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTarget) return;

    const cleanName = normalizeSpaces(formModelName);
    if (!cleanName) {
      setFormError('Ingresa el nombre o descripción del modelo.');
      return;
    }

    const cleanTeam = normalizeSpaces(formTeam) || editingTarget.team;
    const cleanPlayer = normalizeSpaces(formPlayer);

    let parsedSalePrice: number | undefined;
    const rawPrice = formSalePrice.trim();
    if (rawPrice !== '') {
      const numeric = Number(rawPrice);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        setFormError(
          'El Precio de Venta PVP (USDT) debe ser mayor a $0.00 o déjalo vacío para no cambiarlo.',
        );
        return;
      }
      parsedSalePrice = round2(numeric);
    }

    if (!onBulkUpdateModel) {
      setFormError(
        'La sincronización en bloque no está disponible en este contexto.',
      );
      return;
    }

    setFormError(null);
    setIsSavingModel(true);
    try {
      const outcome = await onBulkUpdateModel({
        originalModel: editingTarget.originalModel,
        originalVersion: editingTarget.originalVersion,
        originalPlayer: editingTarget.originalPlayer,
        newModelName: cleanName,
        newTeam: cleanTeam,
        newVersion: formVersion,
        newPlayer: cleanPlayer,
        newSalePrice: parsedSalePrice,
        newPhotoUrl: formPhotoUrl.trim(),
        updateTransitBatches: formUpdateTransit,
      });

      if (!outcome.ok) {
        setFormError(
          outcome.error ?? 'No se pudo guardar la actualización del modelo.',
        );
        return;
      }

      const count = outcome.updatedCount ?? editingTarget.matchingItemsCount;
      const transitNote =
        outcome.updatedTransitCount && outcome.updatedTransitCount > 0
          ? ` y en ${outcome.updatedTransitCount} línea(s) en tránsito`
          : '';
      setExportFeedback({
        type: 'success',
        text: `Modelo actualizado en ${count} registros de inventario${transitNote}.`,
      });
      setEditingTarget(null);
    } catch (err) {
      setFormError(
        err instanceof Error && err.message
          ? err.message
          : 'Ocurrió un error al sincronizar los cambios con Firebase.',
      );
    } finally {
      setIsSavingModel(false);
    }
  };

  const livePreviewUrls = useMemo(() => {
    const raw = formPhotoUrl.trim();
    if (!raw) return { primary: '', fallback: '' };
    const parsed = parseCatalogImageList(raw);
    const firstRaw = parsed[0] ?? raw;
    const primary = normalizarUrlImagen(firstRaw);
    const fallback = obtenerFallbackUrlImagen(firstRaw) ?? '';
    return { primary, fallback };
  }, [formPhotoUrl]);

  const teamFilters = useMemo(() => {
    const present = new Set(state.inventory.map((i) => i.team));
    const orderedCanonical = DEFAULT_TEAM_ORDER.filter((t) => present.has(t));
    const customTeams = Array.from(present)
      .filter((t) => !DEFAULT_TEAM_ORDER.includes(t))
      .sort();
    return ['Todos', ...orderedCanonical, ...customTeams];
  }, [state.inventory]);

  const matrixRows = useMemo(
    () =>
      consolidateMatrixRowsByModelIdentity(
        getInventorySizeMatrix(state.inventory, threshold),
        threshold,
      ),
    [state.inventory, threshold],
  );

  const filteredMatrixRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matrixRows.filter((row) => {
      if (teamFilter !== 'Todos' && row.team !== teamFilter) return false;
      if (onlyLowStock && !row.isLowStock) return false;
      if (onlyAvailable && row.totalStock <= 0) return false;
      if (!q) return true;
      return (
        row.model.toLowerCase().includes(q) ||
        row.team.toLowerCase().includes(q) ||
        row.version.toLowerCase().includes(q)
      );
    });
  }, [matrixRows, onlyAvailable, onlyLowStock, query, teamFilter]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.inventory.filter((item) => {
      if (teamFilter !== 'Todos' && item.team !== teamFilter) return false;
      if (onlyLowStock && item.stock > threshold) return false;
      if (onlyAvailable && item.stock <= 0) return false;
      if (!q) return true;
      return (
        item.model.toLowerCase().includes(q) ||
        item.team.toLowerCase().includes(q) ||
        normalizeVersionDisplay(item.version).toLowerCase().includes(q) ||
        item.size.toLowerCase().includes(q)
      );
    });
  }, [onlyAvailable, onlyLowStock, query, state.inventory, teamFilter, threshold]);

  const totalUnits = getTotalUnits(state);
  const totalValue = getTotalInventoryCostValue(state);
  const lowStockModelsCount = matrixRows.filter((r) => r.isLowStock).length;
  const filteredUnits =
    displayMode === 'matrix'
      ? filteredMatrixRows.reduce((sum, r) => sum + r.totalStock, 0)
      : filteredItems.reduce((sum, i) => sum + i.stock, 0);

  const handleExportAvailableExcel = () => {
    setExportFeedback(null);
    if (typeof window === 'undefined' || !window.XLSX) {
      setExportFeedback({
        type: 'error',
        text: 'La librería SheetJS (xlsx) aún está cargando o no está disponible sin conexión.',
      });
      return;
    }

    const availableRows = filteredMatrixRows.filter((row) => row.totalStock > 0);
    if (availableRows.length === 0) {
      setExportFeedback({
        type: 'error',
        text: 'No hay franelas disponibles en stock (> 0 unidades) con los filtros actuales.',
      });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const payload = buildAvailableStockExcelPayload(
      availableRows,
      state.exchangeRates.usdt,
      today,
    );

    const XLSX = window.XLSX;
    const sheetData = [payload.headers, ...payload.rows, payload.totalsRow];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, payload.sheetName);
    XLSX.writeFile(wb, payload.fileName);

    setExportFeedback({
      type: 'success',
      text: `Excel "${payload.fileName}" descargado (${payload.rows.length} modelos disponibles + fila de totales).`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Inventario y Stock Base (Matriz S–XXL)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Sumatoria en tiempo real por Modelo, Versión y Talla con alertas rojas en stock bajo (≤ {threshold} unidades).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <span>
            Total Bodega:{' '}
            <strong
              data-testid="inventory-total-units"
              className="font-mono-num text-white"
            >
              {totalUnits} uds
            </strong>
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span>
            Capital FIFO:{' '}
            <strong className="font-mono-num text-blue-300">
              {formatUSD(totalValue)}
            </strong>
          </span>
          {lowStockModelsCount > 0 && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {lowStockModelsCount} con stock ≤ {threshold}
              </span>
            </>
          )}
          <button
            type="button"
            data-testid="btn-download-available-inventory-excel"
            onClick={handleExportAvailableExcel}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Descargar Disponibles (.xlsx)
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
          {exportFeedback.type === 'error' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          )}
          <span>{exportFeedback.text}</span>
        </div>
      )}

      <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="inventory-search" className="sr-only">
              Buscar por equipo o modelo
            </label>
            <input
              id="inventory-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por equipo o modelo (ej. Barcelona, Real Madrid, Liverpool)..."
              className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] pl-10 pr-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="Modo de visualización de inventario"
              className="inline-flex rounded-lg border border-slate-700 bg-[#070D19] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={displayMode === 'matrix'}
                data-testid="btn-inventory-matrix-view"
                onClick={() => setDisplayMode('matrix')}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  displayMode === 'matrix'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                Matriz Tallas
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={displayMode === 'sku'}
                data-testid="btn-inventory-sku-view"
                onClick={() => setDisplayMode('sku')}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  displayMode === 'sku'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                Detalle FIFO
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="btn-filter-only-available"
                onClick={() => setOnlyAvailable((prev) => !prev)}
                aria-pressed={onlyAvailable}
                className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  onlyAvailable
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-700 bg-[#070D19] text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    onlyAvailable
                      ? 'border-emerald-400 bg-emerald-500 text-white'
                      : 'border-slate-600 bg-slate-800 text-transparent'
                  }`}
                  aria-hidden="true"
                >
                  <CheckCircle2 className="h-3 w-3" />
                </span>
                <span>Solo disponibles</span>
              </button>

              <button
                type="button"
                data-testid="btn-filter-low-stock"
                onClick={() => setOnlyLowStock((prev) => !prev)}
                aria-pressed={onlyLowStock}
                className={`min-h-[42px] rounded-lg border px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                  onlyLowStock
                    ? 'border-red-500/50 bg-red-500/15 text-red-300'
                    : 'border-slate-700 bg-[#070D19] text-slate-300 hover:bg-slate-800'
                }`}
              >
                {onlyLowStock
                  ? `Mostrando Stock Bajo (≤ ${threshold})`
                  : `Filtrar Stock Bajo (≤ ${threshold})`}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {teamFilters.map((team) => {
            const active = teamFilter === team;
            return (
              <button
                key={team}
                type="button"
                onClick={() => setTeamFilter(team)}
                className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#080E1C] text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {team}
              </button>
            );
          })}
        </div>
      </section>

      {state.inventory.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-[#0D1526] p-8 text-center">
          <p className="text-sm font-semibold text-white">
            Bodega sin mercancía ingresada
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Registra una orden en Compras y recíbela en bodega o sincroniza un respaldo Excel desde Configuración.
          </p>
        </div>
      ) : (displayMode === 'matrix'
          ? filteredMatrixRows.length === 0
          : filteredItems.length === 0) ? (
        <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-8 text-center">
          <p className="text-sm font-medium text-white">
            No se encontraron modelos con ese criterio
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Prueba limpiando la búsqueda o seleccionando otra categoría.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setTeamFilter('Todos');
              setOnlyLowStock(false);
              setOnlyAvailable(false);
            }}
            className="mt-4 min-h-[40px] rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
          >
            Limpiar filtros
          </button>
        </div>
      ) : displayMode === 'matrix' ? (
        <section className="rounded-xl border border-slate-800 bg-[#0D1526] overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-xs text-slate-400">
            <span>
              Mostrando{' '}
              <strong className="font-mono-num text-slate-200">
                {filteredMatrixRows.length}
              </strong>{' '}
              modelos (sumatoria S–XXL)
            </span>
            <span>
              Unidades filtradas:{' '}
              <strong className="font-mono-num text-white">
                {filteredUnits}
              </strong>
            </span>
          </div>

          {/* Tabla dinámica Desktop: Modelo × Versión × Tallas (S, M, L, XL, XXL) */}
          <div className="hidden md:block overflow-x-auto">
            <table
              data-testid="inventory-matrix-table"
              className="w-full text-left text-sm"
            >
              <thead className="border-b border-slate-800 bg-[#080E1C] text-xs font-medium text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Categoría</th>
                  <th scope="col" className="px-4 py-3">Modelo</th>
                  <th scope="col" className="px-4 py-3">Versión</th>
                  {ALL_JERSEY_SIZES.map((sz) => (
                    <th key={sz} scope="col" className="px-3 py-3 text-center">
                      {sz}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3 text-right">Total</th>
                  <th scope="col" className="px-4 py-3 text-right">PVP ($)</th>
                  <th scope="col" className="px-4 py-3 text-right">Estado</th>
                  <th scope="col" className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredMatrixRows.map((row) => (
                  <tr
                    key={row.key}
                    data-testid={`matrix-row-${row.key}`}
                    className={`transition-colors ${
                      row.isLowStock
                        ? 'bg-red-500/10 hover:bg-red-500/15'
                        : 'hover:bg-slate-800/35'
                    }`}
                  >
                    <td className="px-4 py-3 text-xs font-medium text-blue-300 whitespace-nowrap">
                      {row.team}
                    </td>
                    <td className="px-4 py-3 font-medium text-white">
                      <span>{row.model}</span>
                      {row.extraSizes.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {row.extraSizes.map((ex) => (
                            <span
                              key={ex.size}
                              className={`font-mono-num inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                                ex.isLowStock
                                  ? 'border-red-500/40 bg-red-500/10 text-red-300'
                                  : 'border-slate-700 bg-[#080E1C] text-slate-200'
                              }`}
                            >
                              {ex.size}: {ex.stock}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                      {row.version}
                    </td>
                    {ALL_JERSEY_SIZES.map((sz) => {
                      const qty = row.sizes[sz];
                      const isTracked = row.trackedSizes[sz];
                      const isSizeLow = isTracked && qty <= threshold;
                      return (
                        <td
                          key={sz}
                          className={`px-3 py-3 text-center font-mono-num text-sm ${
                            isSizeLow
                              ? 'font-bold text-red-400 bg-red-500/10'
                              : qty > 0
                                ? 'font-semibold text-white'
                                : 'text-slate-600'
                          }`}
                        >
                          {isTracked ? qty : '0'}
                        </td>
                      );
                    })}
                    <td
                      data-testid={`matrix-total-${row.key}`}
                      className={`px-4 py-3 text-right font-mono-num text-base font-bold ${
                        row.isLowStock ? 'text-red-400' : 'text-white'
                      }`}
                    >
                      {row.totalStock}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-emerald-300 whitespace-nowrap">
                      {formatUSD(row.salePrice)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {row.isLowStock ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          Stock Bajo (≤ {threshold})
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-emerald-400">
                          Disponible
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        data-testid={`btn-edit-model-matrix-${row.key}`}
                        onClick={() =>
                          openEditModelModal({
                            model: row.model,
                            version: row.version,
                            team: row.team,
                            salePrice: row.salePrice,
                          })
                        }
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-700 bg-[#080E1C] px-2.5 py-1 text-xs font-semibold text-slate-200 transition-colors hover:border-blue-500/60 hover:bg-blue-600/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        <Pencil className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>Editar</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tarjetas responsive móvil */}
          <div className="divide-y divide-slate-800/80 md:hidden">
            {filteredMatrixRows.map((row) => (
              <div
                key={row.key}
                className={`p-4 space-y-3 ${row.isLowStock ? 'bg-red-500/10' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-blue-300">
                      {row.team} · {row.version}
                    </p>
                    <p className="text-sm font-semibold text-white break-words">
                      {row.model}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      PVP{' '}
                      <span className="font-mono-num text-emerald-300">
                        {formatUSD(row.salePrice)}
                      </span>{' '}
                      · Costo prom.{' '}
                      <span className="font-mono-num text-slate-300">
                        {formatUSD(row.avgCogs)}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="text-right">
                      <span
                        className={`font-mono-num block text-base font-bold ${
                          row.isLowStock ? 'text-red-400' : 'text-white'
                        }`}
                      >
                        {row.totalStock} uds
                      </span>
                      {row.isLowStock ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          Stock Bajo
                        </span>
                      ) : (
                        <span className="text-[11px] text-emerald-400">
                          Disponible
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      data-testid={`btn-edit-model-mobile-${row.key}`}
                      onClick={() =>
                        openEditModelModal({
                          model: row.model,
                          version: row.version,
                          team: row.team,
                          salePrice: row.salePrice,
                        })
                      }
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-700 bg-[#080E1C] px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-blue-500/60 hover:bg-blue-600/20 hover:text-white"
                    >
                      <Pencil className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Editar</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-1.5 text-center">
                  {ALL_JERSEY_SIZES.map((sz) => {
                    const qty = row.sizes[sz];
                    const isSizeLow = row.trackedSizes[sz] && qty <= threshold;
                    return (
                      <div
                        key={sz}
                        className={`rounded-lg border px-1.5 py-1.5 ${
                          isSizeLow
                            ? 'border-red-500/40 bg-red-500/15 text-red-300'
                            : 'border-slate-800 bg-[#080E1C] text-slate-300'
                        }`}
                      >
                        <span className="block text-[10px] font-medium text-slate-400">
                          {sz}
                        </span>
                        <span
                          className={`font-mono-num text-xs font-bold ${
                            isSizeLow
                              ? 'text-red-300'
                              : qty > 0
                                ? 'text-white'
                                : 'text-slate-600'
                          }`}
                        >
                          {qty}
                        </span>
                      </div>
                    );
                  })}
                  {row.extraSizes.map((ex) => (
                    <div
                      key={ex.size}
                      className={`rounded-lg border px-1.5 py-1.5 ${
                        ex.isLowStock
                          ? 'border-red-500/40 bg-red-500/15 text-red-300'
                          : 'border-slate-800 bg-[#080E1C] text-slate-300'
                      }`}
                    >
                      <span className="block text-[10px] font-medium text-slate-400">
                        {ex.size}
                      </span>
                      <span
                        className={`font-mono-num text-xs font-bold ${
                          ex.isLowStock ? 'text-red-300' : 'text-white'
                        }`}
                      >
                        {ex.stock}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-800 bg-[#0D1526] overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-xs text-slate-400">
            <span>
              Mostrando{' '}
              <strong className="font-mono-num text-slate-200">
                {filteredItems.length}
              </strong>{' '}
              SKUs
            </span>
            <span>
              Unidades filtradas:{' '}
              <strong className="font-mono-num text-white">
                {filteredUnits}
              </strong>
            </span>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-[#080E1C] text-xs font-medium text-slate-400">
                <tr>
                  <th scope="col" className="px-5 py-3">Equipo</th>
                  <th scope="col" className="px-5 py-3">Modelo y Capas FIFO</th>
                  <th scope="col" className="px-5 py-3">Versión</th>
                  <th scope="col" className="px-5 py-3">Talla</th>
                  <th scope="col" className="px-5 py-3 text-right">Stock</th>
                  <th scope="col" className="px-5 py-3 text-right">COGS FIFO</th>
                  <th scope="col" className="px-5 py-3 text-right">PVP (USDT)</th>
                  <th scope="col" className="px-5 py-3 text-right">Valor Lotes</th>
                  <th scope="col" className="px-5 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredItems.map((item) => {
                  const low = item.stock <= threshold;
                  const activeBatches = (item.fifoBatches ?? []).filter(
                    (b) => b.remainingQuantity > 0,
                  );
                  const nextFifoCost = getNextFifoUnitCost(item);
                  const skuTotalValue =
                    activeBatches.length > 0
                      ? activeBatches.reduce(
                          (s, b) => s + b.remainingQuantity * b.unitCost,
                          0,
                        )
                      : item.stock * item.cogs;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        low
                          ? 'bg-red-500/10 hover:bg-red-500/15'
                          : 'hover:bg-slate-800/35'
                      }`}
                    >
                      <td className="px-5 py-3 text-xs font-medium text-blue-300">
                        {item.team}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-white">{item.model}</p>
                        {activeBatches.length > 1 && (
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            Capas FIFO:{' '}
                            {activeBatches
                              .map(
                                (b) =>
                                  `${b.remainingQuantity} uds @ ${formatUSD(b.unitCost)} (${b.entryDate})`,
                              )
                              .join(' → ')}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-300">
                        {normalizeVersionDisplay(item.version)}
                      </td>
                      <td className="px-5 py-3 font-mono-num text-slate-300">
                        {item.size}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-mono-num font-bold ${
                          low ? 'text-red-400' : 'text-white'
                        }`}
                      >
                        {item.stock}
                        {low && (
                          <span className="ml-1.5 text-[10px] font-semibold text-red-300">
                            (≤ {threshold})
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono-num text-slate-300">
                        {formatUSD(nextFifoCost)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono-num text-emerald-300">
                        {formatUSD(item.salePrice)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono-num font-medium text-slate-200">
                        {formatUSD(skuTotalValue)}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          data-testid={`btn-edit-model-sku-${item.id}`}
                          onClick={() =>
                            openEditModelModal({
                              model: item.model,
                              version: item.version,
                              team: item.team,
                              salePrice: item.salePrice,
                            })
                          }
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-700 bg-[#080E1C] px-2.5 py-1 text-xs font-semibold text-slate-200 transition-colors hover:border-blue-500/60 hover:bg-blue-600/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <Pencil className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>Editar</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-800/80 md:hidden">
            {filteredItems.map((item) => {
              const low = item.stock <= threshold;
              const nextFifoCost = getNextFifoUnitCost(item);
              const activeBatches = (item.fifoBatches ?? []).filter(
                (b) => b.remainingQuantity > 0,
              );
              return (
                <div
                  key={item.id}
                  className={`p-4 flex items-center justify-between gap-3 ${
                    low ? 'bg-red-500/10' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-blue-300">
                      {item.team}
                    </p>
                    <p className="text-sm font-semibold text-white break-words">
                      {item.model}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {normalizeVersionDisplay(item.version)} · Talla {item.size} · PVP{' '}
                      <span className="font-mono-num text-emerald-300">
                        {formatUSD(item.salePrice)}
                      </span>{' '}
                      · FIFO{' '}
                      <span className="font-mono-num text-slate-300">
                        {formatUSD(nextFifoCost)}
                      </span>
                      {activeBatches.length > 1
                        ? ` (${activeBatches.length} lotes)`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="text-right">
                      <span
                        className={`font-mono-num block text-base font-bold ${
                          low ? 'text-red-400' : 'text-white'
                        }`}
                      >
                        {item.stock} uds
                      </span>
                      <span className="font-mono-num text-[11px] text-slate-400">
                        {formatUSD(item.stock * nextFifoCost)}
                      </span>
                    </div>
                    <button
                      type="button"
                      data-testid={`btn-edit-model-sku-mobile-${item.id}`}
                      onClick={() =>
                        openEditModelModal({
                          model: item.model,
                          version: item.version,
                          team: item.team,
                          salePrice: item.salePrice,
                        })
                      }
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-700 bg-[#080E1C] px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-blue-500/60 hover:bg-blue-600/20 hover:text-white"
                    >
                      <Pencil className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Editar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Modal Mobile-First: Edición Segura de Modelo / Descripción en Bloque */}
      {editingTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 p-0 sm:p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-edit-model-title"
          data-testid="modal-edit-model"
          onClick={handleCloseEditModal}
        >
          <div
            className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-700 bg-[#0D1526] text-slate-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-[#0D1526]/95 px-4 py-3.5 sm:px-6 backdrop-blur-md">
              <div className="min-w-0">
                <h2
                  id="modal-edit-model-title"
                  className="font-display text-base sm:text-lg font-bold text-white"
                >
                  Editar Datos del Modelo
                </h2>
                <p className="mt-0.5 text-xs text-slate-400 break-words">
                  {editingTarget.originalModel} ({editingTarget.originalVersion})
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseEditModal}
                disabled={isSavingModel}
                aria-label="Cerrar modal de edición"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-[#080F1E] text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSubmitBulkModelEdit(e)}
              className="space-y-4 p-4 sm:p-6"
            >
              {/* Aviso informativo y bloqueo estricto de stock y costos FIFO */}
              <div className="rounded-xl border border-blue-500/35 bg-blue-500/10 p-3.5 text-xs text-blue-100 space-y-2">
                <p className="leading-relaxed">
                  Este cambio actualizará simultáneamente los{' '}
                  <strong className="text-white font-mono-num">
                    {editingTarget.matchingItemsCount}
                  </strong>{' '}
                  lotes/tallas registrados bajo este modelo en bodega y en el Catálogo Público, manteniendo intactos sus costos FIFO y stock.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                  <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#080E1C] px-2 py-0.5">
                    <Lock className="h-3 w-3 text-amber-400" aria-hidden="true" />
                    Stock físico bloqueado: <strong className="font-mono-num text-white">{editingTarget.totalStock} uds</strong>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#080E1C] px-2 py-0.5">
                    <Lock className="h-3 w-3 text-amber-400" aria-hidden="true" />
                    Costos FIFO bloqueados ({editingTarget.fifoLayersCount} capa/s)
                  </span>
                </div>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs font-medium text-red-200"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                    aria-hidden="true"
                  />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="edit-model-name"
                  className="block text-xs font-semibold text-slate-200 mb-1.5"
                >
                  Nombre / Descripción del Modelo *
                </label>
                <input
                  id="edit-model-name"
                  data-testid="input-edit-model-name"
                  type="text"
                  required
                  value={formModelName}
                  onChange={(e) => setFormModelName(e.target.value)}
                  placeholder="Ej. Bayern Múnich Local 2026/2027"
                  className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="edit-model-team"
                    className="block text-xs font-semibold text-slate-200 mb-1.5"
                  >
                    Equipo / Club / Categoría
                  </label>
                  <input
                    id="edit-model-team"
                    data-testid="input-edit-model-team"
                    type="text"
                    list="inventory-team-suggestions"
                    value={formTeam}
                    onChange={(e) => setFormTeam(e.target.value)}
                    placeholder="Ej. Barcelona, Real Madrid, Selecciones"
                    className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <datalist id="inventory-team-suggestions">
                    {teamFilters
                      .filter((t) => t !== 'Todos')
                      .map((t) => (
                        <option key={t} value={t} />
                      ))}
                  </datalist>
                </div>

                <div>
                  <label
                    htmlFor="edit-model-version"
                    className="block text-xs font-semibold text-slate-200 mb-1.5"
                  >
                    Versión
                  </label>
                  <select
                    id="edit-model-version"
                    data-testid="select-edit-model-version"
                    value={formVersion}
                    onChange={(e) =>
                      setFormVersion(
                        normalizeVersionDisplay(
                          e.target.value as JerseyVersion,
                        ),
                      )
                    }
                    className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Fans">Fans</option>
                    <option value="Player">Player</option>
                    <option value="Retro">Retro</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="edit-model-player"
                    className="block text-xs font-semibold text-slate-200 mb-1.5"
                  >
                    Jugador / Dorsal (opcional)
                  </label>
                  <input
                    id="edit-model-player"
                    data-testid="input-edit-model-player"
                    type="text"
                    value={formPlayer}
                    onChange={(e) => setFormPlayer(e.target.value)}
                    placeholder="Ej. LAMINE YAMAL 10 (vacío si es lisa)"
                    className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-model-sale-price"
                    className="block text-xs font-semibold text-slate-200 mb-1.5"
                  >
                    Precio de Venta PVP (USDT)
                  </label>
                  <input
                    id="edit-model-sale-price"
                    data-testid="input-edit-model-price"
                    type="number"
                    min="0"
                    step="0.5"
                    value={formSalePrice}
                    onChange={(e) => setFormSalePrice(e.target.value)}
                    placeholder="Ej. 30.00"
                    className="font-mono-num w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-model-photo"
                  className="block text-xs font-semibold text-slate-200 mb-1.5"
                >
                  URL de Imagen / Foto (Catálogo Público)
                </label>
                <div className="flex items-start gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-[#070D19]">
                    {livePreviewUrls.primary && previewFallbackIdx < 2 ? (
                      <img
                        src={
                          previewFallbackIdx === 1 && livePreviewUrls.fallback
                            ? livePreviewUrls.fallback
                            : livePreviewUrls.primary
                        }
                        alt="Vista previa del modelo"
                        className="h-full w-full object-cover"
                        onError={() => {
                          if (
                            previewFallbackIdx === 0 &&
                            livePreviewUrls.fallback
                          ) {
                            setPreviewFallbackIdx(1);
                          } else {
                            setPreviewFallbackIdx(2);
                          }
                        }}
                      />
                    ) : (
                      <ImageIcon
                        className="h-6 w-6 text-slate-500"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      id="edit-model-photo"
                      data-testid="input-edit-model-photo"
                      type="text"
                      value={formPhotoUrl}
                      onChange={(e) => {
                        setFormPhotoUrl(e.target.value);
                        setPreviewFallbackIdx(0);
                      }}
                      placeholder="https://... o enlace compartido de Google Drive"
                      className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#070D19] px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <p className="text-[11px] text-slate-400">
                      Vista previa en vivo. Acepta URLs directas HTTPS o enlaces de Google Drive.
                    </p>
                  </div>
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-[#070D19] p-3 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="checkbox-update-transit-batches"
                  checked={formUpdateTransit}
                  onChange={(e) => setFormUpdateTransit(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-300 leading-snug">
                  Actualizar también el nombre en el historial de compras en tránsito
                  {editingTarget.transitMatchingCount > 0 && (
                    <span className="ml-1 font-semibold text-blue-300">
                      ({editingTarget.transitMatchingCount} línea(s) detectada(s))
                    </span>
                  )}
                </span>
              </label>

              <div className="flex flex-col-reverse gap-2.5 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleCloseEditModal}
                  disabled={isSavingModel}
                  className="min-h-[44px] rounded-lg border border-slate-700 bg-[#080E1C] px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  data-testid="btn-save-bulk-model"
                  disabled={isSavingModel}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-wait disabled:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  {isSavingModel && (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  <span>
                    {isSavingModel ? 'Guardando...' : 'Guardar Cambios'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
