/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { getBrowserProviderAfterConnect, getInjectedEthereum } from "../lib/injected-ethereum"; 
import { getSepoliaContractAddress } from "../lib/sepolia-contract";
import { ExplorerSection } from "./components/ExplorerSection";
import contractABI from "../contractABI.json";

const CONTRACT_ADDRESS = getSepoliaContractAddress();
const SEPOLIA_CHAIN_ID = 11155111;

function normalizeAddress(input: string | null): string | null {
  if (!input) return null;
  try {
    return ethers.getAddress(input);
  } catch {
    return null;
  }
}

function isUserRejection(err: any): boolean {
  if (!err) return false;
  if (err.code === "ACTION_REJECTED") return true;
  if (err.code === 4001) return true;
  if (err?.info?.error?.code === 4001) return true;
  const msg: string = (err?.message ?? "").toLowerCase();
  if (msg.includes("user denied") || msg.includes("user rejected")) return true;
  return false;
}

export default function ReceiverPage() {
  const abi = useMemo(() => contractABI as any[], []);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [contractInstance, setContractInstance] = useState<ethers.Contract | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [productId, setProductId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("พร้อมรับการเชื่อมต่อ Wallet");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [trackerRefreshToken, setTrackerRefreshToken] = useState(0);
  const [searchId, setSearchId] = useState<string>("");

  const [coords, setCoords] = useState<{lat: number, lng: number} | null>(null);
  const [isFetchingGps, setIsFetchingGps] = useState(false);

  const [ownerLookupLoading, setOwnerLookupLoading] = useState(false);
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [ownerLookupError, setOwnerLookupError] = useState<string | null>(null);

  const normalizedWallet = useMemo(() => normalizeAddress(walletAddress), [walletAddress]);
  const normalizedOwner = useMemo(() => normalizeAddress(ownerAddress), [ownerAddress]);
  const walletOwnsProduct = normalizedWallet !== null && normalizedWallet === normalizedOwner;

  const canReceive = Boolean(
    contractInstance && 
    !isReceiving && 
    productId.trim().length > 0 && 
    walletOwnsProduct
  );

  useEffect(() => {
    const ethereum = getInjectedEthereum();
    if (!ethereum) return;

    const autoInitContract = async () => {
      try {
        const provider = new ethers.BrowserProvider(ethereum as any);
        const signer = await provider.getSigner();
        const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);
        setContractInstance(contract);
      } catch (err) {
        console.error("Auto init contract failed", err);
      }
    };

    const updateFromAccounts = async () => {
      try {
        const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[] | undefined;
        if (accounts && accounts.length > 0) {
          setWalletAddress(accounts[0]);
          await autoInitContract();
        } else {
          setWalletAddress(null);
          setContractInstance(null);
        }
      } catch {}
    };

    const updateFromChain = async () => {
      try {
        const id = await ethereum.request({ method: "eth_chainId" });
        setChainId(typeof id === "string" ? parseInt(id, 16) : Number(id));
      } catch {}
    };

    updateFromAccounts();
    updateFromChain();

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts && accounts.length > 0) {
        setWalletAddress(accounts[0]);
        autoInitContract();
      } else {
        setWalletAddress(null);
        setContractInstance(null);
      }
    };

    const handleChainChanged = (id: string) => {
      setChainId(parseInt(id, 16));
      autoInitContract();
    };

    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [abi]);

  useEffect(() => {
    const idStr = productId.trim();
    if (!idStr || !contractInstance) {
      setOwnerAddress(null);
      setOwnerLookupError(null);
      return;
    }

    let active = true;
    const checkOwnership = async () => {
      try {
        setOwnerLookupLoading(true);
        setOwnerLookupError(null);
        setOwnerAddress(null);

        const idBigInt = BigInt(idStr);
        const row = await contractInstance.products(idBigInt);
        
        if (!active) return;

        if (BigInt(row[0] ?? row.id) === BigInt(0)) {
          setOwnerLookupError("❌ ไม่พบสินค้านี้ในระบบ");
          return;
        }

        const ownerRaw = row[2] ?? row.owner;
        setOwnerAddress(ethers.getAddress(String(ownerRaw)));
        
      } catch (err: any) {
        if (!active) return;
        console.error("Lookup error:", err);
        setOwnerLookupError("❌ ไม่สามารถดึงข้อมูลได้ (พิมพ์ ID ให้ถูกต้อง)");
      } finally {
        if (active) setOwnerLookupLoading(false);
      }
    };

    const t = setTimeout(checkOwnership, 500);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [productId, contractInstance]);

  const connectWallet = async () => {
    if (typeof window === "undefined") return;
    setIsConnecting(true);
    setStatusMessage("กำลังเชื่อมต่อ MetaMask...");
    try {
      const conn = await getBrowserProviderAfterConnect();
      if (!conn.ok) return setStatusMessage("เชื่อมต่อไม่สำเร็จ");
      const provider = conn.provider;
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);
      setWalletAddress(address);
      setContractInstance(contract);
      setStatusMessage("เชื่อมต่อ Wallet สำเร็จ");
    } catch (err: any) {
      if (isUserRejection(err)) {
        setStatusMessage("❌ คุณได้ยกเลิกการเชื่อมต่อ MetaMask");
      } else {
        setStatusMessage(`Error: ${err?.message}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const receiveProduct = async () => {
    if (!contractInstance || !productId) return;
    setIsReceiving(true);
    setStatusMessage("รอการยืนยันใน MetaMask...");
    try {
      const tx = await contractInstance.receiveProduct(BigInt(productId), { gasLimit: 150000 });
      setStatusMessage("รอการ confirm บนเครือข่าย...");
      await tx.wait();
      setStatusMessage("✅ รับสินค้าเรียบร้อยแล้ว");
      setSearchId(productId);
      setTrackerRefreshToken(p => p + 1);
    } catch (err: any) {
      if (isUserRejection(err)) {
        setStatusMessage("❌ คุณได้ยกเลิกธุรกรรมใน MetaMask");
      } else {
        console.error(err);
        setStatusMessage("❌ เกิดข้อผิดพลาดในการรับสินค้า");
      }
    } finally {
      setIsReceiving(false);
    }
  };

  const handleCheckIn = async () => {
    if (!contractInstance) return alert("กรุณาต่อ Wallet");
    if (!productId) return alert("กรุณากรอก Product ID ก่อน");

    setIsFetchingGps(true);
    setStatusMessage("กำลังดึง GPS ของคุณ...");

    if (!navigator.geolocation) {
      alert("เบราว์เซอร์ของคุณไม่รองรับ GPS");
      setIsFetchingGps(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      const lat = Math.round(position.coords.latitude * 1000000);
      const lng = Math.round(position.coords.longitude * 1000000);

      try {
        setStatusMessage("กำลังบันทึกพิกัดคุณลงบล็อกเชน (รอ Confirm MetaMask)...");
        const tx = await contractInstance.updateReceiverLocation(BigInt(productId), lat, lng);
        await tx.wait();
        setStatusMessage("✅ บันทึกพิกัดของคุณสำเร็จแล้ว! Shipper จะเห็นพิกัดคุณ");
      } catch (err: any) {
        if (isUserRejection(err)) {
          setStatusMessage("❌ คุณได้ยกเลิกธุรกรรมใน MetaMask");
        } else {
          console.error(err);
          setStatusMessage("❌ เกิดข้อผิดพลาดในการบันทึกพิกัด");
        }
      } finally {
        setIsFetchingGps(false);
      }
    }, () => {
      alert("กรุณาอนุญาตให้เข้าถึงตำแหน่ง (Location)");
      setIsFetchingGps(false);
    });
  };

  const trackShipper = async () => {
    if (!contractInstance) return alert("กรุณาต่อ Wallet");
    if (!productId) return alert("กรุณากรอก Product ID ก่อน");

    setIsFetchingGps(true);
    setStatusMessage("กำลังดึงตำแหน่ง Shipper จากบล็อกเชน...");

    try {
      const product = await contractInstance.products(BigInt(productId));
      
      const sLat = Number(product[6]);
      const sLng = Number(product[7]);

      if (sLat === 0 && sLng === 0) {
        alert("ยังไม่มีการบันทึกพิกัดจากฝั่งผู้ส่ง (Shipper) สำหรับสินค้านี้");
        setStatusMessage("ไม่พบข้อมูลพิกัด Shipper");
      } else {
        setCoords({ lat: sLat / 1000000, lng: sLng / 1000000 });
        setStatusMessage("📍 แสดงพิกัดล่าสุดของ Shipper บนแผนที่");
      }
    } catch (err: any) {
      if (isUserRejection(err)) {
        setStatusMessage("❌ คุณได้ยกเลิกการดำเนินการใน MetaMask");
      } else {
        console.error(err);
        setStatusMessage("❌ ค้นหาข้อมูลไม่พบ");
      }
    } finally {
      setIsFetchingGps(false);
    }
  };

  // 🛠️ Dynamic status bar colors (เหมือน Shipper)
  const isErrorStatus = statusMessage.includes("ข้อผิดพลาด") || statusMessage.includes("ไม่พบ") || statusMessage.includes("❌") || statusMessage.includes("Error");
  const isSuccessStatus = statusMessage.includes("สำเร็จ") || statusMessage.includes("✅");

  return (
    <div className="min-h-screen bg-[#F4F7FE] text-slate-800 dark:bg-slate-950 dark:text-slate-100 font-sans">
      <nav className="sticky top-0 z-50 border-b border-slate-200/50 bg-white/70 backdrop-blur-xl dark:border-slate-800/60 dark:bg-slate-950/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-md shadow-emerald-200 dark:shadow-none">
                <span className="text-xl font-bold">R</span>
              </div>
              <span className="text-xl font-extrabold tracking-tight">Receiver<span className="text-emerald-500 dark:text-emerald-400">Hub</span></span>
            </div>
            <Link href="/shipper" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/50 px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
              <span>🚚</span> ไปหน้าผู้ส่ง (Shipper)
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        
        <div className="mb-8 flex flex-col items-start justify-between gap-6 rounded-3xl bg-white p-8 shadow-sm dark:bg-slate-900 md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Receiver Dashboard</h1>
            <p className="mt-2 text-slate-500">ระบบตรวจสอบและยืนยันการรับสินค้าผ่านบล็อกเชน (On-chain GPS)</p>
          </div>
          {!walletAddress ? (
            <button onClick={connectWallet} disabled={isConnecting} className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-8 py-4 text-sm font-bold text-white shadow-lg transition-all hover:-translate-y-0.5 active:scale-95 dark:bg-emerald-600">
              {isConnecting ? "กำลังเชื่อมต่อ..." : "🦊 Connect MetaMask"}
            </button>
          ) : (
            <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-2 pr-5 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-xl dark:bg-emerald-900/40">🏠</div>
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase text-slate-400">Connected Wallet</span>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
              </div>
            </div>
          )}
        </div>

        {/* 🛠️ Status bar — dynamic color เหมือน Shipper */}
        <div className={`mb-8 flex items-center gap-3 rounded-2xl border p-4 shadow-sm transition-all ${
          isSuccessStatus
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-400"
            : isErrorStatus
            ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400"
            : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-400"
        }`}>
          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-lg shadow-sm ${
            isSuccessStatus ? "bg-emerald-100 dark:bg-emerald-800/50"
            : isErrorStatus ? "bg-red-100 dark:bg-red-800/50"
            : "bg-blue-100 dark:bg-blue-800/50"
          }`}>
            {isSuccessStatus ? "✅" : isErrorStatus ? "⚠️" : "ℹ️"}
          </span>
          <p className="text-sm font-medium">{statusMessage}</p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          
          <div className="space-y-8 lg:col-span-7">
            <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <div className="border-b border-slate-100 bg-slate-50/50 px-8 py-6 dark:border-slate-800 dark:bg-slate-800/20">
                <h2 className="flex items-center gap-3 text-lg font-bold">📥 ยืนยันการรับสินค้า</h2>
                <p className="mt-1 text-sm text-slate-500">กรอก Product ID เพื่อรับสินค้า หรือติดตาม GPS</p>
              </div>
              <div className="p-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="block text-sm font-bold">Product ID</label>
                    <input 
                      type="text" value={productId} onChange={(e) => setProductId(e.target.value)} 
                      placeholder="ใส่เลข Product ID ที่นี่..."
                      className="block w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 focus:ring-4 outline-none dark:bg-slate-950 dark:border-slate-700 dark:focus:ring-emerald-500/20" 
                    />
                  </div>

                  <div className="mt-2 min-h-[24px] text-sm font-medium">
                    {ownerLookupLoading ? (
                      <span className="text-slate-400">กำลังตรวจสอบสิทธิ์...</span>
                    ) : ownerLookupError ? (
                      <span className="text-rose-500">{ownerLookupError}</span>
                    ) : normalizedOwner && walletOwnsProduct ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        ✅ ตรวจสอบสิทธิ์สำเร็จ: คุณคือผู้รับสินค้านี้
                      </span>
                    ) : normalizedOwner ? (
                      <span className="text-rose-500">
                        ❌ คุณไม่ใช่ผู้รับสินค้านี้ (สิทธิ์เป็นของ {normalizedOwner.slice(0, 6)}...)
                      </span>
                    ) : (
                      <span className="text-slate-500">กรอก Product ID เพื่อตรวจสอบสิทธิ์การรับของ</span>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button onClick={receiveProduct} disabled={!canReceive} className="flex-1 rounded-2xl bg-slate-900 px-6 py-4 font-bold text-white dark:bg-emerald-600 disabled:opacity-50 transition-opacity">
                      {isReceiving ? "กำลังดำเนินการ..." : "✓ ยืนยันรับสินค้า"}
                    </button>
                    <button onClick={() => setProductId("")} className="rounded-2xl border bg-white px-6 py-4 font-bold dark:bg-slate-800 transition-colors">
                      ล้างค่า
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 lg:col-span-5">
            
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-white shadow-lg dark:from-slate-800 dark:to-slate-900">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-emerald-500/20 blur-2xl"></div>
              <h4 className="mb-1 text-sm font-bold text-slate-300 uppercase tracking-wider">Smart Contract</h4>
              <p className="font-mono text-sm break-all text-emerald-300">{CONTRACT_ADDRESS}</p>
              <div className="mt-5 flex items-center gap-2">
                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400"></div>
                <p className="text-xs font-medium text-slate-300">Sepolia Network Ready</p>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <h3 className="text-lg font-bold mb-4">📍 พิกัดการจัดส่ง (On-chain)</h3>
              
              <div className="flex flex-col gap-3">
                <button 
                  onClick={trackShipper} 
                  disabled={isFetchingGps || !walletAddress} 
                  className="w-full rounded-2xl bg-blue-50 py-4 font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                >
                  🔍 ดึงตำแหน่งคนส่ง (Shipper) จากบล็อกเชน
                </button>
                
                <button 
                  onClick={handleCheckIn} 
                  disabled={isFetchingGps || !walletAddress} 
                  className="w-full rounded-2xl bg-emerald-50 py-4 font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/30 dark:text-emerald-400 transition-colors"
                >
                  🎯 เช็คอินบอกตำแหน่งฉัน (ให้ Shipper รู้)
                </button>
              </div>

              {coords && (
                <div className="mt-6">
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
                    <iframe 
                      width="100%" height="220" frameBorder="0"
                      src={`https://maps.google.com/maps?q=${coords.lat},${coords.lng}&hl=th&z=15&output=embed`} 
                      className="block bg-slate-100 dark:bg-slate-800"
                    />
                  </div>
                  <div className="mt-3 flex justify-center gap-4 text-xs font-medium text-slate-500">
                    <span><b>LAT:</b> {coords.lat.toFixed(6)}</span> | <span><b>LNG:</b> {coords.lng.toFixed(6)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-10 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="border-b border-slate-100 bg-slate-50/50 px-8 py-6 dark:border-slate-800 dark:bg-slate-800/20">
            <h2 className="flex items-center gap-3 text-lg font-bold text-slate-800 dark:text-slate-200">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">🔍</span>
              ประวัติและการติดตาม (History & Tracking)
            </h2>
          </div>
          <div className="p-8">
            <ExplorerSection 
              contractAddress={CONTRACT_ADDRESS} 
              txLimit={25} 
              refreshToken={trackerRefreshToken} 
              searchId={searchId} 
            />
          </div>
        </div>

      </main>
    </div>
  );
}