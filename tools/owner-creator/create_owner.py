"""Tkinter tool for creating a JAPS owner account.

The API deliberately has no endpoint for creating an "owner" (see
server/controllers/userController.js — ALLOWED_ROLES excludes it), since owner is
the top of the role hierarchy. This tool writes directly to the database instead,
gated behind OWNER_CREATION_SECRET (set in server/.env) so an owner account can't
be minted by anyone who merely has DB credentials without also knowing that secret.
"""

import os
import re
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk

import bcrypt
import psycopg2
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parents[2] / "server" / ".env"
load_dotenv(ENV_PATH)

OWNER_CREATION_SECRET = os.environ.get("OWNER_CREATION_SECRET", "")
SUFFIXES = ["", "Jr.", "Sr.", "I", "II", "III", "IV", "V"]

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def get_connection():
    return psycopg2.connect(
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ.get("DB_HOST", "localhost"),
        port=os.environ.get("DB_PORT", "5432"),
    )


class OwnerCreatorApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("JAPS — Create Owner Account")
        self.resizable(False, False)
        self.configure(padx=24, pady=20)

        self.fields: dict[str, tk.Variable] = {}
        self._build_form()

    def _build_form(self):
        row = 0

        def add_entry(label, key, show=None, required=True):
            nonlocal row
            ttk.Label(self, text=label + (" *" if required else "")).grid(
                row=row, column=0, sticky="w", pady=4
            )
            var = tk.StringVar()
            entry = ttk.Entry(self, textvariable=var, width=34, show=show or "")
            entry.grid(row=row, column=1, pady=4, padx=(10, 0))
            self.fields[key] = var
            row += 1
            return entry

        ttk.Label(self, text="New Owner Account", font=("Segoe UI", 12, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )
        row += 1

        add_entry("Employee ID", "employee_id")
        add_entry("Username", "username")
        add_entry("Password", "password", show="*")
        add_entry("First Name", "first_name")
        add_entry("Middle Name", "middle_name", required=False)
        add_entry("Last Name", "last_name")

        ttk.Label(self, text="Suffix").grid(row=row, column=0, sticky="w", pady=4)
        suffix_var = tk.StringVar(value="")
        ttk.Combobox(
            self, textvariable=suffix_var, values=SUFFIXES, width=31, state="readonly"
        ).grid(row=row, column=1, pady=4, padx=(10, 0))
        self.fields["suffix"] = suffix_var
        row += 1

        add_entry("Email", "email")
        add_entry("Contact Number", "contact_number", required=False)

        ttk.Separator(self, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", pady=10
        )
        row += 1

        ttk.Label(
            self, text="Special Secret Password *", font=("Segoe UI", 9, "bold")
        ).grid(row=row, column=0, sticky="w", pady=4)
        secret_var = tk.StringVar()
        ttk.Entry(self, textvariable=secret_var, width=34, show="*").grid(
            row=row, column=1, pady=4, padx=(10, 0)
        )
        self.fields["secret"] = secret_var
        row += 1

        ttk.Label(
            self,
            text="Required to confirm this is a real, authorized transaction.",
            foreground="#666666",
            font=("Segoe UI", 8),
            wraplength=320,
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=(0, 10))
        row += 1

        ttk.Button(self, text="Create Owner Account", command=self.on_submit).grid(
            row=row, column=0, columnspan=2, pady=(10, 0), sticky="ew"
        )

    def on_submit(self):
        values = {k: v.get().strip() for k, v in self.fields.items()}

        if not OWNER_CREATION_SECRET or OWNER_CREATION_SECRET == "change-me-to-a-strong-secret":
            messagebox.showerror(
                "Not Configured",
                "OWNER_CREATION_SECRET is not set (or still the placeholder) in server/.env. "
                "Set a real secret there before using this tool.",
            )
            return

        if values["secret"] != OWNER_CREATION_SECRET:
            messagebox.showerror("Invalid Secret", "The special secret password is incorrect.")
            return

        required = ["employee_id", "username", "password", "first_name", "last_name", "email"]
        missing = [f for f in required if not values[f]]
        if missing:
            messagebox.showerror("Missing Fields", f"Please fill in: {', '.join(missing)}")
            return

        if not EMAIL_RE.match(values["email"]):
            messagebox.showerror("Invalid Email", "Please enter a valid email address.")
            return

        if len(values["password"]) < 6:
            messagebox.showerror("Weak Password", "Password must be at least 6 characters.")
            return

        if not messagebox.askyesno(
            "Confirm",
            f"Create owner account '{values['username']}' ({values['email']})?\n\n"
            "This account will have full administrative access.",
        ):
            return

        try:
            self._create_owner(values)
        except psycopg2.errors.UniqueViolation as err:
            messagebox.showerror(
                "Duplicate",
                "An account with that employee ID, username, or email already exists.",
            )
        except Exception as err:  # noqa: BLE001 — surface any DB/connection error to the user
            messagebox.showerror("Error", f"Failed to create owner account:\n{err}")
        else:
            messagebox.showinfo("Success", f"Owner account '{values['username']}' created.")
            for var in self.fields.values():
                var.set("")

    def _create_owner(self, values: dict):
        hashed = bcrypt.hashpw(values["password"].encode("utf-8"), bcrypt.gensalt(rounds=12))

        conn = get_connection()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (
                        employee_id, username, password, role,
                        first_name, middle_name, last_name, suffix,
                        email, contact_number, is_active,
                        created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, 'owner',
                        %s, %s, %s, %s,
                        %s, %s, true,
                        NOW(), NOW()
                    )
                    """,
                    (
                        values["employee_id"],
                        values["username"],
                        hashed.decode("utf-8"),
                        values["first_name"],
                        values["middle_name"] or None,
                        values["last_name"],
                        values["suffix"] or None,
                        values["email"],
                        values["contact_number"] or None,
                    ),
                )
        finally:
            conn.close()


if __name__ == "__main__":
    app = OwnerCreatorApp()
    app.mainloop()
