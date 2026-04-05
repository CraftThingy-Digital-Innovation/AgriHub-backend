import db from '../config/knex';
import { v4 as uuidv4 } from 'uuid';
import { checkOngkir } from './biteshipService';
import { sendWAMessage } from './whatsappBot';
import { createTransactionMidtrans } from './transactionService';

// Data Struktur
// whatsapp_state: id, user_id, jid, state_type, payload, expires_at

export async function processBeliCommand(jid: string, senderLid: string, matchId: string) {
    try {
        const user = await db('users').where({ whatsapp_lid: senderLid }).first();
        if (!user) {
            await sendWAMessage(jid, '❌ Akun Anda belum terhubung. Ketik *LINK [NomorHP]* terlebih dahulu.');
            return;
        }

        const match = await db('match_history')
            .join('products', 'match_history.product_id', 'products.id')
            .join('stores', 'products.store_id', 'stores.id')
            .join('demand_requests', 'match_history.demand_id', 'demand_requests.id')
            .join('user_addresses', 'demand_requests.address_id', 'user_addresses.id')
            .where('match_history.id', matchId)
            .where('demand_requests.requester_id', user.id)
            .select(
                'match_history.*',
                'products.name as product_name',
                'products.price_per_unit',
                'products.weight_gram',
                'stores.id as store_id',
                'stores.name as store_name',
                'stores.postal_code as store_postal',
                'user_addresses.id as address_id',
                'user_addresses.postal_code as buyer_postal',
                'demand_requests.jumlah_kg'
            ).first();

        if (!match) {
            await sendWAMessage(jid, '❌ Data matching tidak ditemukan atau sudah kadaluarsa.');
            return;
        }
        
        if (!match.store_postal || !match.buyer_postal) {
            await sendWAMessage(jid, '❌ Kode pos penjual atau pembeli belum lengkap untuk perhitungan ongkir otomatis. Mohon perbarui di dashboard.');
            return;
        }

        await sendWAMessage(jid, '⏳ Sedang menghitung opsi ongkos kirim (Biteship)...');

        const totalWeightGram = Number(match.jumlah_kg) * 1000;
        const rates = await checkOngkir({
            origin_postal_code: match.store_postal,
            destination_postal_code: match.buyer_postal,
            weight_gram: totalWeightGram,
            couriers: 'jne,sicepat,jnt,pos'
        });

        if (rates.length === 0) {
            await sendWAMessage(jid, '❌ Gagal menemukan kurir untuk rute pengiriman ini.');
            return;
        }

        const bestRate = rates[0]; // Karena sudah disortir berdasarkan harga termurah

        // Simpan intent checkout ke DB (State Machine)
        const stateId = uuidv4();
        await db('whatsapp_auth').insert({
            id: uuidv4(),
            category: 'checkout_state',
            key_id: stateId,
            data: JSON.stringify({
                user_id: user.id,
                match_id: matchId,
                product_id: match.product_id,
                store_id: match.store_id,
                qty: match.jumlah_kg,
                rates: rates
            }),
            updated_at: new Date(Date.now() + 3600 * 1000).toISOString() // Expire in 1 hour
        });

        let msg = `📦 *CHECKOUT PERSIAPAN*\n\n`;
        msg += `Barang: ${match.product_name} (${match.jumlah_kg} kg)\n`;
        msg += `Dari: ${match.store_name} (Kode Pos: ${match.store_postal})\n`;
        msg += `Ke: Rumah Anda (Kode Pos: ${match.buyer_postal})\n\n`;

        msg += `✅ *Rekomendasi Ongkir Termurah:*\n`;
        msg += `*${bestRate.courier.toUpperCase()} ${bestRate.service}* - Rp ${bestRate.price.toLocaleString('id-ID')} (Est: ${bestRate.estimated_days} hari)\n\n`;

        msg += `Ketik *PILIH KURIR 1* untuk setuju dengan rekomendasi termurah di atas.\n\n`;
        
        msg += `🚚 *Alternatif Kurir Lain:*\n`;
        rates.slice(1, 4).forEach((r, idx) => {
             msg += `${idx + 2}. ${r.courier.toUpperCase()} ${r.service} - Rp ${r.price.toLocaleString('id-ID')}\n`;
        });
        msg += `\nKetik *PILIH KURIR [Nomor]* untuk memilih (Contoh: PILIH KURIR 2).\n`;
        msg += `\n_(Sesi ini berlaku 1 jam)_`;

        // Save last state id to user's cache key for easy pickup
        await saveUserState(senderLid, 'pending_checkout', stateId);

        await sendWAMessage(jid, msg);

    } catch (err) {
        console.error('Checkout error:', err);
        await sendWAMessage(jid, '❌ Terjadi kesalahan pada sistem pemrosesan checkout.');
    }
}

