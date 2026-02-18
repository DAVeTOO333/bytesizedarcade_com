const { getDb } = require("./db");

// Normalize text for comparison
function normalize(str) {
  return str.toLowerCase()
    .replace(/['\u2018\u2019]/g, "'")
    .replace(/["\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyMatch(input, target) {
  const a = normalize(input);
  const b = normalize(target);
  if (a === b) return true;
  if (a.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  const stripped = (s) => s.replace(/\b(the|a|an|of|in|on|my|your|i|we|is|it|to|and|or)\b/g, "").replace(/\s+/g, " ").trim();
  if (stripped(a).length >= 4 && stripped(b).length >= 4) {
    if (stripped(a) === stripped(b)) return true;
    if (stripped(a).includes(stripped(b)) || stripped(b).includes(stripped(a))) return true;
  }
  return false;
}

function scoreSimilarity(secret, guess, allSongs) {
  // Check for exact match
  if (fuzzyMatch(guess, secret.title)) {
    return { score: 1, hint: "🎯 That's it!", solved: true, title: secret.title, artist: secret.artist };
  }
  if (fuzzyMatch(guess, `${secret.title} ${secret.artist}`) ||
      fuzzyMatch(guess, `${secret.title} - ${secret.artist}`)) {
    return { score: 1, hint: "🎯 That's it!", solved: true, title: secret.title, artist: secret.artist };
  }

  // Find the guess in the database
  const gl = normalize(guess);
  let guessEntry = allSongs.find(s => normalize(s.title) === gl);
  if (!guessEntry) {
    guessEntry = allSongs.find(s => fuzzyMatch(guess, s.title));
  }
  if (!guessEntry && gl.length >= 4) {
    guessEntry = allSongs.find(s => {
      const nt = normalize(s.title);
      const words = gl.split(" ").filter(w => w.length > 2);
      const titleWords = nt.split(" ").filter(w => w.length > 2);
      const matchCount = words.filter(w => titleWords.includes(w)).length;
      return matchCount >= Math.max(1, Math.min(words.length, titleWords.length) * 0.6);
    });
  }
  if (!guessEntry) {
    guessEntry = allSongs.find(s => normalize(s.artist) === gl);
  }

  // If it matched the secret through DB lookup
  if (guessEntry && guessEntry.title === secret.title && guessEntry.artist === secret.artist) {
    return { score: 1, hint: "🎯 That's it!", solved: true, title: secret.title, artist: secret.artist };
  }

  // Score unknown songs
  if (!guessEntry) {
    return scoreUnknownSong(secret, guess, allSongs);
  }

  // Calculate similarity
  let score = 0;
  let reasons = [];

  if (guessEntry.artist === secret.artist) {
    score += 350;
    reasons.push(`Same artist: ${secret.artist}`);
  }

  const secretTags = secret.tags || [];
  const guessTags = guessEntry.tags || [];
  const sharedTags = guessTags.filter(t => secretTags.includes(t));
  score += sharedTags.length * 65;
  if (sharedTags.length >= 3) reasons.push("Very similar style");
  else if (sharedTags.length >= 2) reasons.push("Some stylistic overlap");
  else if (sharedTags.length === 1) reasons.push(`Both have a "${sharedTags[0]}" vibe`);

  if (guessEntry.mood === secret.mood) {
    score += 80;
    reasons.push("Similar mood");
  }
  if (guessEntry.tempo === secret.tempo) {
    score += 40;
  }

  const yearDiff = Math.abs(guessEntry.year - secret.year);
  if (yearDiff === 0) {
    score += 70;
    reasons.push("Same year");
  } else if (yearDiff <= 1) {
    score += 55;
    reasons.push("Released around the same time");
  } else if (yearDiff <= 3) {
    score += 35;
  } else {
    score += Math.max(0, 20 - yearDiff * 3);
  }

  score = Math.min(980, Math.max(15, score));
  score = Math.max(2, 1000 - score);

  let hint = reasons.length > 0 ? reasons[0] : "Different musical territory";
  if (score > 900) hint = "Way off — different world entirely";
  else if (score > 800) hint = reasons[0] || "Not much in common";

  return { score, hint, solved: false };
}

function scoreUnknownSong(secret, guessText, allSongs) {
  const gl = guessText.toLowerCase();
  let score = 50;
  let hint = "Not in the database — shooting in the dark!";

  const artistMatch = allSongs.find(s => gl.includes(s.artist.toLowerCase()));
  if (artistMatch) {
    if (artistMatch.artist === secret.artist) {
      score = 500 + Math.floor(Math.random() * 200);
      hint = "Right artist! But wrong song";
    } else {
      const sharedTags = (artistMatch.tags || []).filter(t => (secret.tags || []).includes(t));
      score = 80 + sharedTags.length * 40;
      hint = sharedTags.length > 0 ? "Some genre overlap" : "Different musical world";
    }
  }

  const rockWords = ["rock", "metal", "guitar", "thunder", "fire", "storm"];
  const popWords = ["love", "baby", "dance", "heart", "girl", "boy"];
  const secretIsRock = (secret.tags || []).some(t => t.includes("rock") || t.includes("metal"));
  const secretIsPop = (secret.tags || []).some(t => t.includes("pop"));

  if (rockWords.some(w => gl.includes(w)) && secretIsRock) score += 50;
  if (popWords.some(w => gl.includes(w)) && secretIsPop) score += 50;

  score = Math.min(800, Math.max(20, score));
  score = Math.max(2, 1000 - score);
  return { score, hint, solved: false };
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
    const { session_id, guess } = JSON.parse(event.body || "{}");

    if (!session_id || !guess) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing session_id or guess" }) };
    }

    // Get the session and secret song
    const sessions = await sql`
      SELECT gs.*, s.title, s.artist, s.tags, s.year, s.mood, s.tempo
      FROM game_sessions gs
      JOIN songs s ON s.id = gs.secret_song_id
      WHERE gs.id = ${session_id}
    `;

    if (sessions.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Session not found" }) };
    }

    const session = sessions[0];
    const secret = {
      title: session.title,
      artist: session.artist,
      tags: session.tags,
      year: session.year,
      mood: session.mood,
      tempo: session.tempo,
    };

    // Get all songs for this category (for scoring)
    const allSongs = await sql`
      SELECT title, artist, tags, year, mood, tempo 
      FROM songs 
      WHERE category = ${session.category}
    `;

    // Score the guess
    const result = scoreSimilarity(secret, guess, allSongs);

    // Update session
    await sql`
      UPDATE game_sessions 
      SET guesses = guesses + 1, 
          solved = ${result.solved},
          final_score = CASE WHEN ${result.solved} THEN guesses + 1 ELSE final_score END
      WHERE id = ${session_id}
    `;

    return {
      statusCode: 200,
      body: JSON.stringify({
        score: result.score,
        hint: result.hint,
        solved: result.solved,
        guess_number: session.guesses + 1,
        title: result.title || null,
        artist: result.artist || null,
      }),
    };
  } catch (err) {
    console.error("guess error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
