import type { AppState } from '../types/erp';
import { getTotalReceivables, round2 } from './finance';

const SNAPSHOT_SHEET_NAME = '_ERP_SNAPSHOT_RAW';
const SNAPSHOT_MAGIC_HEADER = 'X4SPORT_ERP_SNAPSHOT_V1';
const SNAPSHOT_CHUNK_SIZE = 30000;

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildFullBackupSnapshotRows(state: AppState): unknown[][] {
  const json = JSON.stringify(state);
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += SNAPSHOT_CHUNK_SIZE) {
    chunks.push(json.slice(i, i + SNAPSHOT_CHUNK_SIZE));
  }
  if (chunks.length === 0) {
    chunks.push('{}');
  }
  const rows: unknown[][] = [
    [SNAPSHOT_MAGIC_HEADER, 'CHUNK_INDEX', 'TOTAL_CHUNKS', 'PAYLOAD_CHUNK'],
  ];
  chunks.forEach((chunk, index) => {
    rows.push([1, index, chunks.length, chunk]);
  });
  return rows;
}

export function reconstructStateFromSnapshotRows(rows: unknown[][]): AppState {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(
      'El archivo de respaldo está vacío o no contiene datos en _ERP_SNAPSHOT_RAW.',
    );
  }

  const header = rows[0] ?? [];
  if (String(header[0] ?? '').trim() !== SNAPSHOT_MAGIC_HEADER) {
    throw new Error(
      'El archivo Excel no corresponde a un Respaldo Completo oficial de X4SPORT.',
    );
  }

  const dataRows = rows
    .slice(1)
    .filter((row) => Array.isArray(row) && row.length >= 4)
    .sort((a, b) => Number(a[1] ?? 0) - Number(b[1] ?? 0));

  if (dataRows.length === 0) {
    throw new Error(
      'No se encontraron bloques de datos válidos en la hoja _ERP_SNAPSHOT_RAW.',
    );
  }

  const jsonString = dataRows.map((row) => String(row[3] ?? '')).join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error(
      'El respaldo completo en Excel está corrupto o incompleto (JSON inválido).',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'El contenido del respaldo no tiene una estructura de estado ERP válida.',
    );
  }

  const candidate = parsed as Record<string, unknown>;
  const hasExpenses =
    Array.isArray(candidate.operatingExpenses) ||
    Array.isArray(candidate.expenses);

  if (
    !Array.isArray(candidate.inventory) ||
    !Array.isArray(candidate.sales) ||
    !Array.isArray(candidate.purchases) ||
    !Array.isArray(candidate.movements) ||
    !Array.isArray(candidate.receivables) ||
    !hasExpenses ||
    typeof candidate.cashOnHand !== 'number' ||
    !candidate.exchangeRates ||
    typeof candidate.exchangeRates !== 'object' ||
    !candidate.funds ||
    typeof candidate.funds !== 'object'
  ) {
    throw new Error(
      'El archivo Excel no contiene todas las colecciones esenciales del ERP (inventory, sales, purchases, movements, expenses, receivables).',
    );
  }

  const normalizedOperatingExpenses = Array.isArray(candidate.operatingExpenses)
    ? candidate.operatingExpenses
    : (candidate.expenses as AppState['operatingExpenses']);

  return {
    ...(parsed as AppState),
    operatingExpenses: normalizedOperatingExpenses,
    purchaseBatches: Array.isArray(candidate.purchaseBatches)
      ? (candidate.purchaseBatches as AppState['purchaseBatches'])
      : [],
    capitalInjections: Array.isArray(candidate.capitalInjections)
      ? (candidate.capitalInjections as AppState['capitalInjections'])
      : [],
    inventoryAdjustments: Array.isArray(candidate.inventoryAdjustments)
      ? (candidate.inventoryAdjustments as AppState['inventoryAdjustments'])
      : [],
  };
}

