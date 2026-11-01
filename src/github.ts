import { stringify } from "yaml";
import type { Movie, Settings } from "./types";

const API = "https://api.github.com";

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

async function request(url: string, token: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(token), ...(init?.headers || {}) },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `GitHub API: ${response.status}`);
  }
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
  if (!response.ok) {
    let message = `GitHub API: ${response.status}`;
    try {
      const data = await response.json();
      message = data.message || message;
    } catch { /* response was not JSON */ }
    throw new Error(message);
  }
  return response.text();
}

export async function loadMovies(s: Settings, notBefore?: number): Promise<Movie[]> {
  const url = repositoryContentsUrl(s, indexPath(s));
  // The index is generated in the private data repository by GitHub Actions.
  // Raw content avoids the 1 MB Contents API JSON response limit.
  const attempts = notBefore ? 20 : 1;
  let lastIndex: { generatedAt?: string; movies?: Movie[] } | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let raw: string;
    try {
      raw = await requestText(url, s.token);
    } catch (e) {
      if ((e as Error).message === "Not Found") {
        throw new Error("Nie znaleziono movies_index.json. Skopiuj skrypt i workflow do repozytorium media_lists, a następnie uruchom workflow Generate movies index.");
      }
      throw e;
    }
    lastIndex = JSON.parse(raw) as { generatedAt?: string; movies?: Movie[] };
    const generatedAt = lastIndex.generatedAt ? Date.parse(lastIndex.generatedAt) : 0;
    if (!notBefore || generatedAt >= notBefore) {
      if (!Array.isArray(lastIndex.movies)) throw new Error("Nieprawidłowy format movies_index.json.");
      return lastIndex.movies.sort((a, b) => a.title.localeCompare(b.title, "pl"));
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error("Indeks filmów nie został jeszcze zaktualizowany przez GitHub Actions. Spróbuj odświeżyć bibliotekę za chwilę.");
}

export async function testGitHub(s: Settings) {
  await request(`${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`, s.token);
  await request(contentsUrl(s), s.token);
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

export async function saveMovie(
  s: Settings,
  movie: Movie | null,
  values: { title: string; year: string; rating: string; poster: string; note: string }
) {
  const title = values.title.trim();
  const year = values.year.trim();
  if (!title) throw new Error("Podaj tytuł filmu.");
  if (!/^\d{4}$/.test(year)) throw new Error("Podaj rok w formacie RRRR.");

  const folder = cleanFolder(s.folder);
  const filename = `${title} (${year}).md`;
  const targetPath = `${folder}/${year}/${filename}`;
  const oldPath = movie?.path || "";
  const poster = values.poster.trim();

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
  frontmatter.rating = values.rating === "" ? null : Number(values.rating);
  frontmatter.cover = poster || null;
  frontmatter.last_modified = localTimestamp();
  const yaml = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  const body = updateCoverInBody(values.note, poster);
  const content = `---\n${yaml}\n---\n\n${body.trim()}\n`;
  const payload: Record<string, unknown> = {
    message: `${movie ? "Update" : "Add"} ${title} (${year})`,
    content: encodeBase64(content),
    branch: s.branch,
  };

  // If the title/year changed, create the file in the correct year folder,
  // then remove the previous path. Otherwise update the existing file.
  const destination = movie && oldPath === targetPath ? oldPath : targetPath;
  if (movie && oldPath === destination) payload.sha = movie.sha;
  await request(contentsUrl(s, destination.startsWith(`${folder}/`) ? destination.slice(folder.length + 1) : destination), s.token, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  if (movie && oldPath !== destination) {
    const relativeOld = oldPath.startsWith(`${folder}/`) ? oldPath.slice(folder.length + 1) : oldPath;
    await request(contentsUrl(s, relativeOld), s.token, {
      method: "DELETE",
      body: JSON.stringify({ message: `Move ${title} to ${year}`, sha: movie.sha, branch: s.branch }),
    });
  }
}

export async function deleteMovie(s: Settings, movie: Movie) {
  const folder = `${cleanFolder(s.folder)}/`;
  const relative = movie.path.startsWith(folder) ? movie.path.slice(folder.length) : movie.path;
  await request(contentsUrl(s, relative), s.token, {
    method: "DELETE",
    body: JSON.stringify({
      message: `Delete ${movie.title}`,
      sha: movie.sha,
      branch: s.branch,
    }),
  });
}