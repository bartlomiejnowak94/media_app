export type Settings = {
  owner: string;
  repo: string;
  branch: string;
  folder: string;
  token: string;
};

export type Movie = {
  path: string;
  sha: string;
  title: string;
  year: string;
  rating: string;
  poster: string;
  body: string;
  frontmatter: Record<string, unknown>;
};