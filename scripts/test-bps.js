const axios = require('axios');
const BPS_API_KEY = 'f5eb9efa4c7ab3b4175e07bcbbcab193';
const BPS_BASE_URL = 'https://webapi.bps.go.id/v1/api';

(async () => {
    try {
        console.log('📚 Listing BPS Subjects...');
        const subRes = await axios.get(`${BPS_BASE_URL}/list/model/subject/lang/ind/domain/0000/key/${BPS_API_KEY}`);
        
        if (subRes.data.status === 'OK') {
            const subjects = subRes.data.data[1];
            console.log(`Found ${subjects.length} subjects.`);
            // Search for "Harga" manually in all fields
            const found = subjects.filter(s => JSON.stringify(s).toLowerCase().includes('harga'));
            console.log(`Found ${found.length} subjects with "harga":`);
            found.forEach(s => console.log(`- [${s.sub_id}] ${s.title}`));
        } else {
            console.log('BPS Status Not OK:', subRes.data);
        }
    } catch (err) {
        console.log('ERROR:', err.message);
    }
})();
