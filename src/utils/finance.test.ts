import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDemoSeedState,
  createInitialState,
  PARTNER_SHARES,
} from '../data/initialState';
import { parseDolarApiPayload } from './exchangeRatesApi';
import {
  adjustInventoryPhysicalCount,
  applyAuditAdjustments,
  calculateAuditMetrics,
  calculateDiscountedUnitPrice,
  calculateElapsedTransitDays,
  calculateFourLayerMatrix,
  calculateFourLayerMatrixConsolidated,
  closeAuditSession,
  collectReceivable,
  createImportOrder,
  deductWithRepoReinvestmentBridge,
  DEFAULT_GENERAL_CONFIG,
  detectExpenseCategoryFromDescription,
  detectSizeDiscrepancyCrosses,
  doesItemMatchTeamFilter,
  doesSaleMatchSearchQuery,
  EXPENSE_CATEGORIES,
  extractTeamFromModel,
  formatInvoiceNumber,
  getActiveOperationalAlerts,
  getCashBackedFundsSummary,
  getInventoryCascadeGroups,
  getInventorySizeMatrix,
  getLowStockItems,
  getTotalAllocatedFunds,
  getTotalInventoryCostValue,
  getTotalReceivables,
  getTotalUnits,
  getTransitAlertStatus,
  getTransitCapitalSummary,
  isAccidentalDemoCatalogOnly,
  isUnassignedSeller,
  migrateLegacyInventoryItems,
  migrateLegacyStateToCurrent,
  normalizeAppState,
  normalizeCanonicalTeam,
  normalizeGeneralConfig,
  performInventoryUncross,
  processReturnOrExchange,
  receiveImportBatch,
  reconcileCashOnHand,
  recoverStartupErpState,
  registerCapitalInjection,
  registerDirectPurchaseBatch,
  registerManualInventoryAdjustment,
  registerMultiItemSale,
  registerOperatingExpense,
  saveAuditProgress,
  startNewAuditSession,
  registerPurchase,
  registerSale,
  reinvestPartnerDividends,
  round2,
  sanitizeForFirebase,
  scaleBreakdownToCashAmount,
  syncUnassignedCashToGrowthFund,
  updateExchangeRates,
  withdrawPartnerDividends,
} from './finance';
import { buildPublicCatalogGroups } from './publicCatalog';

test('initial baseline state matches exact mandatory X4SPORT balances without fake demo items', () => {
  const state = createInitialState();

  assert.equal(state.cashOnHand, 135.19);
  assert.equal(getTotalReceivables(state), 263.5);
  assert.equal(state.receivables.length, 7);
  assert.deepEqual(
    state.receivables.map((r) => [r.debtor, r.amount]),
    [
      ['Gabriel', 150],
      ['Charles', 45],
      ['Hermano de Charles', 20],
      ['Suegra', 20],
      ['Jordy', 10],
      ['Barón', 10],
      ['Enyer', 8.5],
    ],
  );
  assert.equal(state.capitalInjections[0].amount, 1912.35);
  assert.equal(state.operatingExpenses[0].amount, 624.0);
  assert.equal(state.historicalNetProfit, 317.37);
  assert.equal(state.inventory.length, 0);
  assert.equal(getTotalUnits(state), 0);

  // Verify partner shares sum to 100%
  assert.equal(
    round2(PARTNER_SHARES.Jesús + PARTNER_SHARES.Josué + PARTNER_SHARES.Gabriel),
    1,
  );

  // Explicit demo state keeps the 176-unit test catalog isolated behind opt-in flag
  const demoState = createDemoSeedState();
  assert.equal(demoState.isExplicitDemo, true);
  assert.equal(getTotalUnits(demoState), 176);
  assert.ok(getLowStockItems(demoState, 2).length > 0);
});

test('4-layer financial matrix calculates exact splits with assigned seller', () => {
  const breakdown = calculateFourLayerMatrix(25, 6.5, 1, 'Jesús');

  assert.equal(breakdown.layer1CostRecovery, 6.5);
  assert.equal(breakdown.layer2Commission, 1.0);
  assert.equal(breakdown.netProfit, 17.5);
  assert.equal(breakdown.layer3OperatingFund, 1.75);
  assert.equal(breakdown.remainingNetProfit, 15.75);
  assert.equal(breakdown.layer4GrowthReinvestment, 12.6);
  assert.equal(breakdown.layer4TotalDividends, 3.15);
  assert.equal(breakdown.partnerSplits.Jesús, 1.69);
  assert.equal(breakdown.partnerSplits.Josué, 1.27);
  assert.equal(breakdown.partnerSplits.Gabriel, 0.19);

  const totalAllocated = round2(
    breakdown.layer1CostRecovery +
      breakdown.layer2Commission +
      breakdown.layer3OperatingFund +
      breakdown.layer4GrowthReinvestment +
      breakdown.partnerSplits.Jesús +
      breakdown.partnerSplits.Josué +
      breakdown.partnerSplits.Gabriel,
  );
  assert.equal(totalAllocated, 25);
});

test('4-layer financial matrix redirects unassigned 4% commission directly to growth reinvestment', () => {
  const breakdown = calculateFourLayerMatrix(25, 6.5, 1, 'Sin Vendedor');
  assert.equal(breakdown.grossProfit, 18.5);
  assert.equal(breakdown.layer2Commission, 0);
  assert.equal(breakdown.layer2ToReinvestment, 1.0);
  assert.equal(breakdown.netProfit, 17.5);
  assert.equal(breakdown.layer3OperatingFund, 1.75);
  assert.equal(breakdown.remainingNetProfit, 15.75);
  assert.equal(breakdown.layer4GrowthReinvestment, 13.6);
  assert.equal(breakdown.layer4TotalDividends, 3.15);

  const totalAllocated = round2(
    breakdown.layer1CostRecovery +
      breakdown.layer2Commission +
      breakdown.layer3OperatingFund +
      breakdown.layer4GrowthReinvestment +
      breakdown.layer4TotalDividends,
  );
  assert.equal(totalAllocated, 25);
});

test('registerSale updates inventory, cash/receivables, and 4-layer funds', () => {
  const initial = createDemoSeedState();
  const sku = initial.inventory[0];

  const resCash = registerSale(initial, {
    skuId: sku.id,
    quantity: 2,
    finalPrice: 50,
    customerName: 'María Rodríguez',
    seller: 'Josué',
    paymentStatus: 'Cobrado',
  });

  assert.equal(resCash.ok, true);
  assert.equal(getTotalUnits(resCash.state), 174);
  assert.equal(resCash.state.cashOnHand, 185.19);
  assert.equal(resCash.state.funds.replacement, 13.0);
  assert.equal(resCash.state.funds.commissions, 2.0);
  assert.equal(resCash.state.funds.commissionsBySeller.Josué, 2.0);
  assert.equal(resCash.state.sales[0].customerName, 'María Rodríguez');

  const resCredit = registerSale(resCash.state, {
    skuId: sku.id,
    quantity: 1,
    finalPrice: 25,
    customerName: 'Carlos Pérez',
    seller: 'Sin Vendedor',
    paymentStatus: 'Pendiente',
    debtorName: 'Carlos Pérez',
  });

  assert.equal(resCredit.ok, true);
  assert.equal(getTotalUnits(resCredit.state), 173);
  assert.equal(resCredit.state.cashOnHand, 185.19);
  assert.equal(getTotalReceivables(resCredit.state), 288.5);

  const resFail = registerSale(resCredit.state, {
    skuId: sku.id,
    quantity: 99,
    finalPrice: 1000,
    customerName: 'Pedro',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  assert.equal(resFail.ok, false);
  assert.equal(getTotalUnits(resFail.state), 173);
});

test('registerPurchase creates a new FIFO batch layer and deducts cash', () => {
  const initial = createDemoSeedState();
  const res = registerPurchase(initial, {
    team: 'Barcelona',
    model: 'Barcelona Local 25/26',
    version: 'Player',
    size: 'M',
    quantity: 10,
    unitCostWithFreight: 7.5,
  });

  assert.equal(res.ok, true);
  assert.equal(getTotalUnits(res.state), 186);
  assert.equal(res.state.cashOnHand, 60.19);
  const updatedSku = res.state.inventory.find((i) => i.id === 'sku-fcb-1');
  assert.equal(updatedSku?.stock, 20);
  assert.equal(updatedSku?.fifoBatches.length, 2);
  assert.equal(updatedSku?.cogs, 6.5);

  const resInsufficient = registerPurchase(res.state, {
    team: 'PSG',
    model: 'PSG Nuevo Modelo',
    version: 'Fan',
    size: 'M',
    quantity: 12,
    unitCostWithFreight: 6.0,
  });
  assert.equal(resInsufficient.ok, false);
});

test('collectReceivable and reinvestPartnerDividends settle balances accurately', () => {
  let state = createDemoSeedState();
  const saleRes = registerSale(state, {
    skuId: 'sku-fcb-1',
    quantity: 2,
    finalPrice: 50,
    customerName: 'Andrés',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  state = saleRes.state;
  const jesusDiv = state.funds.dividendsByPartner.Jesús;
  const growthBefore = state.funds.growthReinvestment;
  assert.ok(jesusDiv > 0);

  const reinvestRes = reinvestPartnerDividends(state, 'Jesús');
  assert.equal(reinvestRes.ok, true);
  state = reinvestRes.state;
  assert.equal(state.funds.dividendsByPartner.Jesús, 0);
  assert.equal(
    state.funds.growthReinvestment,
    round2(growthBefore + jesusDiv),
  );

  const cashBefore = state.cashOnHand;
  const collectRes = collectReceivable(state, 'rec-enyer');
  assert.equal(collectRes.ok, true);
  state = collectRes.state;
  assert.equal(state.cashOnHand, round2(cashBefore + 8.5));
  assert.equal(getTotalReceivables(state), 255.0);

  const rateRes = updateExchangeRates(state, 47.2, 55.0, 'api');
  assert.equal(rateRes.ok, true);
  assert.equal(rateRes.state.exchangeRates.bcv, 47.2);
  assert.equal(rateRes.state.exchangeRates.usdt, 55.0);
  assert.equal(rateRes.state.exchangeRates.source, 'api');
});

test('registerMultiItemSale deducts multiple SKUs, consolidates COGS & 4-layer matrix, and prevents duplicate over-sell', () => {
  const initial = createDemoSeedState();
  const sku1 = initial.inventory[0];
  const sku2 = initial.inventory[5];

  const res = registerMultiItemSale(initial, {
    items: [
      { skuId: sku1.id, quantity: 2, unitPrice: 25 },
      { skuId: sku2.id, quantity: 1, unitPrice: 30 },
    ],
    customerName: 'Diego Morales',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });

  assert.equal(res.ok, true);
  assert.equal(getTotalUnits(res.state), 173);
  assert.equal(res.state.cashOnHand, 215.19);
  assert.equal(res.state.inventory.find((i) => i.id === sku1.id)?.stock, 8);
  assert.equal(res.state.inventory.find((i) => i.id === sku2.id)?.stock, 10);

  assert.equal(res.state.funds.replacement, 19.6);
  assert.equal(res.state.funds.commissions, 3.2);
  assert.equal(res.state.funds.operatingAndAds, 5.72);
  assert.equal(res.state.funds.growthReinvestment, 41.18);
  const totalDivs = round2(
    res.state.funds.dividendsByPartner.Jesús +
      res.state.funds.dividendsByPartner.Josué +
      res.state.funds.dividendsByPartner.Gabriel,
  );
  assert.equal(totalDivs, 10.3);

  assert.equal(res.state.sales.length, 1);
  assert.equal(res.state.sales[0].customerName, 'Diego Morales');
  assert.equal(res.state.sales[0].items?.length, 2);
  assert.equal(res.state.sales[0].quantity, 3);
  assert.equal(res.state.sales[0].finalPrice, 80);

  const overSell = registerMultiItemSale(res.state, {
    items: [
      { skuId: sku1.id, quantity: 5, unitPrice: 25 },
      { skuId: sku1.id, quantity: 4, unitPrice: 25 },
    ],
    customerName: 'Luis',
    seller: 'Sin Vendedor',
    paymentStatus: 'Pendiente',
    debtorName: 'Luis',
  });
  assert.equal(overSell.ok, false);
  assert.equal(getTotalUnits(overSell.state), 173);
});

test('two-stage import order creates EN TRÁNSITO batch without adding stock, then receiveImportBatch ingests FIFO', () => {
  let state = createDemoSeedState();

  const colRes = collectReceivable(state, 'rec-gabriel', 'Pago Móvil / Bs');
  assert.equal(colRes.ok, true);
  state = colRes.state;
  assert.equal(state.cashOnHand, 285.19);

  // Stage 1: Create EN TRÁNSITO order (10 uds, factory $56 + freight est $30 = $86) with custom usdtRate
  const batchRes = createImportOrder(state, {
    entryDate: '2026-11-14',
    referenceName: 'Aéreo Noviembre',
    shippingType: 'Aéreo',
    totalFreightCost: 30,
    usdtRate: 63.75,
    items: [
      {
        team: 'Barcelona',
        model: 'Barcelona Retro 08/09',
        version: 'Player',
        size: 'XL',
        quantity: 4,
        factoryUnitCost: 5.0,
      },
      {
        team: 'Otro',
        model: 'Milan Retro 94',
        version: 'Retro',
        size: 'L',
        quantity: 6,
        factoryUnitCost: 6.0,
      },
    ],
  });

  assert.equal(batchRes.ok, true);
  state = batchRes.state;
  assert.equal(state.cashOnHand, round2(285.19 - 86.0));
  assert.equal(getTotalUnits(state), 176); // Stock MUST NOT increase while EN TRÁNSITO
  assert.equal(state.purchaseBatches.length, 1);
  assert.equal(state.purchaseBatches[0].status, 'EN TRÁNSITO');

  const transitSummary = getTransitCapitalSummary(state);
  assert.equal(transitSummary.transitCount, 1);
  assert.equal(transitSummary.transitUnits, 10);
  assert.equal(transitSummary.transitCapital, 86.0);

  // Stage 2: Receive batch into warehouse with exact freight & quantities
  const receiveRes = receiveImportBatch(state, {
    batchId: state.purchaseBatches[0].id,
    receivedDate: '2026-11-18',
    actualFreightCost: 30,
    receivedItems: [
      { itemIndex: 0, receivedQuantity: 4 },
      { itemIndex: 1, receivedQuantity: 6 },
    ],
  });
  assert.equal(receiveRes.ok, true);
  state = receiveRes.state;
  assert.equal(getTotalUnits(state), 186);
  assert.equal(state.purchaseBatches[0].status, 'RECIBIDO EN BODEGA');
  assert.equal(state.purchaseBatches[0].receivedDate, '2026-11-18');
  assert.equal(state.purchaseBatches[0].freightPerUnit, 3.0);
  assert.equal(state.purchaseBatches[0].items[0].landedUnitCost, 8.0);
  assert.equal(state.purchaseBatches[0].items[1].landedUnitCost, 9.0);
  assert.equal(state.purchaseBatches[0].usdtRate, 63.75);
  assert.equal(
    state.inventory.find((i) => i.model === 'Milan Retro 94')?.fifoBatches[0]
      .usdtRate,
    63.75,
  );
  assert.equal(getTransitCapitalSummary(state).transitCount, 0);

  // Sell 3 units of Barcelona Retro 08/09 (had 2 @ 6.80 + 4 @ 8.00 -> FIFO COGS = 2*6.80 + 1*8.00 = 21.60)
  const saleRes = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-5', quantity: 3, unitPrice: 30 }],
    customerName: 'Ricardo Gómez',
    seller: 'Gabriel',
    paymentStatus: 'Cobrado',
    paymentMethod: 'Pago Móvil / Bs',
  });

  assert.equal(saleRes.ok, true);
  state = saleRes.state;
  assert.equal(state.funds.replacement, 21.6);
  assert.equal(state.sales[0].paymentMethod, 'Pago Móvil / Bs');
  assert.equal(state.sales[0].bcvEquivalent, round2(90 * state.exchangeRates.bcv));

  const retroSku = state.inventory.find((i) => i.id === 'sku-fcb-5');
  assert.equal(retroSku?.stock, 3);
  assert.equal(retroSku?.cogs, 8.0);
});

test('parseDolarApiPayload extracts official BCV and parallel USDT rates cleanly', () => {
  const sample = [
    {
      fuente: 'oficial',
      nombre: 'Dólar',
      promedio: 911.6243,
      fechaActualizacion: '2026-11-13T00:00:00-04:00',
    },
    {
      fuente: 'paralelo',
      nombre: 'Paralelo',
      promedio: 1074.348869,
      fechaActualizacion: '2026-11-15T04:02:17.647Z',
    },
  ];
  const parsed = parseDolarApiPayload(sample);
  assert.deepEqual(parsed, {
    bcv: 911.62,
    usdt: 1074.35,
    updatedAt: '2026-11-15T04:02:17.647Z',
  });
  assert.equal(parseDolarApiPayload({ invalid: true }), null);
});

test('flexible optional customer fields (city/phone), sequential FAC-XXXX invoices, and quick pricing work cleanly', () => {
  let state = createDemoSeedState();
  const sale1 = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 30 }],
    customerName: '   ',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  assert.equal(sale1.ok, true);
  assert.equal(sale1.state.sales[0].customerName, 'Cliente Mostrador');
  assert.equal(sale1.state.sales[0].invoiceNumber, '#0001');
  assert.equal(sale1.createdSale?.invoiceNumber, '#0001');
  assert.equal(sale1.state.nextInvoiceSeq, 2);

  state = sale1.state;
  const sale2 = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-2', quantity: 1, unitPrice: 30 }],
    customerName: 'Laura Díaz',
    customerCity: 'Guacara',
    customerPhone: '0414-5550199',
    seller: 'Josué',
    paymentStatus: 'Cobrado',
  });
  assert.equal(sale2.ok, true);
  assert.equal(sale2.state.sales[0].invoiceNumber, '#0002');
  assert.equal(sale2.state.sales[0].customerCity, 'Guacara');
  assert.equal(sale2.state.sales[0].customerPhone, '0414-5550199');
  assert.equal(sale2.state.nextInvoiceSeq, 3);

  const wholesale = calculateDiscountedUnitPrice(30, 'wholesale');
  assert.equal(wholesale.unitPrice, 24);
  assert.equal(wholesale.discountLabel, 'Al Mayor (-20%)');

  const pctDiscount = calculateDiscountedUnitPrice(25, 'discount_pct', 10);
  assert.equal(pctDiscount.unitPrice, 22.5);

  const usdDiscount = calculateDiscountedUnitPrice(32, 'discount_usd', 4.5);
  assert.equal(usdDiscount.unitPrice, 27.5);
});

