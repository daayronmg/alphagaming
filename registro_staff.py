import streamlit as st
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime
import pandas as pd

# ================================
# CONFIG GOOGLE SHEETS
# ================================

SCOPE = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]

# Cambia por el ID de tu hoja de cálculo de Google (el largo código en la URL de Sheets)
SPREADSHEET_ID = "REGISTRO STAFF AG"

@st.cache_resource
def conectar_google():
    creds = ServiceAccountCredentials.from_json_keyfile_name("credenciales.json", SCOPE)
    client = gspread.authorize(creds)
    return client

client = conectar_google()

# Abrimos las hojas necesarias
sheet_registro = client.open_by_key(SPREADSHEET_ID).worksheet("Registro")  # hoja donde guardas registros
sheet_staff = client.open_by_key(SPREADSHEET_ID).worksheet("Staff")        # hoja donde guardas staff

# ====================================
# CARGAR LISTA DE STAFF DESDE HOJA
# ====================================
datos_staff = sheet_staff.get_all_records()
staff_nombres = [fila["Nombre"] for fila in datos_staff]
rangos = [
    "Soporte", "Moderador", "Moderador IG", "Administrador",
    "Game Master", "Director de Staff", "Sub Director de Staff", "Admin Mafia"
]

# ================================
# CONTRASEÑA PANEL ADMIN
# ================================
PASSWORD_ADMIN = "DSALPHA"  # Cambia la contraseña aquí

# ================================
# INTERFAZ STREAMLIT
# ================================

st.title("🛡️ Registro Staff AlphaGaming")

nombre = st.selectbox("🧍 Selecciona tu nombre", staff_nombres)
# Obtener el rango automáticamente según el nombre seleccionado
def obtener_rango(nombre_sel):
    for fila in datos_staff:
        if fila["Nombre"] == nombre_sel:
            return fila["Rango"]
    return "No asignado"

rango = obtener_rango(nombre)

st.markdown(f"Tu rango es: **{rango}**")

col1, col2 = st.columns(2)

if col1.button("🟢 Entrar en servicio"):
    entrada = datetime.now()
    st.session_state["entrada"] = entrada
    st.success(f"Has entrado en servicio a las {entrada.strftime('%H:%M:%S')}")

if col2.button("🔴 Salir de servicio"):
    if "entrada" not in st.session_state:
        st.error("⚠️ Primero debes entrar en servicio.")
    else:
        personas_atendidas = st.number_input("Número de personas atendidas", min_value=0, step=1, key="personas_atendidas")
        motivo = st.text_area("Motivo de la atención", key="motivo")
        solucion = st.text_area("Solución dada", key="solucion")

        salida = datetime.now()
        entrada = st.session_state["entrada"]
        duracion = salida - entrada
        minutos = round(duracion.total_seconds() / 60)

        fecha = entrada.strftime("%Y-%m-%d")
        hora_entrada = entrada.strftime("%H:%M:%S")
        hora_salida = salida.strftime("%H:%M:%S")

        # Guardar en Google Sheets
        sheet_registro.append_row([
            nombre,
            rango,
            fecha,
            hora_entrada,
            hora_salida,
            f"{minutos} min",
            personas_atendidas,
            motivo,
            solucion
        ])

        st.success(f"✅ Servicio registrado: {minutos} minutos.")
        del st.session_state["entrada"]

# ================================
# PANEL ADMINISTRATIVO
# ================================

st.markdown("---")
st.subheader("📊 Panel de Control (Solo Admin)")

clave = st.text_input("Introduce contraseña para ver el panel admin", type="password")

if clave == PASSWORD_ADMIN:
    # Mostrar registros de servicio
    registros = sheet_registro.get_all_records()
    df = pd.DataFrame(registros)

    if not df.empty:
        filtro_nombre = st.selectbox("Filtrar registros por nombre", ["Todos"] + staff_nombres, key="filtro_nombre")
        if filtro_nombre != "Todos":
            df = df[df["Nombre"] == filtro_nombre]

        st.dataframe(df)

        resumen = df.groupby("Nombre")["Duración"].count().reset_index(name="Servicios Realizados")
        st.markdown("#### Servicios por Persona")
        st.dataframe(resumen)
    else:
        st.info("Aún no hay registros.")

    # Añadir nuevo staff
    st.markdown("### ➕ Añadir nuevo miembro del staff")

    nuevo_nombre = st.text_input("Nombre del nuevo staff", key="nuevo_nombre")
    nuevo_rango = st.selectbox("Selecciona su rango", rangos, key="nuevo_rango")

    if st.button("Añadir al staff", key="boton_añadir"):
        if nuevo_nombre and nuevo_rango:
            # Verificar si ya existe
            if nuevo_nombre in staff_nombres:
                st.warning(f"⚠️ {nuevo_nombre} ya está en la lista de staff.")
            else:
                sheet_staff.append_row([nuevo_nombre, nuevo_rango])
                st.success(f"✅ {nuevo_nombre} añadido como {nuevo_rango}.")
                # Actualizar lista localmente
                staff_nombres.append(nuevo_nombre)
        else:
            st.warning("⚠️ Debes ingresar un nombre y seleccionar un rango.")
else:
    st.info("Introduce la contraseña para acceder al panel de administración.")
