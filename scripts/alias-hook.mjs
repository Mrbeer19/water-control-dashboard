/**
 * ให้ Node รู้จัก path alias "@/..." เหมือนที่ tsconfig ตั้งไว้
 * ★ ใช้เฉพาะตอนรัน script ตรวจสอบด้วย Node ล้วน — ไม่กระทบ build ของ Next
 *   ทำแบบนี้เพื่อจะได้ไม่ต้องเพิ่ม test runner หรือ dependency ใด ๆ
 */
import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const target = join(ROOT, specifier.slice(2));
      // เติมนามสกุลให้เหมือนที่ TypeScript ทำ — ต้องเช็คว่าไฟล์มีอยู่จริงก่อน
      for (const candidate of [`${target}.ts`, `${target}.tsx`, join(target, 'index.ts'), target]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
