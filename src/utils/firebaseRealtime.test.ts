import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../data/initialState';
import { DEFAULT_GENERAL_CONFIG, registerCapitalInjection } from './finance';
import {
  buildPublicCatalogSnapshot,
  ensureSilentFirebaseAuth,
  RTDB_CONFIG_PATH,
  RTDB_ERP_PATH,
  RTDB_PUBLIC_CATALOG_PATH,
  subscribeErpState,
  subscribePublicCatalog,
  transactErpState,
  updateErpState,
  writeGeneralConfig,
  writePublicCatalogSnapshot,
} from './firebaseRealtime';

test('transactErpState devuelve source "unavailable" cuando Firebase no está disponible', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  try {
    const fallback = createInitialState();
    const outcome = await transactErpState(
      (current) =>
        registerCapitalInjection(current, {
          contributor: 'Jesús',
          concept: 'Aporte prueba',
          amount: 50,
          paymentMethod: 'Efectivo ($)',
          destination: 'cashOnly',
        }),
      fallback,
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.source, 'unavailable');
    assert.ok(outcome.error && outcome.error.length > 0);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('transactErpState evalúa el mutator sobre el snapshot remoto autoritativo y nunca ejecuta .set()', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let setCalled = false;
  const staleLocal = createInitialState();
  const authoritativeRemote = {
    ...createInitialState(),
    cashOnHand: staleLocal.cashOnHand + 100,
  };

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      database: () => ({
        ref: (path: string) => {
          assert.equal(path, RTDB_ERP_PATH);
          return {
            set: async () => {
              setCalled = true;
            },
            update: async () => {},
            transaction: async (updater: (current: unknown) => unknown) => {
              const nextVal = updater(authoritativeRemote);
              assert.notEqual(nextVal, undefined);
              return {
                committed: true,
                snapshot: {
                  exists: () => true,
                  val: () => nextVal,
                },
              };
            },
          };
        },
      }),
    },
  };

  try {
    const outcome = await transactErpState(
      (current) =>
        registerCapitalInjection(current, {
          contributor: 'Josué',
          concept: 'Aporte concurrente',
          amount: 25,
          paymentMethod: 'Binance USDT',
          destination: 'cashOnly',
        }),
      staleLocal,
    );

    assert.equal(setCalled, false);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.source, 'firebase');
    assert.equal(outcome.state?.cashOnHand, staleLocal.cashOnHand + 125);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('transactErpState devuelve source "unavailable" si RTDB no confirma la transacción sin rechazo lógico', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const fallback = createInitialState();

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      database: () => ({
        ref: () => ({
          transaction: async () => ({
            committed: false,
            snapshot: {
              exists: () => false,
              val: () => null,
            },
          }),
        }),
      }),
    },
  };

  try {
    const outcome = await transactErpState(
      (current) =>
        registerCapitalInjection(current, {
          contributor: 'Gabriel',
          concept: 'Prueba conflicto',
          amount: 10,
          paymentMethod: 'Efectivo ($)',
          destination: 'cashOnly',
        }),
      fallback,
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.source, 'unavailable');
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('updateErpState ejecuta .update() parcial sin llamar .set()', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let setCalled = false;
  let updatedPayload: Record<string, unknown> | null = null;

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      database: () => ({
        ref: (path: string) => {
          assert.equal(path, RTDB_ERP_PATH);
          return {
            set: async () => {
              setCalled = true;
            },
            update: async (values: Record<string, unknown>) => {
              updatedPayload = values;
            },
          };
        },
      }),
    },
  };

  try {
    await updateErpState({ catalogEnabled: false });
    assert.equal(setCalled, false);
    assert.deepEqual(updatedPayload, { catalogEnabled: false });
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('buildPublicCatalogSnapshot excluye ventas, finanzas, COGS, fifoBatches y costos de fábrica', () => {
  const state = createInitialState();
  state.catalogEnabled = true;
  state.catalogPhotos = { 'barca-home-2026__player': 'https://example.com/barca.jpg' };
  state.catalogKeywords = { 'barca-home-2026__player': 'lamine yamal' };
  state.inventory = [
    {
      id: 'sku-barca-m',
      team: 'Barcelona',
      model: 'Barcelona Home 25/26',
      version: 'Player',
      size: 'M',
      stock: 4,
      cogs: 19.5,
      salePrice: 35,
      fifoBatches: [
        {
          batchId: 'b-1',
          batchName: 'Lote Secreto',
          entryDate: '2026-11-01',
          initialQuantity: 4,
          remainingQuantity: 4,
          unitCost: 19.5,
        },
      ],
    },
  ];
  state.purchaseBatches = [
    {
      id: 'batch-transit-1',
      status: 'EN TRÁNSITO',
      fundingSource: 'replacement',
      entryDate: '2026-11-10',
      estimatedArrivalDate: '2026-11-25',
      supplier: 'Proveedor Confidencial Guangzhou',
      referenceName: 'Lote Aéreo Noviembre',
      shippingType: 'Aéreo',
      orderedTotalUnits: 10,
      totalUnits: 10,
      totalFactoryCost: 120,
      estimatedFreightCost: 45,
      totalFreightCost: 45,
      freightPerUnit: 4.5,
      totalLandedCost: 165,
      usdtRate: 54.2,
      createdAt: '2026-11-10T00:00:00.000Z',
      items: [
        {
          skuId: 'sku-rm-l',
          team: 'Real Madrid',
          model: 'Real Madrid Away 25/26',
          version: 'Fans',
          size: 'L',
          orderedQuantity: 10,
          quantity: 10,
          salePrice: 30,
          factoryUnitCost: 12,
          proratedFreightPerUnit: 4.5,
          landedUnitCost: 16.5,
          lineFactoryTotal: 120,
          lineLandedTotal: 165,
        },
      ],
    },
    {
      id: 'batch-received-2',
      status: 'RECIBIDO EN BODEGA',
      fundingSource: 'cashOnHand',
      entryDate: '2026-10-01',
      receivedDate: '2026-10-12',
      referenceName: 'Lote Ya Recibido',
      shippingType: 'Marítimo',
      orderedTotalUnits: 5,
      totalUnits: 5,
      totalFactoryCost: 50,
      estimatedFreightCost: 15,
      totalFreightCost: 15,
      freightPerUnit: 3,
      totalLandedCost: 65,
      createdAt: '2026-10-01T00:00:00.000Z',
      items: [],
    },
  ];

  const snapshot = buildPublicCatalogSnapshot(state);
  const topKeys = Object.keys(snapshot).sort();
  assert.deepEqual(topKeys, [
    'catalogEnabled',
    'catalogKeywords',
    'catalogPhotos',
    'exchangeRates',
    'inventory',
    'purchaseBatches',
  ]);

  assert.equal(snapshot.inventory.length, 1);
  assert.equal('cogs' in snapshot.inventory[0], false);
  assert.equal('fifoBatches' in snapshot.inventory[0], false);
  assert.equal(snapshot.inventory[0].salePrice, 35);
  assert.equal(snapshot.inventory[0].stock, 4);

  assert.equal(snapshot.purchaseBatches.length, 1);
  const transitBatch = snapshot.purchaseBatches[0] as unknown as Record<string, unknown>;
  assert.equal(transitBatch.id, 'batch-transit-1');
  assert.equal('totalFactoryCost' in transitBatch, false);
  assert.equal('totalFreightCost' in transitBatch, false);
  assert.equal('totalLandedCost' in transitBatch, false);
  assert.equal('supplier' in transitBatch, false);
  assert.equal('fundingSource' in transitBatch, false);

  const transitItem = snapshot.purchaseBatches[0].items[0] as unknown as Record<string, unknown>;
  assert.equal(transitItem.salePrice, 30);
  assert.equal('factoryUnitCost' in transitItem, false);
  assert.equal('proratedFreightPerUnit' in transitItem, false);
  assert.equal('landedUnitCost' in transitItem, false);
  assert.equal('lineFactoryTotal' in transitItem, false);
  assert.equal('lineLandedTotal' in transitItem, false);
});

test('writePublicCatalogSnapshot escribe el catálogo sanitizado en x4sport/publicCatalog', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let writtenPayload: Record<string, unknown> | null = null;

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      database: () => ({
        ref: (path: string) => {
          assert.equal(path, RTDB_PUBLIC_CATALOG_PATH);
          return {
            set: async (val: Record<string, unknown>) => {
              writtenPayload = val;
            },
          };
        },
      }),
    },
  };

  try {
    const state = createInitialState();
    await writePublicCatalogSnapshot(state);
    assert.ok(writtenPayload !== null);
    assert.equal('sales' in writtenPayload, false);
    assert.equal('funds' in writtenPayload, false);
    assert.equal('authorizedUsers' in writtenPayload, false);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('subscribePublicCatalog ejecuta auth anónima silenciosa, se suscribe únicamente a x4sport/publicCatalog y nunca lee erpState ni escribe', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalFetch = globalThis.fetch;
  const requestedPaths: string[] = [];
  const fetchedUrls: string[] = [];
  let signInCalls = 0;
  let setCalls = 0;

  const authMock = {
    currentUser: null as {
      uid: string;
      isAnonymous: boolean;
      getIdToken: () => Promise<string>;
    } | null,
    signInAnonymously: async () => {
      signInCalls += 1;
      authMock.currentUser = {
        uid: 'anon-catalog-reader',
        isAnonymous: true,
        getIdToken: async () => 'public-anon-token',
      };
      return { user: authMock.currentUser };
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchedUrls.push(String(input));
    return {
      ok: false,
      json: async () => null,
    } as Response;
  }) as typeof fetch;

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      auth: () => authMock,
      database: () => ({
        ref: (path: string) => {
          requestedPaths.push(path);
          return {
            set: async () => {
              setCalls += 1;
            },
            on: (
              _evt: 'value',
              cb: (snap: { exists: () => boolean; val: () => unknown }) => void,
            ) => {
              cb({
                exists: () => true,
                val: () => ({
                  catalogEnabled: true,
                  exchangeRates: { bcv: 48, usdt: 56, updatedAt: '2026-11-22', source: 'manual' },
                  catalogPhotos: { 'madrid-home__player': 'https://example.com/rm.jpg' },
                  catalogKeywords: {},
                  inventory: [
                    {
                      id: 'sku-rm-m',
                      team: 'Real Madrid',
                      model: 'Real Madrid Home',
                      version: 'Player',
                      size: 'M',
                      stock: 3,
                      salePrice: 35,
                    },
                  ],
                  purchaseBatches: [],
                }),
              });
              return cb;
            },
            off: () => {},
          };
        },
      }),
    },
  };

  try {
    const deliveredStates: ReturnType<typeof createInitialState>[] = [];
    const unsubscribe = subscribePublicCatalog(
      (s) => {
        deliveredStates.push(s);
      },
      () => {},
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    unsubscribe();

    assert.equal(signInCalls, 1);
    assert.equal(setCalls, 0);
    assert.deepEqual(requestedPaths, [RTDB_PUBLIC_CATALOG_PATH]);
    assert.ok(fetchedUrls.length >= 1);
    assert.ok(fetchedUrls.every((u) => u.includes(RTDB_PUBLIC_CATALOG_PATH)));
    assert.ok(fetchedUrls.every((u) => u.includes('?auth=public-anon-token')));
    assert.ok(fetchedUrls.every((u) => !u.includes(RTDB_ERP_PATH)));
    assert.equal(deliveredStates.length, 1);
    const receivedState = deliveredStates[0];
    assert.equal(receivedState.inventory.length, 1);
    assert.equal(receivedState.inventory[0].cogs, 0);
    assert.equal(receivedState.sales.length, 0);
    assert.equal(receivedState.customers?.length ?? 0, 0);
    assert.equal(receivedState.receivables.length, 0);
    assert.equal(receivedState.cashOnHand, 0);
    assert.equal(receivedState.authorizedUsers, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('ensureSilentFirebaseAuth ejecuta signInAnonymously cuando currentUser es null y evita re-autenticar si ya existe sesión', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let signInCalls = 0;
  const authMock = {
    currentUser: null as { uid: string; isAnonymous: boolean } | null,
    signInAnonymously: async () => {
      signInCalls += 1;
      authMock.currentUser = { uid: 'anon-uid-1', isAnonymous: true };
      return { user: authMock.currentUser };
    },
  };

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      auth: () => authMock,
      database: () => ({ ref: () => ({}) }),
    },
  };

  try {
    const firstOk = await ensureSilentFirebaseAuth();
    assert.equal(firstOk, true);
    assert.equal(signInCalls, 1);

    const secondOk = await ensureSilentFirebaseAuth();
    assert.equal(secondOk, true);
    assert.equal(signInCalls, 1);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('ensureSilentFirebaseAuth captura errores si Anonymous Auth no está habilitado sin bloquear la app', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let signInCalls = 0;

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      auth: () => ({
        currentUser: null,
        signInAnonymously: async () => {
          signInCalls += 1;
          throw new Error('auth/operation-not-allowed');
        },
      }),
      database: () => ({ ref: () => ({}) }),
    },
  };

  try {
    const ok = await ensureSilentFirebaseAuth();
    assert.equal(ok, false);
    assert.equal(signInCalls, 1);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('subscribeErpState y updateErpState autentican silenciosamente antes de acceder a x4sport/erpState', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalFetch = globalThis.fetch;
  const sequence: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    sequence.push(`fetch:${String(input)}`);
    return {
      ok: false,
      json: async () => null,
    } as Response;
  }) as typeof fetch;

  const authMock = {
    currentUser: null as {
      uid: string;
      getIdToken: () => Promise<string>;
    } | null,
    signInAnonymously: async () => {
      sequence.push('auth:signInAnonymously');
      authMock.currentUser = {
        uid: 'anon-uid-2',
        getIdToken: async () => 'tok-anon-123',
      };
      return { user: authMock.currentUser };
    },
  };

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      auth: () => authMock,
      database: () => ({
        ref: (path: string) => {
          sequence.push(`db:ref:${path}`);
          return {
            on: (
              _evt: 'value',
              cb: (snap: { exists: () => boolean; val: () => unknown }) => void,
            ) => {
              cb({
                exists: () => true,
                val: () => createInitialState(),
              });
              return cb;
            },
            off: () => {},
            update: async () => {
              sequence.push('db:update');
            },
          };
        },
      }),
    },
  };

  try {
    let resolvedState = false;
    const unsubscribe = subscribeErpState(
      () => {
        resolvedState = true;
      },
      () => {},
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    unsubscribe();

    assert.equal(resolvedState, true);
    assert.equal(sequence[0], 'auth:signInAnonymously');
    assert.ok(sequence.some((s) => s.includes('?auth=tok-anon-123')));
    assert.ok(
      sequence.indexOf('auth:signInAnonymously') <
        sequence.indexOf(`db:ref:${RTDB_ERP_PATH}`),
    );

    await updateErpState({ catalogEnabled: true });
    assert.equal(sequence[sequence.length - 1], 'db:update');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('writeGeneralConfig y writePublicCatalogSnapshot ejecutan ensureSilentFirebaseAuth antes de escribir en db.ref', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const sequence: string[] = [];

  const authMock = {
    currentUser: null as { uid: string } | null,
    signInAnonymously: async () => {
      sequence.push('auth:signInAnonymously');
      authMock.currentUser = { uid: 'anon-uid-writes' };
      return { user: authMock.currentUser };
    },
  };

  (globalThis as { window?: unknown }).window = {
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      auth: () => authMock,
      database: () => ({
        ref: (path: string) => {
          sequence.push(`db:ref:${path}`);
          return {
            set: async () => {
              sequence.push(`db:set:${path}`);
            },
          };
        },
      }),
    },
  };

  try {
    await writeGeneralConfig(DEFAULT_GENERAL_CONFIG);
    assert.equal(sequence[0], 'auth:signInAnonymously');
    assert.equal(sequence[1], `db:ref:${RTDB_CONFIG_PATH}`);
    assert.equal(sequence[2], `db:set:${RTDB_CONFIG_PATH}`);

    authMock.currentUser = null;
    await writePublicCatalogSnapshot(createInitialState());
    assert.equal(sequence[3], 'auth:signInAnonymously');
    assert.equal(sequence[4], `db:ref:${RTDB_PUBLIC_CATALOG_PATH}`);
    assert.equal(sequence[5], `db:set:${RTDB_PUBLIC_CATALOG_PATH}`);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('subscribeErpState reporta inmediatamente el error de dominio no autorizado si signInAnonymously falla y REST devuelve 401/403', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Permission denied' }),
    }) as Response) as typeof fetch;

  (globalThis as { window?: unknown }).window = {
    location: { hostname: 'ais-dev-example.run.app' },
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      app: () => ({}),
      auth: () => ({
        currentUser: null,
        signInAnonymously: async () => {
          const err = new Error('Domain not authorized') as Error & { code: string };
          err.code = 'auth/unauthorized-domain';
          throw err;
        },
      }),
      database: () => ({
        ref: () => ({
          on: () => () => {},
          off: () => {},
        }),
      }),
    },
  };

  try {
    const errors: string[] = [];
    const unsubscribe = subscribeErpState(
      () => {},
      (msg) => errors.push(msg),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    unsubscribe();

    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('ais-dev-example.run.app'));
    assert.ok(errors[0].includes('auth/unauthorized-domain'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

