import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageCircle,
  Search,
  Shield,
  ShoppingBag,
  X,
} from 'lucide-react';
import type { AppState, JerseySize, JerseyVersion, TeamCategory } from '../types/erp';
import {
  ALL_JERSEY_SIZES,
  compareJerseySizes,
  formatUSD,
  formatVES,
} from '../utils/finance';
import {
  advanceWhatsAppTurnIndex,
  buildCatalogWhatsAppHref,
  buildPublicCatalogGroups,
  buildUpcomingTransitCards,
  calculateCatalogBsPrice,
  clampCatalogCarouselIndex,
  computeClampedSwipeOffset,
  filterPublicCatalogGroups,
  filterUpcomingTransitCards,
  getCurrentWhatsAppTurnIndex,
  isRateValid,
  normalizarUrlImagen,
  obtenerFallbackUrlImagen,
  parseCatalogImageList,
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
}

type VersionFilter = 'Todas' | 'Player' | 'Fans' | 'Retro';
type SizeFilter = 'Todas' | JerseySize;

const VERSION_FILTERS: VersionFilter[] = ['Todas', 'Player', 'Fans', 'Retro'];

type SlideLoadStage = 'primary' | 'thumbnail' | 'failed';

const SWIMLANE_CARD_SIZE_CLASSES =
  'w-[calc(50%-6px)] min-w-[152px] max-w-[210px] shrink-0 snap-start sm:w-[225px] sm:max-w-none lg:w-[255px]';

