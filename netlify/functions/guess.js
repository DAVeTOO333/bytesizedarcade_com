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

  // Exact match
  if (a === b) return true;

  // Strip common articles/filler words for comparison
  const strip = (s) => s.replace(/\b(the|a|an|of|in|on|my|your|i|we|is|it|to|and|or)\b/g, "").replace(/\s+/g, " ").trim();
  const sa = strip(a);
  const sb = strip(b);

  // Stripped exact match (e.g. "The Chain" vs "Chain")
  if (sa.length >= 3 && sb.length >= 3 && sa === sb) return true;

  // Substring match ONLY if the shorter string is at least 60% the length of the longer
  // This prevents "Kiss" matching "Kiss on My List"
  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;
  const lengthRatio = shorter.length / longer.length;

  if (lengthRatio >= 0.6 && longer.includes(shorter)) return true;

  // Same for stripped versions
  const sShorter = sa.length <= sb.length ? sa : sb;
  const sLonger  = sa.length <= sb.length ? sb : sa;
  const sRatio = sShorter.length > 0 ? sShorter.length / sLonger.length : 0;

  if (sRatio >= 0.6 && sLonger.includes(sShorter)) return true;

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

// Check if a string looks like ONLY an artist name (not a song title).
// We detect this by checking if the guess matches any artist name in the DB
// but does NOT match any song title. If so, it's an artist-only guess and
// can never be a solve — only inform scoring.
function findGuessEntry(guess, allSongs) {
  const gl = normalize(guess);

  // 1. Exact title match
  let entry = allSongs.find(s => normalize(s.title) === gl);
  if (entry) return { entry, artistOnlyGuess: false };

  // 2. Fuzzy title match
  entry = allSongs.find(s => fuzzyMatch(guess, s.title));
  if (entry) return { entry, artistOnlyGuess: false };

  // 3. Word-overlap title match
  if (gl.length >= 4) {
    entry = allSongs.find(s => {
      const nt = normalize(s.title);
      const words = gl.split(" ").filter(w => w.length > 2);
      const titleWords = nt.split(" ").filter(w => w.length > 2);
      const matchCount = words.filter(w => titleWords.includes(w)).length;
      return matchCount >= Math.max(1, Math.min(words.length, titleWords.length) * 0.6);
    });
    if (entry) return { entry, artistOnlyGuess: false };
  }

  // 4. Artist name match — ONLY used for scoring context, never for solving
  entry = allSongs.find(s => normalize(s.artist) === gl);
  if (entry) return { entry, artistOnlyGuess: true };

  // 5. Partial artist name match (e.g. "Petty" for "Tom Petty")
  entry = allSongs.find(s => {
    const na = normalize(s.artist);
    return na.includes(gl) && gl.length >= 4;
  });
  if (entry) return { entry, artistOnlyGuess: true };

  return { entry: null, artistOnlyGuess: false };
}

function scoreSimilarity(secret, guess, allSongs) {
  // SOLVE CHECK 1: Exact/fuzzy title match only — never artist name alone
  if (fuzzyMatch(guess, secret.title)) {
    return { barPercent: 100, heat: "🔥 ON FIRE", hint: "🎯 Got it!", solved: true, title: secret.title, artist: secret.artist };
  }

  // SOLVE CHECK 2: "Title Artist" or "Title - Artist" combo
  if (fuzzyMatch(guess, `${secret.title} ${secret.artist}`) ||
      fuzzyMatch(guess, `${secret.title} - ${secret.artist}`)) {
    return { barPercent: 100, heat: "🔥 ON FIRE", hint: "🎯 Got it!", solved: true, title: secret.title, artist: secret.artist };
  }

  // Find the guess in the database, flagging if it's an artist-only match
  const { entry: guessEntry, artistOnlyGuess } = findGuessEntry(guess, allSongs);

  // If DB lookup found the exact secret song by title — it's a win
  // BUT only if this wasn't an artist-name-only lookup
  if (guessEntry && !artistOnlyGuess &&
      guessEntry.title === secret.title &&
      guessEntry.artist === secret.artist) {
    return { barPercent: 100, heat: "🔥 ON FIRE", hint: "🎯 Got it!", solved: true, title: secret.title, artist: secret.artist };
  }

  // Score unknown songs (not in DB at all)
  if (!guessEntry) {
    return scoreUnknownSong(secret, guess, allSongs);
  }

  // Calculate closeness score 0–100
  let closeness = 0;
  let reasons = [];

  // Same artist: big boost, but capped so artist-name guesses stay well below 100
  if (guessEntry.artist === secret.artist) {
    closeness += 50;
    if (artistOnlyGuess) {
      // They typed just the artist name — tell them they're warm but haven't named a song
      reasons.push(`Right artist! Now guess a song title`);
    } else {
      reasons.push(`Same artist: ${secret.artist}`);
    }
  }

  const secretTags = secret.tags || [];
  const guessTags = guessEntry.tags || [];

  // Exact tag matches
  const sharedTags = guessTags.filter(t => secretTags.includes(t));
  closeness += sharedTags.length * 8;
  if (sharedTags.length >= 3) reasons.push("Very similar style");
  else if (sharedTags.length >= 2) reasons.push("Some stylistic overlap");
  else if (sharedTags.length === 1) reasons.push(`Both have a "${sharedTags[0]}" vibe`);

  // Genre family overlap
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

  // Year proximity
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

  // Hard cap: artist-only guesses can never reach 100 or appear solved
  if (artistOnlyGuess) {
    closeness = Math.min(closeness, 75);
  }

  let heat;
  if (closeness >= 60) heat = "🔥 HOT";
  else if (closeness >= 40) heat = "♨️ WARM";
  else if (closeness >= 25) heat = "🌤️ LUKEWARM";
  else if (closeness >= 12) heat = "❄️ COOL";
  else heat = "🧊 FREEZING";

  const barPercent = Math.min(98, Math.max(2, closeness));
  let hint = reasons.length > 0 ? reasons[0] : "Different musical territory";

  return { barPercent, heat, hint, solved: false };
}

function scoreUnknownSong(secret, guessText, allSongs) {
  const gl = guessText.toLowerCase();
  let closeness = 0;
  let hint = "Not in the database — shooting in the dark!";

  const artistMatch = allSongs.find(s => gl.includes(s.artist.toLowerCase()));
  if (artistMatch) {
    if (artistMatch.artist === secret.artist) {
      closeness = 45 + Math.floor(Math.random() * 10);
      hint = "Right artist! But name a song title";
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

  let heat;
  if (closeness >= 60) heat = "🔥 HOT";
  else if (closeness >= 40) heat = "♨️ WARM";
  else if (closeness >= 25) heat = "🌤️ LUKEWARM";
  else if (closeness >= 12) heat = "❄️ COOL";
  else heat = "🧊 FREEZING";

  const barPercent = Math.min(98, Math.max(2, closeness));
  return { barPercent, heat, hint, solved: false };
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

    const allSongs = await sql`
      SELECT title, artist, tags, year, mood, tempo 
      FROM songs 
      WHERE category = ${session.category}
    `;

    const result = scoreSimilarity(secret, guess, allSongs);

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
        barPercent: result.barPercent,
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
