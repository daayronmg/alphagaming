#!/usr/bin/env bash
# Copia de seguridad de ESTRELLA: base de datos + archivos privados (partituras, audios).
# Uso: DATABASE_URL=... STORAGE_DIR=... ./scripts/backup.sh /ruta/copias
# Programar a diario (cron) y guardar copias fuera del servidor.
set -euo pipefail
DEST="${1:-./copias}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
pg_dump --format=custom --no-owner "$DATABASE_URL" > "$DEST/estrella-db-$STAMP.dump"
tar -czf "$DEST/estrella-archivos-$STAMP.tar.gz" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
# conserva las 30 copias más recientes
ls -1t "$DEST"/estrella-db-*.dump 2>/dev/null | tail -n +31 | xargs -r rm --
ls -1t "$DEST"/estrella-archivos-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm --
echo "Copia creada en $DEST ($STAMP)"
# Restaurar: pg_restore --clean --no-owner -d "$DATABASE_URL" estrella-db-XXXX.dump && tar -xzf estrella-archivos-XXXX.tar.gz -C <carpeta>
