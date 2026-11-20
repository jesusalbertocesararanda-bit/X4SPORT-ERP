import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../data/initialState';
import type { AppState } from '../types/erp';
import { calculateFourLayerMatrixConsolidated } from './finance';
import {
  buildAvailableStockExcelPayload,
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
} from './reports';

function makeRichTestState(): AppState {
  const base = createInitialState();
  const bd1 = calculateFourLayerMatrixConsolidated(40, 12, 'Gabriel');
  const bd2 = calculateFourLayerMatrixConsolidated(50, 14, 'Jesús');
  const bd3 = calculateFourLayerMatrixConsolidated(20, 6, 'Gabriel');

  return {
    ...base,
    customers: [
      {
        id: 'cust-1',
        name: 'Carlos Mendoza',
        city: 'Guacara',
        phone: '0414-1112233',
        social: '@carlosm',
        createdAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-10T10:00:00.000Z',
      },
      {
        id: 'cust-2',
        name: 'María Pérez',
        city: 'Valencia',
        phone: '0424-9998877',
        social: '@mariap',
        createdAt: '2026-11-02T10:00:00.000Z',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    ],
    sales: [
      {
        id: 'sale-1',
        invoiceNumber: '#0001',
        saleDate: '2026-11-10',
        skuId: 'sku-fcb-m',
        modelLabel: 'Barcelona Local 25/26',
        team: 'Barcelona',
        version: 'Fans',
        size: 'M',
        quantity: 2,
        unitCogs: 6,
        finalPrice: 40,
        items: [
          {
            skuId: 'sku-fcb-m',
            modelLabel: 'Barcelona Local 25/26',
            team: 'Barcelona',
            version: 'Fans',
            size: 'M',
            quantity: 1,
            unitCogs: 6,
            totalLineCogs: 6,
            unitPrice: 20,
            subtotal: 20,
          },
          {
            skuId: 'sku-rma-l',
            modelLabel: 'Real Madrid Local 25/26',
            team: 'Real Madrid',
            version: 'Fans',
            size: 'L',
            quantity: 1,
            unitCogs: 6,
            totalLineCogs: 6,
            unitPrice: 20,
            subtotal: 20,
          },
        ],
        customerName: 'Carlos Mendoza',
        customerCity: 'Guacara',
        customerPhone: '0414-1112233',
        seller: 'Gabriel',
        paymentStatus: 'Cobrado',
        paymentMethod: 'Binance USDT',
        breakdown: bd1,
        createdAt: '2026-11-10T15:00:00.000Z',
      },
      {
        id: 'sale-2',
        invoiceNumber: '#0002',
        saleDate: '2026-11-12',
        skuId: 'sku-fcb-m-p',
        modelLabel: 'Barcelona Retro 08/09',
        team: 'Barcelona',
        version: 'Retro',
        size: 'M',
        quantity: 2,
        unitCogs: 7,
        finalPrice: 50,
        items: [
          {
            skuId: 'sku-fcb-m-p',
            modelLabel: 'Barcelona Retro 08/09',
            team: 'Barcelona',
            version: 'Retro',
            size: 'M',
            quantity: 2,
            unitCogs: 7,
            totalLineCogs: 14,
            unitPrice: 25,
            subtotal: 50,
          },
        ],
        customerName: 'María Pérez',
        customerCity: 'Valencia',
        customerPhone: '0424-9998877',
        seller: 'Jesús',
        paymentStatus: 'Pendiente',
        paymentMethod: 'Efectivo ($)',
        debtorName: 'María Pérez',
        breakdown: bd2,
        createdAt: '2026-11-12T16:00:00.000Z',
      },
      {
        id: 'sale-3',
        invoiceNumber: '#0003',
        saleDate: '2026-11-15',
        skuId: 'sku-fcb-m',
        modelLabel: 'Barcelona Local 25/26',
        team: 'Barcelona',
        version: 'Fans',
        size: 'M',
        quantity: 1,
        unitCogs: 6,
        finalPrice: 20,
        items: [
          {
            skuId: 'sku-fcb-m',
            modelLabel: 'Barcelona Local 25/26',
            team: 'Barcelona',
            version: 'Fans',
            size: 'M',
            quantity: 1,
            unitCogs: 6,
            totalLineCogs: 6,
            unitPrice: 20,
            subtotal: 20,
          },
        ],
        customerName: 'Carlos Mendoza',
        customerCity: 'Guacara',
        seller: 'Gabriel',
        paymentStatus: 'Pendiente',
        paymentMethod: 'Pago Móvil / Bs',
        debtorName: 'Carlos Mendoza',
        breakdown: bd3,
        createdAt: '2026-11-15T11:00:00.000Z',
      },
    ],
    purchaseBatches: [
      {
        id: 'batch-mar-1',
        status: 'RECIBIDO EN BODEGA',
        fundingSource: 'cashOnHand',
        entryDate: '2026-10-01',
        receivedDate: '2026-11-05',
        supplier: 'Shenzhen Kits',
        referenceName: 'Lote Marítimo #1',
        shippingType: 'Marítimo',
        orderedTotalUnits: 10,
        totalUnits: 10,
        totalFactoryCost: 50,
        estimatedFreightCost: 10,
        totalFreightCost: 10,
        freightPerUnit: 1,
        totalLandedCost: 60,
        usdtRate: 54.2,
        items: [
          {
            team: 'Barcelona',
            model: 'Barcelona Local 25/26',
            version: 'Fans',
            size: 'M',
            orderedQuantity: 6,
            quantity: 6,
            factoryUnitCost: 5,
            proratedFreightPerUnit: 1,
            landedUnitCost: 6,
            lineFactoryTotal: 30,
            lineLandedTotal: 36,
          },
          {
            team: 'Real Madrid',
            model: 'Real Madrid Local 25/26',
            version: 'Player',
            size: 'L',
            orderedQuantity: 4,
            quantity: 4,
            factoryUnitCost: 5,
            proratedFreightPerUnit: 1,
            landedUnitCost: 6,
            lineFactoryTotal: 20,
            lineLandedTotal: 24,
          },
        ],
        createdAt: '2026-10-01T12:00:00.000Z',
        receivedAt: '2026-11-05T12:00:00.000Z',
      },
      {
        id: 'batch-air-1',
        status: 'EN TRÁNSITO',
        fundingSource: 'growthReinvestment',
        entryDate: '2026-11-14',
        supplier: 'Guangzhou Express',
        referenceName: 'Lote Aéreo #2',
        shippingType: 'Aéreo',
        orderedTotalUnits: 5,
        totalUnits: 5,
        totalFactoryCost: 30,
        estimatedFreightCost: 15,
        totalFreightCost: 15,
        freightPerUnit: 3,
        totalLandedCost: 45,
        usdtRate: 55.0,
        items: [
          {
            team: 'Selecciones',
            model: 'Selección Venezuela Vinotinto',
            version: 'Player',
            size: 'M',
            orderedQuantity: 5,
            quantity: 5,
            factoryUnitCost: 6,
            proratedFreightPerUnit: 3,
            landedUnitCost: 9,
            lineFactoryTotal: 30,
            lineLandedTotal: 45,
          },
        ],
        createdAt: '2026-11-14T12:00:00.000Z',
      },
    ],
    returns: [
      {
        id: 'ret-1',
        type: 'Cambio',
        saleId: 'sale-1',
        invoiceNumber: '#0001',
        returnedSkuId: 'sku-rma-l',
        returnedModelLabel: 'Real Madrid Local 25/26',
        returnedVersion: 'Fans',
        returnedSize: 'L',
        returnedQuantity: 1,
        returnedUnitPrice: 20,
        returnedTotal: 20,
        replacementSkuId: 'sku-rma-xl',
        replacementModelLabel: 'Real Madrid Local 25/26',
        replacementVersion: 'Fans',
        replacementSize: 'XL',
        replacementQuantity: 1,
        replacementUnitPrice: 25,
        replacementTotal: 25,
        differenceUsd: 5,
        paymentMethod: 'Efectivo ($)',
        reason: 'Cambio de talla L a XL',
        customerName: 'Carlos Mendoza',
        createdAt: '2026-11-11T14:00:00.000Z',
      },
    ],
    inventoryAdjustments: [
      {
        id: 'adj-1',
        skuId: 'sku-fcb-m',
        modelLabel: 'Barcelona Local 25/26',
        version: 'Fans',
        size: 'M',
        previousStock: 10,
        newStock: 9,
        delta: -1,
        fifoLossCost: 6,
        adjustmentType: 'descruce',
        targetSkuId: 'sku-fcb-l',
        targetModelLabel: 'Barcelona Local 25/26',
        targetVersion: 'Fans',
        targetSize: 'L',
        reason: 'Descruce por entrega talla L',
        userName: 'Jesús',
        createdAt: '2026-11-13T10:00:00.000Z',
      },
    ],
    bulkImports: [
      {
        id: 'imp-1',
        fileName: 'X4SPORT_Noviembre.xlsx',
        importDate: '2026-11-08',
        userName: 'Jesús',
        sheetsDetected: ['Compras', 'Ventas', 'Finanzas'],
        comprasRows: 12,
        comprasUnits: 45,
        comprasCostUsd: 290,
        ventasRows: 8,
        ventasUnits: 14,
        ventasRevenueUsd: 350,
        resultingSkusCount: 15,
        resultingStockUnits: 31,
        cashOnHandUsd: 135.19,
        usdtRate: 54.2,
        bcvRate: 46.5,
        status: 'Aplicada',
        notes: 'Sincronización completa FIFO',
        createdAt: '2026-11-08T18:00:00.000Z',
      },
    ],
  };
}

test('Ventas: filtro cruzado AND exacto (fechas + Gabriel + $20 + Barcelona + talla M + Contado)', () => {
  const state = makeRichTestState();
  const filters: ReportFilters = {
    ...DEFAULT_REPORT_FILTERS,
    dateFrom: '2026-11-09',
    dateTo: '2026-11-16',
    seller: 'Gabriel',
    amountMin: '20',
    amountMax: '20',
    search: 'Barcelona',
    size: 'M',
    paymentCondition: 'Contado',
  };

  const res = filterSalesReportRows(state, filters);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].invoiceNumber, '#0001');
  assert.equal(res.rows[0].modelLabel, 'Barcelona Local 25/26');
  assert.equal(res.rows[0].size, 'M');
  assert.equal(res.rows[0].paymentCondition, 'Contado');
  assert.equal(res.totals.filteredCount, 1);
  assert.equal(res.totals.totalUnits, 1);
  assert.equal(res.totals.totalUsd, 20);

  // Switch paymentCondition to Crédito -> must match #0003 instead of #0001
  const creditRes = filterSalesReportRows(state, {
    ...filters,
    paymentCondition: 'Crédito',
  });
  assert.equal(creditRes.rows.length, 1);
  assert.equal(creditRes.rows[0].invoiceNumber, '#0003');
  assert.equal(creditRes.totals.totalUsd, 20);
});

