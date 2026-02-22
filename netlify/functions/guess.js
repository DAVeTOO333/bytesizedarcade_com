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

// Genre family groupings — songs within the same family get partial credit
const GENRE_FAMILIES = [
  ['pop', 'dance pop', 'teen pop', 'synth pop', 'dance'],
  ['rock', 'pop rock', 'arena rock', 'heartland rock', 'hard rock', 'hair metal', 'southern rock', 'blues rock'],
  ['new wave', 'synth pop', 'synth rock', 'alternative'],
  ['R&B', 'soul', 'funk', 'disco', 'smooth jazz', 'jazz', 'groove'],
  ['country', 'country pop', 'country rock', 'soft rock', 'yacht rock'],
  ['hip hop', 'rap', 'new jack swing'],
  ['reggae', 'ska', 'reggae pop'],
  ['metal', 'heavy metal', 'thrash', 'hair metal', 'hard rock'],
  ['punk', 'post-punk', 'new wave', 'alternative'],
  ['progressive rock', 'art rock', 'synth rock'],
  ['power ballad', 'ballad', 'soft rock', 'romantic'],
];

function getGenreFamily(tag) {
  for (const family of GENRE_FAMILIES) {
    if (family.includes(tag)) return family;
  }
  return null;
}

function countGenreFamilyOverlap(tagsA, tagsB) {
  // Count how many genre families are shared
  const familiesA = new Set();
  const familiesB = new Set();
  for (const t of tagsA) {
    const f = getGenreFamily(t);
    if (f) familiesA.add(f);
  }
  for (const t of tagsB) {
    const f = getGenreFamily(t);
    if (f) familiesB.add(f);
  }
  let overlap = 0;
  for (const f of familiesA) {
    if (familiesB.has(f)) overlap++;
  }
  return overlap;
}

function scoreSimilarity(secret, guess, allSongs) {
  // Check for exact match
  if (fuzzyMatch(guess, secret.title)) {
    return { score: 0, heat: "🔥 ON FIRE", hint: "🎯 That's it!", solved: true, title: secret.title, artist: secret.artist };
  }
  if (fuzzyMatch(guess, `${secret.title} ${secret.artist}`) ||
      fuzzyMatch(guess, `${secret.title} - ${secret.artist}`)) {
    return { score: 0, heat: "🔥 ON FIRE", hint: "🎯 That's it!", solved: true, title: secret.title, artist: secret.artist };
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
    return { score: 0, heat: "🔥 ON FIRE", hint: "🎯 That's it!", solved: true, title: secret.title, artist: secret.artist };
  }

  // Score unknown songs
  if (!guessEntry) {
    return scoreUnknownSong(secret, guess, allSongs);
  }

  // Calculate similarity score (lower = closer = hotter)
  // We'll build a "closeness" score from 0–100, then map to heat
  let closeness = 0;
  let reasons = [];

  // Same artist: massive boost
  if (guessEntry.artist === secret.artist) {
    closeness += 50;
    reasons.push(`Same artist: ${secret.artist}`);
  }

  const secretTags = secret.tags || [];
  const guessTags = guessEntry.tags || [];

  // Exact tag matches
  const sharedTags = guessTags.filter(t => secretTags.includes(t));
  closeness += sharedTags.length * 8;
  if (sharedTags.length >= 3) reasons.push("Very similar style");
  else if (sharedTags.length >= 2) reasons.push("Some stylistic overlap");
  else if (sharedTags.length === 1) reasons.push(`Both have a "${sharedTags[0]}" vibe`);

  // Genre family overlap (partial genre credit)
  const familyOverlap = countGenreFamilyOverlap(secretTags, guessTags);
  closeness += familyOverlap * 5;
  if (familyOverlap > 0 && sharedTags.length === 0) {
    reasons.push("Related musical style");
  }

  // Mood match
  if (guessEntry.mood === secret.mood) {
    closeness += 8;
    if (!reasons.length) reasons.push("Similar mood");
  }

  // Tempo match
  if (guessEntry.tempo === secret.tempo) {
    closeness += 4;
  }

  // Year proximity — much more generous bands
  const yearDiff = Math.abs(guessEntry.year - secret.year);
  if (yearDiff === 0) {
    closeness += 15;
    reasons.push("Same year");
  } else if (yearDiff <= 1) {
    closeness += 12;
    reasons.push("Released around the same time");
  } else if (yearDiff <= 2) {
    closeness += 9;
  } else if (yearDiff <= 3) {
    closeness += 6;
  } else if (yearDiff <= 5) {
    closeness += 3;
  }
  // Beyond 5 years: no year credit

  // closeness now ranges roughly 0–100
  // Map to heat levels with generous bands so players see more warm/hot
  // closeness: 0 = nothing in common, 100 = very close
  let heat, displayScore;

  if (closeness >= 60) {
    heat = "🔥 HOT";
    displayScore = Math.round(10 + (100 - closeness) * 0.4);
  } else if (closeness >= 40) {
    heat = "♨️ WARM";
    displayScore = Math.round(30 + (60 - closeness) * 1.5);
  } else if (closeness >= 25) {
    heat = "🌤️ LUKEWARM";
    displayScore = Math.round(55 + (40 - closeness) * 2);
  } else if (closeness >= 12) {
    heat = "❄️ COOL";
    displayScore = Math.round(75 + (25 - closeness) * 2);
  } else {
    heat = "🧊 FREEZING";
    displayScore = Math.round(90 + Math.min(9, (12 - closeness) * 0.8));
  }

  // displayScore is a 0–100 bar fill percentage (inverse: high = close)
  const barPercent = Math.max(2, 100 - displayScore);

  let hint = reasons.length > 0 ? reasons[0] : "Different musical territory";

  return { score: displayScore, barPercent, heat, hint, solved: false };
}

