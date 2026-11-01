import { useEffect, useMemo, useState } from "react";
import {
  Film, Plus, Search, Settings as SettingsIcon, Star, X,
  RefreshCw, Github, LoaderCircle, Pencil, Trash2,
  Image as ImageIcon, Clapperboard, Tv, LayoutDashboard,
  Library, ArrowRight
} from "lucide-react";
import { deleteMovie, loadMovies, saveMovie, testGitHub } from "./github";
import type { Movie, Settings } from "./types";

const STORAGE_KEY = "media-app-settings";
const defaults: Settings = {
  owner: "",
  repo: "media_lists",
  branch: "main",
  folder: "Movies/Database",
  token: ""
};

type MovieData = Movie & {
  frontmatter?: {
    tags?: string[];
    watched?: string[];
    rating?: number | string | null;
  };
};

function getTags(movie: Movie): string[] {
  return ((movie as MovieData).frontmatter?.tags || []).map(String);
}

function getRating(movie: Movie): number | null {
  const value = Number(movie.rating);
  return movie.rating !== "" && movie.rating != null &&
    Number.isFinite(value) && value > 0 ? value : null;
}

function isWatched(movie: Movie): boolean {
  return getRating(movie) !== null;
}

function isBacklog(movie: Movie): boolean {
  return getRating(movie) === null && getTags(movie).includes("backlog");
}

function getLastWatched(movie: Movie): number {
  const dates = (movie as MovieData).frontmatter?.watched || [];
  const parsed = dates
    .map(value => {
      const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
      return match ? new Date(match[0]).getTime() : NaN;
    })
    .filter(Number.isFinite);

  return parsed.length ? Math.max(...parsed) : 0;
}

