import { ExternalLink, Image as ImageIcon, Star } from "lucide-react";
import type { ReactNode } from "react";
import {
  formatDate, getExtraTags, getList, getPlatformWatches, getRating, getText,
  getWatchedDates, isBacklog, safeUrl, stripCoverFromBody, tmdbSize
} from "./movies";
import type { Movie } from "./types";

function Chips({ items }: { items: string[] }) {
  return (
    <div className="chip-list">
      {items.map((item, index) => (
        <span className="chip" key={`${item}-${index}`}>{item}</span>
      ))}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-section">
      <p className="detail-label">{label}</p>
      {children}
    </div>
  );
}

export default function MovieDetails({ movie }: { movie: Movie }) {
  const rating = getRating(movie);
  // ISO dates sort correctly as text; newest first.
  const watched = [...getWatchedDates(movie)].sort().reverse();
  const platforms = getPlatformWatches(movie);

  const aliases = getList(movie, "aliases");
  const directors = getList(movie, "directors");
  const countries = getList(movie, "countries");
  const genres = getList(movie, "genres");
  const tags = getExtraTags(movie);

  const series = getText(movie, "seria");
  const seriesNumber = getText(movie, "nr_seri");
  const created = getText(movie, "created");
  const modified = getText(movie, "last_modified");
  const note = stripCoverFromBody(movie.body);

  const links: [string, string | null][] = [
    ["Letterboxd", safeUrl(movie.frontmatter?.lboxd_url)],
    ["IMDb", safeUrl(movie.frontmatter?.imdb_url)],
    ["TMDB", safeUrl(movie.frontmatter?.tmdb_url)]
  ];
  const availableLinks = links.filter(
    (entry): entry is [string, string] => entry[1] !== null
  );

  const badges: string[] = [];
  if (isBacklog(movie)) badges.push("Backlog");
  if (movie.frontmatter?.paused === true) badges.push("Paused");
  if (movie.frontmatter?.dropped === true) badges.push("Dropped");

  return (
    <div className="details">
      <div className="details-top">
        <div className="details-poster">
          {movie.poster ? (
            <img
              src={tmdbSize(movie.poster, "w500")}
              alt={`Poster: ${movie.title}`}
              onError={e => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="poster-placeholder">
              <ImageIcon size={34} />
            </div>
          )}
        </div>

        <div className="details-facts">
          <div className="details-year">{movie.year || "Year unknown"}</div>

          <div className="details-rating">
            <Star size={16} fill="currentColor" />
            {rating !== null ? (
              <><strong>{rating.toFixed(1)}</strong><span> / 5</span></>
            ) : (
              <span>Not rated</span>
            )}
          </div>

          {badges.length > 0 && <Chips items={badges} />}

          {series && (
            <p className="details-line">
              Series: {series}{seriesNumber ? ` · #${seriesNumber}` : ""}
            </p>
          )}

          {aliases.length > 0 && (
            <p className="details-line muted-line">Also known as: {aliases.join(" · ")}</p>
          )}
        </div>
      </div>

      <Section label={watched.length > 1 ? `WATCHED · ${watched.length}×` : "WATCHED"}>
        {watched.length > 0 ? (
          <ul className="watch-list">
            {watched.map((date, index) => (
              <li key={`${date}-${index}`}>{formatDate(date)}</li>
            ))}
          </ul>
        ) : (
          <p className="details-line muted-line">
            {isBacklog(movie) ? "Not watched yet." : "No watch date recorded."}
          </p>
        )}
      </Section>

      {platforms.length > 0 && (
        <Section label="WHERE">
          <Chips items={platforms.map(item => `${item.platform} · ${item.year}`)} />
        </Section>
      )}

      {directors.length > 0 && (
        <Section label={directors.length === 1 ? "DIRECTOR" : "DIRECTORS"}>
          <Chips items={directors} />
        </Section>
      )}

      {genres.length > 0 && (
        <Section label="GENRES"><Chips items={genres} /></Section>
      )}

      {countries.length > 0 && (
        <Section label={countries.length === 1 ? "COUNTRY" : "COUNTRIES"}>
          <Chips items={countries} />
        </Section>
      )}

      {tags.length > 0 && (
        <Section label="TAGS"><Chips items={tags} /></Section>
      )}

      {availableLinks.length > 0 && (
        <Section label="LINKS">
          <div className="detail-links">
            {availableLinks.map(([name, url]) => (
              <a key={name} href={url} target="_blank" rel="noopener noreferrer">
                {name} <ExternalLink size={13} />
              </a>
            ))}
          </div>
        </Section>
      )}

      {note && (
        <Section label="NOTES">
          <div className="detail-note">{note}</div>
        </Section>
      )}

      {(created || modified) && (
        <p className="details-meta">
          {created && <>Added {created}</>}
          {created && modified && " · "}
          {modified && <>Last modified {modified}</>}
        </p>
      )}
    </div>
  );
}
