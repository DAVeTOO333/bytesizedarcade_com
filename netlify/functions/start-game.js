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
    const { category = "80s_top10" } = JSON.parse(event.body || "{}");

    // Get a random song
    const songs = await sql`
      SELECT id, title, artist, tags, year, mood, tempo 
      FROM songs 
      WHERE category = ${category} 
      ORDER BY RANDOM() 
      LIMIT 1
    `;

    if (songs.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "No songs found for this category" }),
      };
    }

    const secret = songs[0];

    // Get total song count for this category
    const countResult = await sql`
      SELECT COUNT(*) as total FROM songs WHERE category = ${category}
    `;

    // Create a game session
    const session = await sql`
      INSERT INTO game_sessions (secret_song_id, category) 
      VALUES (${secret.id}, ${category}) 
      RETURNING id
    `;

    return {
      statusCode: 200,
      body: JSON.stringify({
        session_id: session[0].id,
        song_count: parseInt(countResult[0].total),
        category,
      }),
    };
  } catch (err) {
    console.error("start-game error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
