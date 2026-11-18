
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const webPush = require("web-push");
const { pool, initializeDatabase } = require("./database");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// AUTHENTICATION
// Always get the user's current role from the database.
// Never trust a role or user ID supplied by the frontend.
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Please log in." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `SELECT id, username, role
       FROM users
       WHERE id = $1`,
      [decoded.id]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Account no longer exists."
      });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" ||
        error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Invalid or expired session."
      });
    }

    console.error(error);
    res.status(500).json({
      error: "Authentication failed."
    });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({
        error: "You do not have permission to access this feature."
      });
    }

    next();
  };
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validDate(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

// PUSH CONFIGURATION
function configurePush() {
  if (
    !process.env.VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY
  ) {
    console.warn("Push notifications are not configured.");
    return false;
  }

  webPush.setVapidDetails(
    "https://johnreign-sudo.github.io/student/",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  return true;
}

// REGISTER
// Public registration always creates a student.
// Users cannot register themselves as teachers.
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
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'student')
       RETURNING id, username, role`,
      [username, hash]
    );

    res.status(201).json({
      message: "Student account created successfully.",
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Username already exists."
      });
    }

    console.error(error);
    res.status(500).json({
      error: "Registration failed."
    });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (
      typeof username !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        error: "Enter your username and password."
      });
    }

    const result = await pool.query(
      `SELECT id, username, password_hash, role
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Incorrect username or password."
      });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Incorrect username or password."
      });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Login failed."
    });
  }
});

// CURRENT ACCOUNT
app.get("/api/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

// PERSONAL TASKS: GET
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
    res.status(500).json({
      error: "Could not load tasks."
    });
  }
});

// PERSONAL TASKS: CREATE
app.post("/api/tasks", authenticate, async (req, res) => {
  try {
    const {
      title,
      subject = "",
      date,
      priority = "normal",
      notes = ""
    } = req.body;

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 90 ||
      typeof subject !== "string" ||
      subject.length > 40 ||
      !validDate(date) ||
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
      [
        req.user.id,
        title.trim(),
        subject,
        date,
        priority,
        notes
      ]
    );

    res.status(201).json({ task: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not save task."
    });
  }
});

// PERSONAL TASKS: UPDATE
app.put("/api/tasks/:id", authenticate, async (req, res) => {
  try {
    const {
      title,
      subject = "",
      date,
      priority = "normal",
      notes = "",
      done = false
    } = req.body;

    const id = validId(req.params.id);

    if (
      !id ||
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 90 ||
      typeof subject !== "string" ||
      subject.length > 40 ||
      !validDate(date) ||
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
        title.trim(),
        subject,
        date,
        priority,
        notes,
        done,
        id,
        req.user.id
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Task not found."
      });
    }

    res.json({
      message: "Task updated successfully."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not update task."
    });
  }
});

// PERSONAL TASKS: DELETE
app.delete("/api/tasks/:id", authenticate, async (req, res) => {
  try {
    const id = validId(req.params.id);

    if (!id) {
      return res.status(400).json({
        error: "Invalid task ID."
      });
    }

    const result = await pool.query(
      "DELETE FROM tasks WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Task not found."
      });
    }

    res.json({
      message: "Task deleted successfully."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not delete task."
    });
  }
});

// ========================================
// TEACHER FEATURES
// ========================================

// CREATE CLASS
app.post(
  "/api/teacher/classes",
  authenticate,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const { class_name, subject = "" } = req.body;

      if (
        typeof class_name !== "string" ||
        !class_name.trim() ||
        class_name.length > 100 ||
        typeof subject !== "string" ||
        subject.length > 100
      ) {
        return res.status(400).json({
          error: "Invalid class details."
        });
      }

      const result = await pool.query(
        `INSERT INTO classes
         (teacher_id, class_name, subject)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.user.id, class_name.trim(), subject]
      );

      res.status(201).json({
        message: "Class created successfully.",
        class: result.rows[0]
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not create class."
      });
    }
  }
);

