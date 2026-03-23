import 'dotenv/config';
import db from '../config/knex';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function createAdmin() {
  const phone = '08123456789';
  const name = 'Super Admin AgriHub';
  const password = 'adminagrihub123';
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const existing = await db('users').where({ role: 'admin' }).first();
    if (existing) {
      console.log('✅ Admin account already exists:', existing.phone);
      process.exit(0);
    }

    const id = uuidv4();
    await db('users').insert({
      id,
      phone,
      name,
      password_hash: passwordHash,
      role: 'admin',
      is_verified: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    console.log('🚀 Superadmin created successfully!');
    console.log('📱 Phone:', phone);
    console.log('🔑 Password:', password);
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to create admin:', err);
    process.exit(1);
  }
}

createAdmin();
