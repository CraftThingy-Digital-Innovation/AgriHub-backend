const axios = require('axios');

async function scrapeBapanas() {
  const url = 'https://panelharga.badanpangan.go.id/';
  try {
    console.log('🌐 Scraping Bapanas Homepage...');
    const { data } = await axios.get(url, { 
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });
    
    // Cari angka-angka harga di dalam HTML menggunakan regex atau string matching
    // Biasanya ada di tabel dengan class atau elemen tertentu
    // Mari kita cari baris yang mengandung 'Cabai Merah Keriting'
    const cabaiMatch = data.match(/Cabai Merah Keriting<\/td>[\s\S]*?<td>([^<]+)<\/td>[\s\S]*?<td>([^<]+)/);
    if (cabaiMatch) {
        console.log('CABAI MERAH:', cabaiMatch[1].trim(), '->', cabaiMatch[2].trim());
    } else {
        console.log('NOT FOUND. HTML Sample:', data.slice(0, 1000));
        // Cari semua <td> yang berisi angka ribuan (e.g. 40.000)
        const prices = data.match(/>(\d{1,3}\.\d{3})</g);
        console.log('FOUND PRICES:', prices ? prices.slice(0, 5) : 'NONE');
    }
  } catch (err) {
    console.log('ERROR:', err.message);
  }
}

scrapeBapanas();
