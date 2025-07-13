// ==================== 1. INICIALIZACIÓN FIREBASE Y VARIABLES ====================
firebase.initializeApp({
  apiKey: 'AIzaSyCgDCzu5_k2_k1fb3vghS7MrZez87n8qjg',
  authDomain: 'inventario-emumsa.firebaseapp.com',
  projectId: 'inventario-emumsa'
});
const db = firebase.firestore();
firebase.firestore().settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED, merge: true });
firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code == 'failed-precondition') {
    console.warn('La persistencia falló: múltiples pestañas abiertas');
  } else if (err.code == 'unimplemented') {
    console.warn('La persistencia no está disponible');
  }
});

let inventarioEditMode = false;
let currentInventoryType = 'segunda';
let totalSegunda = 0;
let totalOverrolling = 0;
const categories = [
  'Tubería de Diámetro Menor',
  'Tubería de Diámetro Mayor',
  'PTR Negro Cuadrado',
  'PTR Negro Rectangular',
  'Polín Monten',
  'Tubería Galvanizada',
  'PTR Galvanizado',
  'Varios'
];
let materialNames = [];

// ==================== 2. UTILIDADES GENERALES ====================
function toProperCase(str) {
  return str.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

function setupNav() {
  document.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('main section').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(btn.dataset.target);
      sec.classList.add('active');
      sec.scrollIntoView({behavior: 'smooth', block: 'start'});
      if (sec.id === 'movimientos') renderInventario();
    });
  });
}

function populateCategorias() {
  const sel = document.getElementById('nuevo-categoria');
  sel.innerHTML = '';
  categories.forEach(c => sel.appendChild(new Option(c, c)));
}

// ==================== 3. CARGA DE DATOS DINÁMICOS ====================
async function loadMaterialNames() {
  const snap = await db.collection('materiales').get();
  materialNames = [...new Set(snap.docs.map(d => d.data().nombre))].sort();
  ['datalist-entrada', 'datalist-salida'].forEach(id => {
    const dl = document.getElementById(id);
    dl.innerHTML = '';
    materialNames.forEach(n => dl.appendChild(new Option(n)));
  });
}

async function cargarCalibres(nombre, selId) {
  const sel = document.getElementById(selId);
  sel.innerHTML = '<option disabled selected>Seleccione calibre</option>';
  const snap = await db.collection('materiales').where('nombre', '==', nombre).get();
  const calibresUnicos = new Set();
  const tiposPorCalibre = new Map();
  snap.docs.forEach(d => {
    const data = d.data();
    calibresUnicos.add(data.calibre);
    if (!tiposPorCalibre.has(data.calibre)) {
      tiposPorCalibre.set(data.calibre, []);
    }
    tiposPorCalibre.get(data.calibre).push({ id: d.id, tipo: data.tipo });
  });
  Array.from(calibresUnicos).sort().forEach(calibre => {
    const option = new Option(calibre, JSON.stringify({
      calibre,
      tipos: tiposPorCalibre.get(calibre)
    }));
    sel.appendChild(option);
  });
}

async function cargarPaquetes(materialId, tipo, selectElement) {
  const sel = typeof selectElement === 'string' ? document.getElementById(selectElement) : selectElement;
  if (!sel) return;
  sel.innerHTML = '<option disabled selected>Seleccione paquete</option>';
  const snap = await db.collection('paquetes')
    .where('materialId', '==', materialId)
    .where('estado', '==', 'activo')
    .get();
  const paquetesSeleccionados = Array.from(document.querySelectorAll('.salida-paquete'))
    .map(select => select.value)
    .filter(value => value);
  snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => !paquetesSeleccionados.includes(p.id))
    .sort((a, b) => a.fecha_ingreso.toDate() - b.fecha_ingreso.toDate())
    .forEach(p => sel.appendChild(new Option(p.peso_actual.toFixed(0) + ' kg', p.id)));
}

