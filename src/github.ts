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
  const title = String(frontmatter.title || frontmatter.name || filename);
  const posterValue = String(frontmatter.poster || frontmatter.poster_url || frontmatter.cover || "");
  const poster = posterValue.startsWith("http")
    ? posterValue
    : posterValue
      ? `https://image.tmdb.org/t/p/w500${posterValue}`
      : "";
  return {
    path,
    sha,
    title,
    year: String(frontmatter.year || frontmatter.release_year || ""),
    rating: String(frontmatter.rating ?? frontmatter.ocena ?? ""),
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

export async function saveMovie(
  s: Settings,
  movie: Movie | null,
  values: { title: string; year: string; rating: string; poster: string; note: string }
) {
  const slug = values.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "film";
  const filename = `${slug}${values.year ? `-${values.year}` : ""}.md`;
  const folder = cleanFolder(s.folder);
  const existingPath = movie?.path || `${folder}/${filename}`;
  const relativePath = existingPath.startsWith(`${folder}/`) ? existingPath.slice(folder.length + 1) : existingPath;
  const poster = values.poster.trim();
  const frontmatter = {
    ...(movie?.frontmatter || {}),
    title: values.title.trim(),
    year: values.year || undefined,
    rating: values.rating === "" ? undefined : Number(values.rating),
    poster: poster || undefined,
  };
  const yaml = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  const body = values.note.trim();
  const content = `---\n${yaml}\n---\n${body ? `\n${body}\n` : "\n"}`;
  const payload: Record<string, unknown> = {
    message: `${movie ? "Update" : "Add"} ${values.title.trim()}`,
    content: encodeBase64(content),
    branch: s.branch,
  };
  if (movie?.sha) payload.sha = movie.sha;
  await request(contentsUrl(s, relativePath), s.token, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
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