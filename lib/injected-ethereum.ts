import { ethers } from "ethers";

/** MetaMask ฯลฯ ขยาย EIP-1193 ด้วย event API (ไม่ได้อยู่ใน type ฐานของ ethers) */
export type InjectedEthereumProvider = ethers.Eip1193Provider & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (
    event: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => void
  ) => void;
};

type WindowWithEthereum = Window & {
  ethereum?: InjectedEthereumProvider;
};

/**
 * Injected EIP-1193 provider (MetaMask ฯลฯ)
 *
 * Frontend ต้องใช้ `new ethers.BrowserProvider(<injected>)` เท่านั้น — อย่ายิง HTTP RPC จาก origin ของเว็บ (CORS)
 */
export function getInjectedEthereum(): InjectedEthereumProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as WindowWithEthereum).ethereum;
}

export type InjectedConnectResult =
  | { ok: true; provider: ethers.BrowserProvider }
  | { ok: false; reason: "no-wallet" | "rejected" | "no-accounts" };

/**
 * ขอเชื่อมต่อบัญชีก่อนอ่าน on-chain — ไม่มี provider จนกว่าจะมี injected + ผ่าน eth_requestAccounts
 * เทียบเท่า: `new ethers.BrowserProvider(window.ethereum)` (ethers v6) / Web3Provider (v5)
 */
export async function getBrowserProviderAfterConnect(): Promise<InjectedConnectResult> {
  const eth = getInjectedEthereum();
  if (!eth) {
    return { ok: false, reason: "no-wallet" };
  }
  try {
    const accounts = (await eth.request({
      method: "eth_requestAccounts",
    })) as string[] | undefined;
    if (!accounts?.length) {
      return { ok: false, reason: "no-accounts" };
    }
  } catch {
    return { ok: false, reason: "rejected" };
  }
  // ethers v6 — เทียบเท่า v5 Web3Provider(window.ethereum)
  return { ok: true, provider: new ethers.BrowserProvider(eth) };
}
