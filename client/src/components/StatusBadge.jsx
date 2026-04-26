const COLORS = {
  Scheduled:    'bg-slate-200 text-slate-700',
  Active:       'bg-green-100 text-green-800',
  Closed:       'bg-slate-300 text-slate-700',
  ForceClosed:  'bg-red-100 text-red-800'
};

export default function StatusBadge({ status }) {
  const cls = COLORS[status] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
