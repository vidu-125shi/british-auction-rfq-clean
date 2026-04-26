import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Countdown from '../components/Countdown.jsx';

export default function ListingPage() {
  const [rfqs, setRfqs] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.listRfqs();
        if (!cancelled) setRfqs(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (error) return <div className="text-red-700">Error: {error}</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Auctions</h1>
      <table className="w-full bg-white border border-slate-200 rounded">
        <thead className="bg-slate-100 text-left text-xs uppercase tracking-wider text-slate-600">
          <tr>
            <th className="p-3">Reference</th>
            <th className="p-3">Name</th>
            <th className="p-3">Status</th>
            <th className="p-3">Lowest bid</th>
            <th className="p-3">Closes</th>
            <th className="p-3">Forced close</th>
          </tr>
        </thead>
        <tbody>
          {rfqs.length === 0 && (
            <tr><td colSpan={6} className="p-4 text-center text-slate-500">No RFQs yet.</td></tr>
          )}
          {rfqs.map(r => (
            <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="p-3"><Link className="text-blue-700 underline" to={`/rfqs/${r.id}`}>{r.referenceId}</Link></td>
              <td className="p-3">{r.name}</td>
              <td className="p-3"><StatusBadge status={r.status} /></td>
              <td className="p-3">
                {r.lowestBid
                  ? <span>₹{r.lowestBid.totalPrice.toLocaleString()} <span className="text-slate-500">({r.lowestBid.supplierName})</span></span>
                  : <span className="text-slate-400">—</span>}
              </td>
              <td className="p-3">
                {r.status === 'Active'
                  ? <Countdown targetIso={r.bidCloseCurrentAt} prefix="in " />
                  : new Date(r.bidCloseCurrentAt).toLocaleString()}
              </td>
              <td className="p-3">{new Date(r.forcedBidCloseAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
