const { getDb } = require("./db");

function titleToBlanks(title) {
  // Split into tokens: words and parentheses groups
  // Show first letter of each word, underscores for remaining letters, preserve parens
  let result = '';
  let i = 0;
  while (i < title.length) {
    const ch = title[i];
    if (ch === '(') {
      // Preserve opening paren, then process word inside
      result += '(';
      i++;
    } else if (ch === ')') {
      result += ')';
      i++;
    } else if (ch === ' ') {
      result += ' ';
      i++;
    } else {
      // Start of a word — show first letter, underscores for rest
      result += ch.toUpperCase();
      i++;
      while (i < title.length && title[i] !== ' ' && title[i] !== '(' && title[i] !== ')') {
        result += '_';
        i++;
      }
    }
  }
  return result;
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
    const { session_id, hints_used, artist_hint_used, title_hint_used, full_artist_used, full_title_used, guesses_count } = JSON.parse(event.body || "{}");

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
    let newFullArtistUsed = full_artist_used;
    let newFullTitleUsed = full_title_used;

    if (hints_used === 0) {
      // Hint 1: genre — pick most representative tag, skip generic/decade tags
      const genericTags = new Set(['1980s','1981s','1982s','1983s','1984s','1985s','1986s','1987s','1988s','1989s','1990s','1991s','1992s','1993s','1994s','1995s','1996s','1997s','1998s','1999s','2000s','pop','alternative','cover','tribute','movie soundtrack','instrumental','novelty','experimental','duet','remix','party','fun','catchy','dance','romantic','anthem']);
      const bestTag = secret.tags.find(t => !genericTags.has(t)) || secret.tags[0];
      hint = `🎵 Genre: ${bestTag}`;
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
      // Hint 4: random — full artist name OR title with word-initial letters + underscores
      const useArtist = Math.random() < 0.5;
      if (useArtist) {
        hint = `🎤 Artist: ${secret.artist}`;
        newFullArtistUsed = true;
      } else {
        hint = `📝 Title: ${titleToBlanks(secret.title)}`;
        newFullTitleUsed = true;
      }
    } else if (hints_used === 4) {
      // Hint 5: whichever full reveal hint 4 did NOT give
      if (!newFullArtistUsed) {
        hint = `🎤 Artist: ${secret.artist}`;
        newFullArtistUsed = true;
      } else {
        hint = `📝 Title: ${titleToBlanks(secret.title)}`;
        newFullTitleUsed = true;
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
        full_artist_used: newFullArtistUsed,
        full_title_used: newFullTitleUsed,
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