// ==================== 4. INVENTARIO Y EDICIÓN ====================
async function renderInventario() {
  const head = document.getElementById('inv-headers');
  const body = document.getElementById('inv-body');
  head.innerHTML = '';
  body.innerHTML = '';
  let sumGeneral = 0;
  const allMaterials = await db.collection('materiales').get();
  const allPkgs = await db.collection('paquetes').where('estado', '==', 'activo').get();
  totalSegunda = 0;
  totalOverrolling = 0;
  allPkgs.docs.forEach(doc => {
    const data = doc.data();
    const material = allMaterials.docs.find(m => m.id === data.materialId);
    if (material) {
      const materialData = material.data();
      if (materialData.tipo === 'segunda') totalSegunda += data.peso_actual;
      else if (materialData.tipo === 'overrolling') totalOverrolling += data.peso_actual;
    }
  });
  const mats = await db.collection('materiales').where('tipo', '==', currentInventoryType).get();
  const pkgsSnap = await db.collection('paquetes').where('estado', '==', 'activo').get();
  const map = {};
  const materialesIds = new Set(mats.docs.map(doc => doc.id));
  pkgsSnap.docs.forEach(d => {
    const D = d.data();
    if (materialesIds.has(D.materialId)) {
      map[D.materialId] = map[D.materialId] || [];
      map[D.materialId].push({ peso: D.peso_actual, fecha: D.fecha_ingreso.toDate(), id: d.id });
    }
  });
  let maxP = 0;
  mats.docs.forEach(m => {
    const list = map[m.id] || [];
    maxP = Math.max(maxP, list.length);
  });
  const rows = mats.docs.map(m => {
    const D = m.data();
    const list = (map[m.id] || []).sort((a, b) => a.fecha - b.fecha);
    const pesos = list.map(x => ({ peso: x.peso.toFixed(0), id: x.id }));
    return { id: m.id, categoria: D.categoriaId || 'Varios', nombre: D.nombre, calibre: D.calibre, pesos, orden: D.orden || 0 };
  }).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre) || a.calibre.localeCompare(b.calibre));
  ['Material', 'Calibre', 'Total'].concat(Array.from({ length: maxP }, (_, i) => 'Pqt ' + (i + 1))).forEach(txt => {
    const th = document.createElement('th');
    th.textContent = txt;
    head.appendChild(th);
  });
  categories.forEach(cat => {
    const grp = rows.filter(r => r.categoria === cat);
    if (!grp.length) return;
    const trC = document.createElement('tr');
    trC.classList.add('category-row');
    const tdC = document.createElement('td');
    tdC.colSpan = 3 + maxP + (inventarioEditMode ? 1 : 0);
    tdC.textContent = cat;
    trC.appendChild(tdC);
    body.appendChild(trC);
    grp.forEach(r => {
      const tr = document.createElement('tr');
      tr.dataset.materialId = r.id;
      tr.draggable = true;
      tr.classList.add('draggable-row');
      body.appendChild(tr);
      let nombreTd, calibreTd;
      if (inventarioEditMode) {
        nombreTd = document.createElement('td');
        const nombreInput = document.createElement('input');
        nombreInput.type = 'text';
        nombreInput.value = r.nombre;
        nombreInput.className = 'edit-material-nombre';
        nombreTd.appendChild(nombreInput);
        calibreTd = document.createElement('td');
        const calibreInput = document.createElement('input');
        calibreInput.type = 'text';
        calibreInput.value = r.calibre;
        calibreInput.className = 'edit-material-calibre';
        calibreTd.appendChild(calibreInput);
      } else {
        nombreTd = document.createElement('td');
        nombreTd.textContent = r.nombre;
        calibreTd = document.createElement('td');
        calibreTd.textContent = r.calibre;
      }
      tr.appendChild(nombreTd);
      tr.appendChild(calibreTd);
      const total = r.pesos.reduce((s,p) => s + parseFloat(p.peso), 0);
      sumGeneral += total;
      const totalStr = `${total.toFixed(0)} kg`;
      const totalTd = document.createElement('td');
      totalTd.textContent = totalStr;
      tr.appendChild(totalTd);
      for (let i = 0; i < maxP; i++) {
        const td = document.createElement('td');
        if (r.pesos[i]) {
          if (inventarioEditMode) {
            const pesoInput = document.createElement('input');
            pesoInput.type = 'number';
            pesoInput.step = '1';
            pesoInput.value = r.pesos[i].peso;
            pesoInput.className = 'edit-paquete-peso';
            pesoInput.dataset.paqueteId = r.pesos[i].id;
            td.appendChild(pesoInput);
          } else {
            td.textContent = `${r.pesos[i].peso} Kg`;
          }
        }
        tr.appendChild(td);
      }
      if (inventarioEditMode) {
        const tdDel = document.createElement('td');
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.textContent = '❌';
        btnDel.className = 'btn-del-material';
        btnDel.title = 'Eliminar este ítem y todos sus paquetes';
        btnDel.addEventListener('click', async () => {
          if (confirm('¿Eliminar este ítem y todos sus paquetes?')) {
            const paquetes = await db.collection('paquetes').where('materialId', '==', r.id).get();
            for (const doc of paquetes.docs) {
              await db.collection('paquetes').doc(doc.id).delete();
            }
            await db.collection('materiales').doc(r.id).delete();
            renderInventario();
          }
        });
        tdDel.appendChild(btnDel);
        tr.appendChild(tdDel);
      }
      body.appendChild(tr);
    });
  });
  const totalActual = currentInventoryType === 'segunda' ? totalSegunda : totalOverrolling;
  const totalGeneral = totalSegunda + totalOverrolling;
  document.getElementById('sum-general').innerHTML = `
    <span class="total-tipo">Total ${currentInventoryType === 'segunda' ? 'Segunda' : 'Overrolling'}: 
      ${totalActual.toFixed(0)} kg
    </span>
    <br>
    <span class="total-general">Total General: ${totalGeneral.toFixed(0)} kg</span>
  `;
  if (inventarioEditMode) setupDragAndDrop();
}