test('Compras: filtro AND por tipo de importación Marítimo vs Aéreo y talla', () => {
  const state = makeRichTestState();
  const maritime = filterPurchasesReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    shippingType: 'Marítimo',
    size: 'M',
  });
  assert.equal(maritime.rows.length, 1);
  assert.equal(maritime.rows[0].model, 'Barcelona Local 25/26');
  assert.equal(maritime.totals.totalUnits, 6);
  assert.equal(maritime.totals.totalUsd, 36);

  const air = filterPurchasesReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    shippingType: 'Aéreo',
  });
  assert.equal(air.rows.length, 1);
  assert.equal(air.rows[0].shippingType, 'Aéreo');
  assert.equal(air.totals.totalUnits, 5);
  assert.equal(air.totals.totalUsd, 45);
});

test('Clientes: agrega clientes, ventas y CxC con filtros cruzados por ciudad y condición', () => {
  const state = makeRichTestState();
  const guacara = filterCustomersReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    city: 'Guacara',
    paymentCondition: 'Contado',
  });
  assert.equal(guacara.rows.length, 1);
  assert.equal(guacara.rows[0].customerName, 'Carlos Mendoza');
  assert.equal(guacara.rows[0].unitsBought, 2);
  assert.equal(guacara.rows[0].totalSpentUsd, 40);

  // CxC initial debtors appear when filtering Crédito without product/seller constraint
  const creditAll = filterCustomersReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    paymentCondition: 'Crédito',
  });
  assert.ok(creditAll.rows.some((r) => r.customerName === 'María Pérez'));
  assert.ok(creditAll.rows.some((r) => r.customerName === 'Charles'));
});

