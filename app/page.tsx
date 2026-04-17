/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

import {
  getBrowserProviderAfterConnect,
  getInjectedEthereum,
} from "../lib/injected-ethereum";
import { getSepoliaContractAddress } from "../lib/sepolia-contract";

import { ExplorerSection } from "./components/ExplorerSection";
import { ShipProductCard } from "./components/ShipProductCard";
import contractABI from "../contractABI.json";

/** Sepolia (11155111) — checksum จาก `getAddress`; override ได้ด้วย NEXT_PUBLIC_CONTRACT_ADDRESS */
const CONTRACT_ADDRESS = getSepoliaContractAddress();
const SEPOLIA_CHAIN_ID = 11155111;

export default function Home() {
  const abi = useMemo(() => {
    // ABI ควรวางเป็น array ของ JSON fragment (ของ Solidity contract)
    return contractABI as any[];
  }, []);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [contractInstance, setContractInstance] = useState<
    ethers.Contract | null
  >(null);

  const [chainId, setChainId] = useState<number | null>(null);
  const [productId, setProductId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>(
    "พร้อมรับการเชื่อมต่อ Wallet"
  );

  const [isConnecting, setIsConnecting] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [trackerRefreshToken, setTrackerRefreshToken] = useState(0);
  const [searchId, setSearchId] = useState<string>("");

  // --- [ส่วนที่เพิ่ม 1] GPS State ---
  const [coords, setCoords] = useState<{lat: number, lng: number} | null>(null);
  const [isFetchingGps, setIsFetchingGps] = useState(false);

  const canReceive = Boolean(
    contractInstance && !isReceiving && productId.trim().length > 0
  );

  useEffect(() => {
    // ถ้ามี MetaMask ติดตั้งไว้แล้ว ปรับ UI ตาม account ล่าสุดได้ (ไม่ยิง RPC URL ตรง — กัน CORS)
    const ethereum = getInjectedEthereum();
    if (!ethereum) return;

    const updateFromAccounts = async () => {
      try {
        const accounts = (await ethereum.request({ method: "eth_accounts" })) as
          | string[]
          | undefined;
        const next = accounts?.[0] ?? null;
        setWalletAddress(next);
      } catch {
        // ignore
      }
    };

    const updateFromChain = async () => {
      try {
        const id = await ethereum.request({ method: "eth_chainId" });
        // eth_chainId มักเป็น hex string เช่น "0xaa36a7"
        const nextChainId =
          typeof id === "string" ? parseInt(id, 16) : Number(id);
        setChainId(nextChainId);
      } catch {
        // ignore
      }
    };

    updateFromAccounts();
    updateFromChain();

    const handleAccountsChanged = (accounts: string[]) => {
      setWalletAddress(accounts?.[0] ?? null);
      // reset contract instance เพราะ signer/chain อาจเปลี่ยน
      setContractInstance(null);
      setStatusMessage("ตรวจพบการเปลี่ยนบัญชี/เครือข่าย กรุณาเชื่อมต่อใหม่");
    };

    const handleChainChanged = (id: string) => {
      try {
        const nextChainId = parseInt(id, 16);
        setChainId(nextChainId);
      } catch {
        // ignore
      }
      // signer/chain เปลี่ยน -> ควร reset
      setContractInstance(null);
      setStatusMessage("ตรวจพบการเปลี่ยนเครือข่าย กรุณาเชื่อมต่อใหม่");
    };

    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  const getFriendlyRevertMessage = (err: any) => {
    const raw =
      err?.reason ??
      err?.shortMessage ??
      err?.message ??
      err?.data?.message ??
      "Execution reverted";

    const msg = String(raw);

    if (/Not the product owner/i.test(msg)) return "❌ Not the product owner";
    if (/Only the designated recipient can receive this product/i.test(msg))
      return "❌ You are not the designated recipient";
    if (/not shipped|Product not shipped/i.test(msg))
      return "❌ Product not shipped";
    if (/Only manager can perform this action/i.test(msg))
      return "❌ Only manager can perform this action";
    if (/user rejected|denied/i.test(msg))
      return "❌ User rejected transaction signature";

    return `❌ ${msg}`;
  };

  const connectWallet = async () => {
    if (typeof window === "undefined") return;

    setIsConnecting(true);
    setStatusMessage("กำลังเชื่อมต่อ MetaMask...");

    try {
      const conn = await getBrowserProviderAfterConnect();
      if (!conn.ok) {
        setStatusMessage(
          conn.reason === "no-wallet"
            ? "ไม่พบ MetaMask ในเบราว์เซอร์นี้"
            : conn.reason === "rejected"
              ? "ยกเลิกการเชื่อมต่อ MetaMask — ลองกด Connect อีกครั้ง"
              : "ยังไม่มีบัญชีที่เชื่อมต่อ — เปิด MetaMask แล้วเลือกบัญชี"
        );
        return;
      }

      const provider = conn.provider;
      const network = await provider.getNetwork();
      console.log("Current Chain ID (getNetwork):", network.chainId.toString());
      try {
        const hex = await provider.send("eth_chainId", []);
        console.log(
          "Current Chain ID (eth_chainId):",
          BigInt(hex).toString(),
          "| expected Sepolia:",
          String(SEPOLIA_CHAIN_ID)
        );
      } catch {
        // ignore
      }
      console.log("[web3] Contract target (checksum):", CONTRACT_ADDRESS);
      setChainId(Number(network.chainId));
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      if (!Array.isArray(abi) || abi.length === 0) {
        setStatusMessage(
          "ยังไม่ได้ใส่ ABI ใน `contractABI.json` กรุณาวาง ABI ก่อนใช้งาน"
        );
        setWalletAddress(address);
        setContractInstance(null);
        return;
      }

      const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);

      setWalletAddress(address);
      setContractInstance(contract);
      setStatusMessage(
        Number(network.chainId) === SEPOLIA_CHAIN_ID
          ? "เชื่อมต่อ Wallet สำเร็จ พร้อมสำหรับการรับสินค้า"
          : `⚠ เชื่อมต่อผิดเครือข่าย: กรุณาใช้ Sepolia (Chain ID: ${SEPOLIA_CHAIN_ID})`
      );
    } catch (err: any) {
      setStatusMessage(
        `เชื่อมต่อไม่สำเร็จ: ${err?.message ?? "Unknown error"}`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const receiveProduct = async () => {
    if (!contractInstance) {
      setStatusMessage("กรุณาเชื่อมต่อ Wallet ก่อน");
      return;
    }

    // ดึง chainId ล่าสุดจาก MetaMask เพื่อกัน state ค้างเมื่อสลับเครือข่าย
    let currentChainId = chainId;
    try {
      const ethereum = getInjectedEthereum();
      if (ethereum) {
        const id = await ethereum.request({ method: "eth_chainId" });
        currentChainId =
          typeof id === "string" ? parseInt(id, 16) : Number(id);
        setChainId(currentChainId);
      }
    } catch {
      // ignore (ใช้ค่าเดิมจาก state)
    }

    if (currentChainId !== SEPOLIA_CHAIN_ID) {
      setStatusMessage(
        `⚠ โปรดสลับเครือข่ายเป็น Sepolia (Chain ID: ${SEPOLIA_CHAIN_ID}) ก่อน`
      );
      return;
    }

    const raw = productId.trim();
    if (!raw) {
      setStatusMessage("กรุณากรอก Product ID ก่อน");
      return;
    }

    let productIdBigInt: bigint;
    try {
      // ส่งค่าเป็น BigInt เพื่อให้ ethers mapping ไป uint256 ได้ตรง
      productIdBigInt = BigInt(raw);
    } catch {
      setStatusMessage("Product ID ต้องเป็นเลขจำนวนเต็ม (เช่น 4)");
      return;
    }

    setIsReceiving(true);
    setStatusMessage("กำลังส่งธุรกรรม receiveProduct()...");

    try {
      const activeWallet = walletAddress ? ethers.getAddress(walletAddress) : null;
      const product = (await contractInstance.products(productIdBigInt)) as ethers.Result;
      const currentOwner = ethers.getAddress(String(product[2]));
      const currentState = Number(product[3]);

      // Intended recipient check: owner is set during shipProduct(_id, _nextOwner)
      if (!activeWallet || currentOwner.toLowerCase() !== activeWallet.toLowerCase()) {
        setStatusMessage("❌ You are not the intended recipient for this product");
        return;
      }
      if (currentState !== 1) {
        setStatusMessage("❌ Product state is not 'Shipped' (State 1)");
        return;
      }

      // Pre-check: กันไม่ให้ส่ง tx ที่แน่ๆ ว่า revert (ช่วยลดกรณี gas fee ดูพุ่งเพราะ revert)
      try {
        await contractInstance.receiveProduct.staticCall(productIdBigInt);
      } catch (staticErr: any) {
        setStatusMessage(getFriendlyRevertMessage(staticErr));
        return;
      }

      // Gas management: lock gasLimit to reduce MetaMask mis-estimation
      const tx = await contractInstance.receiveProduct(productIdBigInt, {
        gasLimit: 150000,
      });
      setStatusMessage(`Pending: ส่งธุรกรรมแล้ว (${tx.hash})... รอการยืนยัน`);

      const receipt = await tx.wait();
      const after = (await contractInstance.products(productIdBigInt)) as ethers.Result;
      const nextOwner = ethers.getAddress(String(after[2]));
      const nextState = Number(after[3]);
      console.log("[receiveProduct] receipt:", receipt);
      console.log("[receiveProduct] product after confirmation:", {
        id: productIdBigInt.toString(),
        owner: nextOwner,
        state: nextState,
      });
      setStatusMessage("Success: รับสินค้าเรียบร้อยแล้ว (ยืนยันธุรกรรมแล้ว)");
      setTrackerRefreshToken((prev) => prev + 1);
    } catch (err: any) {
      setStatusMessage(getFriendlyRevertMessage(err));
    } finally {
      setIsReceiving(false);
    }
  };

  const truncateAddress = (addr: string) => {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleShipSuccess = (shippedProductId: string) => {
    setSearchId(shippedProductId);
    setTrackerRefreshToken((prev) => prev + 1);
  };

  // --- [ส่วนที่เพิ่ม 2] GPS Function ---
  const handleCheckIn = () => {
    if (!walletAddress) return alert("กรุณาต่อ Wallet ก่อน");
    setIsFetchingGps(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setIsFetchingGps(false);
        },
        (err) => { alert(err.message); setIsFetchingGps(false); },
        { enableHighAccuracy: true }
      );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-emerald-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-stretch px-4 py-10">
        <div className="w-full">
          <div className="mb-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/70 bg-white/70 px-4 py-2 text-sm text-indigo-800 shadow-sm backdrop-blur dark:border-indigo-900/60 dark:bg-black/20 dark:text-indigo-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Supply Chain on Ethereum (Sepolia)
            </div>
            <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              รับสินค้า (receiveProduct)
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              เชื่อมต่อ MetaMask แล้วส่ง Product ID เพื่อเรียกฟังก์ชันจาก
              Smart Contract
            </p>
          </div>

          <div className="mx-auto max-w-xl rounded-2xl border border-indigo-200/60 bg-white/90 p-6 shadow-lg backdrop-blur dark:border-indigo-900/40 dark:bg-black/30">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Contract Address
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    <span className="font-mono">{CONTRACT_ADDRESS}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={isConnecting}
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-indigo-700 hover:to-emerald-600 active:scale-[0.99] disabled:opacity-60"
                >
                  {isConnecting ? "กำลังเชื่อมต่อ..." : "Connect MetaMask"}
                </button>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Wallet Status
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {walletAddress ? (
                    <>
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        Connected
                      </span>
                      <span className="font-mono text-xs text-zinc-700 dark:text-zinc-200">
                        {truncateAddress(walletAddress)}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      ยังไม่เชื่อมต่อ Wallet
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="productId"
                  className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
                >
                  Product ID
                </label>
                <input
                  id="productId"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="เช่น 1"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!canReceive}
                  onClick={receiveProduct}
                  className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:from-indigo-700 hover:to-emerald-600 active:translate-y-[1px] disabled:opacity-60"
                >
                  {isReceiving ? "กำลังรับสินค้า..." : "ยืนยันการรับสินค้า"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProductId("");
                    setStatusMessage("ล้างค่า Product ID แล้ว");
                  }}
                  disabled={isReceiving || isConnecting}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 active:translate-y-[1px] disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  ล้าง
                </button>
              </div>

              <div
                className="min-h-[48px] rounded-xl border border-indigo-200/60 bg-indigo-50/30 p-4 text-sm text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-100"
                role="status"
                aria-live="polite"
              >
                {statusMessage}
              </div>

              {abi?.length === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                  ยังไม่พบ ABI ใน `contractABI.json` (ไฟล์ตอนนี้เป็น `[]`).
                  โปรดวาง ABI ของ Smart Contract ลงไปเพื่อให้ปุ่มทำงานได้
                </div>
              )}
            </div>
          </div>

          {/* --- [ส่วนที่เพิ่ม 3] UI แผนที่ --- */}
          <div className="mx-auto max-w-xl mt-6 w-full rounded-2xl border border-indigo-200/60 bg-white/90 p-6 shadow-lg dark:border-indigo-900/40 dark:bg-black/30">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
              📍 Account GPS Tracking
            </h3>
            <button
              onClick={handleCheckIn}
              disabled={isFetchingGps || !walletAddress}
              className="w-full mb-4 py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-60 transition-all"
            >
              {isFetchingGps ? "กำลังระบุตำแหน่ง..." : "Check-in Location (MetaMask)"}
            </button>
            {coords && (
              <div className="h-[300px] w-full rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
                <iframe
                  width="100%"
                  height="100%"
                  src={`https://maps.google.com/maps?q=${coords.lat},${coords.lng}&z=15&output=embed`}
                />
              </div>
            )}
          </div>

          <ShipProductCard
            contractInstance={contractInstance}
            walletAddress={walletAddress}
            chainId={chainId}
            sepoliaChainId={SEPOLIA_CHAIN_ID}
            onStatus={setStatusMessage}
            onShipSuccess={(shippedProductId) => {
              handleShipSuccess(shippedProductId);
            }}
          />

          <ExplorerSection
            contractAddress={CONTRACT_ADDRESS}
            txLimit={25}
            refreshToken={trackerRefreshToken}
            searchId={searchId}
          />
        </div>
      </div>
    </div>
  );
}