async function guardarCambiosInventario() {
  const mensaje = document.getElementById('mensaje-guardado');
  const loadingOverlay = document.getElementById('loading-overlay');
  try {
    loadingOverlay.classList.remove('hidden');
    mensaje.textContent = 'Guardando cambios...';
    mensaje.classList.add('mostrar');
    const batch = db.batch();
    const filas = Array.from(document.querySelectorAll('#inv-body tr:not(.category-row)'));
    filas.forEach((tr, index) => {
      const materialId = tr.dataset.materialId;
      const nombre = tr.querySelector('.edit-material-nombre')?.value?.trim();
      const calibre = tr.querySelector('.edit-material-calibre')?.value?.trim();
      if (!nombre || !calibre) throw new Error('Nombre y calibre son obligatorios');
      const materialRef = db.collection('materiales').doc(materialId);
      batch.update(materialRef, { nombre, calibre, orden: index });
      const pesos = tr.querySelectorAll('.edit-paquete-peso');
      for (const ip of pesos) {
        const paqueteId = ip.dataset.paqueteId;
        const peso = parseFloat(ip.value);
        if (isNaN(peso) || peso < 0) throw new Error('Peso inválido detectado');
        const paqueteRef = db.collection('paquetes').doc(paqueteId);
        batch.update(paqueteRef, { peso_actual: peso });
      }
    });
    await batch.commit();
    mensaje.textContent = '¡Cambios guardados!';
    setTimeout(() => mensaje.classList.remove('mostrar'), 1500);
  } catch (error) {
    console.error('Error al guardar:', error);
    mensaje.textContent = `Error: ${error.message}`;
    mensaje.style.background = '#d32f2f';
    setTimeout(() => {
      mensaje.classList.remove('mostrar');
      mensaje.style.background = 'var(--primary-green)';
    }, 2000);
  } finally {
    loadingOverlay.classList.add('hidden');
  }
}