test('Pago Mixto validates exact split sum and computes BCV conversion for Pago Móvil leg', () => {
  const initial = createDemoSeedState();

  // Mismatched split sum rejected
  const mismatch = registerMultiItemSale(initial, {
    items: [{ skuId: 'sku-fcb-1', quantity: 2, unitPrice: 30 }], // $60
    customerName: 'Valeria Silva',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
    paymentMethod: 'Pago Mixto',
    paymentSplits: [
      { method: 'Efectivo ($)', amountUsd: 30 },
      { method: 'Pago Móvil / Bs', amountUsd: 20 }, // 50 != 60
    ],
  });
  assert.equal(mismatch.ok, false);

  // Exact split sum accepted
  const valid = registerMultiItemSale(initial, {
    items: [{ skuId: 'sku-fcb-1', quantity: 2, unitPrice: 30 }], // $60
    customerName: 'Valeria Silva',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
    paymentMethod: 'Pago Mixto',
    paymentSplits: [
      { method: 'Efectivo ($)', amountUsd: 40 },
      { method: 'Pago Móvil / Bs', amountUsd: 20 },
    ],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.state.sales[0].paymentMethod, 'Pago Mixto');
  assert.equal(valid.state.sales[0].paymentSplits?.length, 2);
  assert.equal(
    valid.state.sales[0].bcvEquivalent,
    round2(20 * valid.state.exchangeRates.bcv),
  );
  assert.equal(valid.state.cashOnHand, round2(135.19 + 60));
});

test('registerOperatingExpense enforces mandatory category, rejects physical cash overdraft, and applies proportional 4-layer deficit rule', () => {
  let state = createDemoSeedState();
  // Sell 2x $30 ($60 total: $13 replacement, $2.40 comm, $4.46 opFund, $32.11 growth, $8.03 divs)
  const sale = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 2, unitPrice: 30 }],
    customerName: 'Cliente A',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  state = sale.state;
  const opBefore = state.funds.operatingAndAds; // 4.46
  const cashBefore = state.cashOnHand; // 195.19
  const totalFundsBefore = getTotalAllocatedFunds(state.funds); // 60.00

  // 1. Expense covered completely by operatingAndAds
  const okOp = registerOperatingExpense(state, {
    concept: 'Bolsas y empaque',
    category: EXPENSE_CATEGORIES[1],
    amount: 3.5,
    source: 'operatingFund',
    paymentMethod: 'Efectivo ($)',
  });
  assert.equal(okOp.ok, true);
  state = okOp.state;
  assert.equal(state.funds.operatingAndAds, round2(opBefore - 3.5)); // 0.96 left
  assert.equal(state.cashOnHand, round2(cashBefore - 3.5));
  assert.equal(state.operatingExpenses[0].category, EXPENSE_CATEGORIES[1]);

  // 2. Expense exceeding operatingAndAds ($0.96 left) -> triggers Deficit Rule across remaining active funds
  const growthBeforeDeficit = state.funds.growthReinvestment;
  const repBeforeDeficit = state.funds.replacement;
  const deficitExpense = registerOperatingExpense(state, {
    concept: 'Campaña Meta Ads',
    category: EXPENSE_CATEGORIES[0],
    amount: 10.96,
    source: 'operatingFund',
    paymentMethod: 'Binance USDT',
  });
  assert.equal(deficitExpense.ok, true);
  state = deficitExpense.state;
  assert.equal(state.funds.operatingAndAds, 0);
  assert.equal(state.cashOnHand, round2(cashBefore - 3.5 - 10.96));
  // Deficit = $10.00 distributed proportionally across remaining $55.54 active funds
  assert.equal(state.operatingExpenses[0].deficitCoveredByFunds, 10.0);
  assert.ok(state.funds.growthReinvestment < growthBeforeDeficit);
  assert.ok(state.funds.replacement < repBeforeDeficit);
  assert.equal(
    getTotalAllocatedFunds(state.funds),
    round2(totalFundsBefore - 3.5 - 10.96),
  );

  // 3. Reject expense exceeding physical cashOnHand
  const overCash = registerOperatingExpense(state, {
    concept: 'Retiro imposible',
    category: EXPENSE_CATEGORIES[2],
    amount: state.cashOnHand + 50,
    source: 'cashOnHand',
  });
  assert.equal(overCash.ok, false);

  // 4. Verify cash-backed summary invariant holds strictly
  assert.equal(getCashBackedFundsSummary(state).isStrictlyCashBacked, true);
});

test('adjustInventoryPhysicalCount adjusts stock and keeps FIFO batch totals synchronized', () => {
  let state = createDemoSeedState();

  // Shortage on sku-fcb-1 (10 -> 8)
  const shrink = adjustInventoryPhysicalCount(state, {
    skuId: 'sku-fcb-1',
    newStock: 8,
    reason: 'Conteo físico semanal',
  });
  assert.equal(shrink.ok, true);
  state = shrink.state;
  const skuAfterShrink = state.inventory.find((i) => i.id === 'sku-fcb-1');
  assert.equal(skuAfterShrink?.stock, 8);
  assert.equal(
    skuAfterShrink?.fifoBatches.reduce((s, b) => s + b.remainingQuantity, 0),
    8,
  );

  // Surplus on sku-fcb-1 (8 -> 11)
  const surplus = adjustInventoryPhysicalCount(state, {
    skuId: 'sku-fcb-1',
    newStock: 11,
    reason: 'Camisetas halladas en depósito',
  });
  assert.equal(surplus.ok, true);
  state = surplus.state;
  const skuAfterSurplus = state.inventory.find((i) => i.id === 'sku-fcb-1');
  assert.equal(skuAfterSurplus?.stock, 11);
  assert.equal(
    skuAfterSurplus?.fifoBatches.reduce((s, b) => s + b.remainingQuantity, 0),
    11,
  );
  assert.equal(state.inventoryAdjustments.length, 2);
});

test('receiveImportBatch adjusts freight variance on cash/growthReinvestment and prorates across actual arrived units', () => {
  let state = createDemoSeedState();
  // Sell 5 Player shirts at $30 ($150) so growthReinvestment builds up (~$80.28)
  const sale = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 5, unitPrice: 30 }],
    customerName: 'Cliente Frecuente',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  state = sale.state;
  const growthBefore = state.funds.growthReinvestment; // ~80.28
  const cashBefore = state.cashOnHand; // 270.19

  // Stage 1: Order 10 units @ $5 factory + $10 estimated freight ($60 total) funded from growthReinvestment
  const orderRes = createImportOrder(state, {
    entryDate: '2026-11-15',
    referenceName: 'Marítimo Dic',
    shippingType: 'Marítimo',
    totalFreightCost: 10,
    fundingSource: 'growthReinvestment',
    items: [
      {
        team: 'Otro',
        model: 'Arsenal Retro 02',
        version: 'Retro',
        size: 'M',
        quantity: 10,
        factoryUnitCost: 5.0,
      },
    ],
  });
  assert.equal(orderRes.ok, true);
  state = orderRes.state;
  assert.equal(state.cashOnHand, round2(cashBefore - 60));
  assert.equal(state.funds.growthReinvestment, round2(growthBefore - 60));
  // Not in inventory yet
  assert.equal(
    state.inventory.find((i) => i.model === 'Arsenal Retro 02'),
    undefined,
  );

  // Stage 2: Only 8 units arrive ($40 factory vs $50 paid -> $10 shortage = +$1.25/ud), and actual courier freight was $16 (+$6 higher than $10 est)
  const recHigher = receiveImportBatch(state, {
    batchId: state.purchaseBatches[0].id,
    receivedDate: '2026-11-25',
    actualFreightCost: 16,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 8 }],
  });
  assert.equal(recHigher.ok, true);
  state = recHigher.state;

  // Factory shortage ($10) is NOT refunded to cash/funds; only +$6 freightDiff is deducted (-$66 total vs -$60 prepaid)
  assert.equal(state.cashOnHand, round2(cashBefore - 66));
  assert.equal(state.funds.growthReinvestment, round2(growthBefore - 66));
  assert.equal(state.purchaseBatches[0].totalFactoryCost, 50);
  assert.equal(state.purchaseBatches[0].totalLandedCost, 66);
  // Real landed cost = $5 factory + ($10 shortage / 8 = $1.25) + ($16 freight / 8 = $2.00) = $8.25/ud
  assert.equal(state.purchaseBatches[0].freightAdjustment, 6);
  assert.equal(state.purchaseBatches[0].freightPerUnit, 2.0);
  assert.equal(state.purchaseBatches[0].items[0].landedUnitCost, 8.25);
  const arsenalSku = state.inventory.find((i) => i.model === 'Arsenal Retro 02');
  assert.equal(arsenalSku?.stock, 8);
  assert.equal(arsenalSku?.cogs, 8.25);
  assert.equal(arsenalSku?.fifoBatches[0].unitCost, 8.25);
  assert.equal(arsenalSku?.fifoBatches[0].entryDate, '2026-11-25');

  // Test freight refund (< estimated): another order with $20 est freight, actual freight $14 -> +$6 refunded to cash
  const cashNow = state.cashOnHand;
  const order2 = createImportOrder(state, {
    entryDate: '2026-11-26',
    referenceName: 'Aéreo Express',
    shippingType: 'Aéreo',
    totalFreightCost: 20,
    fundingSource: 'cashOnHand',
    items: [
      {
        team: 'Barcelona',
        model: 'Barcelona Local 25/26',
        version: 'Player',
        size: 'M',
        quantity: 2,
        factoryUnitCost: 6.0,
      },
    ],
  });
  assert.equal(order2.ok, true);
  state = order2.state;
  assert.equal(state.cashOnHand, round2(cashNow - 32));

  const recLower = receiveImportBatch(state, {
    batchId: state.purchaseBatches[0].id,
    receivedDate: '2026-11-28',
    actualFreightCost: 14,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 2 }],
  });
  assert.equal(recLower.ok, true);
  state = recLower.state;
  assert.equal(state.cashOnHand, round2(cashNow - 26)); // $6 refunded!
  assert.equal(state.purchaseBatches[0].freightAdjustment, -6);
});

test('getInventoryCascadeGroups groups SKUs by Model + Version and sums all sizes', () => {
  const state = createDemoSeedState();
  const groups = getInventoryCascadeGroups(state.inventory);

  // Barcelona Local 25/26 Player has M(10) + L(8) = 18 uds
  const fcbPlayer = groups.find(
    (g) => g.model === 'Barcelona Local 25/26' && g.version === 'Player',
  );
  assert.ok(fcbPlayer);
  assert.equal(fcbPlayer.expectedStock, 18);
  assert.deepEqual(
    fcbPlayer.items.map((i) => i.size),
    ['M', 'L'],
  );

  // Total across all groups matches 176 units
  const totalGrouped = groups.reduce((s, g) => s + g.expectedStock, 0);
  assert.equal(totalGrouped, 176);
});

