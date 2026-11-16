/**
 * Objetivos por categoría: lee el Excel "Objetivos Plan Comercial Nestlé <Mes> <Año>.xlsx" de la carpeta de objetivos
 * (sección "Carga bot": Categoría bot / Objetivo kg) y los guarda por mes. Va en el MISMO proyecto de Apps Script que
 * objetivos-drive.gs y la llama sincronizarObjetivos() todos los días (usa CARPETA_ID, MESES, sinTildes y SUPABASE_URL de ese archivo).
 * Si un mes no tiene archivo, la base usa los objetivos del último mes cargado.
 * (Código completo: ver el proyecto de Apps Script; funciones sincronizarObjetivosCategoria y leerObjetivosCategoria.)
 */