interface CatalogLightboxPayload {
  model: string;
  version: JerseyVersion;
  team: TeamCategory;
  images: string[];
  initialIndex: number;
  size: JerseySize;
  priceUsd?: number;
  isTransit: boolean;
}

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
  onOpenLightbox,
}: {
  images?: string[];
  photoUrl?: string;
  team: TeamCategory;
  model: string;
  version: JerseyVersion;
  isTransit?: boolean;
  onOpenLightbox?: (normalizedImages: string[], activeIndex: number) => void;
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

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const safeIndex = clampCatalogCarouselIndex(activeIndex, total);

  const resolveSlideSrc = (index: number, baseUrl: string): string | null => {
    const stage = slideStages[index] ?? 'primary';
    if (stage === 'failed') return null;
    if (stage === 'thumbnail') {
      return obtenerFallbackUrlImagen(baseUrl);
    }
    return normalizarUrlImagen(baseUrl);
  };

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
    setActiveIndex(clampCatalogCarouselIndex(nextIdx, total));
  };

  const beginSwipe = (clientX: number, clientY: number) => {
    tapStartRef.current = { x: clientX, y: clientY };
    didDragRef.current = false;
    if (total <= 1) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: clientX, y: clientY };
    setIsDragging(true);
  };

  const moveSwipe = (clientX: number, clientY: number) => {
    if (tapStartRef.current) {
      const dist = Math.hypot(
        clientX - tapStartRef.current.x,
        clientY - tapStartRef.current.y,
      );
      if (dist > 8) {
        didDragRef.current = true;
      }
    }
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
    tapStartRef.current = null;
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

  const handleTriggerLightbox = () => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    if (total > 0 && onOpenLightbox) {
      onOpenLightbox(normalizedImages, safeIndex);
    }
  };

  return (
    <div
      data-testid="product-image-gallery"
      className={`relative aspect-[4/5] w-full overflow-hidden bg-[#070D19] select-none ${
        total > 1 ? 'touch-pan-y' : 'touch-pan-x touch-pan-y'
      }`}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) beginSwipe(t.clientX, t.clientY);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) moveSwipe(t.clientX, t.clientY);
      }}
      onTouchEnd={endSwipe}
      onTouchCancel={endSwipe}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') {
          tapStartRef.current = { x: e.clientX, y: e.clientY };
          didDragRef.current = false;
        }
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' && tapStartRef.current) {
          if (
            Math.hypot(
              e.clientX - tapStartRef.current.x,
              e.clientY - tapStartRef.current.y,
            ) > 8
          ) {
            didDragRef.current = true;
          }
        }
      }}
      onPointerUp={(e) => {
        if (e.pointerType === 'mouse') {
          tapStartRef.current = null;
        }
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
            return (
              <div
                key={`${imgUrl}-${idx}`}
                className="h-full w-full shrink-0 overflow-hidden bg-[#070D19]"
              >
                {resolvedSrc ? (
                  <button
                    type="button"
                    onClick={handleTriggerLightbox}
                    aria-label={`Ampliar foto ${idx + 1} de ${model}`}
                    className="flex h-full w-full cursor-zoom-in items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
                  >
                    <img
                      src={resolvedSrc}
                      alt={`${model} (${version})${isTransit ? ' en camino' : ''} · foto ${idx + 1} de ${total}`}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      draggable={false}
                      onError={() => handleSlideError(idx, imgUrl)}
                      className={`h-full w-full object-contain p-1.5 sm:p-2 ${
                        isTransit ? 'opacity-90' : ''
                      }`}
                    />
                  </button>
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

      {/* Controles prev / next estrictamente limitados a [0, N-1] */}
      {total > 1 && (
        <>
          {safeIndex > 0 && (
            <button
              type="button"
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
  onOpenLightbox,
}: {
  product: PublicCatalogProduct;
  usdtRate: number;
  waTurnIndex: number;
  onWhatsAppClick: () => void;
  onOpenLightbox: (payload: CatalogLightboxPayload) => void;
}) {
  const [selectedSize, setSelectedSize] = useState<JerseySize>(
    product.sizes[0]?.size ?? 'M',
  );

  const activeSizeInfo =
    product.sizes.find((s) => s.size === selectedSize) ?? product.sizes[0];
  const currentPrice = activeSizeInfo?.salePrice ?? product.minPrice;
  const currentStock = activeSizeInfo?.stock ?? product.totalStock;
  const currentSizeLabel = activeSizeInfo?.size ?? 'M';

  const { advisor, href } = buildCatalogWhatsAppHref(waTurnIndex, {
    model: product.model,
    version: product.version,
    size: currentSizeLabel,
    isTransit: false,
  });

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
        onOpenLightbox={(imgs, idx) =>
          onOpenLightbox({
            model: product.model,
            version: product.version,
            team: product.team,
            images: imgs,
            initialIndex: idx,
            size: currentSizeLabel,
            priceUsd: currentPrice,
            isTransit: false,
          })
        }
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

        {/* Urgencia, Precio y CTA WhatsApp */}
        <div className="space-y-2 border-t border-slate-800/80 pt-2 sm:space-y-3 sm:pt-3">
          <p
            data-testid="catalog-stock-badge"
            className={`text-[11px] font-semibold sm:text-xs ${
              currentStock <= 5 ? 'text-amber-300' : 'text-emerald-300'
            }`}
          >
            ¡Quedan {currentStock} en stock!
          </p>

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

          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="catalog-buy-btn"
            data-advisor={advisor.name}
            data-wa-number={advisor.waNumber}
            onClick={onWhatsAppClick}
            className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 whitespace-nowrap sm:min-h-[44px] sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" />
            <span className="sm:hidden">Comprar</span>
            <span className="hidden sm:inline">Comprar por WhatsApp</span>
          </a>
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
  onOpenLightbox,
}: {
  card: PublicTransitCard;
  usdtRate: number;
  waTurnIndex: number;
  onWhatsAppClick: () => void;
  onOpenLightbox: (payload: CatalogLightboxPayload) => void;
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
        onOpenLightbox={(imgs, idx) =>
          onOpenLightbox({
            model: card.model,
            version: card.version,
            team: card.team,
            images: imgs,
            initialIndex: idx,
            size: firstSize,
            priceUsd: card.salePrice,
            isTransit: true,
          })
        }
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
      className={`w-full max-w-full min-w-0 overflow-hidden space-y-3 ${className}`}
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
        <div
          ref={scrollerRef}
          onScroll={syncScrollBounds}
          className="no-scrollbar flex w-full max-w-full min-w-0 flex-nowrap gap-3 overflow-x-auto overscroll-x-contain touch-pan-x touch-pan-y snap-x snap-mandatory scroll-smooth pb-2 sm:gap-4"
        >
          {children}
        </div>
      )}
    </section>
  );
}

function CatalogLightboxModal({
  payload,
  usdtRate,
  waTurnIndex,
  onWhatsAppClick,
  onClose,
}: {
  payload: CatalogLightboxPayload;
  usdtRate: number;
  waTurnIndex: number;
  onWhatsAppClick: () => void;
  onClose: () => void;
}) {
  const total = payload.images.length;
  const [activeIndex, setActiveIndex] = useState(() =>
    clampCatalogCarouselIndex(payload.initialIndex, total),
  );
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [slideStages, setSlideStages] = useState<Record<number, SlideLoadStage>>({});
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const safeIndex = clampCatalogCarouselIndex(activeIndex, total);

  useEffect(() => {
    setActiveIndex(clampCatalogCarouselIndex(payload.initialIndex, total));
    setSlideStages({});
    setDragOffsetPx(0);
  }, [payload, total]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && total > 1) {
        setActiveIndex((prev) => clampCatalogCarouselIndex(prev - 1, total));
      } else if (e.key === 'ArrowRight' && total > 1) {
        setActiveIndex((prev) => clampCatalogCarouselIndex(prev + 1, total));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, total]);

  const resolveSlideSrc = (index: number, baseUrl: string): string | null => {
    const stage = slideStages[index] ?? 'primary';
    if (stage === 'failed') return null;
    if (stage === 'thumbnail') {
      return obtenerFallbackUrlImagen(baseUrl);
    }
    return normalizarUrlImagen(baseUrl);
  };

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
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dragOffsetPx) < 4) {
      return;
    }
    setDragOffsetPx(computeClampedSwipeOffset(dx, safeIndex, total));
  };

  const endSwipe = () => {
    if (!swipeStartRef.current) {
      setIsDragging(false);
      setDragOffsetPx(0);
      return;
    }
    if (total > 1) {
      const threshold = 45;
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

  const { advisor, href } = buildCatalogWhatsAppHref(waTurnIndex, {
    model: payload.model,
    version: payload.version,
    size: payload.size,
    isTransit: payload.isTransit,
  });

  const bsPrice =
    payload.priceUsd !== undefined
      ? calculateCatalogBsPrice(payload.priceUsd, usdtRate)
      : null;

  const modalNode = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Vista ampliada de ${payload.model}`}
      data-testid="catalog-photo-lightbox"
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex h-[100dvh] w-full max-w-full flex-col justify-between overflow-hidden bg-black/95 backdrop-blur-md"
    >
      {/* Cabecera superior */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full shrink-0 border-b border-white/10 bg-black/60 px-4 pt-3 pb-2"
      >
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1 text-left">
            <h2 className="min-w-0 flex-1 text-left font-display text-sm sm:text-base font-bold leading-snug text-white break-words">
              {payload.model}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-300">
              <span>
                {payload.version} · {payload.team}
              </span>
              {total > 0 && (
                <span
                  data-testid="lightbox-counter"
                  className="font-mono-num shrink-0 rounded bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white"
                >
                  {safeIndex + 1} / {total}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            data-testid="lightbox-close-btn"
            onClick={onClose}
            aria-label="Cerrar visor"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Imagen grande central con flechas + swipe */}
      <div
        className="relative flex flex-1 min-h-0 w-full items-center justify-center overflow-hidden px-3 py-2"
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) beginSwipe(t.clientX, t.clientY);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) moveSwipe(t.clientX, t.clientY);
        }}
        onTouchEnd={endSwipe}
        onTouchCancel={endSwipe}
      >
        <div
          className={`flex h-full w-full items-center ${
            isDragging ? '' : 'transition-transform duration-200 ease-out'
          }`}
          style={{
            transform: `translateX(calc(-${safeIndex * 100}% + ${dragOffsetPx}px))`,
          }}
        >
          {payload.images.map((imgUrl, idx) => {
            const resolvedSrc = resolveSlideSrc(idx, imgUrl);
            return (
              <div
                key={`lb-${imgUrl}-${idx}`}
                className="flex h-full w-full shrink-0 items-center justify-center"
              >
                {resolvedSrc ? (
                  <img
                    src={resolvedSrc}
                    alt={`${payload.model} (${payload.version}) · foto ampliada ${idx + 1} de ${total}`}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    onClick={(e) => e.stopPropagation()}
                    onError={() => handleSlideError(idx, imgUrl)}
                    className="h-full w-full max-h-[72dvh] max-w-[94vw] object-contain select-none"
                  />
                ) : (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="h-72 w-60 overflow-hidden rounded-xl border border-slate-800"
                  >
                    <JerseyShowcaseFallback
                      team={payload.team}
                      model={payload.model}
                      version={payload.version}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {total > 1 && (
          <>
            {safeIndex > 0 && (
              <button
                type="button"
                data-testid="lightbox-prev-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  goToIndex(safeIndex - 1);
                }}
                aria-label="Foto anterior"
                className="absolute left-3 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white backdrop-blur-sm transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            {safeIndex < total - 1 && (
              <button
                type="button"
                data-testid="lightbox-next-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  goToIndex(safeIndex + 1);
                }}
                aria-label="Siguiente foto"
                className="absolute right-3 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white backdrop-blur-sm transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Miniaturas + Barra inferior con Precio y WhatsApp */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full shrink-0 border-t border-slate-800 bg-[#080E1C] px-4 py-3 space-y-2.5"
      >
        {total > 1 && (
          <div className="no-scrollbar flex w-full items-center justify-center gap-2 overflow-x-auto pb-1">
            {payload.images.map((imgUrl, idx) => {
              const thumbSrc = resolveSlideSrc(idx, imgUrl);
              const isCurrent = idx === safeIndex;
              return (
                <button
                  key={`thumb-${imgUrl}-${idx}`}
                  type="button"
                  onClick={() => goToIndex(idx)}
                  aria-label={`Ver foto ${idx + 1}`}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`h-12 w-10 shrink-0 overflow-hidden rounded-md border-2 bg-[#0D1526] transition-all ${
                    isCurrent
                      ? 'border-blue-500 ring-2 ring-blue-400/50'
                      : 'border-white/15 opacity-60 hover:opacity-100'
                  }`}
                >
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-contain p-0.5"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {payload.priceUsd !== undefined ? (
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <span className="font-mono-num text-lg font-bold text-white sm:text-xl">
                  {formatUSD(payload.priceUsd)}{' '}
                  <span className="text-xs font-semibold text-slate-400">
                    USDT
                  </span>
                </span>
                {bsPrice !== null ? (
                  <span className="font-mono-num text-xs font-semibold text-blue-300 sm:text-sm">
                    {formatVES(bsPrice)}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-amber-300">
                    Precio en Bs en actualización
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-slate-300">
                Precio referencial al llegar · Talla {payload.size}
              </span>
            )}
            <p className="text-[11px] text-slate-400">
              Talla seleccionada: <strong className="text-slate-200">{payload.size}</strong>
            </p>
          </div>

          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="lightbox-buy-btn"
            data-advisor={advisor.name}
            data-wa-number={advisor.waNumber}
            onClick={onWhatsAppClick}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 whitespace-nowrap sm:flex-initial"
          >
            <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {payload.isTransit ? 'Apartar por WhatsApp' : 'Comprar por WhatsApp'}
            </span>
          </a>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalNode, document.body);
  }
  return modalNode;
}

function TeamProductSection({
  group,
  usdtRate,
  waTurnIndex,
  onWhatsAppClick,
  onOpenLightbox,
}: {
  group: PublicCatalogTeamGroup;
  usdtRate: number;
  waTurnIndex: number;
  onWhatsAppClick: () => void;
  onOpenLightbox: (payload: CatalogLightboxPayload) => void;
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
          onOpenLightbox={onOpenLightbox}
        />
      ))}
    </SwimlaneSection>
  );
}

export function PublicCatalogView({
  state,
  isPreviewMode = false,
  onExitPreview,
}: PublicCatalogViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('Todas');
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>('Todas');
  const [logoError, setLogoError] = useState(false);
  const [lightboxPayload, setLightboxPayload] = useState<CatalogLightboxPayload | null>(null);
  const [waTurnIndex, setWaTurnIndex] = useState<number>(() =>
    getCurrentWhatsAppTurnIndex(),
  );

  const handleAdvanceWhatsAppTurn = () => {
    const next = advanceWhatsAppTurnIndex();
    setWaTurnIndex(next);
  };

  const usdtRate = state.exchangeRates.usdt;
  const catalogEnabled = state.catalogEnabled !== false;

  const teamGroups = useMemo(() => buildPublicCatalogGroups(state), [state]);
  const transitCards = useMemo(() => buildUpcomingTransitCards(state), [state]);

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

  const fallbackContact = buildCatalogWhatsAppHref(waTurnIndex, {
    model: 'Catálogo X4SPORT',
    version: 'Player',
    size: 'M',
  });

  return (
    <div
      data-testid="public-catalog-storefront"
      className="min-h-screen w-full max-w-full min-w-0 overflow-hidden bg-[#060B16] text-slate-100"
    >
      {/* Barra superior fija con Logo X4SPORT y Tasa vigente (compacta <15% móvil) */}
      <header className="sticky top-0 z-40 w-full max-w-full min-w-0 overflow-hidden border-b border-slate-800/90 bg-[#060B16]/95 backdrop-blur-md">
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
        <main className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
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
            </div>
          </div>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-full min-w-0 overflow-hidden space-y-8 px-3 py-5 sm:space-y-10 sm:px-6 sm:py-8 xl:max-w-7xl">
          {/* Hero compacto + Buscador Inteligente */}
          <section className="w-full max-w-full min-w-0 overflow-hidden space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0D172B] via-[#0B1222] to-[#080D19] p-4 sm:space-y-5 sm:p-7">
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
            <section className="w-full max-w-full rounded-xl border border-slate-800 bg-[#0D1526] p-8 text-center space-y-3">
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
            <div className="w-full max-w-full min-w-0 overflow-hidden space-y-7 sm:space-y-9">
              {individualGroups.map((group) => (
                <TeamProductSection
                  key={group.team}
                  group={group}
                  usdtRate={usdtRate}
                  waTurnIndex={waTurnIndex}
                  onWhatsAppClick={handleAdvanceWhatsAppTurn}
                  onOpenLightbox={setLightboxPayload}
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
                      onOpenLightbox={setLightboxPayload}
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
                onOpenLightbox={setLightboxPayload}
              />
            ))}
          </SwimlaneSection>

          <footer className="border-t border-slate-800/80 pt-6 pb-8 text-center text-xs text-slate-500">
            X4SPORT · Indumentaria Deportiva · Guacara, Carabobo, Venezuela
          </footer>
        </main>
      )}

      {lightboxPayload && (
        <CatalogLightboxModal
          payload={lightboxPayload}
          usdtRate={usdtRate}
          waTurnIndex={waTurnIndex}
          onWhatsAppClick={handleAdvanceWhatsAppTurn}
          onClose={() => setLightboxPayload(null)}
        />
      )}
    </div>
  );
}
