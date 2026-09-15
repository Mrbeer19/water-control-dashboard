"""error มาตรฐาน — รูปเดียวกับ ApiError ใน lib/types.ts ทุก endpoint

{ code, messageTh, messageEn, details, traceId }
หน้าบ้านแสดง messageTh/messageEn ตามภาษา และใช้ code ตัดสินใจเชิงตรรกะ
"""

from __future__ import annotations

Detail = str | int | float | bool | None


class ApiException(Exception):
    def __init__(self, status: int, code: str, message_th: str, message_en: str,
                 details: dict[str, Detail] | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message_th = message_th
        self.message_en = message_en
        self.details = details

    def body(self, trace_id: str | None) -> dict[str, object]:
        return {"code": self.code, "messageTh": self.message_th, "messageEn": self.message_en,
                "details": self.details, "traceId": trace_id}


def bad_request(code: str, message_th: str, message_en: str, **details: Detail) -> ApiException:
    return ApiException(400, code, message_th, message_en, details or None)


def not_found(code: str, message_th: str, message_en: str, **details: Detail) -> ApiException:
    return ApiException(404, code, message_th, message_en, details or None)
