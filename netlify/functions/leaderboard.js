const { getDb } = require("./db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, body: "" };
  }

  try {
    const sql = getDb();
    const { action, song_id, player_name, score } = JSON.parse(event.body || "{}");

    // GET top 3 for a song
    if (event.httpMethod === "GET" || action === "get") {
      if (!song_id) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing song_id" }) };
      }
      const entries = await sql`
        SELECT player_name, score, achieved_at
        FROM leaderboard
        WHERE song_id = ${song_id}
        ORDER BY score ASC, achieved_at ASC
        LIMIT 3
      `;
      return {
        statusCode: 200,
        body: JSON.stringify({ leaderboard: entries }),
      };
    }

    // SUBMIT a new entry
    if (event.httpMethod === "POST" && action === "submit") {
      if (!song_id || !player_name || score === undefined) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
      }

      const name = String(player_name).trim().slice(0, 15);
      if (!name) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid name" }) };
      }

      // Get current top 3
      const current = await sql`
        SELECT id, score FROM leaderboard
        WHERE song_id = ${song_id}
        ORDER BY score ASC, achieved_at ASC
        LIMIT 3
      `;

      const qualifies =
        current.length < 3 ||
        score < current[current.length - 1].score;

      if (!qualifies) {
        const entries = await sql`
          SELECT player_name, score, achieved_at
          FROM leaderboard
          WHERE song_id = ${song_id}
          ORDER BY score ASC, achieved_at ASC
          LIMIT 3
        `;
        return {
          statusCode: 200,
          body: JSON.stringify({ leaderboard: entries, submitted: false }),
        };
      }

      // Insert new entry
      await sql`
        INSERT INTO leaderboard (song_id, player_name, score)
        VALUES (${song_id}, ${name}, ${score})
      `;

      // Prune to top 3 — delete any entries beyond 3rd place for this song
      await sql`
        DELETE FROM leaderboard
        WHERE song_id = ${song_id}
        AND id NOT IN (
          SELECT id FROM leaderboard
          WHERE song_id = ${song_id}
          ORDER BY score ASC, achieved_at ASC
          LIMIT 3
        )
      `;

      const entries = await sql`
        SELECT player_name, score, achieved_at
        FROM leaderboard
        WHERE song_id = ${song_id}
        ORDER BY score ASC, achieved_at ASC
        LIMIT 3
      `;

      return {
        statusCode: 200,
        body: JSON.stringify({ leaderboard: entries, submitted: true }),
      };
    }

    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("leaderboard error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