// GET TEACHER'S OWN CLASSES
app.get(
  "/api/teacher/classes",
  authenticate,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT c.id, c.class_name, c.subject, c.created_at,
                COUNT(DISTINCT cm.student_id)::int AS student_count
         FROM classes c
         LEFT JOIN class_members cm ON cm.class_id = c.id
         WHERE c.teacher_id = $1
         GROUP BY c.id
         ORDER BY c.created_at DESC`,
        [req.user.id]
      );

      res.json({ classes: result.rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not load classes."
      });
    }
  }
);

// ENROLL STUDENT BY USERNAME
app.post(
  "/api/teacher/classes/:id/students",
  authenticate,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const classId = validId(req.params.id);
      const { username } = req.body;

      if (
        !classId ||
        typeof username !== "string" ||
        !/^[a-zA-Z0-9_]{3,30}$/.test(username)
      ) {
        return res.status(400).json({
          error: "Enter a valid class ID and student username."
        });
      }

      const classResult = await pool.query(
        `SELECT id FROM classes
         WHERE id = $1 AND teacher_id = $2`,
        [classId, req.user.id]
      );

      if (!classResult.rowCount) {
        return res.status(404).json({
          error: "Class not found."
        });
      }

      const studentResult = await pool.query(
        `SELECT id, username
         FROM users
         WHERE username = $1 AND role = 'student'`,
        [username]
      );

      if (!studentResult.rowCount) {
        return res.status(404).json({
          error: "Student account not found."
        });
      }

      const student = studentResult.rows[0];

      const result = await pool.query(
        `INSERT INTO class_members (class_id, student_id)
         VALUES ($1, $2)
         ON CONFLICT (class_id, student_id) DO NOTHING
         RETURNING id`,
        [classId, student.id]
      );

      res.status(201).json({
        message: result.rowCount
          ? "Student enrolled successfully."
          : "Student is already enrolled.",
        student: {
          id: student.id,
          username: student.username
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not enroll student."
      });
    }
  }
);

// VIEW STUDENTS IN A TEACHER'S CLASS
app.get(
  "/api/teacher/classes/:id/students",
  authenticate,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const classId = validId(req.params.id);

      if (!classId) {
        return res.status(400).json({
          error: "Invalid class ID."
        });
      }

      const result = await pool.query(
        `SELECT u.id, u.username, cm.joined_at
         FROM class_members cm
         JOIN users u ON u.id = cm.student_id
         JOIN classes c ON c.id = cm.class_id
         WHERE cm.class_id = $1
           AND c.teacher_id = $2
         ORDER BY u.username`,
        [classId, req.user.id]
      );

      res.json({ students: result.rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not load students."
      });
    }
  }
);

// REMOVE STUDENT FROM A TEACHER'S CLASS
app.delete(
  "/api/teacher/classes/:id/students/:studentId",
  authenticate,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const classId = validId(req.params.id);
      const studentId = validId(req.params.studentId);

      if (!classId || !studentId) {
        return res.status(400).json({
          error: "Invalid ID."
        });
      }

      const result = await pool.query(
        `DELETE FROM class_members cm
         USING classes c
         WHERE cm.class_id = c.id
           AND cm.class_id = $1
           AND cm.student_id = $2
           AND c.teacher_id = $3
         RETURNING cm.id`,
        [classId, studentId, req.user.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Student enrollment not found."
        });
      }

      res.json({
        message: "Student removed from class."
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not remove student."
      });
    }
  }
);

// SEND ASSIGNMENT TO A CLASS
app.post(
  "/api/teacher/classes/:id/assignments",
  authenticate,
  requireRole("teacher"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const classId = validId(req.params.id);
      const {
        title,
        description = "",
        subject = "",
        due_date = null
      } = req.body;

      if (
        !classId ||
        typeof title !== "string" ||
        !title.trim() ||
        title.length > 200 ||
        typeof description !== "string" ||
        description.length > 2000 ||
        typeof subject !== "string" ||
        subject.length > 100 ||
        (due_date !== null && !validDate(due_date))
      ) {
        return res.status(400).json({
          error: "Invalid assignment details."
        });
      }

      const classResult = await client.query(
        `SELECT id FROM classes
         WHERE id = $1 AND teacher_id = $2`,
        [classId, req.user.id]
      );

      if (!classResult.rowCount) {
        return res.status(404).json({
          error: "Class not found."
        });
      }

      await client.query("BEGIN");

      const assignmentResult = await client.query(
        `INSERT INTO assignments
         (teacher_id, class_id, title, description, subject, due_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          req.user.id,
          classId,
          title.trim(),
          description,
          subject,
          due_date
        ]
      );

      const assignment = assignmentResult.rows[0];

      await client.query(
        `INSERT INTO assignment_submissions
         (assignment_id, student_id)
         SELECT $1, student_id
         FROM class_members
         WHERE class_id = $2
         ON CONFLICT (assignment_id, student_id) DO NOTHING`,
        [assignment.id, classId]
      );

      await client.query("COMMIT");

      res.status(201).json({
        message: "Assignment sent to the class.",
        assignment
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      res.status(500).json({
        error: "Could not create assignment."
      });
    } finally {
      client.release();
    }
  }
);

