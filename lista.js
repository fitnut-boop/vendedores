/* Lista de precios descargable (PDF y Excel): lista simple de venta, General por defecto o Distribuidora. */
let lpSeg = 'g';   // 'g' = General · 'm' = Distribuidora (mayorista)
const LP_NOMBRE = { g: 'General', m: 'Distribuidora' };
const LP_INTERNOS = /combo|exhi|test|aass|almacen|libr|promo|pop\b|caramelera|gambeta|semana|carnicer|cnc|botadero|puntera/i;

// Filas de la lista elegida: [código, producto, unidades por bulto, precio bulto sin IVA, precio bulto con IVA]
function filasLista(seg) {
  const idx = seg === 'g' ? 2 : 3, vistos = new Map();
  for (const l of Object.values(datos.listas || {})) {
    for (const it of l.items) {
      const precio = Number(it[idx]);
      if (!(precio >= 1000) || vistos.has(it[0])) continue;
      // Se dejan afuera los artículos internos (combos, exhibidores, promociones, pruebas) para que sea una lista simple de venta
      if (Number(it[0]) >= 100000 && LP_INTERNOS.test(String(it[1]))) continue;
      const u = Number(datos.unidades[it[0]]);
      vistos.set(it[0], [String(it[0]), String(it[1] || '').trim(), u > 0 ? u : '', round2(precio), round2(precio * (1 + IVA))]);
    }
  }
  return [...vistos.values()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
}

function fechaHoy() { return new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
const nombreArchivo = (seg, ext) => `Lista de precios ${LP_NOMBRE[seg]} FitNut ${new Date().toISOString().slice(0, 10)}.${ext}`;

function descargarPdf(seg) {
  const filas = filasLista(seg);
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('No se pudo cargar el generador de PDF. Revisá tu conexión o usá la descarga en Excel.');
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(`FitNut · Lista de precios ${LP_NOMBRE[seg]}`, 40, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  doc.text(`Precios por bulto · IVA ${Math.round(IVA * 100)}% · Descargada el ${fechaHoy()}`, 40, 60);
  const m = n => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  doc.autoTable({
    startY: 74,
    head: [['Código', 'Producto', 'Un. x bulto', 'Precio bulto s/IVA', 'Precio bulto c/IVA']],
    body: filas.map(f => [f[0], f[1], f[2], '$ ' + m(f[3]), '$ ' + m(f[4])]),
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [20, 48, 111], textColor: 255 },
    alternateRowStyles: { fillColor: [244, 246, 251] },
    columnStyles: { 0: { cellWidth: 48 }, 2: { halign: 'right', cellWidth: 52 }, 3: { halign: 'right', cellWidth: 92 }, 4: { halign: 'right', cellWidth: 92 } },
    margin: { left: 40, right: 40, bottom: 36 },
    didDrawPage: () => {
      const n = doc.internal.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(130);
      doc.text(`Página ${doc.internal.getCurrentPageInfo().pageNumber}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 18, { align: 'right' });
    }
  });
  doc.save(nombreArchivo(seg, 'pdf'));
  return filas.length;
}

function descargarExcel(seg) {
  const filas = filasLista(seg);
  const ws = XLSX.utils.aoa_to_sheet([
    [`FitNut · Lista de precios ${LP_NOMBRE[seg]} · Precios por bulto · Descargada el ${fechaHoy()}`], [],
    ['Código', 'Producto', 'Un. x bulto', 'Precio bulto s/IVA', `Precio bulto c/IVA (${Math.round(IVA * 100)}%)`], ...filas
  ]);
  ws['!cols'] = [{ wch: 9 }, { wch: 44 }, { wch: 11 }, { wch: 18 }, { wch: 20 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Lista ' + LP_NOMBRE[seg]);
  XLSX.writeFile(wb, nombreArchivo(seg, 'xlsx'));
  return filas.length;
}

function pintarLista() {
  document.querySelectorAll('#lpSeg button').forEach(b => b.classList.toggle('on', b.dataset.lp === lpSeg));
  $('#lpPdf').textContent = `Descargar PDF · ${LP_NOMBRE[lpSeg]}`;
  const n = filasLista(lpSeg).length;
  $('#lpInfo').textContent = n ? `${n} productos con precio vigente en la lista ${LP_NOMBRE[lpSeg]}. Precios por bulto, sin IVA y con IVA.` : 'Todavía no hay precios cargados.';
  $('#lpMsg').textContent = '';
}

document.querySelectorAll('#lpSeg button').forEach(b => b.addEventListener('click', () => { lpSeg = b.dataset.lp; pintarLista(); }));
for (const [id, fn, ext] of [['#lpPdf', descargarPdf, 'PDF'], ['#lpXls', descargarExcel, 'Excel']]) {
  $(id).addEventListener('click', () => {
    const m = $('#lpMsg');
    try { const n = fn(lpSeg); m.className = 'msg'; m.textContent = `Listo: ${ext} de la lista ${LP_NOMBRE[lpSeg]} con ${n} productos.`; }
    catch (e) { m.className = 'msg err'; m.textContent = e.message || 'No se pudo generar la lista.'; }
  });
}
document.querySelectorAll('[data-sub="lp"]').forEach(b => b.addEventListener('click', pintarLista));
