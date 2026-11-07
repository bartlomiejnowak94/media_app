import { useEffect, useMemo, useRef, useState } from "react";
import {
  Film, Plus, Search, Settings as SettingsIcon, Star, X,
  RefreshCw, Github, LoaderCircle, Pencil, Trash2,
  Image as ImageIcon, Clapperboard, Tv, LayoutDashboard,
  Library, ArrowRight, ChartNoAxesCombined, CalendarDays
} from "lucide-react";
import { deleteMovie, loadMovies, saveMovie, testGitHub } from "./github";
import {
  MAX_RATING, MIN_RATING, RATING_OPTIONS, RATING_STEP,
  applyPending, getLastWatched, getRating, getTags, getWatchedDates,
  isBacklog, isValidRating, isWatched
} from "./movies";
import type { PendingChanges } from "./movies";
import type { Movie, Settings } from "./types";

const STORAGE_KEY = "media-app-settings";
const defaults: Settings = {
  owner: "",
  repo: "media_lists",
  branch: "main",
  folder: "Movies/Database",
  token: ""
};

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
  const [editorError, setEditorError] = useState("");
  const [query, setQuery] = useState("");

  // The index is rebuilt by GitHub Actions and lags behind writes. Changes we
  // made ourselves are kept in `pendingRef` and laid over the last loaded
  // index until the index catches up.
  const indexRef = useRef<Movie[]>([]);
  const pendingRef = useRef<PendingChanges>(new Map());
  const refreshSeq = useRef(0);
  const reconcileTimer = useRef<number | undefined>(undefined);
  const [pendingCount, setPendingCount] = useState(0);

  const [mediaSection, setMediaSection] = useState<"movies" | "tv">("movies");
  const [movieView, setMovieView] = useState<"overview" | "library" | "statistics">("overview");
  const [selectedStatsYear, setSelectedStatsYear] = useState(new Date().getFullYear());
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

  function showMovies() {
    const { movies: merged, remaining } = applyPending(indexRef.current, pendingRef.current);
    pendingRef.current = remaining;
    setPendingCount(remaining.size);
    setMovies(merged);
  }

  async function refresh(options: { silent?: boolean } = {}) {
    if (!configured) {
      setShowSettings(true);
      return;
    }

    // Only the most recent request may update the screen, so a slow older
    // response cannot overwrite newer data.
    const seq = ++refreshSeq.current;

    if (!options.silent) {
      setLoading(true);
      setError("");
    }

    try {
      const indexMovies = await loadMovies(settings);
      if (seq !== refreshSeq.current) return;
      indexRef.current = indexMovies;
      showMovies();
    } catch (e) {
      if (!options.silent && seq === refreshSeq.current) {
        setError((e as Error).message);
      }
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  // After a write, re-check the index in the background (with growing delays,
  // about four minutes in total) until it contains our changes.
  const RECONCILE_DELAYS = [8000, 15000, 25000, 40000, 60000, 90000];

  function scheduleReconcile() {
    window.clearTimeout(reconcileTimer.current);
    let attempt = 0;

    const tick = () => {
      if (pendingRef.current.size === 0 || attempt >= RECONCILE_DELAYS.length) return;
      reconcileTimer.current = window.setTimeout(async () => {
        await refresh({ silent: true });
        tick();
      }, RECONCILE_DELAYS[attempt++]);
    };

    tick();
  }

  function registerChange(upsert: Movie | null, removedPath: string | null) {
    if (upsert) pendingRef.current.set(upsert.path, upsert);
    if (removedPath) pendingRef.current.set(removedPath, null);
    showMovies();
    scheduleReconcile();
  }

  useEffect(() => () => window.clearTimeout(reconcileTimer.current), []);

  useEffect(() => {
    if (configured) void refresh();
  }, []);

  const watchedMovies = useMemo(
    () => movies.filter(isWatched),
    [movies]
  );

  const yearlyWatchActivity = useMemo(() => {
    const counts = new Map<number, number>();

    movies.forEach(movie => {
      getWatchedDates(movie).forEach(date => {
        const year = Number(date.slice(0, 4));
        counts.set(year, (counts.get(year) || 0) + 1);
      });
    });

    if (!counts.size) return [];

    const minYear = Math.min(...counts.keys());
    const maxYear = Math.max(...counts.keys());

    return Array.from(
      { length: maxYear - minYear + 1 },
      (_, i) => ({
        year: minYear + i,
        count: counts.get(minYear + i) || 0
      })
    );
  }, [movies]);

  const releaseYearActivity = useMemo(() => {
    const counts = new Map<number, number>();

    movies.forEach(movie => {
      if (!getWatchedDates(movie).length) return;

      const year = Number(movie.year);

      if (!Number.isInteger(year) || year < 1888 || year > currentYear + 5) {
        return;
      }

      counts.set(year, (counts.get(year) || 0) + 1);
    });

    if (!counts.size) return [];

    const minYear = Math.min(...counts.keys());
    const maxYear = Math.max(...counts.keys());

    return Array.from(
      { length: maxYear - minYear + 1 },
      (_, i) => ({
        year: minYear + i,
        count: counts.get(minYear + i) || 0
      })
    );
  }, [movies, currentYear]);

  const maxYearlyWatches = Math.max(
    1,
    ...yearlyWatchActivity.map(item => item.count)
  );

  const maxReleaseYearCount = Math.max(
    1,
    ...releaseYearActivity.map(item => item.count)
  );

  const backlogMovies = useMemo(
    () => movies.filter(isBacklog),
    [movies]
  );

  const recentlyWatched = useMemo(
    () => [...watchedMovies]
      .sort((a, b) => getLastWatched(b) - getLastWatched(a))
      .slice(0, 6),
    [watchedMovies]
  );

  const statsYears = useMemo(() => {
  const years = new Set(
    movies.flatMap(movie =>
      getWatchedDates(movie).map(date => Number(date.slice(0, 4)))
    )
  );

  years.add(currentYear);

  return [...years].sort((a, b) => b - a);
  }, [movies, currentYear]);

  const yearWatches = useMemo(() => {
    return movies.flatMap(movie =>
      getWatchedDates(movie)
        .filter(date => Number(date.slice(0, 4)) === selectedStatsYear)
        .map(date => ({ movie, date }))
    );
  }, [movies, selectedStatsYear]);

  const yearMovies = useMemo(() => {
    const unique = new Map<string, Movie>();

    yearWatches.forEach(({ movie }) => {
      unique.set(movie.path, movie);
    });

    return [...unique.values()];
  }, [yearWatches]);

  const monthlyActivity = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) => ({
      month: index,
      count: yearWatches.filter(({ date }) =>
        Number(date.slice(5, 7)) === index + 1
      ).length
    }));
  }, [yearWatches]);

  const weekdayActivity = useMemo(() => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    return days.map((day, index) => ({
      day,
      count: yearWatches.filter(({ date }) => {
        const [year, month, dayOfMonth] = date.split("-").map(Number);
        const weekday = new Date(year, month - 1, dayOfMonth).getDay();
        return (weekday + 6) % 7 === index;
      }).length
    }));
  }, [yearWatches]);

  const platformActivity = useMemo(() => {
    const platforms = ["apple", "hbo", "kino", "netflix", "prime", "stremio", "yt"];

    return platforms.map(platform => ({
      platform,
      count: yearMovies.filter(movie =>
        getTags(movie).includes(`movie/${platform}/${selectedStatsYear}`)
      ).length
    }));
  }, [yearMovies, selectedStatsYear]);

  const selectedYearReleaseActivity = useMemo(() => {
    const counts = new Map<number, number>();

    yearMovies.forEach(movie => {
      const year = Number(movie.year);
      if (!Number.isInteger(year)) return;

      counts.set(year, (counts.get(year) || 0) + 1);
    });

    if (!counts.size) return [];

    const minYear = Math.min(...counts.keys());
    const maxYear = Math.max(...counts.keys());

    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => ({
      year: minYear + i,
      count: counts.get(minYear + i) || 0
    }));
  }, [yearMovies]);

  const maxSelectedYearReleaseCount = Math.max(
    1,
    ...selectedYearReleaseActivity.map(item => item.count)
  );

  // Unrated movies must not drag the average down, so they are left out.
  const ratedYearMovies = yearMovies.filter(movie => getRating(movie) !== null);
  const yearAverageRating = ratedYearMovies.length
    ? (
        ratedYearMovies.reduce((sum, movie) => sum + (getRating(movie) ?? 0), 0) /
        ratedYearMovies.length
      ).toFixed(2)
    : "—";

  const maxMonthlyCount = Math.max(1, ...monthlyActivity.map(item => item.count));
  const maxWeekdayCount = Math.max(1, ...weekdayActivity.map(item => item.count));
  const maxPlatformCount = Math.max(1, ...platformActivity.map(item => item.count));

  const bestMonth = monthlyActivity.reduce(
    (best, item) => item.count > best.count ? item : best,
    monthlyActivity[0]
  );

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const platformNames: Record<string, string> = {
    apple: "Apple",
    hbo: "HBO",
    kino: "Cinema",
    netflix: "Netflix",
    prime: "Prime Video",
    stremio: "Stremio",
    yt: "YouTube"
  };

  const ratingDistribution = useMemo(() => {
    const distribution = RATING_OPTIONS.map(rating => ({
      rating,
      count: watchedMovies.filter(
        movie => getRating(movie) === rating
      ).length
    }));

    return distribution;
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
    setEditorError("");
    setEditing(null);
    setTitle("");
    setYear("");
    setRating("");
    setPoster("");
    setNote("");
    setShowEditor(true);
  }

  function openEdit(movie: Movie) {
    setEditorError("");
    setEditing(movie);
    setTitle(movie.title);
    setYear(movie.year);
    setRating(movie.rating);
    setPoster(movie.poster);
    setNote(movie.body || "");
    setShowEditor(true);
  }

  async function save() {
    // Errors are shown inside the editor: the page-level banner sits behind
    // the modal and would be invisible.
    setEditorError("");

    if (!title.trim()) {
      setEditorError("Enter a title.");
      return;
    }

    if (!/^\d{4}$/.test(year.trim())) {
      setEditorError("Enter a valid year (YYYY).");
      return;
    }

    if (!isValidRating(rating)) {
      setEditorError(
        `Rating must be empty or between ${MIN_RATING} and ${MAX_RATING} in steps of ${RATING_STEP}.`
      );
      return;
    }

    setLoading(true);

    try {
      const result = await saveMovie(settings, editing, { title, year, rating, poster, note });
      registerChange(result.movie, result.removedPath);
      setShowEditor(false);
      if (result.warning) setError(result.warning);
    } catch (e) {
      setEditorError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function remove(movie: Movie) {
    if (!confirm(`Delete "${movie.title}" from the repository?`)) return;

    setLoading(true);
    setError("");

    try {
      await deleteMovie(settings, movie);
      registerChange(null, movie.path);
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
                className={movieView === "overview" ? "selected" : ""}
                onClick={() => setMovieView("overview")}
              >
                <LayoutDashboard size={16} /> Overview
              </button>

              <button
                className={movieView === "library" ? "selected" : ""}
                onClick={() => setMovieView("library")}
              >
                <Library size={16} /> Library
              </button>

              <button
                className={movieView === "statistics" ? "selected" : ""}
                onClick={() => setMovieView("statistics")}
              >
                <ChartNoAxesCombined size={16} /> Statistics
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
            ) : movieView === "overview" ? (
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

                <section className="analytics-section overview-chart">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">YOUR WATCHING HISTORY</p>
                    <h2>Movies watched per year</h2>
                  </div>
                  <span className="chart-total">
                    {yearlyWatchActivity.reduce((sum, item) => sum + item.count, 0)} watches
                  </span>
                </div>

                {yearlyWatchActivity.length ? (
                  <div className="year-horizontal-chart">
                    <div className="horizontal-bars">
                      {yearlyWatchActivity.map(item => (
                        <div
                          className="horizontal-bar-column"
                          key={item.year}
                          title={`${item.year}: ${item.count} watches`}
                        >
                          <div className="horizontal-bar-track">
                            <div
                              className="horizontal-bar"
                              style={{
                                height: `${item.count / maxYearlyWatches * 100}%`
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="horizontal-axis">
                      <span>{yearlyWatchActivity[0]?.year}</span>
                      <span>{yearlyWatchActivity[yearlyWatchActivity.length - 1]?.year}</span>
                    </div>
                  </div>
                ) : (
                  <p className="chart-empty">No watching history available.</p>
                )}
              </section>

              <section className="analytics-section overview-chart">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">FILM HISTORY</p>
                    <h2>Movies by release year</h2>
                  </div>
                  <span className="chart-total">
                    {releaseYearActivity.reduce((sum, item) => sum + item.count, 0)} movies
                  </span>
                </div>

                {releaseYearActivity.length ? (
                  <div className="year-horizontal-chart">
                    <div className="horizontal-bars">
                      {releaseYearActivity.map(item => (
                        <div
                          className="horizontal-bar-column"
                          key={item.year}
                          title={`${item.year}: ${item.count} movies`}
                        >
                          <div className="horizontal-bar-track">
                            <div
                              className="horizontal-bar"
                              style={{
                                height: `${item.count / maxReleaseYearCount * 100}%`
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="horizontal-axis">
                      <span>{releaseYearActivity[0]?.year}</span>
                      <span>{releaseYearActivity[releaseYearActivity.length - 1]?.year}</span>
                    </div>
                  </div>
                ) : (
                  <p className="chart-empty">No watching history available.</p>
                )}
              </section>

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
              ) : movieView === "statistics" ? (
                <div className="year-statistics">
                  <div className="section-heading year-heading">
                    <div>
                      <p className="eyebrow">YOUR WATCHING HISTORY</p>
                      <h2>Year in Review</h2>
                    </div>

                    <select
                      className="year-select"
                      value={selectedStatsYear}
                      onChange={e => setSelectedStatsYear(Number(e.target.value))}
                    >
                      {statsYears.map(year => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </div>

                  <div className="stats-grid">
                    <article className="stat-card">
                      <div className="stat-icon"><Film size={19} /></div>
                      <p className="stat-label">Unique movies</p>
                      <div className="stat-value">{yearMovies.length}</div>
                    </article>

                    <article className="stat-card">
                      <div className="stat-icon"><Clapperboard size={19} /></div>
                      <p className="stat-label">Total watches</p>
                      <div className="stat-value">{yearWatches.length}</div>
                    </article>

                    <article className="stat-card">
                      <div className="stat-icon"><Star size={19} /></div>
                      <p className="stat-label">Average rating</p>
                      <div className="stat-value">{yearAverageRating}</div>
                    </article>

                    <article className="stat-card">
                      <div className="stat-icon"><CalendarDays size={19} /></div>
                      <p className="stat-label">Best month</p>
                      <div className="stat-value best-month">
                        {bestMonth.count ? monthNames[bestMonth.month] : "—"}
                      </div>
                    </article>
                  </div>

                  <section className="analytics-section">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">WATCHING HABITS</p>
                        <h2>Monthly activity</h2>
                      </div>
                      <span className="chart-total">{yearWatches.length} watches</span>
                    </div>

                    <div className="monthly-chart">
                      {monthlyActivity.map(item => (
                        <div className="monthly-column" key={item.month}>
                          <span className="chart-count">{item.count || ""}</span>
                          <div className="monthly-bar-track">
                            <div
                              className="monthly-bar"
                              style={{
                                height: `${item.count / maxMonthlyCount * 100}%`
                              }}
                            />
                          </div>
                          <span className="chart-label">{monthNames[item.month]}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="analytics-section">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">WATCHING HABITS</p>
                        <h2>Activity by weekday</h2>
                      </div>
                    </div>

                    <div className="weekday-chart">
                      {weekdayActivity.map(item => (
                        <div className="weekday-row" key={item.day}>
                          <span>{item.day}</span>
                          <div className="weekday-track">
                            <div
                              className="weekday-bar"
                              style={{
                                width: `${item.count / maxWeekdayCount * 100}%`
                              }}
                            />
                          </div>
                          <strong>{item.count}</strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="analytics-section">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">WHERE YOU WATCH</p>
                        <h2>Platforms</h2>
                      </div>
                    </div>

                    <div className="platform-chart">
                      {platformActivity.map(item => (
                        <div className="weekday-row" key={item.platform}>
                          <span>{platformNames[item.platform]}</span>
                          <div className="weekday-track">
                            <div
                              className="weekday-bar"
                              style={{
                                width: `${item.count / maxPlatformCount * 100}%`
                              }}
                            />
                          </div>
                          <strong>{item.count}</strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="analytics-section">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">FILM HISTORY</p>
                        <h3>Movies by release year</h3>
                      </div>
                    </div>

                    {selectedYearReleaseActivity.length ? (
                      <div className="year-horizontal-chart">
                        <div className="horizontal-bars">
                          {selectedYearReleaseActivity.map(item => (
                            <div
                              className="horizontal-bar-column"
                              key={item.year}
                              title={`${item.year}: ${item.count} movies`}
                            >
                              <div className="horizontal-bar-track">
                                <div
                                  className="horizontal-bar"
                                  style={{
                                    height: `${item.count / maxSelectedYearReleaseCount * 100}%`
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="horizontal-axis">
                          <span>{selectedYearReleaseActivity[0]?.year}</span>
                          <span>{selectedYearReleaseActivity[selectedYearReleaseActivity.length - 1]?.year}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="chart-empty">No movie data available.</p>
                    )}
                  </section>

                  <section className="analytics-section">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">YOUR COLLECTION</p>
                        <h2>Movies watched in {selectedStatsYear}</h2>
                      </div>
                      <span className="chart-total">{yearMovies.length} movies</span>
                    </div>

                    {yearMovies.length ? (
                      <MovieGrid movies={yearMovies} onEdit={openEdit} />
                    ) : (
                      <div className="empty-state compact">
                        <Film size={30} />
                        <p>No movies watched in this year.</p>
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
        <span>
          {loading
            ? "Loading..."
            : pendingCount
              ? `Syncing ${pendingCount} change${pendingCount === 1 ? "" : "s"}…`
              : "All systems ready"}
        </span>
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
                  // A different repo/branch must not inherit pending changes.
                  window.clearTimeout(reconcileTimer.current);
                  pendingRef.current = new Map();
                  setPendingCount(0);
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
              Characters not allowed in file names are replaced.
            </p>

            {editorError && (
              <div className="error-banner" role="alert">
                <span>{editorError}</span>
              </div>
            )}

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
                Rating
                <select value={rating} onChange={e => setRating(e.target.value)}>
                  <option value="">Not rated</option>
                  {rating !== "" && !RATING_OPTIONS.includes(Number(rating)) && (
                    <option value={rating}>{rating} (outside {MIN_RATING}–{MAX_RATING})</option>
                  )}
                  {RATING_OPTIONS.map(value => (
                    <option key={value} value={String(value)}>{value}</option>
                  ))}
                </select>
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