const { neon } = require("@neondatabase/serverless");

function getDb() {
  return neon(process.env.DATABASE_URL);
}

module.exports = { getDb };