function MovieGrid({
  movies,
  onEdit
}: {
  movies: Movie[];
  onEdit: (movie: Movie) => void;
}) {
  return (
    <div className="movie-grid">
      {movies.map(movie => (
        <article className="movie-card" key={movie.path}>
          <button
            className="poster-button"
            onClick={() => onEdit(movie)}
            aria-label={`Edit ${movie.title}`}
          >
            {movie.poster ? (
              <img
                src={movie.poster}
                alt={`Poster: ${movie.title}`}
                loading="lazy"
                onError={e => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="poster-placeholder">
                <ImageIcon size={34} />
              </div>
            )}
            <span className="edit-overlay">
              <Pencil size={17} />
            </span>
          </button>

          <div className="movie-meta">
            <div className="movie-title" title={movie.title}>
              {movie.title}
            </div>
            <div className="movie-sub">
              <span>{movie.year || "—"}</span>
              <span className="rating">
                <Star size={13} fill="currentColor" />
                {getRating(movie)?.toFixed(1) ?? "—"}
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (saved.folder === "Database") saved.folder = "Movies/Database";
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  });

  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const [mediaSection, setMediaSection] = useState<"movies" | "tv">("movies");
  const [movieView, setMovieView] = useState<"dashboard" | "library">("dashboard");
  const [filter, setFilter] = useState<"all" | "watched" | "backlog" | "thisYear">("all");

  const [showSettings, setShowSettings] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Movie | null>(null);

  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [rating, setRating] = useState("");
  const [poster, setPoster] = useState("");
  const [note, setNote] = useState("");

  const configured = Boolean(
    settings.owner && settings.repo && settings.folder && settings.token
  );

  const currentYear = new Date().getFullYear();
  const currentYearTag = `y${currentYear}`;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  async function refresh(notBefore?: number) {
    if (!configured) {
      setShowSettings(true);
      return;
    }

    setLoading(true);
    setError("");

    try {
      setMovies(await loadMovies(settings, notBefore));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (configured) void refresh();
  }, []);

  const watchedMovies = useMemo(
    () => movies.filter(isWatched),
    [movies]
  );

  const backlogMovies = useMemo(
    () => movies.filter(isBacklog),
    [movies]
  );

  const thisYearMovies = useMemo(
    () => movies.filter(movie => getTags(movie).includes(currentYearTag)),
    [movies, currentYearTag]
  );

  const recentlyWatched = useMemo(
    () => [...watchedMovies]
      .sort((a, b) => getLastWatched(b) - getLastWatched(a))
      .slice(0, 5),
    [watchedMovies]
  );

  const ratingDistribution = useMemo(() => {
    const ratings = [2, 2.5, 3, 3.5, 4, 4.5, 5];

    return ratings.map(rating => ({
      rating,
      count: watchedMovies.filter(
        movie => getRating(movie) === rating
      ).length
    }));
  }, [watchedMovies]);

  const maxRatingCount = Math.max(
    1,
    ...ratingDistribution.map(item => item.count)
  );

const averageRating = watchedMovies.length
  ? (
      watchedMovies.reduce(
        (sum, movie) => sum + (getRating(movie) || 0),
        0
      ) / watchedMovies.length
    ).toFixed(2)
  : "—";

  const visibleMovies = useMemo(() => {
    let result = [...movies];

    if (filter === "watched") result = result.filter(isWatched);
    if (filter === "backlog") result = result.filter(isBacklog);
    if (filter === "thisYear") {
      result = result.filter(movie => getTags(movie).includes(currentYearTag));
    }

    if (query.trim()) {
      const search = query.toLowerCase();
      result = result.filter(movie =>
        movie.title.toLowerCase().includes(search)
      );
    }

    return result;
  }, [movies, filter, query, currentYearTag]);

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

    if (!/^\d{4}$/.test(year.trim())) {
      setError("Enter a valid year (YYYY).");
      return;
    }

    if (rating !== "" && (Number(rating) < 0 || Number(rating) > 10)) {
      setError("Rating must be between 0 and 10.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const indexNotBefore = Date.now();
      await saveMovie(settings, editing, { title, year, rating, poster, note });
      setShowEditor(false);
      await refresh(indexNotBefore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function remove(movie: Movie) {
    if (!confirm(`Delete "${movie.title}" from the repository?`)) return;

    setLoading(true);
    setError("");

    try {
      const indexNotBefore = Date.now();
      await deleteMovie(settings, movie);
      await refresh(indexNotBefore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon"><Film size={19} /></div>
          <span>media<span className="accent">lists</span></span>
        </div>

        <nav className="main-nav">
          <button
            className={mediaSection === "movies" ? "active" : ""}
            onClick={() => setMediaSection("movies")}
          >
            <Clapperboard size={16} /> Movies
          </button>
          <button
            className={mediaSection === "tv" ? "active" : ""}
            onClick={() => setMediaSection("tv")}
          >
            <Tv size={16} /> TV
          </button>
        </nav>

        <div className="header-actions">
          <button
            className="icon-btn"
            aria-label="Refresh library"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Settings"
            onClick={() => setShowSettings(true)}
          >
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>

      <main>
        {mediaSection === "movies" ? (
          <>
            <div className="section-nav">
              <button
                className={movieView === "dashboard" ? "selected" : ""}
                onClick={() => setMovieView("dashboard")}
              >
                <LayoutDashboard size={16} /> Dashboard
              </button>
              <button
                className={movieView === "library" ? "selected" : ""}
                onClick={() => setMovieView("library")}
              >
                <Library size={16} /> Library
              </button>
            </div>

            <section className="intro">
              <div>
                <p className="eyebrow">YOUR COLLECTION</p>
                <h1>Movies<span className="muted">.</span></h1>
                <p className="subline">
                  {movies.length} movies in your library
                </p>
              </div>
              <button className="primary-btn" onClick={openNew}>
                <Plus size={18} /> Add movie
              </button>
            </section>

            {error && (
              <div className="error-banner">
                <span>{error}</span>
                <button onClick={() => setError("")}><X size={16} /></button>
              </div>
            )}

            {!configured ? (
              <div className="empty-state">
                <Github size={36} />
                <h2>Connect your library</h2>
                <p>Configure your private GitHub repository to get started.</p>
                <button className="primary-btn" onClick={() => setShowSettings(true)}>
                  Open settings
                </button>
              </div>
            ) : loading && movies.length === 0 ? (
              <div className="empty-state">
                <LoaderCircle className="spin" size={30} />
                <p>Loading your library...</p>
              </div>
            ) : movieView === "dashboard" ? (
              <div className="dashboard">
                <div className="stats-grid">
                  <article className="stat-card">
                    <div className="stat-icon"><Film size={19} /></div>
                    <p className="stat-label">Total movies</p>
                    <div className="stat-value">{movies.length}</div>
                  </article>

                  <article className="stat-card">
                    <div className="stat-icon"><Star size={19} /></div>
                    <p className="stat-label">Watched</p>
                    <div className="stat-value">{watchedMovies.length}</div>
                  </article>

                  <article className="stat-card">
                    <div className="stat-icon"><Library size={19} /></div>
                    <p className="stat-label">Planned</p>
                    <div className="stat-value">{backlogMovies.length}</div>
                  </article>
                </div>

                <section className="rating-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">YOUR TASTE</p>
                      <h2>Rating Distribution</h2>
                    </div>
                    <div className="average-rating">
                      <Star size={16} fill="currentColor" />
                      <strong>{averageRating}</strong>
                      <span>average</span>
                    </div>
                  </div>

                  <div className="rating-chart">
                    {ratingDistribution.map(item => (
                      <div className="rating-column" key={item.rating}>
                        <span className="rating-count">{item.count}</span>

                        <div className="rating-bar-container">
                          <div
                            className="rating-bar"
                            style={{
                              height: `${(item.count / maxRatingCount) * 100}%`
                            }}
                          />
                        </div>

                        <span className="rating-number">{item.rating}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="recent-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">YOUR ACTIVITY</p>
                      <h2>Recently watched</h2>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => {
                        setFilter("watched");
                        setMovieView("library");
                      }}
                    >
                      View all <ArrowRight size={15} />
                    </button>
                  </div>

                  {recentlyWatched.length ? (
                    <MovieGrid movies={recentlyWatched} onEdit={openEdit} />
                  ) : (
                    <div className="empty-state compact">
                      <Film size={30} />
                      <p>Your watched movies will appear here.</p>
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <>
                <div className="toolbar">
                  <div className="searchbox">
                    <Search size={17} />
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Search your library..."
                    />
                  </div>
                  <span className="count">
                    {visibleMovies.length} / {movies.length}
                  </span>
                </div>

                <div className="filter-bar">
                  {([
                    ["all", "All"],
                    ["watched", "Watched"],
                    ["backlog", "Backlog"],
                    ["thisYear", `This Year (${currentYear})`]
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "active" : ""}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {visibleMovies.length === 0 ? (
                  <div className="empty-state">
                    <Film size={36} />
                    <h2>{query ? "No movies found" : "No movies here yet"}</h2>
                    <p>
                      {query
                        ? "Try a different search term."
                        : "There are no movies matching this filter."}
                    </p>
                    {!query && filter === "all" && (
                      <button className="primary-btn" onClick={openNew}>
                        <Plus size={18} /> Add movie
                      </button>
                    )}
                  </div>
                ) : (
                  <MovieGrid movies={visibleMovies} onEdit={openEdit} />
                )}
              </>
            )}
          </>
        ) : (
          <section className="coming-soon">
            <div className="coming-icon"><Tv size={30} /></div>
            <p className="eyebrow">YOUR NEXT COLLECTION</p>
            <h1>TV Shows<span className="muted">.</span></h1>
            <p>Track your series, seasons and episodes.</p>
            <span className="coming-label">COMING SOON</span>
          </section>
        )}
      </main>

      <footer>
        <span>MEDIA LISTS · MARKDOWN LIBRARY</span>
        <span>{loading ? "Loading..." : "All systems ready"}</span>
      </footer>

      {showSettings && (
        <div
          className="modal-backdrop"
          onMouseDown={e => e.target === e.currentTarget && setShowSettings(false)}
        >
          <section className="modal">
            <div className="modal-head">
              <div>
                <p className="eyebrow">CONFIGURATION</p>
                <h2>Settings</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                <X />
              </button>
            </div>

            <p className="help">
              Enter your private <b>media_lists</b> repository details.
              Your token is stored locally in this browser.
            </p>

            <label>
              GitHub username
              <input
                value={settings.owner}
                onChange={e => setSettings({ ...settings, owner: e.target.value })}
                placeholder="Your GitHub username"
              />
            </label>

            <label>
              Repository
              <input
                value={settings.repo}
                onChange={e => setSettings({ ...settings, repo: e.target.value })}
                placeholder="media_lists"
              />
            </label>

            <div className="two-col">
              <label>
                Branch
                <input
                  value={settings.branch}
                  onChange={e => setSettings({ ...settings, branch: e.target.value })}
                  placeholder="main"
                />
              </label>
              <label>
                Markdown folder
                <input
                  value={settings.folder}
                  onChange={e => setSettings({ ...settings, folder: e.target.value })}
                  placeholder="Movies/Database"
                />
              </label>
            </div>

            <label>
              GitHub Fine-grained Personal Access Token
              <input
                type="password"
                autoComplete="off"
                value={settings.token}
                onChange={e => setSettings({ ...settings, token: e.target.value })}
                placeholder="github_pat_..."
              />
            </label>

            <div className="help">
              Token permissions: select only the <b>media_lists</b> repository
              and set Repository permissions → Contents: Read and write.
              Keep Metadata as Read-only.
            </div>

            <div className="modal-actions">
              <button
                className="secondary-btn"
                onClick={async () => {
                  try {
                    await testGitHub(settings);
                    alert("GitHub connection successful.");
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                Test GitHub
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  setShowSettings(false);
                  void refresh();
                }}
              >
                Save & Load
              </button>
            </div>
          </section>
        </div>
      )}

      {showEditor && (
        <div
          className="modal-backdrop"
          onMouseDown={e => e.target === e.currentTarget && setShowEditor(false)}
        >
          <section className="modal">
            <div className="modal-head">
              <div>
                <p className="eyebrow">{editing ? "EDIT ENTRY" : "NEW ENTRY"}</p>
                <h2>{editing ? "Edit movie" : "Add movie"}</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowEditor(false)}>
                <X />
              </button>
            </div>

            <p className="help">
              Enter the movie details. The file will be saved as
              Movies/Database/YEAR/Title (YEAR).md.
              The poster should be a direct image URL.
            </p>

            <label>
              Title
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Blade Runner 2049"
              />
            </label>

            <div className="two-col">
              <label>
                Year
                <input
                  inputMode="numeric"
                  value={year}
                  onChange={e => setYear(e.target.value)}
                  placeholder="2017"
                />
              </label>
              <label>
                Rating (0–10)
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={rating}
                  onChange={e => setRating(e.target.value)}
                  placeholder="8.5"
                />
              </label>
            </div>

            <label>
              Poster URL
              <input
                value={poster}
                onChange={e => setPoster(e.target.value)}
                placeholder="https://..."
              />
            </label>

            {poster && (
              <div className="poster-preview">
                <img
                  src={poster}
                  alt="Poster preview"
                  onError={e => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            )}

            <label>
              Notes (optional)
              <textarea
                rows={3}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Your thoughts..."
              />
            </label>

            <div className="modal-actions">
              {editing && (
                <button
                  className="danger-btn"
                  onClick={() => {
                    setShowEditor(false);
                    void remove(editing);
                  }}
                >
                  <Trash2 size={16} /> Delete
                </button>
              )}
              <button
                className="primary-btn"
                onClick={() => void save()}
                disabled={loading || !title.trim()}
              >
                {loading ? <LoaderCircle className="spin" /> : null}
                Save to GitHub
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}