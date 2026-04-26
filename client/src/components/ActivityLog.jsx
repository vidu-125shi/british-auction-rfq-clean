const PILL = {
  AUCTION_OPENED:    'bg-slate-200 text-slate-700',
  BID_SUBMITTED:     'bg-blue-100 text-blue-800',
  EXTENSION:         'bg-amber-100 text-amber-800',
  EXTENSION_CAPPED:  'bg-red-100 text-red-800',
  AUCTION_CLOSED:    'bg-slate-300 text-slate-700'
};

export default function ActivityLog({ entries }) {
  if (!entries || entries.length === 0) {
    return <div className="text-slate-500 italic p-3 text-sm">No activity yet.</div>;
  }
  return (
    <ol className="divide-y divide-slate-100 text-sm">
      {entries.map(e => (
        <li key={e.id} className="p-2">
          <div className="flex items-start gap-2">
            <span className="text-slate-400 text-xs w-20 flex-none">{new Date(e.createdAt).toLocaleTimeString()}</span>
            <span className={`inline-block px-2 rounded text-xs ${PILL[e.eventType] || 'bg-slate-100'}`}>
              {e.eventType}
            </span>
          </div>
          <div className="ml-20 mt-1">{e.message}</div>
          {e.metadata && (
            <pre className="ml-20 mt-1 text-xs text-slate-500 whitespace-pre-wrap">
              {JSON.stringify(e.metadata, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}
