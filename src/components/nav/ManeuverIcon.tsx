import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Merge,
  Play,
  RefreshCw,
  RotateCcw,
  Ship,
  type LucideIcon,
} from 'lucide-react';
import type { ManeuverIconName } from '@/lib/navigation';

const ICONS: Record<ManeuverIconName, LucideIcon> = {
  start: Play,
  straight: ArrowUp,
  'slight-right': ArrowUpRight,
  right: CornerUpRight,
  'sharp-right': CornerUpRight,
  uturn: RotateCcw,
  'slight-left': ArrowUpLeft,
  left: CornerUpLeft,
  'sharp-left': CornerUpLeft,
  'ramp-right': ArrowUpRight,
  'ramp-left': ArrowUpLeft,
  'exit-right': ArrowUpRight,
  'exit-left': ArrowUpLeft,
  merge: Merge,
  roundabout: RefreshCw,
  ferry: Ship,
  arrive: Flag,
};

/** Scherpe bochten: de hoekpijl doordraaien zodat hij "terug" wijst. */
const ROTATION: Partial<Record<ManeuverIconName, string>> = {
  'sharp-right': 'rotate-45',
  'sharp-left': '-rotate-45',
};

export interface ManeuverIconProps {
  name: ManeuverIconName;
  size?: number;
  className?: string;
}

/** Groot, dik getekend manoeuvre-icoon (lucide) voor de navigatiebanner. */
export function ManeuverIcon({ name, size = 48, className = '' }: ManeuverIconProps) {
  const Icon = ICONS[name];
  return <Icon size={size} strokeWidth={2.5} className={`${ROTATION[name] ?? ''} ${className}`.trim()} aria-hidden />;
}
