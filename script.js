/**************************************
 * CONFIG - isi ini kalau mau pakai Supabase
 **************************************/
const CONFIG = {
  SUPABASE_URL: '', // contoh: https://xyzcompany.supabase.co
  SUPABASE_ANON_KEY: '' // jangan pake service_role; pakai anon/public key
};

/**************************************
 * Init Supabase if configured
 **************************************/
let useSupabase = false;
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
  try {
    supabase = supabaseJs.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    useSupabase = true;
    document.getElementById('data-mode').textContent = 'Supabase (realtime)';
    console.log('Supabase enabled');
  } catch (err) {
    console.warn('Supabase init failed, fallback to localStorage', err);
    useSupabase = false;
  }
} else {
  document.getElementById('data-mode').textContent = 'localStorage';
}

/**************************************
 * State & Elements
 **************************************/
let transaksi = []; // local cache
let isAdmin = false;
let currentUser = null;

const totalSaldoEl = document.getElementById("total-saldo");
const tabelBody = document.getElementById("tabel-body");
const formTransaksi = document.getElementById("form-transaksi");
const navDashboard = document.getElementById("nav-dashboard");
const navTambah = document.getElementById("nav-tambah");
const navTabel = document.getElementById("nav-tabel");
const dashboardSection = document.getElementById("dashboard-section");
const formSection = document.getElementById("form-section");
const tabelSection = document.getElementById("tabel-section");
const toggleModeBtn = document.getElementById("toggle-mode");
const authOpenBtn = document.getElementById("auth-open");
const authLogoutBtn = document.getElementById("auth-logout");

const authModal = document.getElementById("authModal");
const authEmail = document.getElementById("authEmail");
const authPass = document.getElementById("authPass");
const btnSignup = document.getElementById("btnSignup");
const btnLogin = document.getElementById("btnLogin");
const btnCloseAuth = document.getElementById("btnCloseAuth");

const clearBtn = document.getElementById("clear-btn");

/**************************************
 * Chart init
 **************************************/
const ctx = document.getElementById("financeChart").getContext("2d");
const financeChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "Saldo Akumulatif",
      data: [],
      borderColor: "rgb(124, 58, 237)",
      backgroundColor: "rgba(124,58,237,0.2)",
      tension: 0.3,
      fill: true
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } }
  }
});

/**************************************
 * Helpers - localStorage fallback
 **************************************/
const LS_KEY = 'kk_transactions_v2';

async function loadLocal() {
  const raw = localStorage.getItem(LS_KEY);
  transaksi = raw ? JSON.parse(raw) : [];
  transaksi.sort((a,b)=> new Date(a.tanggal) - new Date(b.tanggal));
}

async function saveLocal() {
  localStorage.setItem(LS_KEY, JSON.stringify(transaksi));
}

/**************************************
 * Supabase CRUD + realtime
 **************************************/
async function fetchFromSupabase() {
  const { data, error } = await supabase.from('transactions').select('*').order('tanggal', { ascending: true });
  if (error) { console.error(error); return []; }
  // normalize numeric
  return data.map(d => ({ id: d.id, tanggal: d.tanggal, deskripsi: d.deskripsi, jumlah: Number(d.jumlah) }));
}

async function addToSupabase(tx) {
  const { data, error } = await supabase.from('transactions').insert([tx]).select();
  if (error) throw error;
  return data[0];
}

async function updateSupabase(id, patch) {
  const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select();
  if (error) throw error;
  return data[0];
}

async function deleteFromSupabase(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
  return true;
}

function subscribeRealtime() {
  // subscribe to INSERT/UPDATE/DELETE on transactions
  supabase.channel('public:transactions')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, payload => {
      // just refetch or apply minimal change
      loadAndRender();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, payload => {
      loadAndRender();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions' }, payload => {
      loadAndRender();
    })
    .subscribe();
}

/**************************************
 * UI render
 **************************************/
function formatRp(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + 'Rp' + Number(abs).toLocaleString('id-ID');
}

