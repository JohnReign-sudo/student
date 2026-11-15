
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool, initializeDatabase } = require("./database");

const app = express();

app.use(cors());
app.use(express.json());

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Please log in." });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Invalid or expired session."
    });
  }
}

// REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !/^[a-zA-Z0-9_]{3,30}$/.test(username) ||
      password.length < 10 ||
      password.length > 72
    ) {
      return res.status(400).json({
        error: "Use a 3-30 character username and a password of 10-72 characters."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2) RETURNING id, username`,
      [username, hash]
    );

    res.status(201).json({
      message: "Account created successfully.",
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Username already exists."
      });
    }

    console.error(error);
    res.status(500).json({ error: "Registration failed." });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (typeof username !== "string" ||
        typeof password !== "string") {
      return res.status(400).json({
        error: "Enter your username and password."
      });
    }

    const result = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Incorrect username or password."
      });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({
        error: "Incorrect username or password."
      });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful.",
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed." });
  }
});

// CURRENT ACCOUNT
app.get("/api/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

// GET TASKS BELONGING TO LOGGED-IN STUDENT
app.get("/api/tasks", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, subject, description AS notes,
              due_date AS date, priority, completed AS done
       FROM tasks
       WHERE user_id = $1
       ORDER BY due_date ASC, id ASC`,
      [req.user.id]
    );

    res.json({ tasks: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load tasks." });
  }
});

// CREATE TASK
app.post("/api/tasks", authenticate, async (req, res) => {
  try {
    const {
      title, subject = "", date,
      priority = "normal", notes = ""
    } = req.body;

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 90 ||
      typeof subject !== "string" ||
      subject.length > 40 ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof notes !== "string" ||
      notes.length > 300 ||
      !["low", "normal", "high"].includes(priority)
    ) {
      return res.status(400).json({
        error: "Invalid task details."
      });
    }

    const result = await pool.query(
      `INSERT INTO tasks
       (user_id, title, subject, due_date, priority, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, subject, description AS notes,
                 due_date AS date, priority, completed AS done`,
      [req.user.id, title.trim(), subject, date, priority, notes]
    );

    res.status(201).json({ task: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not save task." });
  }
});

// UPDATE TASK
app.put("/api/tasks/:id", authenticate, async (req, res) => {
  try {
    const {
      title, subject = "", date,
      priority = "normal", notes = "", done = false
    } = req.body;

    const id = Number(req.params.id);

    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 90 ||
      typeof subject !== "string" ||
      subject.length > 40 ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof notes !== "string" ||
      notes.length > 300 ||
      !["low", "normal", "high"].includes(priority) ||
      typeof done !== "boolean"
    ) {
      return res.status(400).json({
        error: "Invalid task details."
      });
    }

    const result = await pool.query(
      `UPDATE tasks
       SET title = $1, subject = $2, due_date = $3,
           priority = $4, description = $5, completed = $6
       WHERE id = $7 AND user_id = $8
       RETURNING id`,
      [
        title.trim(), subject, date, priority,
        notes, done, id, req.user.id
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Task not found." });
    }

    res.json({ message: "Task updated successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update task." });
  }
});

// DELETE TASK
app.delete("/api/tasks/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid task ID." });
    }

    const result = await pool.query(
      "DELETE FROM tasks WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Task not found." });
    }

    res.json({ message: "Task deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete task." });
  }
});

// HOME
app.get("/", (req, res) => {
  res.json({ message: "StudyFlow API is running!" });
});

// HEALTH
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT NOW()");
    res.json({
      status: "connected",
      database: "StudyFlow PostgreSQL"
    });
  } catch {
    res.status(500).json({
      status: "database connection failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing.");
    }

    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`StudyFlow running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error);
    process.exit(1);
  }
}

startServer();
