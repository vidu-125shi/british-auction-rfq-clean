export default function BidsTable({ bids, currentSupplierId }) {
  if (!bids || bids.length === 0) {
    return <div className="text-slate-500 italic p-4">No bids yet — be the first to quote.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-100 text-xs uppercase tracking-wider text-slate-600">
        <tr>
          <th className="p-2 text-left">Rank</th>
          <th className="p-2 text-left">Supplier</th>
          <th className="p-2 text-left">Carrier</th>
          <th className="p-2 text-right">Freight</th>
          <th className="p-2 text-right">Origin</th>
          <th className="p-2 text-right">Dest.</th>
          <th className="p-2 text-right">Total</th>
          <th className="p-2 text-right">Transit</th>
          <th className="p-2 text-right">Validity</th>
          <th className="p-2 text-right">Submitted</th>
        </tr>
      </thead>
      <tbody>
        {bids.map(b => {
          const isMine = currentSupplierId != null && b.supplier.id === currentSupplierId;
          return (
            <tr key={b.supplier.id} className={`border-t border-slate-100 ${isMine ? 'bg-blue-50' : ''}`}>
              <td className="p-2 font-semibold">L{b.rank}</td>
              <td className="p-2">{b.supplier.name}{isMine && ' (you)'}</td>
              <td className="p-2">{b.carrierName}</td>
              <td className="p-2 text-right">{b.freightCharges.toLocaleString()}</td>
              <td className="p-2 text-right">{b.originCharges.toLocaleString()}</td>
              <td className="p-2 text-right">{b.destinationCharges.toLocaleString()}</td>
              <td className="p-2 text-right font-semibold">{b.totalPrice.toLocaleString()}</td>
              <td className="p-2 text-right">{b.transitTimeDays}d</td>
              <td className="p-2 text-right">{b.quoteValidityDays}d</td>
              <td className="p-2 text-right text-slate-500">{new Date(b.submittedAt).toLocaleTimeString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
