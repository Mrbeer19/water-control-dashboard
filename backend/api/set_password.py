"""ตั้งรหัสผ่านหรือ PIN สั่งงานของผู้ใช้ — make password NAME=admin [PIN=1]  (รันใน container api)

★ seed ไม่มีรหัสผ่านและ PIN ตั้งต้นโดยตั้งใจ ต้องตั้งด้วยคำสั่งนี้หลังติดตั้ง
★ ตั้งรหัสผ่านใหม่ = เซสชันเดิมถูกยกเลิก · ตั้ง PIN ใหม่ = ต้องใส่ PIN ใหม่ก่อนสั่งงานทุกเซสชัน

    python -m api.set_password admin                  ถามรหัสผ่านสองรอบแบบไม่แสดงบนจอ
    python -m api.set_password somchai --pin          ตั้ง PIN 4 หลักสำหรับหน้า Control
    python -m api.set_password admin --stdin          อ่านค่าจากบรรทัดแรกของ stdin (ใช้ในสคริปต์/เทส)
"""

from __future__ import annotations

import argparse
import re
import sys
from getpass import getpass

import psycopg

from .auth import MIN_PASSWORD_LENGTH, hash_password
from .db import conninfo

PIN = re.compile(r"\d{4}")      # ตรงกับ PinGate ของหน้าจอ


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ตั้งรหัสผ่านหรือ PIN ของผู้ใช้ (เก็บเป็น argon2 hash)")
    parser.add_argument("username")
    parser.add_argument("--pin", action="store_true", help="ตั้ง PIN 4 หลักสำหรับสั่งงาน แทนรหัสผ่าน")
    parser.add_argument("--stdin", action="store_true", help="อ่านค่าจากบรรทัดแรกของ stdin")
    args = parser.parse_args(argv)
    label = "PIN" if args.pin else "รหัสผ่าน"

    if args.stdin:
        secret = sys.stdin.readline().rstrip("\r\n")
    else:
        secret = getpass(f"{label}ใหม่: ")
        if getpass("พิมพ์ซ้ำอีกครั้ง: ") != secret:
            print(f"{label}สองครั้งไม่ตรงกัน", file=sys.stderr)
            return 1
    if args.pin and PIN.fullmatch(secret) is None:
        print("PIN ต้องเป็นตัวเลข 4 หลัก", file=sys.stderr)
        return 1
    if not args.pin and len(secret) < MIN_PASSWORD_LENGTH:
        print(f"รหัสผ่านต้องยาวอย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร", file=sys.stderr)
        return 1

    column = "pin_hash" if args.pin else "password_hash"
    with psycopg.connect(conninfo("set_password"), autocommit=True) as conn, conn.transaction():
        row = conn.execute(f"UPDATE users SET {column} = %s WHERE lower(username) = lower(%s) RETURNING user_id",
                           (hash_password(secret), args.username)).fetchone()
        if row is None:
            print(f"ไม่พบผู้ใช้ {args.username}", file=sys.stderr)
            return 1
        if args.pin:
            conn.execute("UPDATE sessions SET control_unlocked_until = NULL WHERE user_id = %s", (row[0],))
        else:
            conn.execute("UPDATE sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL", (row[0],))
        conn.execute("INSERT INTO audit_log (user_id, action, target, result) VALUES (NULL, %s, %s, 'ok')",
                     ("pin_set" if args.pin else "password_set", row[0]))
    print(f"ตั้ง{label}ของ {args.username} แล้ว")
    return 0


if __name__ == "__main__":
    sys.exit(main())
