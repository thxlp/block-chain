"use client";

import { ethers } from "ethers";
import { Loader2, Send, Truck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Props = {
  contractInstance: ethers.Contract | null;
  walletAddress: string | null;
  chainId: number | null;
  sepoliaChainId: number;
  onStatus: (message: string) => void;
  onShipSuccess?: (productId: string, nextOwnerAddress: string) => void;
};

function normalizeAddress(input: string | null): string | null {
  if (!input) return null;
  try {
    return ethers.getAddress(input);
  } catch {
    return null;
  }
}

export function ShipProductCard({
  contractInstance,
  walletAddress,
  chainId,
  sepoliaChainId,
  onStatus,
  onShipSuccess,
}: Props) {
  const [productId, setProductId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientTouched, setRecipientTouched] = useState(false);
  const [ownerLookupLoading, setOwnerLookupLoading] = useState(false);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [ownerLookupError, setOwnerLookupError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const normalizedWallet = useMemo(
    () => normalizeAddress(walletAddress),
    [walletAddress]
  );
  const normalizedOwner = useMemo(() => normalizeAddress(ownerAddress), [ownerAddress]);
  const recipientIsValid = ethers.isAddress(recipient.trim());
  const recipientIsShownInvalid = recipientTouched && recipient.trim() !== "" && !recipientIsValid;
  const walletOwnsProduct =
    normalizedWallet !== null &&
    normalizedOwner !== null &&
    normalizedWallet.toLowerCase() === normalizedOwner.toLowerCase();
  const productIdIsNumeric = /^\d+$/.test(productId.trim());

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const runOwnerCheck = async () => {
      if (!contractInstance || !productIdIsNumeric || !productId.trim()) {
        setOwnerAddress(null);
        setOwnerLookupError(null);
        return;
      }

      setOwnerLookupLoading(true);
      setOwnerLookupError(null);
      try {
        const row = (await contractInstance.products(BigInt(productId.trim()))) as
          | ethers.Result
          | {
              owner?: string;
            };
        const ownerRaw =
          Array.isArray(row) || "0" in (row as object)
            ? (row as ethers.Result)[2]
            : (row as { owner?: string }).owner;
        const owner = ownerRaw ? ethers.getAddress(String(ownerRaw)) : null;
        setOwnerAddress(owner);
      } catch {
        setOwnerAddress(null);
        setOwnerLookupError("Unable to verify owner for this Product ID");
      } finally {
        setOwnerLookupLoading(false);
      }
    };

    void runOwnerCheck();
  }, [contractInstance, productId, productIdIsNumeric]);

  const canShip =
    Boolean(contractInstance) &&
    !transactionLoading &&
    !ownerLookupLoading &&
    chainId === sepoliaChainId &&
    productIdIsNumeric &&
    recipientIsValid &&
    walletOwnsProduct;

  const shipProduct = async () => {
    if (!contractInstance) {
      onStatus("กรุณาเชื่อมต่อ Wallet ก่อน");
      return;
    }
    if (chainId !== sepoliaChainId) {
      onStatus(`⚠ โปรดสลับเป็น Sepolia (Chain ID: ${sepoliaChainId}) ก่อน`);
      return;
    }
    if (!productIdIsNumeric) {
      onStatus("Product ID ต้องเป็นตัวเลขเท่านั้น");
      return;
    }
    if (!walletOwnsProduct) {
      onStatus("You do not own this product");
      return;
    }
    if (!recipientIsValid) {
      onStatus("Recipient Wallet Address ไม่ถูกต้อง");
      return;
    }

    setTransactionLoading(true);
    try {
      const productIdBigInt = BigInt(productId.trim());
      const nextOwnerAddress = ethers.getAddress(recipient.trim());
      await contractInstance.shipProduct.staticCall(
        productIdBigInt,
        nextOwnerAddress
      );
      const tx = await contractInstance.shipProduct(
        productIdBigInt,
        nextOwnerAddress,
        {
        gasLimit: 180000,
        }
      );
      onStatus(`Pending: ส่งธุรกรรมแล้ว (${tx.hash})... รอการยืนยัน`);

      const sleep = (ms: number) =>
        new Promise<void>((resolve) => window.setTimeout(resolve, ms));

      const waitForReceipt = async (): Promise<boolean> => {
        // Primary path: wait for 1 confirmation.
        try {
          await Promise.race([
            tx.wait(),
            new Promise<never>((_, reject) => {
              window.setTimeout(() => reject(new Error("wait-timeout")), 45000);
            }),
          ]);
          return true;
        } catch (e) {
          // Fallback: poll provider for receipt a few times (MetaMask UI can show confirmed
          // while provider receipt is still not immediately available).
          const provider =
            (contractInstance.runner as unknown as { provider?: ethers.Provider })
              ?.provider ?? null;
          if (!provider) throw e;

          for (let i = 0; i < 6; i += 1) {
            try {
              const r = await provider.getTransactionReceipt(tx.hash);
              if (!r) {
                // not available yet
              } else if (r.status === 1) {
                return true;
              } else if (r.status === 0) {
                return false;
              }
            } catch {
              // ignore and retry
            }
            await sleep(1000);
          }
          throw e;
        }
      };

      const ok = await waitForReceipt();
      if (!ok) {
        onStatus("❌ Transaction failed on-chain");
        return;
      }

      await sleep(1000);
      setOwnerAddress(nextOwnerAddress);
      setRecipient("");
      setRecipientTouched(false);
      onShipSuccess?.(productId.trim(), nextOwnerAddress);
      onStatus(
        `Success: จัดส่งสินค้าเรียบร้อยแล้ว และอัปเดต Owner เป็น ${nextOwnerAddress}`
      );
      setToast("Product shipped successfully");
    } catch (error) {
      const fallback = "Ship transaction failed";
      const message =
        error && typeof error === "object" && "shortMessage" in error
          ? String((error as { shortMessage?: string }).shortMessage ?? fallback)
          : fallback;
      onStatus(`❌ ${message}`);
    } finally {
      setTransactionLoading(false);
    }
  };

  return (
    <section className="mx-auto mt-6 w-full max-w-xl rounded-2xl border border-indigo-200/60 bg-white/90 p-6 shadow-lg backdrop-blur dark:border-indigo-900/40 dark:bg-black/30">
      <div className="mb-4 flex items-center gap-2">
        <Truck className="h-5 w-5 text-indigo-500" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Ship Product
        </h2>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="ship-product-id"
            className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            Product ID
          </label>
          <input
            id="ship-product-id"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="เช่น 1"
            value={productId}
            onChange={(e) => setProductId(e.target.value.trim())}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          {!productIdIsNumeric && productId.trim() !== "" && (
            <p className="text-xs text-amber-500">Product ID must be numeric</p>
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="recipient-wallet"
            className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            Wallet Address ผู้รับถัดไป
          </label>
          <div className="relative">
            <Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              id="recipient-wallet"
              placeholder="0x..."
              value={recipient}
              onBlur={() => setRecipientTouched(true)}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-white py-3 pl-10 pr-4 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </div>
          {recipientIsShownInvalid && (
            <p className="text-xs text-rose-500">Enter a valid Ethereum address</p>
          )}
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/30">
          {ownerLookupLoading ? (
            <span className="inline-flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking product owner...
            </span>
          ) : ownerLookupError ? (
            <span className="text-rose-500">{ownerLookupError}</span>
          ) : normalizedOwner && walletOwnsProduct ? (
            <span className="text-emerald-600 dark:text-emerald-300">
              Ownership verified. You can ship this product.
            </span>
          ) : normalizedOwner ? (
            <span className="text-rose-500">You do not own this product</span>
          ) : (
            <span className="text-zinc-500">Enter Product ID to verify ownership</span>
          )}
        </div>

        <button
          type="button"
          onClick={shipProduct}
          disabled={!canShip}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:from-indigo-700 hover:to-emerald-600 disabled:opacity-60"
        >
          {transactionLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Shipping...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Ship
            </>
          )}
        </button>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300"
        >
          {toast}
        </div>
      )}
    </section>
  );
}
