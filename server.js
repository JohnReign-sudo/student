
const express = require("express");
const cors = require("cors");
const { pool, initializeDatabase } = require("./database");

const app = express();

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.json({ message: "StudyFlow API is running!" });
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

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`StudyFlow running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
  }
}

startServer();
