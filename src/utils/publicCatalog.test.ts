import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSeedState, createEmptyCleanState } from '../data/initialState';
import {
  getInventorySizeMatrix,
  normalizeAppState,
  receiveImportBatch,
  registerImportBatch,
  registerMultiItemSale,
  sanitizeForFirebase,
} from './finance';
import {
  advanceWhatsAppTurnIndex,
  applyCatalogPhotoMutation,
  buildCatalogWhatsAppHref,
  buildPublicCatalogGroups,
  buildShareableCatalogUrl,
  buildUpcomingTransitCards,
  calculateCatalogBsPrice,
  CATALOG_WHATSAPP_ADVISORS,
  clampCatalogCarouselIndex,
  computeClampedSwipeOffset,
  computeTransitDaysRemaining,
  consolidateMatrixRowsByModelIdentity,
  convertGoogleDriveUrlToDirect,
  extractGoogleDriveFileId,
  filterPublicCatalogGroups,
  filterUpcomingTransitCards,
  getCurrentWhatsAppTurnIndex,
  getModelIdentityKey,
  isPublicCatalogModeFromLocation,
  isRateValid,
  normalizarUrlImagen,
  normalizeCatalogImageUrl,
  normalizeCatalogModelKey,
  obtenerFallbackUrlImagen,
  parseCatalogImageList,
  propagateModelPhotosAfterBatchMutation,
  resolveCatalogKeywords,
  resolveCatalogPhoto,
  resolveModelPhotoAnywhere,
  sanitizeFirebaseCatalogKey,
} from './publicCatalog';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

test('buildPublicCatalogGroups reads real FIFO stock and hides 0-stock sizes/models automatically', () => {
  const state = createDemoSeedState();
  // Drain sku-psg-4 (PSG Tercera Edición, only 1 in stock) to 0 via real sale
  const soldOutRes = registerMultiItemSale(state, {
    items: [{ skuId: 'sku-psg-4', quantity: 1, unitPrice: 25 }],
    customerName: 'Cliente Test',
    seller: 'Jesús',
    paymentStatus: 'Cobrado',
    paymentMethod: 'Efectivo ($)',
  });
  assert.equal(soldOutRes.ok, true);

  const groups = buildPublicCatalogGroups(soldOutRes.state);
  const psgGroup = groups.find((g) => g.team === 'PSG');
  assert.ok(psgGroup);
  assert.equal(
    psgGroup.products.some((p) => p.model === 'PSG Tercera Edición'),
    false,
  );
  // Canonical ordering puts Barcelona first
  assert.equal(groups[0].team, 'Barcelona');
  const barcaLocalPlayer = groups[0].products.find(
    (p) => p.model === 'Barcelona Local 25/26' && p.version === 'Player',
  );
  assert.ok(barcaLocalPlayer);
  assert.deepEqual(
    barcaLocalPlayer.sizes.map((s) => s.size),
    ['M', 'L'],
  );
  assert.equal(barcaLocalPlayer.totalStock, 18);
});

test('filterPublicCatalogGroups filters in real time by player names, sizes, versions, and custom keywords', () => {
  const base = createDemoSeedState();
  const key = normalizeCatalogModelKey('Barcelona Retro 08/09', 'Player');
  base.catalogKeywords = { [key]: 'Ronaldinho Puyol 2009' };

  const groups = buildPublicCatalogGroups(base);

  // Player alias search: Lamine Yamal -> Barcelona (+ Selección España)
  const yamalRes = filterPublicCatalogGroups(groups, 'Lamine Yamal');
  assert.ok(yamalRes.some((g) => g.team === 'Barcelona'));
  const seleccionesYamal = yamalRes.find((g) => g.team === 'Selecciones');
  if (seleccionesYamal) {
    assert.ok(
      seleccionesYamal.products.every((p) => p.model.includes('España')),
    );
  }

  // Player alias search with accent normalization: Mbappé / Bellingham -> Real Madrid
  const bellinghamRes = filterPublicCatalogGroups(groups, 'Bellingham');
  assert.equal(bellinghamRes.length, 1);
  assert.equal(bellinghamRes[0].team, 'Real Madrid');

  const mbappeRes = filterPublicCatalogGroups(groups, 'Mbappé');
  assert.equal(mbappeRes.length, 1);
  assert.equal(mbappeRes[0].team, 'Real Madrid');

  // Size filter by text token XL
  const xlRes = filterPublicCatalogGroups(groups, 'XL');
  assert.ok(xlRes.length >= 3);
  for (const g of xlRes) {
    for (const p of g.products) {
      assert.ok(p.sizes.some((s) => s.size === 'XL'));
    }
  }

  // Version filter: Fan -> matches Fans
  const fanRes = filterPublicCatalogGroups(groups, 'Fan');
  assert.ok(fanRes.length >= 4);
  for (const g of fanRes) {
    for (const p of g.products) {
      assert.equal(p.version, 'Fans');
    }
  }

  // Custom keyword filter
  const customRes = filterPublicCatalogGroups(groups, 'Ronaldinho');
  assert.equal(customRes.length, 1);
  assert.equal(customRes[0].products[0].model, 'Barcelona Retro 08/09');
});