// VIEW ASSIGNMENT COMPLETION PROGRESS
app.get(
  "/api/teacher/assignments/:id/progress",
  authenticate,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const assignmentId = validId(req.params.id);

      if (!assignmentId) {
        return res.status(400).json({
          error: "Invalid assignment ID."
        });
      }

      const result = await pool.query(
        `SELECT
           a.id AS assignment_id,
           a.title,
           u.id AS student_id,
           u.username,
           COALESCE(s.completed, FALSE) AS completed,
           s.completed_at
         FROM assignments a
         JOIN classes c ON c.id = a.class_id
         JOIN class_members cm ON cm.class_id = c.id
         JOIN users u ON u.id = cm.student_id
         LEFT JOIN assignment_submissions s
           ON s.assignment_id = a.id
           AND s.student_id = u.id
         WHERE a.id = $1
           AND a.teacher_id = $2
         ORDER BY u.username`,
        [assignmentId, req.user.id]
      );

      if (!result.rowCount) {
        const check = await pool.query(
          `SELECT id FROM assignments
           WHERE id = $1 AND teacher_id = $2`,
          [assignmentId, req.user.id]
        );

        if (!check.rowCount) {
          return res.status(404).json({
            error: "Assignment not found."
          });
        }
      }

      res.json({ progress: result.rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not load assignment progress."
      });
    }
  }
);

// ========================================
// STUDENT FEATURES
// ========================================

