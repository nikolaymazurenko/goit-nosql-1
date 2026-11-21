// queries/part2_queries.js
// Запуск: mongosh "ВАШ_URI" --file queries/part2_queries.js

db = db.getSiblingDB("spotify");


// ======================================================
// Завдання 1. Треки для вечірки
// danceability > 0.7, energy > 0.7, тривалість 3–5 хвилин
// ======================================================
const partyFilter = {
  "audio_features.danceability": { $gt: 0.7 },
  "audio_features.energy": { $gt: 0.7 },
  duration_ms: { $gte: 180000, $lte: 300000 }
};

print("Завдання 1. Треки для вечірки");
print("Знайдено треків: " + db["tracks"].countDocuments(partyFilter));
print("Топ-10 за популярністю:");

db["tracks"]
  .find(partyFilter, {
    _id: 0,
    track_name: 1,
    artists: 1,
    popularity: 1,
    duration_ms: 1,
    "audio_features.danceability": 1,
    "audio_features.energy": 1
  })
  .sort({ popularity: -1 })
  .limit(10)
  .forEach(printjson);


// ======================================================
// Завдання 2. Виконавці, у яких усі треки популярні
// мінімум 3 треки, мінімальна популярність >= 60, топ-20
// ======================================================
print("\nЗавдання 2. Виконавці, у яких усі треки популярні");

db["tracks"].aggregate([
  // Один трек = один документ на кожен жанр, тому спершу прибираємо повтори
  {
    $group: {
      _id: "$track_id",
      artists: { $first: "$artists" },
      popularity: { $first: "$popularity" }
    }
  },
  // Трек з кількома виконавцями зараховуємо кожному з них
  { $unwind: "$artists" },
  {
    $group: {
      _id: "$artists",
      tracks_count: { $sum: 1 },
      min_popularity: { $min: "$popularity" },
      avg_popularity: { $avg: "$popularity" }
    }
  },
  { $match: { tracks_count: { $gte: 3 }, min_popularity: { $gte: 60 } } },
  { $sort: { avg_popularity: -1, tracks_count: -1, _id: 1 } },
  { $limit: 20 },
  {
    $project: {
      _id: 0,
      artist: "$_id",
      tracks_count: 1,
      min_popularity: { $round: ["$min_popularity", 1] },
      avg_popularity: { $round: ["$avg_popularity", 1] }
    }
  }
]).forEach(printjson);


// ======================================================
// Завдання 3. Нетипові треки
// tempo треку > середній tempo жанру + 2 * стандартне відхилення
// ======================================================
print("\nЗавдання 3. Нетипові треки");

const outliersByGenre = db["tracks"].aggregate([
  {
    $group: {
      _id: "$track_genre",
      avg_tempo: { $avg: "$audio_features.tempo" },
      std_tempo: { $stdDevPop: "$audio_features.tempo" },
      tracks: {
        $push: {
          _id: "$_id",
          track_name: "$track_name",
          popularity: "$popularity",
          artists: "$artists",
          audio_features: { tempo: "$audio_features.tempo" }
        }
      }
    }
  },
  {
    $addFields: {
      outlier_threshold: { $add: ["$avg_tempo", { $multiply: [2, "$std_tempo"] }] }
    }
  },
  {
    $project: {
      _id: 0,
      genre: "$_id",
      avg_tempo: { $round: ["$avg_tempo", 1] },
      outlier_threshold: { $round: ["$outlier_threshold", 1] },
      outlier_tracks: {
        $filter: {
          input: "$tracks",
          as: "track",
          cond: { $gt: ["$$track.audio_features.tempo", "$outlier_threshold"] }
        }
      }
    }
  },
  { $sort: { genre: 1 } }
]).toArray();

print("Жанрів: " + outliersByGenre.length);
outliersByGenre.forEach((g) =>
  print(
    `${g.genre}: avg_tempo=${g.avg_tempo}, outlier_threshold=${g.outlier_threshold}, ` +
    `outlier_tracks=${g.outlier_tracks.length}`
  )
);
print("Приклад повного документа:");
printjson(outliersByGenre.find((g) => g.outlier_tracks.length > 0));


// ======================================================
// Завдання 4. Треки для фонової роботи
// loudness < -10, speechiness < 0.1, instrumentalness > 0.5, без explicit
// ======================================================
const focusFilter = {
  "audio_features.loudness": { $lt: -10 },
  "audio_features.speechiness": { $lt: 0.1 },
  "audio_features.instrumentalness": { $gt: 0.5 },
  explicit: false
};

print("\nЗавдання 4. Треки для фонової роботи");
print("Знайдено треків: " + db["tracks"].countDocuments(focusFilter));
print("Топ-10 за популярністю:");

db["tracks"]
  .find(focusFilter, {
    _id: 0,
    track_name: 1,
    artists: 1,
    track_genre: 1,
    popularity: 1,
    "audio_features.loudness": 1,
    "audio_features.speechiness": 1,
    "audio_features.instrumentalness": 1
  })
  .sort({ popularity: -1 })
  .limit(10)
  .forEach(printjson);