test('Devoluciones y Ajustes: filtran correctamente con talla y responsable userName', () => {
  const state = makeRichTestState();

  const returnsRes = filterReturnsReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    size: 'XL',
    seller: 'Gabriel',
  });
  assert.equal(returnsRes.rows.length, 1);
  assert.equal(returnsRes.totals.totalUnits, 1);
  assert.equal(returnsRes.totals.totalUsd, 5);

  const adjRes = filterAdjustmentsReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    search: 'Jesús',
    size: 'M',
  });
  assert.equal(adjRes.rows.length, 1);
  assert.equal(adjRes.rows[0].userName, 'Jesús');
  assert.equal(adjRes.totals.totalUnits, -1);
  assert.equal(adjRes.totals.totalUsd, 6);
});

test('Salidas y Entradas: consolida compras recibidas, ventas, devoluciones y ajustes descruce', () => {
  const state = makeRichTestState();
  // Only Barcelona size M movements across purchases (+6), sales (-1, -1), descruce (-1)
  const movs = filterStockMovementsReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    search: 'Barcelona Local',
    size: 'M',
  });
  assert.equal(movs.rows.length, 4);
  assert.equal(movs.totals.filteredCount, 4);
  assert.equal(movs.totals.totalUnits, 9); // 6 + 1 + 1 + 1 moved
  assert.ok(movs.totals.extraNote?.includes('+6 entradas / -3 salidas'));

  // Maritime filter isolates only received purchase entries
  const maritimeMovs = filterStockMovementsReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    shippingType: 'Marítimo',
  });
  assert.equal(maritimeMovs.rows.length, 2);
  assert.equal(maritimeMovs.totals.totalUnits, 10);
});

