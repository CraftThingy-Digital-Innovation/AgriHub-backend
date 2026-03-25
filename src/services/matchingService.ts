import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';

export interface SupplyData {
  komoditas: string;
  jumlah_kg: number;
  harga_per_kg: number;
  kabupaten: string;
  provinsi: string;
  tanggal_tersedia?: string;
}

export interface DemandData {
  komoditas: string;
  jumlah_kg: number;
  harga_max_per_kg: number;
  kabupaten: string;
  deadline?: string;
}

export async function reportSupply(userId: string, data: SupplyData) {
  const id = uuidv4();
  const now = new Date().toISOString();
  
  await db('supply_reports').insert({
    id,
    reporter_id: userId,
    komoditas: data.komoditas,
    jumlah_kg: data.jumlah_kg,
    harga_per_kg: data.harga_per_kg,
    kabupaten: data.kabupaten,
    provinsi: data.provinsi || '',
    tanggal_tersedia: data.tanggal_tersedia || now.split('T')[0],
    is_active: true,
    created_at: now,
    updated_at: now,
  });

  const matches = await runMatchingFor(id, 'supply');
  return { id, matchesFound: matches.length };
}

export async function reportDemand(userId: string, data: DemandData) {
  const id = uuidv4();
  const now = new Date().toISOString();

  await db('demand_requests').insert({
    id,
    requester_id: userId,
    komoditas: data.komoditas,
    jumlah_kg: data.jumlah_kg,
    harga_max_per_kg: data.harga_max_per_kg,
    kota_tujuan: data.kabupaten, // Mapping kabupaten to kota_tujuan based on schema
    deadline: data.deadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    is_active: true,
    created_at: now,
    updated_at: now,
  });

  const matches = await runMatchingFor(id, 'demand');
  return { id, matchesFound: matches.length };
}

export async function getMatchesForUser(userId: string) {
  // Fetch matches where the user is either the supplier or the requester
  const matches = await db('match_history')
    .join('supply_reports', 'match_history.supply_id', 'supply_reports.id')
    .join('demand_requests', 'match_history.demand_id', 'demand_requests.id')
    .where('supply_reports.reporter_id', userId)
    .orWhere('demand_requests.requester_id', userId)
    .select(
      'match_history.*',
      'supply_reports.komoditas',
      'supply_reports.jumlah_kg as supply_qty',
      'supply_reports.harga_per_kg as supply_price',
      'supply_reports.kabupaten as supply_loc',
      'demand_requests.jumlah_kg as demand_qty',
      'demand_requests.harga_max_per_kg as demand_price',
      'demand_requests.kota_tujuan as demand_loc'
    )
    .orderBy('match_history.created_at', 'desc')
    .limit(10);

  return matches;
}

async function runMatchingFor(reportId: string, type: 'supply' | 'demand') {
  const matches: any[] = [];
  
  if (type === 'supply') {
    const supply = await db('supply_reports').where({ id: reportId }).first();
    if (!supply) return matches;

    const demands = await db('demand_requests')
      .join('users', 'demand_requests.requester_id', 'users.id')
      .where({ komoditas: supply.komoditas, 'demand_requests.is_active': true })
      .where('harga_max_per_kg', '>=', supply.harga_per_kg)
      .select('demand_requests.*', 'users.phone', 'users.whatsapp_lid', 'users.name as requester_name');

    for (const demand of demands) {
      const score = calculateMatchScore(supply, demand);
      if (score >= 60) {
        const matchId = uuidv4();
        await db('match_history').insert({
          id: matchId,
          supply_id: supply.id,
          demand_id: demand.id,
          score: score,
          distance_km: 0,
          price_diff_pct: ((demand.harga_max_per_kg - supply.harga_per_kg) / demand.harga_max_per_kg) * 100,
          created_at: new Date().toISOString(),
        });
        
        matches.push({ 
          id: matchId, 
          score,
          matched_user_id: demand.requester_id,
          matched_user_name: demand.requester_name,
          matched_phone: demand.phone,
          matched_lid: demand.whatsapp_lid,
          demand_id: demand.id,
          komoditas: supply.komoditas,
          price: demand.harga_max_per_kg,
          qty: demand.jumlah_kg,
          location: demand.kota_tujuan
        });
      }
    }
  } else {
    const demand = await db('demand_requests').where({ id: reportId }).first();
    if (!demand) return matches;

    const supplies = await db('supply_reports')
      .join('users', 'supply_reports.reporter_id', 'users.id')
      .where({ komoditas: demand.komoditas, 'supply_reports.is_active': true })
      .where('harga_per_kg', '<=', demand.harga_max_per_kg)
      .select('supply_reports.*', 'users.phone', 'users.whatsapp_lid', 'users.name as reporter_name');

    for (const supply of supplies) {
      const score = calculateMatchScore(supply, demand);
      if (score >= 60) {
        const matchId = uuidv4();
        await db('match_history').insert({
          id: matchId,
          supply_id: supply.id,
          demand_id: demand.id,
          score: score,
          distance_km: 0,
          price_diff_pct: ((demand.harga_max_per_kg - supply.harga_per_kg) / demand.harga_max_per_kg) * 100,
          created_at: new Date().toISOString(),
        });
        
        matches.push({ 
          id: matchId, 
          score,
          matched_user_id: supply.reporter_id,
          matched_user_name: supply.reporter_name,
          matched_phone: supply.phone,
          matched_lid: supply.whatsapp_lid,
          supply_id: supply.id,
          komoditas: demand.komoditas,
          price: supply.harga_per_kg,
          qty: supply.jumlah_kg,
          location: supply.kabupaten
        });
      }
    }
  }

  return matches;
}

function calculateMatchScore(supply: any, demand: any): number {
  let score = 50;
  
  // Price matching
  const priceDiff = demand.harga_max_per_kg - supply.harga_per_kg;
  if (priceDiff >= 0) {
    score += Math.min(30, (priceDiff / demand.harga_max_per_kg) * 100);
  }

  // Location matching (very basic for now)
  if (supply.kabupaten === demand.kota_tujuan) {
    score += 20;
  } else if (supply.provinsi === demand.provinsi) {
    score += 10;
  }

  return Math.min(score, 100);
}