test('buildUpcomingTransitCards exposes only EN TRÁNSITO batches and filters properly', () => {
  const state = createEmptyCleanState();
  state.purchaseBatches = [
    {
      id: 'batch-transit-1',
      status: 'EN TRÁNSITO',
      fundingSource: 'cashOnHand',
      entryDate: '2026-11-15',
      estimatedArrivalDate: '2026-12-02',
      referenceName: 'Aéreo Diciembre #1',
      shippingType: 'Aéreo',
      orderedTotalUnits: 12,
      totalUnits: 12,
      totalFactoryCost: 72,
      estimatedFreightCost: 24,
      totalFreightCost: 24,
      freightPerUnit: 2,
      totalLandedCost: 96,
      createdAt: '2026-11-15T10:00:00.000Z',
      items: [
        {
          team: 'Real Madrid',
          model: 'Real Madrid Local 25/26',
          version: 'Player',
          size: 'M',
          orderedQuantity: 6,
          quantity: 6,
          salePrice: 30,
          factoryUnitCost: 6,
          proratedFreightPerUnit: 2,
          landedUnitCost: 8,
          lineFactoryTotal: 36,
          lineLandedTotal: 48,
        },
        {
          team: 'Real Madrid',
          model: 'Real Madrid Local 25/26',
          version: 'Player',
          size: 'L',
          orderedQuantity: 6,
          quantity: 6,
          salePrice: 30,
          factoryUnitCost: 6,
          proratedFreightPerUnit: 2,
          landedUnitCost: 8,
          lineFactoryTotal: 36,
          lineLandedTotal: 48,
        },
      ],
    },
    {
      id: 'batch-received-1',
      status: 'RECIBIDO EN BODEGA',
      fundingSource: 'cashOnHand',
      entryDate: '2026-11-01',
      receivedDate: '2026-11-10',
      referenceName: 'Lote Ya En Bodega',
      shippingType: 'Aéreo',
      orderedTotalUnits: 4,
      totalUnits: 4,
      totalFactoryCost: 24,
      estimatedFreightCost: 8,
      totalFreightCost: 8,
      freightPerUnit: 2,
      totalLandedCost: 32,
      createdAt: '2026-11-01T10:00:00.000Z',
      items: [
        {
          team: 'PSG',
          model: 'PSG Local 25/26',
          version: 'Fans',
          size: 'S',
          orderedQuantity: 4,
          quantity: 4,
          factoryUnitCost: 6,
          proratedFreightPerUnit: 2,
          landedUnitCost: 8,
          lineFactoryTotal: 24,
          lineLandedTotal: 32,
        },
      ],
    },
  ];

  const transitCards = buildUpcomingTransitCards(state, '2026-11-15');
  assert.equal(transitCards.length, 1);
  assert.equal(transitCards[0].model, 'Real Madrid Local 25/26');
  assert.equal(transitCards[0].totalIncomingUnits, 12);
  assert.equal(transitCards[0].estimatedArrivalDate, '2026-12-02');
  assert.equal(transitCards[0].estimatedDaysRemaining, 17);
  assert.equal(transitCards[0].estimatedArrivalLabel, 'Llega en ~17 días');
  assert.deepEqual(
    transitCards[0].sizes.map((s) => s.size),
    ['M', 'L'],
  );

  assert.equal(filterUpcomingTransitCards(transitCards, 'Bellingham').length, 1);
  assert.equal(filterUpcomingTransitCards(transitCards, 'PSG').length, 0);
});