// VIEW ASSIGNMENTS SENT TO THE LOGGED-IN STUDENT
app.get(
  "/api/student/assignments",
  authenticate,
  requireRole("student"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           a.id,
           a.title,
           a.description,
           a.subject,
           a.due_date,
           a.created_at,
           c.class_name,
           t.username AS teacher_username,
           COALESCE(s.completed, FALSE) AS completed,
           s.completed_at
         FROM assignment_submissions s
         JOIN assignments a ON a.id = s.assignment_id
         JOIN classes c ON c.id = a.class_id
         JOIN users t ON t.id = a.teacher_id
         WHERE s.student_id = $1
         ORDER BY a.due_date ASC NULLS LAST, a.id DESC`,
        [req.user.id]
      );

      res.json({ assignments: result.rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not load assignments."
      });
    }
  }
);

// MARK OWN ASSIGNMENT AS COMPLETE OR INCOMPLETE
app.patch(
  "/api/student/assignments/:id",
  authenticate,
  requireRole("student"),
  async (req, res) => {
    try {
      const assignmentId = validId(req.params.id);
      const { completed } = req.body;

      if (
        !assignmentId ||
        typeof completed !== "boolean"
      ) {
        return res.status(400).json({
          error: "Invalid assignment update."
        });
      }

      const result = await pool.query(
        `UPDATE assignment_submissions
         SET completed = $1,
             completed_at = CASE
               WHEN $1 = TRUE THEN CURRENT_TIMESTAMP
               ELSE NULL
             END
         WHERE assignment_id = $2
           AND student_id = $3
         RETURNING id, completed, completed_at`,
        [completed, assignmentId, req.user.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Assignment not found for your account."
        });
      }

      res.json({
        message: "Assignment status updated.",
        submission: result.rows[0]
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not update assignment."
      });
    }
  }
);

// ========================================
// PUSH NOTIFICATIONS
// ========================================

// GET PUBLIC PUSH KEY
app.get("/api/push/public-key", (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({
      error: "Push notifications are not configured."
    });
  }

  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

// SAVE PUSH SUBSCRIPTION
app.post(
  "/api/push/subscribe",
  authenticate,
  async (req, res) => {
    try {
      const subscription = req.body;

      if (
        !subscription ||
        typeof subscription.endpoint !== "string" ||
        !subscription.endpoint.startsWith("https://") ||
        typeof subscription.keys?.p256dh !== "string" ||
        typeof subscription.keys?.auth !== "string"
      ) {
        return res.status(400).json({
          error: "Invalid push subscription."
        });
      }

      await pool.query(
        `INSERT INTO push_subscriptions
         (user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth`,
        [
          req.user.id,
          subscription.endpoint,
          subscription.keys.p256dh,
          subscription.keys.auth
        ]
      );

      res.json({
        message: "Notifications enabled successfully."
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not save notification subscription."
      });
    }
  }
);

// REMOVE PUSH SUBSCRIPTION
app.post(
  "/api/push/unsubscribe",
  authenticate,
  async (req, res) => {
    try {
      const { endpoint } = req.body;

      if (typeof endpoint !== "string") {
        return res.status(400).json({
          error: "Invalid subscription endpoint."
        });
      }

      await pool.query(
        `DELETE FROM push_subscriptions
         WHERE endpoint = $1 AND user_id = $2`,
        [endpoint, req.user.id]
      );

      res.json({
        message: "Notifications disabled."
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not disable notifications."
      });
    }
  }
);

// SEND TEST NOTIFICATION
app.post(
  "/api/push/test",
  authenticate,
  async (req, res) => {
    try {
      if (!configurePush()) {
        return res.status(503).json({
          error: "Push notifications are not configured."
        });
      }

      const result = await pool.query(
        `SELECT endpoint, p256dh, auth
         FROM push_subscriptions
         WHERE user_id = $1`,
        [req.user.id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "No notification subscription found. Enable notifications first."
        });
      }

      const payload = JSON.stringify({
        title: "StudyFlow",
        body: "Your test notification is working!",
        url: "/"
      });

      const outcomes = await Promise.allSettled(
        result.rows.map(async (row) => {
          const subscription = {
            endpoint: row.endpoint,
            keys: {
              p256dh: row.p256dh,
              auth: row.auth
            }
          };

          try {
            await webPush.sendNotification(
              subscription,
              payload
            );
          } catch (error) {
            if (
              error.statusCode === 404 ||
              error.statusCode === 410
            ) {
              await pool.query(
                `DELETE FROM push_subscriptions
                 WHERE endpoint = $1 AND user_id = $2`,
                [row.endpoint, req.user.id]
              );
            }

            throw error;
          }
        })
      );

      const sent = outcomes.filter(
        item => item.status === "fulfilled"
      ).length;

      if (!sent) {
        return res.status(502).json({
          error: "The test notification could not be delivered."
        });
      }

      res.json({
        message: "Test notification sent.",
        sent
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Could not send test notification."
      });
    }
  }
);

// HOME
app.get("/", (req, res) => {
  res.json({
    message: "StudyFlow API is running!"
  });
});

// HEALTH
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT NOW()");

    res.json({
      status: "connected",
      database: "StudyFlow PostgreSQL"
    });
  } catch (error) {
    res.status(500).json({
      status: "database connection failed"
    });
  }
});

// START SERVER
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
