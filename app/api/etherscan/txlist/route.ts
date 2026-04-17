import { NextResponse } from "next/server";

import { ETHERSCAN_API_V2_URL, ETHERSCAN_SEPOLIA_CHAIN_ID } from "../../../../lib/etherscan-v2";

type EtherscanTxRow = Record<string, unknown>;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = (url.searchParams.get("address") ?? "").trim();
  const pageRaw = (url.searchParams.get("page") ?? "1").trim();
  const page = Math.max(1, Math.min(10, Number(pageRaw) || 1));
  const offsetRaw = (url.searchParams.get("offset") ?? "20").trim();
  const offset = Math.max(1, Math.min(200, Number(offsetRaw) || 20));

  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const apiKey =
    process.env.ETHERSCAN_API_KEY ??
    process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY ??
    "";

  if (!apiKey.trim()) {
    return NextResponse.json(
      { error: "Missing ETHERSCAN_API_KEY" },
      { status: 500 }
    );
  }

  const upstream = new URL(ETHERSCAN_API_V2_URL);
  upstream.searchParams.set("chainid", ETHERSCAN_SEPOLIA_CHAIN_ID);
  upstream.searchParams.set("module", "account");
  upstream.searchParams.set("action", "txlist");
  upstream.searchParams.set("address", address);
  upstream.searchParams.set("startblock", "0");
  upstream.searchParams.set("endblock", "99999999");
  upstream.searchParams.set("page", String(page));
  upstream.searchParams.set("offset", String(offset));
  upstream.searchParams.set("sort", "desc");
  upstream.searchParams.set("apikey", apiKey);

  const res = await fetch(upstream.toString(), {
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Etherscan HTTP ${res.status}` },
      { status: res.status }
    );
  }

  const data = (await res.json()) as {
    status: string;
    message: string;
    result: EtherscanTxRow[] | string;
  };

  return NextResponse.json(data, { status: 200 });
}

