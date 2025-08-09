"""Aplicación de gestión de staff para Pop Life.

Esta versión incluye:
    - Fichaje de entrada y salida.
    - Registro de tickets y personas atendidas.
    - Panel personal con estadísticas y gráficos.
    - Ranking de productividad.
    - Panel de fundador para añadir/eliminar miembros y descargar datos.

La aplicación utiliza Google Sheets como base de datos.
"""

from datetime import date, datetime
from io import BytesIO

import gspread
import pandas as pd
import streamlit as st
from oauth2client.service_account import ServiceAccountCredentials

# ========================================
# CONFIGURACIÓN GOOGLE SHEETS
# ========================================

SCOPE = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

# Cambia por el ID real de la hoja de cálculo
SPREADSHEET_ID = "REGISTRO STAFF AG"


@st.cache_resource
def conectar_google() -> gspread.client.Client:
    """Autentica y devuelve un cliente de Google Sheets."""
    creds = ServiceAccountCredentials.from_json_keyfile_name(
        "credenciales.json", SCOPE
    )
    return gspread.authorize(creds)


client = conectar_google()

# Hojas usadas por la aplicación
sheet_fichajes = client.open_by_key(SPREADSHEET_ID).worksheet("Fichajes")
sheet_tickets = client.open_by_key(SPREADSHEET_ID).worksheet("Tickets")
sheet_personas = client.open_by_key(SPREADSHEET_ID).worksheet("Personas")
sheet_staff = client.open_by_key(SPREADSHEET_ID).worksheet("Staff")

# Cargar lista de miembros
datos_staff = sheet_staff.get_all_records()
staff_nombres = [fila["Nombre"] for fila in datos_staff]
rangos = [
    "Soporte",
    "Moderador",
    "Moderador IG",
    "Administrador",
    "Game Master",
    "Director de Staff",
    "Sub Director de Staff",
    "Admin Mafia",
]

# Fundadores con acceso total
FUNDADORES = {"Lama", "Vitro", "Kevin"}


@st.cache_data
def cargar_datos():
    """Obtiene los registros completos de las hojas de cálculo."""
    fichajes = pd.DataFrame(sheet_fichajes.get_all_records())
    tickets = pd.DataFrame(sheet_tickets.get_all_records())
    personas = pd.DataFrame(sheet_personas.get_all_records())
    return fichajes, tickets, personas


def obtener_rango(nombre_sel: str) -> str:
    """Devuelve el rango asociado a un nombre."""
    for fila in datos_staff:
        if fila["Nombre"] == nombre_sel:
            return fila["Rango"]
    return "No asignado"


# ========================================
# INTERFAZ PRINCIPAL
# ========================================

st.set_page_config(page_title="Pop Life Staff", layout="wide")
st.title("🛡️ Registro Staff Pop Life")

nombre = st.selectbox("🧍 Selecciona tu nombre", staff_nombres)
rango = obtener_rango(nombre)
st.markdown(f"Tu rango es: **{rango}**")

# ----------------------------------------
# FICHAR ENTRADA / SALIDA
# ----------------------------------------

col1, col2 = st.columns(2)

if col1.button("🟢 Fichar entrada"):
    st.session_state["entrada"] = datetime.now()
    st.success(
        f"Entrada registrada a las {st.session_state['entrada'].strftime('%H:%M:%S')}"
    )

if col2.button("🔴 Fichar salida"):
    if "entrada" not in st.session_state:
        st.error("⚠️ Primero debes fichar la entrada.")
    else:
        salida = datetime.now()
        entrada = st.session_state.pop("entrada")
        duracion = salida - entrada
        minutos = round(duracion.total_seconds() / 60, 2)
        sheet_fichajes.append_row(
            [
                nombre,
                rango,
                entrada.strftime("%Y-%m-%d"),
                entrada.strftime("%H:%M:%S"),
                salida.strftime("%H:%M:%S"),
                minutos,
            ]
        )
        st.success(f"Servicio registrado: {minutos} min")


# ----------------------------------------
# FORMULARIOS DE REGISTRO ADICIONAL
# ----------------------------------------

with st.expander("➕ Añadir ticket"):
    t_numero = st.text_input("Número de ticket")
    t_motivo = st.text_area("Motivo")
    t_fecha = st.date_input("Fecha", value=date.today())
    if st.button("Guardar ticket"):
        if t_numero:
            sheet_tickets.append_row(
                [t_numero, t_motivo, t_fecha.strftime("%Y-%m-%d"), nombre]
            )
            st.success("Ticket guardado")
        else:
            st.warning("Debes ingresar un número de ticket")

