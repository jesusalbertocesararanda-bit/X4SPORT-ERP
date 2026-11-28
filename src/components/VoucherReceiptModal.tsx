import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import type { BrandIdentityConfig } from '../types/erp';
import { DEFAULT_GENERAL_CONFIG, formatUSD, formatVES, round2 } from '../utils/finance';
import { convertGoogleDriveUrlToDirect } from '../utils/publicCatalog';
import { downloadJpgDataUrl, X4SPORT_LOGO_SRC } from '../utils/receiptJpg';

export interface CxcPaymentVoucherData {
  type: 'cxc_payment';
  receiptCode: string;
  createdAt: string;
  operatorName: string;
  customerName: string;
  customerPhone?: string;
  saleReference: string;
  saleTotal: number;
  previousBalance: number;
  paidAmount: number;
  remainingBalance: number;
  paymentMethod: string;
  bcvRate?: number;
}

export interface PartnerPayoutVoucherData {
  type: 'partner_payout';
  receiptCode: string;
  createdAt: string;
  authorizedBy: string;
  partnerName: string;
  concept: string;
  previousBalance?: number;
  paidAmount: number;
  remainingBalance?: number;
  paymentMethod: string;
}

export interface PartnerReinvestmentVoucherData {
  type: 'partner_reinvestment';
  receiptCode: string;
  createdAt: string;
  partnerName: string;
  reinvestedAmount: number;
  destinationFund: string;
  concept: string;
  updatedDetailLabel?: string;
}

export interface ExpenseVoucherData {
  type: 'expense';
  receiptCode: string;
  createdAt: string;
  recordedBy: string;
  concept: string;
  category: string;
  amount: number;
  paymentMethod: string;
  debitedFundsLabel: string;
  bridgeOrOverdraftDetail?: string;
  resultingCashBalance?: number;
}

export type VoucherReceiptData =
  | CxcPaymentVoucherData
  | PartnerPayoutVoucherData
  | PartnerReinvestmentVoucherData
  | ExpenseVoucherData;

interface VoucherReceiptModalProps {
  voucher: VoucherReceiptData | null;
  brandIdentity?: BrandIdentityConfig;
  onClose: () => void;
}

