import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RATING_OPTIONS, applyPending, asArray, formatDate, getExtraTags, getLastWatched,
  getList, getPlatformWatches, getRating, getTags, getText, getWatchedDates,
  isBacklog, isValidRating, isWatched, safeUrl, sanitizeFilename, stripCoverFromBody,
  stripWikilink, tmdbSize
} from "../src/movies.ts";
import type { Movie } from "../src/types.ts";

function movie(overrides: Partial<Movie> & { frontmatter?: Record<string, unknown> } = {}): Movie {
  return {
    path: "Movies/Database/2014/Lady and the Tramp (1955).md",
    sha: "sha-1",
    title: "Lady and the Tramp",
    year: "1955",
    rating: "4",
    poster: "",
    body: "",
    frontmatter: {},
    ...overrides,
  };
}

test("rating scale is 2–5 in steps of 0.5", () => {
  assert.deepEqual(RATING_OPTIONS, [2, 2.5, 3, 3.5, 4, 4.5, 5]);
  assert.equal(isValidRating(""), true);      // backlog: no rating
  assert.equal(isValidRating("2"), true);
  assert.equal(isValidRating("4.5"), true);
  assert.equal(isValidRating("1.5"), false);  // below the scale
  assert.equal(isValidRating("5.5"), false);  // above the scale
  assert.equal(isValidRating("3.3"), false);  // not a 0.5 step
  assert.equal(isValidRating("abc"), false);
});

test("asArray tolerates single values, null and empty strings", () => {
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray(""), []);
  assert.deepEqual(asArray("movie"), ["movie"]);
  assert.deepEqual(asArray(["a", "b"]), ["a", "b"]);
});

test("tags and watched dates survive hand-edited (non-list) frontmatter", () => {
  const m = movie({ frontmatter: { tags: "backlog", watched: "[[2014-01-09 Cz]]" } });
  assert.deepEqual(getTags(m), ["backlog"]);
  assert.deepEqual(getWatchedDates(m), ["2014-01-09"]);
  assert.doesNotThrow(() => getTags(movie({ frontmatter: { tags: null } })));
  assert.doesNotThrow(() => getWatchedDates(movie({ frontmatter: { watched: null } })));
});

test("watched dates are extracted from Obsidian links and typos are dropped", () => {
  const m = movie({
    frontmatter: {
      watched: ["[[2014-01-09 Cz]]", "[[2205-03-01 Pn]]", "not a date", "[[1700-01-01 Pn]]"],
    },
  });
  assert.deepEqual(getWatchedDates(m, 2026), ["2014-01-09"]);
});

test("last watched picks the newest date, 0 when none", () => {
  const m = movie({ frontmatter: { watched: ["[[2014-01-09 Cz]]", "[[2025-08-23 So]]"] } });
  assert.equal(getLastWatched(m), new Date("2025-08-23").getTime());
  assert.equal(getLastWatched(movie()), 0);
});

test("backlog = tagged backlog and not rated", () => {
  const backlog = movie({ rating: "", frontmatter: { tags: ["movie", "backlog"] } });
  assert.equal(getRating(backlog), null);
  assert.equal(isWatched(backlog), false);
  assert.equal(isBacklog(backlog), true);

  const rated = movie({ rating: "4.5", frontmatter: { tags: ["movie", "backlog"] } });
  assert.equal(getRating(rated), 4.5);
  assert.equal(isBacklog(rated), false);
});

test("sanitizeFilename keeps titles from creating folders or invalid names", () => {
  assert.equal(sanitizeFilename("Face/Off"), "Face-Off");
  assert.equal(sanitizeFilename("Star Wars: Episode IV"), "Star Wars - Episode IV");
  assert.equal(sanitizeFilename("What's Up, Doc?"), "What's Up, Doc");
  assert.equal(sanitizeFilename('He said "no"'), "He said no");
  assert.equal(sanitizeFilename("  Spaced   out.  "), "Spaced out");
  assert.equal(sanitizeFilename("12 Angry Men"), "12 Angry Men");
  assert.equal(sanitizeFilename("Zakochany kundel"), "Zakochany kundel");
  assert.equal(sanitizeFilename("???"), "");
});

test("a saved change is shown immediately and dropped once the index has it", () => {
  const old = movie({ sha: "old", rating: "3" });
  const saved = movie({ sha: "new", rating: "4.5" });
  const pending = new Map([[saved.path, saved]]);

  // Index is stale: our version wins and stays pending.
  let result = applyPending([old], pending);
  assert.equal(result.movies[0].rating, "4.5");
  assert.equal(result.remaining.size, 1);

  // Index caught up: nothing left to overlay.
  result = applyPending([saved], pending);
  assert.equal(result.movies[0].sha, "new");
  assert.equal(result.remaining.size, 0);
});

