import { ethers } from "ethers";

import {
  ETHERSCAN_API_V2_URL,
  ETHERSCAN_SEPOLIA_CHAIN_ID,
  getEtherscanApiKey,
  SEPOLIA_ETHERSCAN_SITE,
} from "./etherscan-v2";

export type EtherscanTxRow = {
  blockHash: string;
  blockNumber: string;
  confirmations: string;
  contractAddress: string;
  cumulativeGasUsed: string;
  from: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  hash: string;
  input: string;
  isError: string;
  nonce: string;
  timeStamp: string;
  to: string;
  transactionIndex: string;
  txreceipt_status: string;
  value: string;
};

const METHOD_SIGNATURES: [string, string][] = [
  ["createProduct(string)", "Create Product"],
  ["shipProduct(uint256,address)", "Ship Product"],
  ["receiveProduct(uint256)", "Receive Product"],
  ["recallProduct(uint256)", "Recall Product"],
  ["transferManager(address)", "Transfer Manager"],
];

function methodSelectorMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [sig, label] of METHOD_SIGNATURES) {
    map[ethers.id(sig).slice(0, 10).toLowerCase()] = label;
  }
  return map;
}

const SELECTOR_TO_METHOD = methodSelectorMap();

export function getMethodLabelFromInput(input: string): string {
  if (!input || input === "0x" || input.length < 10) {
    return "Transfer / Empty data";
  }
  const selector = input.slice(0, 10).toLowerCase();
  if (input.startsWith("0x60806040")) {
    return "Contract Creation";
  }
  return SELECTOR_TO_METHOD[selector] ?? "Contract Call";
}

export function getTxStatusLabel(row: EtherscanTxRow): "Success" | "Failed" {
  const r = row as EtherscanTxRow & { txReceipt_status?: string };
  const receipt = r.txreceipt_status ?? r.txReceipt_status ?? "";
  const err = row.isError ?? "";
  if (receipt === "1" && err === "0") return "Success";
  if (receipt === "0" || err === "1") return "Failed";
  return "Success";
}

export async function fetchSepoliaContractTransactions(
  contractAddress: string,
  options?: { offset?: number; page?: number; apiKey?: string; signal?: AbortSignal }
): Promise<EtherscanTxRow[]> {
  // Browser path: go through our Next.js API route to avoid CORS and hide API key.
  if (typeof window !== "undefined") {
    const offset = options?.offset ?? 20;
    const page = options?.page ?? 1;
    const url = new URL("/api/etherscan/txlist", window.location.origin);
    url.searchParams.set("address", contractAddress);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), { signal: options?.signal });
    if (!res.ok) {
      if (res.status === 429) throw new Error("Etherscan rate limit hit (HTTP 429)");
      throw new Error(`Etherscan HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      status: string;
      message: string;
      result: EtherscanTxRow[] | string;
    };
    if (data.status === "0") {
      const msg = String(data.message ?? "");
      const resultStr =
        typeof data.result === "string" ? data.result : String(data.result ?? "");
      if (
        msg.toLowerCase().includes("no transactions") ||
        resultStr.toLowerCase().includes("no transactions")
      ) {
        return [];
      }
      throw new Error(
        resultStr || msg || "Etherscan returned an error (check API key / rate limit)"
      );
    }
    return Array.isArray(data.result) ? data.result : [];
  }

  const offset = options?.offset ?? 20;
  const page = options?.page ?? 1;
  const apiKey = options?.apiKey ?? getEtherscanApiKey();
  if (!apiKey.trim()) {
    throw new Error(
      "Missing Etherscan API key (Sepolia testnet only via API v2). Create a key at https://etherscan.io/apidashboard and set NEXT_PUBLIC_ETHERSCAN_API_KEY in .env.local"
    );
  }

  const url = new URL(ETHERSCAN_API_V2_URL);
  url.searchParams.set("chainid", ETHERSCAN_SEPOLIA_CHAIN_ID);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", contractAddress);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("page", String(page));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("sort", "desc");
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString(), {
    signal: options?.signal,
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Etherscan rate limit hit (HTTP 429)");
    }
    throw new Error(`Etherscan HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    status: string;
    message: string;
    result: EtherscanTxRow[] | string;
  };

  if (data.status === "0") {
    const msg = String(data.message ?? "");
    const resultStr =
      typeof data.result === "string" ? data.result : String(data.result ?? "");
    if (
      msg.toLowerCase().includes("no transactions") ||
      resultStr.toLowerCase().includes("no transactions")
    ) {
      return [];
    }
    throw new Error(
      resultStr || msg || "Etherscan returned an error (check API key / rate limit)"
    );
  }

  if (!Array.isArray(data.result)) {
    return [];
  }

  return data.result;
}

export function sepoliaTxUrl(hash: string): string {
  return `${SEPOLIA_ETHERSCAN_SITE}/tx/${hash}`;
}
