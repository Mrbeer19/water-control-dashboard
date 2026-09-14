"""ตั้งรหัสผ่านผู้ใช้ — make password NAME=admin  (รันใน container api)

★ seed ไม่มีรหัสผ่านตั้งต้นโดยตั้งใจ ต้องตั้งด้วยคำสั่งนี้หลังติดตั้ง
★ ตั้งรหัสใหม่แล้วเซสชันเดิมของผู้ใช้นั้นถูกยกเลิกทั้งหมด

    python -m api.set_password admin            ถามรหัสสองรอบแบบไม่แสดงบนจอ
    python -m api.set_password admin --stdin    อ่านรหัสจากบรรทัดแรกของ stdin (ใช้ในสคริปต์/เทส)
"""

from __future__ import annotations

import argparse
import sys
from getpass import getpass

import psycopg

from .auth import MIN_PASSWORD_LENGTH, hash_password
from .db import conninfo


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ตั้งรหัสผ่านผู้ใช้ (เก็บเป็น argon2 hash)")
    parser.add_argument("username")
    parser.add_argument("--stdin", action="store_true", help="อ่านรหัสผ่านจากบรรทัดแรกของ stdin")
    args = parser.parse_args(argv)

    if args.stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass("รหัสผ่านใหม่: ")
        if getpass("พิมพ์ซ้ำอีกครั้ง: ") != password:
            print("รหัสผ่านสองครั้งไม่ตรงกัน", file=sys.stderr)
            return 1
    if len(password) < MIN_PASSWORD_LENGTH:
        print(f"รหัสผ่านต้องยาวอย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร", file=sys.stderr)
        return 1

    with psycopg.connect(conninfo("set_password"), autocommit=True) as conn, conn.transaction():
        row = conn.execute("UPDATE users SET password_hash = %s WHERE lower(username) = lower(%s) RETURNING user_id",
                           (hash_password(password), args.username)).fetchone()
        if row is None:
            print(f"ไม่พบผู้ใช้ {args.username}", file=sys.stderr)
            return 1
        conn.execute("UPDATE sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL", (row[0],))
        conn.execute("INSERT INTO audit_log (user_id, action, target, result) VALUES (NULL, 'password_set', %s, 'ok')",
                     (row[0],))
    print(f"ตั้งรหัสผ่านของ {args.username} แล้ว (เซสชันเดิมถูกยกเลิก)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
