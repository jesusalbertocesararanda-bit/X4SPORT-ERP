import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, SaleRecord } from '../types/erp';
import { createInitialState } from '../data/initialState';
import {
  classifyNetworkQuality,
  computeRttJitterMs,
} from '../hooks/useNetworkQuality';
import {
  buildNotificationBaseline,
  collectLiveNotificationEvents,
  createEmptyNotificationBaseline,
} from '../hooks/usePushNotifications';
import {
  formatVoucherSignedAmount,
  getVoucherFilename,
  isCxcVoucherPaidInFull,
  safeNonNegAmount,
} from '../components/VoucherReceiptModal';

test('classifyNetworkQuality cubre los 5 niveles visuales de color y estabilidad', () => {
  // Nivel 1: Excelente (Verde Esmeralda)
  const excellent = classifyNetworkQuality({
    isOnline: true,
    externalStatus: 'online',
    latencyMs: 65,
    jitterMs: 12,
    downlinkMbps: 25,
    effectiveType: '4g',
    consecutiveFailures: 0,
  });
  assert.equal(excellent.level, 'excellent');
  assert.ok(excellent.dotClassName.includes('bg-emerald-500'));

  // Nivel 2: Buena / Estable (Verde Lima) — ej. latencia 210ms o downlink 3 Mbps
  const good = classifyNetworkQuality({
    isOnline: true,
    externalStatus: 'online',
    latencyMs: 210,
    jitterMs: 30,
    downlinkMbps: 3.2,
    effectiveType: '4g',
    consecutiveFailures: 0,
  });
  assert.equal(good.level, 'good');
  assert.ok(good.dotClassName.includes('bg-lime-400'));

  // Nivel 3: Regular / Lenta (Amarillo Ámbar) — ej. 3G o latencia >= 350ms
  const fair = classifyNetworkQuality({
    isOnline: true,
    externalStatus: 'online',
    latencyMs: 420,
    jitterMs: 40,
    downlinkMbps: 1.2,
    effectiveType: '3g',
    consecutiveFailures: 0,
  });
  assert.equal(fair.level, 'fair');
  assert.ok(fair.dotClassName.includes('bg-amber-400'));

  // Nivel 4: Inestable / Crítica (Naranja Intenso con pulso) — 1 microcorte o latencia > 800ms / jitter > 250ms
  const unstable = classifyNetworkQuality({
    isOnline: true,
    externalStatus: 'online',
    latencyMs: 920,
    jitterMs: 280,
    downlinkMbps: 2,
    effectiveType: '4g',
    consecutiveFailures: 1,
  });
  assert.equal(unstable.level, 'unstable');
  assert.ok(unstable.dotClassName.includes('bg-orange-500'));
  assert.ok(unstable.dotClassName.includes('animate-pulse'));

  // Nivel 5: Sin Conexión / Offline (Rojo Carmesí) — navigator offline o >= 2 fallos seguidos
  const offlineByFailures = classifyNetworkQuality({
    isOnline: true,
    externalStatus: 'online',
    latencyMs: null,
    jitterMs: 0,
    downlinkMbps: null,
    effectiveType: null,
    consecutiveFailures: 2,
  });
  assert.equal(offlineByFailures.level, 'offline');
  assert.ok(offlineByFailures.dotClassName.includes('bg-red-500'));

  const offlineByBrowser = classifyNetworkQuality({
    isOnline: false,
    externalStatus: 'offline',
    latencyMs: 40,
    jitterMs: 0,
    downlinkMbps: 10,
    effectiveType: '4g',
    consecutiveFailures: 0,
  });
  assert.equal(offlineByBrowser.level, 'offline');
  assert.ok(offlineByBrowser.dotClassName.includes('bg-red-500'));
});

