import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../data/initialState';
import type { AppState } from '../types/erp';
import {
  AJUSTES_MASIVOS_HEADERS,
  applyBulkUploadPreview,
  COMPRAS_MASIVAS_HEADERS,
  GASTOS_MASIVOS_HEADERS,
  getBulkTemplateSpec,
  parseBulkSheetMatrix,
  VENTAS_MASIVAS_HEADERS,
} from './bulkImport';
import { calculateFourLayerMatrixConsolidated } from './finance';
import {
  buildRecommendedOrderExcelSheet,
  computeSmartOrderRecommendation,
} from './statistics';

function makeBulkBaseState(): AppState {
  const base = createInitialState();
  return {
    ...base,
    cashOnHand: 800,
    funds: {
      ...base.funds,
      replacement: 300,
      operatingAndAds: 250,
      growthReinvestment: 250,
    },
    inventory: [
      {
        id: 'sku-fcb-m',
        team: 'Barcelona',
        model: 'Barcelona Local 25/26',
        version: 'Fans',
        size: 'M',
        stock: 10,
        cogs: 6.5,
        salePrice: 25,
        fifoBatches: [
          {
            batchId: 'b-init-1',
            batchName: 'Lote Inicial',
            entryDate: '2026-10-01',
            initialQuantity: 10,
            remainingQuantity: 10,
            unitCost: 6.5,
          },
        ],
      },
      {
        id: 'sku-rma-l',
        team: 'Real Madrid',
        model: 'Real Madrid Local 25/26',
        version: 'Player',
        size: 'L',
        stock: 8,
        cogs: 8.5,
        salePrice: 30,
        fifoBatches: [
          {
            batchId: 'b-init-2',
            batchName: 'Lote Inicial',
            entryDate: '2026-10-01',
            initialQuantity: 8,
            remainingQuantity: 8,
            unitCost: 8.5,
          },
        ],
      },
    ],
  };
}

test('Template specs expose official headers for all 4 incremental bulk types', () => {
  assert.deepEqual(getBulkTemplateSpec('ventas').headers, VENTAS_MASIVAS_HEADERS);
  assert.deepEqual(getBulkTemplateSpec('compras').headers, COMPRAS_MASIVAS_HEADERS);
  assert.deepEqual(getBulkTemplateSpec('ajustes').headers, AJUSTES_MASIVOS_HEADERS);
  assert.deepEqual(getBulkTemplateSpec('gastos').headers, GASTOS_MASIVOS_HEADERS);
});

test('Missing required columns are detected and block invalid import', () => {
  const state = makeBulkBaseState();
  const preview = parseBulkSheetMatrix(
    'ventas',
    [
      ['Fecha', 'Cliente'],
      ['2026-11-18', 'Carlos'],
    ],
    state,
    'bad_ventas.xlsx',
    'Ventas',
  );

  assert.ok(preview.missingRequiredColumns.includes('Modelo'));
  assert.ok(preview.missingRequiredColumns.includes('Precio Unitario (USDT)'));

  const applied = applyBulkUploadPreview(state, preview, 'Jesús');
  assert.equal(applied.ok, false);
});

