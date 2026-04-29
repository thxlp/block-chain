"use client";

import { format } from "date-fns";
import { ethers } from "ethers";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  Search,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { getInjectedEthereum } from "../../lib/injected-ethereum";

/** Sepolia — อ่าน on-chain ผ่าน injected provider (หลีกเลี่ยง CORS ของ public RPC URL) */
const SEPOLIA_CHAIN_ID = BigInt(11155111);

// 🛠️ ส่วนที่ 1: เพิ่ม GPS ลงใน Type
export type ProductOnchain = {
  id: bigint;
  name: string;
  owner: string;
  state: number;
  timestamp: bigint;
  creator: string;
  shipperLat: bigint;
  shipperLng: bigint;
  receiverLat: bigint;
  receiverLng: bigint;
};

type Props = {
  contractAddress: string;
  abi: readonly unknown[];
  onTrackedProductIdChange?: (productId: string | null) => void;
  refreshToken?: number;
  searchId?: string;
};

const STEP_META = [
  {
    step: 1,
    title: "Step 1: Created",
    subtitleTh: "ลงทะเบียนสินค้า",
    icon: Package,
  },
  {
    step: 2,
    title: "Step 2: In Transit",
    subtitleTh: "อยู่ระหว่างการจัดส่ง",
    icon: Truck,
  },
  {
    step: 3,
    title: "Step 3: Received",
    subtitleTh: "ได้รับสินค้าแล้ว",
    icon: MapPin,
  },
] as const;

function shortenAddr(a: string) {
  if (a.length <= 14) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function addressUrl(a: string) {
  return `https://sepolia.etherscan.io/address/${a}`;
}

/** ค่า uint256 / BigNumberish จาก chain → BigInt เปรียบเทียบ id/count ไม่หลุด */
function asChainUInt256(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) {
    return BigInt(Math.trunc(v));
  }
  if (v != null && typeof (v as { toString: () => string }).toString === "function") {
    const s = String((v as { toString: () => string }).toString()).trim();
    if (s.length === 0) return BigInt(0);
    return BigInt(s);
  }
  return BigInt(String(v));
}

/** Log ethers / RPC errors แยกฟิลด์ให้เห็น code ชัดเจน */
function logFullContractError(context: string, error: unknown) {
  console.error("Full Error Object:", error);
  if (error !== null && typeof error === "object") {
    const e = error as Record<string, unknown>;
    console.error(`[${context}] error.code:`, e.code);
    console.error(`[${context}] error.message:`, e.message);
    if ("shortMessage" in e) console.error(`[${context}] error.shortMessage:`, e.shortMessage);
    if ("info" in e && e.info !== undefined) console.error(`[${context}] error.info:`, e.info);
    if ("data" in e) console.error(`[${context}] error.data:`, e.data);
    if ("transaction" in e)
      console.error(`[${context}] error.transaction:`, e.transaction);
  }
}

