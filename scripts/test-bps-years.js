const axios = require('axios');
const BPS_API_KEY = 'f5eb9efa4c7ab3b4175e07bcbbcab193';
const BPS_BASE_URL = 'https://webapi.bps.go.id/v1/api';

(async () => {
    try {
        const varId = '645'; // Rata-rata Harga Gabah di Tingkat Petani
        const years = ['2023', '2022', '2021'];
        
        for (const th of years) {
            console.log(`📊 Fetching data for VarID: ${varId} (Year: ${th})...`);
            const res = await axios.get(`${BPS_BASE_URL}/list/model/data/lang/ind/domain/0000/var/${varId}/key/${BPS_API_KEY}/th/${th}`);
            
            if (res.data.status === 'OK' && res.data.datacontent) {
                console.log(`✅ FOUND DATA for ${th}!`);
                console.log('Sample Data Content:', JSON.stringify(res.data.datacontent, null, 2).slice(0, 500));
                // BPS DataContent usually is a map: { "varID_vervarID_thID_turthID": value }
                return;
            } else {
                console.log(`❌ No data for ${th}`);
            }
        }
    } catch (err) {
        console.log('ERROR:', err.message);
    }
})();
