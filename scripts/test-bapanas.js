const axios = require('axios');

async function testBapanas() {
  const url = 'https://panelharga.badanpangan.go.id/data-harian.json';
  try {
    const res = await axios.get(url, { 
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('STATUS:', res.status);
    
    // Find item with name containing 'cabai'
    const items = Object.values(res.data);
    const cabai = items.find(it => it.name && it.name.toLowerCase().includes('cabai'));
    if (cabai) {
        console.log('CABAI SAMPLE:', JSON.stringify(cabai, null, 2));
    } else {
        console.log('FIRST ITEM:', JSON.stringify(items[0], null, 2));
    }
  } catch (err) {
    console.log('ERROR:', err.message);
  }
}

testBapanas();