test('applyAuditAdjustments consumes oldest FIFO layer on shortages, records fifoLossCost, and adjusts surpluses', () => {
  let state = createDemoSeedState();

  // Add a second newer FIFO batch to sku-fcb-1 (had 10 @ $6.50 on 2026-11-01) -> add 5 @ $8.00 on 2026-11-20
  const order = createImportOrder(state, {
    entryDate: '2026-11-18',
    referenceName: 'Reposición FCB',
    shippingType: 'Aéreo',
    totalFreightCost: 5,
    items: [
      {
        team: 'Barcelona',
        model: 'Barcelona Local 25/26',
        version: 'Player',
        size: 'M',
        quantity: 5,
        factoryUnitCost: 7.0,
      },
    ],
  });
  assert.equal(order.ok, true);
  state = receiveImportBatch(order.state, {
    batchId: order.state.purchaseBatches[0].id,
    receivedDate: '2026-11-20',
    actualFreightCost: 5,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 5 }],
  }).state;
  // sku-fcb-1 now has 15 uds: 10 @ 6.50 + 5 @ 8.00

  // Audit: sku-fcb-1 shortage 15 -> 4 (-11 uds: consumes 10 @ 6.50 + 1 @ 8.00 = $73.00 FIFO loss)
  //        sku-fcb-2 surplus 8 -> 10 (+2 uds)
  const auditRes = applyAuditAdjustments(state, {
    items: [
      { skuId: 'sku-fcb-1', newStock: 4 },
      { skuId: 'sku-fcb-2', newStock: 10 },
    ],
    reason: '',
    auditMode: 'cascade',
  });
  assert.equal(auditRes.ok, true);
  state = auditRes.state;

  const sku1 = state.inventory.find((i) => i.id === 'sku-fcb-1');
  const sku2 = state.inventory.find((i) => i.id === 'sku-fcb-2');
  assert.equal(sku1?.stock, 4);
  assert.equal(sku1?.cogs, 8.0); // Oldest $6.50 layer fully consumed, remaining 4 are from $8.00 batch!
  assert.equal(sku2?.stock, 10);

  const recForSku1 = state.inventoryAdjustments.find((a) => a.skuId === 'sku-fcb-1');
  assert.equal(recForSku1?.delta, -11);
  assert.equal(recForSku1?.fifoLossCost, 73.0);
  assert.equal(recForSku1?.reason, 'Conteo físico de auditoría');
  assert.equal(recForSku1?.auditMode, 'cascade');
});

test('sanitizeForFirebase removes undefined fields and normalizeAppState preserves empty arrays from RTDB', () => {
  let state = createDemoSeedState();
  // Collect all initial receivables so receivables becomes []
  for (const rec of [...state.receivables]) {
    state = collectReceivable(state, rec.id, 'Efectivo ($)').state;
  }
  assert.equal(state.receivables.length, 0);

  // Add a sale with optional undefined properties
  const saleRes = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 30 }],
    customerName: 'Cliente Cloud',
    seller: 'Sin Vendedor',
    paymentStatus: 'Cobrado',
  });
  state = saleRes.state;

  const sanitized = sanitizeForFirebase(state);
  assert.equal(
    JSON.stringify(sanitized).includes('undefined'),
    false,
  );
  assert.equal('debtorName' in sanitized.sales[0], false);

  // Simulate RTDB dropping empty arrays and turning inventory into an indexed object map
  const rtdbSnapshot = {
    ...sanitized,
    receivables: undefined,
    purchaseBatches: undefined,
    inventory: { '0': sanitized.inventory[0] },
  };
  const hydrated = normalizeAppState(rtdbSnapshot);
  assert.equal(hydrated.receivables.length, 0); // Must NOT resurrect initial seed receivables!
  assert.equal(hydrated.purchaseBatches.length, 0);
  assert.equal(hydrated.inventory.length, 1);
  assert.equal(hydrated.sales.length, 1);
});

test('collectReceivable supports partial abonos and updates linked SaleRecord.paymentStatus when settled', () => {
  let state = createDemoSeedState();

  // Credit sale of $30.00 creates receivable linked by saleId
  const creditSale = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 30 }],
    customerName: 'Andrea Mendoza',
    seller: 'Jesús',
    paymentStatus: 'Pendiente',
    debtorName: 'Andrea Mendoza',
  });
  assert.equal(creditSale.ok, true);
  state = creditSale.state;

  const createdSale = state.sales[0];
  assert.equal(createdSale.paymentStatus, 'Pendiente');
  const linkedRec = state.receivables.find((r) => r.saleId === createdSale.id);
  assert.ok(linkedRec);
  assert.equal(linkedRec.amount, 30);

  // Overpayment rejected
  const overpay = collectReceivable(state, linkedRec.id, 'Efectivo ($)', 35);
  assert.equal(overpay.ok, false);

  // Partial abono $10.00 -> remaining $20.00, sale stays Pendiente, collectedReceivablesCount stays 0
  const abono1 = collectReceivable(state, linkedRec.id, 'Zelle', 10);
  assert.equal(abono1.ok, true);
  state = abono1.state;
  assert.equal(state.cashOnHand, round2(135.19 + 10));
  assert.equal(state.collectedReceivablesCount, 0);
  const recAfterAbono1 = state.receivables.find((r) => r.id === linkedRec.id);
  assert.ok(recAfterAbono1);
  assert.equal(recAfterAbono1.amount, 20);
  assert.equal(recAfterAbono1.originalAmount, 30);
  assert.equal(recAfterAbono1.paidAmount, 10);
  assert.equal(recAfterAbono1.installments?.length, 1);
  assert.equal(
    state.sales.find((s) => s.id === createdSale.id)?.paymentStatus,
    'Pendiente',
  );

  // Final abono $20.00 -> liquidated, removed from receivables, linked sale becomes Cobrado
  const abono2 = collectReceivable(state, linkedRec.id, 'Efectivo ($)', 20);
  assert.equal(abono2.ok, true);
  state = abono2.state;
  assert.equal(state.cashOnHand, round2(135.19 + 30));
  assert.equal(state.collectedReceivablesCount, 1);
  assert.equal(
    state.receivables.find((r) => r.id === linkedRec.id),
    undefined,
  );
  assert.equal(
    state.sales.find((s) => s.id === createdSale.id)?.paymentStatus,
    'Cobrado',
  );
});

test('registerCapitalInjection and reconcileCashOnHand update liquidity without modifying FIFO inventory cost', () => {
  let state = createInitialState();
  const unitsBefore = getTotalUnits(state);
  const cogsValueBefore = getTotalInventoryCostValue(state);
  const batchesSnapshotBefore = JSON.stringify(
    state.inventory.map((i) => i.fifoBatches),
  );

  // Reject invalid injection
  const badInj = registerCapitalInjection(state, {
    contributor: '   ',
    concept: 'Aporte',
    amount: 50,
  });
  assert.equal(badInj.ok, false);

  // Valid capital injection earmarked to growthReinvestment
  const injRes = registerCapitalInjection(state, {
    contributor: 'Jesús',
    concept: 'Liquidez para lote navideño',
    amount: 100,
    paymentMethod: 'Binance USDT',
    destination: 'growthReinvestment',
  });
  assert.equal(injRes.ok, true);
  state = injRes.state;
  assert.equal(state.cashOnHand, round2(135.19 + 100));
  assert.equal(state.funds.growthReinvestment, 100);
  assert.equal(state.capitalInjections.length, 2);
  assert.equal(state.movements[0].type, 'capital_injection');

  // Reconcile cash exact count ($240.00)
  const sameCash = reconcileCashOnHand(state, { countedCash: 235.19 });
  assert.equal(sameCash.ok, false);

  const recRes = reconcileCashOnHand(state, {
    countedCash: 240.0,
    reason: 'Arqueo de cierre',
  });
  assert.equal(recRes.ok, true);
  state = recRes.state;
  assert.equal(state.cashOnHand, 240.0);
  assert.equal(state.movements[0].type, 'reconciliation');
  assert.equal(state.movements[0].amount, 4.81);

  // Inventory units, total COGS value, and FIFO batches MUST remain 100% untouched
  assert.equal(getTotalUnits(state), unitsBefore);
  assert.equal(getTotalInventoryCostValue(state), cogsValueBefore);
  assert.equal(
    JSON.stringify(state.inventory.map((i) => i.fifoBatches)),
    batchesSnapshotBefore,
  );

  // Verify sanitizeForFirebase & normalizeAppState roundtrip with capitalInjections & installments
  const abonoState = collectReceivable(state, 'rec-enyer', 'Efectivo ($)', 3.5).state;
  const sanitized = sanitizeForFirebase(abonoState);
  const hydrated = normalizeAppState({
    ...sanitized,
    capitalInjections: {
      '0': sanitized.capitalInjections[0],
      '1': sanitized.capitalInjections[1],
    },
    receivables: sanitized.receivables.map((r) =>
      r.id === 'rec-enyer' && r.installments
        ? { ...r, installments: { '0': r.installments[0] } }
        : r,
    ),
  });
  assert.equal(hydrated.capitalInjections.length, 2);
  assert.equal(
    hydrated.receivables.find((r) => r.id === 'rec-enyer')?.installments?.length,
    1,
  );
});

test('extractTeamFromModel extracts canonical and custom team categories from model prefix', () => {
  assert.equal(extractTeamFromModel('Barcelona Local 25/26'), 'Barcelona');
  assert.equal(extractTeamFromModel('Real Madrid Tercera Carbón'), 'Real Madrid');
  assert.equal(extractTeamFromModel('Manchester City Visitante'), 'Manchester City');
  assert.equal(extractTeamFromModel('PSG Cuarta Edición'), 'PSG');
  assert.equal(extractTeamFromModel('Selección Venezuela Vinotinto'), 'Selecciones');
  assert.equal(extractTeamFromModel('Liverpool Local 25/26'), 'Liverpool');
  assert.equal(extractTeamFromModel('Inter Miami Visitante'), 'Inter Miami');
  assert.equal(extractTeamFromModel('   '), 'Otro');
});

test('getTransitAlertStatus flags >15d Aéreo and >80d Marítimo EN TRÁNSITO batches', () => {
  let state = createInitialState();

  const aereoRes = createImportOrder(state, {
    entryDate: '2026-10-01',
    referenceName: 'Aéreo Atrasado',
    shippingType: 'Aéreo',
    totalFreightCost: 5,
    items: [
      {
        team: 'Liverpool',
        model: 'Liverpool Local 25/26',
        version: 'Fans',
        size: 'XXL',
        quantity: 2,
        factoryUnitCost: 5.5,
        salePrice: 28,
      },
    ],
  });
  assert.equal(aereoRes.ok, true);
  state = aereoRes.state;
  const aereoBatch = state.purchaseBatches[0];

  assert.equal(getTransitAlertStatus(aereoBatch, '2026-10-16').isDelayed, false); // exact 15d
  assert.equal(getTransitAlertStatus(aereoBatch, '2026-10-17').isDelayed, true); // 16d > 15d

  const maritimoRes = createImportOrder(state, {
    entryDate: '2026-08-01',
    referenceName: 'Marítimo Atrasado',
    shippingType: 'Marítimo',
    totalFreightCost: 5,
    items: [
      {
        team: 'Arsenal',
        model: 'Arsenal Visitante',
        version: 'Player',
        size: 'M',
        quantity: 2,
        factoryUnitCost: 6.0,
        salePrice: 32,
      },
    ],
  });
  assert.equal(maritimoRes.ok, true);
  state = maritimoRes.state;
  const maritimoBatch = state.purchaseBatches[0];

  assert.equal(getTransitAlertStatus(maritimoBatch, '2026-10-20').isDelayed, false); // exact 80d
  assert.equal(getTransitAlertStatus(maritimoBatch, '2026-10-21').isDelayed, true); // 81d > 80d

  const alerts = getActiveOperationalAlerts(state, '2026-10-25');
  assert.equal(alerts.filter((a) => a.kind === 'transit_delay').length, 2);
});

test('getInventorySizeMatrix sums S-XXL grouped by model+version, merges Fan/Fans, propagates salePrice, and flags < 5 low stock', () => {
  let state = createDemoSeedState();

  const order = createImportOrder(state, {
    entryDate: '2026-11-10',
    referenceName: 'Matriz XXL Test',
    shippingType: 'Aéreo',
    totalFreightCost: 4,
    items: [
      {
        team: 'Liverpool',
        model: 'Liverpool Local 25/26',
        version: 'Fans',
        size: 'S',
        quantity: 1,
        factoryUnitCost: 5.5,
        salePrice: 28,
      },
      {
        team: 'Liverpool',
        model: 'Liverpool Local 25/26',
        version: 'Fans',
        size: 'M',
        quantity: 2,
        factoryUnitCost: 5.5,
        salePrice: 28,
      },
      {
        team: 'Liverpool',
        model: 'Liverpool Local 25/26',
        version: 'Fans',
        size: 'XXL',
        quantity: 1,
        factoryUnitCost: 5.5,
        salePrice: 28,
      },
    ],
  });
  assert.equal(order.ok, true);
  state = receiveImportBatch(order.state, {
    batchId: order.state.purchaseBatches[0].id,
    receivedDate: '2026-11-15',
    actualFreightCost: 4,
    receivedItems: [
      { itemIndex: 0, receivedQuantity: 1 },
      { itemIndex: 1, receivedQuantity: 2 },
      { itemIndex: 2, receivedQuantity: 1 },
    ],
  }).state;

  const matrix = getInventorySizeMatrix(state.inventory, 5);
  const livRow = matrix.find(
    (r) => r.model === 'Liverpool Local 25/26' && r.version === 'Fans',
  );
  assert.ok(livRow);
  assert.equal(livRow.sizes.S, 1);
  assert.equal(livRow.sizes.M, 2);
  assert.equal(livRow.sizes.L, 0);
  assert.equal(livRow.sizes.XL, 0);
  assert.equal(livRow.sizes.XXL, 1);
  assert.equal(livRow.totalStock, 4);
  assert.equal(livRow.salePrice, 28);
  assert.equal(livRow.isLowStock, true); // 4 < 5

  // Verify existing Barcelona Local 25/26 Fans merged cleanly (12 uds -> NOT low stock)
  const fcbFans = matrix.find(
    (r) => r.model === 'Barcelona Local 25/26' && r.version === 'Fans',
  );
  assert.ok(fcbFans);
  assert.equal(fcbFans.totalStock, 12);
  assert.equal(fcbFans.isLowStock, false);

  const alerts = getActiveOperationalAlerts(state, '2026-10-25');
  assert.ok(
    alerts.some(
      (a) =>
        a.kind === 'low_stock' && a.title.includes('Liverpool Local 25/26'),
    ),
  );
});

