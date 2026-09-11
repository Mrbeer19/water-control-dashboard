import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BrandMascot } from '@/components/layout/brand-mascot';

export default function NotFound(): JSX.Element {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      {/* หน้า 404 เป็นพื้นที่ chrome ไม่ใช่พื้นที่ข้อมูล จึงวางมาสคอตได้ */}
      <BrandMascot height={104} tone="on-surface" withDrops={false} />
      <p className="text-metric-lg tabular text-muted-foreground">404</p>
      <p className="text-sm text-muted-foreground">ไม่พบหน้าที่ต้องการ / Page not found</p>
      <Button asChild>
        <Link href="/">กลับหน้าภาพรวม</Link>
      </Button>
    </div>
  );
}