/** สรุปสาเหตุบนหน้าจอ + คำอธิบายไทยสั้นๆ ตาม code ที่พบบ่อย */
function summarizeReadError(error: unknown): string {
  if (error === null || error === undefined) {
    return "ไม่ทราบสาเหตุ (error เป็น null/undefined)";
  }
  if (typeof error !== "object") {
    return String(error);
  }
  const e = error as Record<string, unknown>;
  const code = e.code;
  const shortMessage =
    typeof e.shortMessage === "string" ? e.shortMessage : null;
  const reason = typeof e.reason === "string" ? e.reason : null;
  const message = typeof e.message === "string" ? e.message : null;
  const line =
    shortMessage ?? reason ?? message ?? "(ไม่มีข้อความจาก error object)";

  let hint = "";
  if (code === "CALL_EXCEPTION") {
    hint =
      "\n→ มักเกิดเมื่อที่อยู่คอนแทรคไม่มีโค้ดบนเครือข่ายนี้, ฟังก์ชัน revert, หรือ RPC คืนข้อมูล call ไม่สมบูรณ์";
  } else if (code === "BAD_DATA") {
    const blob = `${message ?? ""}${shortMessage ?? ""}`;
    if (/value\s*=\s*["']0x["']|could not decode result data.*0x/i.test(blob)) {
      hint =
        "\n→ **ผล eth_call เป็นค่าว่าง (0x)** — เกือบทุกครั้งแปลว่า **ที่อยู่นี้ไม่มี bytecode คอนแทรคบนเชนนี้** (เป็น EOA หรือ deploy ผิดเชน/ผิดที่อยู่) ไม่ใช่แค่ ABI เพี้ยนเล็กน้อย\n→ ตรวจ `CONTRACT_ADDRESS` ใน `app/page.tsx` ให้ตรงกับที่ deploy บน Sepolia และ MetaMask ต้องอยู่ Sepolia";
    } else {
      hint =
        "\n→ อาจเป็น ABI ไม่ตรงกับคอนแทรคจริง — ตรวจ `contractABI.json` กับ artifact ที่ deploy";
    }
  } else if (code === "NETWORK_ERROR" || code === "TIMEOUT") {
    hint =
      "\n→ ปัญหาเครือข่ายหรือ RPC ที่ MetaMask ใช้ — ลองสลับ RPC ใน MetaMask หรือรอแล้วลองใหม่";
  } else if (code === "INVALID_ARGUMENT") {
    hint =
      "\n→ อาร์กิวเมนต์เข้า call ไม่ถูกต้อง (เช่น address checksum / ชนิดข้อมูล)";
  } else if (code === 4001 || code === "ACTION_REJECTED") {
    hint = "\n→ ผู้ใช้ปฏิเสธคำขอใน Wallet (พบได้บางกรณีแม้เป็น read)";
  }

  return `error.code: ${String(code)}\n${line}${hint}`;
}

export function ProductStatus({
  contractAddress,
  abi,
  onTrackedProductIdChange,
  refreshToken = 0,
  searchId = "",
}: Props) {
  const fieldId = useId();
  const [query, setQuery] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [productData, setProductData] = useState<ProductOnchain | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [networkHint, setNetworkHint] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const latestQueryRef = useRef("");
  const inFlightQueryRef = useRef<string | null>(null);
  const lastCompletedQueryRef = useRef<string | null>(null);

  const checksummedAddress = useMemo(
    () => ethers.getAddress(contractAddress),
    [contractAddress]
  );

  const runTrack = useCallback(async (rawQuery: string, force = false) => {
    const searchQuery = rawQuery.trim();
    if (!force && (inFlightQueryRef.current === searchQuery || lastCompletedQueryRef.current === searchQuery)) {
      return;
    }
    if (!/^\d+$/.test(searchQuery)) {
      setInvalid(true);
      setProductData(null);
      setNotFound(false);
      setNetworkHint(null);
      setFetchError(null);
      onTrackedProductIdChange?.(null);
      return;
    }

    inFlightQueryRef.current = searchQuery;
    setInvalid(false);
    setNetworkHint(null);
    setFetchError(null);
    setLoading(true);
    setNotFound(false);
    setProductData(null);

    /** ต้องเป็น BigInt (uint256) — ห้ามส่ง string เข้า contract */
    const productIdBigInt = BigInt(searchQuery);
    /** ใช้ Number เฉพาะ validate ช่วงที่ปลอดภัย (ID เล็ก); call จริงใช้ BigInt */
    const productIdNum = Number(searchQuery);
    if (!Number.isSafeInteger(productIdNum) || productIdNum < 1) {
      setLoading(false);
      setInvalid(true);
      onTrackedProductIdChange?.(null);
      return;
    }

    try {
      const eth = getInjectedEthereum();
      if (!eth) {
        const hint = "ไม่พบ MetaMask — ติดตั้ง Wallet แล้วรีเฟรชหน้า";
        window.alert(
          `${hint}\n\nใช้เฉพาะ new ethers.BrowserProvider(window.ethereum) — ห้ามยิง public RPC จากเบราว์เซอร์ (CORS)`
        );
        setNetworkHint(hint);
        setLoading(false);
        return;
      }

      try {
        const accounts = (await eth.request({
          method: "eth_requestAccounts",
        })) as string[] | undefined;
        if (!accounts?.length) {
          const hint = "ยังไม่มีบัญชีที่เชื่อมต่อ — กด Connect ใน MetaMask ก่อน";
          window.alert(hint);
          setNetworkHint(hint);
          setLoading(false);
          return;
        }
      } catch {
        const hint = "ยกเลิกการเชื่อมต่อ MetaMask — กดอนุมัติใน Wallet แล้วลองใหม่";
        window.alert(hint);
        setNetworkHint(hint);
        setLoading(false);
        return;
      }

      // ethers v6 — บังคับ injected เท่านั้น (เทียบเท่า v5 Web3Provider)
      const provider = new ethers.BrowserProvider(eth);
      console.log(
        "[ProductStatus] read path: new ethers.BrowserProvider(window.ethereum) — productCount/products ใช้ provider ตัวนี้"
      );
      
      const { chainId } = await provider.getNetwork();
      console.log("Current Chain ID:", chainId.toString());
      if (chainId !== SEPOLIA_CHAIN_ID) {
        setNetworkHint(
          `กรุณาสลับเป็น Sepolia ใน MetaMask (ต้องเป็น chain ID 11155111 — ตอนนี้อยู่ที่ ${chainId.toString()})`
        );
        setLoading(false);
        return;
      }

      const deployedCode = await provider.getCode(checksummedAddress);
      if (typeof deployedCode !== "string" || deployedCode.length <= 2 || deployedCode === "0x") {
        setFetchError("ที่อยู่นี้ไม่มี Smart Contract บน Sepolia");
        setLoading(false);
        return;
      }

      const readIface = new ethers.Interface(abi as ethers.InterfaceAbi);
      const countCalldata = readIface.encodeFunctionData("productCount", []);
      
      console.log("[ProductStatus] eth_call productCount raw...");
      const countHex = await provider.call({ to: checksummedAddress, data: countCalldata });

      let count: bigint;
      try {
        const decoded = readIface.decodeFunctionResult("productCount", countHex);
        count = asChainUInt256(decoded[0]);
      } catch (decErr) {
        logFullContractError("ProductStatus.productCount.decode", decErr);
        setFetchError(`decode productCount ล้มเหลว`);
        setLoading(false);
        return;
      }

      if (productIdBigInt < BigInt(1) || productIdBigInt > count) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const productsCalldata = readIface.encodeFunctionData("products", [productIdBigInt]);
      const productsHex = await provider.call({ to: checksummedAddress, data: productsCalldata });

      if (!productsHex || productsHex === "0x") {
        setFetchError(`eth_call products(${productIdBigInt.toString()}) ได้ผลว่าง (0x)`);
        setLoading(false);
        return;
      }

      let row: ethers.Result;
      try {
        row = readIface.decodeFunctionResult("products", productsHex) as ethers.Result;
      } catch (decErr) {
        logFullContractError("ProductStatus.products.decode", decErr);
        setFetchError(`decode products() ล้มเหลว — ABI tuple อาจไม่ตรงกับคอนแทรคจริง`);
        setLoading(false);
        return;
      }

      const idRaw = row[0] ?? row.id;
      const nameRaw = row[1] ?? row.name;
      const ownerRaw = row[2] ?? row.owner;
      const stateRaw = row[3] ?? row.state;
      const tsRaw = row[4] ?? row.timestamp;
      const creatorRaw = row[5] ?? row.creator;
      // 🛠️ ส่วนที่ 2: ดึงข้อมูล GPS จากตัวแปร row ของ Contract ตัวใหม่
      const shipperLatRaw = row[6] ?? row.shipperLat;
      const shipperLngRaw = row[7] ?? row.shipperLng;
      const receiverLatRaw = row[8] ?? row.receiverLat;
      const receiverLngRaw = row[9] ?? row.receiverLng;

      // 🛠️ ส่วนที่ 3: เช็คเงื่อนไขว่าส่งกลับมาครบ 10 ช่องหรือไม่
      const missingSlot =
        idRaw === undefined ||
        nameRaw === undefined ||
        ownerRaw === undefined ||
        stateRaw === undefined ||
        tsRaw === undefined ||
        creatorRaw === undefined ||
        shipperLatRaw === undefined ||
        shipperLngRaw === undefined ||
        receiverLatRaw === undefined ||
        receiverLngRaw === undefined;

      if (missingSlot) {
        console.error(
          "[ProductStatus] tuple incomplete — expected 10 slots (id,name,owner,state,timestamp,creator,shipperLat,shipperLng,receiverLat,receiverLng)"
        );
        setNotFound(true);
        setLoading(false);
        return;
      }

      const id = asChainUInt256(idRaw);
      if (id !== productIdBigInt) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const name = String(nameRaw).trim();
      if (!name) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // 🛠️ ส่วนที่ 4: ยัดข้อมูลลง Object
      const data: ProductOnchain = {
        id,
        name,
        owner: ethers.getAddress(String(ownerRaw)),
        state: Number(stateRaw),
        timestamp: asChainUInt256(tsRaw),
        creator: ethers.getAddress(String(creatorRaw)),
        shipperLat: asChainUInt256(shipperLatRaw),
        shipperLng: asChainUInt256(shipperLngRaw),
        receiverLat: asChainUInt256(receiverLatRaw),
        receiverLng: asChainUInt256(receiverLngRaw),
      };

      setProductData(data);
      onTrackedProductIdChange?.(searchQuery);
      lastCompletedQueryRef.current = searchQuery;
    } catch (error) {
      logFullContractError("ProductStatus.runTrack.catch", error);
      setFetchError(`เรียก Smart Contract ไม่สำเร็จ\n\n${summarizeReadError(error)}`);
      onTrackedProductIdChange?.(null);
    } finally {
      inFlightQueryRef.current = null;
      setLoading(false);
    }
  }, [abi, checksummedAddress, contractAddress, onTrackedProductIdChange]);

  const clear = useCallback(() => {
    setQuery("");
    setProductData(null);
    setNotFound(false);
    setInvalid(false);
    setNetworkHint(null);
    setFetchError(null);
    onTrackedProductIdChange?.(null);
  }, [onTrackedProductIdChange]);

  const lastUpdateLabel = productData
    ? format(new Date(Number(productData.timestamp) * 1000), "yyyy-MM-dd HH:mm:ss")
    : null;

  const state = productData?.state ?? -1;

  useEffect(() => {
    latestQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    const q = latestQueryRef.current.trim();
    if (!q) return;
    void runTrack(q, true);
  }, [refreshToken, runTrack]); 

  useEffect(() => {
    const nextSearchId = searchId.trim();
    if (!/^\d+$/.test(nextSearchId)) return;
    if (
      nextSearchId === latestQueryRef.current.trim() &&
      nextSearchId === lastCompletedQueryRef.current
    ) {
      return;
    }
    setQuery(nextSearchId);
    latestQueryRef.current = nextSearchId;
    void runTrack(nextSearchId, true);
  }, [searchId, runTrack]);

  return (
    <section
      className="rounded-2xl border border-indigo-500/25 bg-zinc-950/40 p-4 shadow-xl backdrop-blur-md dark:bg-black/40 sm:p-6"
      aria-labelledby="product-tracker-heading"
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="product-tracker-heading"
            className="text-lg font-semibold tracking-tight text-zinc-50"
          >
            Product Tracker
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-400">
            ใส่รหัสสินค้า (Product ID จาก Smart Contract) เพื่อตรวจสอบสถานะล่าสุด
            — อ่าน On-chain ผ่าน <strong className="text-zinc-300">MetaMask</strong> เครือข่าย{" "}
            <strong className="text-zinc-300">Sepolia (11155111)</strong> เท่านั้น
          </p>
        </div>
      </div>

      {networkHint && (
        <div
          className="mb-4 rounded-xl border border-amber-500/35 bg-amber-950/30 p-4 text-sm text-amber-100"
          role="alert"
        >
          {networkHint}
        </div>
      )}

      {fetchError && !loading && (
        <div
          className="mb-4 whitespace-pre-wrap break-words rounded-xl border border-rose-500/35 bg-rose-950/25 p-4 text-sm leading-relaxed text-rose-100"
          role="alert"
        >
          {fetchError}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative min-w-0 flex-1">
          <label
            htmlFor={fieldId}
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500"
          >
            Product ID
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500/80" />
            <input
              id={fieldId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="เช่น 1"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value.replace(/\D/g, ""));
                setInvalid(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void runTrack(query);
                }
              }}
              className="w-full rounded-xl border border-indigo-500/30 bg-black/30 py-2.5 pl-10 pr-3 font-mono text-sm text-zinc-100 outline-none ring-emerald-500/20 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2"
            />
          </div>
          {invalid && (
            <p className="mt-1 text-xs font-medium text-amber-400" role="alert">
              กรอกได้เฉพาะตัวเลขเท่านั้น (และต้องเป็นเลขบวกที่อยู่ในช่วงปลอดภัยของ JavaScript)
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => {
              void runTrack(query);
            }}
            disabled={loading}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:from-indigo-700 hover:to-emerald-600 disabled:opacity-60 sm:flex-none"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Package className="h-4 w-4" />
            )}
            ตรวจสอบ
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
          >
            ล้าง
          </button>
        </div>
      </div>

      {(loading || notFound) && (
        <div className="mt-6" aria-live="polite">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-amber-500/25 bg-amber-950/20 py-10 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-amber-400" aria-hidden />
              <p className="text-base font-semibold text-amber-100">กำลังค้นหา…</p>
              <p className="max-w-md text-sm text-amber-200/85">
                กำลังดึงข้อมูลผ่าน <span className="font-semibold">window.ethereum</span> (MetaMask) บน
                Sepolia — คอนแทรค{" "}
                <span className="break-all font-mono text-xs">{checksummedAddress}</span>
              </p>
            </div>
          ) : (
            <div
              className="flex flex-col items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-8 text-center"
              role="alert"
            >
              <XCircle className="h-10 w-10 text-rose-400" />
              <p className="text-base font-semibold text-rose-100">ไม่พบสินค้า</p>
              <p className="text-sm text-rose-200/80">
                ไม่พบ Product ID นี้ หรือชื่อสินค้าว่าง หรือ RPC ผิดพลาด — เปิด Console ดู{" "}
                <span className="font-mono text-xs">Full Error Object</span>
              </p>
            </div>
          )}
        </div>
      )}

      {!loading && productData && (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-emerald-100/90">
                สินค้า:{" "}
                <span className="font-mono text-emerald-300">{productData.name}</span>
              </p>
              <span className="rounded-full bg-zinc-900/60 px-2.5 py-0.5 font-mono text-xs text-zinc-300">
                ID #{productData.id.toString()}
              </span>
            </div>
            {lastUpdateLabel && (
              <p className="mt-2 font-mono text-xs text-zinc-500">
                อัปเดตล่าสุดในระบบ (on-chain): {lastUpdateLabel}
              </p>
            )}
          </div>

          {state === 3 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/25 p-3 text-sm text-amber-100">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <span>สถานะ: ถูกเรียกคืน (Recalled) — ตรวจสอบรายละเอียดกับผู้ดูแลระบบ</span>
            </div>
          )}

          <div className="relative">
            <div className="absolute left-[19px] top-8 bottom-8 w-px bg-gradient-to-b from-emerald-500/50 via-indigo-500/40 to-zinc-700/40 sm:left-[21px]" />
            <ol className="relative space-y-6">
              {STEP_META.map((meta, idx) => {
                const Icon = meta.icon;
                let mode: "done" | "current" | "pending" | "recalled";
                if (state === 3) {
                  if (idx <= 1) mode = "done";
                  else mode = "recalled";
                } else if (idx === 0) {
                  if (state >= 1) mode = "done";
                  else if (state === 0) mode = "current";
                  else mode = "pending";
                } else if (idx === 1) {
                  if (state >= 2) mode = "done";
                  else if (state === 1) mode = "current";
                  else mode = "pending";
                } else {
                  if (state >= 2) mode = "done";
                  else mode = "pending";
                }

                const done = mode === "done";
                const current = mode === "current";
                const pending = mode === "pending";
                const recalledStep = mode === "recalled";

                let ownerLine: { label: string; addr: string } | null = null;
                if (idx === 0) {
                  ownerLine = {
                    label: "ผู้ลงทะเบียน (Creator)",
                    addr: productData.creator,
                  };
                }
                if (idx === 1 && state === 1) {
                  ownerLine = {
                    label: "ผู้ถือครองปัจจุบัน (ระหว่างขนส่ง)",
                    addr: productData.owner,
                  };
                }
                if (idx === 1 && state === 3) {
                  ownerLine = {
                    label: "ผู้ถือครองก่อนเรียกคืน",
                    addr: productData.owner,
                  };
                }
                if (idx === 2 && state === 2) {
                  ownerLine = {
                    label: "ผู้รับสินค้า (Owner หลังส่งมอบ)",
                    addr: productData.owner,
                  };
                }

                return (
                  <li key={meta.step} className="relative flex gap-4 pl-1">
                    <div
                      className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${
                        done
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                          : current
                            ? "border-amber-400 bg-amber-500/20 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.35)]"
                            : recalledStep
                              ? "border-rose-400 bg-rose-500/20 text-rose-200"
                              : "border-zinc-600 bg-zinc-900/80 text-zinc-500"
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : current ? (
                        <Icon className="h-5 w-5" />
                      ) : recalledStep ? (
                        <XCircle className="h-5 w-5" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </div>
                    <div
                      className={`min-w-0 flex-1 rounded-xl border p-4 backdrop-blur-sm ${
                        done
                          ? "border-emerald-500/25 bg-emerald-950/15"
                          : current
                            ? "border-amber-500/30 bg-amber-950/15"
                            : recalledStep
                              ? "border-rose-500/30 bg-rose-950/20"
                              : "border-zinc-700/40 bg-zinc-950/40"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-zinc-100">
                          {recalledStep ? "สถานะ: เรียกคืน" : meta.title}
                        </h3>
                        {current && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200">
                            กำลังดำเนินการ
                          </span>
                        )}
                        {done && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                            สำเร็จ
                          </span>
                        )}
                        {pending && (
                          <span className="rounded-full bg-zinc-700/50 px-2 py-0.5 text-xs text-zinc-500">
                            รอดำเนินการ
                          </span>
                        )}
                        {recalledStep && (
                          <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-200">
                            Recalled
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {recalledStep
                          ? "สินค้านี้ถูกเรียกคืน — ไม่ถือว่าเสร็จสมบูรณ์ตามขั้นรับสินค้า"
                          : meta.subtitleTh}
                      </p>
                      {ownerLine && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-zinc-400">
                            <User className="h-3.5 w-3.5" />
                            {ownerLine.label}
                          </span>
                          <a
                            href={addressUrl(ownerLine.addr)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-indigo-300 hover:text-indigo-100"
                          >
                            {shortenAddr(ownerLine.addr)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}