test('calculateCatalogBsPrice converts USD prices strictly with USDT/Paralelo rate and computeTransitDaysRemaining handles explicit & SLA ETAs', () => {
  // 30 USD at 54.20 USDT = 1626.00 Bs
  assert.equal(calculateCatalogBsPrice(30, 54.2), 1626);
  assert.equal(calculateCatalogBsPrice(25.5, 53.75), 1370.63);
  // Protege márgenes si la tasa es inválida, 0, nula o negativa
  assert.equal(calculateCatalogBsPrice(-10, 54.2), null);
  assert.equal(calculateCatalogBsPrice(25, Number.NaN), null);
  assert.equal(calculateCatalogBsPrice(25, 0), null);
  assert.equal(calculateCatalogBsPrice(25, -5), null);
  assert.equal(calculateCatalogBsPrice(25, null as unknown as number), null);
  assert.equal(calculateCatalogBsPrice(25, undefined), null);
  assert.equal(isRateValid(54.2), true);
  assert.equal(isRateValid(0), false);
  assert.equal(isRateValid(null), false);
  assert.equal(isRateValid(Number.NaN), false);

  // Explicit estimated arrival date
  assert.deepEqual(
    computeTransitDaysRemaining(
      {
        entryDate: '2026-11-01',
        estimatedArrivalDate: '2026-11-22',
        shippingType: 'Aéreo',
      },
      '2026-11-15',
    ),
    { daysRemaining: 7, label: 'Llega en ~7 días' },
  );

  // Tomorrow & Today
  assert.deepEqual(
    computeTransitDaysRemaining(
      { estimatedArrivalDate: '2026-11-16', shippingType: 'Aéreo' },
      '2026-11-15',
    ),
    { daysRemaining: 1, label: 'Llega mañana (~1 día)' },
  );
  assert.deepEqual(
    computeTransitDaysRemaining(
      { estimatedArrivalDate: '2026-11-15', shippingType: 'Aéreo' },
      '2026-11-15',
    ),
    { daysRemaining: 0, label: 'Llegada estimada hoy' },
  );

  // Overdue / arriving this week
  assert.deepEqual(
    computeTransitDaysRemaining(
      { estimatedArrivalDate: '2026-11-12', shippingType: 'Aéreo' },
      '2026-11-15',
    ),
    { daysRemaining: -3, label: 'Por arribar esta semana' },
  );

  // Fallback to SLA (15d Aéreo, 80d Marítimo) when estimatedArrivalDate is omitted
  assert.deepEqual(
    computeTransitDaysRemaining(
      { entryDate: '2026-11-10', shippingType: 'Aéreo' },
      '2026-11-15',
    ),
    { daysRemaining: 10, label: 'Llega en ~10 días' },
  );
  assert.deepEqual(
    computeTransitDaysRemaining(
      { entryDate: '2026-11-01', shippingType: 'Marítimo' },
      '2026-11-15',
    ),
    { daysRemaining: 66, label: 'Llega en ~66 días' },
  );
});

test('WhatsApp rotation alternates strictly between Jesús César and Josué Ojeda with exact message', () => {
  const storage = createMemoryStorage();
  assert.equal(getCurrentWhatsAppTurnIndex(storage), 0);

  const first = buildCatalogWhatsAppHref(getCurrentWhatsAppTurnIndex(storage), {
    model: 'Barcelona Local 25/26',
    version: 'Player',
    size: 'M',
  });
  assert.equal(first.advisor.name, 'Jesús César');
  assert.equal(first.advisor.waNumber, '584124612132');
  assert.ok(first.href.startsWith('https://wa.me/584124612132?text='));
  assert.equal(
    first.message,
    '¡Hola! 👋 Me interesa la franela Barcelona Local 25/26, Versión Player, Talla M que vi en el catálogo de X4SPORT. ¿Está disponible?',
  );

  const nextIdx = advanceWhatsAppTurnIndex(storage);
  assert.equal(nextIdx, 1);
  const second = buildCatalogWhatsAppHref(getCurrentWhatsAppTurnIndex(storage), {
    model: 'Real Madrid Local 25/26',
    version: 'Fans',
    size: 'L',
  });
  assert.equal(second.advisor.name, 'Josué Ojeda');
  assert.equal(second.advisor.waNumber, '584124588754');
  assert.ok(second.href.startsWith('https://wa.me/584124588754?text='));

  const backToZero = advanceWhatsAppTurnIndex(storage);
  assert.equal(backToZero, 0);
  assert.equal(CATALOG_WHATSAPP_ADVISORS.length, 2);
});

