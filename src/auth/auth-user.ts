import { Role } from '@prisma/client';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  telegram: string | null;
};
