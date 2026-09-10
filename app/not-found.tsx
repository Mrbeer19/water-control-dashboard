import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound(): JSX.Element {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <p className="text-metric-lg tabular text-muted-foreground">404</p>
      <p className="text-sm text-muted-foreground">ไม่พบหน้าที่ต้องการ / Page not found</p>
      <Button asChild>
        <Link href="/">กลับหน้าภาพรวม</Link>
      </Button>
    </div>
  );
}
