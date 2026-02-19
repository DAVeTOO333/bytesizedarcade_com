const { getDb } = require("./db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, body: "" };
  }

  try {
    const sql = getDb();
    const [row] = await sql`SELECT COUNT(*)::int AS total_games FROM game_sessions`;

    return {
      statusCode: 200,
      body: JSON.stringify({ total_games: row.total_games }),
    };
  } catch (err) {
    console.error("stats error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
