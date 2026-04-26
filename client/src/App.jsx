import { Routes, Route, Link } from 'react-router-dom';
import UserSwitcher from './components/UserSwitcher.jsx';
import { useCurrentUser } from './hooks/useCurrentUser.jsx';
import ListingPage from './pages/ListingPage.jsx';
import CreateRfqPage from './pages/CreateRfqPage.jsx';
import DetailsPage from './pages/DetailsPage.jsx';

export default function App() {
  const { current } = useCurrentUser();

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6">
        <Link to="/" className="text-lg font-semibold">British Auction RFQ</Link>
        <nav className="flex gap-4 text-sm text-slate-700">
          <Link to="/">Auctions</Link>
          {current?.role === 'buyer' && <Link to="/rfqs/new">New RFQ</Link>}
        </nav>
        <UserSwitcher />
      </header>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<ListingPage />} />
          <Route path="/rfqs/new" element={<CreateRfqPage />} />
          <Route path="/rfqs/:id" element={<DetailsPage />} />
        </Routes>
      </main>
    </div>
  );
}