async function renderTable() {
  tabelBody.innerHTML = '';
  // sort desc for table view
  const rows = [...transaksi].sort((a,b)=> new Date(b.tanggal) - new Date(a.tanggal));
  rows.forEach((tx, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2">${tx.tanggal}</td>
      <td class="p-2">${tx.deskripsi || '-'}</td>
      <td class="p-2">${formatRp(tx.jumlah)}</td>
      <td class="p-2">
        ${isAdmin ? `<button class="editBtn px-2 py-1 mr-2 text-xs rounded border">Edit</button>
        <button class="delBtn px-2 py-1 text-xs rounded border text-red-500">Hapus</button>` : '<span class="text-xs text-gray-400">Hanya lihat</span>'}
      </td>
    `;
    // attach data-id for actions
    tr.querySelectorAll('.editBtn').forEach(b=>{
      b.addEventListener('click', async ()=>{
        const newAmt = prompt('Jumlah (positif=masuk, negatif=keluar)', tx.jumlah);
        const newDesc = prompt('Deskripsi', tx.deskripsi);
        const newDate = prompt('Tanggal (YYYY-MM-DD)', tx.tanggal);
        if (newAmt === null) return;
        if (useSupabase) {
          await updateSupabase(tx.id, { jumlah: Number(newAmt), deskripsi: newDesc, tanggal: newDate });
        } else {
          tx.jumlah = Number(newAmt); tx.deskripsi = newDesc; tx.tanggal = newDate;
          await saveLocal();
        }
        await loadAndRender();
      });
    });
    tr.querySelectorAll('.delBtn').forEach(b=>{
      b.addEventListener('click', async ()=>{
        if (!confirm('Yakin hapus transaksi ini?')) return;
        if (useSupabase) {
          await deleteFromSupabase(tx.id);
        } else {
          transaksi = transaksi.filter(t => t !== tx);
          await saveLocal();
        }
        await loadAndRender();
      });
    });
    tabelBody.appendChild(tr);
  });
}

function renderSummaryAndChart() {
  // totals
  const total = transaksi.reduce((acc, t) => acc + t.jumlah, 0);
  totalSaldoEl.textContent = formatRp(total);

  // chart cumulative
  let labels = [];
  let dataSaldo = [];
  let saldo = 0;
  const sorted = [...transaksi].sort((a,b)=> new Date(a.tanggal) - new Date(b.tanggal));
  sorted.forEach(t=>{
    saldo += t.jumlah;
    labels.push(t.tanggal);
    dataSaldo.push(saldo);
  });

  financeChart.data.labels = labels;
  financeChart.data.datasets[0].data = dataSaldo;
  financeChart.update();
}

async function loadAndRender() {
  if (useSupabase) {
    transaksi = await fetchFromSupabase();
  } else {
    await loadLocal();
  }
  renderSummaryAndChart();
  renderTable();
}

/**************************************
 * Form submit (add)
 **************************************/
formTransaksi.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!isAdmin) return alert('Hanya admin yang bisa tambah data.');

  const tanggal = document.getElementById('tanggal').value;
  const jumlah = Number(document.getElementById('jumlah').value);
  const deskripsi = document.getElementById('deskripsi').value;
  if (!tanggal || Number.isNaN(jumlah)) return alert('Isi tanggal dan jumlah yang valid.');

  const payload = { tanggal, deskripsi, jumlah };

  try {
    if (useSupabase) {
      await addToSupabase(payload);
    } else {
      // local fallback
      payload.id = 'loc_' + Date.now();
      transaksi.push(payload);
      await saveLocal();
    }
    formTransaksi.reset();
    await loadAndRender();
  } catch (err) {
    console.error(err);
    alert('Gagal menambah transaksi: ' + (err.message || err));
  }
});

clearBtn?.addEventListener('click', ()=> formTransaksi.reset());

/**************************************
 * Auth (Supabase) - Signup / Login / Logout
 **************************************/
authOpenBtn.addEventListener('click', ()=>{
  authModal.classList.remove('hidden'); authModal.classList.add('flex');
});
btnCloseAuth.addEventListener('click', ()=> { authModal.classList.add('hidden'); });

btnSignup.addEventListener('click', async ()=>{
  if (!useSupabase) return alert('Supabase tidak aktif. Isi CONFIG di script.js.');
  const email = authEmail.value.trim();
  const pass = authPass.value.trim();
  if (!email || pass.length < 6) return alert('Email & password (min 6) diperlukan.');
  const { data, error } = await supabase.auth.signUp({ email, password: pass });
  if (error) return alert('Signup gagal: ' + error.message);
  alert('Akun dibuat. Cek email untuk verifikasi jika menggunakan email confirm.');
  authModal.classList.add('hidden');
});

btnLogin.addEventListener('click', async ()=>{
  if (!useSupabase) return alert('Supabase tidak aktif. Isi CONFIG di script.js.');
  const email = authEmail.value.trim();
  const pass = authPass.value.trim();
  if (!email || pass.length < 6) return alert('Email & password (min 6) diperlukan.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) return alert('Login gagal: ' + error.message);
  currentUser = data.user;
  isAdmin = true; // NOTE: sementara treat authenticated as admin — untuk production gunakan RLS & role checks
  authModal.classList.add('hidden');
  authOpenBtn.classList.add('hidden');
  authLogoutBtn.classList.remove('hidden');
  await loadAndRender();
});

/**************************************
 * Logout
 **************************************/
authLogoutBtn.addEventListener('click', async ()=>{
  if (useSupabase) await supabase.auth.signOut();
  currentUser = null;
  isAdmin = false;
  authOpenBtn.classList.remove('hidden');
  authLogoutBtn.classList.add('hidden');
  await loadAndRender();
});

/**************************************
 * UI controls (nav & theme)
 **************************************/
navDashboard.onclick = () => { dashboardSection.classList.remove("hidden"); formSection.classList.add("hidden"); tabelSection.classList.add("hidden"); };
navTambah.onclick = () => { dashboardSection.classList.add("hidden"); formSection.classList.remove("hidden"); tabelSection.classList.add("hidden"); };
navTabel.onclick = () => { dashboardSection.classList.add("hidden"); formSection.classList.add("hidden"); tabelSection.classList.remove("hidden"); };

toggleModeBtn.onclick = () => document.body.classList.toggle('dark');

/**************************************
 * Startup
 **************************************/
(async function init(){
  if (useSupabase) {
    // If supabase active, try to get current session
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      currentUser = data.session.user;
      isAdmin = true; // again: for demo only. Use RLS
      authOpenBtn.classList.add('hidden');
      authLogoutBtn.classList.remove('hidden');
    }
    // subscribe realtime
    subscribeRealtime();
  } else {
    await loadLocal();
  }
  await loadAndRender();
})();