test('normalizeCatalogImageUrl converts Google Drive links to direct lh3 format and preserves direct/data URLs', () => {
  assert.equal(
    normalizeCatalogImageUrl('https://drive.google.com/file/d/1AbCDefGhIjkLMNOP/view?usp=sharing'),
    'https://lh3.googleusercontent.com/d/1AbCDefGhIjkLMNOP',
  );
  assert.equal(
    normalizeCatalogImageUrl('https://drive.google.com/open?id=999xyz_123'),
    'https://lh3.googleusercontent.com/d/999xyz_123',
  );
  assert.equal(
    convertGoogleDriveUrlToDirect('https://drive.google.com/file/d/sample_file_id_456/edit'),
    'https://lh3.googleusercontent.com/d/sample_file_id_456',
  );
  assert.equal(
    extractGoogleDriveFileId('https://lh3.googleusercontent.com/d/existing_lh3_id'),
    'existing_lh3_id',
  );
  assert.equal(
    normalizeCatalogImageUrl('https://cdn.example.com/kit.jpg'),
    'https://cdn.example.com/kit.jpg',
  );
  assert.equal(
    normalizeCatalogImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='),
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
  );
});

test('shareable catalog route detection and normalizeAppState preserve catalog settings without touching 4-layer matrix', () => {
  assert.equal(isPublicCatalogModeFromLocation({ search: '?catalogo=1' }), true);
  assert.equal(isPublicCatalogModeFromLocation({ hash: '#catalogo' }), true);
  assert.equal(isPublicCatalogModeFromLocation({ pathname: '/catalogo' }), true);
  assert.equal(isPublicCatalogModeFromLocation({ search: '', hash: '', pathname: '/' }), false);
  assert.equal(
    buildShareableCatalogUrl({ protocol: 'https:', origin: 'https://x4sport.app', pathname: '/' }),
    'https://x4sport.app/?catalogo=1',
  );

  const seed = createDemoSeedState();
  seed.catalogEnabled = false;
  seed.catalogPhotos = { 'barcelona local 25/26::Player': 'https://cdn.example.com/barca.jpg' };
  const normalized = normalizeAppState(JSON.parse(JSON.stringify(seed)));
  assert.equal(normalized.catalogEnabled, false);
  assert.equal(
    normalized.catalogPhotos?.['barcelona local 25_26::Player'],
    'https://cdn.example.com/barca.jpg',
  );
  assert.equal(normalized.catalogPhotos?.['barcelona local 25/26::Player'], undefined);
  assert.equal(normalized.cashOnHand, seed.cashOnHand);
  assert.equal(normalized.funds.growthReinvestment, seed.funds.growthReinvestment);
});

