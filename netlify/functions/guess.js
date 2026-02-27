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

  const strip = (s) => s.replace(/\b(the|a|an|of|in|on|my|your|i|we|is|it|to|and|or)\b/g, "").replace(/\s+/g, " ").trim();
  const sa = strip(a);
  const sb = strip(b);

  if (sa.length >= 3 && sb.length >= 3 && sa === sb) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;
  const lengthRatio = shorter.length / longer.length;

  if (lengthRatio >= 0.6 && longer.includes(shorter)) return true;

  const sShorter = sa.length <= sb.length ? sa : sb;
  const sLonger  = sa.length <= sb.length ? sb : sa;
  const sRatio = sShorter.length > 0 ? sShorter.length / sLonger.length : 0;

  if (sRatio >= 0.6 && sLonger.includes(sShorter)) return true;

  return false;
}

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

function findGuessEntry(guess, allSongs) {
  const gl = normalize(guess);

  let entry = allSongs.find(s => normalize(s.title) === gl);
  if (entry) return { entry, artistOnlyGuess: false };

  entry = allSongs.find(s => fuzzyMatch(guess, s.title));
  if (entry) return { entry, artistOnlyGuess: false };

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

  entry = allSongs.find(s => normalize(s.artist) === gl);
  if (entry) return { entry, artistOnlyGuess: true };

  entry = allSongs.find(s => {
    const na = normalize(s.artist);
    return na.includes(gl) && gl.length >= 4;
  });
  if (entry) return { entry, artistOnlyGuess: true };

  return { entry: null, artistOnlyGuess: false };
}

const WRONG_CATEGORY_HINTS = [
  "Great song — wrong category!",
  "Nice pick, but that's in a different category",
  "Real one! But not in this category",
  "Good taste, wrong category though",
  "That song exists — just not in this category",
  "Solid choice, but check the category!",
  "You know your music! Different category though",
  "That's a legit song, just filed elsewhere",
  "Close — but that belongs in another category",
  "Wrong era for this category!",
  "That song's in the database, wrong drawer though",
  "Banger, but wrong category",
  "Certified hit — wrong category bucket",
  "You're in the wrong room with that one",
  "That song's real, just living in a different category",
  "Good guess, different musical neighborhood",
  "That's definitely a song — wrong category though",
  "Nice, but that one's from a different pile",
];

function scoreSimilarity(secret, guess, allSongs, wrongCategoryMatch) {
  if (fuzzyMatch(guess, secret.title)) {
    return { barPercent: 100, heat: "🔥 ON FIRE", hint: "🎯 Got it!", solved: true, title: secret.title, artist: secret.artist };
  }

  if (fuzzyMatch(guess, `${secret.title} ${secret.artist}`) ||
      fuzzyMatch(guess, `${secret.title} - ${secret.artist}`)) {
    return { barPercent: 100, heat: "🔥 ON FIRE", hint: "🎯 Got it!", solved: true, title: secret.title, artist: secret.artist };
  }

  const { entry: guessEntry, artistOnlyGuess } = findGuessEntry(guess, allSongs);

  if (guessEntry && !artistOnlyGuess &&
      guessEntry.title === secret.title &&
      guessEntry.artist === secret.artist) {
    return { barPercent: 100, heat: "🔥 ON FIRE", hint: "🎯 Got it!", solved: true, title: secret.title, artist: secret.artist };
  }

  // Song is in the DB but in a different category
  if (!guessEntry && wrongCategoryMatch) {
    const hint = WRONG_CATEGORY_HINTS[Math.floor(Math.random() * WRONG_CATEGORY_HINTS.length)];
    const sharedTags = (wrongCategoryMatch.tags || []).filter(t => (secret.tags || []).includes(t));
    const familyOverlap = countGenreFamilyOverlap(wrongCategoryMatch.tags || [], secret.tags || []);
    const yearDiff = Math.abs(wrongCategoryMatch.year - secret.year);
    let closeness = 5 + sharedTags.length * 6 + familyOverlap * 4;
    if (yearDiff <= 2) closeness += 8;
    else if (yearDiff <= 5) closeness += 4;
    closeness = Math.min(closeness, 50);

    let heat;
    if (closeness >= 40) heat = "♨️ WARM";
    else if (closeness >= 25) heat = "🌤️ LUKEWARM";
    else if (closeness >= 12) heat = "❄️ COOL";
    else heat = "🧊 FREEZING";

    return { barPercent: Math.max(2, closeness), heat, hint, solved: false };
  }

  if (!guessEntry) {
    return scoreUnknownSong(secret, guess, allSongs);
  }

  let closeness = 0;
  let reasons = [];

  if (guessEntry.artist === secret.artist) {
    closeness += 50;
    if (artistOnlyGuess) {
      reasons.push(`Right artist! Now guess a song title`);
    } else {
      reasons.push(`Same artist: ${secret.artist}`);
    }
  }

  const secretTags = secret.tags || [];
  const guessTags = guessEntry.tags || [];

  const sharedTags = guessTags.filter(t => secretTags.includes(t));
  closeness += sharedTags.length * 8;
  if (sharedTags.length >= 3) reasons.push("Very similar style");
  else if (sharedTags.length >= 2) reasons.push("Some stylistic overlap");
  else if (sharedTags.length === 1) reasons.push(`Both have a "${sharedTags[0]}" vibe`);

  const familyOverlap = countGenreFamilyOverlap(secretTags, guessTags);
  closeness += familyOverlap * 5;
  if (familyOverlap > 0 && sharedTags.length === 0) {
    reasons.push("Related musical style");
  }

  if (guessEntry.mood === secret.mood) {
    closeness += 8;
    if (!reasons.length) reasons.push("Similar mood");
  }

  if (guessEntry.tempo === secret.tempo) {
    closeness += 4;
  }

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
      SELECT gs.*, s.id AS song_id, s.title, s.artist, s.tags, s.year, s.mood, s.tempo
      FROM game_sessions gs
      JOIN songs s ON s.id = gs.secret_song_id
      WHERE gs.id = ${session_id}
    `;

    if (sessions.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Session not found" }) };
    }

    const session = sessions[0];
    const secret = {
      id: session.song_id,
      title: session.title,
      artist: session.artist,
      tags: session.tags,
      year: session.year,
      mood: session.mood,
      tempo: session.tempo,
    };

    // Songs in the current category — used for scoring
    const allSongs = await sql`
      SELECT title, artist, tags, year, mood, tempo 
      FROM songs 
      WHERE category = ${session.category}
    `;

    // Check if the guess exists in a DIFFERENT category — no limit, check all songs
    let wrongCategoryMatch = null;
    const { entry: inCategory } = findGuessEntry(guess, allSongs);
    if (!inCategory) {
      const otherSongs = await sql`
        SELECT title, artist, tags, year, mood, tempo
        FROM songs
        WHERE category != ${session.category}
      `;
      const { entry: other, artistOnlyGuess } = findGuessEntry(guess, otherSongs);
      if (other && !artistOnlyGuess) {
        wrongCategoryMatch = other;
      }
    }

    const result = scoreSimilarity(secret, guess, allSongs, wrongCategoryMatch);

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
        song_id: result.solved ? secret.id : null,
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
