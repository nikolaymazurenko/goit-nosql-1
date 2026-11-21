# goit-nosql-1

Завантаження датасету Spotify Tracks з Kaggle у MongoDB та його трансформація.

## Що потрібно

- Python 3.11 або новіший
- Docker (для запуску `mongosh` без локального встановлення)
- Кластер MongoDB (наприклад, Atlas), до якого дозволено доступ з вашої IP-адреси

## Порядок виконання

Усі команди виконуються з кореня проєкту.

### 1. Налаштувати віртуальне оточення

```zsh
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r reguirements.txt
```

Оточення треба активувати (`source .venv/bin/activate`) у кожному новому терміналі.

### 2. Вказати рядок підключення

Створіть у корені файл `.env` (він не потрапляє в git):

```
MONGO_URI="mongodb+srv://<user>:<password>@<cluster>/"
```

### 3. Завантажити сирі дані

```zsh
python scripts/01_load_data.py
```

Скрипт завантажує датасет `maharshipandya/-spotify-tracks-dataset` через `kagglehub` і записує його в колекцію `spotify.tracks_raw` (близько 114 тис. документів). Колекція щоразу перестворюється, тому скрипт можна запускати повторно.

### 4. Трансформувати дані

```zsh
source .env
docker run --rm -v "$PWD/scripts:/scripts:ro" mongo:7 \
  mongosh "$MONGO_URI" --file /scripts/02_transform.js
```

Скрипт будує з `tracks_raw` колекцію `spotify.tracks`: розбиває виконавців на масив `artists`, збирає аудіохарактеристики у вкладений документ `audio_features`, додає поля `duration_sec` і `popularity_tier`. Колекція `tracks` також щоразу перестворюється.

Якщо `tracks_raw` порожня, скрипт зупиниться з підказкою повернутися до кроку 3. Для діагностики з'єднання додайте до `mongosh` прапорець `--verbose`.

### 5. Виконати запити та створити індекси

Файли в `queries/` запускаються так само, як скрипт трансформації, і працюють з колекцією `tracks`:

```zsh
source .env
docker run --rm -v "$PWD/queries:/queries:ro" mongo:7 \
  mongosh "$MONGO_URI" --file /queries/part2_queries.js

docker run --rm -v "$PWD/queries:/queries:ro" mongo:7 \
  mongosh "$MONGO_URI" --file /queries/part3_indexes.js
```

## Структура

| Шлях | Призначення |
| --- | --- |
| `scripts/01_load_data.py` | Завантаження датасету в `tracks_raw` |
| `scripts/02_transform.js` | Трансформація `tracks_raw` → `tracks` |
| `queries/part2_queries.js` | Запити до колекції `tracks` |
| `queries/part3_indexes.js` | Індекси для колекції `tracks` |
| `reguirements.txt` | Залежності Python |

## Частина 3 — Індекси та оптимізація

Код: `queries/part3_indexes.js`. Значення нижче отримані з `explain("executionStats")` на MongoDB 8.0, колекція `tracks` містить 113 999 документів. Час виконання залежить від навантаження кластера і між запусками трохи відрізняється.

### Завдання 1. Аналіз запиту та індексація

Запит:

```js
db.tracks.find({
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
}).sort({ popularity: -1 })
```

Створений індекс:

```js
db.tracks.createIndex(
  { track_genre: 1, popularity: -1, "audio_features.danceability": 1 },
  { name: "genre_popularity_danceability" }
)
```

Порядок полів відповідає правилу ESR (Equality → Sort → Range): спершу поле з точним збігом, потім поле сортування, останнім — діапазонне поле.

| Поле `explain()` | Без індексу | З індексом |
| --- | --- | --- |
| Стадії `winningPlan` | `SORT` ← `COLLSCAN` | `FETCH` ← `IXSCAN` |
| `indexName` | — | `genre_popularity_danceability` |
| `nReturned` | 354 | 354 |
| `totalKeysExamined` | 0 | 412 |
| `totalDocsExamined` | 113 999 | 354 |
| `executionTimeMillis` | 86 | 2 |

