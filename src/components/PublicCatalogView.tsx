import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Share2,
  Shield,
  ShoppingBag,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import type { AppState, JerseySize, JerseyVersion, TeamCategory } from '../types/erp';
import {
  ALL_JERSEY_SIZES,
  compareJerseySizes,
  formatUSD,
  formatVES,
  round2,
} from '../utils/finance';
import {
  addItemToPublicCart,
  advanceWhatsAppTurnIndex,
  buildCatalogMultiItemWhatsAppHref,
  buildCatalogWhatsAppHref,
  buildPublicCartItemId,
  buildPublicCatalogGroups,
  buildUpcomingTransitCards,
  calculateCatalogBsPrice,
  calculatePublicCartTotals,
  clampCatalogCarouselIndex,
  computeClampedSwipeOffset,
  filterPublicCatalogGroups,
  filterUpcomingTransitCards,
  getCurrentWhatsAppTurnIndex,
  getPublicCatalogShareUrl,
  isRateValid,
  loadPublicCartFromSession,
  normalizarUrlImagen,
  obtenerFallbackUrlImagen,
  parseCatalogImageList,
  removeItemFromPublicCart,
  savePublicCartToSession,
  syncPublicCartWithCatalogGroups,
  updatePublicCartItemQty,
  type PublicCartCandidate,
  type PublicCartItem,
  type PublicCatalogProduct,
  type PublicCatalogTeamGroup,
  type PublicTransitCard,
} from '../utils/publicCatalog';
import { X4SPORT_LOGO_SRC } from '../utils/receiptJpg';
import { JerseyShowcaseFallback, TeamCrest } from './TeamCrest';

interface PublicCatalogViewProps {
  state: AppState;
  isPreviewMode?: boolean;
  onExitPreview?: () => void;
  onGoToPartnerLogin?: () => void;
}

type VersionFilter = 'Todas' | 'Player' | 'Fans' | 'Retro';
type SizeFilter = 'Todas' | JerseySize;

const VERSION_FILTERS: VersionFilter[] = ['Todas', 'Player', 'Fans', 'Retro'];

type SlideLoadStage = 'primary' | 'thumbnail' | 'failed';

const SWIMLANE_CARD_SIZE_CLASSES =
  'w-[46%] min-w-[148px] max-w-[205px] shrink-0 snap-start sm:w-[225px] sm:max-w-none lg:w-[255px]';

function isPriorityCatalogTeam(team: TeamCategory): boolean {
  const normalized = team.trim().toLowerCase();
  return normalized === 'barcelona' || normalized === 'real madrid';
}

