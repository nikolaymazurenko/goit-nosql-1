// scripts/02_transform.js
// Запуск: mongosh "ВАШ_URI" --file scripts/02_transform.js


db = db.getSiblingDB("spotify");
print("Підключено до: " + db.getMongo().getURI().replace(/\/\/[^@]*@/, "//***@"));

const rawCount = db["tracks_raw"].countDocuments();
print("Документів у tracks_raw: " + rawCount);
if (rawCount === 0) {
  print("tracks_raw порожня — спершу запустіть scripts/01_load_data.py");
  quit(1);
}

print("Видаляємо стару колекцію tracks...");
db["tracks"].drop();

print("Запускаємо агрегацію (одна серверна операція, проміжного прогресу немає)...");
const startedAt = Date.now();


db["tracks_raw"].aggregate([
  // ======================================================
  // Стадія 1: Проєкція потрібних полів
  // ======================================================
  {
    $project: {
      _id: 0,
      track_id: 1,
      track_name: 1,
      album_name: 1,
      explicit: 1,
      popularity: 1,
      duration_ms: 1,
      track_genre: 1,
      danceability: 1,
      energy: 1,
      loudness: 1,
      speechiness: 1,
      acousticness: 1,
      instrumentalness: 1,
      liveness: 1,
      valence: 1,
      tempo: 1,
      key: 1,
      mode: 1,
      time_signature: 1,
      artists_raw: "$artists" // рядок з артистами через ;
    }
  },


  // ======================================================
  // Стадія 2: Розбиваємо artists на масив по ;
  // "Drake; Future" → ["Drake", "Future"]
  // ======================================================
  {
    $addFields: {
      artists: {
        $map: {
          input: { $split: ["$artists_raw", ";"] },
          as: "artist",
          in: { $trim: { input: "$$artist" } } // прибираємо пробіли навколо
        }
      }
    }
  },


  // ======================================================
  // Стадія 3: Формуємо audio_features та обчислюємо нові поля
  // ======================================================
  {
    $addFields: {
      audio_features: {
        danceability:     "$danceability",
        energy:           "$energy",
        loudness:         "$loudness",
        speechiness:      "$speechiness",
        acousticness:     "$acousticness",
        instrumentalness: "$instrumentalness",
        liveness:         "$liveness",
        valence:          "$valence",
        tempo:            "$tempo",
        key:              "$key",
        mode:             "$mode",
        time_signature:   "$time_signature"
      },
      duration_sec: { $round: [{ $divide: ["$duration_ms", 1000] }, 1] },
      popularity_tier: {
        $switch: {
           branches: [
            { case: { $gte: ["$popularity", 70] }, then: "high" },
            { case: { $gte: ["$popularity", 40] }, then: "medium" }
           ],
           default: "low"
        }
      }
    }
  },


  // ======================================================
  // Стадія 4: Прибираємо старі поля
  // ======================================================
  {
    $unset: [
       "artists_raw", "danceability", "energy", "loudness",
       "speechiness", "acousticness", "instrumentalness",
       "liveness", "valence", "tempo", "key", "mode", "time_signature"
    ]
  },


  // ======================================================
  // Стадія 5: Виводимо результат у нову колекцію tracks
  // ======================================================
  { $out: "tracks" }


]);


print("Трансформацію завершено за " + ((Date.now() - startedAt) / 1000).toFixed(1) + " с.");
print("Документів у tracks: " + db["tracks"].countDocuments());
print("Приклад документа:");
printjson(db["tracks"].findOne());