**Що змінилося в плані виконання?**

- Повне сканування колекції (`COLLSCAN`) замінилося скануванням індексу (`IXSCAN`) з подальшим читанням лише знайдених документів (`FETCH`).
- Зникла стадія `SORT`: індекс уже впорядкований за `popularity` у межах жанру, тому сортування в пам'яті не потрібне.
- Кількість прочитаних документів зменшилася зі 113 999 до 354 і зрівнялася з кількістю повернених (`nReturned`), тобто сервер більше не читає зайвих документів.

**Як зрозуміти, що індекс використовується?**

- У `queryPlanner.winningPlan` є стадія `IXSCAN` з `indexName: "genre_popularity_danceability"` замість `COLLSCAN`.
- `executionStats.totalKeysExamined` більший за нуль (412), а без індексу він дорівнював 0.
- `indexBounds` показує, що всі три поля індексу задіяні:

```js
indexBounds: {
  track_genre: [ '["pop", "pop"]' ],
  popularity: [ '[MaxKey, MinKey]' ],
  'audio_features.danceability': [ '[0.7, inf.0]' ]
}
```

### Завдання 2. Індекс для інших полів

Запит для пошуку музики для роботи:

```js
db.tracks.find({
  explicit: false,
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 }
})
```

Створений індекс:

```js
db.tracks.createIndex(
  {
    explicit: 1,
    "audio_features.instrumentalness": 1,
    "audio_features.speechiness": 1
  },
  { name: "explicit_instrumentalness_speechiness" }
)
```

Першим стоїть поле з точним збігом (`explicit`), за ним діапазонні поля.

| Поле `explain()` | Без індексу | З індексом |
| --- | --- | --- |
| Стадії `winningPlan` | `COLLSCAN` | `FETCH` ← `IXSCAN` |
| `indexName` | — | `explicit_instrumentalness_speechiness` |
| `nReturned` | 16 141 | 16 141 |
| `totalKeysExamined` | 0 | 16 602 |
| `totalDocsExamined` | 113 999 | 16 141 |
| `executionTimeMillis` | 162 | 40 |

Індекс використовується: у плані стадія `IXSCAN` з назвою цього індексу, а межі сканування накладені на всі три поля:

```js
indexBounds: {
  explicit: [ '[false, false]' ],
  'audio_features.instrumentalness': [ '(0.5, inf.0]' ],
  'audio_features.speechiness': [ '[-inf.0, 0.1)' ]
}
```

### Завдання 3. Покривний запит (факультативне)

Запит:

```js
db.tracks.find({ track_genre: "pop", popularity: { $gte: 70 } })
```

**Ні, цей запит не є покривним.** Запит покривний, коли одночасно виконуються дві умови:

1. усі поля фільтра входять в індекс;
2. усі поля, які запит повертає, теж входять у той самий індекс.

Перша умова виконується: `track_genre` і `popularity` — це перші два поля індексу `genre_popularity_danceability`, тому індекс використовується для пошуку. Друга — ні: запит не має проєкції, тож повертає документи цілком, з `_id`, `track_name`, `artists` та іншими полями, яких в індексі немає. Серверу доводиться читати кожен знайдений документ, що видно в `explain()`: у плані є стадія `FETCH`, а `totalDocsExamined` дорівнює 317.

Щоб запит став покривним, треба повертати лише поля з індексу і явно вимкнути `_id`:

```js
db.tracks.find(
  { track_genre: "pop", popularity: { $gte: 70 } },
  { _id: 0, track_genre: 1, popularity: 1 }
)
```

| Поле `explain()` | Запит з умови | З проєкцією |
| --- | --- | --- |
| Стадії `winningPlan` | `FETCH` ← `IXSCAN` | `PROJECTION_COVERED` ← `IXSCAN` |
| `nReturned` | 317 | 317 |
| `totalKeysExamined` | 317 | 317 |
| `totalDocsExamined` | 317 | 0 |

Ознака покривного запиту — `totalDocsExamined: 0` і відсутність стадії `FETCH`: відповідь формується лише з індексу.
