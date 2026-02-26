const { getDb } = require("./db");

function titleToBlanks(title) {
  let result = '';
  let i = 0;
  while (i < title.length) {
    const ch = title[i];
    if (ch === '(') {
      result += '(';
      i++;
    } else if (ch === ')') {
      result += ')';
      i++;
    } else if (ch === ' ') {
      result += ' ';
      i++;
    } else {
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

// Returns the "starts with" display for a title — if it starts with '(', reveal '(X'
function titleStartsWith(title) {
  if (title[0] === '(') {
    const next = title[1];
    return next ? `(${next.toUpperCase()}` : '(';
  }
  return title[0].toUpperCase();
}

// Tags that restate the category the player already chose — never useful as hints
const CATEGORY_RESTATE_TAGS = new Set([
  '80s alt', '80s alternative', '80s top 10', '80s hits',
  '90s alt', '90s alternative', '90s rap', 'hip hop', 'rap',
  'punk', 'vocaloid', 'yacht rock', 'golden oldies', 'oldies',
  'hippie vibes', 'classic rock',
]);

// Truly generic tags that add no information
const GENERIC_TAGS = new Set([
  '1970s','1971s','1972s','1973s','1974s','1975s','1976s','1977s','1978s','1979s',
  '1980s','1981s','1982s','1983s','1984s','1985s','1986s','1987s','1988s','1989s',
  '1990s','1991s','1992s','1993s','1994s','1995s','1996s','1997s','1998s','1999s',
  '2000s','2001s','2002s','2003s','2004s','2005s',
  'pop','alternative','rock','cover','tribute','movie soundtrack','instrumental',
  'novelty','experimental','duet','remix','party','fun','catchy','dance',
  'romantic','anthem','classic','hit','song',
]);

const HINT_PENALTIES = [0, 2, 3, 4, 5];

function getRequiredGuesses(hintIndex) {
  return hintIndex + 1;
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

    const sessions = await sql`
      SELECT s.title, s.artist, s.tags, s.year, gs.category
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
      // Hint 1: most specific/interesting genre tag
      const categoryWords = (secret.category || '').toLowerCase().replace(/_/g, ' ').split(' ').filter(w => w.length > 2);

      const bestTag = secret.tags.find(t => {
        const tl = t.toLowerCase();
        if (CATEGORY_RESTATE_TAGS.has(tl)) return false;
        if (GENERIC_TAGS.has(tl)) return false;
        if (categoryWords.some(w => tl === w || tl === w + 's')) return false;
        return true;
      }) || null;

      if (bestTag) {
        hint = `🎵 Genre: ${bestTag}`;
      } else {
        hint = `📅 Released: ${secret.year}`;
      }
    } else if (hints_used === 1) {
      const useArtist = Math.random() < 0.5;
      if (useArtist) {
        hint = `🎤 Artist starts with "${secret.artist[0].toUpperCase()}"`;
        newArtistHintUsed = true;
      } else {
        hint = `📝 Song title starts with "${titleStartsWith(secret.title)}"`;
        newTitleHintUsed = true;
      }
    } else if (hints_used === 2) {
      if (!newArtistHintUsed) {
        hint = `🎤 Artist starts with "${secret.artist[0].toUpperCase()}"`;
        newArtistHintUsed = true;
      } else {
        hint = `📝 Song title starts with "${titleStartsWith(secret.title)}"`;
        newTitleHintUsed = true;
      }
    } else if (hints_used === 3) {
      const useArtist = Math.random() < 0.5;
      if (useArtist) {
        hint = `🎤 Artist: ${secret.artist}`;
        newFullArtistUsed = true;
      } else {
        hint = `📝 Title: ${titleToBlanks(secret.title)}`;
        newFullTitleUsed = true;
      }
    } else if (hints_used === 4) {
      if (!newFullArtistUsed) {
        hint = `🎤 Artist: ${secret.artist}`;
        newFullArtistUsed = true;
      } else {
        hint = `📝 Title: ${titleToBlanks(secret.title)}`;
        newFullTitleUsed = true;
      }
    }

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
