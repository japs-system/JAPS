export type BusStatus = 'active' | 'inactive' | 'under_maintenance';

export interface Bus {
  id: number;
  bus_number: string;
  plate_number: string;
  capacity: number;
  status: BusStatus;
  created_at?: string;
  updated_at?: string;
}