export function exportFullStateToExcel(state: AppState): string {
  if (typeof window === 'undefined' || !window.XLSX) {
    throw new Error(
      'La librería SheetJS (xlsx) aún está cargando o no está disponible sin conexión.',
    );
  }

  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const today = getTodayIso();
  const generatedAt = new Date().toISOString();

  const totalDividends = round2(
    (state.funds.dividendsByPartner?.Jesús ?? 0) +
      (state.funds.dividendsByPartner?.Josué ?? 0) +
      (state.funds.dividendsByPartner?.Gabriel ?? 0),
  );
  const totalStockUnits = state.inventory.reduce(
    (acc, item) => acc + (Number(item.stock) || 0),
    0,
  );
  const totalReceivables = getTotalReceivables(state);

  // 1. Resumen_General
  const resumenAoa: unknown[][] = [
    ['X4SPORT ERP · Respaldo Completo del Sistema', 'Valor'],
    ['Fecha de Respaldo', today],
    ['Generado (ISO)', generatedAt],
    ['Efectivo Físico en Caja (USDT)', round2(state.cashOnHand)],
    ['Tasa BCV (Bs/USD)', round2(state.exchangeRates.bcv)],
    ['Tasa USDT (Bs/USDT)', round2(state.exchangeRates.usdt)],
    ['Capa 1 · Fondo de Reposición (USDT)', round2(state.funds.replacement)],
    ['Capa 2 · Comisiones Acumuladas (USDT)', round2(state.funds.commissions)],
    ['Capa 3 · Fondo Operativo y Ads (USDT)', round2(state.funds.operatingAndAds)],
    ['Capa 4a · Reinversión de Crecimiento (USDT)', round2(state.funds.growthReinvestment)],
    ['Capa 4b · Total Dividendos Socios (USDT)', totalDividends],
    ['Dividendo Jesús (USDT)', round2(state.funds.dividendsByPartner?.Jesús ?? 0)],
    ['Dividendo Josué (USDT)', round2(state.funds.dividendsByPartner?.Josué ?? 0)],
    ['Dividendo Gabriel (USDT)', round2(state.funds.dividendsByPartner?.Gabriel ?? 0)],
    ['Cuentas por Cobrar Totales (USDT)', totalReceivables],
    ['SKUs en Inventario', state.inventory.length],
    ['Unidades Totales en Stock', totalStockUnits],
    ['Ventas Registradas', state.sales.length],
    ['Lotes de Compra Registrados', state.purchaseBatches?.length ?? 0],
    ['Compras Unitarias Registradas', state.purchases.length],
    ['Cuentas por Cobrar Activas', state.receivables.length],
    ['Gastos Operativos Registrados', state.operatingExpenses.length],
    ['Inyecciones de Capital Registradas', state.capitalInjections.length],
    ['Movimientos Financieros', state.movements.length],
    ['Ganancia Neta Histórica (USDT)', round2(state.historicalNetProfit ?? 0)],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(resumenAoa),
    'Resumen_General',
  );

  // 2. Inventario_FIFO
  const inventarioAoa: unknown[][] = [
    [
      'SKU ID',
      'Equipo / Categoría',
      'Modelo',
      'Versión',
      'Talla',
      'Stock Actual',
      'Costo FIFO (USDT)',
      'Precio Venta (USDT)',
      'Lotes FIFO Activos',
      'Detalle Lotes FIFO',
    ],
    ...state.inventory.map((item) => {
      const batchDetails = (item.fifoBatches ?? [])
        .map(
          (b) =>
            `${b.batchName} (${b.entryDate}): ${b.remainingQuantity}/${b.initialQuantity} uds @ $${round2(b.unitCost).toFixed(2)}`,
        )
        .join(' | ');
      return [
        item.id,
        item.team,
        item.model,
        item.version,
        item.size,
        item.stock,
        round2(item.cogs),
        round2(item.salePrice),
        item.fifoBatches?.length ?? 0,
        batchDetails,
      ];
    }),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(inventarioAoa),
    'Inventario_FIFO',
  );

  // 3. Ventas
  const ventasAoa: unknown[][] = [
    [
      'ID Venta',
      'Nº Factura',
      'Fecha Venta',
      'Fecha Registro',
      'Cliente',
      'Teléfono',
      'Ciudad',
      'Ítems',
      'Unidades',
      'Monto Total (USDT)',
      'Pagado (USDT)',
      'Devuelto (USDT)',
      'Método de Pago',
      'Vendedor',
      'Estado',
      'Anulada',
    ],
    ...state.sales.map((sale) => {
      const itemsText =
        sale.items && sale.items.length > 0
          ? sale.items
              .map(
                (it) =>
                  `${it.quantity}x ${it.modelLabel} (${it.version}/${it.size})`,
              )
              .join(' | ')
          : `${sale.quantity}x ${sale.modelLabel} (${sale.version}/${sale.size})`;
      return [
        sale.id,
        sale.invoiceNumber ?? '',
        sale.saleDate ?? sale.createdAt.slice(0, 10),
        sale.createdAt,
        sale.customerName,
        sale.customerPhone ?? '',
        sale.customerCity ?? '',
        itemsText,
        sale.quantity,
        round2(sale.finalPrice),
        round2(sale.paidAmount ?? (sale.paymentStatus === 'Cobrado' ? sale.finalPrice : 0)),
        round2(sale.returnedAmount ?? 0),
        sale.paymentMethod,
        sale.seller,
        sale.paymentStatus,
        sale.voided ? 'SI' : 'NO',
      ];
    }),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(ventasAoa),
    'Ventas',
  );

  // 4. Compras
  const comprasAoa: unknown[][] = [
    [
      'ID',
      'Tipo Registro',
      'Fecha Orden',
      'Fecha Estimada',
      'Fecha Recepción',
      'Proveedor / Referencia',
      'Envío',
      'Estado',
      'Fuente Fondo',
      'Unidades',
      'Costo Fábrica (USDT)',
      'Flete Total (USDT)',
      'Costo Total Bodega (USDT)',
      'Tasa USDT',
      'Detalle de Ítems',
    ],
    ...(state.purchaseBatches ?? []).map((batch) => {
      const itemsSummary = (batch.items ?? [])
        .map(
          (it) =>
            `${it.quantity}x ${it.model} (${it.version}/${it.size}) @ $${round2(it.landedUnitCost).toFixed(2)}`,
        )
        .join(' | ');
      return [
        batch.id,
        'Lote / Importación',
        batch.entryDate,
        batch.estimatedArrivalDate ?? '',
        batch.receivedDate ?? '',
        batch.supplier ? `${batch.supplier} · ${batch.referenceName}` : batch.referenceName,
        batch.shippingType,
        batch.status,
        batch.fundingSource,
        batch.totalUnits,
        round2(batch.totalFactoryCost),
        round2(batch.totalFreightCost),
        round2(batch.totalLandedCost),
        batch.usdtRate ?? '',
        itemsSummary,
      ];
    }),
    ...state.purchases.map((pur) => [
      pur.id,
      'Compra Histórica',
      pur.createdAt.slice(0, 10),
      '',
      pur.createdAt.slice(0, 10),
      `${pur.team} · ${pur.model}`,
      'N/A',
      'RECIBIDO',
      'N/A',
      pur.quantity,
      round2(pur.totalCost),
      0,
      round2(pur.totalCost),
      '',
      `${pur.quantity}x ${pur.model} (${pur.version}/${pur.size}) @ $${round2(pur.unitCostWithFreight).toFixed(2)}`,
    ]),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(comprasAoa),
    'Compras',
  );

  // 5. Cuentas_Por_Cobrar
  const cxcAoa: unknown[][] = [
    [
      'ID CxC',
      'Deudor',
      'Saldo Pendiente (USDT)',
      'Monto Original (USDT)',
      'Total Abonado (USDT)',
      'Cantidad de Abonos',
      'Detalle Abonos',
      'Método Origen',
      'Nota / Factura',
      'ID Venta',
      'Fecha Creación',
    ],
    ...state.receivables.map((rec) => {
      const orig = round2(
        rec.originalAmount ?? rec.amount + (rec.paidAmount ?? 0),
      );
      const paid = round2(rec.paidAmount ?? Math.max(0, orig - rec.amount));
      const instSummary = (rec.installments ?? [])
        .map(
          (ins) =>
            `$${round2(ins.amount).toFixed(2)} (${ins.paymentMethod}) ${ins.createdAt.slice(0, 10)}`,
        )
        .join(' | ');
      return [
        rec.id,
        rec.debtor,
        round2(rec.amount),
        orig,
        paid,
        rec.installments?.length ?? 0,
        instSummary,
        rec.paymentMethod ?? '',
        rec.note ?? '',
        rec.saleId ?? '',
        rec.createdAt,
      ];
    }),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(cxcAoa),
    'Cuentas_Por_Cobrar',
  );

  // 6. Gastos_Inyecciones
  const gastosInyeccionesAoa: unknown[][] = [
    [
      'Tipo',
      'ID',
      'Fecha',
      'Concepto',
      'Categoría / Aportante',
      'Fuente / Destino',
      'Método de Pago',
      'Monto (USDT)',
    ],
    ...state.operatingExpenses.map((exp) => [
      'Gasto Operativo',
      exp.id,
      exp.createdAt,
      exp.concept,
      exp.category ?? 'Logística/Producción',
      exp.source,
      exp.paymentMethod,
      round2(exp.amount),
    ]),
    ...state.capitalInjections.map((inj) => [
      'Inyección de Capital',
      inj.id,
      inj.createdAt,
      inj.concept,
      inj.contributor,
      inj.destination,
      inj.paymentMethod,
      round2(inj.amount),
    ]),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(gastosInyeccionesAoa),
    'Gastos_Inyecciones',
  );

  // 7. Movimientos_Financieros
  const movimientosAoa: unknown[][] = [
    ['ID Movimiento', 'Tipo', 'Fecha', 'Descripción', 'Monto (USDT)'],
    ...state.movements.map((mov) => [
      mov.id,
      mov.type,
      mov.createdAt,
      mov.description,
      round2(mov.amount),
    ]),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(movimientosAoa),
    'Movimientos_Financieros',
  );

  // 8. _ERP_SNAPSHOT_RAW
  const snapshotAoa = buildFullBackupSnapshotRows(state);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(snapshotAoa),
    SNAPSHOT_SHEET_NAME,
  );

  const fileName = `X4SPORT_Respaldo_Completo_${today}.xlsx`;

  if (typeof XLSX.write === 'function') {
    const rawOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const bytes = rawOut instanceof Uint8Array ? rawOut : new Uint8Array(rawOut);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  }

  XLSX.writeFile(wb, fileName);
  return fileName;
}

export async function parseFullStateFromExcel(file: File): Promise<AppState> {
  if (typeof window === 'undefined' || !window.XLSX) {
    throw new Error(
      'La librería SheetJS (xlsx) aún está cargando o no está disponible sin conexión.',
    );
  }

  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
  });

  if (!workbook.SheetNames.includes(SNAPSHOT_SHEET_NAME)) {
    throw new Error(
      `El archivo "${file.name}" no es un Respaldo Completo válido de X4SPORT (falta la hoja de integridad ${SNAPSHOT_SHEET_NAME}).`,
    );
  }

  const ws = workbook.Sheets[SNAPSHOT_SHEET_NAME];
  const rows = window.XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];

  return reconstructStateFromSnapshotRows(rows);
}
