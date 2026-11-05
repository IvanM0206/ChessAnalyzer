import { NavLink, Route, Routes } from 'react-router-dom';
import { IconBoard, IconBook, IconImport, IconLibrary, IconRepertoire, IconSettings, IconStats, IconTrainer } from './components/Icons';
import LibraryPage from './pages/Library';
import ImportPage from './pages/Import';
import ReviewPage from './pages/Review';
import SettingsPage from './pages/Settings';
import RepertoirePage from './pages/Repertoire';
import ExplorerPage from './pages/Explorer';
import TrainerPage from './pages/Trainer';
import StatsPage from './pages/Stats';
import OpeningsPage from './pages/Openings';

const nav = [
  { to: '/', label: 'Mis partidas', icon: IconLibrary, end: true },
  { to: '/import', label: 'Importar', icon: IconImport },
  { to: '/analysis', label: 'Análisis libre', icon: IconBoard },
  { to: '/repertoire', label: 'Repertorio', icon: IconRepertoire },
  { to: '/openings', label: 'Mis aperturas', icon: IconBook },
  { to: '/trainer', label: 'Entrenador', icon: IconTrainer },
  { to: '/stats', label: 'Estadísticas', icon: IconStats },
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
          <Route path="/analysis" element={<ExplorerPage />} />
          <Route path="/repertoire" element={<RepertoirePage />} />
          <Route path="/trainer" element={<TrainerPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/openings" element={<OpeningsPage />} />
        </Routes>
      </main>
    </div>
  );
}
