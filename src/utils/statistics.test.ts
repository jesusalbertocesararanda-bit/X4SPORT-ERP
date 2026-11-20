import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../data/initialState';
import type { AppState } from '../types/erp';
import { calculateFourLayerMatrixConsolidated } from './finance';
import {
  buildRecommendedOrderExcelSheet,
  computeModelCostHistory,
  computeSalesRanking,
  computeSmartOrderRecommendation,
  getAvailableModelsForCostHistory,
} from './statistics';
import { COMPRAS_MASIVAS_HEADERS } from './bulkImport';

function makeStatsTestState(): AppState {
  const base = createInitialState();
  const bd1 = calculateFourLayerMatrixConsolidated(100, 26, 'Jesús');
  const bd2 = calculateFourLayerMatrixConsolidated(60, 17, 'Gabriel');
  const bd3 = calculateFourLayerMatrixConsolidated(30, 8.5, 'Josué');

  return {
    ...base,
    inventory: [
      {
        id: 'sku-fcb-m',
        team: 'Barcelona',
        model: 'Barcelona Local 25/26',
        version: 'Fans',
        size: 'M',
        stock: 2,
        cogs: 7.0,
        salePrice: 25,
        fifoBatches: [],
      },
      {
        id: 'sku-rma-l',
        team: 'Real Madrid',
        model: 'Real Madrid Local 25/26',
        version: 'Player',
        size: 'L',
        stock: 2,
        cogs: 8.5,
        salePrice: 30,
        fifoBatches: [],
      },
      {
        id: 'sku-stagnant-xxl',
        team: 'Otro',
        model: 'Inter Miami Tercera 25/26',
        version: 'Fans',
        size: 'XXL',
        stock: 6,
        cogs: 6.5,
        salePrice: 25,
        fifoBatches: [],
      },
    ],
    purchaseBatches: [
      {
        id: 'pb-1',
        referenceName: 'Alibaba Agosto',
        supplier: '1688 / Alibaba',
        shippingType: 'Marítimo',
        fundingSource: 'cashOnHand',
        status: 'RECIBIDO EN BODEGA',
        entryDate: '2026-08-15',
        receivedAt: '2026-09-01T10:00:00.000Z',
        orderedTotalUnits: 20,
        totalUnits: 20,
        totalFactoryCost: 116,
        estimatedFreightCost: 20,
        totalFreightCost: 20,
        freightPerUnit: 1.0,
        totalLandedCost: 136,
        usdtRate: 50,
        items: [
          {
            skuId: 'sku-fcb-m',
            team: 'Barcelona',
            model: 'Barcelona Local 25/26',
            version: 'Fans',
            size: 'M',
            orderedQuantity: 20,
            quantity: 20,
            factoryUnitCost: 5.8,
            proratedFreightPerUnit: 1.0,
            landedUnitCost: 6.8,
            lineFactoryTotal: 116,
            lineLandedTotal: 136,
            salePrice: 25,
          },
        ],
        createdAt: '2026-08-15T10:00:00.000Z',
      },
      {
        id: 'pb-2',
        referenceName: 'Alibaba Noviembre',
        supplier: '1688 / Alibaba',
        shippingType: 'Aéreo',
        fundingSource: 'cashOnHand',
        status: 'RECIBIDO EN BODEGA',
        entryDate: '2026-11-05',
        receivedAt: '2026-11-10T10:00:00.000Z',
        orderedTotalUnits: 10,
        totalUnits: 10,
        totalFactoryCost: 60,
        estimatedFreightCost: 15,
        totalFreightCost: 15,
        freightPerUnit: 1.5,
        totalLandedCost: 75,
        usdtRate: 54.5,
        items: [
          {
            skuId: 'sku-fcb-m',
            team: 'Barcelona',
            model: 'Barcelona Local 25/26',
            version: 'Fans',
            size: 'M',
            orderedQuantity: 10,
            quantity: 10,
            factoryUnitCost: 6.0,
            proratedFreightPerUnit: 1.5,
            landedUnitCost: 7.5,
            lineFactoryTotal: 60,
            lineLandedTotal: 75,
            salePrice: 25,
          },
        ],
        createdAt: '2026-11-05T10:00:00.000Z',
      },
    ],
    sales: [
      {
        id: 'sale-1',
        invoiceNumber: '#0001',
        saleDate: '2026-11-15',
        skuId: 'sku-fcb-m',
        modelLabel: 'Barcelona Local 25/26',
        team: 'Barcelona',
        version: 'Fans',
        size: 'M',
        quantity: 4,
        unitCogs: 6.5,
        finalPrice: 100,
        paymentStatus: 'Cobrado',
        paymentMethod: 'Efectivo ($)',
        customerName: 'Carlos',
        seller: 'Jesús',
        breakdown: bd1,
        createdAt: '2026-11-15T12:00:00.000Z',
      },
      {
        id: 'sale-2',
        invoiceNumber: '#0002',
        saleDate: '2026-11-17',
        skuId: 'sku-rma-l',
        modelLabel: 'Real Madrid Local 25/26',
        team: 'Real Madrid',
        version: 'Player',
        size: 'L',
        quantity: 2,
        unitCogs: 8.5,
        finalPrice: 60,
        paymentStatus: 'Cobrado',
        paymentMethod: 'Binance USDT',
        customerName: 'Pedro',
        seller: 'Gabriel',
        breakdown: bd2,
        createdAt: '2026-11-17T12:00:00.000Z',
      },
      {
        id: 'sale-3',
        invoiceNumber: '#0003',
        saleDate: '2026-10-20',
        skuId: 'sku-rma-l',
        modelLabel: 'Real Madrid Local 25/26',
        team: 'Real Madrid',
        version: 'Player',
        size: 'L',
        quantity: 1,
        unitCogs: 8.5,
        finalPrice: 30,
        paymentStatus: 'Cobrado',
        paymentMethod: 'Zelle',
        customerName: 'Luis',
        seller: 'Josué',
        breakdown: bd3,
        createdAt: '2026-10-20T12:00:00.000Z',
      },
    ],
  };
}