function setupDragAndDrop() {
  if (!inventarioEditMode) return;
  const rows = document.querySelectorAll('#inv-body .draggable-row');
  let draggedRow = null;
  rows.forEach(row => {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e) => {
      draggedRow = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedRow = null;
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (!draggedRow) return;
      const targetRow = e.currentTarget;
      if (targetRow === draggedRow) return;
      let currentCategory = null;
      let element = targetRow;
      while (element) {
        if (element.classList.contains('category-row')) {
          currentCategory = element;
          break;
        }
        element = element.previousElementSibling;
      }
      let draggedCategory = null;
      element = draggedRow;
      while (element) {
        if (element.classList.contains('category-row')) {
          draggedCategory = element;
          break;
        }
        element = element.previousElementSibling;
      }
      if (currentCategory !== draggedCategory) return;
      const tbody = targetRow.parentNode;
      const rect = targetRow.getBoundingClientRect();
      const middle = (rect.top + rect.bottom) / 2;
      if (e.clientY < middle) {
        tbody.insertBefore(draggedRow, targetRow);
      } else {
        tbody.insertBefore(draggedRow, targetRow.nextSibling);
      }
    });
  });
}

// ==================== 5. FORMULARIOS DE MOVIMIENTOS ====================
// -------- ENTRADA --------
document.getElementById('entrada-material').addEventListener('change', e => cargarCalibres(e.target.value, 'entrada-calibre'));
document.getElementById('entrada-calibre').addEventListener('change', function() {
  const tipoSelect = document.getElementById('entrada-tipo');
  const data = JSON.parse(this.value);
  const tiposDisponibles = new Set(data.tipos.map(t => t.tipo));
  Array.from(tipoSelect.options).forEach(option => {
    if (option.value) option.disabled = !tiposDisponibles.has(option.value);
  });
  document.getElementById('pesos-entrada-container').innerHTML =
    '<label>Peso (kg)<br><input type="number" step="1" class="entrada-peso" required></label>';
});
document.getElementById('pesos-entrada-container').addEventListener('input', e => {
  if (e.target.classList.contains('entrada-peso')) {
    const last = [...document.querySelectorAll('.entrada-peso')].pop();
    if (last.value) {
      const lbl = document.createElement('label');
      lbl.innerHTML = 'Peso (kg)<br>';
      const ip = document.createElement('input');
      ip.type = 'number';
      ip.step = '1';
      ip.className = 'entrada-peso';
      ip.required = false;
      lbl.appendChild(ip);
      document.getElementById('pesos-entrada-container').appendChild(lbl);
    }
  }
});
document.getElementById('form-entrada').addEventListener('submit', async e => {
  e.preventDefault();
  const calibreSelect = document.getElementById('entrada-calibre');
  const tipoSelect = document.getElementById('entrada-tipo');
  const cal = calibreSelect.value;
  const tipo = tipoSelect.value;
  if (!cal || !tipo) {
    alert('Por favor seleccione un calibre y un tipo válidos.');
    return;
  }
  let materialId;
  try {
    const data = JSON.parse(cal);
    materialId = data.tipos.find(t => t.tipo === tipo)?.id;
  } catch (error) {
    alert('Error al procesar el calibre seleccionado.');
    return;
  }
  if (!materialId) {
    alert('El material seleccionado no corresponde a este tipo de inventario.');
    return;
  }
  const materialDoc = await db.collection('materiales').doc(materialId).get();
  if (!materialDoc.exists) {
    alert('El material seleccionado no existe en la base de datos.');
    return;
  }
  const pesos = [...document.querySelectorAll('.entrada-peso')].map(i => parseFloat(i.value)).filter(v => v);
  for (const p of pesos) {
    const paqueteRef = await db.collection('paquetes').add({
      materialId: materialId,
      peso_inicial: p,
      peso_actual: p,
      fecha_ingreso: new Date(),
      estado: 'activo'
    });
    await db.collection('movimientos').add({
      tipo: 'entrada',
      fecha: new Date(),
      peso: p,
      materialId: materialId,
      paqueteId: paqueteRef.id
    });
  }
  e.target.reset();
  document.getElementById('pesos-entrada-container').innerHTML =
    '<label>Peso (kg)<br><input type="number" step="1" class="entrada-peso" required></label>';
  renderInventario();
});

