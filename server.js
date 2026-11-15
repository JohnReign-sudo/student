
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(express.json());

app.use(cors({
  origin: process.env.FRONTEND_URL || true
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : false
});

app.get("/", (req, res) => {
  res.json({
    message: "StudyFlow API is running!"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT NOW()");
    res.json({
      status: "connected",
      database: "StudyFlow PostgreSQL"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "database connection failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`StudyFlow server running on port ${PORT}`);
});
