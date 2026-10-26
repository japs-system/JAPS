import { UserRole } from '../constants/user-options';

export interface AuthUser {
  id: number;
  employee_id: string;
  username: string;
  role: UserRole;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  email: string;
  contact_number: string | null;
}

export interface LoginResponse {
  redirectUrl: string;
}
