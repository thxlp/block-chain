"use client";

import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ExternalLink,
  History,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchSepoliaContractTransactions,
  getMethodLabelFromInput,
  getTxStatusLabel,
  sepoliaTxUrl,
  type EtherscanTxRow,
} from "../../lib/etherscan-sepolia";
import { txInputMatchesProductId } from "../../lib/tx-product-filter";

type Props = {
  contractAddress: string;
  title?: string;
  limit?: number;
  /** When set to a numeric string, only matching txs (receive/ship/recall) are shown */
  productIdFilter?: string | null;
  /** When true, skip fetching until `productIdFilter` is a valid product id */
  deferFetchUntilFilter?: boolean;
  refreshToken?: number;
};

function truncateHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

export function TransactionHistory({
  contractAddress,
  title = "Transaction History",
  limit = 20,
  productIdFilter = null,
  deferFetchUntilFilter = false,
  refreshToken = 0,
}: Props) {
  const [rows, setRows] = useState<EtherscanTxRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchBlocked, setFetchBlocked] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const isLoadingRef = useRef(false);
  const fetchBlockedRef = useRef(false);
  const inFlightKeyRef = useRef<string | null>(null);
  const lastCompletedKeyRef = useRef<string | null>(null);
  const emptyRetryCountRef = useRef<Record<string, number>>({});

  const trimmedFilter = (productIdFilter ?? "").trim();
  const activeFilter = /^\d+$/.test(trimmedFilter);
  const effectiveOffset = activeFilter ? Math.max(limit, 200) : limit;
  const maxPages = activeFilter ? 5 : 1;

  const displayRows = useMemo(() => {
    if (!deferFetchUntilFilter) {
      return rows;
    }
    if (!activeFilter) return [];
    const pid = BigInt(trimmedFilter);
    return rows.filter((r) => txInputMatchesProductId(r.input, pid));
  }, [rows, deferFetchUntilFilter, activeFilter, trimmedFilter]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    fetchBlockedRef.current = fetchBlocked;
  }, [fetchBlocked]);

  const load = useCallback(async (force = false) => {
    if (isLoadingRef.current) return;
    if (fetchBlockedRef.current && !force) return;
    const requestKey = `${contractAddress}|${effectiveOffset}|${trimmedFilter}|${String(refreshToken)}`;
    if (!force && (inFlightKeyRef.current === requestKey || lastCompletedKeyRef.current === requestKey)) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightKeyRef.current = requestKey;
    const timeoutMs = 15000;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    let timedOut = false;

    setIsLoading(true);
    setError(null);
    if (force && fetchBlockedRef.current) {
      fetchBlockedRef.current = false;
      setFetchBlocked(false);
    }
    try {
      const fetchPromise = (async () => {
        // For filtered view, scan a few pages so older txs are still found
        // (contract can have >200 txs).
        const pid = activeFilter ? BigInt(trimmedFilter) : null;
        const combined: EtherscanTxRow[] = [];
        for (let page = 1; page <= maxPages; page += 1) {
          const batch = await fetchSepoliaContractTransactions(contractAddress, {
            offset: effectiveOffset,
            page,
            signal: controller.signal,
          });
          combined.push(...batch);
          if (pid && combined.some((r) => txInputMatchesProductId(r.input, pid))) {
            break;
          }
          // stop early if this page returned less than offset (no more pages)
          if (batch.length < effectiveOffset) break;
        }
        return combined;
      })();
      const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          timedOut = true;
          reject(new Error(`Request timeout after ${timeoutMs}ms`));
        }, timeoutMs + 50);
      });

      const data = await Promise.race([fetchPromise, timeoutPromise]);
      if (!mountedRef.current) return;
      setRows(data);
      lastCompletedKeyRef.current = requestKey;

      // If upstream temporarily returns empty, auto-retry a couple times
      // to avoid requiring manual Refresh.
      if (!force && Array.isArray(data) && data.length === 0) {
        const nextCount = (emptyRetryCountRef.current[requestKey] ?? 0) + 1;
        emptyRetryCountRef.current[requestKey] = nextCount;
        if (nextCount <= 2) {
          window.setTimeout(() => {
            void load(true);
          }, 600 * nextCount);
        }
      } else {
        emptyRetryCountRef.current[requestKey] = 0;
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      // If this request was aborted due to effect cleanup or a newer request,
      // do not mark it as a network/CORS failure (that would block auto-load).
      if (controller.signal.aborted && !timedOut) {
        return;
      }
      const msg = e instanceof Error ? e.message : "Failed to load transactions";
      const lower = msg.toLowerCase();
      if (lower.includes("aborted") || lower.includes("aborterror")) {
        return;
      }
      if (
        lower.includes("429") ||
        lower.includes("rate limit") ||
        lower.includes("failed to fetch") ||
        lower.includes("cors")
      ) {
        setFetchBlocked(true);
      }
      setRows([]);
      setError(msg);
    } finally {
      window.clearTimeout(timeoutId);
      inFlightKeyRef.current = null;
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [contractAddress, effectiveOffset, trimmedFilter, refreshToken, activeFilter, maxPages]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
  }, [deferFetchUntilFilter, activeFilter, load, refreshToken, contractAddress, limit, trimmedFilter]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const showTable = displayRows.length > 0;
  const showDeferredHint =
    deferFetchUntilFilter && !activeFilter && !isLoading && !error;
  const showNoMatches =
    deferFetchUntilFilter &&
    activeFilter &&
    !isLoading &&
    !error &&
    displayRows.length === 0 &&
    rows.length > 0;
  const showNoRowsOnChain =
    !deferFetchUntilFilter &&
    !isLoading &&
    !error &&
    rows.length === 0;
  const showDeferredFetchedEmpty =
    deferFetchUntilFilter &&
    activeFilter &&
    !isLoading &&
    !error &&
    rows.length === 0;

  return (
    <section
      className="rounded-2xl border border-indigo-500/25 bg-zinc-950/35 p-5 shadow-lg backdrop-blur-md dark:border-indigo-900/40 dark:bg-black/40 sm:p-6"
      aria-labelledby="tx-history-heading"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-emerald-500 text-white shadow-md">
            <History className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2
              id="tx-history-heading"
              className="text-lg font-semibold text-zinc-50"
            >
              {title}
            </h2>
            <p className="font-mono text-xs text-zinc-500">
              {contractAddress}
            </p>
            {deferFetchUntilFilter && activeFilter && (
              <p className="mt-1 text-xs text-amber-200/90">
                แสดงเฉพาะธุรกรรม receive / ship / recall ที่ระบุ Product #
                {trimmedFilter}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            void load(true);
          }}
          disabled={isLoading || (deferFetchUntilFilter && !activeFilter)}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-indigo-500/30 bg-white/5 px-4 py-2 text-sm font-medium text-indigo-100 shadow-sm transition hover:bg-white/10 disabled:opacity-40"
        >
          <RefreshCw
            className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            aria-hidden
          />
          Refresh
        </button>
      </div>

      {isLoading && (deferFetchUntilFilter ? activeFilter : true) && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-950/30 py-12 text-sm text-indigo-100">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          กำลังโหลดประวัติธุรกรรม…
        </div>
      )}

      {error && (
        <div
          className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-100"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Could not load history</p>
            <p className="mt-1 opacity-90">{error}</p>
            {fetchBlocked && (
              <p className="mt-2 text-xs text-amber-200/90">
                Auto retry is paused to avoid API ban (rate limit/CORS). Refresh the page
                or wait before retrying.
              </p>
            )}
            <p className="mt-2 text-xs opacity-80">
              <strong className="font-medium">Testnet only:</strong> history is fetched for{" "}
              <strong>Sepolia</strong> (chain ID{" "}
              <code className="rounded bg-white/5 px-0.5">11155111</code>) via{" "}
              <strong>Etherscan API v2</strong> (
              <code className="rounded bg-white/5 px-1">
                api.etherscan.io/v2/api?chainid=11155111
              </code>
              ). Tx links open on{" "}
              <code className="rounded bg-white/5 px-1">sepolia.etherscan.io</code>. Create a free
              API key at{" "}
              <span className="whitespace-nowrap">etherscan.io/apidashboard</span>, set{" "}
              <code className="rounded bg-white/5 px-1">
                NEXT_PUBLIC_ETHERSCAN_API_KEY
              </code>{" "}
              in <code className="rounded bg-white/5 px-1">.env.local</code>, then restart the dev
              server.
            </p>
          </div>
        </div>
      )}

      {showDeferredHint && (
        <p className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 py-8 text-center text-sm leading-relaxed text-zinc-400">
          ใส่รหัสสินค้าในส่วน <strong className="text-zinc-200">Product Tracker</strong>{" "}
          ด้านบนแล้วกด <strong className="text-zinc-200">ตรวจสอบ</strong>{" "}
          เพื่อดูเฉพาะธุรกรรมที่เกี่ยวข้องกับสินค้านั้น (ลดความสับสนจากประวัติทั้งหมดของคอนแทรค)
        </p>
      )}

      {showNoMatches && (
        <p
          className="rounded-xl border border-amber-500/30 bg-amber-950/25 py-8 text-center text-sm text-amber-100/90"
          role="status"
        >
          ไม่พบธุรกรรม receive / ship / recall ที่ชี้ไปที่ Product #
          {trimmedFilter} ในชุดประวัติล่าสุดที่โหลดมา
        </p>
      )}

      {showDeferredFetchedEmpty && (
        <p className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 py-8 text-center text-sm text-zinc-400">
          ไม่พบธุรกรรมของคอนแทรคในช่วงที่ดึงมา (ลองกด Refresh หรือเพิ่มค่า limit ในโค้ด)
        </p>
      )}

      {showNoRowsOnChain && (
        <p className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 py-8 text-center text-sm text-zinc-400">
          No transactions found for this contract.
        </p>
      )}

      {showTable && (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-white/10 bg-black/20 md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-indigo-500/20 bg-indigo-500/10 text-xs font-semibold uppercase tracking-wide text-indigo-200">
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Tx Hash</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  const status = getTxStatusLabel(row);
                  const method = getMethodLabelFromInput(row.input ?? "");
                  const ts = Number(row.timeStamp);
                  const date = Number.isFinite(ts)
                    ? new Date(ts * 1000)
                    : new Date();
                  const ago = formatDistanceToNow(date, { addSuffix: true });
                  return (
                    <tr
                      key={row.hash}
                      className="border-b border-zinc-800/80 last:border-0"
                    >
                      <td className="px-4 py-3 font-medium text-zinc-100">
                        {method}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={sepoliaTxUrl(row.hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-sm text-indigo-300 underline-offset-2 hover:text-indigo-100 hover:underline"
                        >
                          {truncateHash(row.hash)}
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            status === "Success"
                              ? "inline-flex rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300"
                              : "inline-flex rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300"
                          }
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-zinc-500">
                        {ago}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {displayRows.map((row) => {
              const status = getTxStatusLabel(row);
              const method = getMethodLabelFromInput(row.input ?? "");
              const ts = Number(row.timeStamp);
              const date = Number.isFinite(ts)
                ? new Date(ts * 1000)
                : new Date();
              const ago = formatDistanceToNow(date, { addSuffix: true });
              return (
                <li
                  key={row.hash}
                  className="rounded-xl border border-white/10 bg-black/25 p-4 shadow-sm backdrop-blur-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-zinc-50">{method}</p>
                    <span
                      className={
                        status === "Success"
                          ? "shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300"
                          : "shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300"
                      }
                    >
                      {status}
                    </span>
                  </div>
                  <a
                    href={sepoliaTxUrl(row.hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 font-mono text-sm text-indigo-300 hover:underline"
                  >
                    {truncateHash(row.hash)}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <p className="mt-2 text-xs text-zinc-500">{ago}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
