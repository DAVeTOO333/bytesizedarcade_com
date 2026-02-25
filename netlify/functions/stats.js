const { getDb } = require("./db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, body: "" };
  }

  try {
    const sql = getDb();

    // Total games ever
    const [totals] = await sql`SELECT COUNT(*)::int AS total_games FROM game_sessions`;

    // All-time plays per category
    const allTime = await sql`
      SELECT category, COUNT(*)::int AS plays
      FROM game_sessions
      GROUP BY category
      ORDER BY plays DESC
    `;

    // Plays per category in the last 24 hours
    const recent = await sql`
      SELECT category, COUNT(*)::int AS plays
      FROM game_sessions
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY category
      ORDER BY plays DESC
    `;

    return {
      statusCode: 200,
      body: JSON.stringify({
        total_games: totals.total_games,
        all_time: allTime,
        last_24h: recent,
      }),
    };
  } catch (err) {
    console.error("stats error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