export async function processPilihKurirCommand(jid: string, senderLid: string, selection: number) {
    try {
        const stateId = await getUserState(senderLid, 'pending_checkout');
        if (!stateId) {
            await sendWAMessage(jid, '❌ Tidak ada transaksi aktif yang sedang menunggu pemilihan kurir. Ketik *BELI [ID Match]* terlebih dahulu.');
            return;
        }

        const stateRow = await db('whatsapp_auth').where({ category: 'checkout_state', key_id: stateId }).first();
        if (!stateRow) {
             await clearUserState(senderLid, 'pending_checkout');
             await sendWAMessage(jid, '❌ Sesi checkout Anda sudah kadaluarsa (lebih dari 1 jam). Ulangi kembali ya.');
             return;
        }

        const data = JSON.parse(stateRow.data);
        const { match_id, product_id, store_id, qty, rates, user_id } = data;

        const idx = selection - 1;
        if (idx < 0 || idx >= rates.length) {
            await sendWAMessage(jid, `❌ Pilihan nomor ${selection} tidak valid. Mohon masukkan angka 1 hingga ${rates.length}.`);
            return;
        }

        const selectedRate = rates[idx];
        await sendWAMessage(jid, `⏳ Memproses Invoice menggunakan ${selectedRate.courier.toUpperCase()}...`);

        // Dapatkan data produk asli untuk kalkulasi
        const prod = await db('products').where('id', product_id).first();
        
        // Buat Order di Database
        const orderId = uuidv4();
        const baseTotal = Number(prod.price_per_unit) * Number(qty);
        const shipping = selectedRate.price;
        const subtotalApp = baseTotal + shipping;
        const ppnFee = subtotalApp * 0.11; // 11% PPN
        const finalGrandTotal = subtotalApp + ppnFee;

        // Bikin transaksi Midtrans
        const mdLink = await createTransactionMidtrans(orderId, finalGrandTotal);

        await db('orders').insert({
            id: orderId,
            buyer_id: user_id,
            seller_id: (await db('stores').where('id', store_id).first()).owner_id,
            store_id: store_id,
            product_id: product_id,
            quantity: qty,
            unit_price: prod.price_per_unit,
            shipping_cost: shipping,
            total_amount: finalGrandTotal,
            platform_fee: 0,
            ppn_fee: ppnFee,
            seller_net: baseTotal, // sementara blm dipotong platform fee
            status: 'pending',
            midtrans_order_id: mdLink.token, // pakai token as ID for cache
            shipping_courier: selectedRate.courier,
            notes: `Auto Checkout via WA (Match ${match_id})`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        // Insert ke shipment_orders utk status pending biteship
        await db('shipment_orders').insert({
             id: uuidv4(),
             order_id: orderId,
             courier: selectedRate.courier,
             service_type: selectedRate.service,
             origin_area_id: 'unknown',
             destination_area_id: 'unknown',
             weight_kg: qty,
             price: shipping,
             estimated_days: selectedRate.estimated_days,
             status: 'pending',
             created_at: new Date().toISOString(),
             updated_at: new Date().toISOString()
        });

        await clearUserState(senderLid, 'pending_checkout');
        await db('whatsapp_auth').where({ category: 'checkout_state', key_id: stateId }).delete(); // Cleanup

        let invoiceStr = `🧾 *INVOICE DITERBITKAN*\n\n`;
        invoiceStr += `Barang: Rp ${baseTotal.toLocaleString('id-ID')}\n`;
        invoiceStr += `Ongkir (${selectedRate.courier.toUpperCase()}): Rp ${shipping.toLocaleString('id-ID')}\n`;
        invoiceStr += `PPN (11%): Rp ${ppnFee.toLocaleString('id-ID')}\n`;
        invoiceStr += `*Total Dibayar: Rp ${finalGrandTotal.toLocaleString('id-ID')}*\n\n`;

        invoiceStr += `Silakan selesaikan pembayaran Escrow Anda melalui tautan resmi Midtrans di bawah ini:\n`;
        invoiceStr += `🔗 ${mdLink.redirect_url}\n\n`;
        invoiceStr += `_Sistem otomatis akan mengupdate status pesanan ini sebagai "Dibayar" dan penjual akan segera mengirimkan barang Anda._`;

        await sendWAMessage(jid, invoiceStr);

    } catch (err) {
        console.error('Pilih कुरिर Error:', err);
        await sendWAMessage(jid, '❌ Terjadi kesalahan pada saat menyelesaikan invoice.');
    }
}

// Simple state helpers
async function saveUserState(lid: string, stateKey: string, payloadStr: string) {
    const keyId = `${lid}_${stateKey}`;
    const exist = await db('whatsapp_auth').where({ category: 'user_state', key_id: keyId }).first();
    if (exist) {
        await db('whatsapp_auth').where({ id: exist.id }).update({ data: payloadStr, updated_at: new Date().toISOString() });
    } else {
        await db('whatsapp_auth').insert({ id: uuidv4(), category: 'user_state', key_id: keyId, data: payloadStr });
    }
}

async function getUserState(lid: string, stateKey: string) {
    const keyId = `${lid}_${stateKey}`;
    const row = await db('whatsapp_auth').where({ category: 'user_state', key_id: keyId }).first();
    return row ? row.data : null;
}

async function clearUserState(lid: string, stateKey: string) {
    const keyId = `${lid}_${stateKey}`;
    await db('whatsapp_auth').where({ category: 'user_state', key_id: keyId }).delete();
}