test('migrateLegacyInventoryItems & migrateLegacyStateToCurrent adapt old structures to S-XXL & Fans/Player/Retro without data loss', () => {
  const legacyPayload = JSON.stringify({
    efectivo: 135.19,
    inventario: [
      {
        id: 'old-1',
        modelo: 'Liverpool Local 25/26',
        version: 'Fan',
        tallas: { S: 2, M: 3, '2XL': 1 },
        costo: 5.75,
        precioVenta: 26,
      },
      {
        id: 'old-2',
        model: 'Bayern Munich Retro 02',
        version: 'Retro',
        size: 'xl',
        stock: 4,
        cogs: 7.1,
      },
    ],
  });

  const migrated = migrateLegacyStateToCurrent(legacyPayload);
  assert.ok(migrated);
  assert.equal(migrated.cashOnHand, 135.19);
  assert.equal(getTotalUnits(migrated), 10); // 2 + 3 + 1 + 4 = 10 preserved
  assert.equal(migrated.receivables.length, 7);
  assert.equal(getTotalReceivables(migrated), 263.5);

  const livXxl = migrated.inventory.find(
    (i) => i.model === 'Liverpool Local 25/26' && i.size === 'XXL',
  );
  assert.ok(livXxl);
  assert.equal(livXxl.team, 'Liverpool');
  assert.equal(livXxl.version, 'Fans');
  assert.equal(livXxl.stock, 1);
  assert.equal(livXxl.salePrice, 26);

  const matrix = getInventorySizeMatrix(migrated.inventory, 5);
  const livRow = matrix.find((r) => r.model === 'Liverpool Local 25/26');
  assert.equal(livRow?.sizes.S, 2);
  assert.equal(livRow?.sizes.M, 3);
  assert.equal(livRow?.sizes.XXL, 1);
  assert.equal(livRow?.totalStock, 6);
  assert.equal(livRow?.isLowStock, false);
});

test('recoverStartupErpState strips accidental demo items, preserves real localStorage data, and keeps $135.19 cash + 7 receivables ($263.50)', () => {
  const emptyRemote = normalizeAppState({
    cashOnHand: 120.19,
    inventory: [],
    receivables: [],
    exchangeRates: { bcv: 46.5, usdt: 54.2, updatedAt: '2026-11-16T00:00:00.000Z', source: 'api' },
    funds: {
      replacement: 0,
      commissions: 0,
      commissionsBySeller: { Jesús: 0, Josué: 0, Gabriel: 0 },
      operatingAndAds: 0,
      growthReinvestment: 0,
      dividendsByPartner: { Jesús: 0, Josué: 0, Gabriel: 0 },
      reinvestedFromDividendsTotal: 0,
    },
  });

  // Case 1: Recover from genuine non-demo localStorage backup (ignoring any accidental demo backup)
  const accidentalDemoBackup = JSON.stringify({
    ...createDemoSeedState(),
    isExplicitDemo: false,
  });
  const realLocalBackup = JSON.stringify({
    cashOnHand: 135.19,
    inventory: [
      { id: 'loc-1', model: 'Arsenal Local', version: 'Fan', size: 'L', stock: 5, cogs: 6.0 },
    ],
  });
  const fromLocal = recoverStartupErpState(emptyRemote, [
    accidentalDemoBackup,
    realLocalBackup,
  ]);
  assert.equal(fromLocal.needsFirebaseSync, true);
  assert.equal(fromLocal.state.cashOnHand, 135.19);
  assert.equal(getTotalUnits(fromLocal.state), 5);
  assert.equal(fromLocal.state.inventory[0].version, 'Fans');

  // Case 2: Accidental demo seed sitting in Firebase RTDB (without isExplicitDemo) -> stripped to 0 fake items + $135.19 cash + $263.50 CxC
  const accidentalRemote = {
    ...createDemoSeedState(),
    isExplicitDemo: false,
    cashOnHand: 120.19,
    receivables: [],
  };
  assert.equal(isAccidentalDemoCatalogOnly(accidentalRemote), true);
  const cleanedRemote = recoverStartupErpState(accidentalRemote, [accidentalDemoBackup]);
  assert.equal(cleanedRemote.needsFirebaseSync, true);
  assert.equal(cleanedRemote.state.inventory.length, 0);
  assert.equal(cleanedRemote.state.cashOnHand, 135.19);
  assert.equal(getTotalReceivables(cleanedRemote.state), 263.5);
  assert.equal(cleanedRemote.state.receivables.length, 7);
  assert.equal(cleanedRemote.state.historicalNetProfit, 317.37);

  // Case 3: Already clean remote baseline -> needsFirebaseSync is false (no pointless rewrites on refresh)
  const cleanRemote = createInitialState();
  const steady = recoverStartupErpState(cleanRemote, []);
  assert.equal(steady.needsFirebaseSync, false);
  assert.equal(steady.state.inventory.length, 0);
  assert.equal(steady.state.cashOnHand, 135.19);
  assert.equal(steady.state.receivables.length, 7);

  // Also test direct migrateLegacyInventoryItems preserves 0-loss on mixed entries
  const migratedItems = migrateLegacyInventoryItems([
    { model: 'Bayern Munich Local', version: 'Fan', size: '2XL', stock: 3, cogs: 5.9 },
  ]);
  assert.equal(migratedItems[0].size, 'XXL');
  assert.equal(migratedItems[0].version, 'Fans');
  assert.equal(migratedItems[0].team, 'Bayern Munich');
});

test('processReturnOrExchange handles upgrades (+diff), even swaps (0 diff), and refunds (-diff) with FIFO stock & cash reconciliation', () => {
  let state = createDemoSeedState();
  // Register initial cash sale of sku-fcb-3 (Fans M @ $25.00) -> FAC-0001
  const saleRes = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-3', quantity: 1, unitPrice: 25 }],
    customerName: 'Cliente Cambio',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  assert.equal(saleRes.ok, true);
  state = saleRes.state;
  const sale = state.sales[0];
  const cashAfterSale = state.cashOnHand; // 135.19 + 25 = 160.19
  const fansBefore = state.inventory.find((i) => i.id === 'sku-fcb-3')!.stock; // 11
  const playerBefore = state.inventory.find((i) => i.id === 'sku-fcb-1')!.stock; // 10

  // 1. Exchange Fans ($25) for Player ($30) -> client pays +$5.00 difference
  const upgradeRes = processReturnOrExchange(state, {
    type: 'Cambio',
    saleId: sale.id,
    invoiceNumber: sale.invoiceNumber,
    returnedSkuId: 'sku-fcb-3',
    returnedQuantity: 1,
    returnedUnitPrice: 25,
    replacementSkuId: 'sku-fcb-1',
    replacementQuantity: 1,
    replacementUnitPrice: 30,
    paymentMethod: 'Efectivo ($)',
    reason: 'Upgrade a versión Player',
  });
  assert.equal(upgradeRes.ok, true);
  state = upgradeRes.state;
  assert.equal(state.cashOnHand, round2(cashAfterSale + 5)); // 165.19
  assert.equal(state.inventory.find((i) => i.id === 'sku-fcb-3')?.stock, fansBefore + 1);
  assert.equal(state.inventory.find((i) => i.id === 'sku-fcb-1')?.stock, playerBefore - 1);
  assert.equal(state.returns?.[0].differenceUsd, 5);

  // 2. Full return / refund of sku-fcb-1 ($30) -> cash decreases by $30 & funds reconcile proportionally to physical cash
  const refundRes = processReturnOrExchange(state, {
    type: 'Devolución',
    returnedSkuId: 'sku-fcb-1',
    returnedQuantity: 1,
    returnedUnitPrice: 30,
    paymentMethod: 'Efectivo ($)',
    reason: 'Talla incorrecta',
  });
  assert.equal(refundRes.ok, true);
  state = refundRes.state;
  assert.equal(state.cashOnHand, round2(cashAfterSale + 5 - 30)); // 135.19
  assert.equal(state.inventory.find((i) => i.id === 'sku-fcb-1')?.stock, playerBefore);
  assert.equal(state.returns?.[0].differenceUsd, -30);
  assert.equal(getCashBackedFundsSummary(state).isStrictlyCashBacked, true);
});

test('CROSS-MODULE STRESS AUDIT: Landed Cost import -> 3-layer FIFO consumption -> multi-item mixed payment sale -> credit/abono -> exact 4-layer matrix -> Caja Chica expense', () => {
  // 0. Start clean with known cash ($500.00) and BCV rate (46.50 Bs) / USDT rate (54.20 Bs)
  let state = createInitialState();
  const capRes = registerCapitalInjection(state, {
    contributor: 'Auditoría',
    concept: 'Capital Stress Audit',
    amount: 364.81,
    destination: 'cashOnly',
  });
  assert.equal(capRes.ok, true);
  state = capRes.state;
  assert.equal(state.cashOnHand, 500);

  const rateRes = updateExchangeRates(state, 46.5, 54.2, 'manual');
  assert.equal(rateRes.ok, true);
  state = rateRes.state;

  // 1. Seed 2 earlier chronological FIFO batches on Real Madrid Local 25/26 (Player M)
  // Batch A (2026-09-01): 2 uds @ $5.50
  const o1 = createImportOrder(state, {
    referenceName: 'Lote Septiembre A',
    shippingType: 'Aéreo',
    entryDate: '2026-08-20',
    totalFreightCost: 0,
    fundingSource: 'cashOnHand',
    items: [
      {
        team: 'Real Madrid',
        model: 'Real Madrid Local 25/26',
        version: 'Player',
        size: 'M',
        quantity: 2,
        factoryUnitCost: 5.5,
        salePrice: 30,
      },
    ],
  });
  assert.equal(o1.ok, true);
  const r1 = receiveImportBatch(o1.state, {
    batchId: o1.createdBatch!.id,
    receivedDate: '2026-09-01',
    actualFreightCost: 0,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 2 }],
  });
  assert.equal(r1.ok, true);
  state = r1.state; // cash: 500 - 11 = 489

  // Batch B (2026-10-01): 3 uds @ $6.50
  const o2 = createImportOrder(state, {
    referenceName: 'Lote Octubre B',
    shippingType: 'Aéreo',
    entryDate: '2026-09-20',
    totalFreightCost: 0,
    fundingSource: 'cashOnHand',
    items: [
      {
        team: 'Real Madrid',
        model: 'Real Madrid Local 25/26',
        version: 'Player',
        size: 'M',
        quantity: 3,
        factoryUnitCost: 6.5,
        salePrice: 30,
      },
    ],
  });
  assert.equal(o2.ok, true);
  const r2 = receiveImportBatch(o2.state, {
    batchId: o2.createdBatch!.id,
    receivedDate: '2026-10-01',
    actualFreightCost: 0,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 3 }],
  });
  assert.equal(r2.ok, true);
  state = r2.state; // cash: 489 - 19.50 = 469.50

  // 2. Two-stage Import Order with prorated freight & freight variance (+$4.00 real freight)
  // Ordered: 4x Real Madrid Player M (@ $6.00 factory) + 4x Argentina Local Fans L (@ $5.00 factory) = 8 uds, factory $44, est freight $12 -> est landed $56
  const orderRes = createImportOrder(state, {
    referenceName: 'Import Stress #1',
    shippingType: 'Aéreo',
    entryDate: '2026-10-15',
    estimatedArrivalDate: '2026-10-30',
    totalFreightCost: 12,
    fundingSource: 'cashOnHand',
    items: [
      {
        team: 'Real Madrid',
        model: 'Real Madrid Local 25/26',
        version: 'Player',
        size: 'M',
        quantity: 4,
        factoryUnitCost: 6,
        salePrice: 30,
      },
      {
        team: 'Selecciones',
        model: 'Argentina Local 25/26',
        version: 'Fans',
        size: 'L',
        quantity: 4,
        factoryUnitCost: 5,
        salePrice: 25,
      },
    ],
  });
  assert.equal(orderRes.ok, true);
  state = orderRes.state;
  const transitBatch = orderRes.createdBatch!;
  assert.equal(transitBatch.status, 'EN TRÁNSITO');
  assert.equal(state.cashOnHand, 413.5); // 469.50 - 56.00

  // Receive batch with actual freight = $16.00 (+$4.00 variance) -> $2.00/ud freight prorated across 8 uds
  // Real Madrid Player M Batch C landed = $6.00 + $2.00 = $8.00/ud
  // Argentina Fans L Batch 1 landed = $5.00 + $2.00 = $7.00/ud
  const recvRes = receiveImportBatch(state, {
    batchId: transitBatch.id,
    receivedDate: '2026-11-01',
    actualFreightCost: 16,
    receivedItems: [
      { itemIndex: 0, receivedQuantity: 4 },
      { itemIndex: 1, receivedQuantity: 4 },
    ],
  });
  assert.equal(recvRes.ok, true);
  state = recvRes.state;
  assert.equal(state.cashOnHand, 409.5); // 413.50 - 4.00 freight variance

  const rmaSku = state.inventory.find(
    (i) => i.model === 'Real Madrid Local 25/26' && i.version === 'Player' && i.size === 'M',
  )!;
  const argSku = state.inventory.find(
    (i) => i.model === 'Argentina Local 25/26' && i.version === 'Fans' && i.size === 'L',
  )!;
  assert.equal(rmaSku.stock, 9); // 2 + 3 + 4
  assert.equal(rmaSku.fifoBatches.length, 3);
  assert.equal(rmaSku.fifoBatches[2].unitCost, 8);
  assert.equal(argSku.stock, 4);
  assert.equal(argSku.cogs, 7);

  // 3. Multi-Item Sale crossing ALL 3 FIFO layers on Real Madrid (6 uds: 2@$5.50 + 3@$6.50 + 1@$8.00 = $38.50 COGS)
  //    + 2x Argentina Fans L (@ $7.00 = $14.00 COGS)
  //    Total COGS = $52.50; Total Gross = (6 * $30) + (2 * $25) = $230.00
  //    Mixed payment across ALL 4 methods:
  //      Efectivo ($) = $50.00
  //      Binance USDT = $80.00
  //      Zelle = $53.50
  //      Pago Móvil / Bs = $46.50 (46.50 * 46.50 = 2162.25 Bs)
  //      Sum = $230.00 exact
  const saleRes = registerMultiItemSale(state, {
    items: [
      { skuId: rmaSku.id, quantity: 6, unitPrice: 30 },
      { skuId: argSku.id, quantity: 2, unitPrice: 25 },
    ],
    customerName: 'Andrés Mendoza',
    customerPhone: '0414-5550199',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
    paymentMethod: 'Pago Mixto',
    paymentSplits: [
      { method: 'Efectivo ($)', amountUsd: 50 },
      { method: 'Binance USDT', amountUsd: 80 },
      { method: 'Zelle', amountUsd: 53.5 },
      { method: 'Pago Móvil / Bs', amountUsd: 46.5 },
    ],
  });
  assert.equal(saleRes.ok, true);
  state = saleRes.state;
  const recordedSale = state.sales[0];

  assert.equal(recordedSale.finalPrice, 230);
  const computedLinesCogs = round2(
    (recordedSale.items ?? []).reduce((s, l) => s + l.totalLineCogs, 0),
  );
  assert.equal(computedLinesCogs, 52.5);
  assert.equal(recordedSale.items?.[0].fifoConsumed?.length, 3);
  assert.deepEqual(
    recordedSale.items?.[0].fifoConsumed?.map((c) => [c.quantity, c.unitCost]),
    [
      [2, 5.5],
      [3, 6.5],
      [1, 8],
    ],
  );
  assert.equal(recordedSale.bcvEquivalent, round2(46.5 * 46.5)); // 2162.25 Bs
  assert.equal(recordedSale.paymentSplits?.length, 4);
  assert.equal(state.cashOnHand, round2(409.5 + 230)); // 639.50

  // Check FIFO remaining stock & active unit cost after crossing 3 layers
  const updatedRma = state.inventory.find((i) => i.id === rmaSku.id)!;
  assert.equal(updatedRma.stock, 3); // 9 - 6
  assert.equal(updatedRma.cogs, 8); // remaining units are strictly from Batch C ($8.00)

  // Verify 4-Layer Matrix exact dollar split on $230.00 gross & $52.50 COGS:
  // Layer 1 (Reposición COGS 100%): $52.50
  // Layer 2 (Comisión 4% sobre $230.00): $9.20 -> Jesús
  // Net Profit = 230 - 52.50 - 9.20 = $168.30
  // Layer 3 (Operativo 10% de $168.30): $16.83
  // Remainder = 168.30 - 16.83 = $151.47
  // Layer 4: Growth 80% = 121.18, Dividends 20% = 30.29 (Jesús 53.65%=16.25, Josué 40.43%=12.25, Gabriel=1.79)
  assert.equal(recordedSale.breakdown.layer1CostRecovery, 52.5);
  assert.equal(recordedSale.breakdown.layer2Commission, 9.2);
  assert.equal(recordedSale.breakdown.netProfit, 168.3);
  assert.equal(recordedSale.breakdown.layer3OperatingFund, 16.83);
  assert.equal(recordedSale.breakdown.remainingNetProfit, 151.47);
  assert.equal(recordedSale.breakdown.layer4GrowthReinvestment, 121.18);
  assert.equal(recordedSale.breakdown.layer4TotalDividends, 30.29);
  assert.equal(recordedSale.breakdown.partnerSplits.Jesús, 16.25);
  assert.equal(recordedSale.breakdown.partnerSplits.Josué, 12.25);
  assert.equal(recordedSale.breakdown.partnerSplits.Gabriel, 1.79);

  // 4. Credit Sale (Pendiente) + Partial Abono -> updates receivables & cashOnHand cleanly
  const creditRes = registerMultiItemSale(state, {
    items: [{ skuId: argSku.id, quantity: 1, unitPrice: 25 }],
    customerName: 'Carlos Crédito',
    seller: 'Josué',
    paymentStatus: 'Pendiente',
    paymentMethod: 'Efectivo ($)',
  });
  assert.equal(creditRes.ok, true);
  state = creditRes.state;
  const cashBeforeAbono = state.cashOnHand; // unchanged on Pendiente: 639.50
  const newRec = state.receivables.find((r) => r.debtor === 'Carlos Crédito')!;
  assert.equal(newRec.amount, 25);

  const abonoRes = collectReceivable(state, newRec.id, 'Zelle', 15);
  assert.equal(abonoRes.ok, true);
  state = abonoRes.state;
  assert.equal(state.cashOnHand, round2(cashBeforeAbono + 15)); // 654.50
  assert.equal(
    state.receivables.find((r) => r.id === newRec.id)?.amount,
    10,
  );

  // 5. Caja Chica (Petty Cash) quick expense -> deducts cashOnHand cleanly WITHOUT altering FIFO inventory
  const stockSnapshotBeforeExpense = getTotalUnits(state);
  const cogsSnapshotBeforeExpense = getTotalInventoryCostValue(state);
  const pettyRes = registerOperatingExpense(state, {
    concept: 'Delivery motorizado Express Caracas',
    category: 'Logística/Producción',
    amount: 5.5,
    source: 'cashOnHand',
    paymentMethod: 'Efectivo ($)',
  });
  assert.equal(pettyRes.ok, true);
  state = pettyRes.state;

  assert.equal(state.cashOnHand, round2(654.5 - 5.5)); // 649.00
  assert.equal(getTotalUnits(state), stockSnapshotBeforeExpense);
  assert.equal(getTotalInventoryCostValue(state), cogsSnapshotBeforeExpense);
  assert.equal(getCashBackedFundsSummary(state).isStrictlyCashBacked, true);
  assert.ok(getTotalAllocatedFunds(state.funds) <= state.cashOnHand + 0.01);
});