function scoreUnknownSong(secret, guessText, allSongs) {
  const gl = guessText.toLowerCase();
  let closeness = 0;
  let hint = "Not in the database — shooting in the dark!";

  // Check if they typed an artist name
  const artistMatch = allSongs.find(s => gl.includes(s.artist.toLowerCase()));
  if (artistMatch) {
    if (artistMatch.artist === secret.artist) {
      closeness = 45 + Math.floor(Math.random() * 10);
      hint = "Right artist! But wrong song";
    } else {
      const sharedTags = (artistMatch.tags || []).filter(t => (secret.tags || []).includes(t));
      const familyOverlap = countGenreFamilyOverlap(artistMatch.tags || [], secret.tags || []);
      closeness = 8 + sharedTags.length * 6 + familyOverlap * 4;
      hint = sharedTags.length > 0 ? "Some genre overlap" : "Different musical world";
    }
  }

  const rockWords = ["rock", "metal", "guitar", "thunder", "fire", "storm"];
  const popWords = ["love", "baby", "dance", "heart", "girl", "boy"];
  const secretIsRock = (secret.tags || []).some(t => t.includes("rock") || t.includes("metal"));
  const secretIsPop = (secret.tags || []).some(t => t.includes("pop"));

  if (rockWords.some(w => gl.includes(w)) && secretIsRock) closeness += 5;
  if (popWords.some(w => gl.includes(w)) && secretIsPop) closeness += 5;

  // Map closeness to displayScore/heat same as above
  let heat, displayScore;
  if (closeness >= 60) {
    heat = "🔥 HOT";
    displayScore = Math.round(10 + (100 - closeness) * 0.4);
  } else if (closeness >= 40) {
    heat = "♨️ WARM";
    displayScore = Math.round(30 + (60 - closeness) * 1.5);
  } else if (closeness >= 25) {
    heat = "🌤️ LUKEWARM";
    displayScore = Math.round(55 + (40 - closeness) * 2);
  } else if (closeness >= 12) {
    heat = "❄️ COOL";
    displayScore = Math.round(75 + (25 - closeness) * 2);
  } else {
    heat = "🧊 FREEZING";
    displayScore = Math.round(90 + Math.min(9, (12 - closeness) * 0.8));
  }

  const barPercent = Math.max(2, 100 - displayScore);
  return { score: displayScore, barPercent, heat, hint, solved: false };
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
        barPercent: result.barPercent !== undefined ? result.barPercent : Math.max(2, 100 - result.score),
        heat: result.heat,
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
