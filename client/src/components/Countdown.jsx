import { useEffect, useState } from 'react';

function diffParts(targetIso) {
  const ms = new Date(targetIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { h, m, s };
}

export default function Countdown({ targetIso, prefix = '' }) {
  const [parts, setParts] = useState(() => diffParts(targetIso));

  useEffect(() => {
    const id = setInterval(() => setParts(diffParts(targetIso)), 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  if (!parts) return <span className="text-slate-400">—</span>;
  const { h, m, s } = parts;
  const pad = (n) => String(n).padStart(2, '0');
  return (
    <span className="font-mono">
      {prefix}{h > 0 ? `${pad(h)}:` : ''}{pad(m)}:{pad(s)}
    </span>
  );
}
