const axios = require('axios');
const BPS_API_KEY = 'f5eb9efa4c7ab3b4175e07bcbbcab193';
const BPS_BASE_URL = 'https://webapi.bps.go.id/v1/api';

(async () => {
    try {
        const varId = '1883'; // Margin Perdagangan Cabai Rawit
        console.log(`📊 Fetching DATA for VarID: ${varId} (Year: 2023)...`);
        const res = await axios.get(`${BPS_BASE_URL}/list/model/data/lang/ind/domain/0000/var/${varId}/key/${BPS_API_KEY}/th/2023`);
        
        if (res.data.status === 'OK') {
            console.log('--- DATA CONTENT ---');
            console.log(JSON.stringify(res.data.datacontent, null, 2).slice(0, 1000));
            console.log('--- VERVAR ---');
            console.log(JSON.stringify(res.data.vervar, null, 2).slice(0, 500));
        } else {
            console.log('BPS Error:', res.data);
        }
    } catch (err) {
        console.log('ERROR:', err.message);
    }
})();
