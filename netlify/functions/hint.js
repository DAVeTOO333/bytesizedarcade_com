const { getDb } = require("./db");

function titleToBlanks(title) {
  return title.split("").map((ch, i) => {
    if (i === 0) return ch.toUpperCase();
    if (ch === " ") return " ";
    return "_";
  }).join("");
}

// Hint penalties: hint index 0 = free, 1 = +2, 2 = +3, 3 = +4, 4 = +5
const HINT_PENALTIES = [0, 2, 3, 4, 5];

// Hint unlocks: after guess 1 for first hint, then every guess after
function getRequiredGuesses(hintIndex) {
  return hintIndex + 1; // hint 0 unlocks after guess 1, hint 1 after guess 2, etc.
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
    const { session_id, hints_used, artist_hint_used, title_hint_used, guesses_count } = JSON.parse(event.body || "{}");

    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing session_id" }) };
    }

    if (hints_used >= 5) {
      return { statusCode: 400, body: JSON.stringify({ error: "All hints used" }) };
    }

    const required = getRequiredGuesses(hints_used);
    if (guesses_count < required) {
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
    let newArtistHintUsed = artist_hint_used;
    let newTitleHintUsed = title_hint_used;

    if (hints_used === 0) {
      // Hint 1: always genre, always free
      hint = `🎵 Genre: ${secret.tags[0]}`;
    } else if (hints_used === 1) {
      // Hint 2: random — first letter of artist OR first letter of song title
      const useArtist = Math.random() < 0.5;
      if (useArtist) {
        hint = `🎤 Artist starts with "${secret.artist[0].toUpperCase()}"`;
        newArtistHintUsed = true;
      } else {
        hint = `📝 Song title starts with "${secret.title[0].toUpperCase()}"`;
        newTitleHintUsed = true;
      }
    } else if (hints_used === 2) {
      // Hint 3: whichever of artist/title first letter we didn't get yet
      if (!newArtistHintUsed) {
        hint = `🎤 Artist starts with "${secret.artist[0].toUpperCase()}"`;
        newArtistHintUsed = true;
      } else {
        hint = `📝 Song title starts with "${secret.title[0].toUpperCase()}"`;
        newTitleHintUsed = true;
      }
    } else if (hints_used === 3) {
      // Hint 4: random — full artist name OR title with underscores/spaces
      const useArtist = Math.random() < 0.5;
      if (useArtist) {
        hint = `🎤 Artist: ${secret.artist}`;
        newArtistHintUsed = true;
      } else {
        hint = `📝 Title: ${titleToBlanks(secret.title)}`;
        newTitleHintUsed = true;
      }
    } else if (hints_used === 4) {
      // Hint 5: whichever full reveal we didn't get yet
      // Figure out what hint 4 gave — we track via artist_hint_used / title_hint_used
      // At this point after hint 4, one of them was newly set. We give the other.
      // But we need to know what hint 4 gave. We'll use a heuristic:
      // if after hint 4 newArtistHintUsed is true but newTitleHintUsed is false (from full hints), give title
      // We pass artist_hint_used and title_hint_used from the client reflecting state AFTER hint 4.
      // So: give whichever full reveal is still missing.
      if (!artist_hint_used) {
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
      body: JSON.stringify({
        hint,
        penalty: HINT_PENALTIES[hints_used],
        artist_hint_used: newArtistHintUsed,
        title_hint_used: newTitleHintUsed,
      }),
    };
  } catch (err) {
    console.error("hint error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
