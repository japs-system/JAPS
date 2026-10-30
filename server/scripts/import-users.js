// Imports the users listed in users-import.json into the database.
//
//   cd ~/japs/server            (the folder that holds .env)
//   node scripts/import-users.js --dry-run     # checks only, changes nothing
//   node scripts/import-users.js               # inserts the users
//
// Passwords are hashed with bcrypt (cost 12), exactly like the Add User form does.
// Nobody is emailed. Anyone already in the database (same employee ID, username or
// email) is skipped, so running it twice is safe. All inserts happen in ONE
// transaction: if anything fails, nothing is saved.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const { sequelize, User } = require("../models");

const dryRun = process.argv.includes("--dry-run");
const file = path.join(__dirname, "users-import.json");

(async () => {
  const records = JSON.parse(fs.readFileSync(file, "utf8"));
  await sequelize.authenticate();

  const toInsert = [];
  const skipped = [];
  for (const r of records) {
    const existing = await User.findOne({
      where: {
        [Op.or]: [{ employee_id: r.employee_id }, { username: r.username }, { email: r.email }],
      },
    });
    if (existing) skipped.push(`${r.employee_id} ${r.username} (already exists as ${existing.username})`);
    else toInsert.push(r);
  }

  console.log(`${records.length} in file: ${toInsert.length} to insert, ${skipped.length} skipped.`);
  skipped.forEach((s) => console.log("  skipped:", s));
  if (dryRun) {
    console.log("Dry run only - nothing was saved.");
    await sequelize.close();
    return;
  }

  const t = await sequelize.transaction();
  try {
    for (const r of toInsert) {
      // People without a login get a random password nobody knows (they cannot sign in).
      const plain = r.password ?? crypto.randomBytes(24).toString("base64url");
      await User.create(
        {
          employee_id: r.employee_id,
          username: r.username,
          password: await bcrypt.hash(plain, 12),
          role: r.role,
          first_name: r.first_name,
          middle_name: r.middle_name,
          last_name: r.last_name,
          suffix: r.suffix,
          email: r.email,
          contact_number: r.contact_number,
          is_active: r.is_active,
        },
        { transaction: t },
      );
    }
    await t.commit();
    console.log(`Done. Inserted ${toInsert.length} users.`);
  } catch (err) {
    await t.rollback();
    console.error("Failed - nothing was saved:", err.message);
    process.exitCode = 1;
  }
  await sequelize.close();
})();