test('normalizeGeneralConfig enforces defaults, numeric bounds, and 100% partner share invariant', () => {
  const defaults = normalizeGeneralConfig(null);
  assert.deepEqual(defaults, DEFAULT_GENERAL_CONFIG);
  assert.equal(defaults.alertThresholds.lowStockThreshold, 2);
  assert.equal(defaults.alertThresholds.receivableOverdueDays, 30);
  assert.equal(defaults.alertThresholds.maritimeTransitMaxDays, 80);
  assert.equal(defaults.alertThresholds.airTransitMaxDays, 15);

  const normalized = normalizeGeneralConfig({
    matrixParams: {
      commissionPct: 5,
      operatingFundPct: 12,
      growthReinvestmentPct: 75,
      dividendsPct: 10,
      partnerSharesPct: { Jesús: 50, Josué: 30, Gabriel: 20 },
    },
    alertThresholds: {
      lowStockThreshold: 3,
      receivableOverdueDays: 45,
      maritimeTransitMaxDays: 90,
      airTransitMaxDays: 20,
    },
    brandIdentity: {
      storeName: '  X4SPORT PRO  ',
      logoUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing',
    },
  });

  assert.equal(normalized.matrixParams.commissionPct, 5);
  assert.equal(normalized.matrixParams.operatingFundPct, 12);
  assert.equal(normalized.matrixParams.growthReinvestmentPct, 75);
  assert.equal(normalized.matrixParams.dividendsPct, 25);
  assert.deepEqual(normalized.matrixParams.partnerSharesPct, {
    Jesús: 50,
    Josué: 30,
    Gabriel: 20,
  });
  assert.equal(normalized.alertThresholds.lowStockThreshold, 3);
  assert.equal(normalized.alertThresholds.receivableOverdueDays, 45);
  assert.equal(normalized.brandIdentity.storeName, 'X4SPORT PRO');

  const badPartnerSum = normalizeGeneralConfig({
    matrixParams: {
      commissionPct: 4,
      operatingFundPct: 10,
      growthReinvestmentPct: 80,
      dividendsPct: 20,
      partnerSharesPct: { Jesús: 60, Josué: 40, Gabriel: 20 },
    },
  });
  assert.deepEqual(
    badPartnerSum.matrixParams.partnerSharesPct,
    DEFAULT_GENERAL_CONFIG.matrixParams.partnerSharesPct,
  );
});

test('calculateFourLayerMatrixConsolidated preserves baseline defaults and respects custom MatrixConfigParams', () => {
  const defaultBreakdown = calculateFourLayerMatrixConsolidated(100, 20, 'Jesús');
  const explicitDefaultBreakdown = calculateFourLayerMatrixConsolidated(
    100,
    20,
    'Jesús',
    DEFAULT_GENERAL_CONFIG.matrixParams,
  );
  assert.deepEqual(defaultBreakdown, explicitDefaultBreakdown);

  const customBreakdown = calculateFourLayerMatrixConsolidated(100, 20, 'Jesús', {
    commissionPct: 5,
    operatingFundPct: 10,
    growthReinvestmentPct: 70,
    dividendsPct: 30,
    partnerSharesPct: { Jesús: 50, Josué: 30, Gabriel: 20 },
  });

  assert.equal(customBreakdown.layer1CostRecovery, 20);
  assert.equal(customBreakdown.layer2Commission, 5);
  assert.equal(customBreakdown.netProfit, 75);
  assert.equal(customBreakdown.layer3OperatingFund, 7.5);
  assert.equal(customBreakdown.layer4GrowthReinvestment, 47.25);
  assert.equal(customBreakdown.layer4TotalDividends, 20.25);
  assert.equal(customBreakdown.partnerSplits.Jesús, 10.13);
  assert.equal(customBreakdown.partnerSplits.Josué, 6.08);
  assert.equal(customBreakdown.partnerSplits.Gabriel, 4.04);
});

