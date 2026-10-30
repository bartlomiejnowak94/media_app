import { useEffect, useMemo, useState } from "react";
import { Film, Plus, Search, Settings as SettingsIcon, Star, X, RefreshCw, Github, LoaderCircle, Pencil, Trash2, Image as ImageIcon } from "lucide-react";
import { deleteMovie, loadMovies, saveMovie, testGitHub } from "./github";
import type { Movie, Settings } from "./types";

const STORAGE_KEY = "media-app-settings";
const defaults: Settings = { owner: "", repo: "media_lists", branch: "main", folder: "Database", token: "" };

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
    catch { return defaults; }
  });
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Movie | null>(null);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [rating, setRating] = useState("");
  const [poster, setPoster] = useState("");
  const [note, setNote] = useState("");

  const configured = Boolean(settings.owner && settings.repo && settings.folder && settings.token);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  async function refresh() {
    if (!configured) { setShowSettings(true); return; }
    setLoading(true);
    setError("");
    try {
      setMovies(await loadMovies(settings));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (configured) void refresh();
  }, []);

  const visibleMovies = useMemo(
    () => movies.filter(movie => movie.title.toLowerCase().includes(query.toLowerCase())),
    [movies, query]
  );

  function openNew() {
    setEditing(null);
    setTitle("");
    setYear("");
    setRating("");
    setPoster("");
    setNote("");
    setShowEditor(true);
  }

  function openEdit(movie: Movie) {
    setEditing(movie);
    setTitle(movie.title);
    setYear(movie.year);
    setRating(movie.rating);
    setPoster(movie.poster);
    setNote(movie.body || "");
    setShowEditor(true);
  }

  async function save() {
    if (!title.trim()) return;
    if (rating !== "" && (Number(rating) < 0 || Number(rating) > 10)) {
      setError("Ocena musi mieścić się w zakresie 0–10.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await saveMovie(settings, editing, { title, year, rating, poster, note });
      setShowEditor(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function remove(movie: Movie) {
    if (!confirm(`Usunąć „${movie.title}” z repozytorium?`)) return;
    setLoading(true);
    setError("");
    try {
      await deleteMovie(settings, movie);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><Film size={19}/></div><span>media<span className="accent">lists</span></span></div>
      <div className="header-actions">
        <button className="icon-btn" aria-label="Odśwież" onClick={() => void refresh()} disabled={loading}><RefreshCw size={18}/></button>
        <button className="icon-btn" aria-label="Ustawienia" onClick={() => setShowSettings(true)}><SettingsIcon size={19}/></button>
      </div>
    </header>

    <main>
      <section className="intro">
        <div><p className="eyebrow">TWOJA KOLEKCJA</p><h1>Filmy<span className="muted">.</span></h1><p className="subline">{movies.length} {movies.length === 1 ? "film" : "filmów"} w bibliotece</p></div>
        <button className="primary-btn" onClick={openNew}><Plus size={18}/> Dodaj film</button>
      </section>

      <div className="toolbar">
        <div className="searchbox"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Szukaj w bibliotece..." /></div>
        <span className="count">{visibleMovies.length} / {movies.length}</span>
      </div>

      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")}><X size={16}/></button></div>}

      {!configured ? <div className="empty-state"><Github size={36}/><h2>Połącz swoją bibliotekę</h2><p>Uzupełnij ustawienia prywatnego repozytorium GitHub.</p><button className="primary-btn" onClick={() => setShowSettings(true)}>Otwórz ustawienia</button></div>
      : loading && movies.length === 0 ? <div className="empty-state"><LoaderCircle className="spin" size={30}/><p>Wczytuję bibliotekę...</p></div>
      : visibleMovies.length === 0 ? <div className="empty-state"><Film size={36}/><h2>{query ? "Nic nie znaleziono" : "Twoja biblioteka jest pusta"}</h2><p>{query ? "Spróbuj innego tytułu." : "Dodaj pierwszy film do swojej kolekcji."}</p>{!query && <button className="primary-btn" onClick={openNew}><Plus size={18}/> Dodaj film</button>}</div>
      : <div className="movie-grid">{visibleMovies.map(movie => <article className="movie-card" key={movie.path}>
          <button className="poster-button" onClick={() => openEdit(movie)} aria-label={`Edytuj ${movie.title}`}>
            {movie.poster ? <img src={movie.poster} alt={`Plakat: ${movie.title}`} loading="lazy" onError={e => { e.currentTarget.style.display = "none"; }}/> : <div className="poster-placeholder"><ImageIcon size={34}/></div>}
            <span className="edit-overlay"><Pencil size={17}/></span>
          </button>
          <div className="movie-meta"><div className="movie-title" title={movie.title}>{movie.title}</div><div className="movie-sub"><span>{movie.year || "—"}</span><span className="rating"><Star size={13} fill="currentColor"/>{movie.rating && movie.rating !== "0" ? Number(movie.rating).toFixed(1) : "—"}</span></div></div>
        </article>)}</div>}
    </main>

    <footer><span>MEDIA LISTS · MARKDOWN LIBRARY</span><span>{loading ? "Ładowanie..." : "Gotowe"}</span></footer>

    {showSettings && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setShowSettings(false)}>
      <section className="modal">
        <div className="modal-head"><div><p className="eyebrow">KONFIGURACJA</p><h2>Ustawienia</h2></div><button className="icon-btn" onClick={() => setShowSettings(false)}><X/></button></div>
        <p className="help">Podaj dane prywatnego repozytorium <b>media_lists</b>. Token jest przechowywany lokalnie w tej przeglądarce.</p>
        <label>GitHub username<input value={settings.owner} onChange={e => setSettings({...settings, owner:e.target.value})} placeholder="Twój login GitHub"/></label>
        <label>Repozytorium danych<input value={settings.repo} onChange={e => setSettings({...settings, repo:e.target.value})} placeholder="media_lists"/></label>
        <div className="two-col"><label>Branch<input value={settings.branch} onChange={e => setSettings({...settings, branch:e.target.value})} placeholder="main"/></label><label>Folder z plikami MD<input value={settings.folder} onChange={e => setSettings({...settings, folder:e.target.value})} placeholder="Database"/></label></div>
        <label>GitHub Fine-grained Personal Access Token<input type="password" autoComplete="off" value={settings.token} onChange={e => setSettings({...settings, token:e.target.value})} placeholder="github_pat_..."/></label>
        <div className="help">Token: wybierz tylko repozytorium <b>media_lists</b> i ustaw Repository permissions → Contents: Read and write. Metadata pozostaw Read-only.</div>
        <div className="modal-actions"><button className="secondary-btn" onClick={async () => { try { await testGitHub(settings); alert("Połączenie z GitHubem działa."); } catch(e) { alert((e as Error).message); } }}>Testuj GitHub</button><button className="primary-btn" onClick={() => {setShowSettings(false); void refresh();}}>Zapisz i wczytaj</button></div>
      </section>
    </div>}

    {showEditor && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setShowEditor(false)}>
      <section className="modal">
        <div className="modal-head"><div><p className="eyebrow">{editing ? "EDYCJA WPISU" : "NOWY WPIS"}</p><h2>{editing ? "Edytuj film" : "Dodaj film"}</h2></div><button className="icon-btn" onClick={() => setShowEditor(false)}><X/></button></div>
        <p className="help">Uzupełnij dane ręcznie. Plakat może być bezpośrednim adresem URL do obrazka.</p>
        <label>Tytuł<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Np. Blade Runner 2049"/></label>
        <div className="two-col">
          <label>Rok<input inputMode="numeric" value={year} onChange={e => setYear(e.target.value)} placeholder="2017"/></label>
          <label>Ocena (0–10)<input type="number" min="0" max="10" step="0.5" value={rating} onChange={e => setRating(e.target.value)} placeholder="8.5"/></label>
        </div>
        <label>Adres plakatu (URL)<input value={poster} onChange={e => setPoster(e.target.value)} placeholder="https://..."/></label>
        {poster && <div className="poster-preview"><img src={poster} alt="Podgląd plakatu" onError={e => {e.currentTarget.style.display="none";}}/></div>}
        <label>Notatka (opcjonalnie)<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Twoje przemyślenia..."/></label>
        <div className="modal-actions">
          {editing && <button className="danger-btn" onClick={() => {setShowEditor(false); void remove(editing);}}><Trash2 size={16}/> Usuń</button>}
          <button className="primary-btn" onClick={() => void save()} disabled={loading || !title.trim()}>{loading ? <LoaderCircle className="spin"/> : null}Zapisz w GitHub</button>
        </div>
      </section>
    </div>}
  </div>;
}