test('normalizarUrlImagen converts file/d, open?id and uc?id links to lh3 =w1000 with thumbnail fallback and carousel bounds clamping', () => {
  assert.equal(
    normalizarUrlImagen('https://drive.google.com/file/d/1AbCDefGhIjkLMNOP/view?usp=sharing'),
    'https://lh3.googleusercontent.com/d/1AbCDefGhIjkLMNOP=w1000',
  );
  assert.equal(
    normalizarUrlImagen('https://drive.google.com/open?id=999xyz_123'),
    'https://lh3.googleusercontent.com/d/999xyz_123=w1000',
  );
  assert.equal(
    normalizarUrlImagen('https://drive.google.com/uc?export=view&id=uc_id_777'),
    'https://lh3.googleusercontent.com/d/uc_id_777=w1000',
  );
  assert.equal(
    normalizarUrlImagen('https://lh3.googleusercontent.com/d/legacyIdNoWidth'),
    'https://lh3.googleusercontent.com/d/legacyIdNoWidth=w1000',
  );
  assert.equal(
    obtenerFallbackUrlImagen('https://lh3.googleusercontent.com/d/1AbCDefGhIjkLMNOP=w1000'),
    'https://drive.google.com/thumbnail?id=1AbCDefGhIjkLMNOP&sz=w1000',
  );
  assert.equal(
    obtenerFallbackUrlImagen('https://cdn.example.com/kit.jpg'),
    null,
  );

  // Multi-image list preserves data URLs intact and splits Drive URLs
  assert.deepEqual(
    parseCatalogImageList(
      'https://drive.google.com/file/d/idUno/view, https://drive.google.com/uc?id=idDos',
    ),
    [
      'https://lh3.googleusercontent.com/d/idUno=w1000',
      'https://lh3.googleusercontent.com/d/idDos=w1000',
    ],
  );
  assert.deepEqual(
    parseCatalogImageList('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='),
    ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='],
  );

  // Carousel strict index bounds [0, imagenes.length - 1]
  assert.equal(clampCatalogCarouselIndex(-2, 3), 0);
  assert.equal(clampCatalogCarouselIndex(5, 3), 2);
  assert.equal(clampCatalogCarouselIndex(1, 1), 0);

  // Swipe gesture blocked at boundaries so user never slides into empty space
  assert.equal(computeClampedSwipeOffset(80, 0, 3), 0); // at first photo, swiping right blocked
  assert.equal(computeClampedSwipeOffset(-80, 2, 3), 0); // at last photo, swiping past end blocked
  assert.equal(computeClampedSwipeOffset(-80, 0, 1), 0); // single photo, swipe locked completely
  assert.equal(computeClampedSwipeOffset(-60, 0, 3), -60); // valid advance allowed
  assert.equal(computeClampedSwipeOffset(60, 2, 3), 60); // valid retreat allowed
});

test('Firebase RTDB catalog key sanitization preserves compatibility across legacy and new keys', () => {
  assert.equal(
    sanitizeFirebaseCatalogKey('a.b#c$d/e[f]g'),
    'a_b_c_d_e_f_g',
  );
  assert.equal(
    normalizeCatalogModelKey('BARCELONA LOCAL 2026/2027 LAMINE YAMAL 10', 'Player'),
    'barcelona local 2026_2027 lamine yamal 10::Player',
  );

  // Legacy unsanitized keys still resolve cleanly via resolveCatalogPhoto & resolveCatalogKeywords
  const legacyPhotos = {
    'BARCELONA LOCAL 2026/2027 LAMINE YAMAL 10::Player': 'https://cdn.example.com/lamine.jpg',
  };
  const legacyKeywords = {
    'BARCELONA LOCAL 2026/2027 LAMINE YAMAL 10::Player': 'Lamine Yamal 10 Barca',
  };
  assert.equal(
    resolveCatalogPhoto('BARCELONA LOCAL 2026/2027 LAMINE YAMAL 10', 'Player', legacyPhotos),
    'https://cdn.example.com/lamine.jpg',
  );
  assert.equal(
    resolveCatalogKeywords('BARCELONA LOCAL 2026/2027 LAMINE YAMAL 10', 'Player', legacyKeywords),
    'Lamine Yamal 10 Barca',
  );

  // sanitizeForFirebase replaces forbidden RTDB key chars recursively
  const dirtyState = createDemoSeedState();
  dirtyState.catalogPhotos = {
    'barcelona local 2026/2027 lamine yamal 10::Player': 'https://cdn.example.com/lamine.jpg',
  };
  dirtyState.catalogKeywords = {
    'real madrid 25/26 [edición].#1$::Fans': 'Mbappe Bellingham',
  };
  const sanitized = sanitizeForFirebase(dirtyState);
  assert.equal(
    sanitized.catalogPhotos?.['barcelona local 2026_2027 lamine yamal 10::Player'],
    'https://cdn.example.com/lamine.jpg',
  );
  assert.equal(
    sanitized.catalogPhotos?.['barcelona local 2026/2027 lamine yamal 10::Player'],
    undefined,
  );
  assert.equal(
    sanitized.catalogKeywords?.['real madrid 25_26 _edición___1_::Fans'],
    'Mbappe Bellingham',
  );
});

