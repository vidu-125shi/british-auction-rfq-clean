import { useParams } from 'react-router-dom';
import { usePolledRfq } from '../hooks/usePolledRfq.js';
import { useCurrentUser } from '../hooks/useCurrentUser.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Countdown from '../components/Countdown.jsx';
import BidsTable from '../components/BidsTable.jsx';
import ActivityLog from '../components/ActivityLog.jsx';
import BidForm from '../components/BidForm.jsx';

const TRIGGER_LABELS = {
  BID_RECEIVED: 'Any bid received',
  ANY_RANK_CHANGE: 'Any rank change',
  L1_RANK_CHANGE: 'L1 rank change'
};

export default function DetailsPage() {
  const { id } = useParams();
  const rfqId = Number(id);
  const { rfq, error, setRfq } = usePolledRfq(rfqId, 3000);
  const { current } = useCurrentUser();

  if (error) return <div className="text-red-700">Error: {error}</div>;
  if (!rfq)  return <div>Loading…</div>;

  const myBid = current?.role === 'supplier'
    ? rfq.bids.find(b => b.supplier.id === current.id)
    : null;

  const showBidForm = current?.role === 'supplier' && rfq.status === 'Active';

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{rfq.referenceId} · {rfq.name}</h1>
          <StatusBadge status={rfq.status} />
        </div>
        <div className="text-sm text-slate-600 mt-1">
          Pickup: {rfq.pickupDate} · Forced close: {new Date(rfq.forcedBidCloseAt).toLocaleString()}
        </div>
        <div className="text-sm mt-2">
          {rfq.status === 'Active' && (
            <>⏱ Closes in <Countdown targetIso={rfq.bidCloseCurrentAt} /> (current close: {new Date(rfq.bidCloseCurrentAt).toLocaleTimeString()})</>
          )}
          {rfq.status === 'Scheduled' && (
            <>Starts in <Countdown targetIso={rfq.bidStartAt} /></>
          )}
          {(rfq.status === 'Closed' || rfq.status === 'ForceClosed') && (
            <span className="text-slate-700">
              Auction {rfq.status === 'ForceClosed' ? 'force-' : ''}closed at {new Date(rfq.bidCloseCurrentAt).toLocaleString()}.
              {rfq.bids[0] && <> Final L1: {rfq.bids[0].supplier.name} at ₹{rfq.bids[0].totalPrice.toLocaleString()}.</>}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-2">
          Trigger: {TRIGGER_LABELS[rfq.triggerType]} · Window: {rfq.triggerWindowMinutes} min · Extension: {rfq.extensionMinutes} min
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <div className="bg-white border border-slate-200 rounded">
          <div className="px-4 py-2 border-b border-slate-200 font-medium text-sm">Bids</div>
          <BidsTable bids={rfq.bids} currentSupplierId={current?.role === 'supplier' ? current.id : null} />
        </div>
        <div className="bg-white border border-slate-200 rounded">
          <div className="px-4 py-2 border-b border-slate-200 font-medium text-sm">Activity log</div>
          <div className="max-h-96 overflow-y-auto">
            <ActivityLog entries={rfq.activityLog} />
          </div>
        </div>
      </div>

      {showBidForm && (
        <BidForm
          rfqId={rfqId}
          previousTotal={myBid ? myBid.totalPrice : null}
          onSubmitted={(updated) => setRfq(updated)}
        />
      )}
    </div>
  );
}
