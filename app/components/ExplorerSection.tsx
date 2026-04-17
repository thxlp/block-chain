"use client";

import { useState } from "react";

import contractABI from "../../contractABI.json";
import { ProductStatus } from "./ProductStatus";
import { TransactionHistory } from "./TransactionHistory";

type Props = {
  contractAddress: string;
  txLimit?: number;
  refreshToken?: number;
  searchId?: string;
};

export function ExplorerSection({
  contractAddress,
  txLimit = 200,
  refreshToken = 0,
  searchId = "",
}: Props) {
  const [trackedProductId, setTrackedProductId] = useState<string | null>(null);
  const abi = contractABI as unknown[];

  return (
    <div className="mx-auto mt-10 w-full max-w-4xl space-y-6 pb-8">
      <ProductStatus
        contractAddress={contractAddress}
        abi={abi}
        onTrackedProductIdChange={setTrackedProductId}
        refreshToken={refreshToken}
        searchId={searchId}
      />
      <TransactionHistory
        contractAddress={contractAddress}
        productIdFilter={trackedProductId}
        deferFetchUntilFilter
        title="ประวัติธุรกรรมที่เกี่ยวข้อง"
        limit={txLimit}
        refreshToken={refreshToken}
      />
    </div>
  );
}