with st.expander("➕ Añadir persona atendida"):
    p_motivo = st.text_area("Motivo", key="motivo_persona")
    p_fecha = st.date_input("Fecha", value=date.today(), key="fecha_persona")
    if st.button("Guardar persona"):
        sheet_personas.append_row([p_motivo, p_fecha.strftime("%Y-%m-%d"), nombre])
        st.success("Registro guardado")


# ----------------------------------------
# PANEL PERSONAL
# ----------------------------------------

st.markdown("---")
st.subheader("📈 Tus estadísticas")

fichajes_df, tickets_df, personas_df = cargar_datos()

fichajes_user = (
    fichajes_df[fichajes_df["Nombre"] == nombre] if not fichajes_df.empty else pd.DataFrame()
)
tickets_user = (
    tickets_df[tickets_df["Miembro"] == nombre] if not tickets_df.empty else pd.DataFrame()
)
personas_user = (
    personas_df[personas_df["Miembro"] == nombre]
    if not personas_df.empty
    else pd.DataFrame()
)

total_minutos = (
    fichajes_user["Minutos"].astype(float).sum() if not fichajes_user.empty else 0
)
total_tickets = len(tickets_user)
total_personas = len(personas_user)

m1, m2, m3 = st.columns(3)
m1.metric("Horas fichadas", round(total_minutos / 60, 2))
m2.metric("Tickets", total_tickets)
m3.metric("Personas atendidas", total_personas)

if not fichajes_user.empty:
    fichajes_user["Fecha"] = pd.to_datetime(fichajes_user["Fecha"])
    st.bar_chart(fichajes_user.groupby("Fecha")["Minutos"].sum())


# ----------------------------------------
# RANKING DE PRODUCTIVIDAD
# ----------------------------------------

st.markdown("---")
st.subheader("🏆 Ranking de productividad")

horas = (
    fichajes_df.groupby("Nombre")["Minutos"].sum() / 60
    if not fichajes_df.empty
    else pd.Series(dtype=float)
)
tickets_count = (
    tickets_df.groupby("Miembro").size() if not tickets_df.empty else pd.Series(dtype=int)
)
personas_count = (
    personas_df.groupby("Miembro").size() if not personas_df.empty else pd.Series(dtype=int)
)

ranking_df = pd.DataFrame({"Horas": horas, "Tickets": tickets_count, "Personas": personas_count}).fillna(0)
ranking_df["Puntos"] = ranking_df["Horas"] + ranking_df["Tickets"] + ranking_df["Personas"]
ranking_df = ranking_df.sort_values("Puntos", ascending=False)
st.dataframe(ranking_df)


# ----------------------------------------
# PANEL DEL FUNDADOR
# ----------------------------------------

if nombre in FUNDADORES:
    st.markdown("---")
    st.subheader("⚙️ Panel del fundador")

    nuevo_nombre = st.text_input("Nombre del nuevo staff")
    nuevo_rango = st.selectbox("Rango", rangos, key="rango_nuevo")
    if st.button("Añadir staff"):
        if nuevo_nombre:
            if nuevo_nombre in staff_nombres:
                st.warning("El miembro ya existe")
            else:
                sheet_staff.append_row([nuevo_nombre, nuevo_rango])
                staff_nombres.append(nuevo_nombre)
                st.success("Miembro añadido")
        else:
            st.warning("Introduce un nombre")

    eliminar = st.selectbox("Eliminar miembro", [""] + staff_nombres)
    if st.button("Eliminar staff") and eliminar:
        try:
            cell = sheet_staff.find(eliminar)
            sheet_staff.delete_rows(cell.row)
            staff_nombres.remove(eliminar)
            st.success("Miembro eliminado")
        except gspread.exceptions.CellNotFound:
            st.warning("Miembro no encontrado")

    # Descargar datos
    fichajes_df, tickets_df, personas_df = cargar_datos()
    st.markdown("### Descargar datos")
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        fichajes_df.to_excel(writer, sheet_name="Fichajes", index=False)
        tickets_df.to_excel(writer, sheet_name="Tickets", index=False)
        personas_df.to_excel(writer, sheet_name="Personas", index=False)
    st.download_button(
        "Descargar Excel",
        data=output.getvalue(),
        file_name="poplife_datos.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

