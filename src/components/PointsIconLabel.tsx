import Image from 'next/image';

type PointsIconLabelProps = {
  points: number;
  className?: string;
  iconClassName?: string;
};

export default function PointsIconLabel({ points, className = '', iconClassName = 'h-3.5 w-3.5' }: PointsIconLabelProps) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${className}`}>
      <span>{points}</span>
      <Image src="/points-icon.png" alt="" aria-hidden="true" width={14} height={14} className={iconClassName} />
      <span className="sr-only">积分</span>
    </span>
  );
}