test('getActiveOperationalAlerts evaluates configurable thresholds and overdue receivables (>30d) with targetSubModule routing', () => {
  const state = createInitialState();
  state.inventory.push(
    {
      id: 'sku-low-2',
      team: 'Barcelona',
      model: 'Barcelona Visita 25/26',
      version: 'Fans',
      size: 'M',
      stock: 2,
      cogs: 7,
      salePrice: 30,
      fifoBatches: [],
    },
    {
      id: 'sku-ok-4',
      team: 'Real Madrid',
      model: 'Real Madrid Local 25/26',
      version: 'Fans',
      size: 'L',
      stock: 4,
      cogs: 7,
      salePrice: 30,
      fifoBatches: [],
    },
  );
  state.receivables = [
    {
      id: 'rec-overdue',
      debtor: 'Cliente Moroso',
      amount: 55,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 'rec-fresh',
      debtor: 'Cliente Reciente',
      amount: 30,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
  ];

  const alerts = getActiveOperationalAlerts(
    state,
    '2026-10-25',
    DEFAULT_GENERAL_CONFIG.alertThresholds,
  );

  const lowAlerts = alerts.filter((a) => a.kind === 'low_stock');
  assert.equal(lowAlerts.length, 1);
  assert.ok(lowAlerts[0].title.includes('Barcelona Visita 25/26'));
  assert.equal(lowAlerts[0].targetSubModule, 'inventario-stock');

  const cxcAlerts = alerts.filter((a) => a.kind === 'overdue_receivable');
  assert.equal(cxcAlerts.length, 1);
  assert.ok(cxcAlerts[0].title.includes('Cliente Moroso'));
  assert.equal(cxcAlerts[0].targetSubModule, 'ventas-cxc');
});

test('extractTeamFromModel detects keywords anywhere in model name without manual category input', () => {
  assert.equal(extractTeamFromModel('Real Madrid Local 26/27'), 'Real Madrid');
  assert.equal(extractTeamFromModel('Camiseta Real Madrid Local 26/27'), 'Real Madrid');
  assert.equal(extractTeamFromModel('Barcelona Visitante'), 'Barcelona');
  assert.equal(extractTeamFromModel('Edición Retro Barcelona 99'), 'Barcelona');
  assert.equal(extractTeamFromModel('PSG Retro 2002'), 'PSG');
  assert.equal(extractTeamFromModel('Japón Edición Especial'), 'Selecciones');
  assert.equal(extractTeamFromModel('Edición Especial Japón'), 'Selecciones');
  assert.equal(extractTeamFromModel('Camiseta Retro Liverpool 2005'), 'Liverpool');
});

test('Compras upgrade supports custom sizes, Stage 2 Mode B per-item pricing, supplier, elapsed days, direct reception, and idempotency', () => {
  const state = createInitialState();

  // 1. Register EN TRÁNSITO batch with supplier, extra sizes (XS, Niño), Mode A price, and clientOperationId
  const op1 = 'op-test-transit-001';
  const transitRes = createImportOrder(state, {
    entryDate: '2026-10-01',
    supplier: 'Fábrica Guangzhou VIP',
    referenceName: 'Aéreo Octubre #1',
    shippingType: 'Aéreo',
    totalFreightCost: 10,
    retailPricingMode: 'uniform',
    clientOperationId: op1,
    items: [
      {
        team: 'PSG',
        model: 'PSG Retro 2002',
        version: 'Retro',
        size: 'XS',
        quantity: 2,
        factoryUnitCost: 6,
        salePrice: 35,
      },
      {
        team: 'Selecciones',
        model: 'Japón Edición Especial',
        version: 'Player',
        size: 'Niño',
        quantity: 3,
        factoryUnitCost: 5,
        salePrice: 35,
      },
    ],
  });
  assert.equal(transitRes.ok, true);
  assert.equal(transitRes.createdBatch?.supplier, 'Fábrica Guangzhou VIP');
  assert.equal(transitRes.createdBatch?.status, 'EN TRÁNSITO');

  // Duplicate clientOperationId must be rejected cleanly without double-deducting cash
  const dupRes = createImportOrder(transitRes.state, {
    entryDate: '2026-10-01',
    supplier: 'Fábrica Guangzhou VIP',
    referenceName: 'Aéreo Octubre #1',
    shippingType: 'Aéreo',
    totalFreightCost: 10,
    clientOperationId: op1,
    items: [
      {
        team: 'PSG',
        model: 'PSG Retro 2002',
        version: 'Retro',
        size: 'XS',
        quantity: 2,
        factoryUnitCost: 6,
        salePrice: 35,
      },
    ],
  });
  assert.equal(dupRes.ok, false);
  assert.equal(dupRes.state.purchaseBatches.length, 1);

  // Check transit alert fires when > 15 days for Aéreo
  const alertsBeforeReceive = getActiveOperationalAlerts(
    transitRes.state,
    '2026-10-20',
  );
  assert.equal(
    alertsBeforeReceive.some((a) => a.kind === 'transit_delay'),
    true,
  );

  // 2. Confirm reception in Stage 2 switching to Mode B per-item pricing and calculating diasTranscurridos
  const receiveRes = receiveImportBatch(transitRes.state, {
    batchId: transitRes.createdBatch!.id,
    receivedDate: '2026-10-19',
    actualFreightCost: 10,
    retailPricingMode: 'per-item',
    receivedItems: [
      { itemIndex: 0, receivedQuantity: 2, salePrice: 39.5 },
      { itemIndex: 1, receivedQuantity: 3, salePrice: 28.0 },
    ],
  });
  assert.equal(receiveRes.ok, true);
  const receivedBatch = receiveRes.createdBatch!;
  assert.equal(receivedBatch.status, 'RECIBIDO EN BODEGA');
  assert.equal(receivedBatch.diasTranscurridos, 18);
  assert.equal(calculateElapsedTransitDays('2026-10-01', '2026-10-19'), 18);
  assert.equal(receivedBatch.retailPricingMode, 'per-item');

  // Double-confirm reception must fail cleanly
  const dupReceive = receiveImportBatch(receiveRes.state, {
    batchId: transitRes.createdBatch!.id,
    receivedDate: '2026-10-19',
    actualFreightCost: 10,
    receivedItems: [
      { itemIndex: 0, receivedQuantity: 2 },
      { itemIndex: 1, receivedQuantity: 3 },
    ],
  });
  assert.equal(dupReceive.ok, false);

  // Check custom sizes & Mode B prices propagated into inventory, matrix, and public catalog
  const psgXs = receiveRes.state.inventory.find(
    (i) => i.model === 'PSG Retro 2002' && i.size === 'XS',
  );
  const japonKid = receiveRes.state.inventory.find(
    (i) => i.model === 'Japón Edición Especial' && i.size === 'Niño',
  );
  assert.equal(psgXs?.stock, 2);
  assert.equal(psgXs?.salePrice, 39.5);
  assert.equal(japonKid?.stock, 3);
  assert.equal(japonKid?.salePrice, 28);

  const matrix = getInventorySizeMatrix(receiveRes.state.inventory, 5);
  const psgRow = matrix.find((r) => r.model === 'PSG Retro 2002');
  assert.equal(psgRow?.extraSizes[0]?.size, 'XS');
  assert.equal(psgRow?.extraSizes[0]?.stock, 2);

  const catalogGroups = buildPublicCatalogGroups(receiveRes.state);
  const psgCat = catalogGroups
    .flatMap((g) => g.products)
    .find((p) => p.model === 'PSG Retro 2002');
  assert.equal(psgCat?.sizes[0]?.size, 'XS');
  assert.equal(psgCat?.sizes[0]?.salePrice, 39.5);

  // 3. Direct Reception puts items straight into FIFO with 0 days elapsed
  const directRes = registerDirectPurchaseBatch(receiveRes.state, {
    entryDate: '2026-10-20',
    receivedDate: '2026-10-20',
    supplier: 'Proveedor Nacional',
    referenceName: 'Reposición Directa Local',
    shippingType: 'Aéreo',
    totalFreightCost: 0,
    retailPricingMode: 'uniform',
    isDirectReception: true,
    clientOperationId: 'op-direct-001',
    items: [
      {
        team: 'Real Madrid',
        model: 'Real Madrid Local 26/27',
        version: 'Fans',
        size: '3XL',
        quantity: 4,
        factoryUnitCost: 7,
        salePrice: 30,
      },
    ],
  });
  assert.equal(directRes.ok, true);
  assert.equal(directRes.createdBatch?.status, 'RECIBIDO EN BODEGA');
  assert.equal(directRes.createdBatch?.isDirectReception, true);
  assert.equal(directRes.createdBatch?.diasTranscurridos, 0);
  const rm3xl = directRes.state.inventory.find(
    (i) => i.model === 'Real Madrid Local 26/27' && i.size === '3XL',
  );
  assert.equal(rm3xl?.stock, 4);
  assert.equal(rm3xl?.salePrice, 30);

  // Check normalizeAppState roundtrip preserves all new fields
  const sanitized = sanitizeForFirebase(directRes.state);
  const hydrated = normalizeAppState(sanitized);
  const hydratedDirect = hydrated.purchaseBatches.find(
    (b) => b.clientOperationId === 'op-direct-001',
  );
  assert.equal(hydratedDirect?.supplier, 'Proveedor Nacional');
  assert.equal(hydratedDirect?.diasTranscurridos, 0);
  assert.equal(hydratedDirect?.isDirectReception, true);
});

test('canonical team normalization strictly isolates Real Madrid vs PSG and other clubs', () => {
  assert.equal(normalizeCanonicalTeam('Real Madrid'), 'Real Madrid');
  assert.equal(normalizeCanonicalTeam('real-madrid-cf'), 'Real Madrid');
  assert.equal(normalizeCanonicalTeam('Paris Saint-Germain'), 'PSG');
  assert.equal(normalizeCanonicalTeam('PSG Retro 2002'), 'PSG');
  assert.equal(normalizeCanonicalTeam('FC Barcelona'), 'Barcelona');
  assert.equal(normalizeCanonicalTeam('Selección España'), 'Selecciones');

  const rmItem = {
    model: 'Real Madrid Local 26/27',
    team: 'Real Madrid',
  };
  const psgMislabeled = {
    model: 'PSG Visitante 25/26',
    team: 'Real Madrid',
  };
  const psgNormal = {
    model: 'Paris Saint-Germain Local 25/26',
    team: 'PSG',
  };
  const fcbItem = {
    model: 'Barcelona Local 25/26',
    team: 'Barcelona',
  };

  assert.equal(doesItemMatchTeamFilter(rmItem, 'Real Madrid'), true);
  assert.equal(doesItemMatchTeamFilter(psgMislabeled, 'Real Madrid'), false);
  assert.equal(doesItemMatchTeamFilter(psgNormal, 'Real Madrid'), false);
  assert.equal(doesItemMatchTeamFilter(fcbItem, 'Real Madrid'), false);

  assert.equal(doesItemMatchTeamFilter(psgMislabeled, 'PSG'), true);
  assert.equal(doesItemMatchTeamFilter(psgNormal, 'PSG'), true);
  assert.equal(doesItemMatchTeamFilter(rmItem, 'PSG'), false);
  assert.equal(doesItemMatchTeamFilter(rmItem, 'Todos'), true);
});

test('Ventas workflow supports editable saleDate, Sin Asignar 0% commission, partial credit CxC, #0001 formatting, idempotency, and multi-criteria search', () => {
  assert.equal(formatInvoiceNumber(1), '#0001');
  assert.equal(formatInvoiceNumber(42), '#0042');
  assert.equal(isUnassignedSeller('Sin Asignar'), true);
  assert.equal(isUnassignedSeller('Sin Vendedor'), true);
  assert.equal(isUnassignedSeller('Jesús'), false);

  let state = createDemoSeedState();
  // Seed legacy FAC-0009 to verify sequence continues cleanly with #0010 if seq is 10
  state = {
    ...state,
    nextInvoiceSeq: 10,
  };

  const cashStart = state.cashOnHand;
  const opSale = registerMultiItemSale(state, {
    saleDate: '2026-11-10',
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 45 }],
    customerName: 'Carlos Mendoza',
    customerCity: 'Valencia',
    customerPhone: '0412-9991122',
    seller: 'Sin Asignar',
    paymentStatus: 'Pendiente',
    paidAmount: 20,
    paymentMethod: 'Efectivo ($)',
    clientOperationId: 'sale-op-abc',
  });

  assert.equal(opSale.ok, true);
  assert.equal(opSale.createdSale?.invoiceNumber, '#0010');
  assert.equal(opSale.createdSale?.saleDate, '2026-11-10');
  assert.equal(opSale.createdSale?.paidAmount, 20);
  assert.equal(opSale.createdSale?.breakdown.layer2Commission, 0);
  assert.equal(opSale.state.cashOnHand, round2(cashStart + 20));

  const cxc = opSale.state.receivables[0];
  assert.equal(cxc.originalAmount, 45);
  assert.equal(cxc.paidAmount, 20);
  assert.equal(cxc.amount, 25);
  assert.equal((cxc.installments ?? []).length, 1);

  // Duplicate sale clientOperationId must be rejected cleanly
  const dupSale = registerMultiItemSale(opSale.state, {
    saleDate: '2026-11-10',
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 45 }],
    customerName: 'Carlos Mendoza',
    seller: 'Sin Asignar',
    paymentStatus: 'Pendiente',
    paidAmount: 20,
    clientOperationId: 'sale-op-abc',
  });
  assert.equal(dupSale.ok, false);
  assert.equal(dupSale.state.sales.length, opSale.state.sales.length);

  // Partial CxC abono ($10 of $25 pending) updates cashOnHand, receivable, and linked sale.paidAmount
  const abono1 = collectReceivable(
    opSale.state,
    cxc.id,
    'Zelle',
    10,
    'cxc-op-1',
  );
  assert.equal(abono1.ok, true);
  assert.equal(abono1.state.cashOnHand, round2(cashStart + 30));
  assert.equal(abono1.state.receivables[0].amount, 15);
  assert.equal(abono1.state.receivables[0].paidAmount, 30);
  assert.equal(abono1.state.sales[0].paidAmount, 30);
  assert.equal(abono1.state.sales[0].paymentStatus, 'Pendiente');

  // Duplicate CxC abono clientOperationId must be rejected
  const dupAbono = collectReceivable(
    abono1.state,
    cxc.id,
    'Zelle',
    10,
    'cxc-op-1',
  );
  assert.equal(dupAbono.ok, false);
  assert.equal(dupAbono.state.receivables[0].amount, 15);

  // Liquidate remaining $15 -> marks sale Cobrado
  const abono2 = collectReceivable(
    abono1.state,
    cxc.id,
    'Efectivo ($)',
    15,
    'cxc-op-2',
  );
  assert.equal(abono2.ok, true);
  assert.equal(abono2.state.receivables.some((r) => r.id === cxc.id), false);
  assert.equal(abono2.state.receivables.length, opSale.state.receivables.length - 1);
  assert.equal(abono2.state.sales[0].paidAmount, 45);
  assert.equal(abono2.state.sales[0].paymentStatus, 'Cobrado');

  // Multi-criteria search matches invoice #, model, player alias, price, customer, seller
  const recordedSale = abono2.state.sales[0];
  assert.equal(doesSaleMatchSearchQuery(recordedSale, '#0010'), true);
  assert.equal(doesSaleMatchSearchQuery(recordedSale, '10'), true);
  assert.equal(doesSaleMatchSearchQuery(recordedSale, 'Carlos'), true);
  assert.equal(doesSaleMatchSearchQuery(recordedSale, '45'), true);
  assert.equal(doesSaleMatchSearchQuery(recordedSale, 'yamal'), true);
  assert.equal(doesSaleMatchSearchQuery(recordedSale, 'Sin Asignar'), true);
  assert.equal(doesSaleMatchSearchQuery(recordedSale, 'Mbappe'), false);
});

test('Auditoría y Conteos calculates the 6 exact indicators (cant & %) and detects size crosses', () => {
  const seed = createDemoSeedState();
  const item1 = seed.inventory[0]; // stock e.g. 10
  const item2 = seed.inventory[1]; // stock e.g. 10
  const item3 = seed.inventory[2]; // stock e.g. 12

  // 1. Partial count scenario: item1 reconciled, item2 discrepancy (+1), item3 not counted
  const counts: Record<string, number | null> = {
    [item1.id]: item1.stock,
    [item2.id]: item2.stock + 1,
    [item3.id]: null,
  };

  const metrics = calculateAuditMetrics([item1, item2, item3], counts);
  assert.equal(metrics.totalItems, 3);
  assert.equal(metrics.reconciledItems, 1);
  assert.equal(metrics.reconciledItemsPct, 33.33);
  assert.equal(metrics.unreconciledItems, 1);
  assert.equal(metrics.unreconciledItemsPct, 33.33);
  assert.equal(metrics.uncountedItems, 1);
  assert.equal(metrics.uncountedItemsPct, 33.33);

  const totalUnits = item1.stock + item2.stock + item3.stock;
  assert.equal(metrics.totalSystemUnits, totalUnits);
  assert.equal(metrics.reconciledUnits, item1.stock);
  assert.equal(metrics.unreconciledUnits, item2.stock);
  assert.equal(metrics.uncountedUnits, item3.stock);

  // 2. Cross detection: same model & version with +1 on M and -1 on L
  const testInventory = [
    {
      ...item1,
      id: 'rm-m',
      model: 'Real Madrid Local 26/27',
      version: 'Player' as const,
      size: 'M',
      stock: 5,
    },
    {
      ...item1,
      id: 'rm-l',
      model: 'Real Madrid Local 26/27',
      version: 'Player' as const,
      size: 'L',
      stock: 3,
    },
  ];

  const crossCounts: Record<string, number> = {
    'rm-m': 6, // +1 surplus
    'rm-l': 2, // -1 shortage
  };

  const crosses = detectSizeDiscrepancyCrosses(testInventory, crossCounts);
  assert.equal(crosses.length, 1);
  assert.equal(crosses[0].model, 'Real Madrid Local 26/27');
  assert.equal(crosses[0].surplusSize, 'M');
  assert.equal(crosses[0].surplusDelta, 1);
  assert.equal(crosses[0].shortageSize, 'L');
  assert.equal(crosses[0].shortageDelta, -1);
  assert.equal(crosses[0].uncrossQuantity, 1);
});

test('Ajustes de Inventario enforces mandatory reasons, supports entrada/salida and atomic descruce', () => {
  let state = createDemoSeedState();
  const targetSku = state.inventory[0];
  const stockBefore = targetSku.stock;

  // 1. Reason is strictly mandatory
  const missingReason = registerManualInventoryAdjustment(state, {
    type: 'entrada',
    skuId: targetSku.id,
    quantity: 2,
    reason: '   ',
  });
  assert.equal(missingReason.ok, false);

  // 2. Entrada manual (+2 units)
  const entrada = registerManualInventoryAdjustment(state, {
    type: 'entrada',
    skuId: targetSku.id,
    quantity: 2,
    reason: 'Error de ingreso previo',
  });
  assert.equal(entrada.ok, true);
  state = entrada.state;
  const targetAfterEntrada = state.inventory.find((i) => i.id === targetSku.id);
  assert.equal(targetAfterEntrada?.stock, stockBefore + 2);
  assert.equal(state.inventoryAdjustments[0].adjustmentType, 'entrada');
  assert.equal(state.inventoryAdjustments[0].delta, 2);
  assert.equal(state.inventoryAdjustments[0].reason, 'Error de ingreso previo');

  // 3. Salida manual (-1 unit) with FIFO consumption
  const salida = registerManualInventoryAdjustment(state, {
    type: 'salida',
    skuId: targetSku.id,
    quantity: 1,
    reason: 'Daño/Merma en exhibición',
  });
  assert.equal(salida.ok, true);
  state = salida.state;
  const targetAfterSalida = state.inventory.find((i) => i.id === targetSku.id);
  assert.equal(targetAfterSalida?.stock, stockBefore + 1);
  assert.equal(state.inventoryAdjustments[0].adjustmentType, 'salida');
  assert.equal(state.inventoryAdjustments[0].delta, -1);

  // 4. Salida rejects overdraft
  const overSalida = registerManualInventoryAdjustment(state, {
    type: 'salida',
    skuId: targetSku.id,
    quantity: 9999,
    reason: 'Error',
  });
  assert.equal(overSalida.ok, false);

  // 5. Descruce de mercancía atómico (deduct from source, add to target)
  const sourceSku = state.inventory[0];
  const destSku = state.inventory[1];
  const sourceStockBefore = sourceSku.stock;
  const destStockBefore = destSku.stock;
  const totalUnitsBefore = getTotalUnits(state);

  const uncrossRes = performInventoryUncross(state, {
    sourceSkuId: sourceSku.id,
    targetSkuId: destSku.id,
    quantity: 1,
    reason: 'Descruce de tallas M y L',
  });
  assert.equal(uncrossRes.ok, true);
  state = uncrossRes.state;

  const sourceAfter = state.inventory.find((i) => i.id === sourceSku.id);
  const destAfter = state.inventory.find((i) => i.id === destSku.id);
  assert.equal(sourceAfter?.stock, sourceStockBefore - 1);
  assert.equal(destAfter?.stock, destStockBefore + 1);
  assert.equal(getTotalUnits(state), totalUnitsBefore); // Total inventory units preserved

  const adjRecord = state.inventoryAdjustments[0];
  assert.equal(adjRecord.adjustmentType, 'descruce');
  assert.equal(adjRecord.targetSkuId, destSku.id);
  assert.equal(adjRecord.reason, 'Descruce de tallas M y L');

  // 6. Progressive save & close audit session
  const saveDraft = saveAuditProgress(state, { [sourceSku.id]: 5 }, 'Avance turno mañana');
  assert.equal(saveDraft.ok, true);
  assert.equal(saveDraft.state.activeAuditSession?.status, 'draft');
  assert.equal(saveDraft.state.activeAuditSession?.notes, 'Avance turno mañana');

  const closeAudit = closeAuditSession(saveDraft.state, { [sourceSku.id]: 5 }, false);
  assert.equal(closeAudit.ok, true);
  assert.equal(closeAudit.state.activeAuditSession?.status, 'closed');
  assert.ok(closeAudit.state.activeAuditSession?.summary);
  assert.equal(closeAudit.state.auditHistory?.length, 1);

  // Start new audit
  const newAudit = startNewAuditSession(closeAudit.state);
  assert.equal(newAudit.ok, true);
  assert.equal(newAudit.state.activeAuditSession?.status, 'draft');
  assert.deepEqual(newAudit.state.activeAuditSession?.counts, {});
});

