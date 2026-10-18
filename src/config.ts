// ============================================================
//  CONFIGURACIÓN CENTRAL — edita SOLO este archivo para datos reales
//  Todo lo marcado con [AÑADIR ...] debe sustituirse antes de publicar.
// ============================================================

// URL final de la web. Mientras no tengas dominio, usa la que te dé Cloudflare (xxxx.pages.dev).
export const SITE_URL = 'https://nextgranmaestro.pages.dev'; // [CAMBIAR por tu dominio real cuando lo compres]

export const SITE_NAME = 'NextGranMaestro';
export const SITE_TAGLINE = 'Analiza cualquier posición de ajedrez y descubre la mejor jugada';

// Planes de pago. PRECIOS PROPUESTOS por mí como punto de partida: cámbialos a los que tú quieras.
// checkout = enlace de pago (Stripe Payment Link, Lemon Squeezy...). Mientras sea null, el botón dice "Próximamente".
export const PLANS = {
  monthly: { price: '4,99 €', period: '/mes', priceNumber: '4.99', checkout: null as string | null }, // [AÑADIR ENLACE DE PAGO REAL]
  yearly: { price: '39,99 €', period: '/año', priceNumber: '39.99', checkout: null as string | null, note: 'Equivale a 3,33 €/mes · ahorras un 33 %' }, // [AÑADIR ENLACE DE PAGO REAL]
};

// Enlace al portal de cliente de Stripe (para que el usuario cancele o cambie su tarjeta). null = no se muestra.
export const PORTAL_URL: string | null = null; // [AÑADIR enlace del portal de cliente de Stripe]

// Testimonios: SOLO reales y con permiso de la persona. Mientras la lista esté vacía, la sección NO se muestra.
// Ejemplo: { name: 'Nombre o alias', detail: 'Jugador de club', text: 'Lo que dijo, tal cual.' }
export const TESTIMONIALS: { name: string; detail?: string; text: string }[] = [];

// Análisis gratuitos por día en el plan gratis (valor de partida, cámbialo a tu gusto).
export const FREE_ANALYSES_PER_DAY = 5;

// Contacto: de momento no hay email ni redes.
export const CONTACT_EMAIL: string | null = null; // [AÑADIR EMAIL REAL]

// Datos legales del titular (obligatorios en España para el Aviso Legal si hay actividad económica)
export const LEGAL = {
  owner: '[AÑADIR NOMBRE O RAZÓN SOCIAL]',
  taxId: '[AÑADIR NIF/CIF]',
  address: '[AÑADIR DOMICILIO]',
  email: '[AÑADIR EMAIL]',
};

export const NAV = [
  { href: '/analizador', label: 'Analizador' },
  { href: '/como-funciona', label: 'Cómo funciona' },
  { href: '/precios', label: 'Precios' },
  { href: '/faq', label: 'Preguntas' },
];
