import type { ReactNode } from 'react';
import { Bike, Mountain, TreePine } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { RIDER_DESCRIPTIONS, RIDER_LABELS, type RiderType } from '@/types';

const RIDER_ORDER: readonly RiderType[] = ['street', 'offroad', 'allroad'];

const RIDER_ICONS: Record<RiderType, ReactNode> = {
  street: <Bike size={24} aria-hidden />,
  offroad: <Mountain size={24} aria-hidden />,
  allroad: <TreePine size={24} aria-hidden />,
};

export interface RiderTypeCardsProps {
  value: RiderType;
  onChange: (riderType: RiderType) => void;
}

/** Keuze van het rijderstype als grote kaarten met icoon en beschrijving. */
export function RiderTypeCards({ value, onChange }: RiderTypeCardsProps) {
  return (
    <Segmented<RiderType>
      layout="cards"
      ariaLabel="Rijderstype"
      value={value}
      onChange={onChange}
      options={RIDER_ORDER.map((type) => ({
        value: type,
        label: RIDER_LABELS[type],
        description: RIDER_DESCRIPTIONS[type],
        icon: RIDER_ICONS[type],
      }))}
    />
  );
}