test('credit sales and collectReceivable allocate 4-layer funds strictly proportional to physical cash collected', () => {
  let state = createDemoSeedState();
  // Zero out cashOnHand first via arqueo so funds === cashOnHand invariant is easy to check exactly
  state = reconcileCashOnHand(state, { countedCash: 0, reason: 'Base cero test' }).state;
  assert.equal(getTotalAllocatedFunds(state.funds), 0);

  // Partial credit sale: total $30.00, paidAtSale $10.00
  const saleRes = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 30 }],
    customerName: 'Cliente Abono',
    seller: 'Jesús',
    paymentStatus: 'Pendiente',
    paidAmount: 10,
  });
  assert.equal(saleRes.ok, true);
  state = saleRes.state;
  assert.equal(state.cashOnHand, 10);
  assert.equal(getTotalAllocatedFunds(state.funds), 10);

  const rec = state.receivables[0];
  assert.ok(rec);
  assert.equal(rec.amount, 20);

  // Collect remaining $20.00 -> funds match full $30.00 breakdown exactly
  const colRes = collectReceivable(state, rec.id, 'Binance USDT', 20);
  assert.equal(colRes.ok, true);
  state = colRes.state;
  assert.equal(state.cashOnHand, 30);
  assert.equal(getTotalAllocatedFunds(state.funds), 30);
  assert.equal(state.funds.replacement, 6.5);
  assert.equal(state.funds.commissions, 1.2);
});

test('withdrawPartnerDividends enforces Vital Reserve Lock and arqueo downward keeps funds <= cashOnHand', () => {
  let state = createDemoSeedState();
  // Cash starts at $135.19 (< $150 default vital reserve). Sell $10.00? Still < $150 ($145.19)
  const smallSale = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 10 }],
    customerName: 'Cliente Reserva',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  assert.equal(smallSale.ok, true);
  state = smallSale.state;
  assert.equal(state.cashOnHand, 145.19);
  assert.ok(state.funds.dividendsByPartner.Jesús > 0);

  // Below $150 Vital Reserve -> withdrawal MUST be blocked
  const blocked = withdrawPartnerDividends(state, 'Jesús', 150);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error ?? '', /Mínimo Vital de Reserva/);

  // Raise cash above $150 via second sale -> withdrawal succeeds
  const secondSale = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 30 }],
    customerName: 'Cliente Reserva 2',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  state = secondSale.state;
  assert.ok(state.cashOnHand >= 150);

  const jesusBefore = state.funds.dividendsByPartner.Jesús;
  const cashBefore = state.cashOnHand;
  const withdrawOk = withdrawPartnerDividends(state, 'Jesús', 150);
  assert.equal(withdrawOk.ok, true);
  state = withdrawOk.state;
  assert.equal(state.funds.dividendsByPartner.Jesús, 0);
  assert.equal(state.cashOnHand, round2(cashBefore - jesusBefore));
  assert.equal(state.movements[0].type, 'dividend_withdrawal');

  // Downward arqueo below total allocated funds preserves funds <= cashOnHand without touching sales or inventory
  const salesCountBefore = state.sales.length;
  const unitsBefore = getTotalUnits(state);
  const cogsBefore = getTotalInventoryCostValue(state);

  const syncRes = syncUnassignedCashToGrowthFund(state);
  assert.equal(syncRes.ok, true);
  state = syncRes.state;
  assert.equal(getTotalAllocatedFunds(state.funds), state.cashOnHand);

  const arqueoDown = reconcileCashOnHand(state, {
    countedCash: 25,
    reason: 'Arqueo físico de cierre',
  });
  assert.equal(arqueoDown.ok, true);
  state = arqueoDown.state;
  assert.equal(state.cashOnHand, 25);
  assert.equal(getTotalAllocatedFunds(state.funds), 25);
  assert.equal(state.sales.length, salesCountBefore);
  assert.equal(getTotalUnits(state), unitsBefore);
  assert.equal(getTotalInventoryCostValue(state), cogsBefore);
});

test('detectExpenseCategoryFromDescription and registerOperatingExpense overdraft proration preserve exact cash equality', () => {
  for (const kw of ['bolsa', 'bolsas', 'empaque', 'etiqueta', 'flete', 'delivery', 'envío']) {
    const detected = detectExpenseCategoryFromDescription(`Compra de ${kw} para pedidos`);
    assert.ok(detected, `Expected detection for keyword ${kw}`);
    assert.equal(detected.category, 'Logística/Producción');
  }
  assert.equal(detectExpenseCategoryFromDescription('Campaña Meta Ads'), null);

  let state = createDemoSeedState();
  state = reconcileCashOnHand(state, { countedCash: 0 }).state;
  state = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 2, unitPrice: 30 }],
    customerName: 'Cliente Exacto',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  }).state;
  assert.equal(state.cashOnHand, 60);
  assert.equal(getTotalAllocatedFunds(state.funds), 60);

  // Spend $20 from operatingFund (only has ~$4.46) -> operatingFund drops to $0.00 and excess prorates across remaining funds
  const expRes = registerOperatingExpense(state, {
    concept: 'Compra de bolsas y etiquetas',
    category: 'Logística/Producción',
    amount: 20,
    source: 'operatingFund',
    paymentMethod: 'Efectivo ($)',
  });
  assert.equal(expRes.ok, true);
  state = expRes.state;
  assert.equal(state.funds.operatingAndAds, 0);
  assert.equal(state.cashOnHand, 40);
  assert.equal(getTotalAllocatedFunds(state.funds), 40);

  // Config normalization keeps vitalReserveMinUsd, airRotationSharePct, maritimeGoalUsd defaults and bounds
  const cfg = normalizeGeneralConfig({
    matrixParams: {
      vitalReserveMinUsd: 250,
      airRotationSharePct: 40,
      maritimeGoalUsd: 1800,
    },
  });
  assert.equal(cfg.matrixParams.vitalReserveMinUsd, 250);
  assert.equal(cfg.matrixParams.airRotationSharePct, 40);
  assert.equal(cfg.matrixParams.maritimeGoalUsd, 1800);
  assert.equal(DEFAULT_GENERAL_CONFIG.matrixParams.maritimeGoalUsd, 1500);
});

test('deductWithRepoReinvestmentBridge cascades primary -> sibling -> proportional other funds', () => {
  const baseFunds = {
    replacement: 40,
    commissions: 10,
    commissionsBySeller: { Jesús: 6, Josué: 4, Gabriel: 0 },
    operatingAndAds: 20,
    growthReinvestment: 30,
    dividendsByPartner: { Jesús: 12, Josué: 6, Gabriel: 2 },
    reinvestedFromDividendsTotal: 0,
  };
  // Total = 40 + 10 + 20 + 30 + 20 = 120

  // 1. Covered completely by primary ('replacement')
  const step1 = deductWithRepoReinvestmentBridge(baseFunds, 'replacement', 25);
  assert.equal(step1.replacement, 15);
  assert.equal(step1.growthReinvestment, 30);
  assert.equal(getTotalAllocatedFunds(step1), 95);

  // 2. Exceeds primary ('replacement' = 40) -> pulls $15 from sibling ('growthReinvestment' = 30 -> 15)
  const step2 = deductWithRepoReinvestmentBridge(baseFunds, 'replacement', 55);
  assert.equal(step2.replacement, 0);
  assert.equal(step2.growthReinvestment, 15);
  assert.equal(step2.operatingAndAds, 20);
  assert.equal(getTotalAllocatedFunds(step2), 65);

  // 3. Exceeds both ('growthReinvestment' = 30 -> 0, 'replacement' = 40 -> 0) + $20 prorated across remaining $50 funds
  const step3 = deductWithRepoReinvestmentBridge(baseFunds, 'growthReinvestment', 90);
  assert.equal(step3.growthReinvestment, 0);
  assert.equal(step3.replacement, 0);
  assert.equal(getTotalAllocatedFunds(step3), 30);
  assert.ok(step3.operatingAndAds < 20);
  assert.ok(step3.commissions < 10);
});

test('createImportOrder, receiveImportBatch, and registerOperatingExpense apply Repo<->Reinvestment bridge without rejecting when cashOnHand suffices', () => {
  let state = createDemoSeedState();
  state = reconcileCashOnHand(state, { countedCash: 0 }).state;
  // Sell 2x $30 ($60 cash: replacement=$13.00, comm=$2.40, op=$4.46, growth=$32.11, divs=$8.03)
  state = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 2, unitPrice: 30 }],
    customerName: 'Cliente Puente',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  }).state;
  assert.equal(state.cashOnHand, 60);
  assert.equal(getTotalAllocatedFunds(state.funds), 60);
  assert.equal(state.funds.replacement, 13.0);

  // Create import order of $40 funded by 'replacement' (only $13.00 in replacement -> pulls $27.00 from growthReinvestment)
  const orderRes = createImportOrder(state, {
    entryDate: '2026-11-18',
    referenceName: 'Reposición Puente',
    shippingType: 'Aéreo',
    totalFreightCost: 4,
    fundingSource: 'replacement',
    items: [
      {
        team: 'Barcelona',
        model: 'Barcelona Local 25/26',
        version: 'Player',
        size: 'M',
        quantity: 6,
        factoryUnitCost: 6.0,
      },
    ],
  });
  assert.equal(orderRes.ok, true);
  state = orderRes.state;
  assert.equal(state.cashOnHand, 20);
  assert.equal(state.funds.replacement, 0);
  assert.equal(state.funds.growthReinvestment, round2(32.11 - 27.0)); // 5.11 left
  assert.equal(getTotalAllocatedFunds(state.funds), 20);

  // Receive batch with actual freight $12 (freightDiff = +$8 > growthReinvestment $5.11 -> drains growth to $0 and prorates $2.89 across remaining funds)
  const recvRes = receiveImportBatch(state, {
    batchId: state.purchaseBatches[0].id,
    receivedDate: '2026-11-19',
    actualFreightCost: 12,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 6 }],
  });
  assert.equal(recvRes.ok, true);
  state = recvRes.state;
  assert.equal(state.cashOnHand, 12);
  assert.equal(state.funds.replacement, 0);
  assert.equal(state.funds.growthReinvestment, 0);
  assert.equal(getTotalAllocatedFunds(state.funds), 12);

  // Now test registerOperatingExpense with 'replacement' bridging into 'growthReinvestment'
  let expState = createDemoSeedState();
  expState = reconcileCashOnHand(expState, { countedCash: 0 }).state;
  expState = registerMultiItemSale(expState, {
    items: [{ skuId: 'sku-fcb-1', quantity: 2, unitPrice: 30 }],
    customerName: 'Cliente Gasto',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  }).state;
  const expRes = registerOperatingExpense(expState, {
    concept: 'Compra insumos desde reposición',
    category: 'Logística/Producción',
    amount: 20, // replacement has $13 -> $7 bridged from growthReinvestment ($32.11 -> $25.11)
    source: 'replacement',
    paymentMethod: 'Efectivo ($)',
  });
  assert.equal(expRes.ok, true);
  assert.equal(expRes.state.cashOnHand, 40);
  assert.equal(expRes.state.funds.replacement, 0);
  assert.equal(expRes.state.funds.growthReinvestment, round2(32.11 - 7));
  assert.equal(getTotalAllocatedFunds(expRes.state.funds), 40);
});