export function toVoucherDateIso(createdAt?: string): string {
  const date = createdAt ? new Date(createdAt) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safe.getFullYear();
  const month = String(safe.getMonth() + 1).padStart(2, '0');
  const day = String(safe.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function safeNonNegAmount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return round2(Math.max(0, value));
}

export function isCxcVoucherPaidInFull(remainingBalance: number): boolean {
  return safeNonNegAmount(remainingBalance) <= 0.009;
}

export function formatVoucherSignedAmount(
  sign: '+' | '-',
  amount: number,
  currencySuffix = ' USDT',
): string {
  const clean =
    typeof amount === 'number' && Number.isFinite(amount)
      ? round2(Math.abs(amount))
      : 0;
  return `${sign}${formatUSD(clean)}${currencySuffix}`;
}

export function getVoucherFilename(voucher: VoucherReceiptData): string {
  const dateIso = toVoucherDateIso(voucher.createdAt);
  switch (voucher.type) {
    case 'cxc_payment':
      return `X4SPORT_Abono_CxC_${dateIso}.jpg`;
    case 'partner_payout':
      return `X4SPORT_Pago_Socio_${dateIso}.jpg`;
    case 'partner_reinvestment':
      return `X4SPORT_Reinversion_Socio_${dateIso}.jpg`;
    case 'expense':
      return `X4SPORT_Gasto_${dateIso}.jpg`;
  }
}

function formatVoucherDateTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleString('es-VE', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }
  return date.toLocaleString('es-VE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function getHeaderTitle(voucher: VoucherReceiptData): string {
  switch (voucher.type) {
    case 'cxc_payment':
      return 'X4SPORT — COMPROBANTE DE PAGO / ABONO CxC';
    case 'partner_payout':
      return 'X4SPORT — COMPROBANTE DE PAGO A SOCIO';
    case 'partner_reinvestment':
      return 'X4SPORT — COMPROBANTE DE REINVERSIÓN DE SOCIO';
    case 'expense':
      return 'X4SPORT — COMPROBANTE DE EGRESO / GASTO';
  }
}

function getModalLabel(voucher: VoucherReceiptData): string {
  switch (voucher.type) {
    case 'cxc_payment':
      return `Comprobante CxC · ${voucher.receiptCode}`;
    case 'partner_payout':
      return `Pago a Socio · ${voucher.partnerName}`;
    case 'partner_reinvestment':
      return `Reinversión de Socio · ${voucher.partnerName}`;
    case 'expense':
      return `Comprobante de Gasto · ${voucher.receiptCode}`;
  }
}

export function VoucherReceiptModal({
  voucher,
  brandIdentity,
  onClose,
}: VoucherReceiptModalProps) {
  const ticketRef = useRef<HTMLDivElement | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const brand = brandIdentity ?? DEFAULT_GENERAL_CONFIG.brandIdentity;
  const resolvedLogoSrc = useMemo(() => {
    const raw = brand.logoUrl?.trim();
    return raw ? convertGoogleDriveUrlToDirect(raw) : X4SPORT_LOGO_SRC;
  }, [brand.logoUrl]);

  useEffect(() => {
    setLogoFailed(false);
    setDownloadError(null);
  }, [voucher, resolvedLogoSrc]);

  useEffect(() => {
    if (!voucher) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [voucher, onClose]);

  if (!voucher) return null;

  const storeName = brand.storeName?.trim() || 'X4SPORT';
  const storeSubtitle = brand.storeSubtitle?.trim() || 'INDUMENTARIA DEPORTIVA';
  const storeLocation =
    brand.storeLocation?.trim() || 'Guacara, Edo. Carabobo · Venezuela';

  const handleDownloadJpg = async () => {
    if (!ticketRef.current || isDownloading) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(ticketRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        onclone: (clonedDoc) => {
          // Tailwind v4 injects oklch() tokens in stylesheets; strip them in the clone
          // because the captured ticket uses 100% inline hex styles.
          clonedDoc
            .querySelectorAll('style, link[rel="stylesheet"]')
            .forEach((node) => node.remove());
        },
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      downloadJpgDataUrl(dataUrl, getVoucherFilename(voucher));
    } catch (err) {
      setDownloadError(
        err instanceof Error
          ? `No se pudo generar el archivo .JPG: ${err.message}`
          : 'No se pudo generar el comprobante .JPG.',
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const cxcRemainingClean =
    voucher.type === 'cxc_payment'
      ? safeNonNegAmount(voucher.remainingBalance)
      : 0;
  const isCxcPaidInFull =
    voucher.type === 'cxc_payment' && isCxcVoucherPaidInFull(cxcRemainingClean);
  const showBcvEquivalent =
    voucher.type === 'cxc_payment' &&
    voucher.paymentMethod === 'Pago Móvil / Bs' &&
    typeof voucher.bcvRate === 'number' &&
    Number.isFinite(voucher.bcvRate) &&
    voucher.bcvRate > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="voucher-receipt-modal-title"
      data-testid="voucher-receipt-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0D1526] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3
              id="voucher-receipt-modal-title"
              className="font-display text-sm sm:text-base font-semibold text-white truncate"
            >
              {getModalLabel(voucher)}
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Comprobante gráfico .JPG (400px) listo para compartir por WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar comprobante"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white shrink-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#060B16] p-3 sm:p-5 flex justify-center items-start">
          {/* Ticket DOM de exactamente 400px con estilos inline hex puros para html2canvas */}
          <div
            ref={ticketRef}
            data-testid="voucher-ticket-capture"
            style={{
              width: '400px',
              minWidth: '400px',
              maxWidth: '400px',
              boxSizing: 'border-box',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              fontFamily:
                'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              borderRadius: '14px',
              border: '1px solid #cbd5e1',
              padding: '18px',
              lineHeight: 1.35,
            }}
          >
            {/* Cabecera de marca X4SPORT */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                paddingBottom: '12px',
                borderBottom: '3px solid #38bdf8',
              }}
            >
              {!logoFailed ? (
                <img
                  src={resolvedLogoSrc}
                  alt={storeName}
                  crossOrigin="anonymous"
                  onError={(e) => {
                    const imgEl = e.currentTarget;
                    if (
                      imgEl.src &&
                      !imgEl.src.endsWith(X4SPORT_LOGO_SRC) &&
                      resolvedLogoSrc !== X4SPORT_LOGO_SRC
                    ) {
                      imgEl.src = X4SPORT_LOGO_SRC;
                    } else {
                      setLogoFailed(true);
                    }
                  }}
                  style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '10px',
                    objectFit: 'cover',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '10px',
                    backgroundColor: '#0f172a',
                    color: '#38bdf8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: '18px',
                    flexShrink: 0,
                  }}
                >
                  {storeName.slice(0, 2).toUpperCase() || 'X4'}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 800,
                    color: '#0f172a',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {storeName}
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: '#0284c7',
                    letterSpacing: '0.04em',
                    marginTop: '1px',
                  }}
                >
                  {storeSubtitle}
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    color: '#64748b',
                    marginTop: '2px',
                  }}
                >
                  {storeLocation}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '6px 9px',
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    color: '#64748b',
                    textTransform: 'uppercase',
                  }}
                >
                  RECIBO N°
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#0f172a',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {voucher.receiptCode}
                </div>
              </div>
            </div>

            {/* Título oficial del comprobante */}
            <div
              style={{
                marginTop: '12px',
                backgroundColor: '#0f172a',
                color: '#ffffff',
                borderRadius: '8px',
                padding: '8px 10px',
                textAlign: 'center',
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.03em',
                borderBottom: '2px solid #38bdf8',
              }}
            >
              {getHeaderTitle(voucher)}
            </div>

            {/* Sello / Estado destacado según tipo */}
            {voucher.type === 'cxc_payment' && (
              <div
                style={{
                  marginTop: '10px',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: isCxcPaidInFull ? '#ecfdf5' : '#e0f2fe',
                  color: isCxcPaidInFull ? '#047857' : '#0369a1',
                  border: isCxcPaidInFull
                    ? '1.5px solid #10b981'
                    : '1.5px solid #38bdf8',
                }}
              >
                {isCxcPaidInFull
                  ? 'CUENTA CANCELADA POR COMPLETO ($0.00 PENDIENTE)'
                  : `ABONO PARCIAL RECIBIDO · PENDIENTE ${formatUSD(cxcRemainingClean)}`}
              </div>
            )}

            {voucher.type === 'partner_payout' && (
              <div
                style={{
                  marginTop: '10px',
                  borderRadius: '8px',
                  padding: '7px 10px',
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: '#eff6ff',
                  color: '#0f172a',
                  border: '1.5px solid #38bdf8',
                }}
              >
                DESEMBOLSO A SOCIO
              </div>
            )}

            {voucher.type === 'partner_reinvestment' && (
              <div
                style={{
                  marginTop: '10px',
                  borderRadius: '8px',
                  padding: '7px 10px',
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: '#ecfdf5',
                  color: '#047857',
                  border: '1.5px solid #38bdf8',
                }}
              >
                CAPITAL REINVERTIDO EN EMPRESA
              </div>
            )}

            {voucher.type === 'expense' && (
              <div
                style={{
                  marginTop: '10px',
                  borderRadius: '8px',
                  padding: '7px 10px',
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: '#fef2f2',
                  color: '#b91c1c',
                  border: '1.5px solid #f59e0b',
                }}
              >
                GASTO · SALIDA DE DINERO (RESTA DE CAJA)
              </div>
            )}

            {/* Meta Fecha & Operador */}
            <div
              style={{
                marginTop: '10px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '10px 12px',
                fontSize: '11px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginBottom: '5px',
                }}
              >
                <span style={{ color: '#64748b', fontWeight: 600 }}>Fecha y hora:</span>
                <span style={{ color: '#0f172a', fontWeight: 700, textAlign: 'right' }}>
                  {formatVoucherDateTime(voucher.createdAt)}
                </span>
              </div>

              {voucher.type === 'cxc_payment' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Operador:</span>
                    <span style={{ color: '#0f172a', fontWeight: 700, textAlign: 'right' }}>
                      {voucher.operatorName}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Cliente:</span>
                    <span style={{ color: '#0f172a', fontWeight: 800, textAlign: 'right' }}>
                      {voucher.customerName}
                    </span>
                  </div>
                  {voucher.customerPhone && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '8px',
                        marginBottom: '5px',
                      }}
                    >
                      <span style={{ color: '#64748b', fontWeight: 600 }}>Teléfono:</span>
                      <span style={{ color: '#334155', fontWeight: 600, textAlign: 'right' }}>
                        {voucher.customerPhone}
                      </span>
                    </div>
                  )}
                  <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #cbd5e1' }}>
                    <div style={{ color: '#64748b', fontWeight: 700, fontSize: '10px', marginBottom: '2px' }}>
                      REFERENCIA DE VENTA ORIGINAL
                    </div>
                    <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '11px', wordBreak: 'break-word' }}>
                      {voucher.saleReference}
                    </div>
                  </div>
                </>
              )}

              {voucher.type === 'partner_payout' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Autorizado por:</span>
                    <span style={{ color: '#0f172a', fontWeight: 700, textAlign: 'right' }}>
                      {voucher.authorizedBy}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Socio Beneficiario:</span>
                    <span style={{ color: '#0f172a', fontWeight: 800, textAlign: 'right' }}>
                      {voucher.partnerName}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Concepto:</span>
                    <span style={{ color: '#0f172a', fontWeight: 700, textAlign: 'right' }}>
                      {voucher.concept}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Vía de entrega:</span>
                    <span style={{ color: '#0284c7', fontWeight: 700, textAlign: 'right' }}>
                      {voucher.paymentMethod}
                    </span>
                  </div>
                </>
              )}

              {voucher.type === 'partner_reinvestment' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Socio que reinvierte:</span>
                    <span style={{ color: '#0f172a', fontWeight: 800, textAlign: 'right' }}>
                      {voucher.partnerName}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Fondo acreditado:</span>
                    <span style={{ color: '#0284c7', fontWeight: 800, textAlign: 'right' }}>
                      {voucher.destinationFund}
                    </span>
                  </div>
                  <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #cbd5e1' }}>
                    <div style={{ color: '#64748b', fontWeight: 700, fontSize: '10px', marginBottom: '2px' }}>
                      CONCEPTO
                    </div>
                    <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '11px', wordBreak: 'break-word' }}>
                      {voucher.concept}
                    </div>
                  </div>
                </>
              )}

              {voucher.type === 'expense' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Registrado por:</span>
                    <span style={{ color: '#0f172a', fontWeight: 700, textAlign: 'right' }}>
                      {voucher.recordedBy}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Categoría:</span>
                    <span style={{ color: '#0f172a', fontWeight: 700, textAlign: 'right' }}>
                      {voucher.category}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Vía de pago:</span>
                    <span style={{ color: '#334155', fontWeight: 700, textAlign: 'right' }}>
                      {voucher.paymentMethod}
                    </span>
                  </div>
                  <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #cbd5e1' }}>
                    <div style={{ color: '#64748b', fontWeight: 700, fontSize: '10px', marginBottom: '2px' }}>
                      CONCEPTO DEL EGRESO
                    </div>
                    <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '11px', wordBreak: 'break-word' }}>
                      {voucher.concept}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Desglose Financiero */}
            <div
              style={{
                marginTop: '10px',
                backgroundColor: '#f8fafc',
                border: '1.5px solid #cbd5e1',
                borderRadius: '10px',
                padding: '12px',
              }}
            >
              {voucher.type === 'cxc_payment' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      color: '#475569',
                      marginBottom: '6px',
                    }}
                  >
                    <span>Total de la Venta</span>
                    <span
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontWeight: 700,
                        color: '#0f172a',
                      }}
                    >
                      {formatUSD(safeNonNegAmount(voucher.saleTotal))}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      color: '#475569',
                      marginBottom: '8px',
                    }}
                  >
                    <span>Saldo Anterior</span>
                    <span
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontWeight: 700,
                        color: '#334155',
                      }}
                    >
                      {formatUSD(safeNonNegAmount(voucher.previousBalance))}
                    </span>
                  </div>

                  <div
                    style={{
                      borderTop: '1px solid #cbd5e1',
                      borderBottom: '1px solid #cbd5e1',
                      padding: '8px 0',
                      marginBottom: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                        Monto Pagado Hoy
                      </span>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: '18px',
                          fontWeight: 800,
                          color: '#047857',
                        }}
                      >
                        {formatUSD(safeNonNegAmount(voucher.paidAmount))}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        color: '#0284c7',
                        fontWeight: 700,
                        marginTop: '3px',
                      }}
                    >
                      <span>Método: {voucher.paymentMethod}</span>
                      {showBcvEquivalent && voucher.bcvRate && (
                        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          {formatVES(safeNonNegAmount(voucher.paidAmount) * voucher.bcvRate)} BCV
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#334155' }}>Saldo Pendiente</span>
                    <span
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '15px',
                        fontWeight: 800,
                        color: isCxcPaidInFull ? '#047857' : '#b45309',
                      }}
                    >
                      {formatUSD(isCxcPaidInFull ? 0 : cxcRemainingClean)}
                    </span>
                  </div>
                </>
              )}

              {voucher.type === 'partner_payout' && (
                <>
                  {voucher.previousBalance !== undefined && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: '#475569',
                        marginBottom: '8px',
                      }}
                    >
                      <span>Saldo Anterior del Socio</span>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontWeight: 700,
                          color: '#0f172a',
                        }}
                      >
                        {formatUSD(voucher.previousBalance)} USDT
                      </span>
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      padding: '8px 0',
                      borderTop:
                        voucher.previousBalance !== undefined
                          ? '1px solid #cbd5e1'
                          : 'none',
                      borderBottom:
                        voucher.remainingBalance !== undefined
                          ? '1px solid #cbd5e1'
                          : 'none',
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                      Monto Pagado
                    </span>
                    <span
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '19px',
                        fontWeight: 800,
                        color: '#b91c1c',
                      }}
                    >
                      -{formatUSD(Math.abs(safeNonNegAmount(voucher.paidAmount)))} USDT
                    </span>
                  </div>

                  {voucher.remainingBalance !== undefined && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        marginTop: '8px',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: '#334155' }}>
                        Saldo Restante del Socio
                      </span>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontWeight: 800,
                          color: '#0f172a',
                        }}
                      >
                        {formatUSD(safeNonNegAmount(voucher.remainingBalance))} USDT
                      </span>
                    </div>
                  )}
                </>
              )}

              {voucher.type === 'partner_reinvestment' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      paddingBottom: '8px',
                      borderBottom: '1px solid #cbd5e1',
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                      Monto Reinvertido
                    </span>
                    <span
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '19px',
                        fontWeight: 800,
                        color: '#047857',
                      }}
                    >
                      {formatVoucherSignedAmount('+', voucher.reinvestedAmount)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '11px',
                      color: '#334155',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>Destino acreditado:</span>
                      <span style={{ fontWeight: 800, color: '#0284c7', textAlign: 'right' }}>
                        {voucher.destinationFund}
                      </span>
                    </div>
                    {voucher.updatedDetailLabel && (
                      <div
                        style={{
                          marginTop: '5px',
                          fontSize: '10px',
                          color: '#475569',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        }}
                      >
                        {voucher.updatedDetailLabel}
                      </div>
                    )}
                  </div>
                </>
              )}

              {voucher.type === 'expense' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      paddingBottom: '8px',
                      borderBottom: '1px solid #cbd5e1',
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                      Monto Descontado
                    </span>
                    <span
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '19px',
                        fontWeight: 800,
                        color: '#b91c1c',
                      }}
                    >
                      {formatVoucherSignedAmount('-', voucher.amount)}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '11px',
                      color: '#334155',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>Fondo(s) debitado(s):</span>
                      <span style={{ fontWeight: 700, color: '#0f172a', textAlign: 'right' }}>
                        {voucher.debitedFundsLabel}
                      </span>
                    </div>
                    {voucher.bridgeOrOverdraftDetail && (
                      <div
                        style={{
                          backgroundColor: '#fffbeb',
                          border: '1px solid #f59e0b',
                          borderRadius: '6px',
                          padding: '5px 8px',
                          fontSize: '10px',
                          color: '#92400e',
                          fontWeight: 600,
                        }}
                      >
                        {voucher.bridgeOrOverdraftDetail}
                      </div>
                    )}
                    {voucher.resultingCashBalance !== undefined && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '8px',
                          paddingTop: '4px',
                          borderTop: '1px dashed #cbd5e1',
                        }}
                      >
                        <span style={{ color: '#64748b', fontWeight: 700 }}>
                          Saldo Resultante en Caja:
                        </span>
                        <span
                          style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontWeight: 800,
                            color: '#0f172a',
                          }}
                        >
                          {formatUSD(voucher.resultingCashBalance)} USDT
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Pie del comprobante */}
            <div
              style={{
                marginTop: '12px',
                paddingTop: '10px',
                borderTop: '1px solid #e2e8f0',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#0f172a',
                }}
              >
                Documento Administrativo Interno · {storeName}
              </div>
              <div
                style={{
                  fontSize: '10px',
                  color: '#64748b',
                  marginTop: '2px',
                }}
              >
                {storeLocation}
              </div>
            </div>
          </div>
        </div>

        {downloadError && (
          <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
            {downloadError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-800 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg border border-slate-700 bg-[#080E1C] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Cerrar
          </button>
          <button
            type="button"
            data-testid="btn-download-voucher-jpg"
            disabled={isDownloading}
            onClick={() => void handleDownloadJpg()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#38bdf8] px-4 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-sky-300 disabled:opacity-60"
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {isDownloading ? 'Generando .JPG...' : 'Descargar Comprobante (.JPG)'}
          </button>
        </div>
      </div>
    </div>
  );
}
