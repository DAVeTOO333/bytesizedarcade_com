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

      // Latest leaderboard win
      const latestWinRows = await sql`
        SELECT l.player_name, s.title, s.artist, s.category
        FROM leaderboard l
        JOIN songs s ON s.id = l.song_id
        ORDER BY l.achieved_at DESC
        LIMIT 1
      `;
      const latestWin = latestWinRows.length ? latestWinRows[0] : null;

      // Win rates per category (only categories with 20+ games)
      const winRates = await sql`
            SELECT
                    category,
                            COUNT(*)::int AS total,
                                    SUM(CASE WHEN solved = true THEN 1 ELSE 0 END)::int AS wins,
                                            ROUND(SUM(CASE WHEN solved = true THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 1) AS win_rate
                                                  FROM game_sessions
                                                        GROUP BY category
                                                              HAVING COUNT(*) >= 20
                                                                    ORDER BY win_rate ASC
                                                                        `;

      return {
              statusCode: 200,
              body: JSON.stringify({
                        total_games: totals.total_games,
                        all_time: allTime,
                        last_24h: recent,
                        win_rates: winRates,
                        latest_win: latestWin,
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