// -------- SALIDA --------
document.getElementById('salida-material').addEventListener('input', async e => {
  const input = e.target;
  const calibreSelect = document.getElementById('salida-calibre');
  const datalist = document.getElementById('datalist-salida');
  const errorDiv = document.getElementById('error-salida-material');
  errorDiv.textContent = '';
  calibreSelect.innerHTML = '<option disabled selected>Seleccione calibre</option>';
  document.querySelectorAll('.salida-paquete').forEach(select => {
    select.innerHTML = '<option disabled selected>Seleccione paquete</option>';
  });
  try {
    if (!input.value || input.value.length < 2) {
      const matsSnap = await db.collection('materiales').get();
      datalist.innerHTML = '';
      const nombres = new Set();
      matsSnap.docs.forEach(doc => nombres.add(doc.data().nombre));
      nombres.forEach(nombre => {
        const option = document.createElement('option');
        option.value = nombre;
        datalist.appendChild(option);
      });
      return;
    }
    const searchText = input.value.toLowerCase();
    const matsSnap = await db.collection('materiales').get();
    datalist.innerHTML = '';
    const nombres = new Set();
    matsSnap.docs.forEach(doc => {
      const nombre = doc.data().nombre;
      if (nombre.toLowerCase().includes(searchText)) nombres.add(nombre);
    });
    nombres.forEach(nombre => {
      const option = document.createElement('option');
      option.value = nombre;
      datalist.appendChild(option);
    });
  } catch (error) {
    console.error('Error al buscar materiales:', error);
    errorDiv.textContent = 'Error al buscar materiales';
  }
});
document.getElementById('salida-material').addEventListener('change', async e => {
  const nombre = e.target.value.trim();
  if (!nombre) return;
  try {
    await cargarCalibres(nombre, 'salida-calibre');
  } catch (error) {
    console.error('Error al cargar calibres:', error);
    document.getElementById('error-salida-material').textContent = 'Error al cargar calibres';
  }
});
document.getElementById('salida-calibre').addEventListener('change', function() {
  const tipoSelect = document.getElementById('salida-tipo');
  const data = JSON.parse(this.value);
  const tiposDisponibles = new Set(data.tipos.map(t => t.tipo));
  Array.from(tipoSelect.options).forEach(option => {
    if (option.value) option.disabled = !tiposDisponibles.has(option.value);
  });
  tipoSelect.value = tipoSelect.querySelector('option[disabled]').value;
  document.querySelectorAll('.salida-paquete').forEach(select => {
    select.innerHTML = '<option disabled selected>Seleccione paquete</option>';
  });
});
document.getElementById('salida-tipo').addEventListener('change', function() {
  const calibreSelect = document.getElementById('salida-calibre');
  const tipo = this.value;
  if (calibreSelect.value) {
    const data = JSON.parse(calibreSelect.value);
    const materialId = data.tipos.find(t => t.tipo === tipo)?.id;
    if (materialId) {
      document.querySelectorAll('.salida-paquete').forEach(select => {
        cargarPaquetes(materialId, tipo, select);
      });
    } else {
      alert('El material seleccionado no corresponde a este tipo de inventario');
    }
  }
});
document.getElementById('pesos-salida-container').addEventListener('input', async e => {
  if (e.target.classList.contains('salida-peso')) {
    const grupos = document.querySelectorAll('.salida-grupo');
    const ultimoGrupo = grupos[grupos.length - 1];
    const pesoInput = ultimoGrupo.querySelector('.salida-peso');
    const paqueteSelect = ultimoGrupo.querySelector('.salida-paquete');
    if (pesoInput.value && paqueteSelect.value) {
      const tipo = document.getElementById('salida-tipo').value;
      const calibreSelect = document.getElementById('salida-calibre');
      const data = JSON.parse(calibreSelect.value);
      const materialId = data.tipos.find(t => t.tipo === tipo)?.id;
      if (materialId) {
        const snap = await db.collection('paquetes')
          .where('materialId', '==', materialId)
          .where('estado', '==', 'activo')
          .get();
        const paquetesSeleccionados = Array.from(document.querySelectorAll('.salida-paquete'))
          .map(select => select.value)
          .filter(value => value);
        const paquetesDisponibles = snap.docs.filter(d => !paquetesSeleccionados.includes(d.id));
        if (paquetesDisponibles.length > 0) {
          const nuevoGrupo = document.createElement('div');
          nuevoGrupo.className = 'salida-grupo';
          nuevoGrupo.innerHTML = `
            <label>
              Paquete<br />
              <select class="salida-paquete">
                <option disabled selected>Seleccione paquete</option>
              </select>
            </label>
            <label>
              Peso a descontar (kg)<br />
              <input type="number" step="1" class="salida-peso" />
            </label>
          `;
          document.getElementById('pesos-salida-container').appendChild(nuevoGrupo);
          const nuevoSelect = nuevoGrupo.querySelector('.salida-paquete');
          cargarPaquetes(materialId, tipo, nuevoSelect);
        }
      }
    }
  }
});
document.getElementById('form-salida').addEventListener('submit', async e => {
  e.preventDefault();
  const tipo = document.getElementById('salida-tipo').value;
  const calibreSelect = document.getElementById('salida-calibre');
  if (!tipo) {
    alert('Por favor seleccione un tipo');
    return;
  }
  const grupos = document.querySelectorAll('.salida-grupo');
  const batch = db.batch();
  try {
    for (const grupo of grupos) {
      const paqueteSelect = grupo.querySelector('.salida-paquete');
      const pesoInput = grupo.querySelector('.salida-peso');
      if (paqueteSelect.value && pesoInput.value) {
        const pkg = paqueteSelect.value;
        const p = parseFloat(pesoInput.value);
        const ref = db.collection('paquetes').doc(pkg);
        const snap = await ref.get();
        const newP = snap.data().peso_actual - p;
        if (newP < 0) throw new Error(`No hay suficiente material en el paquete ${pkg}`);
        batch.update(ref, {
          peso_actual: newP,
          estado: newP <= 0 ? 'agotado' : 'activo'
        });
        const materialId = snap.data().materialId;
        const movimientoRef = db.collection('movimientos').doc();
        batch.set(movimientoRef, {
          tipo: 'salida',
          fecha: new Date(),
          peso: p,
          materialId: materialId,
          paqueteId: pkg
        });
      }
    }
    await batch.commit();
    e.target.reset();
    document.getElementById('pesos-salida-container').innerHTML = `
      <div class="salida-grupo">
        <label>
          Paquete<br />
          <select class="salida-paquete">
            <option disabled selected>Seleccione paquete</option>
          </select>
        </label>
        <label>
          Peso a descontar (kg)<br />
          <input type="number" step="1" class="salida-peso" required />
        </label>
      </div>
    `;
    renderInventario();
  } catch (error) {
    alert(error.message);
  }
});

