import { lazy, Suspense, useEffect } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
import Home from './pages/Home'
import JoinGame from './pages/JoinGame'
import Lobby from './pages/Lobby'
import PlayerGame from './pages/PlayerGame'
import Results from './pages/Results'
import NotFound from './pages/NotFound'

const AdminAuth = lazy(() => import('./context/AdminAuth'))
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const CreateGame = lazy(() => import('./pages/admin/CreateGame'))
const GameControl = lazy(() => import('./pages/admin/GameControl'))

export default function App() {
  const { pathname } = useLocation()
  const admin = pathname.startsWith('/admin')
  useEffect(() => {
    window.scrollTo(0, 0)
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname])
  return (
    <div className={pathname === '/' ? 'app app-home' : 'app'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Game.io home">
          <img
            className="brand-mark"
            src="/favicon.svg"
            width="38"
            height="38"
            alt=""
          />
          game<span className="red-text">.io</span>
        </Link>
        <nav aria-label="Main navigation">
          {admin ? (
            <Link to="/">← Player mode</Link>
          ) : (
            <Link to="/admin/login">Host a Game</Link>
          )}
        </nav>
      </header>
      <main id="main" className="page-shell" tabIndex={-1}>
        <Suspense
          fallback={
            <p role="status" className="preview-note">
              Loading page…
            </p>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/join" element={<JoinGame />} />
            <Route path="/lobby/:gameCode" element={<Lobby />} />
            <Route path="/game/:gameCode" element={<PlayerGame />} />
            <Route path="/results/:gameCode" element={<Results />} />
            <Route path="/admin" element={<AdminAuth />}>
              <Route path="login" element={<AdminLogin />} />
              <Route index element={<AdminDashboard />} />
              <Route path="create" element={<CreateGame />} />
              <Route path="game/:gameCode" element={<GameControl />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