test('Ventas Masivas detects intra-file duplicates and applies only valid rows + records audit trail', () => {
  const state = makeBulkBaseState();
  const matrix = [
    [...VENTAS_MASIVAS_HEADERS],
    [
      '2026-11-18',
      'FAC-M-01',
      'Carlos Mendoza',
      'Guacara',
      '0414-1112233',
      'Barcelona Local 25/26',
      'Fans',
      'M',
      2,
      25,
      'Jesús',
      'Contado',
      'Efectivo ($)',
    ],
    // Exact duplicate inside the same Excel file
    [
      '2026-11-18',
      'FAC-M-01',
      'Carlos Mendoza',
      'Guacara',
      '0414-1112233',
      'Barcelona Local 25/26',
      'Fans',
      'M',
      2,
      25,
      'Jesús',
      'Contado',
      'Efectivo ($)',
    ],
    // Stock exceeding available (wants 99 of Real Madrid L when only 8 exist)
    [
      '2026-11-18',
      'FAC-M-02',
      'Ana Díaz',
      'Valencia',
      '0412-0001122',
      'Real Madrid Local 25/26',
      'Player',
      'L',
      99,
      30,
      'Gabriel',
      'Contado',
      'Binance USDT',
    ],
  ];

  const preview = parseBulkSheetMatrix(
    'ventas',
    matrix,
    state,
    'ventas_nov.xlsx',
    'Ventas Masivas',
  );

  assert.equal(preview.validCount, 1);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.errorCount, 1);
  assert.equal(preview.validUnits, 2);
  assert.equal(preview.validTotalUsd, 50);

  const applied = applyBulkUploadPreview(state, preview, 'Jesús César');
  assert.equal(applied.ok, true);
  assert.equal(applied.appliedCount, 1);
  assert.equal(applied.skippedDuplicatesCount, 1);

  const sku = applied.state.inventory.find((i) => i.id === 'sku-fcb-m');
  assert.equal(sku?.stock, 8);
  assert.equal(applied.state.sales.length, 1);
  assert.equal((applied.state.bulkImports ?? []).length, 1);
  assert.equal((applied.state.bulkImports ?? [])[0]?.fileName, 'ventas_nov.xlsx');

  // Re-importing the exact same Excel must mark the previously saved row as duplicate
  const secondPreview = parseBulkSheetMatrix(
    'ventas',
    matrix.slice(0, 2),
    applied.state,
    'ventas_nov.xlsx',
    'Ventas Masivas',
  );
  assert.equal(secondPreview.validCount, 0);
  assert.equal(secondPreview.duplicateCount, 1);
});

test('Compras Masivas registers batches, prevents duplicates, and handles received stock', () => {
  const state = makeBulkBaseState();
  const matrix = [
    [...COMPRAS_MASIVAS_HEADERS],
    [
      '2026-11-18',
      'Lote-Nov-2026',
      'Aéreo',
      'RECIBIDO EN BODEGA',
      '1688 / Alibaba',
      'PSG Local 25/26',
      'Fans',
      'M',
      5,
      6.0,
      1.5,
      25,
      54.5,
    ],
    [
      '2026-11-18',
      'Lote-Nov-2026',
      'Aéreo',
      'RECIBIDO EN BODEGA',
      '1688 / Alibaba',
      'PSG Local 25/26',
      'Fans',
      'M',
      5,
      6.0,
      1.5,
      25,
      54.5,
    ],
  ];

  const preview = parseBulkSheetMatrix(
    'compras',
    matrix,
    state,
    'compras_nov.xlsx',
    'Compras Masivas',
  );

  assert.equal(preview.validCount, 1);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.validUnits, 5);
  assert.equal(preview.validTotalUsd, 37.5);

  const applied = applyBulkUploadPreview(state, preview, 'Jesús César');
  assert.equal(applied.ok, true);
  assert.equal(applied.appliedCount, 1);

  const psgSku = applied.state.inventory.find((i) =>
    i.model.includes('PSG Local'),
  );
  assert.equal(psgSku?.stock, 5);
  assert.equal(applied.state.purchaseBatches.length, 1);
  assert.equal((applied.state.bulkImports ?? []).length, 1);
});