// ==================== 6. NUEVO MATERIAL ====================
document.getElementById('pesos-nuevo-container').addEventListener('input', e => {
  if (e.target.classList.contains('nuevo-peso')) {
    const last = [...document.querySelectorAll('.nuevo-peso')].pop();
    if (last.value) {
      const lbl = document.createElement('label');
      lbl.innerHTML = 'Peso paquete (kg)<br>';
      const ip = document.createElement('input');
      ip.type = 'number';
      ip.step = '1';
      ip.className = 'nuevo-peso';
      ip.required = false;
      lbl.appendChild(ip);
      document.getElementById('pesos-nuevo-container').appendChild(lbl);
    }
  }
});
document.getElementById('form-nuevo-item').addEventListener('submit', async e => {
  e.preventDefault();
  const n = toProperCase(document.getElementById('nuevo-nombre').value.trim());
  const cl = document.getElementById('nuevo-calibre').value.trim();
  const cat = document.getElementById('nuevo-categoria').value;
  const tipo = document.getElementById('nuevo-tipo').value;
  const err = document.getElementById('error-nuevo-item');
  err.textContent = '';
  if (!n || !cl) {
    err.textContent = 'Nombre y calibre obligatorios';
    return;
  }
  const ex = await db.collection('materiales')
    .where('nombre', '==', n)
    .where('calibre', '==', cl)
    .where('tipo', '==', tipo)
    .get();
  if (!ex.empty) {
    err.textContent = 'Ítem ya existe en este tipo';
    return;
  }
  const docRef = await db.collection('materiales').add({
    nombre: n,
    calibre: cl,
    categoriaId: cat,
    tipo: tipo
  });
  const nuevos = [...document.querySelectorAll('.nuevo-peso')].map(i => parseFloat(i.value)).filter(v => v);
  for (const p of nuevos) {
    const paqRef = await db.collection('paquetes').add({
      materialId: docRef.id,
      peso_inicial: p,
      peso_actual: p,
      fecha_ingreso: new Date(),
      estado: 'activo'
    });
    await db.collection('movimientos').add({
      tipo: 'entrada',
      fecha: new Date(),
      peso: p,
      materialId: docRef.id,
      paqueteId: paqRef.id
    });
  }
  e.target.reset();
  document.getElementById('pesos-nuevo-container').innerHTML =
    '<label>Peso paquete (kg)<br><input type="number" step="1" class="nuevo-peso"></label>';
  await loadMaterialNames();
  renderInventario();
});

