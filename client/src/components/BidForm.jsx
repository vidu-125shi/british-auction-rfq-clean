import { useState } from 'react';
import { api } from '../api.js';

const empty = { carrierName: '', freightCharges: '', originCharges: '', destinationCharges: '', transitTimeDays: '', quoteValidityDays: '' };

export default function BidForm({ rfqId, onSubmitted, previousTotal }) {
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const total =
    (Number(form.freightCharges) || 0) +
    (Number(form.originCharges) || 0) +
    (Number(form.destinationCharges) || 0);

  const required = ['carrierName', 'freightCharges', 'originCharges', 'destinationCharges', 'transitTimeDays', 'quoteValidityDays'];
  const missing = required.some(k => form[k] === '' || form[k] === null);
  const violatesUnderbid = previousTotal != null && total >= previousTotal;
  const canSubmit = !missing && !violatesUnderbid && !submitting;

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.submitBid(rfqId, {
        carrierName: form.carrierName,
        freightCharges: Number(form.freightCharges),
        originCharges: Number(form.originCharges),
        destinationCharges: Number(form.destinationCharges),
        transitTimeDays: Number(form.transitTimeDays),
        quoteValidityDays: Number(form.quoteValidityDays)
      });
      setForm(empty);
      onSubmitted(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldCls = 'w-full border border-slate-300 rounded px-2 py-1 text-sm';

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <h3 className="font-medium">Submit a bid</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-600">Carrier name</span>
          <input className={fieldCls} value={form.carrierName} onChange={e => set('carrierName', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Freight charges</span>
          <input type="number" min="0" className={fieldCls} value={form.freightCharges} onChange={e => set('freightCharges', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Origin charges</span>
          <input type="number" min="0" className={fieldCls} value={form.originCharges} onChange={e => set('originCharges', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Destination charges</span>
          <input type="number" min="0" className={fieldCls} value={form.destinationCharges} onChange={e => set('destinationCharges', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Transit time (days)</span>
          <input type="number" min="0" className={fieldCls} value={form.transitTimeDays} onChange={e => set('transitTimeDays', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Quote validity (days)</span>
          <input type="number" min="1" className={fieldCls} value={form.quoteValidityDays} onChange={e => set('quoteValidityDays', e.target.value)} />
        </label>
      </div>
      <div className="text-sm">
        <span className="text-slate-600">Live total: </span>
        <span className="font-semibold">{total.toLocaleString()}</span>
        {previousTotal != null && (
          <span className="text-slate-500 ml-3">your previous: {previousTotal.toLocaleString()}</span>
        )}
        {violatesUnderbid && (
          <span className="ml-3 text-red-700">must be strictly lower than your previous bid</span>
        )}
      </div>
      {error && <div className="text-red-700 text-sm">{error}</div>}
      <button type="submit" disabled={!canSubmit}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
        {submitting ? 'Submitting…' : 'Submit bid'}
      </button>
    </form>
  );
}
