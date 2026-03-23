import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../config/knex';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    phone: string;
    name: string;
    role: string;
  };
  file?: Express.Multer.File;
}

/**
 * Verifikasi JWT token dari header Authorization: Bearer <token>
 */
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Token tidak ada' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'default_secret';
    const decoded = jwt.verify(token, secret) as { id: string };

    const user = await db('users').where({ id: decoded.id }).first();
    if (!user) {
      res.status(401).json({ success: false, error: 'User tidak ditemukan' });
      return;
    }

    req.user = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role,
    };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Token tidak valid' });
  }
}

/**
 * Cek apakah user adalah admin
 */
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Akses admin diperlukan' });
    return;
  }
  next();
}