// ==================== 7. REPORTES Y EXPORTACIÓN ====================
document.getElementById('btn-reporte').addEventListener('click', async () => {
  const desde = new Date(document.getElementById('fecha-desde').value + 'T00:00:00');
  const hasta = new Date(document.getElementById('fecha-hasta').value + 'T23:59:59.999');
  desde.setHours(0, 0, 0, 0);
  hasta.setHours(23, 59, 59, 999);
  const desdeUTC = new Date(desde.getTime());
  const hastaUTC = new Date(hasta.getTime());
  const matsSnap = await db.collection('materiales').get();
  const matMap = {};
  matsSnap.docs.forEach(doc => { matMap[doc.id] = doc.data().nombre; });
  const [entradasSnap, salidasSnap, paquetesSnap] = await Promise.all([
    db.collection('movimientos').where('tipo', '==', 'entrada').where('fecha', '>=', desdeUTC).where('fecha', '<=', hastaUTC).get(),
    db.collection('movimientos').where('tipo', '==', 'salida').where('fecha', '>=', desdeUTC).where('fecha', '<=', hastaUTC).get(),
    db.collection('paquetes').get()
  ]);
  const paquetesMap = {};
  paquetesSnap.docs.forEach(doc => { paquetesMap[doc.id] = doc.data(); });
  const grpEnt = {}; let sumEnt = 0;
  entradasSnap.docs.forEach(d => {
    const data = d.data();
    const fecha = data.fecha.toDate();
    const fechaFormateada = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const paqueteActual = paquetesMap[data.paqueteId];
    const pesoActual = paqueteActual ? paqueteActual.peso_actual : data.peso;
    if (!grpEnt[data.materialId]) grpEnt[data.materialId] = { fechas: {}, total: 0 };
    if (!grpEnt[data.materialId].fechas[fechaFormateada]) grpEnt[data.materialId].fechas[fechaFormateada] = 0;
    grpEnt[data.materialId].fechas[fechaFormateada] += pesoActual;
    grpEnt[data.materialId].total += pesoActual;
    sumEnt += pesoActual;
  });
  const reportEnt = document.getElementById('report-entradas').querySelector('tbody');
  reportEnt.innerHTML = '';
  Object.keys(grpEnt).forEach(id => {
    const material = matsSnap.docs.find(doc => doc.id === id)?.data();
    Object.keys(grpEnt[id].fechas).forEach(fecha => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fecha}</td>
        <td>${matMap[id] || id}</td>
        <td>${material?.calibre || ''}</td>
        <td>${material?.tipo === 'segunda' ? 'Segunda' : 'Overrolling'}</td>
        <td>${grpEnt[id].fechas[fecha].toFixed(0)} kg</td>
      `;
      reportEnt.appendChild(tr);
    });
  });
  document.getElementById('sum-report-entradas').textContent = sumEnt.toFixed(2);
  const grpSal = {}; let sumSal = 0;
  salidasSnap.docs.forEach(d => {
    const data = d.data();
    const fecha = data.fecha.toDate();
    const fechaFormateada = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    if (!grpSal[data.materialId]) grpSal[data.materialId] = { fechas: {}, total: 0 };
    if (!grpSal[data.materialId].fechas[fechaFormateada]) grpSal[data.materialId].fechas[fechaFormateada] = 0;
    grpSal[data.materialId].fechas[fechaFormateada] += data.peso;
    grpSal[data.materialId].total += data.peso;
    sumSal += data.peso;
  });
  const reportSal = document.getElementById('report-salidas').querySelector('tbody');
  reportSal.innerHTML = '';
  Object.keys(grpSal).forEach(id => {
    const material = matsSnap.docs.find(doc => doc.id === id)?.data();
    Object.keys(grpSal[id].fechas).forEach(fecha => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fecha}</td>
        <td>${matMap[id] || id}</td>
        <td>${material?.calibre || ''}</td>
        <td>${material?.tipo === 'segunda' ? 'Segunda' : 'Overrolling'}</td>
        <td>${grpSal[id].fechas[fecha].toFixed(0)} kg</td>
      `;
      reportSal.appendChild(tr);
    });
  });
  document.getElementById('sum-report-salidas').textContent = sumSal.toFixed(2);
});

