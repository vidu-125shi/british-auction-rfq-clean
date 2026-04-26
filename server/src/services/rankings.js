export function computeRankings(latestBidsBySupplier) {
  const sorted = [...latestBidsBySupplier].sort((a, b) => {
    if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return sorted.map((bid, i) => ({ ...bid, rank: i + 1 }));
}

export function l1Of(latestBidsBySupplier) {
  if (latestBidsBySupplier.length === 0) return null;
  const ranked = computeRankings(latestBidsBySupplier);
  return ranked[0].supplierId;
}