test('classifyNetworkQuality ignora downlinkMbps=0 desconocido y computeRttJitterMs calcula delta máximo', () => {
  const withZeroDownlink = classifyNetworkQuality({
    isOnline: true,
    externalStatus: 'online',
    latencyMs: 55,
    jitterMs: 10,
    downlinkMbps: 0,
    effectiveType: '4g',
    consecutiveFailures: 0,
  });
  assert.equal(withZeroDownlink.level, 'excellent');

  assert.equal(computeRttJitterMs([]), 0);
  assert.equal(computeRttJitterMs([80]), 0);
  assert.equal(computeRttJitterMs([80, 125, 95]), 45);
});

function makeSaleRecord(overrides: Partial<SaleRecord> & { id: string }): SaleRecord {
  return {
    invoiceNumber: '#0001',
    skuId: 'sku-1',
    modelLabel: 'Real Madrid Home',
    team: 'Real Madrid',
    version: 'Player',
    size: 'M',
    quantity: 1,
    unitCogs: 18,
    finalPrice: 35,
    customerName: 'Cliente Mostrador',
    seller: 'Jesús',
    paymentMethod: 'Efectivo ($)',
    paymentStatus: 'Cobrado',
    createdAt: '2026-11-01T10:00:00.000Z',
    breakdown: {
      grossRevenue: 35,
      layer1CostRecovery: 18,
      grossProfit: 17,
      layer2Commission: 1.75,
      netProfit: 15.25,
      layer3OperatingFund: 1.53,
      remainingNetProfit: 13.72,
      layer4GrowthReinvestment: 4.12,
      layer4TotalDividends: 9.6,
      partnerSplits: { Jesús: 3.2, Josué: 3.2, Gabriel: 3.2 },
    },
    ...overrides,
  };
}

test('usePushNotifications anti-spam: no dispara notificaciones históricas al inicializar ni en cargas masivas', () => {
  const baseState = createInitialState();
  baseState.sales = Array.from({ length: 8 }, (_, i) =>
    makeSaleRecord({
      id: `sale-hist-${i}`,
      invoiceNumber: `#000${i + 1}`,
    }),
  );
  baseState.inventory = [
    {
      id: 'sku-low-1',
      team: 'Barcelona',
      model: 'Barcelona Home',
      version: 'Fans',
      size: 'L',
      stock: 1,
      cogs: 14,
      salePrice: 30,
      fifoBatches: [],
    },
  ];

  // 1. Primera hidratación: debe inicializar baseline silenciosamente (0 eventos)
  const emptyBaseline = createEmptyNotificationBaseline();
  const initialTick = collectLiveNotificationEvents(emptyBaseline, baseState);
  assert.equal(initialTick.events.length, 0);
  assert.equal(initialTick.nextBaseline.initialized, true);
  assert.equal(initialTick.nextBaseline.saleIds.size, 8);

  // 2. Estado idéntico en siguiente tick: 0 eventos
  const repeatTick = collectLiveNotificationEvents(
    initialTick.nextBaseline,
    baseState,
  );
  assert.equal(repeatTick.events.length, 0);

  // 3. Carga masiva / restauración Excel con >3 ventas nuevas de golpe: suprimido (0 spam)
  const emptyInitialized = buildNotificationBaseline({
    ...createInitialState(),
    sales: [],
  });
  const lateBulkHydration = collectLiveNotificationEvents(
    emptyInitialized,
    baseState,
  );
  assert.equal(lateBulkHydration.events.length, 0);
  assert.equal(lateBulkHydration.nextBaseline.saleIds.size, 8);
});

