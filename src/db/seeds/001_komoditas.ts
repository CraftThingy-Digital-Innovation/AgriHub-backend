import db from '../config/knex';
import { v4 as uuidv4 } from 'uuid';

const komoditasData = [
  // Sayuran
  { kategori: 'sayuran', icon: '🥬', items: [
    { nama: 'Bayam', nama_latin: 'Amaranthus tricolor' },
    { nama: 'Kangkung', nama_latin: 'Ipomoea aquatica' },
    { nama: 'Sawi Hijau', nama_latin: 'Brassica juncea' },
    { nama: 'Sawi Putih', nama_latin: 'Brassica rapa' },
    { nama: 'Kubis', nama_latin: 'Brassica oleracea' },
    { nama: 'Brokoli', nama_latin: 'Brassica oleracea var. italica' },
    { nama: 'Kembang Kol', nama_latin: 'Brassica oleracea var. botrytis' },
    { nama: 'Wortel', nama_latin: 'Daucus carota' },
    { nama: 'Kentang', nama_latin: 'Solanum tuberosum' },
    { nama: 'Ubi Jalar', nama_latin: 'Ipomoea batatas' },
    { nama: 'Singkong', nama_latin: 'Manihot esculenta' },
    { nama: 'Talas', nama_latin: 'Colocasia esculenta' },
    { nama: 'Buncis', nama_latin: 'Phaseolus vulgaris' },
    { nama: 'Kacang Panjang', nama_latin: 'Vigna unguiculata' },
    { nama: 'Terong Ungu', nama_latin: 'Solanum melongena' },
    { nama: 'Terong Hijau', nama_latin: 'Solanum torvum' },
    { nama: 'Labu Siam', nama_latin: 'Sechium edule' },
    { nama: 'Labu Kuning', nama_latin: 'Cucurbita moschata' },
    { nama: 'Timun', nama_latin: 'Cucumis sativus' },
    { nama: 'Gambas', nama_latin: 'Luffa acutangula' },
    { nama: 'Pare', nama_latin: 'Momordica charantia' },
    { nama: 'Kacang Kapri', nama_latin: 'Pisum sativum' },
    { nama: 'Daun Singkong', nama_latin: 'Manihot esculenta' },
    { nama: 'Daun Pepaya', nama_latin: 'Carica papaya' },
    { nama: 'Daun Kemangi', nama_latin: 'Ocimum basilicum' },
    { nama: 'Seledri', nama_latin: 'Apium graveolens' },
    { nama: 'Daun Bawang', nama_latin: 'Allium fistulosum' },
  ]},
  // Bumbu & Rempah
  { kategori: 'bumbu-rempah', icon: '🌶️', items: [
    { nama: 'Cabai Merah', nama_latin: 'Capsicum annuum' },
    { nama: 'Cabai Hijau', nama_latin: 'Capsicum annuum' },
    { nama: 'Cabai Rawit', nama_latin: 'Capsicum frutescens' },
    { nama: 'Bawang Merah', nama_latin: 'Allium cepa' },
    { nama: 'Bawang Putih', nama_latin: 'Allium sativum' },
    { nama: 'Bawang Bombay', nama_latin: 'Allium cepa var. cepa' },
    { nama: 'Jahe', nama_latin: 'Zingiber officinale' },
    { nama: 'Kunyit', nama_latin: 'Curcuma longa' },
    { nama: 'Kencur', nama_latin: 'Kaempferia galanga' },
    { nama: 'Lengkuas', nama_latin: 'Alpinia galanga' },
    { nama: 'Temulawak', nama_latin: 'Curcuma xanthorrhiza' },
    { nama: 'Sereh', nama_latin: 'Cymbopogon citratus' },
    { nama: 'Daun Salam', nama_latin: 'Syzygium polyanthum' },
    { nama: 'Kemiri', nama_latin: 'Aleurites moluccanus' },
    { nama: 'Cengkeh', nama_latin: 'Syzygium aromaticum' },
    { nama: 'Pala', nama_latin: 'Myristica fragrans' },
    { nama: 'Lada Hitam', nama_latin: 'Piper nigrum' },
    { nama: 'Kapulaga', nama_latin: 'Elettaria cardamomum' },
    { nama: 'Kayu Manis', nama_latin: 'Cinnamomum verum' },
  ]},
  // Buah-buahan
  { kategori: 'buah', icon: '🍎', items: [
    { nama: 'Mangga Harum Manis', nama_latin: 'Mangifera indica' },
    { nama: 'Mangga Gedong', nama_latin: 'Mangifera indica' },
    { nama: 'Pisang Ambon', nama_latin: 'Musa acuminata' },
    { nama: 'Pisang Raja', nama_latin: 'Musa paradisiaca' },
    { nama: 'Pisang Kepok', nama_latin: 'Musa paradisiaca' },
    { nama: 'Pepaya', nama_latin: 'Carica papaya' },
    { nama: 'Nanas', nama_latin: 'Ananas comosus' },
    { nama: 'Semangka', nama_latin: 'Citrullus lanatus' },
    { nama: 'Melon', nama_latin: 'Cucumis melo' },
    { nama: 'Jambu Biji', nama_latin: 'Psidium guajava' },
    { nama: 'Jambu Air', nama_latin: 'Syzygium aqueum' },
    { nama: 'Rambutan', nama_latin: 'Nephelium lappaceum' },
    { nama: 'Durian', nama_latin: 'Durio zibethinus' },
    { nama: 'Manggis', nama_latin: 'Garcinia mangostana' },
    { nama: 'Salak', nama_latin: 'Salacca zalacca' },
    { nama: 'Duku', nama_latin: 'Lansium domesticum' },
    { nama: 'Jeruk Nipis', nama_latin: 'Citrus aurantiifolia' },
    { nama: 'Jeruk Siam', nama_latin: 'Citrus reticulata' },
    { nama: 'Jeruk Bali', nama_latin: 'Citrus maxima' },
    { nama: 'Alpukat', nama_latin: 'Persea americana' },
    { nama: 'Belimbing', nama_latin: 'Averrhoa carambola' },
    { nama: 'Sirsak', nama_latin: 'Annona muricata' },
    { nama: 'Sawo', nama_latin: 'Manilkara zapota' },
  ]},
  // Biji-bijian & Serealia
  { kategori: 'biji-bijian', icon: '🌾', items: [
    { nama: 'Beras', nama_latin: 'Oryza sativa' },
    { nama: 'Jagung', nama_latin: 'Zea mays' },
    { nama: 'Kedelai', nama_latin: 'Glycine max' },
    { nama: 'Kacang Tanah', nama_latin: 'Arachis hypogaea' },
    { nama: 'Kacang Hijau', nama_latin: 'Vigna radiata' },
    { nama: 'Kacang Merah', nama_latin: 'Phaseolus vulgaris' },
    { nama: 'Sorgum', nama_latin: 'Sorghum bicolor' },
    { nama: 'Gandum Lokal', nama_latin: 'Triticum aestivum' },
    { nama: 'Ubi Kayu (Tepung)', nama_latin: 'Manihot esculenta' },
    { nama: 'Biji Wijen', nama_latin: 'Sesamum indicum' },
  ]},
  // Holtikultura & Lainnya
  { kategori: 'hortikultura', icon: '🌿', items: [
    { nama: 'Tomat', nama_latin: 'Solanum lycopersicum' },
    { nama: 'Cabai Paprika', nama_latin: 'Capsicum annuum' },
    { nama: 'Lettuce', nama_latin: 'Lactuca sativa' },
    { nama: 'Stroberi', nama_latin: 'Fragaria × ananassa' },
    { nama: 'Melon Hijau', nama_latin: 'Cucumis melo' },
    { nama: 'Kol Ungu', nama_latin: 'Brassica oleracea' },
    { nama: 'Baby Corn', nama_latin: 'Zea mays' },
    { nama: 'Asparagus', nama_latin: 'Asparagus officinalis' },
    { nama: 'Jamur Tiram', nama_latin: 'Pleurotus ostreatus' },
    { nama: 'Jamur Kuping', nama_latin: 'Auricularia auricula-judae' },
    { nama: 'Jamur Shiitake', nama_latin: 'Lentinus edodes' },
  ]},
  // Perkebunan
  { kategori: 'perkebunan', icon: '🌴', items: [
    { nama: 'Kelapa Segar', nama_latin: 'Cocos nucifera' },
    { nama: 'Kelapa Sawit', nama_latin: 'Elaeis guineensis' },
    { nama: 'Kopi Arabika', nama_latin: 'Coffea arabica' },
    { nama: 'Kopi Robusta', nama_latin: 'Coffea canephora' },
    { nama: 'Kakao', nama_latin: 'Theobroma cacao' },
    { nama: 'Vanili', nama_latin: 'Vanilla planifolia' },
    { nama: 'Karet', nama_latin: 'Hevea brasiliensis' },
    { nama: 'Tebu', nama_latin: 'Saccharum officinarum' },
    { nama: 'Tembakau', nama_latin: 'Nicotiana tabacum' },
    { nama: 'Teh', nama_latin: 'Camellia sinensis' },
    { nama: 'Pala Banda', nama_latin: 'Myristica fragrans' },
    { nama: 'Lada Putih', nama_latin: 'Piper nigrum' },
  ]},
];

export async function seed(): Promise<void> {
  // Kosongkan dulu jika sudah ada
  await db('komoditas').del();

  const rows = [];
  for (const group of komoditasData) {
    for (const item of group.items) {
      rows.push({
        id: uuidv4(),
        nama: item.nama,
        nama_latin: item.nama_latin,
        kategori: group.kategori,
        unit_default: 'kg',
        icon_emoji: group.icon,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  await db('komoditas').insert(rows);
  console.log(`✅ Seeded ${rows.length} komoditas/tanaman data.`);
}
