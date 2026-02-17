const { getDb } = require("./db");

function titleToBlanks(title) {
  return title.split("").map((ch, i) => {
    if (i === 0) return ch.toUpperCase();
    if (ch === " ") return " ";
    return "_";
  }).join("");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const sql = getDb();
    const { session_id, hints_used, hint_order, bonus_hint_order, guesses_count } = JSON.parse(event.body || "{}");

    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing session_id" }) };
    }

    // Validate hint unlock requirements
    const requiredGuesses = [3, 6, 9, 12, 15];
    if (hints_used >= 5) {
      return { statusCode: 400, body: JSON.stringify({ error: "All hints used" }) };
    }
    if (guesses_count < requiredGuesses[hints_used]) {
      return { statusCode: 400, body: JSON.stringify({ error: "Not enough guesses to unlock hint" }) };
    }

    // Get the secret song
    const sessions = await sql`
      SELECT s.title, s.artist, s.tags, s.year
      FROM game_sessions gs
      JOIN songs s ON s.id = gs.secret_song_id
      WHERE gs.id = ${session_id}
    `;

    if (sessions.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Session not found" }) };
    }

    const secret = sessions[0];
    let hint;

    if (hints_used < 3) {
      const hintType = hint_order[hints_used];
      if (hintType === 0) {
        hint = `🎵 Genre: ${secret.tags[0]}`;
      } else if (hintType === 1) {
        hint = `🎤 Artist starts with "${secret.artist[0].toUpperCase()}"`;
      } else {
        hint = `📝 Song title starts with "${secret.title[0].toUpperCase()}"`;
      }
    } else {
      const bonusType = bonus_hint_order[hints_used - 3];
      if (bonusType === 0) {
        hint = `🎤 Artist: ${secret.artist}`;
      } else {
        hint = `📝 Title: ${titleToBlanks(secret.title)}`;
      }
    }

    // Update session hints count
    await sql`
      UPDATE game_sessions SET hints_used = ${hints_used + 1} WHERE id = ${session_id}
    `;

    return {
      statusCode: 200,
      body: JSON.stringify({ hint }),
    };
  } catch (err) {
    console.error("hint error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
