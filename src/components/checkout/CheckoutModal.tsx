import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Lock,
  Play,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  capturePayPalOrder,
  createPayPalOrder,
  createQrisCharge,
  fetchMyWalletSummary,
  fetchPaymentStatus,
  settleSandboxQrisPayment,
  spendCreditsForVideo,
} from '../../services/paymentService';
import type {
  ContentItem,
  CreditPackage,
  CurrencyCode,
  LocaleCode,
  PaymentGateway,
  PaymentOrderRecord,
} from '../../types/vyora';
import { formatPrice } from '../../i18n/translations';
import { Button } from '../ui/Button';

export type CheckoutTarget =
  | {
      kind: 'video';
      item: ContentItem;
      initialMethod?: PaymentGateway;
      resumeSeconds?: number;
    }
  | {
      kind: 'credit_package';
      pkg: CreditPackage;
      initialMethod?: 'paypal' | 'qris';
    };

interface CheckoutModalProps {
  target: CheckoutTarget | null;
  locale: LocaleCode;
  currency: CurrencyCode;
  onClose: () => void;
  onRequireSignIn: () => void;
  onPaymentCompleted: (result: {
    kind: 'video' | 'credit_package';
    videoItem?: ContentItem;
    resumeSeconds?: number;
  }) => void;
  onWatchVideo?: (item: ContentItem) => void;
  onOpenTopUpPackages?: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  target,
  locale,
  currency,
  onClose,
  onRequireSignIn,
  onPaymentCompleted,
  onWatchVideo,
  onOpenTopUpPackages,
}) => {
  const { firebaseUser } = useAuth();

  const [method, setMethod] = useState<PaymentGateway>('paypal');
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [loadingWallet, setLoadingWallet] = useState(false);

  const [pendingOrder, setPendingOrder] = useState<PaymentOrderRecord | null>(null);
  const [sandboxToken, setSandboxToken] = useState<string | undefined>(undefined);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [completedOrder, setCompletedOrder] = useState<PaymentOrderRecord | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    if (!target) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [target, submitting, onClose]);

  useEffect(() => {
    if (!target) return;
    setPendingOrder(null);
    setSandboxToken(undefined);
    setQrDataUrl('');
    setCompletedOrder(null);
    setErrorMsg(null);
    setIdemKey(crypto.randomUUID());

    if (target.initialMethod) {
      setMethod(target.initialMethod);
    } else {
      setMethod(currency === 'IDR' ? 'qris' : 'paypal');
    }

    if (firebaseUser) {
      setLoadingWallet(true);
      void fetchMyWalletSummary()
        .then((res) => setWalletBalance(res.wallet.balanceCredits))
        .catch((err) => {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to load Credit Wallet balance.');
        })
        .finally(() => setLoadingWallet(false));
    }
  }, [target, currency, firebaseUser]);

  useEffect(() => {
    if (!pendingOrder?.qrString) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(pendingOrder.qrString, {
      width: 220,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingOrder?.qrString]);

  useEffect(() => {
    if (!pendingOrder || pendingOrder.method !== 'qris' || completedOrder) return;
    const timer = window.setInterval(() => {
      void fetchPaymentStatus(pendingOrder.id)
        .then((res) => {
          if (res.payment.status === 'completed') {
            setCompletedOrder(res.payment);
            setWalletBalance(res.wallet.balanceCredits);
            if (target) {
              onPaymentCompleted({
                kind: target.kind,
                videoItem: target.kind === 'video' ? target.item : undefined,
                resumeSeconds: target.kind === 'video' ? target.resumeSeconds ?? 0 : 0,
              });
            }
          }
        })
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [pendingOrder, completedOrder, target, onPaymentCompleted]);

  if (!target) return null;

  const isVideo = target.kind === 'video';
  const title = isVideo
    ? target.item.title
    : locale === 'id'
    ? target.pkg.nameId
    : target.pkg.name;
  const priceUsd = isVideo ? target.item.priceUsd : target.pkg.priceUsd;
  const priceIdr = isVideo ? target.item.priceIdr : target.pkg.priceIdr;
  const creditCost = isVideo ? target.item.creditCost : 0;
  const packageTotalCredits = isVideo
    ? 0
    : target.pkg.credits + target.pkg.bonusCredits;
  const resumeSeconds = isVideo ? target.resumeSeconds ?? 0 : 0;

  const finishSuccess = (order: PaymentOrderRecord, newBalance?: number) => {
    if (typeof newBalance === 'number') {
      setWalletBalance(newBalance);
    }
    setCompletedOrder(order);
    onPaymentCompleted({
      kind: target.kind,
      videoItem: isVideo ? target.item : undefined,
      resumeSeconds,
    });
  };

  const handleStartPayPal = async () => {
    if (!firebaseUser) {
      onClose();
      onRequireSignIn();
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const purpose = isVideo ? 'video_unlock' : 'credit_topup';
      const targetId = isVideo ? target.item.id : target.pkg.id;
      const res = await createPayPalOrder(purpose, targetId, resumeSeconds, idemKey);
      setPendingOrder(res.payment);
      setSandboxToken(res.sandboxCaptureToken);
      setIdemKey(crypto.randomUUID());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start PayPal order.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCapturePayPal = async () => {
    if (!pendingOrder) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await capturePayPalOrder(
        pendingOrder.id,
        sandboxToken,
        resumeSeconds,
        idemKey
      );
      finishSuccess(res.payment, res.wallet.balanceCredits);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'PayPal verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateQris = async () => {
    if (!firebaseUser) {
      onClose();
      onRequireSignIn();
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const purpose = isVideo ? 'video_unlock' : 'credit_topup';
      const targetId = isVideo ? target.item.id : target.pkg.id;
      const res = await createQrisCharge(purpose, targetId, resumeSeconds, idemKey);
      setPendingOrder(res.payment);
      setIdemKey(crypto.randomUUID());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to generate QRIS code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmSandboxQris = async () => {
    if (!pendingOrder) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await settleSandboxQrisPayment(pendingOrder.id, resumeSeconds);
      finishSuccess(res.payment, res.wallet.balanceCredits);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'QRIS settlement failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckPaymentStatus = async () => {
    if (!pendingOrder) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetchPaymentStatus(pendingOrder.id);
      setPendingOrder(res.payment);
      if (res.payment.status === 'completed') {
        finishSuccess(res.payment, res.wallet.balanceCredits);
      } else {
        setErrorMsg(
          locale === 'id'
            ? 'Pembayaran masih menunggu konfirmasi gateway.'
            : 'Payment is still awaiting gateway confirmation.'
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Status check failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSpendCredits = async () => {
    if (!firebaseUser) {
      onClose();
      onRequireSignIn();
      return;
    }
    if (!isVideo) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await spendCreditsForVideo(target.item.id, resumeSeconds, idemKey);
      finishSuccess(res.payment, res.wallet.balanceCredits);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Credit unlock failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const methodTabs: { id: PaymentGateway; label: string; icon: React.ReactNode }[] = [
    {
      id: 'paypal',
      label: 'PayPal (USD)',
      icon: <CreditCard className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'qris',
      label: 'QRIS Indonesia (IDR)',
      icon: <QrCode className="w-4 h-4" aria-hidden="true" />,
    },
    ...(isVideo
      ? [
          {
            id: 'credits' as PaymentGateway,
            label: locale === 'id' ? 'Dompet Kredit' : 'Credit Wallet',
            icon: <Wallet className="w-4 h-4" aria-hidden="true" />,
          },
        ]
      : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-modal-title"
    >
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl">
        {/* Mobile Sheet Handle */}
        <div className="sm:hidden pt-2.5 pb-1 bg-slate-50 dark:bg-slate-950 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-3.5 sm:py-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {isVideo
                ? locale === 'id'
                  ? 'Checkout Akses 30 Hari'
                  : '30-Day Streaming Checkout'
                : locale === 'id'
                ? 'Isi Ulang Dompet Kredit'
                : 'Credit Wallet Top-Up'}
            </p>
            <h2
              id="checkout-modal-title"
              className="text-base font-bold text-slate-900 dark:text-white truncate"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 max-h-[82dvh] sm:max-h-[86vh] overflow-y-auto pb-safe">
          {!firebaseUser ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {locale === 'id' ? 'Masuk untuk Melanjutkan' : 'Sign In to Complete Checkout'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto">
                  {locale === 'id'
                    ? 'Akses 30 hari dan transaksi Dompet Kredit terhubung ke akun DELOKEN Anda.'
                    : 'Your 30-day streaming entitlement and Credit Wallet ledger bind securely to your DELOKEN account.'}
                </p>
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  onClose();
                  onRequireSignIn();
                }}
              >
                {locale === 'id' ? 'Masuk ke Akun' : 'Sign In Now'}
              </Button>
            </div>
          ) : completedOrder ? (
            <div className="text-center py-4 space-y-5">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                  {locale === 'id'
                    ? 'Pembayaran Terverifikasi Server'
                    : 'Server-Verified Payment Complete'}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {isVideo
                    ? locale === 'id'
                      ? `Akses streaming penuh 30 hari untuk "${title}" telah aktif.`
                      : `30-day full streaming access for "${title}" is now unlocked.`
                    : locale === 'id'
                    ? `${packageTotalCredits} Kredit telah ditambahkan ke Dompet Kredit Anda.`
                    : `${packageTotalCredits} Credits have been added to your Credit Wallet.`}
                </p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-left text-xs space-y-2 font-mono tabular-nums">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">Transaction ID</span>
                  <span className="text-slate-900 dark:text-slate-100 break-all text-right">{completedOrder.id}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Method</span>
                  <span className="text-slate-900 dark:text-slate-100 uppercase">{completedOrder.method}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Amount</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                    {completedOrder.currency === 'CREDITS'
                      ? `${completedOrder.amount} Credits`
                      : formatPrice(
                          completedOrder.currency === 'USD' ? completedOrder.amount : priceUsd,
                          completedOrder.currency === 'IDR' ? completedOrder.amount : priceIdr,
                          completedOrder.currency
                        )}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Credit Balance</span>
                  <span className="text-slate-900 dark:text-slate-100">{walletBalance} Credits</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                {isVideo ? (
                  <Button
                    variant="primary"
                    size="md"
                    leftIcon={<Play className="w-4 h-4 fill-current" />}
                    onClick={() => {
                      if (onWatchVideo) {
                        onWatchVideo(target.item);
                      }
                      onClose();
                    }}
                  >
                    {resumeSeconds > 0
                      ? locale === 'id'
                        ? 'Lanjutkan Menonton Sekarang'
                        : 'Continue Watching Now'
                      : locale === 'id'
                      ? 'Tonton Tayangan Penuh'
                      : 'Watch Full Release'}
                  </Button>
                ) : (
                  <Button variant="primary" size="md" onClick={onClose}>
                    {locale === 'id' ? 'Selesai' : 'Done'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {isVideo
                      ? locale === 'id'
                        ? 'Total Pay-Per-View (30 Hari)'
                        : 'Pay-Per-View Total (30 Days)'
                      : `${packageTotalCredits} DELOKEN Credits`}
                  </p>
                  <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                    {method === 'credits'
                      ? `${creditCost} ${locale === 'id' ? 'Kredit' : 'Credits'}`
                      : method === 'qris'
                      ? formatPrice(priceUsd, priceIdr, 'IDR')
                      : formatPrice(priceUsd, priceIdr, 'USD')}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-600 dark:text-slate-400">
                  <p>{locale === 'id' ? 'Saldo Anda' : 'Your Wallet'}</p>
                  <p className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                    {loadingWallet ? '...' : `${walletBalance} Credits`}
                  </p>
                </div>
              </div>

              {!pendingOrder && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {methodTabs.map((tab) => {
                    const active = method === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setMethod(tab.id);
                          setErrorMsg(null);
                        }}
                        className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        {tab.icon}
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300"
                >
                  {errorMsg}
                </div>
              )}

              {method === 'paypal' && (
                <div className="space-y-4">
                  {!pendingOrder ? (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {locale === 'id'
                          ? 'Pesanan PayPal dibuat di server dengan harga terverifikasi. Pembayaran diverifikasi via capture API & webhook sebelum akses dibuka.'
                          : 'Your PayPal order is created server-side with authoritative USD pricing and verified via capture & webhook before unlocking.'}
                      </p>
                      <Button
                        variant="primary"
                        size="lg"
                        className="w-full"
                        isLoading={submitting}
                        onClick={() => void handleStartPayPal()}
                      >
                        {locale === 'id'
                          ? `Buat Pesanan PayPal (${formatPrice(priceUsd, priceIdr, 'USD')})`
                          : `Create PayPal Order (${formatPrice(priceUsd, priceIdr, 'USD')})`}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          {pendingOrder.gatewayMode === 'live'
                            ? 'PayPal Checkout Ready'
                            : 'PayPal Sandbox Order'}
                        </span>
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          {pendingOrder.gatewayOrderId}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        {pendingOrder.gatewayMode === 'live'
                          ? 'Approve the order in PayPal, then capture payment server-side to unlock access.'
                          : locale === 'id'
                          ? 'Order Sandbox bertandatangan server telah dibuat. Klik tombol di bawah untuk verifikasi capture di server.'
                          : 'Server-signed Sandbox order created. Click below to capture and verify transaction server-side.'}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {pendingOrder.approvalUrl && (
                          <a
                            href={pendingOrder.approvalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100"
                          >
                            <span>Open PayPal</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <Button
                          variant="primary"
                          size="md"
                          className="flex-1"
                          isLoading={submitting}
                          onClick={() => void handleCapturePayPal()}
                        >
                          {locale === 'id'
                            ? 'Verifikasi & Capture PayPal'
                            : 'Verify & Capture PayPal'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {method === 'qris' && (
                <div className="space-y-4">
                  {!pendingOrder ? (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {locale === 'id'
                          ? 'Mendukung seluruh aplikasi e-wallet & mobile banking Indonesia (GoPay, OVO, DANA, ShopeePay, BCA, Mandiri, BRI) melalui QRIS dinamis.'
                          : 'Supports all Indonesian e-wallets and mobile banking apps (GoPay, OVO, DANA, ShopeePay, BCA, Mandiri) via dynamic QRIS.'}
                      </p>
                      <Button
                        variant="primary"
                        size="lg"
                        className="w-full"
                        isLoading={submitting}
                        onClick={() => void handleCreateQris()}
                      >
                        {locale === 'id'
                          ? `Buat Kode QRIS (${formatPrice(priceUsd, priceIdr, 'IDR')})`
                          : `Generate QRIS Code (${formatPrice(priceUsd, priceIdr, 'IDR')})`}
                      </Button>
                    </div>
                  ) : (
                    <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center space-y-4">
                      <div className="flex items-center justify-between w-full text-xs">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          QRIS · DELOKEN STREAMING
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono text-slate-500 dark:text-slate-400">
                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          15:00
                        </span>
                      </div>

                      {qrDataUrl && (
                        <div className="p-3 bg-white border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs">
                          <img
                            src={qrDataUrl}
                            alt="QRIS Dynamic Payment Code"
                            className="w-48 h-48 block"
                          />
                        </div>
                      )}

                      <div className="space-y-1">
                        <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          {formatPrice(priceUsd, priceIdr, 'IDR')}
                        </p>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          Ref: {pendingOrder.id}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-center gap-2.5 w-full">
                        <Button
                          variant="outline"
                          size="sm"
                          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                          isLoading={submitting}
                          onClick={() => void handleCheckPaymentStatus()}
                        >
                          {locale === 'id' ? 'Cek Status' : 'Check Status'}
                        </Button>
                        {pendingOrder.gatewayMode === 'sandbox_preview' && (
                          <Button
                            variant="primary"
                            size="sm"
                            isLoading={submitting}
                            onClick={() => void handleConfirmSandboxQris()}
                          >
                            {locale === 'id'
                              ? 'Konfirmasi QRIS (Sandbox)'
                              : 'Confirm QRIS (Sandbox)'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {method === 'credits' && isVideo && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-400">
                        {locale === 'id' ? 'Saldo Dompet Kredit' : 'Available Credits'}
                      </span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100 font-semibold">
                        {walletBalance} Credits
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-400">
                        {locale === 'id' ? 'Biaya Tayangan' : 'Title Unlock Cost'}
                      </span>
                      <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                        -{creditCost} Credits
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between font-semibold">
                      <span className="text-slate-600 dark:text-slate-300">
                        {locale === 'id' ? 'Sisa Setelah Buka Akses' : 'Remaining Balance'}
                      </span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                        {walletBalance - creditCost} Credits
                      </span>
                    </div>
                  </div>

                  {walletBalance >= creditCost ? (
                    <Button
                      variant="primary"
                      size="lg"
                      className="w-full"
                      isLoading={submitting}
                      leftIcon={<Wallet className="w-4 h-4" />}
                      onClick={() => void handleSpendCredits()}
                    >
                      {locale === 'id'
                        ? `Gunakan ${creditCost} Kredit & Buka Akses`
                        : `Spend ${creditCost} Credits & Unlock`}
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 rounded-xl p-3">
                        {locale === 'id'
                          ? `Saldo Anda belum mencukupi (${walletBalance}/${creditCost} Kredit). Silakan isi ulang kredit melalui PayPal atau QRIS.`
                          : `Insufficient credits (${walletBalance}/${creditCost}). Top up a Credit Package via PayPal or QRIS.`}
                      </p>
                      {onOpenTopUpPackages && (
                        <Button
                          variant="primary"
                          size="md"
                          className="w-full"
                          onClick={() => {
                            onClose();
                            onOpenTopUpPackages();
                          }}
                        >
                          {locale === 'id' ? 'Isi Ulang Dompet Kredit' : 'Top Up Credit Wallet'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800">
                <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>
                  {locale === 'id'
                    ? 'Transaksi diproteksi idempotensi & verifikasi harga sisi server.'
                    : 'Protected by server-side pricing, idempotency keys, and immutable wallet ledgers.'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