test('processReturnOrExchange reverses linkedSale breakdown on cash refunds, distributes upgrade surplus via 4-layer matrix, and updates paidAmount/returnStatus on multi-item partial returns', () => {
  // 1. Linked cash sale refund (-differenceUsd) reverses funds proportionally even when unassigned cash exists in cashOnHand
  let state = createDemoSeedState(); // cashOnHand = 135.19 unassigned, funds = 0
  const saleCash = registerMultiItemSale(state, {
    items: [
      { skuId: 'sku-fcb-1', quantity: 1, unitPrice: 35 },
      { skuId: 'sku-fcb-3', quantity: 1, unitPrice: 25 },
    ],
    customerName: 'Cliente Reembolso',
    seller: 'Josué',
    paymentStatus: 'Cobrado',
  });
  assert.equal(saleCash.ok, true);
  state = saleCash.state;
  const linked = saleCash.createdSale!;
  const fundsAfterSale = { ...state.funds };
  assert.equal(getTotalAllocatedFunds(state.funds), 60);

  // Return 1 item ($25) out of $60 -> reverses 25/60 of linked.breakdown in state.funds
  const partialRefund = processReturnOrExchange(state, {
    type: 'Devolución',
    saleId: linked.id,
    invoiceNumber: linked.invoiceNumber,
    returnedSkuId: 'sku-fcb-3',
    returnedQuantity: 1,
    returnedUnitPrice: 25,
    paymentMethod: 'Efectivo ($)',
    reason: 'Devolución parcial',
  });
  assert.equal(partialRefund.ok, true);
  state = partialRefund.state;

  const expectedReversed = scaleBreakdownToCashAmount(linked.breakdown, 25);
  assert.equal(state.cashOnHand, round2(135.19 + 60 - 25));
  assert.equal(getTotalAllocatedFunds(state.funds), 35);
  assert.equal(
    state.funds.replacement,
    round2(fundsAfterSale.replacement - expectedReversed.layer1CostRecovery),
  );
  assert.equal(
    state.funds.commissionsBySeller.Josué,
    round2(fundsAfterSale.commissionsBySeller.Josué - expectedReversed.layer2Commission),
  );
  assert.equal(
    state.funds.operatingAndAds,
    round2(fundsAfterSale.operatingAndAds - expectedReversed.layer3OperatingFund),
  );
  assert.equal(
    state.funds.growthReinvestment,
    round2(fundsAfterSale.growthReinvestment - expectedReversed.layer4GrowthReinvestment),
  );
  assert.equal(
    state.funds.dividendsByPartner.Jesús,
    round2(fundsAfterSale.dividendsByPartner.Jesús - expectedReversed.partnerSplits.Jesús),
  );

  // Even if a fund bucket was spent down, reversing never produces negative fund balances
  state = {
    ...state,
    funds: {
      ...state.funds,
      operatingAndAds: 0,
      commissions: round2(state.funds.commissions - state.funds.commissionsBySeller.Josué),
      commissionsBySeller: { ...state.funds.commissionsBySeller, Josué: 0 },
    },
  };
  const restRefund = processReturnOrExchange(state, {
    type: 'Devolución',
    saleId: linked.id,
    invoiceNumber: linked.invoiceNumber,
    returnedSkuId: 'sku-fcb-1',
    returnedQuantity: 1,
    returnedUnitPrice: 35,
    paymentMethod: 'Efectivo ($)',
    reason: 'Devolución resto',
  });
  assert.equal(restRefund.ok, true);
  assert.ok(restRefund.state.funds.operatingAndAds >= 0);
  assert.ok(restRefund.state.funds.commissions >= 0);
  assert.ok(restRefund.state.funds.commissionsBySeller.Josué >= 0);
  assert.ok(restRefund.state.funds.replacement >= 0);
  assert.ok(restRefund.state.funds.growthReinvestment >= 0);
  assert.ok(restRefund.state.funds.dividendsByPartner.Jesús >= 0);
  assert.equal(getCashBackedFundsSummary(restRefund.state).isStrictlyCashBacked, true);

  // 2. Exchange upgrade (+differenceUsd) distributes differential price & FIFO cost via 4-layer matrix
  let upState = createDemoSeedState();
  upState = reconcileCashOnHand(upState, { countedCash: 0 }).state;
  const baseSale = registerMultiItemSale(upState, {
    items: [{ skuId: 'sku-fcb-3', quantity: 1, unitPrice: 25 }],
    customerName: 'Cliente Upgrade',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  });
  upState = baseSale.state;
  const fansSku = upState.inventory.find((i) => i.id === 'sku-fcb-3')!;
  const playerSku = upState.inventory.find((i) => i.id === 'sku-fcb-1')!;
  const expectedDiffMatrix = calculateFourLayerMatrixConsolidated(
    10,
    round2(Math.max(0, playerSku.cogs - fansSku.cogs)),
    'Jesús',
  );
  const fundsBeforeUpgrade = { ...upState.funds };

  const upgradeRes = processReturnOrExchange(upState, {
    type: 'Cambio',
    saleId: baseSale.createdSale!.id,
    returnedSkuId: 'sku-fcb-3',
    returnedQuantity: 1,
    returnedUnitPrice: 25,
    replacementSkuId: 'sku-fcb-1',
    replacementQuantity: 1,
    replacementUnitPrice: 35,
    reason: 'Upgrade Player +$10',
  });
  assert.equal(upgradeRes.ok, true);
  upState = upgradeRes.state;
  assert.equal(upState.cashOnHand, 35);
  assert.equal(getTotalAllocatedFunds(upState.funds), 35);
  assert.equal(
    upState.funds.replacement,
    round2(fundsBeforeUpgrade.replacement + expectedDiffMatrix.layer1CostRecovery),
  );
  assert.equal(
    upState.funds.commissionsBySeller.Jesús,
    round2(fundsBeforeUpgrade.commissionsBySeller.Jesús + expectedDiffMatrix.layer2Commission),
  );
  assert.equal(
    upState.funds.operatingAndAds,
    round2(fundsBeforeUpgrade.operatingAndAds + expectedDiffMatrix.layer3OperatingFund),
  );
  assert.equal(
    upState.funds.growthReinvestment,
    round2(fundsBeforeUpgrade.growthReinvestment + expectedDiffMatrix.layer4GrowthReinvestment),
  );

  // 3. Partial return on multi-item credit sale reduces CxC to $0 while leaving active item
  let creditState = createDemoSeedState();
  const multiCredit = registerMultiItemSale(creditState, {
    items: [
      { skuId: 'sku-fcb-1', quantity: 1, unitPrice: 30 },
      { skuId: 'sku-fcb-3', quantity: 1, unitPrice: 30 },
    ],
    customerName: 'Cliente Multi Crédito',
    seller: 'Jesús',
    paymentStatus: 'Pendiente',
    paidAmount: 40, // $40 pagado, $20 pendiente en CxC
  });
  assert.equal(multiCredit.ok, true);
  creditState = multiCredit.state;
  const creditSale = multiCredit.createdSale!;
  const collectedCountBefore = creditState.collectedReceivablesCount;
  const cashBeforeCreditRet = creditState.cashOnHand;

  // Return 1 garment ($30): $20 cancels CxC to $0, $10 refunded in cash, 1 garment still active!
  const partialCreditRet = processReturnOrExchange(creditState, {
    type: 'Devolución',
    saleId: creditSale.id,
    invoiceNumber: creditSale.invoiceNumber,
    returnedSkuId: 'sku-fcb-3',
    returnedQuantity: 1,
    returnedUnitPrice: 30,
    reason: 'Devolución 1 prenda de venta multi-ítem',
  });
  assert.equal(partialCreditRet.ok, true);
  creditState = partialCreditRet.state;

  // Receivable liquidated to $0 and removed, cash decreased by $10, collectedCount not inflated by return
  assert.equal(
    creditState.receivables.some((r) => r.saleId === creditSale.id),
    false,
  );
  assert.equal(creditState.cashOnHand, round2(cashBeforeCreditRet - 10));
  assert.equal(creditState.collectedReceivablesCount, collectedCountBefore);

  // SaleRecord tracks returnedAmount ($30), returnStatus ('Parcial'), and net paidAmount ($30 = 40 - 10)
  const updatedCreditSale = creditState.sales.find((s) => s.id === creditSale.id)!;
  assert.equal(updatedCreditSale.paidAmount, 30);
  assert.equal(updatedCreditSale.returnedAmount, 30);
  assert.equal(updatedCreditSale.returnStatus, 'Parcial');
  assert.equal(updatedCreditSale.paymentStatus, 'Cobrado');
});

test('receiveImportBatch prorates factory shortage across arrived units without refunding cashOnHand or funds', () => {
  let state = createDemoSeedState();
  state = reconcileCashOnHand(state, { countedCash: 0 }).state;
  state = registerMultiItemSale(state, {
    items: [
      { skuId: 'sku-fcb-1', quantity: 3, unitPrice: 30 },
      { skuId: 'sku-fcb-3', quantity: 2, unitPrice: 25 },
    ],
    customerName: 'Fondeo Reposición',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
  }).state;
  // Seed replacement fund with enough liquidity via sale -> replacement has ~$30
  const repoBefore = state.funds.replacement;
  const cashBefore = state.cashOnHand;

  // Order 4 units @ $6.00 factory ($24) + $6.00 freight = $30.00 funded from 'replacement'
  const orderRes = createImportOrder(state, {
    entryDate: '2026-11-15',
    referenceName: 'Lote Faltante Fábrica',
    shippingType: 'Aéreo',
    totalFreightCost: 6,
    fundingSource: 'replacement',
    items: [
      {
        team: 'Barcelona',
        model: 'Barcelona Local 25/26',
        version: 'Player',
        size: 'M',
        quantity: 4,
        factoryUnitCost: 6,
      },
    ],
  });
  assert.equal(orderRes.ok, true);
  state = orderRes.state;
  assert.equal(state.cashOnHand, round2(cashBefore - 30));
  assert.equal(state.funds.replacement, round2(repoBefore - 30));

  // Factory only shipped 3 units (1 unit @ $6.00 missing -> +$2.00/ud shortage), freight remained $6.00 (+$2.00/ud)
  const recvRes = receiveImportBatch(state, {
    batchId: orderRes.createdBatch!.id,
    receivedDate: '2026-11-20',
    actualFreightCost: 6,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 3 }],
  });
  assert.equal(recvRes.ok, true);
  state = recvRes.state;

  // $6.00 factory shortage is NOT refunded to cashOnHand or replacement fund (freightDiff = $0.00)
  assert.equal(state.cashOnHand, round2(cashBefore - 30));
  assert.equal(state.funds.replacement, round2(repoBefore - 30));
  assert.equal(recvRes.createdBatch?.totalFactoryCost, 24);
  assert.equal(recvRes.createdBatch?.totalLandedCost, 30);
  assert.equal(recvRes.createdBatch?.totalUnits, 3);
  assert.equal(recvRes.createdBatch?.items[0].landedUnitCost, 10);
  const fcbSku = state.inventory.find((i) => i.id === 'sku-fcb-1');
  const addedFifo = fcbSku?.fifoBatches.find(
    (b) => b.batchId === `${orderRes.createdBatch!.id}-line-0`,
  );
  assert.equal(addedFifo?.unitCost, 10);
  assert.equal(state.movements[0].amount, 0);
  assert.ok(
    state.movements[0].description.includes('faltante fábrica $6.00 prorrateado (+$2.00/ud)'),
  );

  // Also verify exact numerical example: 30 units @ $10.00 ($300) + $60 freight, 25 arrive -> $14.40/ud FIFO
  state = registerCapitalInjection(state, {
    contributor: 'Jesús',
    concept: 'Fondeo lote grande',
    amount: 400,
    paymentMethod: 'Binance USDT',
    destination: 'cashOnly',
  }).state;
  const cashBeforeBig = state.cashOnHand;
  const orderBig = createImportOrder(state, {
    entryDate: '2026-11-21',
    referenceName: 'Lote China 30uds',
    shippingType: 'Marítimo',
    totalFreightCost: 60,
    fundingSource: 'cashOnHand',
    items: [
      {
        team: 'Real Madrid',
        model: 'Real Madrid Local 26/27 Test',
        version: 'Player',
        size: 'M',
        quantity: 30,
        factoryUnitCost: 10,
      },
    ],
  });
  assert.equal(orderBig.ok, true);
  state = orderBig.state;
  assert.equal(state.cashOnHand, round2(cashBeforeBig - 360));

  const recvBig = receiveImportBatch(state, {
    batchId: orderBig.createdBatch!.id,
    receivedDate: '2026-11-22',
    actualFreightCost: 60,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 25 }],
  });
  assert.equal(recvBig.ok, true);
  state = recvBig.state;

  // $0 freight diff -> cashOnHand untouched at -360
  assert.equal(state.cashOnHand, round2(cashBeforeBig - 360));
  assert.equal(recvBig.createdBatch?.totalFactoryCost, 300);
  assert.equal(recvBig.createdBatch?.totalLandedCost, 360);
  assert.equal(recvBig.createdBatch?.freightPerUnit, 2.4);
  assert.equal(recvBig.createdBatch?.items[0].landedUnitCost, 14.4);
  const rmSku = state.inventory.find(
    (i) => i.model === 'Real Madrid Local 26/27 Test',
  );
  assert.equal(rmSku?.stock, 25);
  assert.equal(rmSku?.cogs, 14.4);
  assert.equal(rmSku?.fifoBatches[0].unitCost, 14.4);
  assert.equal(state.movements[0].amount, 0);
  assert.ok(
    state.movements[0].description.includes('faltante fábrica $50.00 prorrateado (+$2.00/ud)'),
  );
});

test('finance operations record explicit actorName without depending on stored browser user', () => {
  let state = createDemoSeedState();

  const saleRes = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-fcb-1', quantity: 1, unitPrice: 30 }],
    customerName: 'Cliente Actor',
    seller: 'Josué',
    paymentStatus: 'Cobrado',
    actorName: 'Josué Daniel',
  });
  assert.equal(saleRes.ok, true);
  assert.equal(saleRes.createdSale?.userName, 'Josué Daniel');
  state = saleRes.state;

  const orderRes = createImportOrder(state, {
    entryDate: '2026-11-20',
    referenceName: 'Lote Actor',
    shippingType: 'Aéreo',
    totalFreightCost: 4,
    actorName: 'Gabriel',
    items: [
      {
        team: 'Real Madrid',
        model: 'Real Madrid Local 26/27',
        version: 'Fans',
        size: 'M',
        quantity: 2,
        factoryUnitCost: 5,
      },
    ],
  });
  assert.equal(orderRes.ok, true);
  assert.equal(orderRes.createdBatch?.userName, 'Gabriel');
  state = orderRes.state;

  const manualRes = registerManualInventoryAdjustment(state, {
    type: 'entrada',
    skuId: 'sku-fcb-1',
    quantity: 1,
    reason: 'Conteo explícito',
    actorName: 'Josué Daniel',
  });
  assert.equal(manualRes.ok, true);
  assert.equal(manualRes.state.inventoryAdjustments[0].userName, 'Josué Daniel');
  state = manualRes.state;

  const physicalRes = adjustInventoryPhysicalCount(state, {
    skuId: 'sku-fcb-1',
    newStock: state.inventory.find((i) => i.id === 'sku-fcb-1')!.stock + 1,
    reason: 'Auditoría directa',
    actorName: 'Gabriel',
  });
  assert.equal(physicalRes.ok, true);
  assert.equal(physicalRes.state.inventoryAdjustments[0].userName, 'Gabriel');
  state = physicalRes.state;

  const uncrossRes = performInventoryUncross(state, {
    sourceSkuId: 'sku-fcb-1',
    targetSkuId: 'sku-fcb-3',
    quantity: 1,
    reason: 'Descruce con actor explícito',
    actorName: 'Josué Daniel',
  });
  assert.equal(uncrossRes.ok, true);
  assert.equal(uncrossRes.state.inventoryAdjustments[0].userName, 'Josué Daniel');
  state = uncrossRes.state;

  const auditRes = closeAuditSession(
    state,
    { 'sku-fcb-1': 1 },
    false,
    'Cierre auditado',
    'Gabriel',
  );
  assert.equal(auditRes.ok, true);
  assert.equal(auditRes.state.activeAuditSession?.closedBy, 'Gabriel');
});

test('Manual inventory entry honors custom unitCost and uncross preserves draft audit physical counts', () => {
  let state = createDemoSeedState();
  const skuA = state.inventory[0];
  const skuB = state.inventory[1];

  const customEntry = registerManualInventoryAdjustment(state, {
    type: 'entrada',
    skuId: skuA.id,
    quantity: 3,
    reason: 'Lote especial proveedor',
    unitCost: 11.25,
  });
  assert.equal(customEntry.ok, true);
  state = customEntry.state;

  const updatedSkuA = state.inventory.find((i) => i.id === skuA.id)!;
  const latestBatch = updatedSkuA.fifoBatches?.[updatedSkuA.fifoBatches.length - 1];
  assert.equal(latestBatch?.unitCost, 11.25);
  assert.equal(latestBatch?.remainingQuantity, 3);

  // Start a draft audit with physical counts showing a 1-unit cross between skuA (shortage) and skuB (surplus)
  const expectedCountA = updatedSkuA.stock - 1;
  const expectedCountB = skuB.stock + 1;
  const savedDraft = saveAuditProgress(
    state,
    {
      [skuA.id]: expectedCountA,
      [skuB.id]: expectedCountB,
    },
    'Conteo previo al descruce',
  );
  assert.equal(savedDraft.ok, true);
  state = savedDraft.state;

  const uncross = performInventoryUncross(state, {
    sourceSkuId: skuA.id,
    targetSkuId: skuB.id,
    quantity: 1,
    reason: 'Descruce 1-clic',
  });
  assert.equal(uncross.ok, true);

  const skuAAfter = uncross.state.inventory.find((i) => i.id === skuA.id)!;
  const skuBAfter = uncross.state.inventory.find((i) => i.id === skuB.id)!;
  assert.equal(skuAAfter.stock, expectedCountA);
  assert.equal(skuBAfter.stock, expectedCountB);
  // Physical counts stored in activeAuditSession must NOT be shifted away from reality
  assert.equal(uncross.state.activeAuditSession?.counts[skuA.id], expectedCountA);
  assert.equal(uncross.state.activeAuditSession?.counts[skuB.id], expectedCountB);
});