test('getModelIdentityKey unifies accent/case/whitespace and player variants with zero duplicates', () => {
  const k1 = getModelIdentityKey({
    model: 'BAYERN DE MÚNICH LOCAL 2026/2027',
    version: 'Player',
  });
  const k2 = getModelIdentityKey({
    model: '  bayern   de munich local 2026/2027 ',
    version: 'Player',
  });
  assert.equal(k1, k2);

  const p1 = getModelIdentityKey({
    model: 'Real Madrid Local 25/26 · Bellingham #5',
    version: 'Fans',
  });
  const p2 = getModelIdentityKey({
    model: 'Real Madrid Local 25/26',
    version: 'Fans',
    player: 'bellingham #5',
  });
  assert.equal(p1, p2);

  const emptyState = createEmptyCleanState();
  emptyState.inventory = [
    {
      id: 'inv-1',
      team: 'Bayern',
      model: 'BAYERN DE MÚNICH LOCAL 26/27',
      version: 'Fans',
      size: 'M',
      stock: 0,
      cogs: 8,
      salePrice: 25,
      fifoBatches: [],
      imageUrl: 'https://cdn.example.com/bayern-old.jpg',
    },
    {
      id: 'inv-2',
      team: 'Bayern',
      model: 'Bayern de Munich Local 26/27',
      version: 'Fans',
      size: 'L',
      stock: 4,
      cogs: 9,
      salePrice: 25,
      fifoBatches: [
        {
          batchId: 'b-1',
          batchName: 'Lote Bayern',
          entryDate: '2026-11-01',
          initialQuantity: 4,
          remainingQuantity: 4,
          unitCost: 9,
        },
      ],
    },
  ];

  // Matrix rows consolidate accent/case duplicates into 1 unified row
  const rawMatrix = getInventorySizeMatrix(emptyState.inventory, 5);
  const consolidated = consolidateMatrixRowsByModelIdentity(rawMatrix, 5);
  assert.equal(consolidated.length, 1);
  assert.equal(consolidated[0].totalStock, 4);
  assert.equal(consolidated[0].sizes.L, 4);
  assert.equal(consolidated[0].sizes.M, 0);

  // Public catalog groups resolve inherited photo even though stock=0 record held it
  const groups = buildPublicCatalogGroups(emptyState);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].products.length, 1);
  assert.equal(
    groups[0].products[0].photoUrl,
    'https://cdn.example.com/bayern-old.jpg',
  );
});

test('resolveModelPhotoAnywhere finds photo across draft map, catalogPhotos, 0-stock inventory, purchaseBatches, and purchases', () => {
  const state = createEmptyCleanState();
  state.inventory = [
    {
      id: 'sku-zero',
      team: 'Barcelona',
      model: 'BARCELONA LOCAL 26/27',
      version: 'Player',
      size: 'S',
      stock: 0,
      cogs: 10,
      salePrice: 30,
      fifoBatches: [],
      imageUrl: 'https://cdn.example.com/barca-zero.jpg',
    },
  ];

  assert.equal(
    resolveModelPhotoAnywhere(state, {
      model: 'barcelona local 26/27',
      version: 'Player',
    }),
    'https://cdn.example.com/barca-zero.jpg',
  );

  // Draft map takes precedence before saving
  const idKey = getModelIdentityKey({
    model: 'PSG Visitante 26/27',
    version: 'Fans',
  });
  assert.equal(
    resolveModelPhotoAnywhere(
      state,
      { model: 'PSG Visitante 26/27', version: 'Fans' },
      { [idKey]: 'https://cdn.example.com/psg-draft.jpg' },
    ),
    'https://cdn.example.com/psg-draft.jpg',
  );
});

