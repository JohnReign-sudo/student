
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : false
});

async function initializeDatabase() {
  // User accounts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add roles without deleting existing accounts.
  // Existing accounts become students by default.
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student';
  `);

  // Existing personal tasks
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      due_date TEXT,
      completed BOOLEAN DEFAULT FALSE,
      subject TEXT DEFAULT '',
      priority TEXT DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
  `);

  // Push notification subscriptions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Classes owned by teachers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY,
      teacher_id INTEGER NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
      class_name VARCHAR(100) NOT NULL,
      subject VARCHAR(100) DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Students enrolled in classes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS class_members (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id)
        ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (class_id, student_id)
    );
  `);

  // Teacher-created assignments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      teacher_id INTEGER NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id)
        ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      due_date TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Student completion tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id SERIAL PRIMARY KEY,
      assignment_id INTEGER NOT NULL REFERENCES assignments(id)
        ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
      completed BOOLEAN DEFAULT FALSE,
      completed_at TIMESTAMP,
      UNIQUE (assignment_id, student_id)
    );
  `);

  // Helpful indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_classes_teacher
    ON classes(teacher_id);

    CREATE INDEX IF NOT EXISTS idx_class_members_student
    ON class_members(student_id);

    CREATE INDEX IF NOT EXISTS idx_assignments_teacher
    ON assignments(teacher_id);

    CREATE INDEX IF NOT EXISTS idx_assignments_class
    ON assignments(class_id);

    CREATE INDEX IF NOT EXISTS idx_submissions_student
    ON assignment_submissions(student_id);
  `);

  console.log("StudyFlow database tables are ready.");
}

module.exports = { pool, initializeDatabase };
