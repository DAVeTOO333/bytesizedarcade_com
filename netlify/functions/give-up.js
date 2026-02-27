const { getDb } = require("./db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const sql = getDb();
    const { session_id } = JSON.parse(event.body || "{}");

    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing session_id" }) };
    }

    const sessions = await sql`
      SELECT s.id AS song_id, s.title, s.artist, s.year
      FROM game_sessions gs
      JOIN songs s ON s.id = gs.secret_song_id
      WHERE gs.id = ${session_id}
    `;

    if (sessions.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Session not found" }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        song_id: sessions[0].song_id,
        title: sessions[0].title,
        artist: sessions[0].artist,
        year: sessions[0].year,
      }),
    };
  } catch (err) {
    console.error("give-up error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
