import { stringify } from "yaml";
import type { Movie, Settings } from "./types";
import {
  MAX_RATING, MIN_RATING, RATING_STEP, isValidRating, sanitizeFilename
} from "./movies";

const API = "https://api.github.com";

export class GitHubError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

function headers(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

function cleanFolder(folder: string) {
  return folder.replace(/^\/+|\/+$/g, "");
}

function contentsUrl(s: Settings, relativePath = "") {
  const fullPath = [cleanFolder(s.folder), relativePath].filter(Boolean).join("/");
  const encoded = fullPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/contents/${encoded}`;
}

// Turns raw GitHub API failures into messages the user can act on.
function friendlyMessage(status: number, apiMessage: string | undefined): string {
  const message = apiMessage || `GitHub API: ${status}`;

  switch (status) {
    case 401:
      return "GitHub rejected the token (invalid or expired). Create a new one and update it in Settings.";
    case 403:
      return /rate limit/i.test(message)
        ? "GitHub rate limit reached. Try again in a few minutes."
        : "The token is not allowed to do this. It needs Contents: Read and write on the data repository.";
    case 404:
      return "Not found. Check the username, repository, branch and folder in Settings (GitHub also answers 404 when the token cannot access the repository).";
    case 409:
      return "This note changed on GitHub after it was loaded. Refresh the library and try again.";
    case 422:
      return /sha/i.test(message)
        ? "A note with this title and year already exists. Edit that one or change the title or year."
        : message;
    default:
      return message;
  }
}

async function failFrom(response: Response): Promise<never> {
  let apiMessage: string | undefined;
  try {
    const data = await response.json();
    apiMessage = typeof data?.message === "string" ? data.message : undefined;
  } catch { /* response was not JSON */ }
  throw new GitHubError(friendlyMessage(response.status, apiMessage), response.status);
}

async function request(url: string, token: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(token), ...(init?.headers || {}) },
  });
  if (!response.ok) return failFrom(response);
  return response.status === 204 ? null : response.json();
}

function repositoryContentsUrl(s: Settings, path: string) {
  const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/contents/${encoded}?ref=${encodeURIComponent(s.branch)}`;
}

function indexPath(s: Settings) {
  const parts = cleanFolder(s.folder).split("/").filter(Boolean);
  parts.pop();
  return [...parts, "movies_index.json"].join("/");
}

async function requestText(url: string, token: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      ...headers(token),
      Accept: "application/vnd.github.raw+json",
    },
  });
  if (!response.ok) return failFrom(response);
  return response.text();
}

/**
 * Loads the generated index once. The index lags behind writes (it is rebuilt
 * by GitHub Actions), so callers lay their own pending changes over the result
 * instead of waiting for it to catch up.
 */
export async function loadMovies(s: Settings): Promise<Movie[]> {
  const url = repositoryContentsUrl(s, indexPath(s));

  let raw: string;
  try {
    // Raw content avoids the 1 MB Contents API JSON response limit.
    raw = await requestText(url, s.token);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      throw new Error("movies_index.json was not found. Copy the script and workflow to the media_lists repository and run the \"Generate movies index\" workflow.");
    }
    throw e;
  }

  let index: { movies?: unknown };
  try {
    index = JSON.parse(raw);
  } catch {
    throw new Error("movies_index.json is not valid JSON. Re-run the \"Generate movies index\" workflow.");
  }

  if (!Array.isArray(index.movies)) {
    throw new Error("Invalid movies_index.json format.");
  }

  // Skip malformed entries instead of letting one of them break the whole app.
  return (index.movies as Movie[]).filter(movie =>
    movie && typeof movie.path === "string" && typeof movie.title === "string"
  );
}

export async function testGitHub(s: Settings) {
  await request(`${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`, s.token);
  await request(`${contentsUrl(s)}?ref=${encodeURIComponent(s.branch)}`, s.token);
}

function localTimestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateCoverInBody(body: string, cover: string) {
  const imageLine = /^!\[cover(?:\|\d+)?\]\([^\n]*\)$/m;
  if (!cover) return body.replace(imageLine, "").trim();
  const markdownImage = `![cover|200](${cover})`;
  if (imageLine.test(body)) return body.replace(imageLine, markdownImage);
  return `${body.trim()}${body.trim() ? "\n\n" : ""}${markdownImage}`;
}

