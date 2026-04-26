import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.jsx';

const TRIGGER_OPTIONS = [
  { value: 'BID_RECEIVED',    label: 'Any bid received in trigger window' },
  { value: 'ANY_RANK_CHANGE', label: 'Any supplier rank change in trigger window' },
  { value: 'L1_RANK_CHANGE',  label: 'Lowest bidder (L1) changes in trigger window' }
];

const initial = {
  referenceId: '',
  name: '',
  pickupDate: '',
  bidStartAt: '',
  bidCloseAt: '',
  forcedBidCloseAt: '',
  triggerType: 'L1_RANK_CHANGE',
  triggerWindowMinutes: 10,
  extensionMinutes: 5
};

function toIso(localDt) {
  if (!localDt) return '';
  return new Date(localDt).toISOString();
}

function validate(form) {
  const errs = {};
  if (!form.referenceId) errs.referenceId = 'required';
  if (!form.name) errs.name = 'required';
  if (!form.pickupDate) errs.pickupDate = 'required';
  if (!form.bidStartAt) errs.bidStartAt = 'required';
  if (!form.bidCloseAt) errs.bidCloseAt = 'required';
  if (!form.forcedBidCloseAt) errs.forcedBidCloseAt = 'required';
  if (form.bidStartAt && form.bidCloseAt && !(form.bidStartAt < form.bidCloseAt))
    errs.bidCloseAt = 'must be after bid start';
  if (form.bidCloseAt && form.forcedBidCloseAt && !(form.bidCloseAt < form.forcedBidCloseAt))
    errs.forcedBidCloseAt = 'must be after bid close';
  if (form.pickupDate && form.bidCloseAt && form.pickupDate < form.bidCloseAt.slice(0, 10))
    errs.pickupDate = 'must be on or after bid close date';
  if (!(form.triggerWindowMinutes > 0)) errs.triggerWindowMinutes = 'must be > 0';
  if (!(form.extensionMinutes > 0)) errs.extensionMinutes = 'must be > 0';
  return errs;
}

export default function CreateRfqPage() {
  const { current } = useCurrentUser();
  const nav = useNavigate();
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);

  if (!current) return <div>Pick a user from the top-right dropdown to continue.</div>;
  if (current.role !== 'buyer') return <div className="text-slate-700">Only buyers can create RFQs.</div>;

  const errors = validate(form);
  const isValid = Object.keys(errors).length === 0;

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const created = await api.createRfq({
        referenceId: form.referenceId,
        name: form.name,
        pickupDate: form.pickupDate,
        bidStartAt: toIso(form.bidStartAt),
        bidCloseAt: toIso(form.bidCloseAt),
        forcedBidCloseAt: toIso(form.forcedBidCloseAt),
        triggerType: form.triggerType,
        triggerWindowMinutes: Number(form.triggerWindowMinutes),
        extensionMinutes: Number(form.extensionMinutes)
      });
      nav(`/rfqs/${created.id}`);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass = 'w-full border border-slate-300 rounded px-3 py-2 text-sm';

  return (
    <form onSubmit={submit} className="max-w-2xl mx-auto bg-white p-6 rounded border border-slate-200 space-y-6">
      <h1 className="text-2xl font-semibold">Create RFQ</h1>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-slate-600">RFQ details</h2>
        <Field label="Reference ID" error={errors.referenceId}>
          <input className={fieldClass} value={form.referenceId} onChange={e => update('referenceId', e.target.value)} />
        </Field>
        <Field label="Name" error={errors.name}>
          <input className={fieldClass} value={form.name} onChange={e => update('name', e.target.value)} />
        </Field>
        <Field label="Pickup date" error={errors.pickupDate}>
          <input type="date" className={fieldClass} value={form.pickupDate} onChange={e => update('pickupDate', e.target.value)} />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-slate-600">Auction window</h2>
        <Field label="Bid start" error={errors.bidStartAt}>
          <input type="datetime-local" className={fieldClass} value={form.bidStartAt} onChange={e => update('bidStartAt', e.target.value)} />
        </Field>
        <Field label="Bid close" error={errors.bidCloseAt}>
          <input type="datetime-local" className={fieldClass} value={form.bidCloseAt} onChange={e => update('bidCloseAt', e.target.value)} />
        </Field>
        <Field label="Forced bid close" error={errors.forcedBidCloseAt}>
          <input type="datetime-local" className={fieldClass} value={form.forcedBidCloseAt} onChange={e => update('forcedBidCloseAt', e.target.value)} />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-slate-600">Auction config</h2>
        <div>
          <div className="text-sm font-medium mb-1">Trigger type</div>
          {TRIGGER_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="radio"
                name="triggerType"
                value={opt.value}
                checked={form.triggerType === opt.value}
                onChange={() => update('triggerType', opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
        <Field label="Trigger window (X, minutes)" error={errors.triggerWindowMinutes}>
          <input type="number" min="1" className={fieldClass}
                 value={form.triggerWindowMinutes}
                 onChange={e => update('triggerWindowMinutes', Number(e.target.value))} />
        </Field>
        <Field label="Extension duration (Y, minutes)" error={errors.extensionMinutes}>
          <input type="number" min="1" className={fieldClass}
                 value={form.extensionMinutes}
                 onChange={e => update('extensionMinutes', Number(e.target.value))} />
        </Field>
      </section>

      {serverError && <div className="text-red-700 text-sm">Error: {serverError}</div>}

      <button type="submit" disabled={!isValid || submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
        {submitting ? 'Creating…' : 'Create RFQ'}
      </button>
    </form>
  );
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium block mb-1">{label}</span>
      {children}
      {error && <span className="text-red-600 text-xs">{error}</span>}
    </label>
  );
}
