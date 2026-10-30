# Media Lists – MVP 0.1

Prosta aplikacja PWA: czyta i edytuje pliki Markdown w prywatnym repozytorium GitHub `media_lists`. Bez TMDB i bez zewnętrznej bazy danych.

## Repozytoria

- `media_app` – publiczne repozytorium z kodem aplikacji.
- `media_lists` – prywatne repozytorium z plikami Markdown.

## 1. Przygotuj repozytorium z danymi

W prywatnym repozytorium `media_lists` utwórz folder, np. `Database`.
Dodaj w nim pliki `.md`, przykładowo `Interstellar-2014.md`:

```yaml
---
title: Interstellar
year: 2014
rating: 9.5
poster: https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg
tags:
  - movie
---

Świetny film.
```

Pole `poster` może być pełnym adresem URL do grafiki. Dla zgodności ze starszymi notatkami aplikacja rozpoznaje też `poster_path` i `cover`, a wartości zaczynające się od `/` traktuje jako ścieżkę plakatu TMDB.

Rozpoznawane pola:
- tytuł: `title` lub `name`
- rok: `year` lub `release_year`
- ocena: `rating` lub `ocena`
- plakat: `poster`, `poster_url`, `poster_path` lub `cover`

## 2. Utwórz token GitHub

Otwórz https://github.com/settings/personal-access-tokens/new

Wygeneruj Fine-grained Personal Access Token:
- Resource owner: Twoje konto
- Repository access: Only select repositories → `media_lists`
- Repository permissions → Contents: Read and write
- Metadata: Read-only (domyślne)

Skopiuj token. Nie umieszczaj go w kodzie ani w repozytorium.

## 3. Uruchom lokalnie

Wymagany Node.js 20+.

```bash
npm install
npm run dev
```

Otwórz adres Vite, zwykle `http://localhost:5173`.

W aplikacji kliknij ikonę ustawień i podaj:
- GitHub username
- Repozytorium: `media_lists`
- Branch: `main` (jeśli inny, zmień)
- Folder z plikami: `Database` (zmień, jeśli używasz innego)
- GitHub token

Kliknij „Testuj GitHub”, następnie „Zapisz i wczytaj”.

## 4. Wgraj kod do `media_app`

Skopiuj zawartość tego projektu do publicznego repozytorium `media_app` i wypchnij na branch `main`.

Workflow GitHub Actions jest już dodany. W repozytorium `media_app` przejdź do:
Settings → Pages → Build and deployment → Source → GitHub Actions.

Po pushu aplikacja będzie dostępna pod adresem:

`https://TWOJ_LOGIN.github.io/media_app/`

Uwaga: `vite.config.ts` ma już ustawione `base: "/media_app/"`.

## 5. Dodaj jako aplikację na iPhonie

1. Otwórz adres GitHub Pages w Safari.
2. Udostępnij → Dodaj do ekranu początkowego.
3. Uruchom aplikację z nowej ikony.

## Co zawiera MVP

- Grid plakatów, tytułów i ocen.
- Wyszukiwanie po tytule w bibliotece.
- Ręczne dodawanie wpisu.
- Edycja i usuwanie wpisów.
- Odczyt i zapis Markdown przez GitHub API.
- PWA i prosty cache aplikacji.

## Bezpieczeństwo – ważne

Token GitHub jest zapisany w localStorage przeglądarki. To proste rozwiązanie dla osobistego MVP, ale nie jest zabezpieczeniem klasy produkcyjnej: skrypt uruchomiony w obrębie aplikacji mógłby go odczytać. Używaj wyłącznie własnego, zaufanego kodu; token ogranicz do jednego prywatnego repozytorium `media_lists` i nie udostępniaj go nikomu. Nie wpisuj tokenu w kodzie ani w plikach repozytorium.

GitHub Pages hostuje publiczną aplikację, ale prywatne pliki Markdown są pobierane bezpośrednio przez API po autoryzacji. Repozytorium `media_lists` pozostaje prywatne.

Aplikacja nie ma TMDB API. Adres plakatu wpisujesz ręcznie. Przy edycji zachowywane są pozostałe pola YAML i treść notatki.