test('Ajustes Masivos applies stock entry/exit and rejects excessive salida', () => {
  const state = makeBulkBaseState();
  const matrix = [
    [...AJUSTES_MASIVOS_HEADERS],
    [
      '2026-11-18',
      'entrada',
      'Barcelona Local 25/26',
      'Fans',
      'M',
      3,
      'Conteo físico',
      'Jesús',
    ],
    [
      '2026-11-18',
      'salida',
      'Real Madrid Local 25/26',
      'Player',
      'L',
      50,
      'Error exceso',
      'Jesús',
    ],
  ];

  const preview = parseBulkSheetMatrix(
    'ajustes',
    matrix,
    state,
    'ajustes_nov.xlsx',
    'Ajustes Masivos',
  );

  assert.equal(preview.validCount, 1);
  assert.equal(preview.errorCount, 1);

  const applied = applyBulkUploadPreview(state, preview, 'Jesús');
  assert.equal(applied.ok, true);
  assert.equal(
    applied.state.inventory.find((i) => i.id === 'sku-fcb-m')?.stock,
    13,
  );
  assert.equal((applied.state.bulkImports ?? []).length, 1);
});

test('Gastos Masivos auto-detects Logística/Producción and prevents duplicate expenses', () => {
  const state = makeBulkBaseState();
  const matrix = [
    [...GASTOS_MASIVOS_HEADERS],
    [
      '2026-11-18',
      'Compra de bolsas y etiquetas X4SPORT',
      '',
      15.5,
      'Fondo Operativo',
      'Binance USDT',
    ],
    [
      '2026-11-18',
      'Compra de bolsas y etiquetas X4SPORT',
      '',
      15.5,
      'Fondo Operativo',
      'Binance USDT',
    ],
  ];

  const preview = parseBulkSheetMatrix(
    'gastos',
    matrix,
    state,
    'gastos_nov.xlsx',
    'Gastos Masivos',
  );

  assert.equal(preview.validCount, 1);
  assert.equal(preview.duplicateCount, 1);
  assert.match(preview.rows[0].detailLabel, /Logística\/Producción/);

  const initialExpensesCount = state.operatingExpenses.length;
  const applied = applyBulkUploadPreview(state, preview, 'Jesús');
  assert.equal(applied.ok, true);
  assert.equal(applied.state.operatingExpenses.length, initialExpensesCount + 1);
  const importedExp = applied.state.operatingExpenses.find((e) =>
    e.concept.includes('bolsas y etiquetas'),
  );
  assert.ok(importedExp);
  assert.equal(importedExp.category, 'Logística/Producción');
  assert.equal((applied.state.bulkImports ?? []).length, 1);
});

test('Round-trip: Smart Order Excel export from Estadísticas imports cleanly into Compras Masivas', () => {
  const state = makeBulkBaseState();
  state.sales = [
    {
      id: 's-1',
      invoiceNumber: '#0001',
      saleDate: '2026-11-15',
      skuId: 'sku-fcb-m',
      modelLabel: 'Barcelona Local 25/26',
      team: 'Barcelona',
      version: 'Fans',
      size: 'M',
      quantity: 8,
      unitCogs: 6.5,
      finalPrice: 200,
      paymentStatus: 'Cobrado',
      paymentMethod: 'Efectivo ($)',
      customerName: 'Cliente 1',
      seller: 'Jesús',
      breakdown: calculateFourLayerMatrixConsolidated(200, 52, 'Jesús'),
      createdAt: '2026-11-15T12:00:00.000Z',
    },
  ];

  const rec = computeSmartOrderRecommendation(state, 150, 'Aéreo', '2026-11-18');
  assert.ok(rec.lines.length > 0);
  const excelSpec = buildRecommendedOrderExcelSheet(rec, 54.2, '2026-11-18');
  assert.deepEqual(excelSpec.headers, COMPRAS_MASIVAS_HEADERS);

  const matrix = [[...excelSpec.headers], ...excelSpec.rows];
  const preview = parseBulkSheetMatrix(
    'compras',
    matrix,
    state,
    excelSpec.fileName,
    excelSpec.sheetName,
  );

  assert.equal(preview.missingRequiredColumns.length, 0);
  assert.equal(preview.errorCount, 0);
  assert.equal(preview.validCount, excelSpec.rows.length);
});
