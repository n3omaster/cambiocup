# CambioCUP - Tasa de Cambio en Cuba

[![Next.js](https://img.shields.io/badge/Next.js-16.1.4-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.3-blue)](https://reactjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-2.91.0-green)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1.18-38B2AC)](https://tailwindcss.com/)

## Descripcion

**CambioCUP** es una aplicacion web que proporciona tasas de cambio en tiempo real para las monedas cubanas en relacion al dolar estadounidense. Es un servicio gratuito desarrollado por [QvaPay](https://qvapay.com) que permite a los usuarios monitorear las fluctuaciones de las tasas de cambio de manera visual e interactiva.

## Caracteristicas

- **Tasas en Tiempo Real**: Actualizacion automatica cada 4 segundos
- **Cinco Monedas Cubanas**:
  - **CUP** (Peso Cubano)
  - **MLC** (Moneda Libremente Convertible)
  - **CLASICA** (Tarjeta Clasica)
  - **ETECSA** (Saldo ETECSA)
  - **TROPICAL** (BANDECPREPAGO)
- **Animaciones Fluidas**: Transiciones suaves de numeros con NumberFlow
- **Indicadores Visuales**: Colores que cambian segun la tendencia (verde para bajada, rojo para subida)
- **Interfaz Interactiva**: Click en cada moneda para cambiar la vista
- **Notificaciones Push**: Integracion con OneSignal
- **Diseno Responsivo**: Optimizado para todos los dispositivos
- **Widget Embebible**: Codigo iframe para insertar en otras paginas
- **API REST**: Endpoints para obtener datos historicos

## Arquitectura

### Frontend
- **Next.js 16** - Framework de React con App Router y Turbopack
- **React 19** - Biblioteca de interfaz de usuario
- **Tailwind CSS 4** - Framework de CSS utilitario
- **NumberFlow** - Animaciones fluidas de numeros
- **OneSignal** - Sistema de notificaciones push

### Backend
- **API Routes** - Endpoints serverless de Next.js
- **Supabase** - Base de datos PostgreSQL
- **Cron Jobs** - Actualizacion automatica de datos desde QvaPay API

### Base de Datos
- **Tabla `exchange`**: Almacena historial de tasas con campos:
  - `coin_id`: 1 (CUP), 2 (MLC), 3 (CLASICA), 4 (ETECSA), 5 (BANDECPREPAGO)
  - `value`: Valor de la tasa
  - `updated_at`: Timestamp de actualizacion

## Instalacion

### Prerrequisitos
- Node.js 20+
- npm o yarn
- Cuenta de Supabase

### Pasos

1. **Clonar el repositorio**
```bash
git clone https://github.com/n3omaster/cambiocup.git
cd cambiocup
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
# Crear archivo .env
SUPABASE_URL=tu_url_de_supabase
SUPABASE_KEY=tu_clave_anonima_de_supabase
```

4. **Ejecutar en desarrollo**
```bash
npm run dev
```

5. **Construir para produccion**
```bash
npm run build
npm start
```

## API Endpoints

### GET `/api`
Obtiene el historial de las cinco monedas (ultimas 6 entradas cada una)
```json
{
  "cupHistory": [...],
  "mlcHistory": [...],
  "clasicaHistory": [...],
  "etecsaHistory": [...],
  "bandecprepagoHistory": [...]
}
```

### GET `/api/cron`
Endpoint para cron jobs que actualiza las tasas desde QvaPay API

### GET `/api/og`
Genera imagenes Open Graph dinamicas para redes sociales

## Flujo de Datos

1. **Cron Job** ejecuta periodicamente y obtiene datos de QvaPay API
2. **Supabase** almacena los nuevos valores en la tabla `exchange`
3. **Frontend** consulta la API cada 4 segundos para obtener datos actualizados
4. **Helpers** calculan promedios y aplican variaciones para simular fluctuaciones en tiempo real
5. **NumberFlow** anima las transiciones de valores suavemente
6. **UI** actualiza colores segun las tendencias (verde = bajada, rojo = subida)

## Funcionalidades de la UI

- **Cambio de Moneda**: Click en cualquier moneda para alternar la vista
- **Indicadores de Color**:
  - **Verde** (`bg-malachite`): Tasa actual < Promedio (tendencia a la baja)
  - **Rojo** (`bg-crimson`): Tasa actual > Promedio (tendencia al alza)
- **Animaciones**: Transiciones fluidas al cambiar valores numericos
- **Widget**: Boton para obtener codigo iframe embebible
- **Diseno Minimalista**: Interfaz limpia centrada en la informacion

## Scripts Disponibles

```bash
npm run dev      # Desarrollo con Turbopack (default en Next.js 16)
npm run build    # Construccion para produccion
npm run start    # Iniciar servidor de produccion
npm run lint     # Ejecutar ESLint
```

## Despliegue

La aplicacion esta optimizada para desplegarse en:
- **Vercel** (recomendado para Next.js)
- **Netlify**
- **Railway**
- **Cualquier plataforma que soporte Node.js 20+**

## PWA

- **Manifest configurado**: Instalable como aplicacion
- **Responsive Design**: Adaptable a todos los tamanos de pantalla
- **Touch Friendly**: Interfaz optimizada para dispositivos tactiles

## Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/NuevaFuncion`)
3. Commit tus cambios (`git commit -m 'Add NuevaFuncion'`)
4. Push a la rama (`git push origin feature/NuevaFuncion`)
5. Abre un Pull Request

## Licencia

Este proyecto es un servicio gratuito desarrollado por QvaPay. Todos los derechos reservados.

## Autor

**Erich Garcia Cruz**

## Links

- [QvaPay](https://qvapay.com)
- [X (Twitter)](https://x.com/qvapay)
- [GitHub](https://github.com/n3omaster/cambiocup)

---

**CambioCUP** - Un servicio gratuito para monitorear las tasas de cambio en Cuba
