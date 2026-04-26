import { useCurrentUser } from '../hooks/useCurrentUser.jsx';

export default function UserSwitcher() {
  const { users, current, setCurrentId } = useCurrentUser();

  return (
    <div className="ml-auto flex items-center gap-2 text-sm">
      <span className="text-slate-500">Acting as:</span>
      <select
        className="border border-slate-300 rounded px-2 py-1 bg-white"
        value={current?.id ?? ''}
        onChange={e => setCurrentId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">— select user —</option>
        {users.map(u => (
          <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
        ))}
      </select>
    </div>
  );
}