test('computeSalesRanking supports week, month and custom ranges with units and %', () => {
  const state = makeStatsTestState();

  const weekRanking = computeSalesRanking(state, 'week', {
    anchorDate: '2026-11-18',
  });
  // Week (Nov 12 .. Nov 18) includes sale-1 (4 M) and sale-2 (2 L) = 6 units
  assert.equal(weekRanking.totalUnitsSold, 6);
  assert.equal(weekRanking.totalRevenueUsd, 160);
  assert.equal(weekRanking.topModels[0].modelLabel, 'Barcelona Local 25/26');
  assert.equal(weekRanking.topModels[0].unitsSold, 4);
  assert.equal(weekRanking.topModels[0].pct, 66.67);

  const mRow = weekRanking.sizeRanking.find((s) => s.size === 'M');
  const lRow = weekRanking.sizeRanking.find((s) => s.size === 'L');
  assert.equal(mRow?.unitsSold, 4);
  assert.equal(mRow?.pct, 66.67);
  assert.equal(lRow?.unitsSold, 2);
  assert.equal(lRow?.pct, 33.33);

  const octRanking = computeSalesRanking(state, 'month', {
    monthStr: '2026-10',
  });
  assert.equal(octRanking.totalUnitsSold, 1);
  assert.equal(octRanking.topModels[0].modelLabel, 'Real Madrid Local 25/26');

  const customRanking = computeSalesRanking(state, 'custom', {
    customFrom: '2026-10-01',
    customTo: '2026-11-30',
  });
  assert.equal(customRanking.totalUnitsSold, 7);
});

test('computeModelCostHistory tracks 1688/Alibaba + freight cost variation vs sale price and real margin', () => {
  const state = makeStatsTestState();
  const options = getAvailableModelsForCostHistory(state);
  const fcbOption = options.find((o) =>
    o.model.includes('Barcelona Local 25/26'),
  );
  assert.ok(fcbOption);

  const summary = computeModelCostHistory(state, fcbOption.key);
  assert.ok(summary);
  assert.equal(summary.entries.length, 2);
  assert.equal(summary.firstLandedCost, 6.8);
  assert.equal(summary.lastLandedCost, 7.5);
  assert.equal(summary.costDeltaUsd, 0.7);
  assert.equal(summary.realAvgSalePrice, 25);
  assert.equal(summary.currentMarginUsd, 17.5);
  assert.equal(summary.currentMarginPct, 70);
});

test('computeSmartOrderRecommendation allocates capital, flags stagnant stock, and matches Compras Masivas headers', () => {
  const state = makeStatsTestState();
  const rec = computeSmartOrderRecommendation(state, 120, 'Aéreo', '2026-11-18');

  assert.ok(rec.totalUnits > 0);
  assert.ok(rec.totalAllocatedUsd <= 120);
  assert.equal(rec.totalAllocatedUsd + rec.remainingUsd, 120);

  // Stagnant Inter Miami XXL (6 in stock, 0 sold) must be flagged & excluded
  assert.ok(
    rec.lowRotationAlerts.some((a) => a.model.includes('Inter Miami')),
  );
  assert.ok(
    !rec.lines.some((l) => l.model.includes('Inter Miami')),
  );

  const sheet = buildRecommendedOrderExcelSheet(rec, 54.5, '2026-11-18');
  assert.deepEqual(sheet.headers, COMPRAS_MASIVAS_HEADERS);
  assert.equal(sheet.rows.length, rec.lines.length);
});