test('Cargas Masivas: lista historial explícito y filtra por texto y rango de fechas', () => {
  const state = makeRichTestState();
  const imports = filterBulkImportsReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    dateFrom: '2026-11-01',
    dateTo: '2026-11-10',
    search: 'Noviembre',
  });
  assert.equal(imports.rows.length, 1);
  assert.equal(imports.rows[0].fileName, 'X4SPORT_Noviembre.xlsx');
  assert.equal(imports.totals.totalUnits, 59); // 45 + 14
  assert.equal(imports.totals.totalUsd, 640); // 290 + 350
});

test('Excel Export Payload: exporta únicamente filas filtradas visibles con fila final TOTALES', () => {
  const state = makeRichTestState();
  const filters: ReportFilters = {
    ...DEFAULT_REPORT_FILTERS,
    seller: 'Gabriel',
    size: 'M',
    paymentCondition: 'Contado',
  };

  const payload = buildReportExcelSheetData('ventas', state, filters);
  assert.equal(payload.sheetName, 'Reporte Ventas');
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0][0], '#0001');
  assert.equal(payload.totalsRow[0], 'TOTALES');
  assert.equal(payload.totalsRow[9], 1); // totalUnits
  assert.equal(payload.totalsRow[11], 20); // totalUsd
});

test('countActiveReportFilters cuenta correctamente los filtros activos aplicables', () => {
  assert.equal(countActiveReportFilters(DEFAULT_REPORT_FILTERS), 0);
  assert.equal(
    countActiveReportFilters({
      ...DEFAULT_REPORT_FILTERS,
      seller: 'Gabriel',
      size: 'M',
      amountMin: '20',
    }),
    3,
  );
});

