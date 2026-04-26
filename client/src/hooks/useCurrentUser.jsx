import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api.js';

const CurrentUserContext = createContext(null);

export function CurrentUserProvider({ children }) {
  const [users, setUsers] = useState([]);
  const [currentId, setCurrentId] = useState(() => {
    const stored = localStorage.getItem('userId');
    return stored ? Number(stored) : null;
  });

  useEffect(() => {
    api.listUsers().then(setUsers).catch(console.error);
  }, []);

  useEffect(() => {
    if (currentId == null) {
      localStorage.removeItem('userId');
    } else {
      localStorage.setItem('userId', String(currentId));
    }
  }, [currentId]);

  const current = users.find(u => u.id === currentId) || null;
  const value = { users, current, setCurrentId };

  return (
    <CurrentUserContext.Provider value={value}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error('useCurrentUser must be used inside <CurrentUserProvider>');
  return ctx;
}
