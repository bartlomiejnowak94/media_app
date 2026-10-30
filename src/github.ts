import { parse, stringify } from "yaml";
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

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

function parseMovie(path: string, sha: string, content: string): Movie {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
  const frontmatter = match ? (parse(match[1]) || {}) as Record<string, unknown> : {};
  const body = match ? match[2] : content;
  const filename = path.split("/").pop()?.replace(/\.md$/i, "") || "Bez tytułu";
  // In this library the title lives in the filename: "12 Angry Men (1957)".
  const title = filename.replace(/\s*\(\d{4}\)$/, "").trim();
  const poster = String(frontmatter.cover || "");
  return {
    path,
    sha,
    title,
    year: String(frontmatter.year || ""),
    rating: String(frontmatter.rating ?? ""),
    poster,
    body,
    frontmatter,
  };
}

async function collectMarkdown(s: Settings, relativePath = ""): Promise<{ path: string; sha: string }[]> {
  const items = await request(contentsUrl(s, relativePath), s.token);
  if (!Array.isArray(items)) return [];
  const found: { path: string; sha: string }[] = [];
  for (const item of items) {
    if (item.type === "file" && item.name.toLowerCase().endsWith(".md")) {
      found.push({ path: item.path, sha: item.sha });
    } else if (item.type === "dir") {
      const prefix = `${cleanFolder(s.folder)}/`;
      const childRelative = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path;
      found.push(...await collectMarkdown(s, childRelative));
    }
  }
  return found;
}

export async function loadMovies(s: Settings): Promise<Movie[]> {
  const files = await collectMarkdown(s);
  const folderPrefix = `${cleanFolder(s.folder)}/`;
  const movies: Movie[] = [];
  for (const file of files) {
    const relative = file.path.startsWith(folderPrefix) ? file.path.slice(folderPrefix.length) : file.path;
    const data = await request(contentsUrl(s, relative), s.token);
    if (data?.content) movies.push(parseMovie(file.path, data.sha, decodeBase64(data.content)));
  }
  return movies.sort((a, b) => a.title.localeCompare(b.title, "pl"));
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