document.getElementById('btn-exportar').addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  const wsEnt = XLSX.utils.table_to_sheet(document.getElementById('report-entradas'));
  XLSX.utils.book_append_sheet(wb, wsEnt, 'Entradas');
  const wsSal = XLSX.utils.table_to_sheet(document.getElementById('report-salidas'));
  XLSX.utils.book_append_sheet(wb, wsSal, 'Salidas');
  XLSX.writeFile(wb, 'reporte_inventario.xlsx');
});

// ==================== 8. VALIDACIONES Y OVERLAYS ====================
function setupFechasValidation() {
  const fechaDesde = document.getElementById('fecha-desde');
  const fechaHasta = document.getElementById('fecha-hasta');
  const btnReporte = document.getElementById('btn-reporte');
  function getToday() {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    return today.toISOString().split('T')[0];
  }
  fechaDesde.max = getToday();
  fechaDesde.addEventListener('focus', () => { fechaDesde.max = getToday(); });
  fechaDesde.addEventListener('input', () => {
    fechaHasta.min = fechaDesde.value;
    validarFechas();
  });
  fechaHasta.addEventListener('input', validarFechas);
  function validarFechas() {
    const desde = new Date(fechaDesde.value);
    const hasta = new Date(fechaHasta.value);
    if (fechaDesde.value && fechaHasta.value) {
      if (desde > hasta) {
        alert('La fecha "Hasta" no puede ser anterior a la fecha "Desde"');
        fechaHasta.value = '';
        btnReporte.disabled = true;
        return false;
      }
    }
    btnReporte.disabled = !(fechaDesde.value && fechaHasta.value);
    return true;
  }
  validarFechas();
}
setupFechasValidation();

// ==================== 9. INICIALIZACIÓN FINAL ====================
(async () => {
  setupNav();
  populateCategorias();
  await loadMaterialNames();
  document.querySelectorAll('.inventory-tabs .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.inventory-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentInventoryType = btn.dataset.category;
      renderInventario();
    });
  });
  renderInventario();
})();

document.getElementById('btn-editar-inventario').addEventListener('click', async function() {
  const mensaje = document.getElementById('mensaje-guardado');
  const loadingOverlay = document.getElementById('loading-overlay');
  try {
    if (inventarioEditMode) {
      loadingOverlay.classList.remove('hidden');
      mensaje.textContent = 'Guardando cambios...';
      mensaje.classList.add('mostrar');
      await guardarCambiosInventario();
      inventarioEditMode = false;
      this.textContent = 'Editar Inventario';
      mensaje.textContent = '¡Cambios guardados!';
      mensaje.style.background = 'var(--primary-green)';
    } else {
      inventarioEditMode = true;
      this.textContent = 'Guardar Cambios';
      mensaje.textContent = 'Modo edición activado';
      mensaje.classList.add('mostrar');
    }
    await renderInventario();
    setTimeout(() => mensaje.classList.remove('mostrar'), 1500);
  } catch (error) {
    console.error('Error:', error);
    mensaje.textContent = `Error: ${error.message}`;
    mensaje.style.background = '#d32f2f';
    mensaje.classList.add('mostrar');
    inventarioEditMode = false;
    this.textContent = 'Editar Inventario';
    setTimeout(() => {
      mensaje.classList.remove('mostrar');
      mensaje.style.background = 'var(--primary-green)';
    }, 2000);
  } finally {
    loadingOverlay.classList.add('hidden');
  }
});