test('usePushNotifications detecta eventos en vivo: venta nueva, abono/liquidación CxC y stock crítico', () => {
  const initial = createInitialState();
  initial.inventory = [
    {
      id: 'sku-barca-m',
      team: 'Barcelona',
      model: 'Barcelona Home 25/26',
      version: 'Player',
      size: 'M',
      stock: 3,
      cogs: 18,
      salePrice: 35,
      fifoBatches: [],
    },
  ];
  initial.receivables = [
    {
      id: 'rec-1',
      debtor: 'Carlos Pérez',
      amount: 35,
      paidAmount: 0,
      originalAmount: 35,
      note: 'Camiseta Barca',
      createdAt: '2026-11-20T10:00:00.000Z',
      installments: [],
    },
    {
      id: 'rec-2',
      debtor: 'María Gómez',
      amount: 20,
      paidAmount: 15,
      originalAmount: 35,
      note: 'Camiseta RM',
      createdAt: '2026-11-18T10:00:00.000Z',
      installments: [],
    },
  ];
  initial.collectedReceivablesCount = 2;

  const baseline = buildNotificationBaseline(initial);

  // Simular tick en vivo: 1 venta nueva, 1 abono parcial en rec-1, rec-2 liquidada por completo, y stock baja de 3 -> 2
  const nextState: AppState = {
    ...initial,
    collectedReceivablesCount: 3,
    inventory: [{ ...initial.inventory[0], stock: 2 }],
    sales: [
      ...initial.sales,
      makeSaleRecord({
        id: 'sale-live-1',
        invoiceNumber: '#0099',
        skuId: 'sku-barca-m',
        modelLabel: 'Barcelona Home 25/26',
        team: 'Barcelona',
        version: 'Player',
        size: 'M',
        seller: 'Josué',
        customerName: 'Luis Rivas',
        paymentMethod: 'Binance USDT',
        createdAt: '2026-11-28T12:00:00.000Z',
      }),
      makeSaleRecord({
        id: 'sale-voided-ignored',
        invoiceNumber: '#0100',
        skuId: 'sku-barca-m',
        modelLabel: 'Barcelona Home 25/26',
        team: 'Barcelona',
        version: 'Player',
        size: 'M',
        seller: 'Gabriel',
        customerName: 'Cliente Mostrador',
        paymentMethod: 'Efectivo ($)',
        voided: true,
        createdAt: '2026-11-28T12:01:00.000Z',
      }),
    ],
    receivables: [
      {
        ...initial.receivables[0],
        amount: 20,
        paidAmount: 15,
        installments: [
          {
            id: 'inst-1',
            amount: 15,
            paymentMethod: 'Efectivo ($)',
            createdAt: '2026-11-28T12:02:00.000Z',
          },
        ],
      },
    ],
  };

  const { events } = collectLiveNotificationEvents(baseline, nextState);
  assert.equal(events.length, 4);
  assert.ok(events.some((e) => e.title.includes('Nueva Venta · Josué') && e.body.includes('Luis Rivas')));
  assert.ok(!events.some((e) => e.tag.includes('sale-voided-ignored')));
  assert.ok(events.some((e) => e.body.includes('Carlos Pérez abonó $15.00 USDT (Resta: $20.00 USDT)')));
  assert.ok(events.some((e) => e.body.includes('María Gómez abonó $20.00 USDT (Resta: $0.00 USDT)')));
  assert.ok(events.some((e) => e.title.includes('Stock Crítico') && e.body.includes('Quedan 2 ud(s)')));
});

test('VoucherReceiptModal helpers validan bordes CxC parcial vs $0.00, signos +/- y nombres JPG', () => {
  assert.equal(isCxcVoucherPaidInFull(0), true);
  assert.equal(isCxcVoucherPaidInFull(-0.001), true);
  assert.equal(isCxcVoucherPaidInFull(0.004), true);
  assert.equal(isCxcVoucherPaidInFull(12.5), false);

  assert.equal(safeNonNegAmount(-5), 0);
  assert.equal(safeNonNegAmount(Number.NaN), 0);
  assert.equal(safeNonNegAmount(19.996), 20);

  assert.equal(formatVoucherSignedAmount('-', -45.5), '-$45.50 USDT');
  assert.equal(formatVoucherSignedAmount('+', 120), '+$120.00 USDT');

  assert.equal(
    getVoucherFilename({
      type: 'expense',
      receiptCode: 'EGR-1',
      createdAt: '2026-11-28T15:00:00.000Z',
      recordedBy: 'Jesús César',
      concept: 'Flete aéreo',
      category: 'Logística/Producción',
      amount: 45,
      paymentMethod: 'Efectivo ($)',
      debitedFundsLabel: 'Reposición',
    }),
    'X4SPORT_Gasto_2026-11-28.jpg',
  );
});