function ProductImageGallery({
  images,
  photoUrl,
  team,
  model,
  version,
  isTransit = false,
}: {
  images?: string[];
  photoUrl?: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  isTransit?: boolean;
}) {
  const normalizedImages = useMemo(() => {
    const rawList =
      images && images.length > 0
        ? images
        : photoUrl
          ? parseCatalogImageList(photoUrl)
          : [];
    return rawList.map((u) => normalizarUrlImagen(u)).filter(Boolean);
  }, [images, photoUrl]);

  const total = normalizedImages.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [slideStages, setSlideStages] = useState<Record<number, SlideLoadStage>>({});
  const [zoomLevel, setZoomLevel] = useState<0 | 1 | 2>(0);
  const [zoomOrigin, setZoomOrigin] = useState<{ x: number; y: number }>({
    x: 50,
    y: 50,
  });

  const galleryRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);
  const tapMovedRef = useRef(false);
  const lastTouchTimeRef = useRef(0);
  const safeIndex = clampCatalogCarouselIndex(activeIndex, total);

  const resolveSlideSrc = (index: number, baseUrl: string): string | null => {
    const stage = slideStages[index] ?? 'primary';
    if (stage === 'failed') return null;
    if (stage === 'thumbnail') {
      return obtenerFallbackUrlImagen(baseUrl);
    }
    return normalizarUrlImagen(baseUrl);
  };

  const currentSrc =
    total > 0 && normalizedImages[safeIndex]
      ? resolveSlideSrc(safeIndex, normalizedImages[safeIndex])
      : null;

  useEffect(() => {
    setZoomLevel(0);
  }, [model, version, photoUrl, safeIndex]);

  useEffect(() => {
    if (zoomLevel === 0) return;
    const handleScrollReset = () => {
      setZoomLevel(0);
    };
    window.addEventListener('scroll', handleScrollReset, {
      passive: true,
      capture: true,
    });
    return () => {
      window.removeEventListener('scroll', handleScrollReset, {
        capture: true,
      });
    };
  }, [zoomLevel]);

  const computeOriginFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = galleryRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
      return { x, y };
    },
    [],
  );

  const handleSlideError = (index: number, baseUrl: string) => {
    setSlideStages((prev) => {
      const current = prev[index] ?? 'primary';
      if (current === 'primary') {
        const thumbFallback = obtenerFallbackUrlImagen(baseUrl);
        if (thumbFallback) {
          return { ...prev, [index]: 'thumbnail' };
        }
      }
      return { ...prev, [index]: 'failed' };
    });
  };

  const goToIndex = (nextIdx: number) => {
    setZoomLevel(0);
    setActiveIndex(clampCatalogCarouselIndex(nextIdx, total));
  };

  const beginSwipe = (clientX: number, clientY: number) => {
    if (total <= 1) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: clientX, y: clientY };
    setIsDragging(true);
  };

  const moveSwipe = (clientX: number, clientY: number) => {
    if (!swipeStartRef.current || total <= 1) return;
    const dx = clientX - swipeStartRef.current.x;
    const dy = clientY - swipeStartRef.current.y;
    // Ignore vertical scroll gestures
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dragOffsetPx) < 4) {
      return;
    }
    const clamped = computeClampedSwipeOffset(dx, safeIndex, total);
    setDragOffsetPx(clamped);
  };

  const endSwipe = () => {
    if (!swipeStartRef.current) {
      setIsDragging(false);
      setDragOffsetPx(0);
      return;
    }
    if (total > 1) {
      const threshold = 40;
      if (dragOffsetPx <= -threshold && safeIndex < total - 1) {
        goToIndex(safeIndex + 1);
      } else if (dragOffsetPx >= threshold && safeIndex > 0) {
        goToIndex(safeIndex - 1);
      }
    }
    swipeStartRef.current = null;
    setIsDragging(false);
    setDragOffsetPx(0);
  };

  const isZoomActive = zoomLevel > 0;

  return (
    <div
      ref={galleryRef}
      data-testid="product-image-gallery"
      data-zoomed={isZoomActive ? 'true' : 'false'}
      data-zoom-level={String(zoomLevel)}
      className={`relative aspect-[4/5] w-full overflow-hidden bg-[#070D19] select-none ${
        isZoomActive && currentSrc
          ? `touch-none ${zoomLevel === 2 ? 'cursor-zoom-out' : 'cursor-zoom-in'}`
          : `${total > 1 ? 'touch-pan-y' : 'touch-pan-x touch-pan-y'} ${
              currentSrc ? 'cursor-zoom-in' : ''
            }`
      }`}
      onMouseMove={(e) => {
        if (!currentSrc) return;
        if (Date.now() - lastTouchTimeRef.current < 600) return;
        const origin = computeOriginFromPoint(e.clientX, e.clientY);
        if (origin) {
          setZoomOrigin(origin);
          if (zoomLevel === 0) setZoomLevel(1);
        }
      }}
      onMouseLeave={() => {
        if (Date.now() - lastTouchTimeRef.current < 600) return;
        setZoomLevel(0);
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (!t) return;
        lastTouchTimeRef.current = Date.now();
        tapStartRef.current = { x: t.clientX, y: t.clientY };
        tapMovedRef.current = false;
        if (isZoomActive && currentSrc) {
          e.stopPropagation();
          return;
        }
        beginSwipe(t.clientX, t.clientY);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (!t) return;
        lastTouchTimeRef.current = Date.now();
        if (tapStartRef.current) {
          const dist = Math.hypot(
            t.clientX - tapStartRef.current.x,
            t.clientY - tapStartRef.current.y,
          );
          if (dist >= 8) {
            tapMovedRef.current = true;
          }
        }
        if (isZoomActive && currentSrc) {
          e.stopPropagation();
          const origin = computeOriginFromPoint(t.clientX, t.clientY);
          if (origin) setZoomOrigin(origin);
          return;
        }
        moveSwipe(t.clientX, t.clientY);
      }}
      onTouchEnd={(e) => {
        lastTouchTimeRef.current = Date.now();
        const isCleanTap = Boolean(tapStartRef.current && !tapMovedRef.current);
        const startPt = tapStartRef.current;
        tapStartRef.current = null;
        tapMovedRef.current = false;

        if (isZoomActive && currentSrc) {
          e.stopPropagation();
          if (isCleanTap) {
            if (zoomLevel === 1) {
              const changed = e.changedTouches[0];
              const px = changed?.clientX ?? startPt?.x;
              const py = changed?.clientY ?? startPt?.y;
              if (px !== undefined && py !== undefined) {
                const origin = computeOriginFromPoint(px, py);
                if (origin) setZoomOrigin(origin);
              }
              setZoomLevel(2);
            } else {
              setZoomLevel(0);
            }
          }
          return;
        }

        endSwipe();

        if (isCleanTap && currentSrc) {
          const changed = e.changedTouches[0];
          const px = changed?.clientX ?? startPt?.x;
          const py = changed?.clientY ?? startPt?.y;
          if (px !== undefined && py !== undefined) {
            const origin = computeOriginFromPoint(px, py);
            if (origin) setZoomOrigin(origin);
          }
          setZoomLevel(1);
        }
      }}
      onTouchCancel={() => {
        tapStartRef.current = null;
        tapMovedRef.current = false;
        endSwipe();
      }}
      onClick={(e) => {
        if (!currentSrc) return;
        if (Date.now() - lastTouchTimeRef.current < 600) return;
        const origin = computeOriginFromPoint(e.clientX, e.clientY);
        if (origin) setZoomOrigin(origin);
        setZoomLevel((prev) => (prev === 0 ? 1 : prev === 1 ? 2 : 1));
      }}
    >
      {total === 0 ? (
        <JerseyShowcaseFallback team={team} model={model} version={version} />
      ) : (
        <div
          className={`flex h-full w-full ${
            isDragging ? '' : 'transition-transform duration-200 ease-out'
          }`}
          style={{
            transform: `translateX(calc(-${safeIndex * 100}% + ${dragOffsetPx}px))`,
          }}
        >
          {normalizedImages.map((imgUrl, idx) => {
            const resolvedSrc = resolveSlideSrc(idx, imgUrl);
            const slideZoomLevel: 0 | 1 | 2 =
              idx === safeIndex && resolvedSrc ? zoomLevel : 0;
            const slideScaleClass =
              slideZoomLevel === 2
                ? 'duration-75 scale-[3.8]'
                : slideZoomLevel === 1
                  ? 'duration-75 scale-[2.35]'
                  : 'duration-200 scale-100';
            return (
              <div
                key={`${imgUrl}-${idx}`}
                className="flex h-full w-full shrink-0 items-center justify-center overflow-hidden bg-[#070D19]"
              >
                {resolvedSrc ? (
                  <img
                    src={resolvedSrc}
                    alt={`${model} (${version})${isTransit ? ' en camino' : ''} · foto ${idx + 1} de ${total}`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    draggable={false}
                    onError={() => handleSlideError(idx, imgUrl)}
                    style={{
                      transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                    }}
                    className={`h-full w-full object-contain p-1.5 sm:p-2 transition-transform ease-out ${slideScaleClass} ${
                      isTransit ? 'opacity-90' : ''
                    }`}
                  />
                ) : (
                  <JerseyShowcaseFallback
                    team={team}
                    model={model}
                    version={version}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Indicador 1 / N */}
      {total > 0 && (
        <span
          data-testid="gallery-counter"
          className="font-mono-num pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm sm:right-2.5 sm:top-2.5 sm:px-2 sm:text-[11px]"
        >
          {safeIndex + 1} / {total}
        </span>
      )}

      {/* Indicador / botón discreto de lupa de 2 niveles en la esquina inferior izquierda (solo fotos reales) */}
      {currentSrc && (
        <button
          type="button"
          data-testid="gallery-zoom-btn"
          aria-label={
            zoomLevel === 0
              ? 'Activar lupa (2.3x)'
              : zoomLevel === 1
                ? 'Aumentar lupa a 3.8x'
                : 'Desactivar lupa'
          }
          aria-pressed={isZoomActive}
          onTouchStart={(e) => {
            e.stopPropagation();
            lastTouchTimeRef.current = Date.now();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            lastTouchTimeRef.current = Date.now();
            setZoomLevel((prev) => {
              if (prev === 0) {
                setZoomOrigin({ x: 50, y: 50 });
                return 1;
              }
              if (prev === 1) {
                return 2;
              }
              return 0;
            });
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (Date.now() - lastTouchTimeRef.current < 600) return;
            setZoomLevel((prev) => {
              if (prev === 0) {
                setZoomOrigin({ x: 50, y: 50 });
                return 1;
              }
              if (prev === 1) {
                return 2;
              }
              return 0;
            });
          }}
          className={`absolute bottom-2 left-2 z-20 inline-flex items-center justify-center gap-1 rounded-full backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
            zoomLevel === 2
              ? 'px-2 py-1 bg-emerald-600/90 border border-emerald-400 text-white'
              : zoomLevel === 1
                ? 'px-2 py-1 bg-blue-600/90 border border-blue-400 text-white'
                : 'p-1.5 bg-slate-950/75 border border-slate-700/80 text-slate-200 hover:border-slate-500 hover:text-white'
          }`}
        >
          <ZoomIn className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {zoomLevel === 1 && (
            <span className="font-mono-num text-[10px] font-bold leading-none">
              2.3x
            </span>
          )}
          {zoomLevel === 2 && (
            <span className="font-mono-num text-[10px] font-bold leading-none">
              3.8x
            </span>
          )}
        </button>
      )}

      {/* Controles prev / next estrictamente limitados a [0, N-1] */}
      {total > 1 && (
        <>
          {safeIndex > 0 && (
            <button
              type="button"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                goToIndex(safeIndex - 1);
              }}
              aria-label="Foto anterior"
              className="absolute left-1.5 top-1/2 z-20 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:left-2 sm:h-9 sm:w-9"
            >
              <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            </button>
          )}
          {safeIndex < total - 1 && (
            <button
              type="button"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                goToIndex(safeIndex + 1);
              }}
              aria-label="Siguiente foto"
              className="absolute right-1.5 top-1/2 z-20 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:right-2 sm:h-9 sm:w-9"
            >
              <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            </button>
          )}
        </>
      )}

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[#0D1526]/70 to-transparent sm:h-8"
        aria-hidden="true"
      />
    </div>
  );
}

function CatalogProductCard({
  product,
  usdtRate,
  waTurnIndex,
  onWhatsAppClick,
  cartQtyByLineId,
  onAddToCart,
}: {
  product: PublicCatalogProduct;
  usdtRate: number;
  waTurnIndex: number;
  onWhatsAppClick: () => void;
  cartQtyByLineId: Map<string, number>;
  onAddToCart: (candidate: PublicCartCandidate) => void;
}) {
  const [selectedSize, setSelectedSize] = useState<JerseySize>(
    product.sizes[0]?.size ?? 'M',
  );

  const activeSizeInfo =
    product.sizes.find((s) => s.size === selectedSize) ?? product.sizes[0];
  const currentPrice = activeSizeInfo?.salePrice ?? product.minPrice;
  const currentStock = activeSizeInfo?.stock ?? product.totalStock;
  const currentSizeLabel = activeSizeInfo?.size ?? 'M';
  const lineId = buildPublicCartItemId(product.key, currentSizeLabel);
  const inCartQty = cartQtyByLineId.get(lineId) ?? 0;
  const isAtMaxStock = currentStock <= 0 || inCartQty >= currentStock;

  const { advisor, href } = buildCatalogWhatsAppHref(waTurnIndex, {
    model: product.model,
    version: product.version,
    size: currentSizeLabel,
    isTransit: false,
  });

  const handleAddClick = () => {
    if (isAtMaxStock) return;
    onAddToCart({
      modelKey: product.key,
      team: product.team,
      model: product.model,
      version: product.version,
      size: currentSizeLabel,
      unitPrice: currentPrice,
      maxStock: currentStock,
      photoUrl: product.photoUrl,
      quantityToAdd: 1,
    });
  };

  return (
    <article
      data-testid={`catalog-card-${product.key}`}
      className={`flex ${SWIMLANE_CARD_SIZE_CLASSES} flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0D1526] transition-transform duration-150 hover:-translate-y-0.5 hover:border-blue-500/45`}
    >
      <ProductImageGallery
        images={product.images}
        photoUrl={product.photoUrl}
        team={product.team}
        model={product.model}
        version={product.version}
      />

      {/* Cuerpo */}
      <div className="flex flex-1 flex-col justify-between space-y-2 p-2.5 sm:space-y-3 sm:p-4 sm:pt-2.5">
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center justify-between gap-1.5 text-[10px] font-medium text-slate-400 sm:gap-2 sm:text-[11px]">
            <span className="min-w-0 truncate">
              {product.version} · {product.team}
            </span>
            <span className="font-mono-num shrink-0 text-slate-500">
              {product.totalStock} uds
            </span>
          </div>

          <h3 className="min-h-[3.15rem] sm:min-h-[3.4rem] font-display text-[12px] sm:text-[15px] font-semibold leading-[1.3] text-white break-words">
            {product.model}
          </h3>

          {/* Selector interactivo de tallas disponibles */}
          <div>
            <span className="sr-only">Tallas disponibles</span>
            <div className="flex flex-wrap gap-1 sm:gap-1.5">
              {product.sizes.map((szOption) => {
                const isSelected = szOption.size === currentSizeLabel;
                return (
                  <button
                    key={szOption.size}
                    type="button"
                    data-testid={`size-btn-${product.key}-${szOption.size}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedSize(szOption.size)}
                    className={`min-h-[30px] min-w-[32px] rounded-md border px-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:min-h-[34px] sm:min-w-[38px] sm:px-2 sm:text-xs ${
                      isSelected
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-700 bg-[#080E1C] text-slate-300 hover:border-slate-500 hover:text-white'
                    }`}
                  >
                    {szOption.size}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Urgencia, Precio y CTAs de Pedido */}
        <div className="space-y-2 border-t border-slate-800/80 pt-2 sm:space-y-2.5 sm:pt-3">
          <div className="flex items-center justify-between gap-1.5">
            <p
              data-testid="catalog-stock-badge"
              className={`text-[11px] font-semibold sm:text-xs ${
                currentStock <= 5 ? 'text-amber-300' : 'text-emerald-300'
              }`}
            >
              ¡Quedan {currentStock} en stock!
            </p>
            {inCartQty > 0 && (
              <span
                data-testid={`catalog-in-cart-${product.key}-${currentSizeLabel}`}
                className="font-mono-num shrink-0 rounded bg-[#38bdf8]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#38bdf8]"
              >
                {inCartQty} en pedido
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0.5 sm:gap-2">
            <span
              data-testid="catalog-price-usd"
              className="font-mono-num text-base font-bold text-white sm:text-xl"
            >
              {formatUSD(currentPrice)}{' '}
              <span className="text-[10px] font-semibold text-slate-400 sm:text-xs">
                USDT
              </span>
            </span>
            {calculateCatalogBsPrice(currentPrice, usdtRate) !== null ? (
              <span
                data-testid="catalog-price-bs"
                className="font-mono-num text-[11px] font-semibold text-blue-300 sm:text-xs"
              >
                {formatVES(calculateCatalogBsPrice(currentPrice, usdtRate)!)}
              </span>
            ) : (
              <span
                data-testid="catalog-price-bs-updating"
                className="inline-flex items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 sm:px-2 sm:text-[11px]"
                title="Tasa de cambio no disponible o en actualización"
              >
                Precio en Bs en actualización
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <button
              type="button"
              data-testid={`catalog-add-btn-${product.key}`}
              disabled={isAtMaxStock}
              onClick={handleAddClick}
              className={`inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8] whitespace-nowrap sm:min-h-[42px] sm:gap-2 sm:px-3.5 sm:py-2 sm:text-sm ${
                isAtMaxStock
                  ? 'cursor-not-allowed border border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'bg-[#38bdf8] text-[#060B16] hover:bg-sky-300 active:scale-[0.99]'
              }`}
            >
              {isAtMaxStock ? (
                <span>Máx. disponible</span>
              ) : (
                <>
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" />
                  <span>Agregar al Pedido</span>
                </>
              )}
            </button>

            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="catalog-buy-btn"
              data-advisor={advisor.name}
              data-wa-number={advisor.waNumber}
              onClick={onWhatsAppClick}
              className="inline-flex min-h-[34px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700/90 bg-[#080E1C] px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition-colors hover:border-[#38bdf8]/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8] whitespace-nowrap sm:min-h-[38px] sm:gap-2 sm:px-3 sm:text-xs"
            >
              <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[#38bdf8]" aria-hidden="true" />
              <span className="sm:hidden">WhatsApp directo</span>
              <span className="hidden sm:inline">Comprar directo por WhatsApp</span>
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

function CatalogTransitCard({
  card,
  usdtRate,
  waTurnIndex,
  onWhatsAppClick,
}: {
  card: PublicTransitCard;
  usdtRate: number;
  waTurnIndex: number;
  onWhatsAppClick: () => void;
}) {
  const firstSize = card.sizes[0]?.size ?? 'M';
  const { advisor, href } = buildCatalogWhatsAppHref(waTurnIndex, {
    model: card.model,
    version: card.version,
    size: firstSize,
    isTransit: true,
  });

  return (
    <article
      data-testid={`transit-card-${card.key}`}
      className={`flex ${SWIMLANE_CARD_SIZE_CLASSES} flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0D1526] transition-transform duration-150 hover:-translate-y-0.5 hover:border-amber-500/40`}
    >
      <ProductImageGallery
        images={card.images}
        photoUrl={card.photoUrl}
        team={card.team}
        model={card.model}
        version={card.version}
        isTransit
      />

      <div className="flex flex-1 flex-col justify-between space-y-2 p-2.5 sm:space-y-3 sm:p-4 sm:pt-2.5">
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center justify-between gap-1.5 text-[10px] font-medium text-amber-300 sm:gap-2 sm:text-[11px]">
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">En camino · {card.shippingType}</span>
            </span>
            <span className="font-mono-num shrink-0 text-slate-400">
              {card.totalIncomingUnits} uds
            </span>
          </div>

          <h3 className="min-h-[3.15rem] sm:min-h-[3.4rem] font-display text-[12px] sm:text-[15px] font-semibold leading-[1.3] text-white break-words">
            {card.model}
          </h3>

          <p className="text-[11px] text-slate-400 sm:text-xs">
            {card.version} · Tallas:{' '}
            <strong className="font-mono-num text-slate-200">
              {card.sizes.map((s) => `${s.size} (${s.incomingQty})`).join(', ')}
            </strong>
          </p>

          <div className="space-y-1">
            <p
              data-testid="transit-eta-days"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 sm:gap-1.5 sm:text-xs"
            >
              <Clock className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
              {card.estimatedArrivalLabel}
            </p>
            {(card.estimatedArrivalDate || card.entryDate) && (
              <p className="flex items-center gap-1 text-[10px] text-blue-300 sm:gap-1.5 sm:text-[11px]">
                <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                {card.estimatedArrivalDate
                  ? `Llegada: ${card.estimatedArrivalDate}`
                  : `Despacho: ${card.entryDate}`}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-800/80 pt-2 sm:space-y-3 sm:pt-3">
          {card.salePrice ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0.5 sm:gap-2">
              <span
                data-testid="transit-price-usd"
                className="font-mono-num text-base font-bold text-white sm:text-lg"
              >
                {formatUSD(card.salePrice)}{' '}
                <span className="text-[10px] font-semibold text-slate-400 sm:text-xs">
                  USDT
                </span>
              </span>
              {calculateCatalogBsPrice(card.salePrice, usdtRate) !== null ? (
                <span
                  data-testid="transit-price-bs"
                  className="font-mono-num text-[11px] font-semibold text-blue-300 sm:text-xs"
                >
                  {formatVES(calculateCatalogBsPrice(card.salePrice, usdtRate)!)}
                </span>
              ) : (
                <span
                  data-testid="transit-price-bs-updating"
                  className="inline-flex items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 sm:px-2 sm:text-[11px]"
                  title="Tasa de cambio no disponible o en actualización"
                >
                  Precio en Bs en actualización
                </span>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 sm:text-xs">
              Precio referencial al llegar
            </p>
          )}

          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="catalog-reserve-btn"
            data-advisor={advisor.name}
            data-wa-number={advisor.waNumber}
            onClick={onWhatsAppClick}
            className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/45 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 whitespace-nowrap sm:min-h-[44px] sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" />
            <span className="sm:hidden">Apartar</span>
            <span className="hidden sm:inline">Apartar por WhatsApp</span>
          </a>
        </div>
      </div>
    </article>
  );
}

function SwimlaneSection({
  headingId,
  testId,
  icon,
  title,
  subtitle,
  itemCount,
  className = '',
  emptyState,
  children,
}: {
  headingId: string;
  testId: string;
  icon?: ReactNode;
  title: string;
  subtitle: ReactNode;
  itemCount: number;
  className?: string;
  emptyState?: ReactNode;
  children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(itemCount > 2);

  const syncScrollBounds = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncScrollBounds();
    const handleResize = () => syncScrollBounds();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [itemCount, syncScrollBounds]);

  const handleStepScroll = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.max(260, Math.round(el.clientWidth * 0.78));
    el.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={`w-full max-w-full min-w-0 overflow-x-clip space-y-3 ${className}`}
    >
      <div className="flex w-full max-w-full min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <h2
              id={headingId}
              className="truncate font-display text-lg font-bold tracking-tight text-white sm:text-xl"
            >
              {title}
            </h2>
            <p className="text-xs text-slate-400">{subtitle}</p>
          </div>
        </div>

        {itemCount > 2 && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap sm:hidden">
              Desliza →
            </span>
            <div className="hidden items-center gap-1.5 sm:flex">
              <button
                type="button"
                onClick={() => handleStepScroll(-1)}
                disabled={!canScrollLeft}
                aria-label={`Desplazar ${title} a la izquierda`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-[#0D1526] text-slate-300 transition-colors hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => handleStepScroll(1)}
                disabled={!canScrollRight}
                aria-label={`Desplazar ${title} a la derecha`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-[#0D1526] text-slate-300 transition-colors hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {itemCount === 0 && emptyState ? (
        emptyState
      ) : (
        <div className="w-full max-w-full min-w-0 overflow-x-clip [contain:inline-size]">
          <div
            ref={scrollerRef}
            onScroll={syncScrollBounds}
            className="no-scrollbar flex w-full max-w-full min-w-0 flex-nowrap gap-3 sm:gap-4 overflow-x-auto overscroll-x-contain touch-pan-x touch-pan-y snap-x snap-mandatory scroll-smooth pb-2"
          >
            {children}
          </div>
        </div>
      )}
    </section>
  );
}

function CartItemThumbnail({ item }: { item: PublicCartItem }) {
  const [failed, setFailed] = useState(false);
  const src = item.photoUrl ? normalizarUrlImagen(item.photoUrl) : '';
  if (!src || failed) {
    return (
      <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#070D19] p-1">
        <TeamCrest team={item.team} className="h-8 w-8" />
      </div>
    );
  }
  return (
    <div className="flex h-16 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-[#070D19] p-1">
      <img
        src={src}
        alt={`${item.model} (${item.version})`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
}

function TeamProductSection({
  group,
  usdtRate,
  waTurnIndex,
  onWhatsAppClick,
  cartQtyByLineId,
  onAddToCart,
}: {
  group: PublicCatalogTeamGroup;
  usdtRate: number;
  waTurnIndex: number;
  onWhatsAppClick: () => void;
  cartQtyByLineId: Map<string, number>;
  onAddToCart: (candidate: PublicCartCandidate) => void;
}) {
  return (
    <SwimlaneSection
      headingId={`team-row-${group.team}`}
      testId={`catalog-team-row-${group.team}`}
      icon={<TeamCrest team={group.team} className="h-8 w-8 shrink-0" />}
      title={group.team}
      subtitle={
        <>
          {group.products.length}{' '}
          {group.products.length === 1 ? 'modelo' : 'modelos'} ·{' '}
          <span className="font-mono-num text-slate-300">
            {group.totalUnits} disponibles
          </span>
        </>
      }
      itemCount={group.products.length}
    >
      {group.products.map((product) => (
        <CatalogProductCard
          key={product.key}
          product={product}
          usdtRate={usdtRate}
          waTurnIndex={waTurnIndex}
          onWhatsAppClick={onWhatsAppClick}
          cartQtyByLineId={cartQtyByLineId}
          onAddToCart={onAddToCart}
        />
      ))}
    </SwimlaneSection>
  );
}

export function PublicCatalogView({
  state,
  isPreviewMode = false,
  onExitPreview,
  onGoToPartnerLogin,
}: PublicCatalogViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('Todas');
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>('Todas');
  const [logoError, setLogoError] = useState(false);
  const [waTurnIndex, setWaTurnIndex] = useState<number>(() =>
    getCurrentWhatsAppTurnIndex(),
  );
  const [cartItems, setCartItems] = useState<PublicCartItem[]>(() =>
    loadPublicCartFromSession(),
  );
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [deliveryZone, setDeliveryZone] = useState('');

  const handleAdvanceWhatsAppTurn = () => {
    const next = advanceWhatsAppTurnIndex();
    setWaTurnIndex(next);
  };

  const usdtRate = state.exchangeRates.usdt;
  const bcvRate = state.exchangeRates.bcv;
  const catalogEnabled = state.catalogEnabled !== false;

  const teamGroups = useMemo(() => buildPublicCatalogGroups(state), [state]);
  const transitCards = useMemo(() => buildUpcomingTransitCards(state), [state]);

  // Sincronización automática de solo lectura contra el stock en vivo
  useEffect(() => {
    setCartItems((prev) => syncPublicCartWithCatalogGroups(prev, teamGroups));
  }, [teamGroups]);

  // Persistencia efímera exclusivamente en sessionStorage del navegador (cero escrituras en Firebase)
  useEffect(() => {
    savePublicCartToSession(cartItems);
  }, [cartItems]);

  useEffect(() => {
    if (cartItems.length === 0 && isCartOpen) {
      setIsCartOpen(false);
    }
  }, [cartItems.length, isCartOpen]);

  useEffect(() => {
    if (!isCartOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCartOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCartOpen]);

  const cartQtyByLineId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cartItems) {
      map.set(item.id, item.quantity);
    }
    return map;
  }, [cartItems]);

  const cartTotals = useMemo(
    () => calculatePublicCartTotals(cartItems, bcvRate),
    [cartItems, bcvRate],
  );

  const multiWhatsApp = useMemo(
    () =>
      buildCatalogMultiItemWhatsAppHref(waTurnIndex, {
        items: cartItems,
        bcvRate,
        customerName,
        deliveryZone,
      }),
    [waTurnIndex, cartItems, bcvRate, customerName, deliveryZone],
  );

  const handleAddToCart = useCallback((candidate: PublicCartCandidate) => {
    setCartItems((prev) => addItemToPublicCart(prev, candidate));
  }, []);

  const handleUpdateCartQty = useCallback((itemId: string, nextQty: number) => {
    setCartItems((prev) => updatePublicCartItemQty(prev, itemId, nextQty));
  }, []);

  const handleRemoveCartItem = useCallback((itemId: string) => {
    setCartItems((prev) => removeItemFromPublicCart(prev, itemId));
  }, []);

  const handleClearCart = useCallback(() => {
    setCartItems([]);
    setIsCartOpen(false);
  }, []);

  const availableSizeFilters = useMemo<SizeFilter[]>(() => {
    const present = new Set<JerseySize>(ALL_JERSEY_SIZES);
    for (const grp of teamGroups) {
      for (const prod of grp.products) {
        for (const sz of prod.sizes) {
          present.add(sz.size);
        }
      }
    }
    for (const card of transitCards) {
      for (const sz of card.sizes) {
        present.add(sz.size);
      }
    }
    const sorted = Array.from(present).sort(compareJerseySizes);
    return ['Todas', ...sorted];
  }, [teamGroups, transitCards]);

  const filteredGroups = useMemo(
    () =>
      filterPublicCatalogGroups(
        teamGroups,
        searchQuery,
        versionFilter,
        sizeFilter,
      ),
    [searchQuery, sizeFilter, teamGroups, versionFilter],
  );

  const { individualGroups, otherTeamsProducts, otherTeamsTotalUnits } = useMemo(() => {
    const individual: PublicCatalogTeamGroup[] = [];
    const otherProducts: PublicCatalogProduct[] = [];
    let otherUnits = 0;

    for (const group of filteredGroups) {
      if (isPriorityCatalogTeam(group.team) || group.products.length >= 3) {
        individual.push(group);
      } else {
        otherProducts.push(...group.products);
        otherUnits += group.totalUnits;
      }
    }

    return {
      individualGroups: individual,
      otherTeamsProducts: otherProducts,
      otherTeamsTotalUnits: otherUnits,
    };
  }, [filteredGroups]);

  const filteredTransitCards = useMemo(
    () =>
      filterUpcomingTransitCards(
        transitCards,
        searchQuery,
        versionFilter,
        sizeFilter,
      ),
    [searchQuery, sizeFilter, transitCards, versionFilter],
  );

  const totalAvailableUnits = useMemo(
    () => teamGroups.reduce((sum, g) => sum + g.totalUnits, 0),
    [teamGroups],
  );

  const totalIncomingUnits = useMemo(
    () => transitCards.reduce((sum, c) => sum + c.totalIncomingUnits, 0),
    [transitCards],
  );

  const shareCatalogUrl = useMemo(() => getPublicCatalogShareUrl(), []);
  const shareCatalogWhatsAppHref = useMemo(
    () =>
      `https://wa.me/?text=${encodeURIComponent(
        `⚽ ¡Revisa el catálogo oficial actualizado en tiempo real de camisetas X4SPORT! ${shareCatalogUrl}`,
      )}`,
    [shareCatalogUrl],
  );

  const fallbackContact = buildCatalogWhatsAppHref(waTurnIndex, {
    model: 'Catálogo X4SPORT',
    version: 'Player',
    size: 'M',
  });

  return (
    <div
      data-testid="public-catalog-storefront"
      className="erp-catalog-shell min-h-screen w-full max-w-full min-w-0 overflow-x-clip bg-[#060B16] text-slate-100"
    >
      {/* Barra superior fija con Logo X4SPORT y Tasa vigente (compacta <15% móvil) */}
      <header className="sticky top-0 z-40 w-full max-w-full min-w-0 overflow-x-clip border-b border-slate-800/90 bg-[#060B16]/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
          <div className="flex items-center gap-2 min-w-0">
            {!logoError ? (
              <img
                src={X4SPORT_LOGO_SRC}
                alt="Logo X4SPORT"
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="h-8 w-8 rounded-lg object-cover border border-slate-700 shrink-0"
              />
            ) : null}
            <span className="font-display text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
              X4<span className="text-blue-400">SPORT</span>
            </span>
          </div>

          <div
            data-testid="catalog-rate-bar"
            className="flex min-w-0 items-center gap-1.5 text-xs text-slate-200 whitespace-nowrap"
          >
            <span className="hidden sm:inline text-slate-400">
              Tasa USDT hoy (Ref. Bs):
            </span>
            <span className="sm:hidden text-slate-400">USDT:</span>
            {isRateValid(usdtRate) ? (
              <strong className="font-mono-num text-xs sm:text-sm font-bold text-blue-300 truncate">
                Bs. {usdtRate.toFixed(2)}
              </strong>
            ) : (
              <span className="text-[11px] text-amber-300 font-medium">
                En actualización
              </span>
            )}
          </div>

          {isPreviewMode && onExitPreview && (
            <button
              type="button"
              data-testid="btn-exit-catalog-preview"
              onClick={onExitPreview}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Volver al ERP</span>
              <span className="sm:hidden">Volver</span>
            </button>
          )}
        </div>
      </header>

      {!catalogEnabled ? (
        <main className="mx-auto flex w-full max-w-full min-w-0 overflow-x-clip flex-col items-center justify-center px-4 py-16 text-center sm:max-w-2xl">
          <div className="w-full rounded-2xl border border-slate-800 bg-[#0D1526] p-6 sm:p-8 space-y-4">
            <ShoppingBag
              className="mx-auto h-10 w-10 text-blue-400"
              aria-hidden="true"
            />
            <h1 className="font-display text-2xl font-bold text-white text-balance">
              Catálogo Temporalmente en Actualización
            </h1>
            <p className="text-sm text-slate-400">
              Estamos actualizando nuestro inventario en vivo en Guacara. Escríbenos directamente por WhatsApp para consultar tallas y modelos disponibles hoy.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <a
                href={fallbackContact.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleAdvanceWhatsAppTurn}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Consultar por WhatsApp
              </a>
              {isPreviewMode && onExitPreview && (
                <button
                  type="button"
                  onClick={onExitPreview}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-700 bg-[#080E1C] px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  Volver al Panel Admin
                </button>
              )}
              {!isPreviewMode && onGoToPartnerLogin && (
                <button
                  type="button"
                  data-testid="btn-partner-access-login"
                  onClick={onGoToPartnerLogin}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#080E1C] px-4 py-2.5 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Acceso Socios
                </button>
              )}
            </div>
          </div>
        </main>
      ) : (
        <main
          className={`mx-auto w-full max-w-full min-w-0 overflow-x-clip space-y-8 px-3 py-5 sm:space-y-10 sm:px-6 sm:py-8 xl:max-w-7xl ${
            cartTotals.totalItems > 0 ? 'pb-24 sm:pb-28' : ''
          }`}
        >
          {/* Hero compacto + Buscador Inteligente */}
          <section className="w-full max-w-full min-w-0 overflow-x-clip space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0D172B] via-[#0B1222] to-[#080D19] p-4 sm:space-y-5 sm:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <h1 className="font-display text-xl font-bold tracking-tight text-white sm:text-3xl text-balance">
                  Catálogo Oficial de Camisetas X4SPORT
                </h1>
                <p className="text-xs sm:text-sm text-slate-300">
                  Stock en tiempo real · Guacara, Carabobo · Pagos vía Binance USDT, Zelle, Efectivo ($) y Bolívares (Tasa USDT).
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-300 shrink-0">
                <span>
                  <strong className="font-mono-num text-white">
                    {totalAvailableUnits}
                  </strong>{' '}
                  disponibles hoy
                </span>
                {totalIncomingUnits > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <span>
                      <strong className="font-mono-num text-amber-300">
                        {totalIncomingUnits}
                      </strong>{' '}
                      en camino
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Barra de búsqueda inteligente */}
            <div className="relative w-full min-w-0">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <label htmlFor="catalog-search-input" className="sr-only">
                Buscar camisetas por modelo, jugador, talla o versión
              </label>
              <input
                id="catalog-search-input"
                data-testid="catalog-search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar modelo, jugador, talla (M, L, XL) o versión..."
                className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#060B16] pl-10 pr-10 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Controles rápidos de filtro: Versión & Talla */}
            <div className="flex w-full min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-slate-400 whitespace-nowrap">
                  Versión:
                </span>
                {VERSION_FILTERS.map((ver) => {
                  const active = versionFilter === ver;
                  return (
                    <button
                      key={ver}
                      type="button"
                      data-testid={`filter-version-${ver}`}
                      aria-pressed={active}
                      onClick={() => setVersionFilter(ver)}
                      className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-800 bg-[#080E1C] text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {ver}
                    </button>
                  );
                })}
              </div>

              <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 lg:justify-end">
                <span className="mr-1 text-xs font-medium text-slate-400 whitespace-nowrap">
                  Talla:
                </span>
                {availableSizeFilters.map((sz) => {
                  const active = sizeFilter === sz;
                  return (
                    <button
                      key={sz}
                      type="button"
                      data-testid={`filter-size-${sz}`}
                      aria-pressed={active}
                      onClick={() => setSizeFilter(sz)}
                      className={`min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-800 bg-[#080E1C] text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {sz}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Secciones por Equipo: carruseles horizontales apilados verticalmente */}
          {filteredGroups.length === 0 ? (
            <section className="w-full max-w-full min-w-0 overflow-x-clip rounded-xl border border-slate-800 bg-[#0D1526] p-8 text-center space-y-3">
              <p className="text-base font-semibold text-white">
                {teamGroups.length === 0
                  ? 'No hay franelas en stock inmediato en este momento'
                  : 'Ninguna camiseta coincide con tu búsqueda'}
              </p>
              <p className="text-xs text-slate-400">
                {teamGroups.length === 0
                  ? 'Revisa la sección de Próximamente / En Camino o escríbenos por WhatsApp para encargos.'
                  : 'Prueba otro nombre de equipo, jugador, versión o talla.'}
              </p>
              {(searchQuery || versionFilter !== 'Todas' || sizeFilter !== 'Todas') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setVersionFilter('Todas');
                    setSizeFilter('Todas');
                  }}
                  className="inline-flex min-h-[40px] items-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  Mostrar todo el catálogo
                </button>
              )}
            </section>
          ) : (
            <div className="w-full max-w-full min-w-0 overflow-x-clip space-y-7 sm:space-y-9">
              {individualGroups.map((group) => (
                <TeamProductSection
                  key={group.team}
                  group={group}
                  usdtRate={usdtRate}
                  waTurnIndex={waTurnIndex}
                  onWhatsAppClick={handleAdvanceWhatsAppTurn}
                  cartQtyByLineId={cartQtyByLineId}
                  onAddToCart={handleAddToCart}
                />
              ))}

              {otherTeamsProducts.length > 0 && (
                <SwimlaneSection
                  headingId="team-row-otros-equipos"
                  testId="catalog-team-row-otros"
                  icon={
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/15 text-blue-300"
                      aria-hidden="true"
                    >
                      <Shield className="h-4 w-4" />
                    </div>
                  }
                  title="Otros Equipos y Selecciones"
                  subtitle={
                    <>
                      {otherTeamsProducts.length}{' '}
                      {otherTeamsProducts.length === 1 ? 'modelo' : 'modelos'} ·{' '}
                      <span className="font-mono-num text-slate-300">
                        {otherTeamsTotalUnits} disponibles
                      </span>
                    </>
                  }
                  itemCount={otherTeamsProducts.length}
                >
                  {otherTeamsProducts.map((product) => (
                    <CatalogProductCard
                      key={product.key}
                      product={product}
                      usdtRate={usdtRate}
                      waTurnIndex={waTurnIndex}
                      onWhatsAppClick={handleAdvanceWhatsAppTurn}
                      cartQtyByLineId={cartQtyByLineId}
                      onAddToCart={handleAddToCart}
                    />
                  ))}
                </SwimlaneSection>
              )}
            </div>
          )}

          {/* Sección separada: Próximamente / En Camino (Lotes en Tránsito) */}
          <SwimlaneSection
            headingId="upcoming-transit-heading"
            testId="catalog-upcoming-section"
            title="Próximamente / En Camino"
            subtitle="Modelos de próximos envíos internacionales listos para apartar por WhatsApp antes de que lleguen a bodega."
            itemCount={filteredTransitCards.length}
            className="border-t border-slate-800/90 pt-8"
            emptyState={
              <div className="rounded-xl border border-dashed border-slate-800 bg-[#0D1526]/60 p-6 text-center text-xs text-slate-400">
                {transitCards.length === 0
                  ? 'No hay envíos en tránsito pendientes por llegar en este momento.'
                  : 'Ningún modelo en camino coincide con el filtro actual.'}
              </div>
            }
          >
            {filteredTransitCards.map((card) => (
              <CatalogTransitCard
                key={card.key}
                card={card}
                usdtRate={usdtRate}
                waTurnIndex={waTurnIndex}
                onWhatsAppClick={handleAdvanceWhatsAppTurn}
              />
            ))}
          </SwimlaneSection>

          <footer className="flex flex-col items-center justify-between gap-3 border-t border-slate-800/80 pt-6 pb-8 text-center text-xs text-slate-500 sm:flex-row sm:text-left">
            <span>
              X4SPORT · Indumentaria Deportiva · Guacara, Carabobo, Venezuela
            </span>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href={shareCatalogWhatsAppHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="catalog-share-whatsapp-btn"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0D1526] px-3 py-1.5 text-[11px] font-medium text-[#38bdf8] transition-colors hover:border-[#38bdf8]/50 hover:text-sky-300"
              >
                <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Compartir Catálogo por WhatsApp
              </a>
              {!isPreviewMode && onGoToPartnerLogin && (
                <button
                  type="button"
                  data-testid="btn-partner-access-login"
                  onClick={onGoToPartnerLogin}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 underline decoration-slate-700 transition-colors hover:text-slate-300"
                >
                  <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Acceso Socios
                </button>
              )}
            </div>
          </footer>
        </main>
      )}

      {/* Barra flotante inferior del Carrito Multi-Prenda */}
      {catalogEnabled && cartTotals.totalItems > 0 && (
        <div
          data-testid="catalog-cart-floating-bar"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-[#060B16]/95 backdrop-blur-md shadow-[0_-10px_30px_rgba(0,0,0,0.65)]"
        >
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-3 py-2.5 sm:px-6 sm:py-3">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/15 text-[#38bdf8]">
                <ShoppingBag className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-200 sm:text-sm">
                  <span className="font-mono-num text-white">
                    {cartTotals.totalItems}
                  </span>{' '}
                  {cartTotals.totalItems === 1 ? 'prenda' : 'prendas'} en tu pedido
                </p>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    data-testid="cart-floating-total-usd"
                    className="font-mono-num text-sm font-bold text-[#38bdf8] sm:text-base"
                  >
                    {formatUSD(cartTotals.totalUsd)} USD
                  </span>
                  {cartTotals.totalBs !== null && (
                    <span className="hidden font-mono-num text-xs text-slate-400 sm:inline">
                      · {formatVES(cartTotals.totalBs)} (BCV)
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              data-testid="catalog-view-order-btn"
              onClick={() => setIsCartOpen(true)}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[#38bdf8] px-4 py-2 text-xs font-bold text-[#060B16] transition-colors hover:bg-sky-300 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8] whitespace-nowrap sm:px-5 sm:text-sm"
            >
              Ver Pedido →
            </button>
          </div>
        </div>
      )}

      {/* Modal / Drawer Resumen de Pedido Multi-Prenda */}
      {isCartOpen && cartItems.length > 0 && (
        <div
          data-testid="catalog-cart-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="catalog-cart-modal-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsCartOpen(false);
            }
          }}
        >
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-800 bg-[#0D1526] text-slate-100 shadow-2xl sm:rounded-2xl">
            {/* Encabezado Modal */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3.5 sm:px-5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#38bdf8]/40 bg-[#38bdf8]/15 text-[#38bdf8]">
                  <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="catalog-cart-modal-title"
                    className="truncate font-display text-base font-bold text-white sm:text-lg"
                  >
                    Resumen de tu Pedido
                  </h2>
                  <p className="text-xs text-slate-400">
                    {cartTotals.totalItems}{' '}
                    {cartTotals.totalItems === 1 ? 'prenda seleccionada' : 'prendas seleccionadas'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Cerrar resumen de pedido"
                onClick={() => setIsCartOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#080E1C] text-slate-300 hover:border-slate-600 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Lista de prendas + campos opcionales */}
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
              <ul className="space-y-3">
                {cartItems.map((item) => {
                  const isAtCap = item.quantity >= item.maxStock;
                  const lineSubtotal = round2(item.unitPrice * item.quantity);
                  return (
                    <li
                      key={item.id}
                      data-testid={`cart-item-row-${item.id}`}
                      className="flex items-start gap-3 rounded-xl border border-slate-800 bg-[#080E1C] p-3"
                    >
                      <CartItemThumbnail item={item} />

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-snug text-white break-words">
                              {item.model}
                            </p>
                            <p className="text-xs text-slate-400">
                              {item.version}
                              {item.player ? ` · ${item.player}` : ''} ·{' '}
                              <span className="font-semibold text-[#38bdf8]">
                                Talla {item.size}
                              </span>
                            </p>
                          </div>
                          <button
                            type="button"
                            data-testid={`cart-remove-${item.id}`}
                            aria-label={`Eliminar ${item.model} talla ${item.size}`}
                            onClick={() => handleRemoveCartItem(item.id)}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              data-testid={`cart-dec-${item.id}`}
                              aria-label="Disminuir cantidad"
                              onClick={() =>
                                handleUpdateCartQty(item.id, item.quantity - 1)
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-[#0D1526] text-slate-200 hover:border-slate-500 hover:text-white"
                            >
                              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <span
                              data-testid={`cart-qty-${item.id}`}
                              className="font-mono-num min-w-[26px] text-center text-sm font-bold text-white"
                            >
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              data-testid={`cart-inc-${item.id}`}
                              aria-label="Aumentar cantidad"
                              disabled={isAtCap}
                              onClick={() =>
                                handleUpdateCartQty(item.id, item.quantity + 1)
                              }
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border text-slate-200 transition-colors ${
                                isAtCap
                                  ? 'cursor-not-allowed border-slate-800 bg-[#060B16] text-slate-600'
                                  : 'border-slate-700 bg-[#0D1526] hover:border-[#38bdf8] hover:text-white'
                              }`}
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            {isAtCap && (
                              <span className="text-[11px] font-semibold text-amber-300">
                                Máx. disponible
                              </span>
                            )}
                          </div>

                          <div className="text-right">
                            <p
                              data-testid={`cart-subtotal-${item.id}`}
                              className="font-mono-num text-sm font-bold text-white"
                            >
                              {formatUSD(lineSubtotal)} USD
                            </p>
                            {item.quantity > 1 && (
                              <p className="font-mono-num text-[10px] text-slate-400">
                                {formatUSD(item.unitPrice)} c/u
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Campos opcionales y discretos para el cliente */}
              <div className="grid grid-cols-1 gap-2.5 border-t border-slate-800/80 pt-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="cart-customer-name"
                    className="mb-1 block text-[11px] font-medium text-slate-400"
                  >
                    Nombre del cliente (opcional)
                  </label>
                  <input
                    id="cart-customer-name"
                    data-testid="cart-customer-name"
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Tu nombre"
                    className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#060B16] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-[#38bdf8] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cart-delivery-zone"
                    className="mb-1 block text-[11px] font-medium text-slate-400"
                  >
                    Ciudad / Entrega (opcional)
                  </label>
                  <input
                    id="cart-delivery-zone"
                    data-testid="cart-delivery-zone"
                    list="x4sport-delivery-zones"
                    type="text"
                    value={deliveryZone}
                    onChange={(e) => setDeliveryZone(e.target.value)}
                    placeholder="Guacara, Valencia, Envío..."
                    className="w-full min-h-[38px] rounded-lg border border-slate-700 bg-[#060B16] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-[#38bdf8] focus:outline-none"
                  />
                  <datalist id="x4sport-delivery-zones">
                    <option value="Guacara" />
                    <option value="Valencia" />
                    <option value="San Diego" />
                    <option value="Naguanagua" />
                    <option value="Envío Nacional (MRW / Zoom)" />
                  </datalist>
                </div>
              </div>
            </div>

            {/* Totales y acciones de cierre */}
            <div className="space-y-3 border-t border-slate-800 bg-[#080E1C] px-4 py-4 sm:px-5">
              <div className="space-y-1.5 rounded-xl border border-slate-800 bg-[#060B16] p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-slate-300">
                    Total a Pagar en USD
                  </span>
                  <span
                    data-testid="cart-modal-total-usd"
                    className="font-mono-num text-lg font-bold text-white"
                  >
                    {formatUSD(cartTotals.totalUsd)} USD
                  </span>
                </div>
                {cartTotals.totalBs !== null && cartTotals.bcvRate !== null ? (
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-800/80 pt-1.5">
                    <span className="text-[11px] text-slate-400">
                      Equivalente Tasa BCV oficial ({formatVES(cartTotals.bcvRate)})
                    </span>
                    <span
                      data-testid="cart-modal-total-bs"
                      className="font-mono-num text-sm font-bold text-[#38bdf8]"
                    >
                      {formatVES(cartTotals.totalBs)}
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-300">
                    Equivalente en Bolívares (Tasa BCV) en actualización.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <a
                  href={multiWhatsApp.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="cart-send-whatsapp-btn"
                  data-advisor={multiWhatsApp.advisor.name}
                  data-wa-number={multiWhatsApp.advisor.waNumber}
                  onClick={handleAdvanceWhatsAppTurn}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#38bdf8] px-4 py-2.5 text-sm font-bold text-[#060B16] transition-colors hover:bg-sky-300 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]"
                >
                  <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Enviar Pedido por WhatsApp</span>
                </a>
                <button
                  type="button"
                  data-testid="cart-clear-btn"
                  onClick={handleClearCart}
                  className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-slate-700 bg-transparent px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800/60 hover:text-white"
                >
                  Vaciar carrito
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