test('Stock Disponible: filtra totalStock > 0, ordena por equipo/modelo y genera Excel de 13 columnas con TOTALES', () => {
  const base = makeRichTestState();
  const state: AppState = {
    ...base,
    exchangeRates: {
      ...base.exchangeRates,
      usdt: 55,
    },
    inventory: [
      {
        id: 'inv-rma-m',
        team: 'Real Madrid',
        model: 'Real Madrid Local 25/26',
        version: 'Player',
        size: 'M',
        stock: 4,
        cogs: 7.5,
        salePrice: 25,
        fifoBatches: [
          {
            batchId: 'b1',
            batchName: 'Lote Prueba',
            entryDate: '2026-11-01',
            initialQuantity: 4,
            remainingQuantity: 4,
            unitCost: 7.5,
          },
        ],
      },
      {
        id: 'inv-rma-xxxl',
        team: 'Real Madrid',
        model: 'Real Madrid Local 25/26',
        version: 'Player',
        size: 'XXXL',
        stock: 2,
        cogs: 7.5,
        salePrice: 25,
        fifoBatches: [
          {
            batchId: 'b1',
            batchName: 'Lote Prueba',
            entryDate: '2026-11-01',
            initialQuantity: 2,
            remainingQuantity: 2,
            unitCost: 7.5,
          },
        ],
      },
      {
        id: 'inv-fcb-s',
        team: 'Barcelona',
        model: 'Barcelona Local 25/26',
        version: 'Fans',
        size: 'S',
        stock: 3,
        cogs: 6,
        salePrice: 20,
        fifoBatches: [],
      },
      {
        id: 'inv-fcb-l',
        team: 'Barcelona',
        model: 'Barcelona Local 25/26',
        version: 'Fans',
        size: 'L',
        stock: 5,
        cogs: 6,
        salePrice: 20,
        fifoBatches: [],
      },
      {
        id: 'inv-psg-0',
        team: 'PSG',
        model: 'PSG Visitante Agotada',
        version: 'Fans',
        size: 'M',
        stock: 0,
        cogs: 6,
        salePrice: 20,
        fifoBatches: [],
      },
    ],
  };

  // Sin filtros: excluye PSG (stock 0) y ordena Barcelona antes de Real Madrid
  const allRes = filterAvailableStockReportRows(state, DEFAULT_REPORT_FILTERS);
  assert.equal(allRes.rows.length, 2);
  assert.equal(allRes.rows[0].team, 'Barcelona');
  assert.equal(allRes.rows[0].extraSizesText, '—');
  assert.equal(allRes.rows[1].team, 'Real Madrid');
  assert.equal(allRes.rows[1].extraSizesText, 'XXXL: 2');
  assert.equal(allRes.totals.totalUnits, 14); // (3+5) + (4+2)
  assert.equal(allRes.totals.totalUsd, 93); // (8*6) + (6*7.5) = 48 + 45

  // Filtro por talla M: solo debe incluir Real Madrid (Barcelona no tiene talla M disponible)
  const sizeMRes = filterAvailableStockReportRows(state, {
    ...DEFAULT_REPORT_FILTERS,
    size: 'M',
  });
  assert.equal(sizeMRes.rows.length, 1);
  assert.equal(sizeMRes.rows[0].team, 'Real Madrid');

  // Exportación Excel desde buildReportExcelSheetData('inventario', ...)
  const payload = buildReportExcelSheetData(
    'inventario',
    state,
    DEFAULT_REPORT_FILTERS,
  );
  assert.equal(payload.sheetName, 'Franelas Disponibles');
  assert.match(
    payload.fileName,
    /^X4SPORT_Franelas_Disponibles_\d{4}-\d{2}-\d{2}\.xlsx$/,
  );
  assert.deepEqual(payload.headers, [
    'Equipo',
    'Modelo',
    'Versión',
    'S',
    'M',
    'L',
    'XL',
    'XXL',
    'Otras Tallas',
    'Total Disponible',
    'Precio Venta (USDT)',
    'Precio Ref. (Bs)',
    'Valor Inventario FIFO (USDT)',
  ]);
  assert.equal(payload.rows.length, 2);
  // Fila 1: Barcelona
  assert.deepEqual(payload.rows[0], [
    'Barcelona',
    'Barcelona Local 25/26',
    'Fans',
    3,
    0,
    5,
    0,
    0,
    '—',
    8,
    20,
    1100,
    48,
  ]);
  // Fila 2: Real Madrid con talla extra XXXL: 2
  assert.deepEqual(payload.rows[1], [
    'Real Madrid',
    'Real Madrid Local 25/26',
    'Player',
    0,
    4,
    0,
    0,
    0,
    'XXXL: 2',
    6,
    25,
    1375,
    45,
  ]);
  // Fila TOTALES
  assert.deepEqual(payload.totalsRow, [
    'TOTALES',
    '2 modelos',
    '',
    3,
    4,
    5,
    0,
    0,
    '',
    14,
    '',
    '',
    93,
  ]);

  // Direct call helper check with explicit date
  const directPayload = buildAvailableStockExcelPayload(
    allRes.rows,
    55,
    '2026-11-20',
  );
  assert.equal(directPayload.fileName, 'X4SPORT_Franelas_Disponibles_2026-11-20.xlsx');
});
