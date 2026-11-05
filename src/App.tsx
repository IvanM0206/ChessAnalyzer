import { NavLink, Route, Routes } from 'react-router-dom';
import { IconImport, IconLibrary, IconSettings } from './components/Icons';
import LibraryPage from './pages/Library';
import ImportPage from './pages/Import';
import ReviewPage from './pages/Review';
import SettingsPage from './pages/Settings';

const nav = [
  { to: '/', label: 'Mis partidas', icon: IconLibrary, end: true },
  { to: '/import', label: 'Importar', icon: IconImport },
  { to: '/settings', label: 'Configuración', icon: IconSettings },
];

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><img src="/favicon.svg" alt="" />Chess Analyzer</div>
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon /><span>{label}</span>
          </NavLink>
        ))}
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/review/:id" element={<ReviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
