# Media Lists – Movies MVP 0.2

Aplikacja PWA do przeglądania i edycji notatek Markdown w prywatnym repozytorium GitHub `media_lists`. Nie korzysta z TMDB API ani z zewnętrznej bazy danych.

## Repozytoria

- `media_app` – publiczne repozytorium z kodem aplikacji.
- `media_lists` – prywatne repozytorium z notatkami Obsidiana.

## Struktura danych

Aplikacja Movies oczekuje struktury:

```text
media_lists/
└── Movies/
    └── Database/
        ├── 1957/
        │   └── 12 Angry Men (1957).md
        ├── 1999/
        │   └── The Matrix (1999).md
        └── 2014/
            └── Interstellar (2014).md
```

W ustawieniach aplikacji pole folderu powinno mieć wartość `Movies/Database`. Aplikacja przeszukuje ten folder rekurencyjnie, więc odczytuje pliki ze wszystkich folderów lat.

### Format notatki

Aplikacja jest dopasowana do istniejącego formatu Obsidiana. Przykład:

```yaml
---
tags:
  - movie
  - y2015
  - y2025
aliases:
  - 12 gniewnych ludzi
rating: 5
paused: false
dropped: false
watched:
  - "[[2015-07-14 Wt]]"
  - "[[2025-08-23 So]]"
seria:
nr_seri:
lboxd_url: https://letterboxd.com/film/12-angry-men/
imdb_url: http://www.imdb.com/title/tt0050083/maindetails
tmdb_url: https://www.themoviedb.org/movie/389/
cover: https://image.tmdb.org/t/p/original/qCfHGdUI0xnTChhUQBwboGuzMcu.jpg
year: 1957
directors:
  - "[[Sidney Lumet]]"
countries:
  - "[[USA]]"
genres:
  - "[[drama]]"
created: 2025-10-02 18:09
last_modified: 2026-03-22 22:48
---

![cover|200](https://image.tmdb.org/t/p/original/qCfHGdUI0xnTChhUQBwboGuzMcu.jpg)
```

- Tytuł jest pobierany z nazwy pliku, np. `12 Angry Men (1957).md` → `12 Angry Men`.
- Rok jest pobierany z `year`.
- Ocena jest pobierana z `rating`.
- Plakat jest pobierany z `cover`.
- Pozostałe właściwości YAML oraz treść notatki są zachowywane podczas edycji.
- Przy zmianie plakatu aplikacja aktualizuje również osadzony obraz `![cover|200](...)` w treści notatki.
- Przy dodawaniu filmu aplikacja tworzy plik `Movies/Database/ROK/Tytuł (ROK).md`.
- Przy zmianie tytułu lub roku istniejący plik jest przenoszony do nowej ścieżki.
- Aplikacja aktualizuje `last_modified` oraz tag `yROK`; zachowuje pozostałe tagi i właściwości.

## Konfiguracja GitHub

Otwórz https://github.com/settings/personal-access-tokens/new i utwórz Fine-grained Personal Access Token:

- Resource owner: Twoje konto
- Repository access: Only select repositories → `media_lists`
- Repository permissions → Contents: Read and write
- Metadata: Read-only (domyślne)

W aplikacji otwórz Ustawienia i podaj:

- GitHub username
- Repozytorium: `media_lists`
- Branch: `main` (lub właściwy branch)
- Folder: `Movies/Database`
- GitHub token

Token jest przechowywany w localStorage tej przeglądarki. Używaj wyłącznie własnej, zaufanej wersji aplikacji i nie udostępniaj tokenu.

## Uruchomienie lokalne

Wymagany Node.js 20+.

```bash
npm install
npm run dev
```

## Publikacja na GitHub Pages

W repozytorium `media_app` ustaw Settings → Pages → Build and deployment → Source → GitHub Actions. Workflow znajduje się w `.github/workflows/deploy.yml`.

Adres aplikacji:

`https://TWOJ_LOGIN.github.io/media_app/`

## Rozszerzanie o kolejne typy mediów

Docelowe foldery danych mogą mieć analogiczną strukturę:

```text
TV/Database/ROK/Serial (ROK).md
Games/Database/ROK/Gra (ROK).md
```

Ta wersja jest skonfigurowana dla Movies. Kolejne sekcje TV i Games można dodać, wskazując odpowiedni folder i dostosowując pola specyficzne dla danego typu mediów.
