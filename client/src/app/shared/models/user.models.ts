import { UserRole } from '../constants/user-options';

export interface User {
  id: number;
  employee_id: string;
  username: string;
  role: Exclude<UserRole, 'owner'>;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  email: string;
  contact_number: string | null;
  is_active: boolean;
}