test('propagateModelPhotosAfterBatchMutation propagates new photos to 0-stock prior lots and inherits existing photos automatically', () => {
  const base = createEmptyCleanState();
  base.cashOnHand = 500;
  base.funds.replacement = 500;
  base.inventory = [
    {
      id: 'inv-zero-1',
      team: 'Manchester City',
      model: 'MANCHESTER CITY LOCAL 26/27',
      version: 'Fans',
      size: 'M',
      stock: 0,
      cogs: 8,
      salePrice: 25,
      fifoBatches: [],
    },
  ];

  // Scenario A: 0-stock model without photo gets new photo on direct purchase
  const newKey = getModelIdentityKey({
    model: 'Manchester City Local 26/27',
    version: 'Fans',
  });
  const regNewRes = registerImportBatch(base, {
    entryDate: '2026-11-20',
    receivedDate: '2026-11-20',
    referenceName: 'Directo City',
    shippingType: 'Aéreo',
    totalFreightCost: 0,
    fundingSource: 'replacement',
    isDirectReception: true,
    items: [
      {
        team: 'Manchester City',
        model: 'Manchester City Local 26/27',
        version: 'Fans',
        size: 'L',
        quantity: 3,
        factoryUnitCost: 6,
        salePrice: 25,
      },
    ],
  });
  assert.equal(regNewRes.ok, true);

  const syncedNew = propagateModelPhotosAfterBatchMutation(regNewRes.state, {
    targetBatch: regNewRes.createdBatch,
    priorState: base,
    modelPhotos: {
      [newKey]: {
        model: 'Manchester City Local 26/27',
        version: 'Fans',
        photoUrl: 'https://cdn.example.com/city-new.jpg',
      },
    },
  });

  // Propagated to catalogPhotos, prior 0-stock item, and newly created SKU
  assert.equal(
    syncedNew.catalogPhotos?.[newKey],
    'https://cdn.example.com/city-new.jpg',
  );
  assert.equal(syncedNew.inventory.length, 2);
  for (const inv of syncedNew.inventory) {
    assert.equal(inv.imageUrl, 'https://cdn.example.com/city-new.jpg');
  }

  // Scenario B: Model ALREADY has a photo; new transit batch without photo inherits it automatically on creation & reception
  const transitRes = registerImportBatch(syncedNew, {
    entryDate: '2026-11-22',
    referenceName: 'Aereo City Reposicion',
    shippingType: 'Aéreo',
    totalFreightCost: 5,
    fundingSource: 'replacement',
    isDirectReception: false,
    items: [
      {
        team: 'Manchester City',
        model: 'MANCHESTER CITY LOCAL 26/27',
        version: 'Fans',
        size: 'XL',
        quantity: 2,
        factoryUnitCost: 6,
        salePrice: 25,
      },
    ],
  });
  assert.equal(transitRes.ok, true);

  const transitSynced = propagateModelPhotosAfterBatchMutation(
    transitRes.state,
    {
      targetBatch: transitRes.createdBatch,
      priorState: syncedNew,
    },
  );
  const createdTransitBatch = transitSynced.purchaseBatches.find(
    (b) => b.id === transitRes.createdBatch?.id,
  );
  assert.equal(
    createdTransitBatch?.items[0].imageUrl,
    'https://cdn.example.com/city-new.jpg',
  );

  // Receive transit batch -> new XL SKU also inherits the imageUrl
  const recvRes = receiveImportBatch(transitSynced, {
    batchId: transitRes.createdBatch!.id,
    receivedDate: '2026-11-27',
    actualFreightCost: 5,
    receivedItems: [{ itemIndex: 0, receivedQuantity: 2, salePrice: 25 }],
  });
  assert.equal(recvRes.ok, true);
  const recvSynced = propagateModelPhotosAfterBatchMutation(recvRes.state, {
    targetBatch: recvRes.createdBatch,
    priorState: transitSynced,
  });
  const xlSku = recvSynced.inventory.find((i) => i.size === 'XL');
  assert.equal(xlSku?.imageUrl, 'https://cdn.example.com/city-new.jpg');

  // Centralized photo removal clears catalogPhotos, inventory (even stock 0), batches, and purchases
  const cleared = applyCatalogPhotoMutation(recvSynced, {
    modelKey: newKey,
    photoUrl: '',
  });
  assert.equal(cleared.catalogPhotos?.[newKey], undefined);
  assert.equal(
    resolveModelPhotoAnywhere(cleared, {
      model: 'Manchester City Local 26/27',
      version: 'Fans',
    }),
    undefined,
  );
  assert.equal(
    cleared.inventory.some((i) => Boolean(i.imageUrl)),
    false,
  );
});


