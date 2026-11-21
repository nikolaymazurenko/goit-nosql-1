// queries/part3_indexes.js
// Запуск: mongosh "ВАШ_URI" --file queries/part3_indexes.js

db = db.getSiblingDB("spotify");


// Збирає ланцюжок стадій виграшного плану: ["SORT", "COLLSCAN"] тощо
function collectStages(plan, stages = []) {
  if (!plan) return stages;
  stages.push(plan.indexName ? `${plan.stage}(${plan.indexName})` : plan.stage);
  if (plan.inputStage) collectStages(plan.inputStage, stages);
  (plan.inputStages || []).forEach((p) => collectStages(p, stages));
  return stages;
}

// Знаходить у плані стадію IXSCAN, щоб показати межі сканування індексу
function findIxscan(plan) {
  if (!plan) return null;
  if (plan.stage === "IXSCAN") return plan;
  return (
    findIxscan(plan.inputStage) ||
    (plan.inputStages || []).map(findIxscan).find(Boolean) ||
    null
  );
}

// Друкує ключові поля з explain("executionStats")
function printExplain(title, explain) {
  const winningPlan = explain.queryPlanner.winningPlan.queryPlan || explain.queryPlanner.winningPlan;
  const stats = explain.executionStats;
  const ixscan = findIxscan(winningPlan);

  print("\n--- " + title + " ---");
  print("Стадії плану:        " + collectStages(winningPlan).join(" <- "));
  print("nReturned:           " + stats.nReturned);
  print("totalKeysExamined:   " + stats.totalKeysExamined);
  print("totalDocsExamined:   " + stats.totalDocsExamined);
  print("executionTimeMillis: " + stats.executionTimeMillis);
  if (ixscan) {
    print("indexBounds:");
    printjson(ixscan.indexBounds);
  }
}


// Прибираємо індекси з попередніх запусків (усі, крім _id), щоб скрипт був ідемпотентним
db["tracks"].dropIndexes();


// ======================================================
// Завдання 1. Аналіз запиту та індексація
// ======================================================
print("Завдання 1. Аналіз запиту та індексація");

const popFilter = {
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
};
const popSort = { popularity: -1 };

// Крок 1: план виконання без індексів
printExplain(
  "Без індексу",
  db["tracks"].find(popFilter).sort(popSort).explain("executionStats")
);

// Крок 2: індекс за правилом ESR (Equality -> Sort -> Range):
// точний збіг за жанром, далі поле сортування, останнім — діапазонне поле
db["tracks"].createIndex(
  { track_genre: 1, popularity: -1, "audio_features.danceability": 1 },
  { name: "genre_popularity_danceability" }
);

// Крок 3: план виконання з індексом
printExplain(
  "З індексом genre_popularity_danceability",
  db["tracks"].find(popFilter).sort(popSort).explain("executionStats")
);


// ======================================================
// Завдання 2. Індекс для інших полів
// ======================================================
print("\nЗавдання 2. Індекс для пошуку музики для роботи");

const focusFilter = {
  explicit: false,
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 }
};

printExplain(
  "Без індексу",
  db["tracks"].find(focusFilter).explain("executionStats")
);

// Спершу поле з точним збігом (explicit), потім діапазонні:
// instrumentalness відсікає більше документів, тому стоїть перед speechiness
db["tracks"].createIndex(
  {
    explicit: 1,
    "audio_features.instrumentalness": 1,
    "audio_features.speechiness": 1
  },
  { name: "explicit_instrumentalness_speechiness" }
);

printExplain(
  "З індексом explicit_instrumentalness_speechiness",
  db["tracks"].find(focusFilter).explain("executionStats")
);


// ======================================================
// Завдання 3. Покривний запит (факультативне)
// ======================================================
print("\nЗавдання 3. Покривний запит");

const coveredFilter = { track_genre: "pop", popularity: { $gte: 70 } };

// Запит з умови: без проєкції повертає документи цілком, тому не є покривним
printExplain(
  "Запит з умови (без проєкції)",
  db["tracks"].find(coveredFilter).explain("executionStats")
);

// Той самий фільтр, але повертаємо лише поля з індексу і вимикаємо _id — покривний
printExplain(
  "З проєкцією лише на поля індексу",
  db["tracks"]
    .find(coveredFilter, { _id: 0, track_genre: 1, popularity: 1 })
    .explain("executionStats")
);
