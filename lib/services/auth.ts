/**
 * Service: การเข้าสู่ระบบ
 *
 * ★★ นี่เป็น UI อย่างเดียว ไม่ใช่ระบบยืนยันตัวตนจริง ★★
 *
 * ไม่มีการตรวจรหัสผ่าน ไม่มีการเก็บรหัสผ่าน และไม่มีการเข้ารหัสอะไรทั้งนั้น
 * มีไว้เพื่อให้เห็นโครงหน้าจอและผูกกับ UserRole ที่ระบบใช้อยู่เท่านั้น
 *
 * เมื่อต่อหลังบ้านจริงต้องเปลี่ยนทั้งหมดนี้:
 *   - ตรวจรหัสผ่านที่เซิร์ฟเวอร์ ไม่ใช่ที่หน้าจอ
 *   - ออก token จากเซิร์ฟเวอร์แล้วเก็บใน httpOnly cookie ห้ามเก็บใน localStorage
 *   - ต่ออายุเซสชันที่เซิร์ฟเวอร์ ไม่ใช่ให้หน้าจอคำนวณวันหมดอายุเอง
 */

import type { AuthSession, SignInResult } from '@/lib/types';
import { USERS } from '@/lib/mock';
import { respond } from './internal';

const SESSION_KEY = 'wcm.session';

function readSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const session = JSON.parse(raw) as AuthSession;
    // เซสชันหมดอายุแล้วถือว่าไม่มี ไม่ต้องรอให้ผู้ใช้กดอะไรก่อน
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function writeSession(session: AuthSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (session === null) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // storage ถูกปิด — ล็อกอินได้ในหน้าปัจจุบันแต่จะไม่ถูกจำข้ามการโหลดหน้า
  }
}

/**
 * เซสชันปัจจุบัน — null เมื่อยังไม่ล็อกอินหรือหมดอายุแล้ว
 * TODO(backend): GET /api/auth/session
 */
export async function getSession(): Promise<AuthSession | null> {
  return respond(() => readSession());
}

/**
 * บัญชีเดียวสำหรับสาธิต
 *
 * ★★ นี่ไม่ใช่การยืนยันตัวตนจริง ★★
 *   รหัสผ่านถูกเทียบที่ฝั่งหน้าจอและเขียนไว้ตรง ๆ ในโค้ด ใครเปิด bundle ก็เห็น
 *   มีไว้เพื่อให้หน้าจอสาธิตมีขั้นตอนล็อกอินที่ทำงานได้เท่านั้น
 *   ตอนต่อ backend จริงต้องลบทั้งบล็อกนี้ แล้วให้เซิร์ฟเวอร์เป็นคนตรวจ (ดู HANDOFF.md ข้อ 2.2)
 */
const DEMO_USERNAME = 'admin';
const DEMO_PASSWORD = 'admin1234';
/** ผู้ใช้ใน mock ที่ผูกกับบัญชีสาธิตข้างบน */
const DEMO_USER_ID = 'user-admin';

/**
 * เข้าสู่ระบบ
 *
 * ★ รับได้บัญชีเดียวคือบัญชีสาธิตข้างบน — ดูคำเตือนตรงนั้นประกอบ
 *
 * TODO(backend): POST /api/auth/login  body: { username, password }
 *   ตอบกลับเป็น httpOnly cookie พร้อม session ที่เซิร์ฟเวอร์เป็นคนกำหนดวันหมดอายุ
 */
export async function signIn(username: string, password: string): Promise<SignInResult> {
  return respond((state) => {
    const trimmed = username.trim().toLowerCase();

    if (trimmed === '') {
      return {
        ok: false,
        session: null,
        errorTh: 'กรุณากรอกชื่อผู้ใช้',
        errorEn: 'Enter a username',
      };
    }
    if (password === '') {
      return {
        ok: false,
        session: null,
        errorTh: 'กรุณากรอกรหัสผ่าน',
        errorEn: 'Enter a password',
      };
    }

    // ตอบข้อความเดียวกันทั้งกรณีชื่อผู้ใช้ผิดและรหัสผ่านผิด จะได้ไม่บอกใบ้ว่าชื่อไหนมีอยู่จริง
    if (trimmed !== DEMO_USERNAME || password !== DEMO_PASSWORD) {
      return {
        ok: false,
        session: null,
        errorTh: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
        errorEn: 'Incorrect username or password',
      };
    }

    const user = USERS.find((item) => item.id === DEMO_USER_ID);
    if (user === undefined || !user.active) {
      return {
        ok: false,
        session: null,
        errorTh: 'บัญชีนี้ถูกปิดการใช้งาน ติดต่อผู้ดูแลระบบ',
        errorEn: 'This account is disabled — contact an administrator',
      };
    }

    const now = Date.now();
    const session: AuthSession = {
      user,
      signedInAt: new Date(now).toISOString(),
      expiresAt: new Date(now + state.settings.security.sessionTimeoutMinutes * 60_000).toISOString(),
    };
    writeSession(session);
    return { ok: true, session, errorTh: null, errorEn: null };
  });
}

/**
 * ออกจากระบบ
 * TODO(backend): POST /api/auth/logout  (ให้เซิร์ฟเวอร์ล้าง cookie)
 */
export async function signOut(): Promise<void> {
  writeSession(null);
}

/**
 * ต่ออายุเซสชันเมื่อผู้ใช้ยังทำงานอยู่
 * TODO(backend): POST /api/auth/refresh
 *   ★ ของจริงต้องให้เซิร์ฟเวอร์ตัดสินว่าต่ออายุได้ไหม ไม่ใช่ให้หน้าจอยืดเอง
 */
export async function refreshSession(): Promise<AuthSession | null> {
  return respond((state) => {
    const session = readSession();
    if (session === null) return null;
    const next: AuthSession = {
      ...session,
      expiresAt: new Date(Date.now() + state.settings.security.sessionTimeoutMinutes * 60_000).toISOString(),
    };
    writeSession(next);
    return next;
  });
}

