import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../../config/knex';

export async function seed(): Promise<void> {
  const phone = '085188000139';
  const name = 'Super Admin AgriHub';
  const password = 'adminagrihub123';
  const passwordHash = await bcrypt.hash(password, 10);

  // Check if admin already exists
  const existing = await db('users').where({ phone }).first();
  
  if (existing) {
    await db('users').where({ phone }).update({
      role: 'admin',
      is_verified: true,
      updated_at: new Date().toISOString(),
    });
    console.log('✅ Admin account updated:', phone);
  } else {
    await db('users').insert({
      id: uuidv4(),
      phone,
      name,
      password_hash: passwordHash,
      role: 'admin',
      is_verified: true,
      is_lid_linked: false, // Default
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    console.log('🚀 Local Superadmin created!');
    console.log('📱 Phone:', phone);
    console.log('🔑 Password:', password);
  }
}
