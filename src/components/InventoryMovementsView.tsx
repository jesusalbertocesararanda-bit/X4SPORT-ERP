import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Download,
  Filter,
  History,
  Layers,
  Package,
  RotateCcw,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { AppState } from '../types/erp';
import {
  formatUSD,
  normalizeVersionDisplay,
  round2,
} from '../utils/finance';

interface InventoryMovementsViewProps {
  state: AppState;
}

type MovementCategory = 'compra' | 'venta' | 'devolucion' | 'ajuste';
type CategoryFilter = 'all' | MovementCategory;
type SortOrder = 'desc' | 'asc';

interface UnifiedInventoryMovement {
  id: string;
  timestamp: string;
  dateStr: string;
  displayDateTime: string;
  category: MovementCategory;
  typeLabel: string;
  reference: string;
  productTeam: string;
  teamName: string;
  version: string;
  player: string;
  size: string;
  flow: 'Entrada' | 'Salida';
  signedUnits: number;
  unitAmountUsd: number;
  totalAmountUsd: number;
  counterpartyOrReason: string;
  responsible: string;
  status: string;
  isVoided?: boolean;
  searchText: string;
}

const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const PAGE_SIZE = 50;

function extractDateOnly(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function formatDateTimeDisplay(rawTimestamp: string, fallbackDate: string): string {
  const datePart = fallbackDate || extractDateOnly(rawTimestamp);
  if (!rawTimestamp) return datePart || 'Sin fecha';

  const parsed = new Date(rawTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return datePart || rawTimestamp;
  }

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();

  const hasExplicitTime =
    rawTimestamp.includes('T') && !rawTimestamp.endsWith('T12:00:00.000Z');
  if (!hasExplicitTime) {
    if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [y, m, d] = datePart.split('-');
      return `${d}/${m}/${y}`;
    }
    return `${day}/${month}/${year}`;
  }

  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function extractPlayerHint(modelLabel: string): string {
  const raw = (modelLabel || '').trim();
  if (!raw) return '—';

  // Detect patterns like "Equipo · Jugador #10", "Equipo - Jugador #7", "(Messi #10)", "#10"
  const dotParts = raw.split(/\s*[·|]\s*/).map((p) => p.trim()).filter(Boolean);
  if (dotParts.length > 1) {
    const candidate = dotParts.slice(1).join(' · ');
    if (candidate) return candidate;
  }

  const parenMatch = raw.match(/\(([^)]*#\d+[^)]*)\)/);
  if (parenMatch?.[1]) {
    return parenMatch[1].trim();
  }

  const hashMatch = raw.match(/([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+)?\s*#\d+|#\d+)/);
  if (hashMatch?.[1]) {
    return hashMatch[1].trim();
  }

  return '—';
}

function buildUnifiedMovements(state: AppState): UnifiedInventoryMovement[] {
  const list: UnifiedInventoryMovement[] = [];
  const receivedTimestamps = new Set<string>();

  // 1) COMPRAS (Entradas +): Lotes recibidos en bodega (excluyendo pedidos EN TRÁNSITO)
  for (const batch of state.purchaseBatches ?? []) {
    if (batch.status !== 'RECIBIDO EN BODEGA') continue;
    const dateStr = extractDateOnly(
      batch.receivedDate || batch.entryDate || batch.createdAt,
    );
    const timestamp =
      batch.receivedAt ||
      (dateStr ? `${dateStr}T12:00:00.000Z` : batch.createdAt);
    if (batch.receivedAt) receivedTimestamps.add(batch.receivedAt);
    if (batch.createdAt) receivedTimestamps.add(batch.createdAt);

    const ref = batch.referenceName || batch.id;
    const supplierLabel = batch.supplier?.trim()
      ? `${batch.supplier.trim()} (${batch.shippingType})`
      : `Lote ${batch.shippingType}`;
    const responsible = batch.userName?.trim() || 'Admin';
    const status = batch.isDirectReception
      ? 'Recepción Directa'
      : 'Recibido en Bodega';

    (batch.items ?? []).forEach((it, idx) => {
      const qty = Math.max(0, Number(it.receivedQuantity ?? it.quantity) || 0);
      if (qty === 0) return;

      const productTeam = (it.model || it.team || 'Producto').trim();
      const teamName = (it.team || '').trim();
      const version = normalizeVersionDisplay(it.version);
      const player = extractPlayerHint(productTeam);
      const unitCost = round2(Number(it.landedUnitCost) || 0);
      const totalCost = round2(
        Number(it.lineLandedTotal) || qty * unitCost,
      );

      list.push({
        id: `mov-compra-batch-${batch.id}-${idx}`,
        timestamp,
        dateStr,
        displayDateTime: formatDateTimeDisplay(timestamp, dateStr),
        category: 'compra',
        typeLabel: 'Compra (Entrada)',
        reference: ref,
        productTeam,
        teamName,
        version,
        player,
        size: it.size,
        flow: 'Entrada',
        signedUnits: qty,
        unitAmountUsd: unitCost,
        totalAmountUsd: totalCost,
        counterpartyOrReason: supplierLabel,
        responsible,
        status,
        searchText: [
          'compra entrada',
          ref,
          productTeam,
          teamName,
          version,
          player,
          it.size,
          supplierLabel,
          responsible,
          status,
          dateStr,
        ]
          .join(' ')
          .toLowerCase(),
      });
    });
  }

  // Fallback para compras heredadas en state.purchases sin lote recibido emparejado
  for (const pur of state.purchases ?? []) {
    if (receivedTimestamps.has(pur.createdAt)) continue;
    const qty = Math.max(0, Number(pur.quantity) || 0);
    if (qty === 0) continue;

    const dateStr = extractDateOnly(pur.createdAt);
    const productTeam = (pur.model || pur.team || 'Producto').trim();
    const teamName = (pur.team || '').trim();
    const version = normalizeVersionDisplay(pur.version);
    const player = extractPlayerHint(productTeam);
    const unitCost = round2(Number(pur.unitCostWithFreight) || 0);
    const totalCost = round2(Number(pur.totalCost) || qty * unitCost);

    list.push({
      id: `mov-compra-leg-${pur.id}`,
      timestamp: pur.createdAt,
      dateStr,
      displayDateTime: formatDateTimeDisplay(pur.createdAt, dateStr),
      category: 'compra',
      typeLabel: 'Compra (Entrada)',
      reference: pur.id,
      productTeam,
      teamName,
      version,
      player,
      size: pur.size,
      flow: 'Entrada',
      signedUnits: qty,
      unitAmountUsd: unitCost,
      totalAmountUsd: totalCost,
      counterpartyOrReason: 'Compra registrada en inventario',
      responsible: 'Admin',
      status: 'Recibido en Bodega',
      searchText: [
        'compra entrada',
        pur.id,
        productTeam,
        teamName,
        version,
        player,
        pur.size,
        dateStr,
      ]
        .join(' ')
        .toLowerCase(),
    });
  }

  // 2) VENTAS (Salidas -): Incluye ventas activas y anuladas (trazabilidad contable completa)
  for (const sale of state.sales ?? []) {
    const dateStr = extractDateOnly(sale.saleDate || sale.createdAt);
    const createdDateStr = extractDateOnly(sale.createdAt);
    const timestamp =
      sale.saleDate && sale.saleDate !== createdDateStr
        ? `${sale.saleDate}T12:00:00.000Z`
        : sale.createdAt;
    const ref = sale.invoiceNumber || sale.id;
    const customer =
      sale.customerName?.trim() || sale.debtorName?.trim() || 'Cliente Mostrador';
    const responsible =
      sale.userName?.trim() || sale.seller || 'Sin Vendedor';
    const isVoided = Boolean(sale.voided);
    const status = isVoided ? 'Anulada' : sale.paymentStatus;
    const counterparty = isVoided
      ? `${customer} · ${sale.voidReason ? `Anulada: ${sale.voidReason}` : 'Venta anulada'} (${sale.paymentMethod})`
      : `${customer} · ${sale.paymentMethod}`;

    if (sale.items && sale.items.length > 0) {
      sale.items.forEach((it, idx) => {
        const qty = Math.max(1, Number(it.quantity) || 1);
        const productTeam = (it.modelLabel || sale.modelLabel || it.team || sale.team || 'Producto').trim();
        const teamName = (it.team || sale.team || '').trim();
        const version = normalizeVersionDisplay(it.version || sale.version);
        const size = it.size || sale.size;
        const player = extractPlayerHint(productTeam);
        const unitPrice = round2(Number(it.unitPrice) || 0);
        const subtotal = round2(Number(it.subtotal) || qty * unitPrice);

        list.push({
          id: `mov-venta-${sale.id}-${idx}`,
          timestamp,
          dateStr,
          displayDateTime: formatDateTimeDisplay(timestamp, dateStr),
          category: 'venta',
          typeLabel: 'Venta (Salida)',
          reference: ref,
          productTeam,
          teamName,
          version,
          player,
          size,
          flow: 'Salida',
          signedUnits: -qty,
          unitAmountUsd: unitPrice,
          totalAmountUsd: subtotal,
          counterpartyOrReason: counterparty,
          responsible,
          status,
          isVoided,
          searchText: [
            'venta salida',
            ref,
            productTeam,
            teamName,
            version,
            player,
            size,
            customer,
            responsible,
            status,
            sale.paymentMethod,
            sale.voidReason ?? '',
            dateStr,
          ]
            .join(' ')
            .toLowerCase(),
        });
      });
    } else {
      const qty = Math.max(1, Number(sale.quantity) || 1);
      const productTeam = (sale.modelLabel || sale.team || 'Producto').trim();
      const teamName = (sale.team || '').trim();
      const version = normalizeVersionDisplay(sale.version);
      const player = extractPlayerHint(productTeam);
      const totalAmount = round2(Number(sale.finalPrice) || 0);
      const unitPrice = qty > 0 ? round2(totalAmount / qty) : totalAmount;

      list.push({
        id: `mov-venta-${sale.id}`,
        timestamp,
        dateStr,
        displayDateTime: formatDateTimeDisplay(timestamp, dateStr),
        category: 'venta',
        typeLabel: 'Venta (Salida)',
        reference: ref,
        productTeam,
        teamName,
        version,
        player,
        size: sale.size,
        flow: 'Salida',
        signedUnits: -qty,
        unitAmountUsd: unitPrice,
        totalAmountUsd: totalAmount,
        counterpartyOrReason: counterparty,
        responsible,
        status,
        isVoided,
        searchText: [
          'venta salida',
          ref,
          productTeam,
          teamName,
          version,
          player,
          sale.size,
          customer,
          responsible,
          status,
          sale.paymentMethod,
          sale.voidReason ?? '',
          dateStr,
        ]
          .join(' ')
          .toLowerCase(),
      });
    }
  }

  // 3) DEVOLUCIONES Y CAMBIOS (Entradas + / Salidas -)
  const saleById = new Map((state.sales ?? []).map((s) => [s.id, s]));
  for (const ret of state.returns ?? []) {
    const linkedSale = ret.saleId ? saleById.get(ret.saleId) : undefined;
    const dateStr = extractDateOnly(ret.createdAt);
    const ref =
      ret.invoiceNumber || linkedSale?.invoiceNumber || ret.type;
    const customer =
      ret.customerName?.trim() ||
      linkedSale?.customerName?.trim() ||
      'Cliente';
    const responsible =
      linkedSale?.userName?.trim() || linkedSale?.seller || 'Admin';
    const reasonText = ret.reason?.trim() || ret.type;

    const returnedQty = Math.max(1, Number(ret.returnedQuantity) || 1);
    const returnedProduct = (ret.returnedModelLabel || 'Producto').trim();
    const returnedVersion = normalizeVersionDisplay(ret.returnedVersion);
    const returnedPlayer = extractPlayerHint(returnedProduct);

    list.push({
      id: `mov-dev-in-${ret.id}`,
      timestamp: ret.createdAt,
      dateStr,
      displayDateTime: formatDateTimeDisplay(ret.createdAt, dateStr),
      category: 'devolucion',
      typeLabel:
        ret.type === 'Cambio' ? 'Cambio (Reingreso)' : 'Devolución (Entrada)',
      reference: ref,
      productTeam: returnedProduct,
      teamName: '',
      version: returnedVersion,
      player: returnedPlayer,
      size: ret.returnedSize,
      flow: 'Entrada',
      signedUnits: returnedQty,
      unitAmountUsd: round2(Number(ret.returnedUnitPrice) || 0),
      totalAmountUsd: round2(Number(ret.returnedTotal) || 0),
      counterpartyOrReason: `${customer} · ${reasonText}`,
      responsible,
      status: ret.type,
      searchText: [
        'devolucion cambio reingreso entrada',
        ref,
        returnedProduct,
        returnedVersion,
        returnedPlayer,
        ret.returnedSize,
        customer,
        reasonText,
        responsible,
        dateStr,
      ]
        .join(' ')
        .toLowerCase(),
    });

    if (
      ret.replacementModelLabel &&
      (ret.replacementQuantity ?? 0) > 0
    ) {
      const repQty = Math.max(1, Number(ret.replacementQuantity) || 1);
      const repProduct = ret.replacementModelLabel.trim();
      const repVersion = normalizeVersionDisplay(
        ret.replacementVersion || ret.returnedVersion,
      );
      const repSize = ret.replacementSize || ret.returnedSize;
      const repPlayer = extractPlayerHint(repProduct);

      list.push({
        id: `mov-dev-out-${ret.id}`,
        timestamp: ret.createdAt,
        dateStr,
        displayDateTime: formatDateTimeDisplay(ret.createdAt, dateStr),
        category: 'devolucion',
        typeLabel: 'Cambio (Salida)',
        reference: ref,
        productTeam: repProduct,
        teamName: '',
        version: repVersion,
        player: repPlayer,
        size: repSize,
        flow: 'Salida',
        signedUnits: -repQty,
        unitAmountUsd: round2(Number(ret.replacementUnitPrice) || 0),
        totalAmountUsd: round2(Number(ret.replacementTotal) || 0),
        counterpartyOrReason: `${customer} · Reemplazo (${reasonText})`,
        responsible,
        status: 'Cambio',
        searchText: [
          'cambio devolucion salida reemplazo',
          ref,
          repProduct,
          repVersion,
          repPlayer,
          repSize,
          customer,
          reasonText,
          responsible,
          dateStr,
        ]
          .join(' ')
          .toLowerCase(),
      });
    }
  }

  // 4) AJUSTES DE INVENTARIO (Entradas + / Salidas -)
  for (const adj of state.inventoryAdjustments ?? []) {
    const dateStr = extractDateOnly(adj.createdAt);
    const isUncross = adj.adjustmentType === 'descruce';
    const isEntry = adj.delta >= 0;
    const absDelta = Math.abs(adj.delta);
    const productTeam = (adj.modelLabel || 'Producto').trim();
    const version = normalizeVersionDisplay(adj.version);
    const player = extractPlayerHint(productTeam);
    const responsible = adj.userName?.trim() || 'Admin';
    const reasonText = adj.reason?.trim() || 'Ajuste de inventario';
    const status =
      adj.auditMode === 'cascade' || adj.auditMode === 'sku'
        ? 'Auditoría'
        : isUncross
          ? 'Descruce'
          : 'Aplicado';

    list.push({
      id: `mov-adj-${adj.id}`,
      timestamp: adj.createdAt,
      dateStr,
      displayDateTime: formatDateTimeDisplay(adj.createdAt, dateStr),
      category: 'ajuste',
      typeLabel: isUncross
        ? isEntry
          ? 'Ajuste Descruce (+)'
          : 'Ajuste Descruce (-)'
        : isEntry
          ? 'Ajuste (Entrada)'
          : 'Ajuste (Salida)',
      reference: isUncross ? 'Descruce Inv.' : 'Ajuste Inv.',
      productTeam,
      teamName: '',
      version,
      player,
      size: adj.size,
      flow: isEntry ? 'Entrada' : 'Salida',
      signedUnits: adj.delta,
      unitAmountUsd:
        absDelta > 0 && adj.fifoLossCost
          ? round2(adj.fifoLossCost / absDelta)
          : 0,
      totalAmountUsd: round2(Number(adj.fifoLossCost) || 0),
      counterpartyOrReason: reasonText,
      responsible,
      status,
      searchText: [
        'ajuste inventario auditoria descruce',
        productTeam,
        version,
        player,
        adj.size,
        reasonText,
        responsible,
        status,
        dateStr,
      ]
        .join(' ')
        .toLowerCase(),
    });

    if (isUncross && adj.targetModelLabel && absDelta > 0) {
      const targetProduct = adj.targetModelLabel.trim();
      const targetVersion = normalizeVersionDisplay(
        adj.targetVersion ?? adj.version,
      );
      const targetSize = adj.targetSize ?? adj.size;
      const targetPlayer = extractPlayerHint(targetProduct);

      list.push({
        id: `mov-adj-target-${adj.id}`,
        timestamp: adj.createdAt,
        dateStr,
        displayDateTime: formatDateTimeDisplay(adj.createdAt, dateStr),
        category: 'ajuste',
        typeLabel: 'Ajuste Descruce (+)',
        reference: 'Descruce Inv.',
        productTeam: targetProduct,
        teamName: '',
        version: targetVersion,
        player: targetPlayer,
        size: targetSize,
        flow: 'Entrada',
        signedUnits: absDelta,
        unitAmountUsd: 0,
        totalAmountUsd: 0,
        counterpartyOrReason: `Compensación descruce desde ${productTeam} (${adj.size})`,
        responsible,
        status: 'Descruce',
        searchText: [
          'ajuste inventario descruce compensacion entrada',
          targetProduct,
          targetVersion,
          targetPlayer,
          targetSize,
          productTeam,
          reasonText,
          responsible,
          dateStr,
        ]
          .join(' ')
          .toLowerCase(),
      });
    }
  }

  return list;
}

function getCategoryBadgeClasses(category: MovementCategory, isVoided?: boolean): string {
  if (isVoided) {
    return 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400';
  }
  switch (category) {
    case 'compra':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300';
    case 'venta':
      return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/35 dark:bg-blue-500/15 dark:text-blue-300';
    case 'devolucion':
      return 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300';
    case 'ajuste':
      return 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-500/35 dark:bg-purple-500/15 dark:text-purple-300';
  }
}

export function InventoryMovementsView({ state }: InventoryMovementsViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sizeFilter, setSizeFilter] = useState<string>('Todas');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [visibleLimit, setVisibleLimit] = useState<number>(PAGE_SIZE);
  const [exportFeedback, setExportFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const allMovements = useMemo(() => buildUnifiedMovements(state), [state]);

  const availableSizes = useMemo(() => {
    const extra = new Set<string>();
    for (const m of allMovements) {
      if (m.size && !STANDARD_SIZES.includes(m.size)) {
        extra.add(m.size);
      }
    }
    return ['Todas', ...STANDARD_SIZES, ...Array.from(extra).sort()];
  }, [allMovements]);

  // Coincidencias aplicando búsqueda + talla + rango de fechas (sin filtro de categoría aún, para calcular contadores por pestaña)
  const baseFilteredMovements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allMovements.filter((m) => {
      if (sizeFilter !== 'Todas' && m.size !== sizeFilter) return false;
      if (dateFrom && (!m.dateStr || m.dateStr < dateFrom)) return false;
      if (dateTo && (!m.dateStr || m.dateStr > dateTo)) return false;
      if (q && !m.searchText.includes(q)) return false;
      return true;
    });
  }, [allMovements, dateFrom, dateTo, searchQuery, sizeFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = {
      all: baseFilteredMovements.length,
      compra: 0,
      venta: 0,
      devolucion: 0,
      ajuste: 0,
    };
    for (const m of baseFilteredMovements) {
      counts[m.category] += 1;
    }
    return counts;
  }, [baseFilteredMovements]);

  const filteredMovements = useMemo(() => {
    const byCategory =
      categoryFilter === 'all'
        ? baseFilteredMovements
        : baseFilteredMovements.filter((m) => m.category === categoryFilter);

    return [...byCategory].sort((a, b) => {
      const cmpDate = a.dateStr.localeCompare(b.dateStr);
      const cmpTs =
        cmpDate !== 0 ? cmpDate : a.timestamp.localeCompare(b.timestamp);
      return sortOrder === 'desc' ? -cmpTs : cmpTs;
    });
  }, [baseFilteredMovements, categoryFilter, sortOrder]);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [categoryFilter, searchQuery, sizeFilter, dateFrom, dateTo, sortOrder]);

  const summary = useMemo(() => {
    let entriesUnits = 0;
    let exitsUnits = 0;
    let voidedUnits = 0;

    for (const m of filteredMovements) {
      if (m.isVoided) {
        voidedUnits += Math.abs(m.signedUnits);
        continue;
      }
      if (m.signedUnits > 0) {
        entriesUnits += m.signedUnits;
      } else if (m.signedUnits < 0) {
        exitsUnits += Math.abs(m.signedUnits);
      }
    }

    return {
      totalCount: filteredMovements.length,
      entriesUnits,
      exitsUnits,
      netUnits: entriesUnits - exitsUnits,
      voidedUnits,
    };
  }, [filteredMovements]);

  const visibleMovements = useMemo(
    () => filteredMovements.slice(0, visibleLimit),
    [filteredMovements, visibleLimit],
  );

  const hasActiveFilters =
    categoryFilter !== 'all' ||
    searchQuery.trim() !== '' ||
    sizeFilter !== 'Todas' ||
    dateFrom !== '' ||
    dateTo !== '';

  const handleClearFilters = () => {
    setCategoryFilter('all');
    setSearchQuery('');
    setSizeFilter('Todas');
    setDateFrom('');
    setDateTo('');
    setExportFeedback(null);
  };

  const handleExportExcel = () => {
    setExportFeedback(null);
    if (typeof window === 'undefined' || !window.XLSX) {
      setExportFeedback({
        type: 'error',
        text: 'La librería SheetJS (xlsx) aún está cargando o no está disponible sin conexión.',
      });
      return;
    }

    if (filteredMovements.length === 0) {
      setExportFeedback({
        type: 'error',
        text: 'No hay movimientos visibles con los filtros actuales para exportar.',
      });
      return;
    }

    const headers = [
      'Fecha y Hora',
      'Tipo de Movimiento',
      'Referencia / Factura',
      'Producto / Equipo',
      'Versión',
      'Jugador / Dorsal',
      'Talla',
      'Tipo Flujo (Entrada/Salida)',
      'Cantidad (+/-)',
      'Monto Unitario (USDT)',
      'Monto Total (USDT)',
      'Cliente / Proveedor / Motivo',
      'Responsable',
      'Estado',
    ];

    const rows = filteredMovements.map((m) => [
      m.displayDateTime,
      m.typeLabel,
      m.reference,
      m.productTeam,
      m.version,
      m.player,
      m.size,
      m.flow,
      m.isVoided ? 0 : m.signedUnits,
      m.unitAmountUsd,
      m.isVoided ? 0 : m.totalAmountUsd,
      m.counterpartyOrReason,
      m.responsible,
      m.isVoided
        ? `Anulada (${Math.abs(m.signedUnits)} ud${Math.abs(m.signedUnits) === 1 ? '' : 's'})`
        : m.status,
    ]);

    const totalsRow = [
      'TOTALES CONTABLES',
      `Total Entradas: +${summary.entriesUnits} uds`,
      `Total Salidas: -${summary.exitsUnits} uds`,
      `Balance Neto de Unidades: ${summary.netUnits >= 0 ? `+${summary.netUnits}` : summary.netUnits} uds`,
      '',
      '',
      '',
      'Balance Neto de Unidades',
      summary.netUnits,
      '',
      round2(
        filteredMovements.reduce(
          (sum, m) => sum + (m.isVoided ? 0 : m.totalAmountUsd),
          0,
        ),
      ),
      summary.voidedUnits > 0
        ? `${summary.voidedUnits} uds en ventas anuladas excluidas del neto`
        : `${summary.totalCount} movimientos exportados`,
      '',
      'Consolidado',
    ];

    const today = new Date().toISOString().slice(0, 10);
    const categorySlug =
      categoryFilter === 'compra'
        ? '_Compras'
        : categoryFilter === 'venta'
          ? '_Ventas'
          : categoryFilter === 'devolucion'
            ? '_Devoluciones_y_Cambios'
            : categoryFilter === 'ajuste'
              ? '_Ajustes'
              : '';
    const extraFilterSlug =
      searchQuery.trim() || sizeFilter !== 'Todas' || dateFrom || dateTo
        ? '_Filtrado'
        : '';
    const fileName = `X4SPORT_Movimientos_Inventario_${today}${categorySlug}${extraFilterSlug}.xlsx`;

    const XLSX = window.XLSX;
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, totalsRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
    XLSX.writeFile(wb, fileName);

    setExportFeedback({
      type: 'success',
      text: `Excel "${fileName}" descargado (${filteredMovements.length} movimientos + totales contables).`,
    });
  };

  const filterPills: Array<{
    id: CategoryFilter;
    label: string;
    icon: typeof History;
  }> = [
    { id: 'all', label: 'Todos', icon: Layers },
    { id: 'compra', label: 'Compras', icon: ShoppingCart },
    { id: 'venta', label: 'Ventas', icon: ShoppingBag },
    { id: 'devolucion', label: 'Devoluciones y Cambios', icon: RotateCcw },
    { id: 'ajuste', label: 'Ajustes', icon: SlidersHorizontal },
  ];

  return (
    <div className="space-y-5" data-testid="inventory-movements-view">
      {/* Encabezado + Botón Exportar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Movimientos de Inventario
            </h1>
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
              Solo lectura
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Historial cronológico unificado de entradas, salidas, devoluciones y ajustes (solo lectura)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="btn-toggle-sort-order"
            onClick={() =>
              setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
            }
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0D1526] dark:text-slate-200 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {sortOrder === 'desc'
                ? 'Más reciente primero'
                : 'Más antiguo primero'}
            </span>
          </button>

          <button
            type="button"
            data-testid="btn-export-movements-excel"
            onClick={handleExportExcel}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Exportar Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {exportFeedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium ${
            exportFeedback.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
              : 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-200'
          }`}
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {exportFeedback.text}
          </span>
          <button
            type="button"
            onClick={() => setExportFeedback(null)}
            className="rounded p-0.5 opacity-75 hover:opacity-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tarjetas de resumen dinámico sobre los resultados filtrados */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-[#0D1526]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total Movimientos
            </span>
            <History className="h-4 w-4 text-blue-500" aria-hidden="true" />
          </div>
          <p
            data-testid="movements-summary-total"
            className="font-mono-num mt-1.5 text-2xl font-bold text-slate-900 dark:text-white"
          >
            {summary.totalCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Balance neto:{' '}
            <span
              className={`font-mono-num font-semibold ${
                summary.netUnits >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {summary.netUnits >= 0 ? `+${summary.netUnits}` : summary.netUnits} uds
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-[#0D1526]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Entradas (+uds)
            </span>
            <ArrowUpRight className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <p
            data-testid="movements-summary-entries"
            className="font-mono-num mt-1.5 text-2xl font-bold text-emerald-600 dark:text-emerald-400"
          >
            +{summary.entriesUnits}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Compras, reingresos y ajustes positivos
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-[#0D1526]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Salidas (-uds)
            </span>
            <ArrowDownRight className="h-4 w-4 text-red-500" aria-hidden="true" />
          </div>
          <p
            data-testid="movements-summary-exits"
            className="font-mono-num mt-1.5 text-2xl font-bold text-red-600 dark:text-red-400"
          >
            -{summary.exitsUnits}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {summary.voidedUnits > 0
              ? `Ventas activas, cambios y salidas (${summary.voidedUnits} uds anuladas excluidas)`
              : 'Ventas, cambios salientes y ajustes negativos'}
          </p>
        </div>
      </div>

      {/* Píldoras de filtro por tipo + Búsqueda + Filtros opcionales */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-[#0D1526]">
        {/* Píldoras con contador en vivo */}
        <div
          role="tablist"
          aria-label="Filtrar movimientos por tipo"
          className="flex flex-wrap items-center gap-2"
        >
          {filterPills.map((pill) => {
            const Icon = pill.icon;
            const active = categoryFilter === pill.id;
            const count = categoryCounts[pill.id];
            return (
              <button
                key={pill.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`filter-pill-${pill.id}`}
                onClick={() => setCategoryFilter(pill.id)}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#080F1E] dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{pill.label}</span>
                <span
                  className={`font-mono-num rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Barra de búsqueda instantánea + Talla + Fechas + Limpiar */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
          <div className="relative lg:col-span-6">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              data-testid="input-search-movements"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por equipo, jugador, versión, talla, #factura, cliente, proveedor o motivo..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#080F1E] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="lg:col-span-2">
            <label className="sr-only" htmlFor="mov-size-filter">
              Talla
            </label>
            <div className="relative">
              <Filter
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <select
                id="mov-size-filter"
                data-testid="select-movement-size"
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs font-medium text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-[#080F1E] dark:text-white"
              >
                {availableSizes.map((s) => (
                  <option key={s} value={s}>
                    {s === 'Todas' ? 'Talla: Todas' : `Talla: ${s}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:col-span-4">
            <div className="relative">
              <Calendar
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="date"
                aria-label="Desde"
                title="Desde"
                data-testid="input-movement-date-from"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-[#080F1E] dark:text-white"
              />
            </div>
            <div className="relative">
              <Calendar
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="date"
                aria-label="Hasta"
                title="Hasta"
                data-testid="input-movement-date-to"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-[#080F1E] dark:text-white"
              />
            </div>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Mostrando {visibleMovements.length} de {filteredMovements.length} coincidencias
            </span>
            <button
              type="button"
              data-testid="btn-clear-movement-filters"
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* Lista / Tabla */}
      {filteredMovements.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-[#0D1526]">
          <Package
            className="mx-auto h-9 w-9 text-slate-400 dark:text-slate-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
            No se encontraron movimientos con los filtros actuales
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ajusta el término de búsqueda, la talla o el rango de fechas.
          </p>
        </div>
      ) : (
        <>
          {/* Tabla de escritorio */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-[#0D1526]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-[#080F1E] dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 whitespace-nowrap">Fecha y Hora</th>
                    <th className="px-4 py-3 whitespace-nowrap">Tipo</th>
                    <th className="px-4 py-3">Detalle de la Prenda</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">Variación</th>
                    <th className="px-4 py-3">Referencia / Contraparte / Motivo</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">Monto / Responsable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                  {visibleMovements.map((m) => (
                    <tr
                      key={m.id}
                      data-testid="movement-row"
                      className={`transition-colors hover:bg-slate-50/90 dark:hover:bg-slate-800/35 ${
                        m.isVoided ? 'opacity-70' : ''
                      }`}
                    >
                      <td className="px-4 py-3 align-top whitespace-nowrap font-mono-num text-[11px] text-slate-600 dark:text-slate-300">
                        {m.displayDateTime}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getCategoryBadgeClasses(
                              m.category,
                              m.isVoided,
                            )}`}
                          >
                            {m.typeLabel}
                          </span>
                          {m.isVoided && (
                            <span className="inline-flex items-center rounded border border-red-400/50 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-600 dark:text-red-300">
                              Anulada
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p
                          className={`font-semibold text-slate-900 dark:text-white ${
                            m.isVoided ? 'line-through' : ''
                          }`}
                        >
                          {m.productTeam}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {m.version}
                          </span>
                          <span className="font-mono-num rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                            Talla {m.size}
                          </span>
                          {m.player !== '—' && (
                            <span className="truncate max-w-[180px]">
                              · {m.player}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                        <span
                          className={`font-mono-num text-sm font-bold ${
                            m.isVoided
                              ? 'line-through text-slate-400 dark:text-slate-500'
                              : m.signedUnits >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {m.signedUnits >= 0
                            ? `+${m.signedUnits}`
                            : m.signedUnits}
                        </span>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                          {m.flow}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top max-w-[260px]">
                        <p className="font-mono-num text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {m.reference}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2">
                          {m.counterpartyOrReason}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                        <p className="font-mono-num font-semibold text-slate-900 dark:text-white">
                          {m.totalAmountUsd > 0
                            ? formatUSD(m.totalAmountUsd)
                            : '—'}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {m.responsible} · {m.status}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tarjetas compactas en móvil */}
          <div className="space-y-2.5 md:hidden">
            {visibleMovements.map((m) => (
              <div
                key={m.id}
                data-testid="movement-card-mobile"
                className={`rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-[#0D1526] ${
                  m.isVoided ? 'opacity-75' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${getCategoryBadgeClasses(
                        m.category,
                        m.isVoided,
                      )}`}
                    >
                      {m.typeLabel}
                    </span>
                    {m.isVoided && (
                      <span className="inline-flex items-center rounded border border-red-400/50 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-600 dark:text-red-300">
                        Anulada
                      </span>
                    )}
                    <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                      {m.displayDateTime}
                    </span>
                  </div>

                  <span
                    className={`font-mono-num text-sm font-bold shrink-0 ${
                      m.isVoided
                        ? 'line-through text-slate-400'
                        : m.signedUnits >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {m.signedUnits >= 0 ? `+${m.signedUnits}` : m.signedUnits} uds
                  </span>
                </div>

                <p
                  className={`mt-2 text-xs font-semibold text-slate-900 dark:text-white ${
                    m.isVoided ? 'line-through' : ''
                  }`}
                >
                  {m.productTeam}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {m.version}
                  </span>
                  <span className="font-mono-num rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                    Talla {m.size}
                  </span>
                  {m.player !== '—' && <span>· {m.player}</span>}
                </div>

                <div className="mt-2.5 flex items-end justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] dark:border-slate-800/80">
                  <div className="min-w-0 flex-1 text-slate-600 dark:text-slate-400">
                    <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                      {m.reference}
                    </span>{' '}
                    · <span className="break-words">{m.counterpartyOrReason}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono-num font-semibold text-slate-900 dark:text-white">
                      {m.totalAmountUsd > 0 ? formatUSD(m.totalAmountUsd) : '—'}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {m.responsible}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Paginación / Carga progresiva de 50 en 50 */}
          {filteredMovements.length > visibleLimit && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-[#0D1526]">
              <span className="text-slate-600 dark:text-slate-400">
                Mostrando <strong className="text-slate-900 dark:text-white">{visibleMovements.length}</strong> de{' '}
                <strong className="text-slate-900 dark:text-white">{filteredMovements.length}</strong> movimientos
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="btn-load-more-movements"
                  onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
                  className="inline-flex min-h-[34px] items-center rounded-lg border border-blue-500/40 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-600/15 dark:text-blue-300 dark:hover:bg-blue-600/25"
                >
                  Cargar {Math.min(PAGE_SIZE, filteredMovements.length - visibleLimit)} más
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleLimit(filteredMovements.length)}
                  className="inline-flex min-h-[34px] items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Ver todos ({filteredMovements.length})
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
