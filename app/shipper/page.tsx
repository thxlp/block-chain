/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";

// Path imports
import {
  getBrowserProviderAfterConnect,
  getInjectedEthereum,
} from "../../lib/injected-ethereum";
import { getSepoliaContractAddress } from "../../lib/sepolia-contract";

import { ExplorerSection } from "../components/ExplorerSection";
import { ShipProductCard } from "../components/ShipProductCard";
import contractABI from "../../contractABI.json";

const CONTRACT_ADDRESS = getSepoliaContractAddress();
const SEPOLIA_CHAIN_ID = 11155111;

export default function ShipperPage() {
  const abi = useMemo(() => {
    return contractABI as any[];
  }, []);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [contractInstance, setContractInstance] = useState<ethers.Contract | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("พร้อมรับการเชื่อมต่อ Wallet");
  const [isConnecting, setIsConnecting] = useState(false);
  const [trackerRefreshToken, setTrackerRefreshToken] = useState(0);
  const [searchId, setSearchId] = useState<string>("");

  // GPS State
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isFetchingGps, setIsFetchingGps] = useState(false);
  const [gpsProductId, setGpsProductId] = useState<string>("");

  // 🛠️ แก้ไข useEffect ให้ Auto-Connect Contract สมบูรณ์
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
          await autoInitContract(); // <-- จุดที่แก้
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

  const connectWallet = async () => {
    if (typeof window === "undefined") return;
    setIsConnecting(true);
    setStatusMessage("กำลังเชื่อมต่อ MetaMask...");

    try {
      const conn = await getBrowserProviderAfterConnect();
      if (!conn.ok) {
        setStatusMessage(
          conn.reason === "no-wallet" ? "ไม่พบ MetaMask"
            : conn.reason === "rejected" ? "ยกเลิกการเชื่อมต่อ"
            : "กรุณาเลือกบัญชีใน MetaMask"
        );
        return;
      }

      const provider = conn.provider;
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      if (!Array.isArray(abi) || abi.length === 0) {
        setStatusMessage("ไม่พบ ABI ในไฟล์ contractABI.json");
        setWalletAddress(address);
        return;
      }

      const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);
      setWalletAddress(address);
      setContractInstance(contract);
      
      setStatusMessage(
        Number(network.chainId) === SEPOLIA_CHAIN_ID
          ? "เชื่อมต่อสำเร็จ พร้อมส่งสินค้า"
          : `⚠ กรุณาเปลี่ยนเป็น Sepolia (ID: ${SEPOLIA_CHAIN_ID})`
      );
    } catch (err: any) {
      setStatusMessage(`ข้อผิดพลาด: ${err?.message ?? "Unknown"}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleShipSuccess = (shippedProductId: string) => {
    setSearchId(shippedProductId);
    setTrackerRefreshToken((prev) => prev + 1);
  };

  const handleCheckIn = async () => {
    if (!contractInstance) return alert("กรุณาเชื่อมต่อ Wallet ก่อนทำการเช็คอินพิกัด");
    if (!gpsProductId.trim()) return alert("กรุณากรอก Product ID ในกล่อง GPS ก่อน");

    setIsFetchingGps(true);
    setStatusMessage("กำลังดึง GPS ของคุณ...");

    if (!navigator.geolocation) {
      alert("เบราว์เซอร์ของคุณไม่รองรับการดึงพิกัด GPS");
      setIsFetchingGps(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = Math.round(pos.coords.latitude * 1000000);
      const lng = Math.round(pos.coords.longitude * 1000000);

      try {
        setStatusMessage("กำลังบันทึกพิกัดคุณลงบล็อกเชน (รอ Confirm)...");
        const tx = await contractInstance.updateShipperLocation(BigInt(gpsProductId), lat, lng);
        await tx.wait();
        
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatusMessage("✅ อัปเดตพิกัดลงบล็อกเชนสำเร็จ! ลูกค้าเห็นคุณแล้ว");
      } catch (err) {
        console.error(err);
        setStatusMessage("❌ เกิดข้อผิดพลาดตอนบันทึกพิกัด");
      } finally {
        setIsFetchingGps(false);
      }
    }, (err) => { 
      alert(`ไม่สามารถดึงตำแหน่งได้: ${err.message}`); 
      setIsFetchingGps(false); 
    }, { enableHighAccuracy: true });
  };

  const trackReceiver = async () => {
    if (!contractInstance) return alert("กรุณาต่อ Wallet ก่อน");
    if (!gpsProductId.trim()) return alert("กรุณากรอก Product ID ก่อนดูตำแหน่งลูกค้า");

    setIsFetchingGps(true);
    setStatusMessage("กำลังดึงตำแหน่งลูกค้าจากบล็อกเชน...");

    try {
      const product = await contractInstance.products(BigInt(gpsProductId));
      const rLat = Number(product[8]); 
      const rLng = Number(product[9]);

      if (rLat === 0 && rLng === 0) {
        alert("ลูกค้า (Receiver) ยังไม่ได้เช็คอินพิกัดของสินค้านี้!");
        setStatusMessage("ไม่พบข้อมูลพิกัดลูกค้า");
      } else {
        setCoords({ lat: rLat / 1000000, lng: rLng / 1000000 });
        setStatusMessage("📍 แสดงพิกัดล่าสุดของลูกค้า (Receiver)");
      }
    } catch (err) {
      console.error(err);
      setStatusMessage("❌ ค้นหาข้อมูลไม่พบ หรือ Product ID ผิด");
    } finally {
      setIsFetchingGps(false);
    }
  };

  const isErrorStatus = statusMessage.includes("ข้อผิดพลาด") || statusMessage.includes("กรุณาเปลี่ยน") || statusMessage.includes("ไม่พบ") || statusMessage.includes("❌");
  const isSuccessStatus = statusMessage.includes("สำเร็จ") || statusMessage.includes("✅");

  return (
    <div className="min-h-screen bg-[#F4F7FE] text-slate-800 dark:bg-slate-950 dark:text-slate-100 font-sans">
      
      <nav className="sticky top-0 z-50 border-b border-slate-200/50 bg-white/70 backdrop-blur-xl dark:border-slate-800/60 dark:bg-slate-950/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 text-white shadow-md shadow-indigo-200 dark:shadow-none">
                <span className="text-xl font-bold">S</span>
              </div>
              <span className="text-xl font-extrabold tracking-tight">Shipper<span className="text-indigo-600 dark:text-indigo-400">Hub</span></span>
            </div>

            <div className="flex items-center gap-3">
              <Link 
                href="/" 
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/50 px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span>📦</span> ไปหน้าผู้รับ (Receiver)
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        
        <div className="mb-8 flex flex-col items-start justify-between gap-6 rounded-3xl bg-white p-8 shadow-sm dark:bg-slate-900 md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl">Shipper Dashboard</h1>
            <p className="mt-2 text-slate-500 dark:text-slate-400">ระบบจัดการและบันทึกข้อมูลการขนส่งสินค้าลงบนบล็อกเชน</p>
          </div>

          {!walletAddress ? (
            <button 
              onClick={connectWallet}
              disabled={isConnecting}
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-8 py-4 text-sm font-bold text-white shadow-lg shadow-slate-300 transition-all hover:bg-slate-800 hover:-translate-y-0.5 active:scale-95 dark:bg-indigo-600 dark:shadow-none dark:hover:bg-indigo-500 disabled:opacity-70"
            >
              {isConnecting ? (
                <>
                  <svg className="h-5 w-5 animate-spin text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังเชื่อมต่อ...
                </>
              ) : "🦊 Connect MetaMask"}
            </button>
          ) : (
            <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-2 pr-5 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-xl dark:bg-indigo-900/40">
                🧑‍🚀
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Connected Wallet</span>
                <span className="font-mono text-base font-semibold text-indigo-600 dark:text-indigo-400">{truncateAddress(walletAddress)}</span>
              </div>
            </div>
          )}
        </div>

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
                <h2 className="flex items-center gap-3 text-lg font-bold text-slate-800 dark:text-slate-200">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">📦</span>
                  ฟอร์มจัดส่งสินค้า (Ship Product)
                </h2>
                <p className="mt-1 text-sm text-slate-500">กรอกรายละเอียดเพื่อบันทึกสถานะการจัดส่งลงบน Smart Contract</p>
              </div>
              <div className="p-8">
                <ShipProductCard 
                  contractInstance={contractInstance} 
                  walletAddress={walletAddress} 
                  chainId={chainId} 
                  sepoliaChainId={SEPOLIA_CHAIN_ID} 
                  onStatus={setStatusMessage} 
                  onShipSuccess={handleShipSuccess} 
                />
              </div>
            </div>
          </div>

          <div className="space-y-6 lg:col-span-5">
            
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-white shadow-lg dark:from-slate-800 dark:to-slate-900">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-indigo-500/20 blur-2xl"></div>
              <h4 className="mb-1 text-sm font-bold text-slate-300 uppercase tracking-wider">Smart Contract</h4>
              <p className="font-mono text-sm break-all text-indigo-300">{CONTRACT_ADDRESS}</p>
              <div className="mt-5 flex items-center gap-2">
                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400"></div>
                <p className="text-xs font-medium text-slate-300">Sepolia Network Ready</p>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-1">📍 จัดการพิกัด (On-chain)</h3>
              <p className="text-xs text-slate-500 mb-5">อัปเดตและติดตามตำแหน่งผ่านบล็อกเชน</p>
              
              <div className="mb-4">
                <input 
                  type="text" 
                  placeholder="ใส่ Product ID ที่ต้องการตรวจสอบ/อัปเดต..." 
                  value={gpsProductId}
                  onChange={(e) => setGpsProductId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={trackReceiver} 
                  disabled={isFetchingGps || !walletAddress} 
                  className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-50 py-3.5 font-bold text-indigo-700 transition-all hover:bg-indigo-100 active:scale-[0.98] disabled:opacity-50 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50"
                >
                  🔍 ดึงพิกัดลูกค้า (Receiver)
                </button>

                <button 
                  onClick={handleCheckIn} 
                  disabled={isFetchingGps || !walletAddress} 
                  className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-50 py-3.5 font-bold text-emerald-700 transition-all hover:bg-emerald-100 active:scale-[0.98] disabled:opacity-50 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                >
                  {isFetchingGps ? "กำลังดำเนินการ..." : "🎯 อัปเดตพิกัดฉันลงบล็อกเชน"}
                </button>
              </div>

              {coords ? (
                <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm dark:border-slate-700">
                    <iframe 
                      width="100%" 
                      height="220" 
                      className="block bg-slate-100 dark:bg-slate-800"
                      frameBorder="0"
                      src={`https://maps.google.com/maps?q=${coords.lat},${coords.lng}&hl=th&z=15&output=embed`} 
                    />
                  </div>
                  <div className="mt-3 flex justify-center gap-4 rounded-xl bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                    <span className="flex items-center gap-1"><b>LAT:</b> {coords.lat.toFixed(6)}</span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span className="flex items-center gap-1"><b>LNG:</b> {coords.lng.toFixed(6)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-12 text-center dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm dark:bg-slate-800">
                    <span className="text-xl">📡</span>
                  </div>
                  <p className="max-w-[200px] text-sm text-slate-500 dark:text-slate-400">กรอก ID และกดปุ่มเพื่อเริ่มติดตาม GPS</p>
                </div>
              )}
            </div>

          </div>
        </div>

        <div className="mt-10 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="border-b border-slate-100 bg-slate-50/50 px-8 py-6 dark:border-slate-800 dark:bg-slate-800/20">
            <h2 className="flex items-center gap-3 text-lg font-bold text-slate-800 dark:text-slate-200">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400">🔍</span>
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

      <footer className="mt-12 border-t border-slate-200/60 bg-white/50 py-8 text-center text-sm font-medium text-slate-400 dark:border-slate-800/60 dark:bg-slate-950/50">
        <p>© 2026 SupplyChain dApp - Shipper Terminal</p>
      </footer>
    </div>
  );
}