function relativeToFolder(path: string, folder: string) {
  return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

export type SaveResult = {
  /** The note as written, with the new blob SHA returned by GitHub. */
  movie: Movie;
  /** Previous path, when a changed title/year moved the note. */
  removedPath: string | null;
  /** Set when the note was saved but cleaning up the old file failed. */
  warning?: string;
};

export async function saveMovie(
  s: Settings,
  movie: Movie | null,
  values: { title: string; year: string; rating: string; poster: string; note: string }
): Promise<SaveResult> {
  const title = sanitizeFilename(values.title);
  const year = values.year.trim();
  if (!title) throw new Error("Enter a title (it cannot consist only of characters that are not allowed in file names).");
  if (!/^\d{4}$/.test(year)) throw new Error("Enter the year as YYYY.");
  if (!isValidRating(values.rating)) {
    throw new Error(`Rating must be empty or between ${MIN_RATING} and ${MAX_RATING} in steps of ${RATING_STEP}.`);
  }

  const folder = cleanFolder(s.folder);
  const filename = `${title} (${year}).md`;
  const targetPath = `${folder}/${year}/${filename}`;
  const oldPath = movie?.path || "";
  // Mixed content (http images on an https page) is blocked by browsers.
  const poster = values.poster.trim().replace(/^http:\/\//i, "https://");

  // Start from the original YAML so tags, aliases, watched dates and all
  // Obsidian-specific properties survive edits unchanged.
  const frontmatter: Record<string, unknown> = movie ? { ...movie.frontmatter } : {
    tags: ["movie"],
    aliases: [],
    paused: false,
    dropped: false,
    watched: [],
    seria: null,
    nr_seri: null,
    lboxd_url: "",
    imdb_url: "",
    tmdb_url: "",
    directors: [],
    countries: [],
    genres: [],
    created: localTimestamp(),
  };

  // Keep the Obsidian schema: cover/year/rating, not title/poster/release_year.
  frontmatter.year = Number(year);
  frontmatter.rating = values.rating.trim() === "" ? null : Number(values.rating);
  frontmatter.cover = poster || null;
  frontmatter.last_modified = localTimestamp();
  // nullStr "" writes `seria:` like Obsidian does, instead of `seria: null`.
  const yaml = stringify(frontmatter, { lineWidth: 0, nullStr: "" }).trimEnd();
  const body = updateCoverInBody(values.note, poster).trim();
  const content = `---\n${yaml}\n---\n\n${body}\n`;
  const payload: Record<string, unknown> = {
    message: `${movie ? "Update" : "Add"} ${title} (${year})`,
    content: encodeBase64(content),
    branch: s.branch,
  };

  // Same path: update in place (needs the current SHA). Different path (new
  // note, or title/year changed): create the file, then remove the old one.
  if (movie && oldPath === targetPath) payload.sha = movie.sha;
  const written = await request(contentsUrl(s, relativeToFolder(targetPath, folder)), s.token, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  const saved: Movie = {
    path: written?.content?.path ?? targetPath,
    sha: String(written?.content?.sha ?? ""),
    title,
    year,
    rating: values.rating.trim(),
    poster,
    body,
    frontmatter,
  };

  let removedPath: string | null = null;
  let warning: string | undefined;

  if (movie && oldPath !== targetPath) {
    try {
      await request(contentsUrl(s, relativeToFolder(oldPath, folder)), s.token, {
        method: "DELETE",
        body: JSON.stringify({ message: `Move ${title} to ${year}`, sha: movie.sha, branch: s.branch }),
      });
      removedPath = oldPath;
    } catch (e) {
      // The new note exists; only the old copy is left behind.
      warning = `Saved as "${targetPath}", but the old file "${oldPath}" could not be deleted (${(e as Error).message}). Delete it manually to avoid a duplicate.`;
    }
  }

  return { movie: saved, removedPath, warning };
}

export async function deleteMovie(s: Settings, movie: Movie) {
  const folder = cleanFolder(s.folder);
  await request(contentsUrl(s, relativeToFolder(movie.path, folder)), s.token, {
    method: "DELETE",
    body: JSON.stringify({
      message: `Delete ${movie.title}`,
      sha: movie.sha,
      branch: s.branch,
    }),
  });
}