test("a newly added movie appears before the index knows about it", () => {
  const added = movie({ path: "Movies/Database/1999/The Matrix (1999).md", title: "The Matrix", sha: "x" });
  const result = applyPending([movie()], new Map([[added.path, added]]));
  assert.deepEqual(result.movies.map(m => m.title), ["Lady and the Tramp", "The Matrix"]);
});

test("a deleted movie disappears at once and is forgotten once the index agrees", () => {
  const m = movie();
  const pending = new Map<string, Movie | null>([[m.path, null]]);

  let result = applyPending([m], pending);
  assert.equal(result.movies.length, 0);
  assert.equal(result.remaining.size, 1);

  result = applyPending([], pending);
  assert.equal(result.movies.length, 0);
  assert.equal(result.remaining.size, 0);
});

test("a rename shows only the new path while the index still has the old one", () => {
  const before = movie({ path: "Movies/Database/1955/Old (1955).md", title: "Old", sha: "a" });
  const after = movie({ path: "Movies/Database/1956/New (1956).md", title: "New", sha: "b" });
  const pending = new Map<string, Movie | null>([[after.path, after], [before.path, null]]);

  const result = applyPending([before], pending);
  assert.deepEqual(result.movies.map(m => m.title), ["New"]);
});

test("movies with the same title keep a stable order", () => {
  const a = movie({ path: "Movies/Database/1950/Dune (1950).md", title: "Dune" });
  const b = movie({ path: "Movies/Database/1984/Dune (1984).md", title: "Dune" });
  const first = applyPending([b, a], new Map()).movies.map(m => m.path);
  const second = applyPending([a, b], new Map()).movies.map(m => m.path);
  assert.deepEqual(first, second);
});

test("wikilinks are shown as plain names", () => {
  assert.equal(stripWikilink("[[Sidney Lumet]]"), "Sidney Lumet");
  assert.equal(stripWikilink("[[Some Note|Shown Name]]"), "Shown Name");
  assert.equal(stripWikilink("  plain text "), "plain text");
  assert.equal(stripWikilink(null), "");
  const m = movie({ frontmatter: { directors: ["[[Clyde Geronimi]]", "[[Hamilton Luske]]", ""], genres: "[[family]]", seria: "[[Lady and the Tramp]]", nr_seri: 1 } });
  assert.deepEqual(getList(m, "directors"), ["Clyde Geronimi", "Hamilton Luske"]);
  assert.deepEqual(getList(m, "genres"), ["family"]);   // single value, not a list
  assert.deepEqual(getList(m, "countries"), []);        // missing
  assert.equal(getText(m, "seria"), "Lady and the Tramp");
  assert.equal(getText(m, "nr_seri"), "1");
  assert.equal(getText(m, "created"), "");
  assert.equal(getText(movie({ frontmatter: { seria: { a: 1 } } }), "seria"), "");
});

test("only http(s) links are allowed", () => {
  assert.equal(safeUrl("https://www.imdb.com/title/tt0048280"), "https://www.imdb.com/title/tt0048280");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,<script>1</script>"), null);
  assert.equal(safeUrl("not a url"), null);
  assert.equal(safeUrl(null), null);
  assert.equal(safeUrl(""), null);
});

test("platform tags and extra tags are told apart", () => {
  const m = movie({ frontmatter: { tags: ["movie", "y2014", "y2025", "movie/netflix/2025", "movie/kino/2014", "movie/foo/2020", "backlog", "favourite"] } });
  assert.deepEqual(getPlatformWatches(m), [
    { platform: "Netflix", year: 2025 },
    { platform: "foo", year: 2020 },
    { platform: "Cinema", year: 2014 },
  ]);
  assert.deepEqual(getExtraTags(m), ["backlog", "favourite"]);
});

test("the cover image line is removed from the note text", () => {
  assert.equal(stripCoverFromBody("![cover|200](https://x/y.jpg)\n"), "");
  assert.equal(stripCoverFromBody("![cover|200](https://x/y.jpg)\n\nGreat film."), "Great film.");
  assert.equal(stripCoverFromBody("Intro\n\n![cover](https://x/y.jpg)\r\nOutro"), "Intro\n\nOutro");
  assert.equal(stripCoverFromBody("Only text"), "Only text");
});

test("dates and TMDB sizes", () => {
  assert.equal(formatDate("2014-01-09"), "9 Jan 2014");
  assert.equal(formatDate("2025-08-23"), "23 Aug 2025");
  assert.equal(
    tmdbSize("https://image.tmdb.org/t/p/original//340NcWz9SQXWQyf4oicMxjbrLOb.jpg", "w500"),
    "https://image.tmdb.org/t/p/w500/340NcWz9SQXWQyf4oicMxjbrLOb.jpg"
  );
  assert.equal(tmdbSize("https://example.com/poster.jpg", "w500"), "https://example.com/poster.jpg");
});
