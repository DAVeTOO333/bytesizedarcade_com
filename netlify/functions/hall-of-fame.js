const { getDb } = require("./db");

const CATEGORY_ORDER = [
  '80s_top10', '80s_alt', '90s_rap', '90s_alt', 'punk',
  'vocaloid', 'yacht_rock', 'golden_oldies', 'hippie_vibes', 'classic_rock', '2000s_hits',
];

const CATEGORY_LABELS = {
  '80s_top10':     "\uD83C\uDFB5 80's Top 10 Hits",
  '80s_alt':       "\uD83D\uDCFC 80's Alt Bands",
  '90s_rap':       "\uD83C\uDFA4 90's Rap & Hip Hop",
  '90s_alt':       "\uD83D\uDCC0 90's Alternative",
  'punk':          "\uD83E\uDDF7 Punk & Stuff",
  'vocaloid':      "\uD83C\uDFA7 Vocaloid",
  'yacht_rock':    "\u26F5 Yacht Rock",
  'golden_oldies': "\uD83D\uDCFB Golden Oldies",
  'hippie_vibes':  "\u270C\uFE0F Hippie Vibes",
  'classic_rock':  "\uD83C\uDFB8 Classic Rock",
  '2000s_hits':    "\uD83D\uDCBF 2000's Hits",
};

const SLOT_POINTS = [30, 20, 10];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, body: "" };
  }

  try {
    const sql = getDb();

    // Get all leaderboard entries joined with song info
    const rows = await sql`
      SELECT
        s.id AS song_id,
        s.title,
        s.artist,
        s.category,
        l.player_name,
        l.score,
        l.achieved_at
      FROM leaderboard l
      JOIN songs s ON s.id = l.song_id
      ORDER BY s.category, s.id, l.score ASC, l.achieved_at ASC
    `;

    // Group by category -> song, collect top 3 entries per song
    const categoryMap = {};

    for (const row of rows) {
      const cat = row.category;
      if (!categoryMap[cat]) categoryMap[cat] = {};

      const songKey = row.song_id;
      if (!categoryMap[cat][songKey]) {
        categoryMap[cat][songKey] = {
          song_id: row.song_id,
          title: row.title,
          artist: row.artist,
          entries: [],
          best_score: Infinity,
          latest_activity: null,
        };
      }

      const song = categoryMap[cat][songKey];
      if (song.entries.length < 3) {
        song.entries.push({ player_name: row.player_name, score: row.score });
      }
      if (row.score < song.best_score) song.best_score = row.score;
      if (!song.latest_activity || new Date(row.achieved_at) > new Date(song.latest_activity)) {
        song.latest_activity = row.achieved_at;
      }
    }

    // Calculate Top Sleuths + Most Wanted per category
    const sleutMap = {}; // player_name -> { points, categories: Set }
    const categoryPlayerPoints = {}; // cat -> { player_name -> points }

    for (const cat of Object.keys(categoryMap)) {
      if (!categoryPlayerPoints[cat]) categoryPlayerPoints[cat] = {};

      for (const song of Object.values(categoryMap[cat])) {
        song.entries.forEach((entry, slotIndex) => {
          const name = entry.player_name;
          const pts = SLOT_POINTS[slotIndex] || 0;

          // Global sleuth tracking
          if (!sleutMap[name]) sleutMap[name] = { points: 0, categories: new Set() };
          sleutMap[name].points += pts;
          sleutMap[name].categories.add(cat);

          // Per-category tracking
          categoryPlayerPoints[cat][name] = (categoryPlayerPoints[cat][name] || 0) + pts;
        });
      }
    }

    // Build sleuth list
    const sleuths = Object.entries(sleutMap).map(([name, data]) => ({
      name,
      points: data.points,
      category_count: data.categories.size,
      sleuth_score: data.points * data.categories.size,
    }));

    // Top 10 by raw points
    const podium = [...sleuths]
      .sort((a, b) => b.points - a.points || b.category_count - a.category_count)
      .slice(0, 10);

    // Renaissance Sleuth: highest sleuth_score (points * categories)
    const renaissance = [...sleuths]
      .sort((a, b) => b.sleuth_score - a.sleuth_score)
      .slice(0, 1)[0] || null;

    // Build result: for each category, sort songs by competitiveness, take top 20
    const result = [];

    for (const cat of CATEGORY_ORDER) {
      // Most Wanted: player with most points in this category
      let most_wanted = null;
      if (categoryPlayerPoints[cat]) {
        const entries = Object.entries(categoryPlayerPoints[cat]);
        if (entries.length > 0) {
          entries.sort((a, b) => b[1] - a[1]);
          most_wanted = { name: entries[0][0], points: entries[0][1] };
        }
      }

      if (!categoryMap[cat]) {
        result.push({
          category: cat,
          label: CATEGORY_LABELS[cat] || cat,
          most_wanted,
          songs: [],
        });
        continue;
      }

      const songs = Object.values(categoryMap[cat]);

      songs.sort((a, b) => {
        if (b.entries.length !== a.entries.length) return b.entries.length - a.entries.length;
        if (a.best_score !== b.best_score) return a.best_score - b.best_score;
        return new Date(b.latest_activity) - new Date(a.latest_activity);
      });

      result.push({
        category: cat,
        label: CATEGORY_LABELS[cat] || cat,
        most_wanted,
        songs: songs.slice(0, 20),
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        podium,
        renaissance,
        categories: result,
      }),
    };
  } catch (err) {
    console.error("hall-of-fame error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
